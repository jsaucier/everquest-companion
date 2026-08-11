// combo module — which THREE classes was this character running, and when did that change?
// docs/plans/class-combo-inference.md § 5.1. The EqModule shell only; the thinking lives in
// three PURE siblings (comboEvidence / comboScore / comboIntervals) that take plain arrays,
// which is what lets tests/comboWindows.test.mts golden-window this without Electron.
//
// WHY THE FEATURE EXISTS AT ALL. EQ Legends runs up to three classes at once, the displayed
// level is the MINIMUM of their levels, and a loadout swap is NEVER logged — verified twice on
// full-log sweeps. The character's own `/who` row states the loadout outright and there are
// ELEVEN of them in 1.1M lines, none within 33 hours of the swap this log actually contains.
// So the app either infers the combo and labels it inferred, or it says nothing at all.
//
// REGISTERED FIRST in pipeline.ts: within one bus delivery every later module (and the combat
// engine) then sees an already-advanced combo state for the same event. It consumes no derived
// events and emits none, so the order change is purely additive.
//
// RECOMPUTE-FROM-SCRATCH, NOT PATCH-IN-PLACE. A `/who` row typed now re-labels the past hour
// and a user correction re-labels an arbitrary span, so intervals are rebuilt from the retained
// observations whenever anything changes. Interval ids are therefore snapshot-scoped, which is
// exactly why the delta carries `removed` and why persisted corrections key on TIMESTAMPS
// (§ 5.4 / § 7).

import type { EqModule } from './types'
import { S, validate, type FoldSchema } from '../foldCache/schema'
import type { FoldCheckpointable } from '../foldCache/serialize'
import type { LogEvent } from '../../shared/logEvents'
import {
  CLASS_ABBRS,
  isClassAbbr,
  type ClassObservation,
  type ComboCorrection,
  type ComboDelta,
  type ComboInterval,
  type ComboSnap
} from '../../shared/classCombo'
import { LAUNCH_MS } from '../log/epochDetector'
import classesJson from '../data/classes.json'
import { classObservation } from './comboEvidence'
import { buildIntervals, type LevelPoint, type WhoRow } from './comboIntervals'

/**
 * Data availability, not health: `classes.json` ships as an empty STUB before the scrape runs
 * (the keep-the-tree-buildable rule), and an empty stance table would silently turn every
 * inference into an unknown slot. The UI shows "not ready" instead of a wall of dashes.
 */
const TABLES_READY = Object.keys(classesJson.stances).length > 0

const CLASS: FoldSchema = S.enum(...CLASS_ABBRS)

/**
 * THE CHECKPOINT DECLARATION (JOS-208 phase 2) — the THREE RETAINED OBSERVATION SERIES, and
 * nothing derived from them.
 *
 * `intervals` is deliberately absent even though it is what the snapshot publishes: this module
 * RECOMPUTES FROM SCRATCH (see the header — a `/who` typed now re-labels the past hour), so the
 * intervals are a pure function of the three series plus the corrections. Storing them would be a
 * second answer that a correction written while the app was closed could silently contradict.
 * `stale` is therefore restored as TRUE, which is the same state `reset()` leaves.
 *
 * `corrections` is STORE-DERIVED and excluded by the standing rule — they are the one piece of
 * combo state a replay cannot restate, which is exactly why they live in the store and are pulled
 * through a provider on every recompute.
 *
 * `rev` IS stored: it is the module's published seq (JOS-87's counter, see its field doc), and a
 * restore that reset it would make the first live delta look like a dupe of the hydration.
 */
const COMBO_FOLD_SCHEMA: FoldSchema = S.obj({
  observations: S.arr(
    S.obj({
      ts: S.num,
      seq: S.num,
      source: S.enum('who', 'stance', 'invocation', 'poisonCoat', 'skillUp', 'cast'),
      label: S.str,
      candidates: S.arr(CLASS),
      weight: S.num
    })
  ),
  whoRows: S.arr(S.obj({ ts: S.num, seq: S.num, classes: S.arr(CLASS), level: S.num })),
  levels: S.arr(S.obj({ ts: S.num, level: S.num })),
  rev: S.num
})

