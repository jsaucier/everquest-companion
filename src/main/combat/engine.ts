// The combat engine: a formal state machine over the log stream.
//
// State it maintains (see state.ts — EngineState):
//   petNames: Set<name>           — names of your ACTIVE pets, charmed OR summoned
//                                   (name-keyed). This is purely an ATTRIBUTION set —
//                                   it is NOT a charm roster. The world model owns the
//                                   charmed/summoned distinction (Instance.petKind).
//   zone:     string              — current zone (resets the overall aggregate)
//   current:  Encounter | null    — the in-progress/most-recent fight
//   history:  Encounter[]         — finalized fights
//   zoneAgg:  Agg                 — damage aggregated for the whole zone
//
// Transitions (one per ingested line — see ingest.ts):
//   zone     → finalize current, reset zoneAgg
//   charm    → petNames.add(mob) ONLY when charmModel.ts says the broadcast resolved one of
//              YOUR OWN casts. `<mob> has been charmed.` is a caster-less BROADCAST the whole
//              zone sees (it is the spell DB's msg_cast_on_other), so an unarmed one is
//              another player's pet and is dropped.
//   petClaim → petNames.add(name) (`<Name> told you, '… Master.'` — the ONLY binding
//              signal for a random-named SUMMONED class pet; charmed mobs send it too, and
//              it PROMOTES a name we saw charmed but declined to bind)
//   uncharm/death(charm spell/mob death) → petNames.delete(mob)
//   cc     → mark the mob's instance engaged + CC-held (mez/root keep-alive) — same ownership
//            gate: a foreign mez broadcast is inert.
//   damage → route to current encounter + zoneAgg (see routing.ts route())
//
// Attribution rule (damage `A → B` for N) — routing.ts classify():
//   A = You            → your outgoing
//   A ∈ petNames       → your pet's outgoing (unless B is friendly)
//   B = You            → incoming
//   otherwise          → not your fight (ignored)
//
// Encounter segmentation (Task #20 — death-closed, replacing the old idle-gap
// rule; the rules and their tuning constants live in encounter.ts, the evaluation in
// lifecycle.ts evalClosure). A fight CLOSES when either:
//   - every engaged hostile instance is GONE (retired = dead/zoned; or still alive but
//     with no PRESENCE evidence for PRESENCE_GONE_MS) AND LINGER_MS passes with no new
//     attributed damage → crisp pull boundaries from the death timeline. A multi-mob
//     pull is therefore ONE encounter: killing one add cannot close it while another is
//     demonstrably still swinging/casting/being healed (Task #55).
//   - OR no attributed damage AND no CC event for FALLBACK_IDLE_MS (fled/deagro).
// A CC (mez/root) application or refresh HOLDS the encounter open regardless of
// damage gaps while the CC'd instance is alive (the mez-and-wait case). Pet swap
// (uncharm/charm) is NOT a boundary event. Closure is time-driven, so it's evaluated
// both on the next ingested event and in snapshot(now) — finalization always stamps
// the encounter's own lastTs (a damage ts), never the eval moment. DPS uses
// (lastHit − firstHit), so it freezes when a fight ends. Each encounter also tracks
// activeMs (Σ capped gaps between hits) for an active-time DPS stat.
//
// Seeding: the engine is fed the entire log on load (recording=false) so charm
// and encounter state reflect reality before the live tail (recording=true)
// takes over — this is why a pet charmed before the app opened is still tracked.
//
// THIS FILE is the public face of all of that: one `CombatEngine` object owning one
// EngineState, plus snapshot assembly. Everything else is a module beside it —
// aggregate.ts (accumulators), encounter.ts (record types + constants), state.ts,
// ingest.ts (the switch), routing.ts / procRouting.ts (where a line lands),
// lifecycle.ts (when a segment opens/closes), sourceViews.ts + segmentViews.ts
// (serialization), healing.ts, fightSearch.ts, world.ts, taxonomy.ts.

import { EngineState } from './state'
import { ingestEvent } from './ingest'
import type { EngineFoldProbe } from './foldProbe'
import { encSummary, evalClosure, zoneSessionSummaries, zoneSummary } from './lifecycle'
import { buildSelected, buildTimeline } from './segmentViews'
import { searchFights } from './fightSearch'
import { ACTIVE_MS, SLOW_SAMPLE_CAP } from './encounter'
import type { LogEvent } from '../../shared/logEvents'
import type { RosterSnap, RosterView } from '../../shared/roster'
import type { ComboInterval } from '../../shared/classCombo'
import type {
  BladeCoatState,
  CombatSnapshot,
  CurrentTarget,
  FightSearchResult,
  SegmentSummary,
  SlowRollup,
  SnapshotOpts,
  StanceState
} from '../../shared/combat'

export { classify } from './routing'
export type { Attribution } from './routing'

