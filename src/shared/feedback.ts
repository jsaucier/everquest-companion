// ============================================================================
// FEEDBACK CONTRACT — the ONE definition of the report wire format.
// ============================================================================
//
// Imported by THREE consumers and owned by none of them:
//   * the renderer dialog  (gates Send on `validateDraft`, so a round trip is never spent
//     learning something we already knew),
//   * the main process     (assembles `SubmitRequest`, re-validates at the IPC handler —
//     renderer-supplied strings are validated AT THE BOUNDARY, same law as `sounds:getData`),
//   * the ingest Lambda    (`validateSubmit` is the server's whole shape check).
//
// One definition, three consumers — that is the point. A limit that lives in two places is a
// limit that will disagree with itself, and the disagreement will show up as a 400 the user
// cannot act on.
//
// LAWS THIS FILE OBEYS:
//   * PURE. Its ONLY import is the pure sibling `./sanitizeText` — no `node:`, no Electron, no
//     DOM. `src/shared/**` compiles under BOTH tsconfigs and this module additionally has to
//     bundle into a Lambda.
//   * REJECT, NEVER TRUNCATE (§8.3 step 2). A description that is too long is an error the
//     user is told about; silently cutting it is a lie to both parties. The validators trim
//     SURROUNDING whitespace (normalization) and never shorten content.
//   * TEXT ON THE WIRE IS TEXT, NOT TERMINAL INSTRUCTIONS. Sanitization used to be entirely
//     CLIENT-side; a hostile client simply does not run it. So the two text shapes on this wire
//     are now governed here, at the boundary all three consumers share:
//
//       description (multi-line prose) — control characters are STRIPPED. `\n` and `\t` stay;
//         every other C0 control, DEL, C1, whole ANSI/VT escape sequence and invisible/BiDi
//         formatting character is removed BEFORE the trim and BEFORE the length bound. This is
//         NORMALIZATION, of exactly the kind `trim` already is: nobody typed a NUL or an
//         `ESC ] 0 ;` into a bug report, so removing one never shortens what the user WROTE.
//         (It is therefore not in tension with REJECT-NEVER-TRUNCATE, which is about LENGTH.)
//
//       env.* (single-line runtime strings) — control characters are REJECTED, `invalid_payload`
//         naming the field. `os.release()` and `process.versions.*` cannot legitimately contain
//         one, so a control character there does not mean "needs tidying", it means the payload
//         is forged, and a forged payload deserves an honest 400 rather than a quiet repair.
//
//     The character classes themselves live in ONE place, `./sanitizeText`, which the owner-side
//     triage readers use too — so what the wire refuses and what the terminal is protected from
//     can never drift apart.
//   * The validators are total and side-effect free: every failure is a typed value, nothing
//     throws, and the same call on the same input always returns the same answer.
//
// Plan of record: docs/plans/feedback-triage.md §3.1 (shape), §8.3 (handler contract).

import { hasWireControls, sanitizeMultiline } from './sanitizeText'

/** Bumped only for a BREAKING wire change; the server rejects anything else outright.
 *
 *  IT STAYS 1 FOR THE INVENTORY ATTACHMENT (JOS-296), and that is a decision, not an omission.
 *  `v` is a HARD GATE — `validateSubmit` refuses any other value outright — so bumping it would
 *  make every already-installed client's report a 400 the instant the new server deployed. An
 *  ADDITIVE field cannot break either side: an old client simply omits `inventory` (which reads
 *  as `null`, the same as attaching nothing), and an old SERVER drops it, because these
 *  validators construct their return value field by field rather than passing the input through.
 *  A version bump is for a change that makes an old payload WRONG; this one makes it incomplete,
 *  which the contract already has a spelling for. What the ordering law still demands is that
 *  the SERVER ship first — a client that declares an attachment the server has no column for
 *  would upload nothing and say it did (infra/README.md carries the runbook). */
export const FEEDBACK_API_VERSION = 1

// ---- the record ------------------------------------------------------------------------

export type FeedbackType = 'feature' | 'bug'
/** `'e2e'` is deliberately absent: the headless harness never submits (§6.6). */
export type AppChannelTag = 'prod' | 'dev'
export type ReportStatus =
  | 'new'
  | 'triaged'
  | 'accepted'
  | 'shipped'
  | 'wontfix'
  | 'duplicate'
  | 'spam'