/** The combo module's complete event-derived state. */
export interface ComboFoldState {
  observations: ClassObservation[]
  whoRows: WhoRow[]
  levels: LevelPoint[]
  rev: number
}

export class ComboModule implements EqModule<ComboSnap, ComboDelta>, FoldCheckpointable<ComboFoldState> {
  readonly id = 'combo'

  private observations: ClassObservation[] = []
  private whoRows: WhoRow[] = []
  private levels: LevelPoint[] = []
  private corrections: ComboCorrection[] = []
  private correctionsProvider: (() => readonly ComboCorrection[]) | null = null

  /**
   * THE SEQ THIS MODULE REPORTS IS ITS OWN REVISION, NOT A LOG POSITION — and it has to be
   * (JOS-87, measured in the real app before it was fixed).
   *
   * `useModule` dedupes deltas with `if (d.seq <= knownSeq) return`, and `knownSeq` comes from
   * the hydration snapshot. Every other module's state moves only when an event moves it, so
   * "the last event's seq" is a perfectly good revision counter for them. THIS module has a
   * second input: a user correction, which changes every interval and advances no log seq at
   * all. So a correction written while the log is idle — which is exactly when a user is sitting
   * in Preferences fixing a wrong loadout — produced a delta the renderer dropped as a dupe. The
   * store had it, the model had it, and the screen kept showing the detection that was wrong
   * until the next log line happened to arrive. That is most of "there is no way to correct it".
   *
   * A counter bumped by anything that can change the intervals keeps hydrate and delta on ONE
   * clock and is monotonic by construction. It is never compared to a LogEvent seq anywhere —
   * the field's only consumer is that dedupe (verified repo-wide), which asks for nothing more
   * than "strictly increasing when the state changed".
   */
  private rev = 0

  private intervals: ComboInterval[] = []
  private stale = true
  /** What the renderer last saw, by id, so a delta carries only what actually moved. */
  private pushed = new Map<string, string>()

  reset(): void {
    this.observations = []
    this.whoRows = []
    this.levels = []
    this.intervals = []
    this.pushed.clear()
    this.markStale()
  }

  /**
   * Anything that can change what the intervals will be goes through here: a new observation, a
   * level ding, a character reset, a correction written or withdrawn. It marks the fold dirty AND
   * advances the revision the transport dedupes on, so the two can never disagree — a state
   * change the renderer is not told about is the defect this whole path was fixed for.
   */
  private markStale(): void {
    this.stale = true
    this.rev++
  }

  /**
   * Where persisted user corrections come from — installed once at IPC registration
   * (ipc/combo.ts) as `() => getComboCorrections(activeCharId())`.
   *
   * A PULL rather than a push, because corrections are CHARACTER-scoped and this module has no
   * business knowing which character is active: `reset()` runs on every character (re)load and
   * marks the state stale, so the next recompute simply asks again and gets the new
   * character's list. A push would need the module wired into the character-switch path.
   */
  setCorrectionsProvider(provider: () => readonly ComboCorrection[]): void {
    this.correctionsProvider = provider
    this.markStale()
  }

  /** Call after writing a correction: the provider's answer changed. */
  invalidate(): void {
    this.markStale()
  }

  /**
   * Install corrections directly. TEST SEAM — production installs a provider. Pre-launch
   * corrections are dropped here as well as in the store migration: they describe the BETA
   * character that was wiped at the 2026-07-28 launch and shares this log file, and a
   * correction is the one piece of combo state that outlives a replay.
   */
  setCorrections(corrections: readonly ComboCorrection[]): void {
    this.correctionsProvider = null
    this.corrections = corrections.filter((c) => c.startTs >= LAUNCH_MS)
    this.markStale()
  }

