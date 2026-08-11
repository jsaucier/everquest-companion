// ============================================================================
// buffsFoldShapes.ts — WHAT THE BUFFS MODEL STORES IN A CHECKPOINT (JOS-208 phase 2).
// ============================================================================
//
// The buffs model is six collaborators wearing one module id, and its checkpoint declaration is
// correspondingly the widest in the tree. It lives HERE, beside the model rather than inside it,
// for the reason `buffsView.ts` and `buffsInstanceRules.ts` do: `buffs.ts` and
// `buffsInstances.ts` both sit at the repo's 400-code-line ceiling and the house answer to that
// is a split, never a widened threshold.
//
// WHAT IS IN THIS FILE: the two DECLARATIONS (the instance store's and the module's), the plain
// shapes they describe, and the pure conversions between a live collection and its stored form.
// What is NOT: any decision about what to store. Each exclusion is argued at the class that owns
// the state — `BuffInstances`, `SpellStats`, `PetEntities`, `CastAnchors`, `SessionFrame` and the
// `MessageOverlayMiner` each carry their own seam note — because a rule stated away from the
// thing it governs is a rule that stops being read.

import type { ActiveBuff } from '../../shared/types'
import type { EntityDisposition } from '../combat/entityRules'
import { S, type FoldSchema } from '../foldCache/schema'
import { HoldGroup, type HoldGroupFoldState } from './buffRounds'
import { CastAnchors, type CastAnchorsFoldState } from './buffAnchors'
import { PetEntities, type PetEntitiesFoldState } from './buffsEntities'
import { SessionFrame, type SessionFrameFoldState } from './buffsSession'
import { SpellStats, type SpellStatsFoldState } from './buffsStats'
import { MessageOverlayMiner, type OverlayMinerFoldState } from '../data/messageOverlay'
import type { BuffInstances } from './buffsInstances'
import type { OpenCast, Pending } from './buffsShapes'

/** One open learning record as plain data — its `HoldGroup` flattened. */
export interface OpenCastFoldState {
  spell: string
  spellKey: string
  entityKey: string
  caster: string
  disp: EntityDisposition
  spannedGap?: boolean
  group: HoldGroupFoldState
}

/** The instance store as plain data: the cast in flight, the open records, the live rows. */
export interface BuffInstancesFoldState {
  pending?: Pending
  open: [string, OpenCastFoldState][]
  active: [string, ActiveBuff][]
}

/** The buffs model's complete event-derived state — all six collaborators, one blob. */
export interface BuffsFoldState {
  seq: number
  emoteTextCount: [string, number][]
  permanentIllusionOwnedTs?: number
  stats: SpellStatsFoldState
  pets: PetEntitiesFoldState
  inst: BuffInstancesFoldState
  anchors: CastAnchorsFoldState
  frame: SessionFrameFoldState
  miner: OverlayMinerFoldState
}

const DISPOSITION: FoldSchema = S.enum('self', 'summoned', 'charmed', 'hostile')

/**
 * ONE LIVE ROW, as the snapshot publishes it.
 *
 * Three of its numbers are `number | null` with the key ALWAYS PRESENT — the projection states
 * "the model has no estimate" as a null the UI renders, which is what the grammar's `nullable`
 * exists for. A restore that turned one of them into an absent key would be a real difference in
 * a real payload, and the differential law compares these objects field for field.
 */
const ACTIVE_ROW_SCHEMA: FoldSchema = S.obj({
  spell: S.str,
  cls: S.enum('buff', 'debuff'),
  self: S.bool,
  disposition: S.opt(DISPOSITION),
  startedTs: S.num,
  estimatedMs: S.nullable(S.num),
  p25: S.nullable(S.num),
  p75: S.nullable(S.num),
  n: S.num,
  target: S.opt(S.str),
  inferredTarget: S.opt(S.bool),
  durationSource: S.opt(S.enum('db', 'observed')),
  overlayDurationMs: S.opt(S.nullable(S.num)),
  overlaySource: S.opt(S.enum('db', 'observed')),
  permanent: S.opt(S.bool),
  messageDriven: S.opt(S.bool),
  count: S.opt(S.num),
  caster: S.opt(S.str),
  candidates: S.opt(S.arr(S.str))
})

