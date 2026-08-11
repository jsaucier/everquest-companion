// turnins module — completed NPC trades / quest turn-ins. Wraps the offer/trade
// pairing state from reducers.ts: offers accumulate per NPC until the matching
// "complete the trade" line closes the group. Delta = turn-ins appended.

import type { EqModule } from './types'
import { S, validate, type FoldSchema } from '../foldCache/schema'
import type { FoldCheckpointable } from '../foldCache/serialize'
import type { LogEvent } from '../../shared/logEvents'
import type { TurnInDelta, TurnInEvent, TurnInSnap } from '../../shared/types'

/**
 * THE CHECKPOINT DECLARATION (JOS-208 phase 2). `pendingOffer` is IN it: an offer group is a
 * half-formed turn-in the very next `trade` line closes, so a checkpoint written between the two
 * — which a split point routinely is — must carry it or the turn-in is lost that a cold replay
 * records. `null` becomes absent, the grammar's one way to say "no such fact".
 */
const TURNINS_FOLD_SCHEMA: FoldSchema = S.obj({
  turnIns: S.arr(S.obj({ ts: S.num, npc: S.str, items: S.arr(S.str) })),
  pendingOffer: S.opt(S.obj({ npc: S.str, items: S.arr(S.str) })),
  seq: S.num
})

/** The turn-in module's complete event-derived state. */
export interface TurnInsFoldState {
  turnIns: TurnInEvent[]
  pendingOffer?: { npc: string; items: string[] }
  seq: number
}

export class TurnInsModule implements EqModule<TurnInSnap, TurnInDelta>, FoldCheckpointable<TurnInsFoldState> {
  readonly id = 'turnins'
  private turnIns: TurnInEvent[] = []
  private pendingOffer: { npc: string; items: string[] } | null = null
  private seq = 0
  private pending: TurnInEvent[] = []

  reset(): void {
    this.turnIns = []
    this.pendingOffer = null
    this.seq = 0
    this.pending = []
  }

  onEvent(ev: LogEvent): void {
    this.seq = ev.seq
    if (ev.kind === 'epoch') {
      // Character rebirth (Task #49): turn-ins before the boundary are a dead same-name
      // character's. Clear them so Plane-of-Sky quest AUTO-completion (which re-derives from
      // this module) reflects only the current character. Drop any half-formed offer group.
      this.turnIns = []
      this.pendingOffer = null
      this.pending = []
      return
    }
    if (ev.kind === 'offer') {
      if (this.pendingOffer?.npc === ev.npc) this.pendingOffer.items.push(ev.item)
      else this.pendingOffer = { npc: ev.npc, items: [ev.item] }
      return
    }
    if (ev.kind === 'trade') {
      if (this.pendingOffer?.npc === ev.npc) {
        const t: TurnInEvent = { ts: ev.ts, npc: ev.npc, items: this.pendingOffer.items }
        this.turnIns.push(t)
        this.pending.push(t)
      }
      this.pendingOffer = null
    }
  }

  snapshot(): { seq: number; state: TurnInSnap } {
    return { seq: this.seq, state: this.turnIns }
  }

  flushDelta(): { seq: number; delta: TurnInDelta } | null {
    if (this.pending.length === 0) return null
    const delta: TurnInDelta = { appended: this.pending }
    this.pending = []
    return { seq: this.seq, delta }
  }

  // ---- the checkpoint seam (JOS-208) ---------------------------------------------------------

  readonly foldSchema = TURNINS_FOLD_SCHEMA

  serializeFold(): TurnInsFoldState {
    return {
      // The rows are copied shallowly with their item lists, because a `pendingOffer`'s array is
      // handed STRAIGHT to the TurnInEvent it closes (`items: this.pendingOffer.items`) and is
      // pushed into by later offers — so an uncopied blob would alias a growing array.
      turnIns: this.turnIns.map((t) => ({ ...t, items: [...t.items] })),
      ...(this.pendingOffer === null
        ? {}
        : { pendingOffer: { npc: this.pendingOffer.npc, items: [...this.pendingOffer.items] } }),
      seq: this.seq
    }
  }

  deserializeFold(state: unknown): boolean {
    if (!validate(TURNINS_FOLD_SCHEMA, state).ok) return false
    const s = state as TurnInsFoldState
    this.turnIns = s.turnIns
    this.pendingOffer = s.pendingOffer ?? null
    this.seq = s.seq
    this.pending = []
    return true
  }
}
