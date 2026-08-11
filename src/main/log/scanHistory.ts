import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import { parseEvent } from './parser'
import { createSlicer, type Slicer } from './replaySlicer'
import type { LogBus } from './bus'

export interface ScanResult {
  /**
   * Byte offset (into the file) of the end of the last complete line processed.
   * The live tailer resumes here so no bytes appended during the scan are lost
   * and none are double-read. See FIX 1 in AGENTS notes.
   */
  endOffset: number
  /**
   * The next sequence number to use. The scan stamps events [startSeq, seq); the
   * tailer continues from here so the whole scan+tail stream is one monotonic
   * sequence for the character.
   */
  seq: number
  /**
   * The FROZEN EOF this scan bounded itself by — the file's size at the moment it started, before
   * a byte was read (JOS-57 scope addition).
   *
   * It is not `endOffset`, and the difference is at most one incomplete trailing line — which is
   * exactly why the cold-read delta uses THIS one. The persisted mark is the tailer's offset, and
   * the tailer's offset is the file's SIZE as of its last read; subtracting `endOffset` from it
   * would go a few bytes negative every time the log happened to end mid-line, and a "the log
   * rotated" verdict would be handed out for a partial line. Two observations of the same
   * quantity, taken the same way, subtract cleanly.
   */
  size: number
  /**
   * HOW LONG THE FIRST MEGABYTE TOOK TO ARRIVE, ms (JOS-57 scope addition) — the cold-disk hint.
   *
   * WHAT MAKES IT A DISK MEASUREMENT and not a fold measurement: the read stream's high-water mark
   * IS a megabyte, so the first chunk to satisfy this is the first read, and it is stamped BEFORE
   * that chunk is folded. Nothing this app does with the bytes is inside the number; what is
   * inside it is the time the operating system — and anything sitting between it and the disk, an
   * on-access virus scanner being the hypothesis this exists to test — took to hand them over.
   *
   * Absent when the file is smaller than a megabyte: a partial read is a different measurement
   * wearing this one's name, and there is no cold-read question to ask of a log that small.
   */
  firstMbMs?: number
}

/** The read stream's high-water mark, and the size of the "first MB" measured above. One constant
 *  so the two can never be given different numbers — the measurement's whole claim is that it
 *  lands on a chunk boundary. */
const READ_CHUNK_BYTES = 1 << 20

/** Everything about a scan that is not "which file, which bus, from which seq". */
export interface ScanOptions {
  /** Parser ruleset id (defaults to the classic EQ profile). */
  profileId?: string
  /**
   * The cooperative scheduler (docs/plans/chunked-replay.md §1). Defaults to a REPLAY_SLICE_MS
   * budget at REPLAY_DUTY — which is what production always wants, and is what session.ts passes
   * explicitly so it can read the duty the slicer measured. The other caller is the equivalence
   * test, which passes `unchunkedSlicer()` to fold the same bytes with no yielding at all and
   * compare. There is deliberately no environment variable behind this: see replaySlicer.ts.
   */
  slicer?: Slicer
  /**
   * THE TAIL REPLAY'S FIRST BYTE (JOS-208). Absent ⇒ 0, which is every pre-checkpoint caller and
   * still the default.
   *
   * When a checkpoint restored the fold to byte B, the scan must read [B, EOF) and nothing before
   * it — that IS the feature. It is the same seam the live handoff already uses in the other
   * direction: `endOffset` comes back including this offset, so the tailer's start point is
   * computed exactly as it always was and the "a line can be folded neither twice nor never"
   * property is unchanged. It must be the end of a COMPLETE line, which is the only kind of offset
   * anything in this app ever produces (`ScanResult.endOffset`, `Tailer.checkpointOffset()`).
   */
  startOffset?: number
  /**
   * WHERE TO STOP, exclusive. Absent ⇒ the frozen EOF, which is every production caller.
   *
   * THE DIFFERENTIAL HARNESS IS THE ONLY CALLER THAT PASSES IT (tests/foldCheckpoint*), and it
   * needs it for the same reason the equivalence test needs `unchunkedSlicer()`: proving
   * `restore(checkpoint(fold(prefix))) + fold(tail) == fold(prefix + tail)` requires folding a
   * PREFIX, and a prefix is not a thing production ever wants. A parameter rather than an
   * environment variable, for the reason replaySlicer.ts states about its own seam.
   */
  endOffset?: number
}