export type Severity = 'p0' | 'p1' | 'p2' | 'p3'

/** Runtime-checkable spellings of the unions above (validators + the triage CLI's `set`). */
export const FEEDBACK_TYPES = ['feature', 'bug'] as const
export const APP_CHANNEL_TAGS = ['prod', 'dev'] as const
export const UPDATE_CHANNELS = ['main', 'stable'] as const
export const REPORT_STATUSES = [
  'new',
  'triaged',
  'accepted',
  'shipped',
  'wontfix',
  'duplicate',
  'spam',
] as const
export const SEVERITIES = ['p0', 'p1', 'p2', 'p3'] as const

/** What the user typed. Renderer-owned; validated by the SAME function main and the Lambda use.
 *
 *  `title` and `contact` were REMOVED from the contract: the description is the whole report,
 *  and anyone who wants a follow-up puts their email/Discord in the body. Old clients that
 *  still send them are not rejected — the validator simply drops unknown fields — and the
 *  `report` table keeps its columns for the legacy rows that carry values. */
export interface FeedbackDraft {
  type: FeedbackType
  /** MIN_DESCRIPTION..MAX_DESCRIPTION after trim. */
  description: string
}

/** Everything the CLIENT knows about itself. Assembled in main; never typed by the user. */
export interface FeedbackEnv {
  appVersion: string // app.getVersion()
  channel: AppChannelTag // src/main/channel.ts CHANNEL
  updateChannel: 'main' | 'stable' // store.getUpdateChannel()
  platform: string // process.platform
  osRelease: string // os.release()
  arch: string // process.arch
  electron: string // process.versions.electron
  chrome: string // process.versions.chrome
  node: string // process.versions.node
}

/** Metadata about an attached slice. The BYTES go to S3, never through this JSON. */
export interface LogSliceMeta {
  bytes: number // gzipped size the client is about to upload
  lines: number // lines AFTER scrub
  dropped: number // lines the scrub removed (shown in the preview, honest by construction)
  fromMs: number // first kept line's timestamp
  toMs: number // last kept line's timestamp
  sha256: string // hex digest of the gz bytes — integrity, and a free dedupe key
}

/**
 * Metadata about an attached `/outputfile inventory` dump (JOS-296). The BYTES go to S3 on their
 * own presign, exactly like the slice; this is the part that travels in the JSON body.
 *
 * WHAT IS DELIBERATELY NOT HERE: the file's NAME or PATH. EQ names the dump
 * `<Character>_<server>-Inventory.txt`, so the filename is the one place the character's identity
 * appears at all (the dump's CONTENTS carry none — see the format sweep in
 * src/main/feedback/inventory.ts). The dialog shows the user their own filename because it is
 * their own screen; the wire does not need it to diagnose an export-shaped bug, so it does not
 * get it.
 */
export interface InventoryDumpMeta {
  bytes: number // gzipped size the client is about to upload
  lines: number // rows in the dump, as read (nothing is removed — see below)
  /** The DUMP's mtime, epoch ms — when the PLAYER last typed `/outputfile inventory`, never when
   *  we read it. This is the JOS-253 freshness truth, and it is the single most diagnostic field
   *  here: a three-week-old export explains most "the app has the wrong items" reports outright. */
  updatedAt: number
  sha256: string // hex digest of the gz bytes — integrity, and a free dedupe key
}

export interface SubmitRequest {
  v: typeof FEEDBACK_API_VERSION
  draft: FeedbackDraft
  env: FeedbackEnv
  installId: string // uuid v4 shape
  clientReportId: string // uuid v4 — IDEMPOTENCY key across offline retries (§6.4)
  clientTs: number // client clock, untrusted, kept for skew diagnostics
  log: LogSliceMeta | null
  /** The SECOND attachment (JOS-296). Additive: absent reads as null, so a client built before
   *  this field existed is a client that attached no dump, which is exactly what it meant. */
  inventory: InventoryDumpMeta | null
}

