// ============================================================================
// buffTimersFold.ts — WHAT THE CROWD-CONTROL HALF STORES IN A CHECKPOINT (JOS-208 phase 2).
// ============================================================================
//
// The declaration and the conversions for `modules/buffTimers.ts`, beside it rather than inside
// it because that file is at the repo's 400-code-line ceiling and the house answer to that is a
// split. The same arrangement `buffsFoldShapes.ts` has for the buffs half.
//
// THE TWO SHARED HALVES ARE NOT IN THIS DECLARATION, and that is its single most important line.
// `CastAnchors` and `SpellStats` are the BUFFS module's objects, handed to the CC module at
// construction so the two halves cannot disagree about whose spell landed or how long it runs
// (JOS-140 ruling 1). They are checkpointed exactly ONCE, in the `buffs` blob, by their owner.
// Serializing them here as well would restore two copies into one wiring — the second overwriting
// the first — and re-create by hand the drift the ticket that unified them exists to end.
//
// `holds` and `culled` keep their Map ORDER (entries arrays, not records): `sweep` walks them in
// insertion order, and `ends` is a time-ordered ring beside them.

import type { CcEnd } from '../../shared/buffTimers'
import { S, type FoldSchema } from '../foldCache/schema'
import { HoldGroup, type HoldGroupFoldState } from './buffRounds'

/** One live hold as plain data — `group` flattened, `durationMs`'s null carried as ABSENT. */
export interface HeldFoldState {
  key: string
  entityKey: string
  target: string
  lineKey: string
  spell?: string
  candidates: string[]
  caster: string
  durationMs?: number
  source?: 'db' | 'observed'
  group: HoldGroupFoldState
}

/** A culled landing a late break line may still be measured against ({@link LateJoin}). */
export interface LateJoinFoldState {
  entityKey: string
  lineKey: string
  caster: string
  spell: string
  startedTs: number
  joinableUntil: number
}

/** One freshly minted sample, awaiting a possible wake annotation ({@link RecentMint}). */
export interface RecentMintFoldState {
  entityKey: string
  lineKey: string
  caster: string
  ts: number
}

/** The crowd-control module's complete event-derived state — the two shared halves excluded. */
export interface BuffTimersFoldState {
  holds: [string, HeldFoldState][]
  ends: CcEnd[]
  culled: [string, LateJoinFoldState][]
  recentMints: RecentMintFoldState[]
  lastEventTs: number
  rev: number
}

const HELD_SCHEMA: FoldSchema = S.obj({
  key: S.str,
  entityKey: S.str,
  target: S.str,
  lineKey: S.str,
  spell: S.opt(S.str),
  candidates: S.arr(S.str),
  caster: S.str,
  // `durationMs: number | null` live — the null means "nobody states one", and an absent field is
  // the grammar's one way to say that. The module restores it as null on the way back in.
  durationMs: S.opt(S.num),
  source: S.opt(S.enum('db', 'observed')),
  group: HoldGroup.FOLD_SCHEMA
})

export const BUFF_TIMERS_FOLD_SCHEMA: FoldSchema = S.obj({
  holds: S.arr(S.tuple(S.str, HELD_SCHEMA)),
  ends: S.arr(S.obj({ key: S.str, spell: S.opt(S.str), ts: S.num })),
  culled: S.arr(
    S.tuple(
      S.str,
      S.obj({
        entityKey: S.str,
        lineKey: S.str,
        caster: S.str,
        spell: S.str,
        startedTs: S.num,
        joinableUntil: S.num
      })
    )
  ),
  recentMints: S.arr(S.obj({ entityKey: S.str, lineKey: S.str, caster: S.str, ts: S.num })),
  lastEventTs: S.num,
  rev: S.num
})

/** One hold, un-aliased and with its `HoldGroup` flattened. */
export function packHeld(h: {
  key: string
  entityKey: string
  target: string
  lineKey: string
  spell?: string
  candidates: string[]
  caster: string
  durationMs: number | null
  source?: 'db' | 'observed'
  group: HoldGroup
}): HeldFoldState {
  return {
    key: h.key,
    entityKey: h.entityKey,
    target: h.target,
    lineKey: h.lineKey,
    ...(h.spell === undefined ? {} : { spell: h.spell }),
    candidates: [...h.candidates],
    caster: h.caster,
    ...(h.durationMs === null ? {} : { durationMs: h.durationMs }),
    ...(h.source === undefined ? {} : { source: h.source }),
    group: h.group.serializeFold()
  }
}

/**
 * …and back. The group is rebuilt NEVER as a singleton, which is `ensureHold`'s own rule written
 * where the restore can obey it: a mob is a NAME the world hands out more than once, and
 * separating two of them is one of world-model law 6's documented non-distinguishables.
 */
export function unpackHeld(h: HeldFoldState): {
  key: string
  entityKey: string
  target: string
  lineKey: string
  spell?: string
  candidates: string[]
  caster: string
  durationMs: number | null
  source?: 'db' | 'observed'
  group: HoldGroup
} {
  return {
    key: h.key,
    entityKey: h.entityKey,
    target: h.target,
    lineKey: h.lineKey,
    ...(h.spell === undefined ? {} : { spell: h.spell }),
    candidates: h.candidates,
    caster: h.caster,
    durationMs: h.durationMs ?? null,
    ...(h.source === undefined ? {} : { source: h.source }),
    group: HoldGroup.from(false, h.group)
  }
}