/**
 * The byte-splitter's carry-over state, threaded across chunks by `consumeChunk`.
 *
 * Byte-accurate line splitting. We track bytes consumed (not chars) so the
 * returned offset lines up exactly with the file for the tailer handoff.
 * `endOffset` advances to just past each newline of a fully-processed line.
 */
interface SplitState {
  endOffset: number
  /** Bytes buffered for the current, not-yet-terminated line. */
  pendingBytes: number
  /** Decoded text of the current partial line. */
  leftover: string
}

/**
 * Split ONE chunk into complete lines, handing each to `handle`, and carry the trailing
 * partial line into `st` for the next chunk. Extracted from scanLog's loop body so the byte
 * accounting lives in one place; the arithmetic is unchanged.
 *
 * CHUNKED (docs/plans/chunked-replay.md §1): the yield lives HERE, per line, not per read chunk.
 * A 1 MB chunk is ~75 ms of folding on a real log — measured, and four times the whole slice
 * budget — so a scheduler that could only pause between chunks could not honour a 12 ms budget
 * at all. The check happens AFTER the line is folded, so a single monster event overshoots the
 * budget and then yields, rather than being split (it cannot be split) or skipped.
 *
 * Nothing else changes: the byte accounting, the order and the `handle` calls are exactly as they
 * were, which is what lets the equivalence test compare the two arms byte for byte.
 */
async function consumeChunk(
  buf: Buffer,
  st: SplitState,
  handle: (raw: string) => void,
  slicer: Slicer
): Promise<void> {
  let lineStart = 0
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] !== 0x0a) continue // find '\n'
    // Bytes for this line = pending (from prior chunks) + [lineStart..i] incl. '\n'.
    const segBytes = i - lineStart + 1
    st.endOffset += st.pendingBytes + segBytes
    let raw = st.leftover + buf.toString('utf8', lineStart, i)
    if (raw.endsWith('\r')) raw = raw.slice(0, -1)
    if (raw) handle(raw)
    st.leftover = ''
    st.pendingBytes = 0
    lineStart = i + 1
    if (slicer.expired()) await slicer.yield()
  }
  // Carry the trailing partial line to the next chunk.
  if (lineStart < buf.length) {
    st.pendingBytes += buf.length - lineStart
    st.leftover += buf.toString('utf8', lineStart, buf.length)
  }
}

/**
 * Stream the log once and emit every canonical LogEvent onto the bus with
 * live:false. This is the historical feeder: it produces the exact same event
 * stream the live tailer will continue, so every consumer (loot/kills/levels/AA
 * reducers, the combat engine) is rebuilt from one parse pass instead of three
 * hand-synced pipelines.
 *
 * Streaming (FIX 2): reads via a byte stream with a chunk-based line splitter and
 * yields to the event loop periodically, so the Electron main process is never
 * blocked for the multi-second duration of a 68MB scan. Events are emitted in
 * strict file order.
 *
 * COOPERATIVELY SCHEDULED (docs/plans/chunked-replay.md §1): "periodically" used to mean "between
 * read chunks", which measured at 75 ms of main-loop stall per chunk. It now means "every
 * REPLAY_SLICE_MS of folding", which bounds the block directly — and, since JOS-50, each of those
 * pauses is a real REST rather than a `setImmediate`, so the fold cannot hold a core flat out for
 * the length of a replay either. See replaySlicer.ts for both constants and the measurements
 * behind them.
 *
 * Bounded (FIX 1): captures the file size S up front, processes only bytes [0, S),
 * and returns `endOffset` = the byte offset of the end of the last complete line
 * at or before S. The caller hands this to the tailer as its start offset for a
 * gapless handoff.
 *
 * THE LIVE HANDOFF IS UNAFFECTED BY SLICING, and this is the property that makes chunking safe.
 * There is no buffer-then-drain anywhere in this app: the scan reads to a FROZEN EOF (the size
 * captured above, before the first byte is read) and returns the byte offset of the last complete
 * line it consumed; session.ts then starts the Tailer AT that offset. Lines the game appends while
 * the scan runs land past S, are never read here, and are read by the tailer as its first bytes.
 * So a longer wall-clock scan simply means more bytes waiting for the tailer — never a line folded
 * twice, never one skipped, whatever the slice budget is.
 */