export type SubmitResponse =
  | {
      ok: true
      reportId: string
      upload: PresignedUpload | null
      /** The dump's own presign. Optional on the wire so a server that predates JOS-296 is a
       *  server that minted none — the client then uploads nothing and says `false`, rather
       *  than reading a missing field as a failure. */
      inventoryUpload?: PresignedUpload | null
    }
  | {
      ok: false
      error: SubmitErrorCode
      message: string
      field?: string
      retryAfterSec?: number
    }

export type SubmitErrorCode =
  | 'invalid_payload'
  | 'blocked'
  | 'quota_exceeded'
  | 'closed'
  | 'too_large'
  | 'internal'

export interface PresignedUpload {
  url: string // S3 endpoint — VALIDATED before main POSTs to it (§6.5)
  fields: Record<string, string> // the POST policy fields
  key: string
  expiresInSec: number
}

// ---- the IPC-crossing shapes -------------------------------------------------------------
//
// §4.2 of the plan sketches these as `src/main/feedback/index.ts` return types. They cannot
// live there: the RENDERER names every one of them (the dialog's header, the preview box, the
// submit outcome) and the renderer cannot import from `src/main`. Anything that crosses the
// preload bridge is by definition a SHARED type, so they live here with the rest of the
// contract — main and the renderer both import them from one file.

/** Everything the dialog needs to render its header + gate its controls. */
export interface FeedbackContext {
  env: FeedbackEnv
  /** False when this build has no `FEEDBACK_API_URL` compiled in — the UI says so honestly
   *  instead of failing (F1 ships dark on purpose). */
  endpointConfigured: boolean
  /** Reports waiting in the offline queue (§6.4). */
  queued: number
  /** False when no character log is resolved, so the attach section cannot be offered. */
  logAvailable: boolean
  /** False when `/outputfile inventory` has never been run on this machine — the dump control
   *  is then DISABLED with the command as its hint, rather than hidden (JOS-296). Hiding it
   *  would leave the user with no idea the option exists, which is the state the hint fixes. */
  inventoryAvailable: boolean
  /** The dump's mtime, epoch ms, or null when there is none. Carried on the CONTEXT and not
   *  only on the preview so the dialog can state the age BEFORE anything is read or gzipped. */
  inventoryUpdatedAt: number | null
}

/** Why there is no inventory dump to attach. Exactly one of these or a built dump, never both. */
export type InventoryUnavailable =
  /** `/outputfile inventory` has never been run (or the file is gone). */
  | 'no-dump'
  /** The file exists and could not be read — permissions, a vanished drive. */
  | 'unreadable'
  /** The file is there and holds nothing. */
  | 'empty'
  /** Over MAX_UPLOAD_BYTES gzipped. REFUSED, never trimmed — see the note on the constant. */
  | 'too-large'

/**
 * What crosses IPC for the preview (§5.4): the true counts plus AT MOST `PREVIEW_MAX_LINES`
 * lines of text. The gz BYTES never cross — a 4 MB string does not belong on the bridge.
 * `truncatedPreview` is what the UI must state out loud, since "you can see exactly what is
 * sent" is otherwise a claim about a truncated view.
 */
export interface FeedbackSlicePreview extends LogSliceMeta {
  previewLines: string[]
  truncatedPreview: boolean
}

/**
 * What crosses IPC for the DUMP preview (JOS-296) — the slice preview's twin, with one
 * difference that is the whole design: exactly one of `meta` and `unavailable` is set.
 *
 * The slice can answer "nothing to attach" with a bare `null` because every way of getting
 * there reads the same to a user ("no log lines in this window"). A dump cannot: "you have never
 * run the command" and "your dump is too big to send" call for different sentences, and
 * collapsing `too-large` into "no dump" would be the dialog telling a user their export does not
 * exist while they are looking at it.
 */
export interface FeedbackInventoryPreview {
  meta: InventoryDumpMeta | null
  unavailable: InventoryUnavailable | null
  previewLines: string[]
  truncatedPreview: boolean
  /** The dump's FILE NAME (never its path, never the wire's business — see InventoryDumpMeta).
   *  Shown so the dialog can name the exact file it will send. Null when there is none. */
  fileName: string | null
}

/**
 * The end of a Send. `submitFeedback` NEVER rejects — every outcome, including a dead network,
 * is one of these values (§4.2).
 */
