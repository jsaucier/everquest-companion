/**
 * perfProfileSteps.mts — the FILE half of the Performance spec: everything asserted about
 * <userData>/perf-startup.json once the app that wrote it has exited.
 *
 * SPLIT OUT of tests/e2e/perf.e2e.mts when JOS-57's scope addition (the stutter probe and the
 * cold-read delta) pushed that file past the repo's 400-code-line ceiling — a split, not a widened
 * threshold, and along a seam the spec already had: what stays there DRIVES A WINDOW, what lives
 * here READS A FILE. tests/e2e/buffRestartSteps.mts is the precedent for a spec's steps living in
 * a module beside it.
 *
 * IDENTITIES ONLY, never today's numbers: a launch is asserted to have STATED its measurements and
 * to have stated them consistently. How blocked, or how stuttery, one machine got is the bench's
 * question (npm run bench:replay) against a known log on one machine — never a spec's.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { check } from './appHarness.mjs'
import { PERF_LAG_PROBE_INTERVAL_MS, STARTUP_STUTTER_INTERVAL_MS } from '../../src/shared/perf'

/**
 * The strictly-sequential head of the boot, asserted as a LIST: a profile whose phases arrived
 * in a different order would still be "monotonic" by timestamp alone, so the order is checked
 * as well as the timestamps.
 */
const SEQUENTIAL_PHASES = [
  'storeLoaded',
  'dataLoaded',
  'appReady',
  'protocols',
  'windowCreated',
  'tailAttached'
]
/** …and the tail, which RACES: the window paints while the historical scan is still folding, so
 *  either of these can land first depending on how much log there is. */
const CONCURRENT_PHASES = ['replayDone', 'rendererHydrated']

interface Phase {
  phase: string
  atMs: number
  durationMs: number
}
interface BlockStats {
  samples: number
  maxBlockMs: number
  blocksOver50Ms: number
}
/** What the duty-cycled replay spent, as the profile states it (JOS-50). */
interface ReplayStats {
  slices: number
  workMs: number
  restMs: number
}
/** The system-stutter proxy's own answer (JOS-57 scope addition), in milliseconds. */
interface StutterStats {
  samples: number
  p50Ms: number
  p95Ms: number
  maxMs: number
  lateTicks: number
  latePct: number
}
interface Profile {
  startedAt: number
  version: string
  phases: Phase[]
  totalMs: number
  eventsReplayed?: number
  block?: BlockStats
  replay?: ReplayStats
  stutter?: StutterStats
  newBytes?: number
  firstMbMs?: number
  complete: boolean
}
/** THE FILE. Written on every launch, HUD or no HUD — this is the "the launch you wish you had
 *  profiled is the one that already happened" promise, asserted against real bytes. */
export function stepProfileFile(userData: string, firstRun: boolean): void {
  const path = join(userData, 'perf-startup.json')
  let profile: Profile | null = null
  try {
    profile = JSON.parse(readFileSync(path, 'utf8')) as Profile
  } catch (err) {
    check('every launch writes <userData>/perf-startup.json', false, String(err))
    return
  }
  if (!check('every launch writes <userData>/perf-startup.json', profile.phases.length > 0)) return

  const names = profile.phases.map((p) => p.phase)
  check(
    'it records the sequential half of the boot, in order',
    JSON.stringify(names.slice(0, SEQUENTIAL_PHASES.length)) === JSON.stringify(SEQUENTIAL_PHASES),
    names.join(' → ')
  )
  check(
    '…and both of the phases that race, in whichever order this launch produced',
    [...names.slice(SEQUENTIAL_PHASES.length)].sort().join(',') === [...CONCURRENT_PHASES].sort().join(','),
    names.slice(SEQUENTIAL_PHASES.length).join(' → ')
  )
  const marks = profile.phases.map((p) => p.atMs)
  check(
    'the phase marks are MONOTONIC — no phase lands before the one it follows',
    marks.every((at, i) => i === 0 || at >= (marks[i - 1] ?? 0)),
    marks.map((m) => Math.round(m)).join(', ')
  )
  const summed = profile.phases.reduce((n, p) => n + p.durationMs, 0)
  check(
    'the durations account for the whole launch, exactly (nothing is NaN or negative)',
    profile.phases.every((p) => Number.isFinite(p.durationMs) && p.durationMs >= 0) &&
      Math.abs(summed - profile.totalMs) < 1,
    `Σ ${String(Math.round(summed))}ms vs total ${String(Math.round(profile.totalMs))}ms`
  )
  check('…and states the launch it describes', profile.complete && profile.startedAt > 0, JSON.stringify({ complete: profile.complete, startedAt: profile.startedAt }))
  check(
    'the replay states how many events it folded, beside how long it took',
    typeof profile.eventsReplayed === 'number' && profile.eventsReplayed >= 0,
    `${String(profile.eventsReplayed)} events`
  )
  stepBlockProbe(profile.block, profile.phases.find((p) => p.phase === 'replayDone')?.durationMs ?? 0)
  stepReplayDuty(profile.replay, replayWindowMs(profile))
  stepStutterProbe(profile.stutter, replayWindowMs(profile))
  stepColdRead(profile, firstRun)
}