  getCorrections(): ComboCorrection[] {
    return [...this.corrections]
  }

  onEvent(ev: LogEvent): void {
    if (ev.kind === 'epoch') {
      // Character rebirth: every observation before the boundary belongs to a dead character
      // whose loadout has nothing to do with this one. NOTE what is deliberately NOT here — a
      // level-regression epoch trigger. A level drop is a LOADOUT SWAP, which is the entire
      // point of this module (epochDetector.ts says the same thing from the other side).
      const kept = this.corrections
      this.reset()
      this.corrections = kept.filter((c) => c.startTs >= LAUNCH_MS)
      return
    }
    if (ev.kind === 'level') {
      this.levels.push({ ts: ev.ts, level: ev.level })
      this.markStale()
      return
    }
    if (ev.kind === 'selfWho') {
      const classes = ev.classes.filter(isClassAbbr)
      if (classes.length > 0) this.whoRows.push({ ts: ev.ts, seq: ev.seq, classes, level: ev.level })
    }
    const observation = classObservation(ev)
    if (!observation) return
    this.observations.push(observation)
    this.markStale()
  }

  /** Rebuild the intervals if anything moved. Cheap enough to do on demand (~30k observations
   *  over the whole log) and correct by construction — see the header. */
  private current(): ComboInterval[] {
    if (!this.stale) return this.intervals
    if (this.correctionsProvider) {
      this.corrections = this.correctionsProvider().filter((c) => c.startTs >= LAUNCH_MS)
    }
    this.intervals = buildIntervals({
      observations: this.observations,
      whoRows: this.whoRows,
      levels: this.levels,
      corrections: this.corrections
    })
    this.stale = false
    return this.intervals
  }

  snapshot(): { seq: number; state: ComboSnap } {
    const intervals = this.current()
    // A snapshot IS the renderer's new baseline, so the delta bookkeeping resets with it —
    // otherwise the next flush would re-send intervals the hydration already carried.
    this.pushed = new Map(intervals.map((i) => [i.id, JSON.stringify(i)]))
    return {
      seq: this.rev,
      state: {
        intervals,
        current: intervals.length > 0 ? intervals[intervals.length - 1] : null,
        ready: TABLES_READY
      }
    }
  }

  flushDelta(): { seq: number; delta: ComboDelta } | null {
    const intervals = this.current()
    const changed: ComboInterval[] = []
    const next = new Map<string, string>()
    for (const interval of intervals) {
      const json = JSON.stringify(interval)
      next.set(interval.id, json)
      if (this.pushed.get(interval.id) !== json) changed.push(interval)
    }
    const removed = [...this.pushed.keys()].filter((id) => !next.has(id))
    if (changed.length === 0 && removed.length === 0) return null
    this.pushed = next
    return { seq: this.rev, delta: { changed, removed } }
  }

  // ---- the checkpoint seam (JOS-208) ---------------------------------------------------------

  readonly foldSchema = COMBO_FOLD_SCHEMA

  serializeFold(): ComboFoldState {
    return {
      observations: this.observations.map((o) => ({ ...o, candidates: [...o.candidates] })),
      whoRows: this.whoRows.map((w) => ({ ...w, classes: [...w.classes] })),
      levels: this.levels.map((l) => ({ ...l })),
      rev: this.rev
    }
  }

  deserializeFold(state: unknown): boolean {
    if (!validate(COMBO_FOLD_SCHEMA, state).ok) return false
    const s = state as ComboFoldState
    this.observations = s.observations
    this.whoRows = s.whoRows
    this.levels = s.levels
    this.rev = s.rev
    // STALE ON PURPOSE (see the declaration): the intervals are recomputed from the restored
    // series and the store's CURRENT corrections, so a correction written while the app was
    // closed lands on the restored fold exactly as it would on a cold one.
    this.intervals = []
    this.stale = true
    this.pushed.clear()
    return true
  }
}