export type SubmitResult =
  | { ok: true; reportId: string; logUploaded: boolean; inventoryUploaded: boolean }
  | { ok: false; error: SubmitErrorCode; message: string; queued: boolean }

/** The "Save a copy…" escape hatch: the OS save dialog lives in main (§4.2). */
export interface SaveSliceResult {
  ok: boolean
  path?: string
  canceled?: boolean
}

// ---- limits ----------------------------------------------------------------------------
//
// Here, and nowhere else, so the dialog, the slicer and the Lambda cannot disagree.

export const MIN_DESCRIPTION = 10
export const MAX_DESCRIPTION = 4_000
export const MAX_BODY_BYTES = 32 * 1024 // whole JSON request
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 // gzipped slice
export const MAX_SLICE_LINES = 50_000
/**
 * Rows in an attached inventory dump (JOS-296). The measured dev dump is 295 lines; a hoarder
 * with every bank slot, both shared banks, the depot and a full keyring is still four figures.
 * 50,000 is not a budget, it is the "this is not an inventory dump" line — the same job
 * MAX_SLICE_LINES does for the log, which is why it is the same number.
 *
 * THE BYTE CAP IS `MAX_UPLOAD_BYTES`, SHARED WITH THE SLICE, AND IT IS ENFORCED BY REFUSAL.
 * A slice that will not fit is TRIMMED FROM THE FRONT, because fewer log lines is simply less
 * context. A dump cannot be treated that way: it is a complete statement of what a character
 * owns, and a trimmed one is a well-formed file that silently claims the missing items do not
 * exist — the exact failure mode `/outputfile inventory` already has when the Bank window is
 * shut (shared/outputs/kinds.ts `steps`), and the one this attachment exists to diagnose. So an
 * oversize dump is `unavailable: 'too-large'` and the dialog says so.
 */
export const MAX_INVENTORY_LINES = 50_000
export const PREVIEW_MAX_LINES = 5_000 // what crosses IPC for the preview (§5.4)
export const LOG_WINDOW_CHOICES = [15, 30, 60] as const // minutes
export const DEFAULT_LOG_WINDOW = 30
/** Per-field ceiling for the free-form `FeedbackEnv` runtime strings (`os.release()`,
 *  `process.versions.*`). NOT in the plan's limit block — added because "bounded by
 *  MAX_BODY_BYTES" is a whole-body bound, and a 30 KB `arch` should fail on the field that
 *  is wrong rather than on the body that contains it. Real values are <= 24 chars. */
export const MAX_ENV_FIELD = 120

/** `crypto.randomUUID()` shape. Case-insensitive to read; clients emit lowercase. */
export const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
/** `app.getVersion()` — semver, optionally with the CI channel prerelease tag. */
export const APP_VERSION_RE = /^\d+\.\d+\.\d+(?:-[\w.]+)?$/
/** A sha-256 digest as hex. `createHash('sha256').digest('hex')` is lowercase; both read. */
export const SHA256_HEX_RE = /^[0-9a-f]{64}$/i

// ---- validation ------------------------------------------------------------------------

/** Every rejection is `invalid_payload` — §8.3 decides 413 `too_large` from Content-Length,
 *  BEFORE a body is parsed, so an oversize body never reaches these functions. */
export interface ValidationFailure {
  ok: false
  error: 'invalid_payload'
  /** Safe to render to the user verbatim: it names the field and the limit, nothing internal. */
  message: string
  /** Dotted path of the offending field, so the dialog can focus the right input. */
  field: string
}

export type Validated<T> = { ok: true; value: T } | ValidationFailure

const fail = (field: string, message: string): ValidationFailure => ({
  ok: false,
  error: 'invalid_payload',
  message,
  field,
})

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * The LENGTH half, shared by both text shapes below. Measured on the already-normalized value,
 * which is the value that will be STORED — the number in the error message is a number the user
 * can act on, not one about some intermediate form they never saw.
 */
function bounded(t: string, field: string, max: number, min: number): Validated<string> {
  if (t.length < min)
    return min === 1
      ? fail(field, `${field} is required.`)
      : fail(field, `${field} must be at least ${min} characters.`)
  if (t.length > max)
    return fail(
      field,
      `${field} must be ${max} characters or fewer (it is ${t.length}).`,
    )
  return { ok: true, value: t }
}