/**
 * The finalized fight summaries a snapshot serializes. Only the current encounter is
 * recomputed per call; finalized fight summaries are memoized (immutable). The window is
 * capped to `maxSegments` newest-first — the current encounter is always included
 * regardless of the cap, and the zone summary is appended by the caller.
 */
function collectSegments(st: EngineState, now: number, maxSegments: number): SegmentSummary[] {
  const segments: SegmentSummary[] = []
  if (st.current) segments.push(encSummary(st.current, 'current', now))
  const startIdx = st.history.length - 1
  const stopIdx = Math.max(0, st.history.length - maxSegments)
  for (let i = startIdx; i >= stopIdx; i--) {
    const e = st.history[i]
    segments.push(e.summary ?? encSummary(e, 'fight', now))
  }
  return segments
}

/**
 * DEFAULT selection = the FIGHT scope's head row: the open fight if there is one, else the
 * most recent finalized fight. Fight and Overall are an explicit user-chosen SCOPE now, so
 * this must never wander into the zone aggregate — a meter that swapped to zone-overall
 * between pulls is exactly what the user rejected. Overall is reached by ASKING for a zone
 * session id ('zone' / 'zs<n>'), never by default. With no fights at all the default
 * resolves to nothing (`selected: null`) and the UI shows a quiet "no fights yet" — the
 * renderer labels a finished head row honestly ("Last fight — X"), so nothing here has to
 * pretend a closed encounter is live.
 *
 * An explicit request is validated against ALL encounters, not just the capped segment
 * window — a selected finalized fight outside the cap is still fully resolvable via
 * buildSelected() (it searches history directly).
 */
function resolveSelectedId(st: EngineState, opts: SnapshotOpts): string {
  const defaultId = st.current?.id ?? st.history[st.history.length - 1]?.id ?? ''
  const selectableId =
    opts.selectedId === 'zone' ||
    st.current?.id === opts.selectedId ||
    st.history.some((h) => h.id === opts.selectedId) ||
    st.zoneHistory.some((z) => z.id === opts.selectedId)
  const explicitId = opts.selectedId && selectableId ? opts.selectedId : undefined
  return explicitId ?? defaultId
}

/** The live stance/invocation pair, as the snapshot carries it. */
function stanceState(st: EngineState): StanceState {
  return {
    stance: st.stance?.name,
    stanceTs: st.stance?.ts,
    invocation: st.invocation?.name,
    invocationTs: st.invocation?.ts
  }
}

export class CombatEngine {
  private st = new EngineState()

  /** Enable classification logging (after the historical scan, for the live tail), and
   *  flip HYDRATION off — from here on every snapshot describes the real present. */
  setLive(): void {
    this.st.setLive()
  }

  /**
   * Display names of your GENUINELY-CHARMED live pets (mobs bound by a
   * `<mob> has been charmed.` line). SUMMONED class pets are deliberately excluded —
   * they are pets, not charms. Deliberately NOT in the snapshot: no UI needs a charm
   * roster today, and the old snapshot field lied (it was the attribution set). This is
   * the ONLY correct door for one; never reconstruct it from petNames.
   */
  charmedPetNames(): string[] {
    return this.st.charmedPetNames()
  }

  /** Display names of ALL your live pets — charmed AND summoned. This is what the DPS
   *  meter attributes to (both kinds produce `kind: 'pet'` source rows). */
  petDisplayNames(): string[] {
    return this.st.petDisplayNames()
  }

  /**
   * Display names of the live ALLY pets — SOMEBODY ELSE'S charm pets (JOS-250, allyCharms.ts).
   *
   * Deliberately its own door beside the two above, and deliberately not in the snapshot either:
   * an ally pet is not in `petNames`, not in the world model's pet set and not a pet of yours in
   * any sense the meter's attribution recognises. The rows it earns reach the UI as ordinary
   * `kind: 'allyPet'` sources; this accessor exists so a test can ask the model directly.
   */
  allyPetNames(): string[] {
    return this.st.allyPetNames()
  }

  /**
   * The mob in front of you (law 6, LIVE half). Undefined when no encounter is open or when
   * the open encounter has not yet landed an outgoing hit — never a guess, never the largest
   * target (that is the FINALIZED naming rule and would relabel a live pull retroactively).
   *
   * READ-ONLY, and deliberately does NOT evaluate closure: snapshot() has already done that
   * before it calls this, so a fight that just closed on elapsed time reports nothing.
   */
  currentTarget(): CurrentTarget | undefined {
    const e = this.st.current
    if (!e?.lastOutTarget) return undefined
    return { name: e.lastOutTarget, others: Math.max(0, e.agg.targets.size - 1), lastTs: e.lastTs }
  }

