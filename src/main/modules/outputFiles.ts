// ============================================================================
// outputFiles module — when the player last exported each `/outputfile` dump.
// ============================================================================
//
// JOS-128. One fact, folded from one line: `Outputfile Complete: <file>` (the `outputFile`
// event, parseSession.ts). It answers the only question the inventory BASELINE rule needs —
// when was THIS dump generated — in EQ's own clock, which is the same clock every loot row's
// `ts` is parsed from. `shared/outputs/baseline.ts` carries the reasoning and the fallback.
//
// SURFACE-FREE, deliberately, like the outputs engine it serves. It is a module rather than a
// bus subscriber because it needs exactly what the module contract already provides — a fold
// over every event, live and replayed alike, and a `reset()` on character switch — and because
// the bench's attribution stays honest only if every consumer of the stream is in the one list
// (modules/wiring.ts). `flushDelta()` therefore always returns null: nothing in the renderer
// subscribes to this, main reads it directly through `writtenAt()`.
//
// NEWEST WINS, and only the newest is kept. The log holds every export the character has ever
// made; the only one that can be the baseline is the one that wrote the file now on disk, and
// that is the most recent write of that name. Keeping the whole history would invite a join
// against a superseded export.
//
// EPOCH: a dump written by the WIPED beta character is deliberately NOT cleared here. The file
// on disk outlives the epoch too, and this module's job is to report when that file was
// written, not to judge whose it was. A pre-epoch baseline makes the whole (post-epoch) loot
// history accumulate on top of the dump, which is exactly what a stale dump deserves.

import type { EqModule } from './types'
import { S, validate, type FoldSchema } from '../foldCache/schema'
import type { FoldCheckpointable } from '../foldCache/serialize'
import type { LogEvent } from '../../shared/logEvents'
import { baseName } from '../../shared/outputs/baseline'

/** The state this module holds: dump file name (lowercased) → epoch ms of its newest write. */
export type OutputFilesSnap = Record<string, number>

/**
 * THE CHECKPOINT DECLARATION (JOS-208 phase 2). A `record` rather than an entries array because
 * the live Map's ORDER carries nothing here — newest-wins is decided per key by comparing
 * timestamps, so nothing reads the iteration order and a record is the honest shape. It is also
 * exactly what `snapshot()` already publishes.
 */
const OUTPUT_FILES_FOLD_SCHEMA: FoldSchema = S.obj({ written: S.rec(S.num), seq: S.num })

/** The output-file module's complete event-derived state. */
export interface OutputFilesFoldState {
  written: OutputFilesSnap
  seq: number
}

export class OutputFilesModule implements EqModule<OutputFilesSnap, never>, FoldCheckpointable<OutputFilesFoldState> {
  readonly id = 'outputFiles'
  private written = new Map<string, number>()
  private seq = 0

  reset(): void {
    // A character switch means a different log, and the next replay re-states every export that
    // log witnessed. Carrying the old character's receipts forward would let one character's
    // export time answer for another's dump.
    this.written.clear()
    this.seq = 0
  }

  onEvent(ev: LogEvent): void {
    this.seq = ev.seq
    if (ev.kind !== 'outputFile') return
    const key = fileKey(ev.file)
    const prev = this.written.get(key)
    if (prev === undefined || ev.ts > prev) this.written.set(key, ev.ts)
  }

  /**
   * When the log says this dump was last written, or null when it never saw one.
   *
   * Takes a PATH or a bare name: EQ writes dumps into the install root and prints the bare
   * name, so the join is on the last segment, case-insensitively (Windows paths are, and a
   * player who typed `/outputfile inventory MyStuff` in another case wrote the same file).
   */
  writtenAt(pathOrName: string): number | null {
    return this.written.get(fileKey(pathOrName)) ?? null
  }

  snapshot(): { seq: number; state: OutputFilesSnap } {
    return { seq: this.seq, state: Object.fromEntries(this.written) }
  }

  flushDelta(): null {
    return null
  }

  // ---- the checkpoint seam (JOS-208) ---------------------------------------------------------

  readonly foldSchema = OUTPUT_FILES_FOLD_SCHEMA

  serializeFold(): OutputFilesFoldState {
    return { written: Object.fromEntries(this.written), seq: this.seq }
  }

  deserializeFold(state: unknown): boolean {
    if (!validate(OUTPUT_FILES_FOLD_SCHEMA, state).ok) return false
    const s = state as OutputFilesFoldState
    this.written = new Map(Object.entries(s.written))
    this.seq = s.seq
    return true
  }
}

function fileKey(pathOrName: string): string {
  return baseName(pathOrName).trim().toLowerCase()
}
