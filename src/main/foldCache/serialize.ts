// ============================================================================
// serialize.ts — THE MODULE SEAM: how a fold hands over its state, and takes it back (JOS-208).
// ============================================================================
//
// A module that implements this contract can be checkpointed. One that does not is folded from
// zero on every launch, which is what the whole app does today — so the seam is additive, and a
// module opts in by declaring a shape and implementing two methods.
//
// THE DECLARATION IS THE CENTRE OF IT (design revision, 2026-08-11). `foldSchema` is a data
// declaration of exactly what this module stores (schema.ts). From it comes the module's shape
// hash — the ENCODING half of invalidation, derived rather than bumped — and against it runs the
// load-time validation, which is also the plain-data proof. One declaration, three jobs, and no
// way for them to disagree.
//
// TWO RULES the declaration cannot enforce on its own, so they are stated here and pinned by the
// audits:
//
//   1. EVENT-DERIVED STATE ONLY — NEVER STORE-DERIVED (owner-ratified design). The respawn
//      module's watch list, the alerts module's defs, the combo module's corrections, the buff
//      trust list: all of those are the STORE's truth, they are injected at construction, and the
//      composition root re-injects them on every launch. A copy in the checkpoint would be a
//      second, older truth for the same fact — the exact shape that makes a stale answer possible.
//      One truth per fact. Each module states its exclusions at the line that drops them.
//
//   2. NO WALL CLOCK. Anything a module read from `Date.now()` is about the machine, not about the
//      log, and a restored fold is entitled to today's answer rather than to last Tuesday's. Those
//      fields are excluded and re-read on restore — the respawn module's `nowMs` is the example,
//      and it is what makes the go-live sweep behave identically after a restore and after a cold
//      replay.
//
// `deserializeFold` RETURNS A BOOLEAN AND NEVER THROWS. A module that does not recognize what it
// is handed says so, and the loader's answer to `false` is its answer to a corrupt digest: discard
// the WHOLE container and cold-replay. Invalidation is always whole-cache (a partial refold needs
// the same cold read that the whole thing does, so granularity would buy nothing but rarity), and
// that is what lets a module be as strict as it likes without weighing consequences.

import { shapeHash, type FoldSchema } from './schema'

export interface FoldCheckpointable<S = unknown> {
  /**
   * WHAT THIS MODULE STORES, as data. The shape hash in the container header is derived from it
   * (`moduleShapeHash`), and `deserializeFold` validates against it.
   */
  readonly foldSchema: FoldSchema
  /** The module's complete event-derived fold state, as plain data. See rules 1–2 above. */
  serializeFold(): S
  /** Adopt a previously serialized state. Returns false — never throws — if it refuses. */
  deserializeFold(state: unknown): boolean
}

/**
 * A CHECKPOINTED UNIT: anything with an id that can hand over its fold state.
 *
 * DELIBERATELY NOT `EqModule & FoldCheckpointable`, and the reason is a bug this repo's own
 * differential harness found on its first run (JOS-208). The registry's modules are not the whole
 * fold: the DERIVED-EVENT PRODUCERS — `EpochDetector` and `SessionDetector` — subscribe to the same
 * bus, carry their own state across events, and hand `epoch` / `offlineGap` back onto the stream.
 * Leave them out of a checkpoint and a fresh `EpochDetector` fires the launch boundary AGAIN at the
 * first event of the tail, which clears the respawn module's history and moves its revision — a
 * measured, reproducible divergence at every split point in every fixture.
 *
 * So the rule that replaces "every module" is: EVERYTHING WHOSE STATE AFFECTS A CHECKPOINTED FOLD
 * IS ITSELF CHECKPOINTED, whether or not it publishes a snapshot. What is still outside the
 * container (and therefore what phase 2 must bring in before those consumers can be trusted from a
 * checkpoint) is stated in `attach.ts` beside the unit list.
 */
export interface FoldUnit extends FoldCheckpointable {
  readonly id: string
}

/** Does this implement the seam? The one place the duck-type is written down. */
export function isCheckpointable(unit: { id: string }): unit is FoldUnit {
  const c = unit as Partial<FoldCheckpointable>
  return (
    typeof c.foldSchema === 'object' &&
    c.foldSchema !== null &&
    typeof c.serializeFold === 'function' &&
    typeof c.deserializeFold === 'function'
  )
}

/**
 * A unit's shape hash — always derived, never stored, never typed by hand.
 *
 * Cheap enough to call at every write and every read (it digests a few hundred bytes of canonical
 * text), which is the property that keeps it from needing to be cached anywhere it could go stale.
 */
export function moduleShapeHash(unit: FoldCheckpointable): string {
  return shapeHash(unit.foldSchema)
}

/**
 * EVERY MODULE WHOSE PUBLISHED SNAPSHOT THE DIFFERENTIAL COMPARES, by id and in registration
 * order (phase 2 — phase 1 shipped this as `PILOT_MODULE_IDS` holding `loot` and `respawn`).
 *
 * THIS LIST IS NOT DERIVED FROM THE REGISTRY, and that is the point of writing it out. If it were
 * `registry.list().filter(isCheckpointable)` then a module that quietly lost its seam would
 * quietly leave the comparison, and the harness would go green by asking less. Written down, a
 * module that stops being checkpointable fails `tests/foldCheckpointDifferential.test.mts` by
 * name — and a NEW module that never declares a shape fails the completeness test beside it,
 * which asserts this list against the registry's own.
 *
 * NOT THE SAME LIST AS "what the container carries" — see `FoldUnit`. The two derived-event
 * producers are checkpointed without publishing anything, because the modules' correctness
 * depends on them.
 */
export const CHECKPOINTED_MODULE_IDS: readonly string[] = [
  'combo',
  'roster',
  'loot',
  'turnins',
  'classUnlocks',
  'kills',
  'respawn',
  'progression',
  'leveling',
  'character',
  'outputFiles',
  'itemTiers',
  'alerts',
  'buffs',
  'buffTimers',
  'consider',
  'eventFeed'
]