/** The instance store's declaration — see `BuffInstances`'s seam note for what it leaves out. */
export const BUFF_INSTANCES_FOLD_SCHEMA: FoldSchema = S.obj({
  pending: S.opt(S.obj({ spell: S.str, key: S.str, beganTs: S.num, emoteSubjectKey: S.opt(S.str) })),
  open: S.arr(
    S.tuple(
      S.str,
      S.obj({
        spell: S.str,
        spellKey: S.str,
        entityKey: S.str,
        caster: S.str,
        disp: DISPOSITION,
        spannedGap: S.opt(S.bool),
        group: HoldGroup.FOLD_SCHEMA
      })
    )
  ),
  active: S.arr(S.tuple(S.str, ACTIVE_ROW_SCHEMA))
})

/** The buffs module's declaration — six collaborators, each declaring its own half. */
export const BUFFS_FOLD_SCHEMA: FoldSchema = S.obj({
  seq: S.num,
  /** Learned landing-emote TEXT counts — the Task #33 recognizer's whole memory. */
  emoteTextCount: S.arr(S.tuple(S.str, S.num)),
  permanentIllusionOwnedTs: S.opt(S.num),
  stats: SpellStats.FOLD_SCHEMA,
  pets: PetEntities.FOLD_SCHEMA,
  inst: BUFF_INSTANCES_FOLD_SCHEMA,
  anchors: CastAnchors.FOLD_SCHEMA,
  frame: SessionFrame.FOLD_SCHEMA,
  miner: MessageOverlayMiner.FOLD_SCHEMA
})

/** The open records, un-aliased and with each `HoldGroup` flattened. */
export function packOpen(open: ReadonlyMap<string, OpenCast>): [string, OpenCastFoldState][] {
  const out: [string, OpenCastFoldState][] = []
  for (const [ik, o] of open) {
    out.push([
      ik,
      {
        spell: o.spell,
        spellKey: o.spellKey,
        entityKey: o.entityKey,
        caster: o.caster,
        disp: o.disp,
        ...(o.spannedGap === undefined ? {} : { spannedGap: o.spannedGap }),
        group: o.group.serializeFold()
      }
    ])
  }
  return out
}

/**
 * The open records again, with each group rebuilt.
 *
 * `singleton` COMES FROM THE RECORD, never from the blob: `openRecord` decides it from the
 * disposition (an identity the model tracks vs a name the world hands out more than once) and the
 * same rule runs here, so the two can never disagree about what a re-landing means.
 */
export function unpackOpen(rows: readonly [string, OpenCastFoldState][]): Map<string, OpenCast> {
  return new Map(
    rows.map(([ik, o]) => [
      ik,
      {
        spell: o.spell,
        spellKey: o.spellKey,
        entityKey: o.entityKey,
        caster: o.caster,
        disp: o.disp,
        ...(o.spannedGap === undefined ? {} : { spannedGap: o.spannedGap }),
        group: HoldGroup.from(o.disp !== 'hostile', o.group)
      }
    ])
  )
}

/**
 * The live rows, copied VERBATIM — present-but-undefined keys (`disposition`, `target`) and nulls
 * alike, because these are the objects the snapshot publishes and the differential compares.
 */
export function packActive(active: ReadonlyMap<string, ActiveBuff>): [string, ActiveBuff][] {
  const out: [string, ActiveBuff][] = []
  for (const [ik, a] of active) {
    out.push([ik, { ...a, ...(a.candidates ? { candidates: [...a.candidates] } : {}) }])
  }
  return out
}

/** The instance store's whole fold state. Its three collections are public — see its seam note. */
export function packInstances(inst: BuffInstances): BuffInstancesFoldState {
  return {
    ...(inst.pending === null ? {} : { pending: { ...inst.pending } }),
    open: packOpen(inst.open),
    active: packActive(inst.active)
  }
}

/** …and back. Validation is the OWNER's: `BuffsModule` accepts or refuses the whole blob. */
export function unpackInstances(inst: BuffInstances, state: BuffInstancesFoldState): void {
  inst.pending = state.pending ? { ...state.pending } : null
  inst.open = unpackOpen(state.open)
  inst.active = new Map(state.active.map(([ik, a]) => [ik, { ...a }]))
  inst.dirty = false
}