  /**
   * Inject the player's own character name (from index.ts's tail ref). This is the
   * authoritative source: called before the scan replay and again on a character
   * switch after reset(). Keyed canonically so it matches the idKey() the heal path
   * uses. Wins over any heal-line-learned name.
   */
  setPlayerName(name: string): void {
    this.st.setPlayerName(name)
  }

  /**
   * Install the GROUP ROSTER pull (docs/plans/group-model.md). pipeline.ts wires this to the
   * roster module before the engine subscribes to the bus, so the roster is always advanced for
   * the line the engine is folding. Absent — every test, and any future embedding — the engine
   * behaves exactly as it did before the group model existed.
   */
  setRoster(access: { view: () => RosterView; snap: () => RosterSnap }): void {
    this.st.rosterProvider = () => access.view()
    this.st.rosterSnapProvider = () => access.snap()
  }

  /**
   * Install the CLASS-COMBO pull (JOS-305, combat/coatClass.ts). pipeline.ts wires this to the
   * combo module, which is registered FIRST on the bus — so within one delivery the combo state
   * has already advanced for the line the engine is about to fold, exactly as the roster seam
   * above relies on.
   *
   * Its ONE consumer is the blade-coat clear: a character who is no longer a rogue has no poison
   * on their blades, and the log never says so. Absent — every test, and any future embedding —
   * the engine behaves exactly as it did before the seam existed, and the coats are cleared only
   * by a dry line, a death or a rebirth.
   */
  setCombo(access: { currentInterval: () => ComboInterval | null }): void {
    this.st.comboProvider = () => access.currentInterval()
  }

  /**
   * THE BENCH'S SUB-ATTRIBUTION SEAM (JOS-59 — see combat/foldProbe.ts for the whole rationale).
   * A PARAMETER, exactly like `ModuleRegistry.attach(bus, timer)`: `tests/bench/foldArm.mts` is
   * the only caller in the tree, there is no environment variable, and with no probe attached
   * every instrumented site is one field read and one untaken branch.
   */
  attachFoldProbe(probe: EngineFoldProbe): void {
    this.st.probe = probe
    this.st.world.probe = probe
  }

  reset(): void {
    this.st.reset()
  }

  /**
   * Fold one canonical LogEvent into the state machine (ingest.ts). `live` drives the
   * classification ring (recording): historical replay events mutate state silently;
   * live events are also ring-logged.
   */
  ingestEvent(ev: LogEvent, live: boolean): void {
    ingestEvent(this.st, ev, live)
  }

  snapshot(now: number, opts: SnapshotOpts = {}): CombatSnapshot {
    // Encounters can close purely from elapsed time (death-linger / fallback). A
    // snapshot may be the first observation after that threshold, so evaluate the
    // deferred closure here (stamped at the encounter's own lastTs, not `now`).
    // An uncorroborated charm bind expires on the same wall clock (Task #65).
    //
    // …BUT NOT WHILE THE HISTORICAL FOLD IS STILL RUNNING (JOS-208 phase 4). A REPLAY IS NOT A
    // MOMENT IN TIME. `now` is the wall clock, every line in a months-old log is hours or weeks
    // behind it, and the replay YIELDS to the event loop every slice — so a renderer poll landing
    // between two slices used to finalize whatever fight was open and hand the rest of that fight
    // to a fresh encounter. MEASURED, by the e2e restart-compare the moment the engine joined the
    // container: one 53,577-damage fight in `e2e-combat.log` split into 43,504 + 10,073 under
    // load, and the shadow verifier reported it as a real divergence. It is a PRE-EXISTING defect
    // — a sliced replay has always been pollable, so a busy machine has always been able to saw a
    // fight in half on a clock that has nothing to do with the log — and it was invisible while
    // every launch folded the whole log the same way. A checkpoint makes it visible because the
    // two arms then fold the SAME bytes in two different numbers of passes.
    //
    // Closure from the LOG's own clock is untouched: `ingestEvent` evaluates it per event, so a
    // fight that really ended still ends, at the instant the log says. What this removes is the
    // machine's opinion about a fold that has not finished reading. `st.hydrating` is exactly the
    // right question — true from `reset()` until `setLive()`, which `session.ts` calls the moment
    // the scan hands over to the tail — and the snapshot already carries it so the UI renders a
    // loading state rather than a churning fake-live meter.
    if (!this.st.hydrating) {
      this.st.sweepCharm(now)
      // …and the ally binds on the same clock and for the same reason (JOS-250): a charm cannot
      // outlive its own spell, and the deadline must be observed by whichever of the two readers
      // reaches it first.
      this.st.sweepAlly(now)
      // …and the pet nudge (JOS-258), which is a pure display timer: the log can go quiet for a
      // minute at a time and a sentence on the screen must still come off it when it said it would.
      this.st.petNudge.sweep(now)
      evalClosure(this.st, now)
    }
    const st = this.st
    const maxSegments = opts.maxSegments ?? 100
    const inCombat = !!st.current && now - st.current.lastTs < ACTIVE_MS

    const segments = collectSegments(st, now, maxSegments)
    segments.push(zoneSummary(st))

    const selectedId = resolveSelectedId(st, opts)
    const selected = buildSelected(st, selectedId, now)

    const recent = (opts.showUnparsed ? st.recent : st.recent.filter((r) => r.cat !== 'unparsed')).slice(-150)
    const timeline = opts.timeline ? buildTimeline(st, selectedId, now) : undefined
    return {
      selectedId, selected, segments, inCombat, zone: st.zone,
      recent, stance: stanceState(st), timeline,
      // AFTER evalClosure() above: a fight that just closed on elapsed time reports nothing.
      currentTarget: this.currentTarget(),
      poison: { coat: this.coatState(), slow: this.slowRollup() },
      zoneSessions: zoneSessionSummaries(st),
      hydrating: st.hydrating,
      // THE GROUP ROSTER rides the combat snapshot rather than the module transport, even
      // though the roster IS a module (docs/plans/group-model.md §3). Two surfaces filter by it
      // — the Combat tab and every meter overlay — and the overlay windows already poll this
      // snapshot; teaching the module transport to reach them as well would be a second path to
      // the same five names, and two paths can disagree. The scope chip's label and the rows it
      // filters are then guaranteed to describe one roster, read in one call.
      roster: st.rosterSnap(),
      // THE PET NUDGE (JOS-258) — undefined in every state but the one, which is what keeps the
      // "no persistent banner" promise structural. It reads the SAME `now` the sweep above just
      // used, so a nudge can never survive the poll that expired it.
      petNudge: st.petNudge.view(now)
    }
  }

