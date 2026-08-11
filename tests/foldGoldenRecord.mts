/**
 * foldGoldenRecord.mts — computing and re-recording the fold fingerprints (JOS-208).
 *
 * `foldGoldens.test.mts` compares; this produces. Both go through ONE function, because a recorder
 * that computed the number a slightly different way than the checker would write goldens that are
 * green on the day they land and red forever after.
 *
 * RUN AS A SCRIPT to re-record: `npm run fold:goldens -- "<why this FOLD_SEMANTICS>"`. The reason is
 * required when the semantics version moves without any fingerprint moving (the overzealous-bump
 * case the design allows and flags); the test refuses a file whose reason is missing or trivial.
 */
import { writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { FOLD_SEMANTICS } from '../src/main/foldCache/semantics'
import { CHECKPOINTED_MODULE_IDS } from '../src/main/foldCache/serialize'
import { buildFoldWorld, foldRange, FOLD_FIXTURES, publishedSnapshots, watchesFor } from './foldCheckpointHarness.mts'

export const GOLDENS_PATH = join(import.meta.dirname, 'goldens', 'foldFingerprints.json')

export interface FoldGoldens {
  semantics: number
  /** Why the fold means what it means at this version — see semantics.ts. */
  reason: string
  /** `<fixture>::<moduleId>` → a hash of that module's published snapshot over that fixture. */
  fingerprints: Record<string, string>
}

/**
 * A CANONICAL rendering of a value: object keys sorted at every level, so a fingerprint depends on
 * what the fold produced and not on the order a `JSON.stringify` happened to walk it. `undefined`
 * is rendered explicitly rather than dropped — an absent optional field and a present-but-undefined
 * one mean the same thing to the fold and must hash the same way.
 */
export function canonicalJson(v: unknown): string {
  if (v === undefined) return 'undefined'
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`
  const entries = Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, val]) => `${JSON.stringify(k)}:${canonicalJson(val)}`).join(',')}}`
}

/**
 * Fold every fixture once and fingerprint EVERY checkpointed module's published snapshot (phase 2
 * — phase 1 fingerprinted the two pilots).
 *
 * The watch list comes from `watchesFor`, exactly as the differential harness derives it, so the
 * respawn module publishes real rows rather than an empty list — a golden over an empty snapshot
 * would be a tripwire nothing can trip.
 */
export async function foldFingerprints(): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const fixture of FOLD_FIXTURES) {
    const logPath = join(import.meta.dirname, 'fixtures', fixture)
    const prefs = await watchesFor(logPath)
    const world = buildFoldWorld(logPath, prefs)
    await foldRange(world, logPath, { from: 0, seq: 0 })
    const snaps = publishedSnapshots(world)
    for (const id of CHECKPOINTED_MODULE_IDS) {
      out[`${fixture}::${id}`] = createHash('sha256').update(canonicalJson(snaps[id])).digest('hex').slice(0, 16)
    }
  }
  return out
}

/** Re-record. The reason is carried forward when the caller does not supply a new one. */
export async function recordGoldens(reason: string): Promise<FoldGoldens> {
  const next: FoldGoldens = { semantics: FOLD_SEMANTICS, reason, fingerprints: await foldFingerprints() }
  writeFileSync(GOLDENS_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return next
}

if (process.argv[1]?.endsWith('foldGoldenRecord.mts')) {
  const reason = process.argv.slice(2).join(' ').trim()
  const res = await recordGoldens(reason || `FOLD_SEMANTICS ${FOLD_SEMANTICS} — recorded without a stated reason.`)
  process.stdout.write(
    `Recorded ${Object.keys(res.fingerprints).length} fold fingerprints at FOLD_SEMANTICS ${res.semantics}.\n`
  )
}