/**
 * A SINGLE-LINE runtime string (`env.platform`, `env.osRelease`, `env.arch`, `env.electron`,
 * `env.chrome`, `env.node`). Required, non-empty after trim, <= max — and REJECTED outright if
 * anything survives the trim that is a control character or an invisible formatting character.
 *
 * Trim first, THEN test: surrounding whitespace has always been normalized away here and a
 * trailing newline from a sloppy caller is not an attack. A control character in the INTERIOR
 * of `os.release()` is.
 */
function lineText(raw: unknown, field: string, max: number): Validated<string> {
  if (typeof raw !== 'string') return fail(field, `${field} must be text.`)
  const t = raw.trim()
  if (hasWireControls(t))
    return fail(field, `${field} must not contain control characters.`)
  return bounded(t, field, max, 1)
}

/**
 * MULTI-LINE prose the user typed (`draft.description`). Control characters are STRIPPED, then
 * the value is trimmed, then bounded — in that order, deliberately:
 *
 *   * strip before trim, so a description made entirely of NULs and escape sequences collapses
 *     to '' and fails the MINIMUM like the empty report it is, rather than passing as content;
 *   * strip before the maximum, so the length the user is told about is the length of the text
 *     we will actually keep. Removing a non-character is not the "truncation" §8.3 forbids —
 *     what that law protects is the user's WORDS, and no word is being shortened.
 */
function blockText(raw: unknown, field: string, max: number, min: number): Validated<string> {
  if (typeof raw !== 'string') return fail(field, `${field} must be text.`)
  return bounded(sanitizeMultiline(raw).trim(), field, max, min)
}

function integerInRange(
  raw: unknown,
  field: string,
  min: number,
  max: number,
): Validated<number> {
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw))
    return fail(field, `${field} must be a whole number.`)
  if (raw < min || raw > max)
    return fail(field, `${field} must be between ${min} and ${max} (it is ${raw}).`)
  return { ok: true, value: raw }
}

function oneOf<T extends string>(
  raw: unknown,
  field: string,
  allowed: readonly T[],
): Validated<T> {
  if (typeof raw === 'string' && (allowed as readonly string[]).includes(raw))
    return { ok: true, value: raw as T }
  return fail(field, `${field} must be one of: ${allowed.join(', ')}.`)
}

/**
 * The regex-pinned fields (`appVersion`, both UUIDs, `log.sha256`) need no separate control-
 * character rule and MUST NOT get one: every pattern here is `^…$` over a closed character set,
 * and in JavaScript — unlike Perl or Python — an un-flagged `$` matches only the very end of the
 * input, never before a trailing newline. `\d`, `\w` and `[0-9a-f]` admit no control character,
 * so a forged `appVersion` with an ESC in it already fails on the shape.
 */
function matching(
  raw: unknown,
  field: string,
  re: RegExp,
  what: string,
): Validated<string> {
  if (typeof raw === 'string' && re.test(raw)) return { ok: true, value: raw }
  return fail(field, `${field} must be ${what}.`)
}

/**
 * The user's own words. Gates the dialog's Send button AND runs again in main and in the
 * Lambda — the same code, so the three can never disagree about what "valid" means.
 *
 * Returns the draft with control characters stripped, surrounding whitespace trimmed and blank
 * optionals dropped. Content is NEVER shortened: an over-long description is a rejection, not a
 * truncation. A stripped ESC is not content being shortened — see the header's law.
 */
export function validateDraft(input: unknown): Validated<FeedbackDraft> {
  if (!isRecord(input)) return fail('draft', 'A report is required.')

  const type = oneOf(input.type, 'type', FEEDBACK_TYPES)
  if (!type.ok) return type

  const description = blockText(
    input.description,
    'description',
    MAX_DESCRIPTION,
    MIN_DESCRIPTION,
  )
  if (!description.ok) return description

  // A retired-field `title`/`contact` from an older client is dropped, never rejected: the
  // constructed value below carries only the fields the contract still has.
  return {
    ok: true,
    value: {
      type: type.value,
      description: description.value,
    },
  }
}