  /** The live blade-coat pair, copied out so a consumer can't mutate engine state. */
  private coatState(): BladeCoatState {
    return {
      utility: this.st.coatUtility ? { ...this.st.coatUtility } : undefined,
      combat: this.st.coatCombat.map((c) => ({ ...c }))
    }
  }

  /**
   * The rolling time-to-slow rollup (Task #64). Statistics are computed over the LANDED
   * samples ONLY; the nulls are surfaced as `noLand` so the reader sees both halves. With no
   * landed samples every statistic is absent rather than 0 — "0 ms to slow" would be a lie
   * about a thing that never happened.
   */
  private slowRollup(): SlowRollup {
    const landed = this.st.slowSamples.filter((s): s is number => s !== null).sort((a, b) => a - b)
    const pulls = this.st.slowSamples.length
    const base: SlowRollup = {
      pulls,
      landed: landed.length,
      noLand: pulls - landed.length,
      window: SLOW_SAMPLE_CAP
    }
    if (landed.length === 0) return base
    const sum = landed.reduce((a, b) => a + b, 0)
    const mid = landed.length >> 1
    return {
      ...base,
      avgMs: Math.round(sum / landed.length),
      medianMs: landed.length % 2 ? landed[mid] : Math.round((landed[mid - 1] + landed[mid]) / 2),
      minMs: landed[0],
      maxMs: landed[landed.length - 1]
    }
  }

  /**
   * SEARCH THE WHOLE FIGHT HISTORY (Task #61) — "it should go back for all time and be fast
   * and somewhat fuzzy" (the user).
   *
   * "All time" needs no new storage: `history` is UNCAPPED (only the per-encounter timeline
   * RINGS are capped, at TIMELINE_HISTORY_CAP, and zone sessions at ZONE_HISTORY_CAP), and
   * every finalized encounter already carries a memoized SegmentSummary. So this walks the
   * ENTIRE history — deliberately NOT the `maxSegments` window snapshot() serializes, which
   * is a payload cap, not a retention one — plus the live fight (as `kind: 'current'`, so an
   * open pull is findable by the mob you are presently swinging at).
   *
   * Newest-first, because the pure scorer breaks score ties by recency and a stable input
   * order keeps that deterministic. The scoring itself lives in the MUI/electron-free
   * fightSearch.ts; this method is only the corpus.
   *
   * READ-ONLY: no closure evaluation, no memoization side effects, nothing mutated — typing
   * in a search box must never be able to finalize a fight or move a point of damage.
   */
  searchFights(text: string, limit?: number, now: number = Date.now()): FightSearchResult {
    const summaries: SegmentSummary[] = []
    if (this.st.current) summaries.push(encSummary(this.st.current, 'current', now))
    for (let i = this.st.history.length - 1; i >= 0; i--) {
      const e = this.st.history[i]
      // `summary` is always populated by finalizeCurrent(); the fallback keeps this total
      // even if a future path ever pushes an encounter without memoizing one.
      summaries.push(e.summary ?? encSummary(e, 'fight', now))
    }
    return searchFights(summaries, text, limit)
  }
}