/**
 * THE SYSTEM-STUTTER PROXY (JOS-57 scope addition), asserted exactly as its two neighbours are: as
 * IDENTITIES about a file a real launch wrote, never as this machine's numbers. Whether a computer
 * stutters is what the FLEET is being asked; what a spec can pin is that the launch measured its
 * own clock and that what it wrote about it is internally consistent.
 */
function stepStutterProbe(stutter: StutterStats | undefined, replayMs: number): void {
  // Same honesty rule the block probe follows: a per-spec fixture folds in milliseconds, and a
  // window that held no ticks must report NOTHING rather than a distribution of zeroes.
  if (replayMs < STARTUP_STUTTER_INTERVAL_MS) {
    check(
      'a replay shorter than one heartbeat states NO drift figures rather than inventing them',
      stutter === undefined || stutter.samples === 0,
      `replay ${String(Math.round(replayMs))}ms < ${String(STARTUP_STUTTER_INTERVAL_MS)}ms beat`
    )
    return
  }
  const ok = check(
    'the launch states what its own clock did while it read — the always-on stutter probe',
    stutter !== undefined && stutter.samples > 0,
    stutter ? `${String(stutter.samples)} heartbeat ticks` : 'absent'
  )
  if (!ok || !stutter) return
  check(
    '…as an ordered distribution: p50 ≤ p95 ≤ the worst tick, none of them negative',
    stutter.p50Ms >= 0 && stutter.p50Ms <= stutter.p95Ms && stutter.p95Ms <= stutter.maxMs,
    `p50 ${String(stutter.p50Ms)}ms · p95 ${String(stutter.p95Ms)}ms · max ${String(stutter.maxMs)}ms`
  )
  check(
    '…and the late-tick rate is the count it came from, never a number beside it',
    stutter.lateTicks >= 0 &&
      stutter.lateTicks <= stutter.samples &&
      Math.abs(stutter.latePct - Math.round((stutter.lateTicks / stutter.samples) * 100)) < 1,
    `${String(stutter.lateTicks)}/${String(stutter.samples)} = ${String(stutter.latePct)}%`
  )
}

/**
 * THE COLD-READ HALF (JOS-57 scope addition) — and the assertion that matters is about the FIRST
 * launch, which is the one case a fleet reading could most easily fake.
 *
 * A fresh userData has no mark from a previous clean shutdown, so "how many bytes were new" has no
 * answer, and the profile must say nothing rather than 0. A SECOND launch against the same
 * userData is the other half of the loop and is asserted by the caller re-running this spec's
 * launch — see `main()`.
 */
function stepColdRead(profile: Profile, firstRun: boolean): void {
  if (firstRun) {
    check(
      'a first run reports NO cold-read delta — there is no previous clean exit to measure from',
      profile.newBytes === undefined,
      `newBytes ${String(profile.newBytes)}`
    )
  } else {
    check(
      'the SECOND launch reports one, because the first one left a mark on its way out',
      typeof profile.newBytes === 'number' && profile.newBytes >= 0,
      `newBytes ${String(profile.newBytes)}`
    )
  }
  // The cold-disk hint is only asked of a log at least a megabyte long, so its ABSENCE is correct
  // on a fixture and only its sanity can be pinned here.
  check(
    'the first-megabyte hint is a duration when it is there at all, never a negative or a NaN',
    profile.firstMbMs === undefined || (Number.isFinite(profile.firstMbMs) && profile.firstMbMs >= 0),
    `firstMbMs ${String(profile.firstMbMs)}`
  )
}

/**
 * How long the replay ACTUALLY ran: `replayDone` minus `tailAttached`, both absolute marks.
 *
 * NOT `replayDone.durationMs`, which is the gap to whatever mark PRECEDED it — and `replayDone`
 * races `rendererHydrated` (see CONCURRENT_PHASES). When the renderer wins that race the replay's
 * duration column is the sliver between the two, not the replay. MEASURED the hard way: the first
 * version of the check below used `durationMs`, passed solo, and failed under a full parallel run
 * as `93ms folding + 67ms resting ≤ 16ms replay` — the load reordered the race, and the assertion
 * had been reading a number that only looks like the one it wanted.
 */