export async function scanLog(
  logPath: string,
  bus: LogBus,
  startSeq = 0,
  opts: ScanOptions = {}
): Promise<ScanResult> {
  let size: number
  try {
    size = (await stat(logPath)).size
  } catch {
    return { endOffset: 0, seq: startSeq, size: 0 }
  }
  const { from, stopAt } = scanWindow(size, opts)
  if (size === 0 || stopAt <= from) return { endOffset: from, seq: startSeq, size }

  let seq = startSeq

  const handle = (raw: string): void => {
    const ev = parseEvent(raw, seq, opts.profileId)
    if (!ev) return // not a log line at all (no timestamp)
    seq++
    bus.emit(ev, false)
  }

  // Byte-accurate line splitting (see SplitState / consumeChunk). `endOffset` starts at `from`,
  // not at zero: the offset this returns is an offset INTO THE FILE, and the tailer handoff is
  // arithmetic against it.
  const st: SplitState = { endOffset: from, pendingBytes: 0, leftover: '' }
  const slicer = opts.slicer ?? createSlicer()

  const stream = createReadStream(logPath, {
    start: from,
    end: stopAt - 1,
    highWaterMark: READ_CHUNK_BYTES
  })

  // The cold-disk clock (see ScanResult.firstMbMs), started at the last statement before the first
  // byte is asked for.
  const coldRead = startColdReadClock()

  try {
    for await (const chunk of stream) {
      const buf = chunk as Buffer
      coldRead.saw(buf.length)
      await consumeChunk(buf, st, handle, slicer)
    }
  } catch {
    // Partial results are still valid up to endOffset; fall through and return.
  }

  // A trailing partial line (no final newline) is intentionally NOT counted in
  // endOffset — the tailer will re-read those bytes and complete the line when
  // the game appends the rest, avoiding a dropped/duplicated final entry.
  return { endOffset: st.endOffset, seq, size, ...coldRead.result() }
}

/**
 * THE BYTE WINDOW this scan will read (JOS-208): `from` is where the fold's knowledge already
 * reaches — 0, or the byte a checkpoint restored the fold to — and `stopAt` is the frozen EOF, or
 * the harness's earlier stop. Both clamped rather than trusted: a stale checkpoint pointing past a
 * file that has since shrunk must produce an empty scan rather than a negative-length read (the
 * identity check will have refused it long before this anyway).
 *
 * `size` IS DELIBERATELY NOT NARROWED, which is the whole reason `stopAt` is a second name rather
 * than a reassignment. JOS-57's `ScanResult.size` IS the frozen EOF, and the cold-read delta
 * subtracts the persisted tail mark from it; narrowing it for a test-only prefix scan would hand
 * out a "the log rotated" verdict for a window the harness chose.
 */
function scanWindow(size: number, opts: ScanOptions): { from: number; stopAt: number } {
  const from = Math.max(0, Math.min(opts.startOffset ?? 0, size))
  const stopAt = opts.endOffset === undefined ? size : Math.max(from, Math.min(opts.endOffset, size))
  return { from, stopAt }
}

/**
 * THE COLD-DISK CLOCK (JOS-57's `ScanResult.firstMbMs`), as an object so `scanLog` stays under the
 * repo's complexity ceiling — the arithmetic is unchanged.
 *
 * `saw()` is called at the top of the read loop, between the read completing and anything being
 * parsed, so the fold is outside the number by construction rather than by estimate.
 *
 * A CHECKPOINTED LAUNCH STILL MEASURES IT, and it is still the right measurement (JOS-208): the
 * question is how long the OS took to hand over the first megabyte NOBODY HAD READ, and after a
 * restore that is the first megabyte of the TAIL — precisely the never-scanned span the AV
 * hypothesis is about. A tail under a megabyte reports nothing, exactly as a small log does.
 */
function startColdReadClock(): { saw: (bytes: number) => void; result: () => { firstMbMs?: number } } {
  const startedAt = performance.now()
  let bytesRead = 0
  let firstMbMs: number | undefined
  return {
    saw: (bytes) => {
      bytesRead += bytes
      if (firstMbMs === undefined && bytesRead >= READ_CHUNK_BYTES) firstMbMs = performance.now() - startedAt
    },
    result: () => (firstMbMs === undefined ? {} : { firstMbMs })
  }
}
