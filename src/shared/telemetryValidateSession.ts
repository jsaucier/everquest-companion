// ============================================================================
// telemetryValidateSession.ts — THE TWO SESSION REPORTS AND THEIR OPTIONAL RIDERS.
// ============================================================================
//
// The FIFTH file of the one definition (`telemetryValidate.ts`'s header lists the other four), and
// split out for exactly the reason those two were: a rider added to these two events pushed that
// file past the repo's 400-code-line ceiling, and the house answer is a split.
//
// THE CUT IS BY SUBJECT, not by size. `sessionHeartbeat` and `sessionEnd` are the two events that
// carry OPTIONAL RIDERS — measurements that ride an existing kind rather than arriving as a new one
// — and every rider follows THE ADDITIVE-FIELD RULE stated in `./telemetry.ts`:
//
//   * `linesParsed` (2026-08-06) — the rule's first customer, and where it was learned.
//   * `startup` (JOS-57) — the startup replay reading, all six fields or none, with three later
//     discriminators each independently optional inside it.
//
// Why the rule: a NEW EVENT KIND fails the whole batch on a server that has not been redeployed,
// and `telemetryPermanentRefusal` classes that 400 as "these bytes will never be accepted" and
// drops everything the client was carrying. A new OPTIONAL FIELD on an existing kind costs an old
// server nothing — the validators do not sanitize an object, they CONSTRUCT one field by field, so
// a field it has never heard of is simply not copied across.
//
// So the interesting property this file has to keep is that every rider can be absent, can be
// `null`, and can arrive at a server that predates it — and that a rider whose parts only mean
// something TOGETHER is refused rather than half-accepted.

import {
  COLD_START_MS_EDGES,
  isTelemetryObject,
  LOG_SIZE_BYTES_EDGES,
  MAX_COUNT,
  MAX_DURATION_MS,
  MAX_REPLAY_EVENTS,
  NEW_BYTES_EDGES,
  STUTTER_MS_EDGES,
  TELEMETRY_VIEWS,
  type EvSessionEnd,
  type EvSessionHeartbeat,
  type StartupReplayStats,
  type StartupStutterStats,
  type TelemetryEvent
} from './telemetry'
import { bucket, fail, whole, type Validated } from './telemetryValidateBase'

export function vSessionStart(o: Record<string, unknown>): Validated<TelemetryEvent> {
  const b = bucket(o.coldStartMsBucket, 'coldStartMsBucket', COLD_START_MS_EDGES)
  return b.ok ? { ok: true, value: { t: 'sessionStart', coldStartMsBucket: b.value } } : b
}

/**
 * `linesParsed`, which both session-report events carry OPTIONALLY (the additive-field rule in
 * `./telemetry.ts`). Absent and null both mean "nothing to add", exactly as they do for
 * `failureClass` — an older client, or one whose parser never ran, simply does not send it.
 */
function optionalLines(o: Record<string, unknown>): Validated<number | undefined> {
  if (o.linesParsed === undefined || o.linesParsed === null) return { ok: true, value: undefined }
  return whole(o.linesParsed, 'linesParsed', MAX_COUNT)
}

/**
 * The startup replay reading (JOS-57), which both session reports carry OPTIONALLY under the same
 * additive-field rule as `linesParsed` — absent and null both mean "no reading in this one".
 *
 * ALL SIX FIELDS OR NONE. A partial reading is refused rather than repaired, because every number
 * in it describes the SAME seconds and a duty with no wall clock beside it (or a block count with
 * no worst block) is not a smaller measurement, it is an uninterpretable one. Constructed field by
 * field like every other validator here, so nothing that is not in the schema survives the trip.
 *
 * THE SIX ARE THE ORIGINAL SIX. JOS-57's scope addition layered three more on
 * (`startupDiscriminators`, below), and each of THOSE is optional on its own — that is what makes
 * them safe to ship into a fleet talking to a server that has never heard of them.
 */
function optionalStartup(o: Record<string, unknown>): Validated<StartupReplayStats | undefined> {
  const raw = o.startup
  if (raw === undefined || raw === null) return { ok: true, value: undefined }
  if (!isTelemetryObject(raw)) return fail('startup', 'startup must be an object.')
  const replayMs = whole(raw.replayMs, 'startup.replayMs', MAX_DURATION_MS)
  if (!replayMs.ok) return replayMs
  const events = whole(raw.eventsReplayed, 'startup.eventsReplayed', MAX_REPLAY_EVENTS)
  if (!events.ok) return events
  const duty = whole(raw.dutyPct, 'startup.dutyPct', 100)
  if (!duty.ok) return duty
  const maxBlock = whole(raw.maxBlockMs, 'startup.maxBlockMs', MAX_DURATION_MS)
  if (!maxBlock.ok) return maxBlock
  const blocks = whole(raw.blocksOver50, 'startup.blocksOver50', MAX_COUNT)
  if (!blocks.ok) return blocks
  const logSize = bucket(raw.logSizeBucket, 'startup.logSizeBucket', LOG_SIZE_BYTES_EDGES)
  if (!logSize.ok) return logSize
  return startupDiscriminators(raw, {
    replayMs: replayMs.value,
    eventsReplayed: events.value,
    dutyPct: duty.value,
    maxBlockMs: maxBlock.value,
    blocksOver50: blocks.value,
    logSizeBucket: logSize.value
  })
}