/** What the client says about itself. Every field is required — main always knows all of them. */
export function validateEnv(input: unknown): Validated<FeedbackEnv> {
  if (!isRecord(input)) return fail('env', 'env is required.')

  const appVersion = matching(
    input.appVersion,
    'env.appVersion',
    APP_VERSION_RE,
    'a semver version',
  )
  if (!appVersion.ok) return appVersion
  const channel = oneOf(input.channel, 'env.channel', APP_CHANNEL_TAGS)
  if (!channel.ok) return channel
  const updateChannel = oneOf(
    input.updateChannel,
    'env.updateChannel',
    UPDATE_CHANNELS,
  )
  if (!updateChannel.ok) return updateChannel

  // The remaining fields are free-form runtime strings (`process.platform`, `os.release()`,
  // `process.versions.*`): present, bounded, and SINGLE-LINE — `lineText` rejects any control
  // or invisible character outright, because these values are printed straight into the owner's
  // terminal by the triage CLI and none of them can legitimately carry one.
  const platform = lineText(input.platform, 'env.platform', MAX_ENV_FIELD)
  if (!platform.ok) return platform
  const osRelease = lineText(input.osRelease, 'env.osRelease', MAX_ENV_FIELD)
  if (!osRelease.ok) return osRelease
  const arch = lineText(input.arch, 'env.arch', MAX_ENV_FIELD)
  if (!arch.ok) return arch
  const electron = lineText(input.electron, 'env.electron', MAX_ENV_FIELD)
  if (!electron.ok) return electron
  const chrome = lineText(input.chrome, 'env.chrome', MAX_ENV_FIELD)
  if (!chrome.ok) return chrome
  const node = lineText(input.node, 'env.node', MAX_ENV_FIELD)
  if (!node.ok) return node

  return {
    ok: true,
    value: {
      appVersion: appVersion.value,
      channel: channel.value,
      updateChannel: updateChannel.value,
      platform: platform.value,
      osRelease: osRelease.value,
      arch: arch.value,
      electron: electron.value,
      chrome: chrome.value,
      node: node.value,
    },
  }
}

/**
 * The attached slice's metadata. The BYTES never pass through here — this is what lets the
 * server size the presign policy (`content-length-range 1..MAX_UPLOAD_BYTES`) before a single
 * byte of log exists in the cloud.
 *
 * An EMPTY window is not an attachment: main sends `log: null` rather than a zero-line slice,
 * so `lines >= 1` and `bytes >= 1` are both real conditions here.
 */
export function validateLogMeta(input: unknown): Validated<LogSliceMeta> {
  if (!isRecord(input)) return fail('log', 'log must be an object or null.')

  const bytes = integerInRange(input.bytes, 'log.bytes', 1, MAX_UPLOAD_BYTES)
  if (!bytes.ok) return bytes
  const lines = integerInRange(input.lines, 'log.lines', 1, MAX_SLICE_LINES)
  if (!lines.ok) return lines
  const dropped = integerInRange(input.dropped, 'log.dropped', 0, Number.MAX_SAFE_INTEGER)
  if (!dropped.ok) return dropped
  const fromMs = integerInRange(input.fromMs, 'log.fromMs', 0, Number.MAX_SAFE_INTEGER)
  if (!fromMs.ok) return fromMs
  const toMs = integerInRange(input.toMs, 'log.toMs', 0, Number.MAX_SAFE_INTEGER)
  if (!toMs.ok) return toMs
  // The span is a span: a slice cannot end before it starts.
  if (toMs.value < fromMs.value)
    return fail('log.toMs', 'log.toMs must be at or after log.fromMs.')
  const sha256 = matching(input.sha256, 'log.sha256', SHA256_HEX_RE, '64 hex characters')
  if (!sha256.ok) return sha256

  return {
    ok: true,
    value: {
      bytes: bytes.value,
      lines: lines.value,
      dropped: dropped.value,
      fromMs: fromMs.value,
      toMs: toMs.value,
      sha256: sha256.value,
    },
  }
}

