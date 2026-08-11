// ============================================================================
// format.ts — THE CHECKPOINT CONTAINER: one binary file, and how to doubt it (JOS-208).
// ============================================================================
//
// BINARY END TO END, and that is a store law rather than a preference. This repo has twice had an
// electron-store JSON corrupted by a BOM written through a text path (AGENTS.md), and a checkpoint
// is a much worse thing to write through a text encoder: V8 structured-clone blobs are arbitrary
// bytes, so any encoding step at all is a lossy step. Nothing in this file — or in anything that
// calls it — converts a byte to a character. `Buffer` in, `Buffer` out.
//
// THE LAYOUT (all integers little-endian, matching the V8 blobs they frame):
//
//     magic          8   'EQCFOLD1' ascii — the ONLY 8 bytes a wrong file can be rejected by cheaply
//     schemaVersion u32  CACHE_SCHEMA_VERSION (below)
//     headerLen     u32
//     header       var   UTF-8 JSON: log identity + FOLD_SEMANTICS + the module directory (each
//                        entry carrying that module's DERIVED shape hash — the two invalidation
//                        axes, schema.ts and semantics.ts)
//     headerDigest  32   sha256(header bytes)
//     ─ per module, in header order ────────────────────────────────────────────
//     blobLen       u32
//     blob         var   v8.serialize() of that module's fold state
//     blobDigest    32   sha256(blob bytes)
//     ─ end ────────────────────────────────────────────────────────────────────
//     fileDigest    32   sha256(every byte before it)
//
// THE HEADER IS JSON INSIDE A BINARY CONTAINER, and that is a deliberate split rather than a
// half-measure. The header is a small, evolving, HUMAN-DIAGNOSABLE record — "which log, which
// bytes, which build" is the first thing anyone reading a divergence report wants — while the
// blobs are opaque machine state whose encoding is V8's business. Framing the header with an
// explicit length and its own digest means a header that JSON cannot parse is caught by the digest
// first, and a truncated file never reaches the parser at all.
//
// THREE DIGESTS, THREE DIFFERENT DOUBTS: the header's proves the identity block was not scrambled
// before we compare it to the log; each blob's proves that ONE module's state is intact
// independently of the others (a partial container can still be refused module by module rather
// than as a lump); the file's proves nothing was appended, truncated, or interleaved by a crash
// mid-write. Any of them failing is the same answer — discard, cold-replay — which is why none of
// them needs to be expensive to be worth having.

import { createHash } from 'node:crypto'
import { deserialize, serialize } from 'node:v8'

/**
 * THE CONTAINER's own version — the framing above, and nothing else.
 *
 * Distinct from `FOLD_INPUTS_HASH` (what the fold is made of) and from each module's
 * `foldStateVersion` (what one blob means). Three axes because they change for three unrelated
 * reasons: this one moves when a field moves in the layout, and a mismatch is refused without
 * even looking at the rest.
 */
export const CACHE_SCHEMA_VERSION = 1

const MAGIC = Buffer.from('EQCFOLD1', 'ascii')
const DIGEST_BYTES = 32

/** The log-identity block — see identity.ts, which computes and verifies it. */
export interface LogIdentity {
  /** `name@server`, lowercased. A checkpoint is per character, and this says which. */
  characterKey: string
  /** The byte offset the fold state describes: state == fold(bytes [0, b)). */
  b: number
  /** The file's size when the checkpoint was written. Never less than `b`. */
  size: number
  /** sha256 of the first min(64KB, b) bytes — "is this the same log file at all". */
  headHash: string
  /** sha256 of the 64KB ending at `b` — "do the bytes right before the split still match". */
  shoulderHash: string
  /** sha256 of the exact last complete line before `b`. */
  lastLineHash: string
  /** K block digests at deterministic offsets in [0, b) — the middle, sampled. */
  blocks: { off: number; hash: string }[]
  /** The `ts` of the last event folded. Not a validity test; a diagnosis aid and a sanity floor. */
  lastEventTs: number
}

/** One module's slot in the container. */
export interface ModuleBlobMeta {
  id: string
  /**
   * The DERIVED hash of that module's shape declaration (schema.ts) at write time — the ENCODING
   * axis. Any difference from what the running build declares discards the whole cache.
   */
  shapeHash: string
}

export interface CacheHeader {
  /**
   * The SEMANTICS axis (semantics.ts): what the fold MEANT when this was written. A shape can be
   * unchanged while the computation behind it moved, and this is the only thing that says so.
   */
  foldSemantics: number
  /** The event `seq` the fold had reached at `b`. The tail replay continues from here. */
  seq: number
  /** When this checkpoint was written (wall clock, ms). Diagnostic only — never a validity test. */
  writtenAtMs: number
  identity: LogIdentity
  modules: ModuleBlobMeta[]
}

export interface DecodedCache {
  header: CacheHeader
  /** Module id → its V8-deserialized fold state, in header order. */
  blobs: Map<string, unknown>
}

/** Why a container was refused. Every one of these lands on the cold path. */
export type CacheDecodeError =
  | 'too-small'
  | 'bad-magic'
  | 'schema-version'
  | 'header-digest'
  | 'header-json'
  | 'file-digest'
  | 'blob-digest'
  | 'blob-decode'
  | 'truncated'

export type DecodeResult = { ok: true; value: DecodedCache } | { ok: false; error: CacheDecodeError }

const sha256 = (b: Buffer): Buffer => createHash('sha256').update(b).digest()