/**
 * THE JOS-57 SCOPE ADDITION's three fields, layered onto a reading whose original six have already
 * been accepted — the ADDITIVE-FIELD RULE applied INSIDE an existing group.
 *
 * Each is independently optional, and that is the whole deploy-skew argument: a client that sends
 * all three to a server built before they existed loses exactly them (this function does not run
 * there, and the six-field constructor copies nothing it does not name), while a client too old to
 * send them talks to a new server unchanged. Absent and null both mean "not reported", exactly as
 * they do for `linesParsed` and for the group as a whole.
 */
function startupDiscriminators(
  raw: Record<string, unknown>,
  base: StartupReplayStats
): Validated<StartupReplayStats> {
  const newBytes = optionalBucket(raw.newBytesBucket, 'startup.newBytesBucket', NEW_BYTES_EDGES)
  if (!newBytes.ok) return newBytes
  const stutter = optionalStutter(raw.stutter)
  if (!stutter.ok) return stutter
  const firstMb = optionalWhole(raw.firstMbMs, 'startup.firstMbMs', MAX_DURATION_MS)
  if (!firstMb.ok) return firstMb
  return {
    ok: true,
    value: {
      ...base,
      ...(newBytes.value === undefined ? {} : { newBytesBucket: newBytes.value }),
      ...(stutter.value === undefined ? {} : { stutter: stutter.value }),
      ...(firstMb.value === undefined ? {} : { firstMbMs: firstMb.value })
    }
  }
}

/** `whole`, but absent/null is a legal answer meaning "not reported". */
function optionalWhole(raw: unknown, field: string, max: number): Validated<number | undefined> {
  if (raw === undefined || raw === null) return { ok: true, value: undefined }
  return whole(raw, field, max)
}

/** `bucket`, but absent/null is a legal answer meaning "not reported". */
function optionalBucket(
  raw: unknown,
  field: string,
  edges: readonly number[]
): Validated<number | undefined> {
  if (raw === undefined || raw === null) return { ok: true, value: undefined }
  return bucket(raw, field, edges)
}

/**
 * The stutter trio, ALL THREE OR NONE — the same refusal the six-field group makes, for the same
 * reason: a p95 with no p50 beside it cannot say whether the whole distribution moved or only its
 * tail, and that distinction is the entire point of measuring a distribution instead of a max.
 */
function optionalStutter(raw: unknown): Validated<StartupStutterStats | undefined> {
  if (raw === undefined || raw === null) return { ok: true, value: undefined }
  if (!isTelemetryObject(raw)) return fail('startup.stutter', 'startup.stutter must be an object.')
  const p50 = bucket(raw.p50Bucket, 'startup.stutter.p50Bucket', STUTTER_MS_EDGES)
  if (!p50.ok) return p50
  const p95 = bucket(raw.p95Bucket, 'startup.stutter.p95Bucket', STUTTER_MS_EDGES)
  if (!p95.ok) return p95
  const latePct = whole(raw.latePct, 'startup.stutter.latePct', 100)
  if (!latePct.ok) return latePct
  return { ok: true, value: { p50Bucket: p50.value, p95Bucket: p95.value, latePct: latePct.value } }
}

export function vSessionHeartbeat(o: Record<string, unknown>): Validated<TelemetryEvent> {
  const ms = whole(o.uptimeMs, 'uptimeMs', MAX_DURATION_MS)
  if (!ms.ok) return ms
  const lines = optionalLines(o)
  if (!lines.ok) return lines
  const startup = optionalStartup(o)
  if (!startup.ok) return startup
  const value: EvSessionHeartbeat = { t: 'sessionHeartbeat', uptimeMs: ms.value }
  if (lines.value !== undefined) value.linesParsed = lines.value
  if (startup.value !== undefined) value.startup = startup.value
  return { ok: true, value }
}

export function vSessionEnd(o: Record<string, unknown>): Validated<TelemetryEvent> {
  const ms = whole(o.durationMs, 'durationMs', MAX_DURATION_MS)
  if (!ms.ok) return ms
  const views = whole(o.viewsVisited, 'viewsVisited', TELEMETRY_VIEWS.length)
  if (!views.ok) return views
  const lines = optionalLines(o)
  if (!lines.ok) return lines
  const startup = optionalStartup(o)
  if (!startup.ok) return startup
  const value: EvSessionEnd = {
    t: 'sessionEnd',
    durationMs: ms.value,
    viewsVisited: views.value
  }
  if (lines.value !== undefined) value.linesParsed = lines.value
  if (startup.value !== undefined) value.startup = startup.value
  return { ok: true, value }
}
