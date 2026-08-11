/**
 * ============================================================================
 * foldDeterminism.test.mts — AUDIT 1: THE FOLD DOES NOT READ THE CLOCK (JOS-208).
 * ============================================================================
 *
 * A checkpoint is a memo of a PURE FUNCTION of (byte prefix, the fold). If any fold path reads the
 * wall clock, that is false: the same bytes produce a different answer on Tuesday than they did on
 * Monday, `restore(checkpoint(prefix)) + tail` cannot equal `fold(prefix + tail)`, and the
 * differential harness would be asserting a coincidence.
 *
 * SO THIS IS A DYNAMIC AUDIT, NOT A GREP. `Date.now` and `performance.now` are REPLACED for the
 * duration of a real fold of a real fixture, through the real parser, the real module registry, the
 * real combat engine and the real derived-event producers. Any call at all is a failure, and the
 * failure message carries the stack that made it — which is the difference between "somewhere in
 * main there is a clock read" and "line 211 of respawn.ts".
 *
 * A grep would have found the same sites today and would rot on the first `const now = clock()`
 * indirection, a helper module, or a dependency that reads the clock on our behalf. This cannot:
 * it is the actual program, and it is watching the actual global.
 *
 * TWO THINGS ARE DELIBERATELY OUTSIDE THE MEASURED WINDOW, and both are the SCHEDULER rather than
 * the fold:
 *
 *   * `replaySlicer`'s clock. The slicer decides WHEN TO YIELD, which is a fact about the machine's
 *     responsiveness and not about the log; it reads `performance.now()` once per line by design
 *     (JOS-50's debt ledger). It is injected here (`now: () => 0`) rather than allow-listed,
 *     because an injected clock proves the fold is unaffected by it instead of merely tolerating it.
 *   * `reset()`. `RespawnModule.reset()` reads `Date.now()` to seed its ordering clock, which is
 *     correct — a fresh fold is entitled to today's reading — and it happens before the first event,
 *     outside a fold. The window opens after the world is built.
 */
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'
import { RespawnModule } from '../src/main/modules/respawn'
import { scanLog } from '../src/main/log/scanHistory'
import { createSlicer } from '../src/main/log/replaySlicer'
import { buildFoldWorld } from './foldCheckpointHarness.mts'

const FIXTURE = join(import.meta.dirname, 'fixtures', 'e2e-combat.log')

/**
 * A slicer whose clock is INJECTED and constant, so the scheduler cannot be the thing this audit
 * catches. `budgetMs: Infinity` additionally means it never yields — the fold runs as one straight
 * line, exactly as `unchunkedSlicer()` does, but without that function's real `performance.now`.
 */
function pinnedSlicer(): ReturnType<typeof createSlicer> {
  return createSlicer({ budgetMs: Number.POSITIVE_INFINITY, duty: 1, now: () => 0 })
}

test('fold determinism: a historical replay reads no wall clock', async () => {
  const world = buildFoldWorld(FIXTURE)
  // The world is BUILT before the trap is set: construction and `reset()` are entitled to the
  // clock (see the header), and only the fold is under audit.
  const realDateNow = Date.now
  const realPerfNow = performance.now.bind(performance)
  const calls: { which: string; stack: string }[] = []
  const trap =
    (which: string, real: () => number) =>
    (): number => {
      // The stack is captured only when a call actually happens, so a clean run pays nothing.
      if (calls.length < 32) calls.push({ which, stack: new Error('clock read').stack ?? '(no stack)' })
      return real()
    }
  Date.now = trap('Date.now', realDateNow)
  performance.now = trap('performance.now', realPerfNow)
  try {
    await scanLog(FIXTURE, world.bus, 0, { slicer: pinnedSlicer() })
  } finally {
    Date.now = realDateNow
    performance.now = realPerfNow
  }

  // THE TEST RUNNER IS NOT THE FOLD. `tsx` runs a disk-cache expiry on a `setImmediate`, so a
  // `Date.now()` from `node_modules/tsx/...` lands inside the window without any of our code having
  // asked for it. The audit therefore judges only stacks containing a frame from THIS REPO'S
  // SOURCE — which is the claim the ticket actually makes ("no wall-clock reads reachable from fold
  // paths"), stated precisely rather than approximately.
  //
  // THE LIMIT, since a filter is a hole: a fold path that read the clock THROUGH a node_modules
  // helper would produce a stack with our frame in it anyway (the caller is on the stack), so the
  // only thing this can miss is a dependency reading the clock on a schedule of its own — which is
  // what it is deliberately ignoring.
  const ours = calls.filter((c) => /[\\/]src[\\/](main|shared)[\\/]/.test(c.stack))

  // ONE EXEMPTION, BY NAME, AND IT IS AN INSTRUMENT RATHER THAN A FOLD: `startColdReadClock`
  // (scanHistory.ts, JOS-57) times how long the OS took to hand over the first megabyte — the
  // cold-read hypothesis this whole ticket exists to answer. Its reading reaches
  // `ScanResult.firstMbMs` and stops there; no module's state, and nothing a checkpoint can hold,
  // is a function of it. Exempting it by FRAME NAME rather than by file keeps everything else in
  // scanHistory.ts — the parse loop, the byte accounting, the handoff — fully under audit.
  const exempt = ours.filter((c) => /at startColdReadClock\b|at Object\.saw\b/.test(c.stack))
  assert.deepStrictEqual(
    ours.filter((c) => !exempt.includes(c)).map((c) => `${c.which}\n${c.stack}`),
    [],
    'a fold path read the wall clock — see the stacks above'
  )

  // …AND THE EXEMPTION IS BOUNDED, so it cannot quietly grow into a per-line cost wearing an
  // instrument's name: one read when the stream is opened, plus at most one more when the first
  // megabyte lands. Anything else means the clock moved into the loop.
  assert.ok(
    exempt.length <= 2,
    `the cold-read clock is read at most twice per scan; got ${exempt.length}. If it has moved into ` +
      `the read loop it is no longer an instrument — it is a cost on the fold.`
  )
})

/**
 * THE AUDIT'S OWN TRIPWIRE. A test that watches for something can rot into a test that watches
 * nothing — a renamed global, a reference captured at import time, a filter that quietly matches
 * everything. So: make a REAL module in `src/main` read the clock inside the same trap, and prove
 * that BOTH halves of the audit react — the trap records it, and the repo-source filter keeps it.
 *
 * `RespawnModule.reset()` is chosen because it is a real, deliberate, documented clock read (it
 * seeds the ordering clock a fresh fold is entitled to) — so this asserts a fact about the tree
 * rather than about a fixture written to make a test pass. Without it, deleting the trap OR
 * widening the filter to `/never-matches/` would leave the audit above green and empty.
 */
test('fold determinism: the audit can actually see a clock read from src/main', () => {
  const realDateNow = Date.now
  const stacks: string[] = []
  Date.now = (): number => {
    stacks.push(new Error('clock read').stack ?? '')
    return realDateNow()
  }
  try {
    new RespawnModule().reset()
  } finally {
    Date.now = realDateNow
  }
  assert.ok(stacks.length > 0, 'the trap must observe the clock read')
  assert.ok(
    stacks.some((s) => /[\\/]src[\\/](main|shared)[\\/]/.test(s)),
    'the repo-source filter must KEEP a read made from src/main — otherwise the audit above is empty'
  )
})
