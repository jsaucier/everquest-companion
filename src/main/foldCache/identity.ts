// ============================================================================
// identity.ts — IS THIS THE SAME LOG, UP TO THE SAME BYTE? (JOS-208)
// ============================================================================
//
// The checkpoint claims: "the fold state in this file is what you get by folding bytes [0, b) of
// the log at <path>". Everything here exists to doubt that claim cheaply, and to be WRONG IN ONE
// DIRECTION ONLY — a false "different" costs a cold start, a false "same" costs a wrong world
// model, so every judgement call goes the first way.
//
// WHAT CAN GO WRONG BETWEEN TWO LAUNCHES, and which check catches it:
//
//   * The player archived the log and started a fresh one with the same name.
//         → `headHash` (the first 64 KB) differs. Caught before anything else is read.
//   * The file was truncated (a disk-full write, a manual clear, EQ reinstalled).
//         → it is now SHORTER than `b`. Caught by the size floor, with no reads at all.
//   * Truncated and then REGROWN past `b` — the nastiest one, because the size test passes.
//         → `shoulderHash` (the 64 KB ENDING at b) and `lastLineHash` differ. This is the check
//           the whole scheme turns on: the bytes immediately before the split are the bytes the
//           fold state most directly describes.
//   * Somebody edited the middle — an editor rewrote line endings, a sync client merged two
//     machines' copies, a quarantine restored an older body.
//         → the K sampled block digests. NOT a proof, and this file says so: a targeted edit
//           between two samples would survive. It is a smoke detector over the middle, while the
//           head and the shoulder are the load-bearing anchors.
//   * A DIFFERENT character's log at the same path (two installs, a renamed file).
//         → `characterKey`.
//
// WHY SAMPLES AND NOT A DIGEST OF ALL OF [0, b): because a full digest is exactly the read this
// ticket exists to avoid. Reading 600 MB to prove we may skip reading 600 MB is a joke with a slow
// punchline — and it is the COLD READ, not our compute, that the stutter report blamed. The bounded
// read below is ~160 KB regardless of how large the log is.
//
// ONE ALGORITHM, TWO ARMS. Everything is written against a `ReadRange` seam — "give me these
// bytes" — so the async arm (startup, which must not block the main thread) and the sync arm (the
// quit path, which cannot await) run the SAME arithmetic over the same offsets. Two copies of this
// would be two chances to disagree about where a shoulder starts, and a disagreement between the
// writer and the reader is a permanent cold start nobody would ever diagnose.

import { createHash } from 'node:crypto'
import { closeSync, openSync, readSync, statSync } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import { open, stat } from 'node:fs/promises'
import type { LogIdentity } from './format'

/** The head and shoulder windows. 64 KB each — the design's number. */
export const ANCHOR_BYTES = 64 * 1024
/** How many block samples across the middle, and how big each is. */
export const SAMPLE_BLOCKS = 8
export const SAMPLE_BYTES = 4 * 1024
/** The longest line this will hash whole. EQ lines are ~100 bytes; 8 KB is absurdly generous. */
const MAX_LINE_BYTES = 8 * 1024

/** "Give me `len` bytes at `off`" — the seam the two arms differ by, and the only thing they do. */
export type ReadRange = (off: number, len: number) => Buffer

/**
 * The sample offsets for a prefix of length `b`, ascending — a PURE FUNCTION OF `b`, so the reader
 * computes the same list the writer did without the file having to carry it (it carries it anyway,
 * and a disagreement between the two is itself a reason to refuse).
 *
 * Offsets inside the head or shoulder window are excluded by construction: hashing bytes twice buys
 * nothing, and a log short enough for the two windows to meet should produce no samples rather than
 * a pile of degenerate ones.
 */
export function sampleOffsets(b: number): number[] {
  const out: number[] = []
  const lo = ANCHOR_BYTES
  const hi = b - ANCHOR_BYTES - SAMPLE_BYTES
  if (hi <= lo) return out
  for (let i = 1; i <= SAMPLE_BLOCKS; i++) {
    // Integer arithmetic on an exact rational, so two builds on two machines compute one list.
    const off = lo + Math.floor(((hi - lo) * i) / (SAMPLE_BLOCKS + 1))
    if (out[out.length - 1] !== off) out.push(off)
  }
  return out
}