/**
 * The attached DUMP's metadata (JOS-296) — `validateLogMeta`'s twin, and bounded in the same
 * places for the same reason: these numbers size the presign policy
 * (`content-length-range 1..MAX_UPLOAD_BYTES`) before a byte of the dump exists in the cloud.
 *
 * `updatedAt` is bounded as any epoch-ms stamp is and NOT compared against the server's clock:
 * it is the file's mtime as the CLIENT's filesystem reports it, and a machine with a wrong clock
 * is a machine whose bug report we still want. It is diagnostic, never authoritative —
 * `received_at` is the authority for when anything happened, exactly as with `clientTs`.
 *
 * An EMPTY dump is not an attachment: main sends `inventory: null` rather than a zero-row dump,
 * so `lines >= 1` and `bytes >= 1` are both real conditions here.
 */
export function validateInventoryMeta(input: unknown): Validated<InventoryDumpMeta> {
  if (!isRecord(input)) return fail('inventory', 'inventory must be an object or null.')

  const bytes = integerInRange(input.bytes, 'inventory.bytes', 1, MAX_UPLOAD_BYTES)
  if (!bytes.ok) return bytes
  const lines = integerInRange(input.lines, 'inventory.lines', 1, MAX_INVENTORY_LINES)
  if (!lines.ok) return lines
  const updatedAt = integerInRange(
    input.updatedAt,
    'inventory.updatedAt',
    0,
    Number.MAX_SAFE_INTEGER,
  )
  if (!updatedAt.ok) return updatedAt
  const sha256 = matching(input.sha256, 'inventory.sha256', SHA256_HEX_RE, '64 hex characters')
  if (!sha256.ok) return sha256

  return {
    ok: true,
    value: {
      bytes: bytes.value,
      lines: lines.value,
      updatedAt: updatedAt.value,
      sha256: sha256.value,
    },
  }
}

/**
 * AN OPTIONAL ATTACHMENT, in ONE place for both of them.
 *
 * `null` and ABSENT are the same statement — "nothing attached" — and this is the only function
 * in the contract that says so. That matters more since there are two attachments than it did
 * when there was one: the rule that makes a new optional field ADDITIVE (an old client omits it,
 * a new server reads the omission as null) is now written down once rather than copied per
 * field, so the next attachment cannot accidentally be spelled as required.
 */
function optionalMeta<T>(
  raw: unknown,
  validate: (v: unknown) => Validated<T>,
): Validated<T | null> {
  if (raw === null || raw === undefined) return { ok: true, value: null }
  return validate(raw)
}

/**
 * The whole request, as the Lambda sees it (§8.3 step 2). Cheapest checks first; the first
 * failure wins and names its field.
 *
 * `clientTs` is accepted as any finite timestamp ON PURPOSE — it is the CLIENT's clock, kept
 * only for skew diagnostics. The authoritative time is `receivedAt`, written server-side.
 */
export function validateSubmit(input: unknown): Validated<SubmitRequest> {
  if (!isRecord(input)) return fail('body', 'A JSON object body is required.')
  if (input.v !== FEEDBACK_API_VERSION)
    return fail('v', `v must be ${FEEDBACK_API_VERSION}.`)

  const draft = validateDraft(input.draft)
  if (!draft.ok) return draft
  const env = validateEnv(input.env)
  if (!env.ok) return env

  const installId = matching(input.installId, 'installId', UUID_V4_RE, 'a v4 UUID')
  if (!installId.ok) return installId
  const clientReportId = matching(
    input.clientReportId,
    'clientReportId',
    UUID_V4_RE,
    'a v4 UUID',
  )
  if (!clientReportId.ok) return clientReportId

  if (typeof input.clientTs !== 'number' || !Number.isFinite(input.clientTs))
    return fail('clientTs', 'clientTs must be a number.')

  // BOTH ATTACHMENTS, read the same way (JOS-296): absent and null are the same answer, and a
  // present-but-malformed one is a named 400 rather than a silently dropped field.
  const log = optionalMeta(input.log, validateLogMeta)
  if (!log.ok) return log
  const inventory = optionalMeta(input.inventory, validateInventoryMeta)
  if (!inventory.ok) return inventory

  return {
    ok: true,
    value: {
      v: FEEDBACK_API_VERSION,
      draft: draft.value,
      env: env.value,
      installId: installId.value,
      clientReportId: clientReportId.value,
      clientTs: input.clientTs,
      log: log.value,
      inventory: inventory.value,
    },
  }
}
