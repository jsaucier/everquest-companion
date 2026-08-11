// ============================================================================
// attach.ts — THE APP'S SIDE OF THE CHECKPOINT (JOS-208).
// ============================================================================
//
// Everything else in this directory is Electron-free and unit-testable. This is the one file that
// knows about the running app: the module registry, the settings store, this channel's userData,
// and the live event stream. `session.ts` calls three functions from here and nothing else, which
// is what keeps the feature's whole footprint in the app's hottest path down to two `if`s.
//
// THE FLAG IS RESOLVED ONCE PER LAUNCH and the answer is logged, because "why did it cold-start"
// is the first question anybody will ask of this feature and the boot log should already answer it.
//
// AND WHEN IT IS OFF, NOTHING HAPPENS — not a probe, not a subscription, not a `stat`. The
// last-event-timestamp tracker below is a per-event cost (one comparison across 1.4M events), so it
// is installed only when the flag is on. A feature that is off by default must cost nothing by
// default, or the measurement that decides whether to turn it on is measuring the wrong program.

import { logInfo } from '../errorLog'
import { characterId } from '../log/config'
import { bus, epoch, registry, sessionDetector } from '../pipeline'
import { getFoldCacheEnabled } from '../storeFoldCache'
import { resolveFoldCacheFlag } from './flag'
import { readCheckpoint, writeCheckpointSync, checkpointableUnits, type RestoreResult } from './loader'
import { foldCachePath } from './paths'
import type { FoldUnit } from './serialize'
import type { CharacterRef } from '../../shared/types'

let flag: { enabled: boolean; why: string } | null = null
/** The `ts` of the last event any feeder emitted — see the header for why it is conditional. */
let lastEventTs = 0
let probeInstalled = false

/** The launch's answer, resolved once and logged once. */
export function foldCacheEnabled(): boolean {
  if (!flag) {
    flag = resolveFoldCacheFlag({ pref: getFoldCacheEnabled(), env: process.env.EQ_FOLD_CACHE })
    logInfo(`[everquest-companion] Fold checkpoint: ${flag.enabled ? 'ON' : 'off'} (${flag.why}).`)
  }
  return flag.enabled
}

/**
 * EVERYTHING THE CONTAINER CARRIES, in a fixed order: the registry's checkpointable modules first
 * (registration order), then the two DERIVED-EVENT PRODUCERS.
 *
 * The producers are here because they are fold state that publishes nothing and that the modules'
 * correctness depends on — the differential harness proved it on its first run, and the story is in
 * `serialize.ts` under `FoldUnit`. This list is the answer to "what is a complete fold", and it is
 * ONE list so a write and a read cannot disagree about it.
 *
 * PHASE 2 CLOSED THE MODULE SET. Every module the registry folds now declares a shape, and two of
 * phase 1's three named debts are paid INSIDE the modules that own their lifetimes rather than as
 * units of their own: the shared `MobLootIndex` rides in the `consider` blob (which folds it and
 * resets it), and the `MessageOverlayMiner` rides in `buffs` (which publishes what it builds).
 * The buffs module also carries the two halves it SHARES with `buffTimers` — the cast anchors and
 * the duration learner — so they are written exactly once.
 *
 * WHAT IS STILL OUTSIDE IT: the `CombatEngine`'s state machine. It is the last debt and it is a
 * different size of thing from everything above — an uncapped encounter history, per-encounter
 * aggregates, proc/heal/window accumulators, a world model of instances and generations, all of
 * it mutable class state — and its blob would dominate the container it lives in. Nothing reads
 * engine state back into any registry module (the dependency runs the other way: the engine PULLS
 * the roster's view), so leaving it out cannot make a checkpointed module wrong; what it costs is
 * that the combat meter starts empty after a restore, exactly as it does today after a cold start
 * of the app itself. See the ticket for the measurement and the recommendation.
 */
function foldUnits(): FoldUnit[] {
  return checkpointableUnits([...registry.list(), epoch, sessionDetector])
}

/** Install the last-event clock. Idempotent; only ever called when the flag is on. */
function installProbe(): void {
  if (probeInstalled) return
  probeInstalled = true
  bus.subscribe((ev) => {
    if (ev.ts > lastEventTs) lastEventTs = ev.ts
  })
}

/**
 * TRY TO START FROM A CHECKPOINT. Returns the byte offset and seq the fold was restored to, or
 * null — and null is the ordinary answer, not an error: no cache, a cache from another build, a
 * log that was archived, a module that refused its blob. Every one of them means "cold-replay",
 * which is what the caller does anyway.
 *
 * THE CALLER MUST HAVE RESET THE REGISTRY FIRST. `session.ts` does (`resetWorldFor`), and this
 * relies on it: a restore drops state onto modules that are at zero, and on the refusal path the
 * modules are left exactly as the reset left them — except for the all-or-nothing case the loader
 * documents, where a partial adoption is possible and the caller resets again below.
 */
export async function restoreFold(ref: CharacterRef): Promise<{ offset: number; seq: number } | null> {
  if (!foldCacheEnabled()) return null
  installProbe()
  const modules = foldUnits()
  if (modules.length === 0) return null
  const res: RestoreResult = await readCheckpoint({
    cachePath: foldCachePath(characterId(ref)),
    logPath: ref.logPath,
    characterKey: `${ref.name}@${ref.server}`.toLowerCase(),
    modules
  })
  if (!res.restored) {
    // A refusal may have left SOME units holding a blob (the loader's all-or-nothing note), so the
    // world goes back to zero before the cold replay that follows. Cheap, and unconditional rather
    // than clever: reasoning about which half adopted is exactly the state this avoids. All THREE
    // resets, in the same order `resetWorldFor` does them — the detectors are units now, so a
    // registry reset alone would leave the half of the fold that publishes nothing half-restored.
    registry.reset()
    epoch.reset()
    sessionDetector.reset()
    logInfo(`[everquest-companion] Fold checkpoint: cold start (${res.why}).`)
    return null
  }
  lastEventTs = res.lastEventTs
  logInfo(
    `[everquest-companion] Fold checkpoint: restored ${modules.length} modules at byte ${res.offset} (seq ${res.seq}); replaying the tail only.`
  )
  return { offset: res.offset, seq: res.seq }
}

/**
 * WRITE A CHECKPOINT for the fold as it stands at `offset`. SYNCHRONOUS, because its caller is the
 * quit path — see `writeCheckpointSync`'s header for why that is not a shortcut.
 *
 * `offset` is the caller's: `Tailer.checkpointOffset()`, the end of the last COMPLETE line the live
 * tail emitted. The write TIMING is a tail-length pragmatic and not a correctness need (the design
 * says so) — a checkpoint at any byte position is as valid as one at any other — so a missed write
 * costs a longer tail replay next launch and nothing else.
 */
export function saveFold(ref: CharacterRef, offset: number, seq: number): boolean {
  if (!foldCacheEnabled()) return false
  const modules = foldUnits()
  if (modules.length === 0) return false
  const ok = writeCheckpointSync({
    cachePath: foldCachePath(characterId(ref)),
    logPath: ref.logPath,
    characterKey: `${ref.name}@${ref.server}`.toLowerCase(),
    offset,
    seq,
    lastEventTs,
    modules
  })
  logInfo(
    ok
      ? `[everquest-companion] Fold checkpoint: wrote ${modules.length} modules at byte ${offset}.`
      : `[everquest-companion] Fold checkpoint: not written (byte ${offset}).`
  )
  return ok
}
