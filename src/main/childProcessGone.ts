// ============================================================================
// childProcessGone.ts — the Chromium children this app never noticed losing (JOS-364).
// ============================================================================
//
// `render-process-gone` has had a handler since the beginning (windowErrors.ts): a window that
// died is a blank app and impossible to miss. `child-process-gone` had none — so when the GPU
// process died, Chromium restarted it, every window's compositor was torn down and rebuilt, the
// user saw a black frame or a second-long freeze, and this app recorded NOTHING. The one field
// report we have of a ~1 s EverQuest hitch around an overlay show is exactly the shape of that,
// and there is no evidence either way because nobody was counting.
//
// TWO OUTPUTS, ONE EVENT, AND THEY ANSWER DIFFERENT QUESTIONS:
//   * a COUNTER (telemetry/health.ts) — how often does this happen across the fleet, per build.
//     A count is the only shape that can answer that, and it costs one integer add.
//   * an ERROR LINE, for GPU losses only — `logError('main:gpu-process-gone')` with the reason
//     and the exit code, so the error store holds an EXEMPLAR. A count says how often; an
//     exemplar says `crashed`, `oom` or `launch-failed`, which is the difference between a driver
//     problem and a machine out of memory, and no counter can carry it.
//
// A CLEAN EXIT IS NOT A LOSS. Chromium tears its children down on the way out — a GPU process
// with `reason: 'clean-exit'` at shutdown is the app quitting properly, and a counter that
// included it would report one GPU loss on every ordinary session this app has ever run. That
// filter is the only judgement in this file, and it is stated where it happens.
//
// IT IMPORTS NO ELECTRON, deliberately — `watchChildProcessGone` takes the emitter, so the whole
// rule can be driven from a unit test with a plain EventEmitter and no app at all. The one caller
// that has a real `app` is `crashGuards.ts`, which is where every other process-level guard is
// installed.

import { noteGpuProcessGone, noteUtilityProcessGone } from './telemetry/health'

/** Electron's `child-process-gone` payload, narrowed to what is read. Every field is optional
 *  here because it arrives from outside our types and a missing one must not throw on an error
 *  path — `unknown` is a fine thing for a diagnostic to say. */
export interface ChildProcessGoneDetails {
  type?: string
  reason?: string
  exitCode?: number
  serviceName?: string
}

/** What a GPU loss is reported AS, once the counting is done. Injected so this module needs no
 *  `errorLog` import (which would pull in `electron`) and so a test can watch what it was told. */
export type GpuLossReporter = (info: { reason: string; exitCode: number }) => void

/** The exit that means "we asked it to stop". Everything else is a loss. */
const CLEAN_EXIT = 'clean-exit'

/**
 * One `child-process-gone`. Total: it never throws, and a payload it does not recognise is
 * ignored rather than counted under a guess.
 *
 * ONLY TWO TYPES ARE COUNTED. Chromium also reports `Zygote`, `Sandbox helper`, `Ppapi plugin`
 * and others; none of them exists on the platforms this app ships to, or none of them means
 * anything a user would notice, and a counter that quietly accumulated them would answer a
 * question nobody asked with a number nobody could act on.
 */
export function noteChildProcessGone(
  details: ChildProcessGoneDetails,
  report?: GpuLossReporter
): void {
  const reason = typeof details.reason === 'string' ? details.reason : 'unknown'
  if (reason === CLEAN_EXIT) return
  const exitCode = typeof details.exitCode === 'number' ? details.exitCode : -1
  if (details.type === 'GPU') {
    noteGpuProcessGone()
    // The exemplar. `reason` is one of Chromium's own closed words and `exitCode` is a number —
    // neither can carry a path, a name or a line of anyone's log.
    report?.({ reason, exitCode })
    return
  }
  if (details.type === 'Utility') noteUtilityProcessGone()
}

/** The minimum of `Electron.App` this file needs — narrow on purpose, so the unit test can pass
 *  an EventEmitter and the composition root can pass the real app, and neither is a cast. */
export interface ChildProcessGoneEmitter {
  on(
    event: 'child-process-gone',
    listener: (e: unknown, details: ChildProcessGoneDetails | undefined) => void
  ): unknown
}

/**
 * Install the listener. Safe BEFORE `ready` — which is where it is called from, so no window can
 * be created, and no GPU process can die, in a window where nobody is listening.
 */
export function watchChildProcessGone(app: ChildProcessGoneEmitter, report?: GpuLossReporter): void {
  app.on('child-process-gone', (_e, details) => {
    // `?? {}` because the payload arrives from outside our types: a details-less event must cost
    // a count, not an exception on the app's own crash path.
    noteChildProcessGone(details ?? {}, report)
  })
}