function replayWindowMs(profile: Profile): number {
  const at = (phase: string): number => profile.phases.find((p) => p.phase === phase)?.atMs ?? 0
  return Math.max(0, at('replayDone') - at('tailAttached'))
}

/**
 * THE DUTY LEDGER (JOS-50), asserted the same way and for the same reason as the block probe: as
 * IDENTITIES about a file a real launch wrote, never as this machine's numbers.
 *
 * What a spec can honestly claim here is that the launch STATED its duty and that the statement is
 * internally consistent — work and rest are non-negative, they fit inside the phase they describe,
 * and a fold that yielded at all did not somehow rest a negative amount. Whether 60% was actually
 * held on a 100 MB log is the bench's budget, on one machine, against a known input.
 */
function stepReplayDuty(replay: ReplayStats | undefined, windowMs: number): void {
  const ok = check(
    'the launch states how the replay split its time between folding and resting',
    replay !== undefined,
    replay ? `${String(replay.slices)} slices` : 'absent'
  )
  if (!ok || !replay) return
  const sane =
    Number.isFinite(replay.workMs) &&
    Number.isFinite(replay.restMs) &&
    replay.workMs >= 0 &&
    replay.restMs >= 0 &&
    Number.isInteger(replay.slices) &&
    replay.slices >= 0
  check(
    '…and the two of them fit inside the window they describe (nothing invented, nothing negative)',
    // +1 ms of slack: the marks are rounded to a tenth and the ledger is timed inside them.
    sane && replay.workMs + replay.restMs <= windowMs + 1,
    `${String(Math.round(replay.workMs))}ms folding + ${String(Math.round(replay.restMs))}ms resting ≤ ${String(Math.round(windowMs))}ms tailAttached→replayDone`
  )
  check(
    'a replay that never yielded never rested either — a rest without a slice would be fiction',
    replay.slices > 0 || replay.restMs === 0,
    `${String(replay.slices)} slices · ${String(Math.round(replay.restMs))}ms rest`
  )
}

/**
 * THE ALWAYS-ON BLOCK PROBE (docs/plans/chunked-replay.md §2), asserted additively beside the
 * phases it shares a file with. Unlike the HUD's probe this one is not opt-in and has no switch to
 * forget, so its absence from a real boot IS the regression. Identities only: how blocked this
 * particular machine got is not something a spec can assert — the bench (`npm run bench:replay`)
 * owns that budget, against a known log, on one machine.
 */
function stepBlockProbe(block: BlockStats | undefined, replayMs: number): void {
  // THE PROBE'S WINDOW IS THE REPLAY, and it ticks on a 500 ms interval. A per-spec fixture folds
  // in single-digit milliseconds (wave E2), so a launch against one legitimately produces ZERO
  // samples — and a profile that then stated `maxBlockMs: 0` would be inventing a measurement
  // nobody took (world-model law 1). So the presence of the stats is asserted only when the
  // replay actually outlived a tick; below that, their absence is the correct answer and the run
  // says so. The BUDGET on those numbers was never this spec's anyway: `npm run bench:replay`
  // owns it, against a ~100 MB log, on one machine.
  if (replayMs < PERF_LAG_PROBE_INTERVAL_MS) {
    check(
      'a replay shorter than one probe tick states NO block figures rather than inventing zeroes',
      block === undefined || block.samples === 0,
      `replay ${String(Math.round(replayMs))}ms < ${String(PERF_LAG_PROBE_INTERVAL_MS)}ms tick · ${block ? `${String(block.samples)} samples` : 'absent'}`
    )
    return
  }
  const ok = check(
    'the launch also states how blocked the main loop got — the always-on startup probe',
    block !== undefined && block.samples > 0,
    block ? `${String(block.samples)} probe ticks` : 'absent'
  )
  if (!ok || !block) return
  const sane =
    Number.isFinite(block.maxBlockMs) && block.maxBlockMs >= 0 && Number.isInteger(block.blocksOver50Ms)
  check(
    '…as a worst single stall and a count of the ones past the HUD’s own warn threshold',
    sane && block.blocksOver50Ms >= 0 && block.blocksOver50Ms <= block.samples,
    `max ${String(block.maxBlockMs)}ms · ${String(block.blocksOver50Ms)}/${String(block.samples)} over 50ms`
  )
}
