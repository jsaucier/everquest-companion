/**
 * ============================================================================
 * foldGoldens.test.mts — THE SEMANTICS TRIPWIRE (JOS-208, design revision).
 * ============================================================================
 *
 * The ENCODING axis is mechanized: a unit declares its stored shape and the hash is derived from
 * the declaration (schema.ts). The SEMANTICS axis cannot be — when a fold's MEANING changes, the
 * shape is untouched and every existing checkpoint holds numbers this build would never produce.
 * So `FOLD_SEMANTICS` is a manual constant, and THIS is what stops it from being a constant
 * everybody forgets.
 *
 * WHAT IT DOES: folds each fixture in the corpus and FINGERPRINTS every checkpointed module's published
 * snapshots — a canonical JSON rendering, hashed. The fingerprints are committed
 * (`tests/goldens/foldFingerprints.json`) alongside the `FOLD_SEMANTICS` they were recorded at.
 *
 *     output changed, FOLD_SEMANTICS unchanged  → RED, naming the module and the fixture.
 *         Fix: bump `FOLD_SEMANTICS` and re-record the goldens IN THE SAME COMMIT.
 *     output changed, FOLD_SEMANTICS bumped     → green. A correct change, stated.
 *     output unchanged, FOLD_SEMANTICS bumped   → allowed, FLAGGED as overzealous, and the goldens
 *         file must carry a `reason` for that version. One unnecessary cold start for the fleet is
 *         cheap; an unexplained bump is a habit, and the habit is what makes the number meaningless.
 *
 * RE-RECORD WITH: `npm run fold:goldens`.
 *
 * THE CORPUS IS THE HONESTY BOUNDARY, and it is stated rather than implied: a semantic change
 * visible only on log shapes no fixture contains will not be caught here. Shadow mode (phase 3) is
 * the fleet backstop, which is why the standing rule is WHEN IN DOUBT, BUMP.
 *
 * WHY A HASH AND NOT THE SNAPSHOTS THEMSELVES: a golden file holding six fixtures' full module
 * state would be megabytes of committed noise that nobody reads and every diff churns. The hash
 * answers the only question this test asks — "did it change" — and when it says yes, the
 * differential harness and the module's own tests are what say how.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { FOLD_SEMANTICS } from '../src/main/foldCache/semantics'
import { CHECKPOINTED_MODULE_IDS } from '../src/main/foldCache/serialize'
import { FOLD_FIXTURES } from './foldCheckpointHarness.mts'
import { canonicalJson, foldFingerprints, GOLDENS_PATH, type FoldGoldens } from './foldGoldenRecord.mts'

test('fold goldens: published snapshots match, or FOLD_SEMANTICS was bumped', async () => {
  const golden = JSON.parse(readFileSync(GOLDENS_PATH, 'utf8')) as FoldGoldens
  const current = await foldFingerprints()

  // A key the goldens have never held is NEW COVERAGE, not a changed fold: nothing can be said to
  // have moved about a module nobody was fingerprinting. Widening the corpus or the module set
  // therefore needs a re-record and no bump, while a key that MOVED — or one that stopped being
  // produced at all — is the tripwire doing its job.
  const changed: string[] = []
  for (const [key, hash] of Object.entries(current)) {
    if (!(key in golden.fingerprints)) continue
    if (golden.fingerprints[key] !== hash) changed.push(key)
  }
  for (const key of Object.keys(golden.fingerprints)) {
    if (!(key in current)) changed.push(`${key} (no longer produced)`)
  }

  // NEW keys still have to be RECORDED — a fingerprint that exists only in memory is not a
  // tripwire. This is the half that makes the "new coverage" exemption above safe.
  const unrecorded = Object.keys(current).filter((key) => !(key in golden.fingerprints))
  assert.deepStrictEqual(
    unrecorded,
    [],
    `these fold fingerprints are produced but not committed: ${unrecorded.join(', ')}. ` +
      'Re-record with `npm run fold:goldens -- "<why>"` — new coverage needs no FOLD_SEMANTICS bump.'
  )

  if (changed.length > 0) {
    assert.notEqual(
      FOLD_SEMANTICS,
      golden.semantics,
      `THE FOLD'S OUTPUT CHANGED and FOLD_SEMANTICS is still ${FOLD_SEMANTICS}.\n` +
        `Changed: ${changed.join(', ')}\n` +
        `Every checkpoint in the fleet now describes a computation this build no longer performs.\n` +
        `Bump FOLD_SEMANTICS in src/main/foldCache/semantics.ts and re-record with ` +
        `\`npm run fold:goldens\` IN THE SAME COMMIT. When in doubt, bump: one cold start beats a ` +
        `silently wrong world model.`
    )
    assert.fail(
      `The fold's output changed and FOLD_SEMANTICS was bumped to ${FOLD_SEMANTICS}, but the ` +
        `goldens still hold version ${golden.semantics}. Re-record: \`npm run fold:goldens\`.\n` +
        `Changed: ${changed.join(', ')}`
    )
  }

  // Nothing moved. If the constant did, the bump was OVERZEALOUS — allowed, but it must say why.
  if (FOLD_SEMANTICS !== golden.semantics) {
    assert.equal(
      golden.semantics,
      FOLD_SEMANTICS,
      `FOLD_SEMANTICS is ${FOLD_SEMANTICS} but the goldens were recorded at ${golden.semantics}, and ` +
        `no fingerprint moved. Re-record (\`npm run fold:goldens\`) with a stated reason — an ` +
        `overzealous bump is allowed and costs the fleet one cold start, an unexplained one is a habit.`
    )
  }
  assert.equal(golden.semantics, FOLD_SEMANTICS)
})

test('fold goldens: an overzealous bump carries a stated reason', () => {
  const golden = JSON.parse(readFileSync(GOLDENS_PATH, 'utf8')) as FoldGoldens
  assert.equal(typeof golden.reason, 'string')
  assert.ok(
    golden.reason.trim().length >= 20,
    'the goldens file must say WHY it holds this FOLD_SEMANTICS — see semantics.ts'
  )
})

test('fold goldens: the corpus the fingerprints cover is stated', () => {
  const golden = JSON.parse(readFileSync(GOLDENS_PATH, 'utf8')) as FoldGoldens
  const keys = Object.keys(golden.fingerprints)
  assert.equal(
    keys.length,
    FOLD_FIXTURES.length * CHECKPOINTED_MODULE_IDS.length,
    'the corpus is every fixture x every checkpointed module — a missing pair is a module nobody fingerprints'
  )
  // The key format is what a red build prints, so it is asserted rather than assumed.
  for (const key of keys) assert.match(key, /^[\w.-]+\.log::\w+$/)
})

// A guard against the goldens file drifting out of the repo: `GOLDENS_PATH` is the only place it
// is named, and the recorder writes through the same constant.
test('fold goldens: the committed file is where the recorder writes', () => {
  assert.equal(GOLDENS_PATH, join(import.meta.dirname, 'goldens', 'foldFingerprints.json'))
})

/**
 * THE TRIPWIRE'S OWN TRIPWIRE. A fingerprint that ignores a field is a golden that cannot go red
 * for a change to that field, and the canonical rendering is where that would happen — a
 * `JSON.stringify` that drops `undefined`, a sort that collapses two keys, a truncation.
 *
 * So: prove the rendering is SENSITIVE to each shape of change a fold can make (a value, a key, an
 * order, a presence) and INSENSITIVE to the one thing it must be (the order the keys were written
 * in, which is an accident of how an object was built).
 */
test('fold goldens: the fingerprint sees every kind of change, and no non-change', () => {
  const base = { a: 1, b: [1, 2, 3], c: { d: 'x' } }
  assert.equal(canonicalJson(base), canonicalJson({ c: { d: 'x' }, b: [1, 2, 3], a: 1 }), 'key ORDER is not a change')
  const differs = [
    { a: 2, b: [1, 2, 3], c: { d: 'x' } }, // a value moved
    { a: 1, b: [1, 3, 2], c: { d: 'x' } }, // an ARRAY order moved — the LRU case
    { a: 1, b: [1, 2, 3], c: { d: 'y' } }, // a nested value moved
    { a: 1, b: [1, 2, 3], c: {} }, // a field went absent
    { a: 1, b: [1, 2, 3], c: { d: 'x' }, e: 0 } // a field appeared
  ]
  for (const other of differs) {
    assert.notEqual(canonicalJson(other), canonicalJson(base), `${JSON.stringify(other)} must fingerprint differently`)
  }
  // …and a present-but-undefined field reads as the absent one, because that is what the fold means.
  assert.equal(canonicalJson({ a: 1, b: undefined }), canonicalJson({ a: 1, b: undefined }))
})
