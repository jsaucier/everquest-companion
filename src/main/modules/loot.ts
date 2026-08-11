// loot module — the self-loot history. Wraps the pure loot fold from reducers.ts
// (a LootEvent tagged with the zone it happened in). Delta = the rows appended
// since the last flush; the renderer concats them.
//
// CHECKPOINTABLE (JOS-208, pilot 1 of 2 — src/main/foldCache/serialize.ts). This is the BULK-DATA
// shape: one append-only array of small flat records, hundreds of thousands of rows deep on a real
// log, and the reason the container carries V8 structured-clone blobs rather than JSON.

import type { EqModule } from './types'
import type { FoldCheckpointable } from '../foldCache/serialize'
import { S, validate, type FoldSchema } from '../foldCache/schema'
import type { LogEvent } from '../../shared/logEvents'
import type { LootDelta, LootEvent, LootSnap } from '../../shared/types'

/**
 * The loot module's complete event-derived state. Every field of it is folded from the log and
 * nothing in it came from the store or from a clock, so the two exclusion rules cost this module
 * nothing — which is exactly why it is the first pilot.
 */
export interface LootFoldState {
  loot: LootEvent[]
  /** The zone the fold was standing in. `undefined` before the first zone line — kept as absent. */
  zone?: string
  seq: number
}

/**
 * THE DECLARATION (JOS-208). The shape hash in a container header is derived from this, and
 * `deserializeFold` validates against it — so a stored field added below invalidates every
 * existing checkpoint with nobody having to remember, and a blob that does not match is refused by
 * the same statement that produced the hash.
 *
 * `LootEvent` is re-declared here rather than reflected off the TypeScript type, and that is the
 * point rather than a duplication: this is a statement about what is PERSISTED, which is allowed
 * to be a subset of what the wire type may one day carry, and it exists at runtime where a type
 * does not. `tests/foldPlainData.test.mts` folds a real fixture and holds the two together.
 */
const LOOT_ROW_SCHEMA: FoldSchema = S.obj({
  ts: S.num,
  item: S.str,
  source: S.opt(S.str),
  zone: S.opt(S.str),
  disposition: S.opt(S.enum('currency', 'sold', 'hoard', 'depot', 'combined')),
  count: S.opt(S.num),
  created: S.opt(S.str)
})

const LOOT_FOLD_SCHEMA: FoldSchema = S.obj({
  loot: S.arr(LOOT_ROW_SCHEMA),
  zone: S.opt(S.str),
  seq: S.num
})

export class LootModule implements EqModule<LootSnap, LootDelta>, FoldCheckpointable<LootFoldState> {
  readonly id = 'loot'
  private loot: LootEvent[] = []
  private zone: string | undefined
  private seq = 0
  private pending: LootEvent[] = []

  reset(): void {
    this.loot = []
    this.zone = undefined
    this.seq = 0
    this.pending = []
  }

  onEvent(ev: LogEvent): void {
    this.seq = ev.seq
    if (ev.kind === 'epoch') {
      // Character rebirth (Task #49): loot before the boundary is a dead same-name
      // character's. Clear the history so held-count / quest-progress derivation sees only
      // the current character. Keep `zone` (world state, not character-scoped — the next
      // zone line refreshes it regardless).
      this.loot = []
      this.pending = []
      return
    }
    if (ev.kind === 'zone') {
      this.zone = ev.zone
      return
    }
    if (ev.kind !== 'loot') return
    const row: LootEvent = {
      ts: ev.ts,
      item: ev.item,
      source: ev.source,
      zone: this.zone,
      disposition: ev.disposition,
      count: ev.count,
      created: ev.created
    }
    this.loot.push(row)
    this.pending.push(row)
  }

  snapshot(): { seq: number; state: LootSnap } {
    return { seq: this.seq, state: this.loot }
  }

  flushDelta(): { seq: number; delta: LootDelta } | null {
    if (this.pending.length === 0) return null
    const delta: LootDelta = { appended: this.pending }
    this.pending = []
    return { seq: this.seq, delta }
  }

  // ---- the checkpoint seam (JOS-208) ---------------------------------------------------------

  readonly foldSchema = LOOT_FOLD_SCHEMA

  /**
   * `pending` is NOT in here, and its absence is the design rather than an omission: a restored
   * fold has published nothing yet, so it owes the renderer no increment. The loader restores and
   * then the ordinary `log:character` re-hydrate serves the whole state from `snapshot()` — the
   * same path a cold replay takes out of `endReplay()`'s discard (registry.ts).
   *
   * The rows are copied shallowly so the container's blob cannot alias the live array; the rows
   * themselves are flat records that nothing mutates after append.
   */
  serializeFold(): LootFoldState {
    return {
      loot: [...this.loot],
      ...(this.zone === undefined ? {} : { zone: this.zone }),
      seq: this.seq
    }
  }

  deserializeFold(state: unknown): boolean {
    // ONE GATE, and it is the declaration itself: shape, types, optionality, no extra fields, and
    // no class instance wearing the right property names.
    if (!validate(LOOT_FOLD_SCHEMA, state).ok) return false
    const s = state as LootFoldState
    this.loot = s.loot
    this.zone = s.zone
    this.seq = s.seq
    this.pending = []
    return true
  }
}