/**
 * Encode one checkpoint. Throws only if V8 refuses a state — which is the plain-data audit's
 * subject and a programming error rather than a runtime condition (a function or a WeakMap in
 * fold state cannot be serialized by anyone).
 */
export function encodeCache(header: CacheHeader, states: Map<string, unknown>): Buffer {
  const headerBytes = Buffer.from(JSON.stringify(header), 'utf8')
  const parts: Buffer[] = []
  const schema = Buffer.alloc(8)
  schema.writeUInt32LE(CACHE_SCHEMA_VERSION, 0)
  schema.writeUInt32LE(headerBytes.length, 4)
  parts.push(MAGIC, schema, headerBytes, sha256(headerBytes))
  for (const meta of header.modules) {
    const blob = serialize(states.get(meta.id))
    const len = Buffer.alloc(4)
    len.writeUInt32LE(blob.length, 0)
    parts.push(len, blob, sha256(blob))
  }
  const body = Buffer.concat(parts)
  return Buffer.concat([body, sha256(body)])
}

/**
 * Decode one checkpoint, doubting every step. Never throws: a corrupt file is a RESULT, because
 * the caller's response to every failure is the same one it has for a missing file.
 */
export function decodeCache(buf: Buffer): DecodeResult {
  if (buf.length < MAGIC.length + 8 + DIGEST_BYTES * 2) return { ok: false, error: 'too-small' }
  if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) return { ok: false, error: 'bad-magic' }
  // THE WHOLE-FILE DIGEST FIRST. A crash mid-rename leaves a plausible prefix, and checking the
  // cheapest structural claims against a file we have not yet proved is a file is how a decoder
  // ends up reasoning about someone else's bytes.
  const body = buf.subarray(0, buf.length - DIGEST_BYTES)
  if (!sha256(body).equals(buf.subarray(buf.length - DIGEST_BYTES))) return { ok: false, error: 'file-digest' }
  if (buf.readUInt32LE(MAGIC.length) !== CACHE_SCHEMA_VERSION) return { ok: false, error: 'schema-version' }

  const head = readHeader(buf, body)
  if ('error' in head) return { ok: false, error: head.error }
  return readBlobs(buf, body, head.header, head.next)
}

/** The framed, digested, parsed, shape-checked header — or the doubt that stopped it. */
function readHeader(
  buf: Buffer,
  body: Buffer
): { header: CacheHeader; next: number } | { error: CacheDecodeError } {
  const headerLen = buf.readUInt32LE(MAGIC.length + 4)
  let p = MAGIC.length + 8
  if (p + headerLen + DIGEST_BYTES > body.length) return { error: 'truncated' }
  const headerBytes = buf.subarray(p, p + headerLen)
  p += headerLen
  if (!sha256(headerBytes).equals(buf.subarray(p, p + DIGEST_BYTES))) return { error: 'header-digest' }
  p += DIGEST_BYTES
  let header: CacheHeader
  try {
    header = JSON.parse(headerBytes.toString('utf8')) as CacheHeader
  } catch {
    return { error: 'header-json' }
  }
  if (!isHeader(header)) return { error: 'header-json' }
  return { header, next: p }
}

/** Each module's length-prefixed, digested blob, in header order. */
function readBlobs(buf: Buffer, body: Buffer, header: CacheHeader, from: number): DecodeResult {
  let p = from
  const blobs = new Map<string, unknown>()
  for (const meta of header.modules) {
    if (p + 4 > body.length) return { ok: false, error: 'truncated' }
    const len = buf.readUInt32LE(p)
    p += 4
    if (p + len + DIGEST_BYTES > body.length) return { ok: false, error: 'truncated' }
    const blob = buf.subarray(p, p + len)
    p += len
    if (!sha256(blob).equals(buf.subarray(p, p + DIGEST_BYTES))) return { ok: false, error: 'blob-digest' }
    p += DIGEST_BYTES
    try {
      blobs.set(meta.id, deserialize(blob))
    } catch {
      return { ok: false, error: 'blob-decode' }
    }
  }
  // Trailing bytes past the last blob mean this is not the file its own header describes.
  if (p !== body.length) return { ok: false, error: 'truncated' }
  return { ok: true, value: { header, blobs } }
}

/**
 * A structural check on the parsed header, because JSON.parse proves nothing about shape and the
 * next thing to touch these fields is arithmetic against a real file's byte offsets.
 */
function isHeader(h: unknown): h is CacheHeader {
  if (typeof h !== 'object' || h === null) return false
  const c = h as Partial<CacheHeader>
  if (typeof c.foldSemantics !== 'number' || typeof c.seq !== 'number') return false
  if (!Array.isArray(c.modules)) return false
  if (!c.modules.every((m) => typeof m?.id === 'string' && typeof m?.shapeHash === 'string')) return false
  return isIdentity(c.identity)
}

/** The identity block's own shape. Split from `isHeader` to stay under the complexity ceiling. */
function isIdentity(id: unknown): id is LogIdentity {
  if (typeof id !== 'object' || id === null) return false
  const c = id as Partial<LogIdentity>
  if (typeof c.characterKey !== 'string' || typeof c.b !== 'number' || typeof c.size !== 'number') return false
  if (typeof c.headHash !== 'string' || typeof c.shoulderHash !== 'string' || typeof c.lastLineHash !== 'string') {
    return false
  }
  if (!Array.isArray(c.blocks)) return false
  return c.blocks.every((b) => typeof b?.off === 'number' && typeof b?.hash === 'string')
}