const hex = (b: Buffer): string => createHash('sha256').update(b).digest('hex')

/**
 * The exact last COMPLETE line before `b`, hashed.
 *
 * "Complete" means what `scanLog` means by it: `b` is always just past a newline, so the line is
 * the bytes between the previous newline and `b`. A regrown file whose shoulder somehow collided
 * would still have to reproduce this line byte for byte at this exact offset — the tightest single
 * anchor available for the price of one small read.
 */
function lastLineHash(read: ReadRange, b: number): string {
  const want = Math.min(MAX_LINE_BYTES, b)
  if (want <= 0) return ''
  const win = read(b - want, want)
  // The byte just before `b` is the newline that ENDS the line, so the search starts one earlier.
  let start = win.length - 1
  while (start > 0 && win[start - 1] !== 0x0a) start--
  return hex(win.subarray(start))
}

/** What an identity block is ABOUT — the facts that are not hashes. */
export interface IdentitySubject {
  /** The file's size when this was computed. */
  size: number
  /** The byte offset the fold state describes. */
  b: number
  characterKey: string
  lastEventTs: number
}

/** THE ONE ALGORITHM. Both arms below are ten lines of file handling around this call. */
export function identityFrom(read: ReadRange, subject: IdentitySubject): LogIdentity {
  const { b } = subject
  const anchorLen = Math.min(ANCHOR_BYTES, b)
  return {
    characterKey: subject.characterKey,
    b,
    size: subject.size,
    headHash: hex(read(0, anchorLen)),
    shoulderHash: hex(read(b - anchorLen, anchorLen)),
    lastLineHash: lastLineHash(read, b),
    blocks: sampleOffsets(b).map((off) => ({ off, hash: hex(read(off, SAMPLE_BYTES)) })),
    lastEventTs: subject.lastEventTs
  }
}

/** Why an identity was refused. All land on the cold path; the name is for the log line. */
export type IdentityMismatch =
  | 'unreadable'
  | 'character'
  | 'shrank'
  | 'head'
  | 'shoulder'
  | 'last-line'
  | 'block'
  | 'sample-offsets'

export type IdentityCheck = { ok: true } | { ok: false; reason: IdentityMismatch }

/**
 * Compare a stored identity against the file as it is now, using the SAME algorithm that wrote it:
 * recompute the whole block and diff it field by field.
 *
 * Recomputing all of it rather than short-circuiting after the first anchor costs one extra ~64 KB
 * read and buys the property that the comparison cannot drift from the construction — there is one
 * place that decides what a shoulder is.
 */
export function compareIdentity(read: ReadRange, size: number, want: LogIdentity): IdentityCheck {
  // A log only ever grows. Anything else — a truncation, a rotation, a restore from backup — means
  // the bytes this checkpoint describes are gone, whatever now sits at those offsets.
  if (size < want.b) return { ok: false, reason: 'shrank' }
  const expected = sampleOffsets(want.b)
  // A file claiming offsets `b` does not imply was not written by this code, and its other numbers
  // are therefore not evidence of anything either.
  if (expected.length !== want.blocks.length || expected.some((off, i) => off !== want.blocks[i]?.off)) {
    return { ok: false, reason: 'sample-offsets' }
  }
  const now = identityFrom(read, { size, b: want.b, characterKey: want.characterKey, lastEventTs: want.lastEventTs })
  if (now.headHash !== want.headHash) return { ok: false, reason: 'head' }
  if (now.shoulderHash !== want.shoulderHash) return { ok: false, reason: 'shoulder' }
  if (now.lastLineHash !== want.lastLineHash) return { ok: false, reason: 'last-line' }
  for (let i = 0; i < want.blocks.length; i++) {
    if (now.blocks[i]?.hash !== want.blocks[i]?.hash) return { ok: false, reason: 'block' }
  }
  return { ok: true }
}

// ------------------------------------------------------------------------------- the async arm

/** Every range `identityFrom` will ask for, at `b` — so the async arm can prefetch exactly those. */
function rangesFor(b: number): [number, number][] {
  const anchorLen = Math.min(ANCHOR_BYTES, b)
  const lineLen = Math.min(MAX_LINE_BYTES, b)
  const out: [number, number][] = [
    [0, anchorLen],
    [b - anchorLen, anchorLen],
    [b - lineLen, lineLen]
  ]
  for (const off of sampleOffsets(b)) out.push([off, SAMPLE_BYTES])
  return out
}

/**
 * Read every range `identityFrom` will ask for UP FRONT, then run it over the buffers.
 *
 * `identityFrom` is synchronous by design — it is the shared algorithm, and threading a promise
 * through it would mean two copies of it. The ranges are bounded and few (two anchors, one line
 * window, at most eight blocks), so "fetch them all, then hash" costs one pass over ~160 KB and
 * keeps the async and sync arms provably the same code.
 */
async function withAsyncReader<T>(logPath: string, b: number, fn: (read: ReadRange) => T): Promise<T | null> {
  let fh: FileHandle | null = null
  try {
    fh = await open(logPath, 'r')
    const cache = new Map<string, Buffer>()
    for (const [off, len] of rangesFor(b)) {
      if (len <= 0) continue
      const buf = Buffer.alloc(len)
      const { bytesRead } = await fh.read(buf, 0, len, Math.max(0, off))
      cache.set(`${off}:${len}`, buf.subarray(0, bytesRead))
    }
    return fn((off, len) => cache.get(`${off}:${len}`) ?? Buffer.alloc(0))
  } catch {
    return null
  } finally {
    await fh?.close()
  }
}

/**
 * Build the identity block for `logPath` at split offset `b`. Null when the file cannot be read or
 * is shorter than `b` — a checkpoint about bytes that do not exist is never written.
 */
export async function computeIdentity(
  logPath: string,
  b: number,
  characterKey: string,
  lastEventTs: number
): Promise<LogIdentity | null> {
  let size: number
  try {
    size = (await stat(logPath)).size
  } catch {
    return null
  }
  if (b <= 0 || size < b) return null
  return withAsyncReader(logPath, b, (read) => identityFrom(read, { size, b, characterKey, lastEventTs }))
}

/** Re-read the anchors and compare. Cheapest doubt first: the key, then a `stat`, then the file. */
export async function verifyIdentity(
  logPath: string,
  want: LogIdentity,
  characterKey: string
): Promise<IdentityCheck> {
  if (want.characterKey !== characterKey) return { ok: false, reason: 'character' }
  let size: number
  try {
    size = (await stat(logPath)).size
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
  if (size < want.b) return { ok: false, reason: 'shrank' }
  const res = await withAsyncReader(logPath, want.b, (read) => compareIdentity(read, size, want))
  return res ?? { ok: false, reason: 'unreadable' }
}

// -------------------------------------------------------------------------------- the sync arm

/**
 * The SYNC arm, and the one caller that needs it: the quit path.
 *
 * `app.on('window-all-closed')` is a synchronous teardown (index.ts's `teardownStep` — and it is
 * synchronous on purpose, because a step that can hang is a step that can leave a windowless zombie
 * holding the single-instance lock). A promise started there races the process's own exit. So the
 * checkpoint write is synchronous, and this is its identity half: the SAME `identityFrom`, over a
 * reader that blocks. Bounded to ~160 KB of reads and a few hashes — microseconds beside the file
 * write it precedes.
 */
export function computeIdentitySync(
  logPath: string,
  b: number,
  characterKey: string,
  lastEventTs: number
): LogIdentity | null {
  let size: number
  try {
    size = statSync(logPath).size
  } catch {
    return null
  }
  if (b <= 0 || size < b) return null
  let fd: number | null = null
  try {
    fd = openSync(logPath, 'r')
    const handle = fd
    const read: ReadRange = (off, len) => {
      if (len <= 0) return Buffer.alloc(0)
      const buf = Buffer.alloc(len)
      const got = readSync(handle, buf, 0, len, Math.max(0, off))
      return buf.subarray(0, got)
    }
    return identityFrom(read, { size, b, characterKey, lastEventTs })
  } catch {
    return null
  } finally {
    if (fd !== null) closeSync(fd)
  }
}
