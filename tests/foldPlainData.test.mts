/**
 * ============================================================================
 * foldPlainData.test.mts — AUDIT 2: FOLD STATE IS PLAIN DATA (JOS-208).
 * ============================================================================
 *
 * V8's structured clone cannot carry a closure, and it carries a class instance by quietly
 * flattening it into an object that has lost its prototype — which is worse, because it succeeds.
 * A `Map` it CAN carry, and this audit refuses it anyway: a Map in a blob is a Map in a schema, and
 * a stored shape whose meaning depends on which class was in scope when it was written is the one
 * thing this format cannot afford.
 *
 * THE ENFORCEMENT POINT IS THE DECLARATION (design revision, 2026-08-11). Each unit declares its
 * stored shape as data (`src/main/foldCache/schema.ts`), the shape hash is derived from that
 * declaration, and `validate()` — the same function `deserializeFold` runs on the way in — accepts
 * only the grammar's kinds, refuses a non-plain prototype, and refuses any field the declaration
 * does not name. So this audit is not a second opinion about plainness: it is the SAME opinion,
 * applied to the output of a REAL fold of a REAL fixture, which is the only place a drift between
 * "what the class holds" and "what the declaration says" can show up.
 *
 * AND IT CHECKS THE ROUND TRIP, because plain and complete are different claims: the state is
 * serialized, pushed through `v8.serialize`/`v8.deserialize`, validated again, handed back to a
 * FRESH unit, and re-serialized — and the two serializations must be deep-equal. A field the class
 * holds but the declaration omits survives step one and dies here.
 */
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'
import { deserialize, serialize } from 'node:v8'
import { validate } from '../src/main/foldCache/schema'
import { moduleShapeHash } from '../src/main/foldCache/serialize'
import { buildFoldWorld, foldRange, FOLD_FIXTURES, watchesFor } from './foldCheckpointHarness.mts'

const fixturePath = (name: string): string => join(import.meta.dirname, 'fixtures', name)

/**
 * A belt-and-braces structural walk, INDEPENDENT of the schema.
 *
 * The declaration already guarantees plainness by construction, so this can only ever fail if the
 * grammar itself grows a kind it should not have. That is exactly the change worth catching: it
 * would be one line in schema.ts and would silently widen every unit in the tree at once.
 */
const PLAIN_SCALARS = new Set(['string', 'number', 'boolean', 'undefined'])
const NEVER_PLAIN = new Set(['function', 'symbol', 'bigint'])

function findNonPlain(v: unknown, path = ''): string | null {
  if (v === null) return null
  const t = typeof v
  if (PLAIN_SCALARS.has(t)) return null
  if (NEVER_PLAIN.has(t)) return `${path}: ${t}`
  return Array.isArray(v) ? findNonPlainArray(v, path) : findNonPlainObject(v, path)
}

function findNonPlainArray(v: unknown[], path: string): string | null {
  if (Object.getPrototypeOf(v) !== Array.prototype) return `${path}: Array subclass`
  for (let i = 0; i < v.length; i++) {
    const bad = findNonPlain(v[i], `${path}[${i}]`)
    if (bad) return bad
  }
  return null
}

function findNonPlainObject(v: object, path: string): string | null {
  const proto: unknown = Object.getPrototypeOf(v)
  if (proto !== Object.prototype && proto !== null) {
    const ctor = (v as { constructor?: { name?: string } }).constructor?.name ?? 'unknown'
    return `${path}: instance of ${ctor}`
  }
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const bad = findNonPlain(val, path ? `${path}.${k}` : k)
    if (bad) return bad
  }
  return null
}

for (const fixture of FOLD_FIXTURES) {
  test(`fold state is plain data and round-trips: ${fixture}`, async () => {
    const logPath = fixturePath(fixture)
    const prefs = await watchesFor(logPath)
    const world = buildFoldWorld(logPath, prefs)
    await foldRange(world, logPath, { from: 0, seq: 0 })

    assert.ok(world.units.length >= 17, 'every module and both derived-event producers must be present')
    for (const unit of world.units) {
      const state = unit.serializeFold()

      // 1. THE DECLARATION accepts it — the same gate `deserializeFold` uses.
      const v = validate(unit.foldSchema, state)
      assert.equal(
        v.ok,
        true,
        v.ok ? '' : `${unit.id}: fold state does not match its own declaration at '${v.error.path}' — expected ${v.error.expected}, got ${v.error.got}`
      )

      // 2. NOTHING NON-PLAIN anywhere in it, checked without consulting the declaration.
      assert.equal(findNonPlain(state), null, `${unit.id}: fold state carries something structured-clone cannot mean`)

      // 3. V8 CARRIES IT, and the declaration still accepts what comes back.
      const cloned: unknown = deserialize(serialize(state))
      assert.equal(validate(unit.foldSchema, cloned).ok, true, `${unit.id}: the clone no longer matches the declaration`)

      // 4. A FRESH UNIT adopts it and re-serializes to the SAME state — the completeness half.
      //    A field the class holds but the declaration omits passes 1–3 and fails here.
      const fresh = buildFoldWorld(logPath, prefs).units.find((u) => u.id === unit.id)
      assert.ok(fresh, `${unit.id} must exist in a fresh world`)
      assert.equal(fresh.deserializeFold(cloned), true, `${unit.id}: refused its own state`)
      assert.deepStrictEqual(fresh.serializeFold(), state, `${unit.id}: the round trip lost or changed something`)
    }
  })
}

/**
 * THE SHAPE HASH IS DERIVED AND STABLE. Two independently constructed instances of the same unit
 * must hash identically (it is a function of the declaration, not of the instance), and the hashes
 * must be distinct across units (or the container's per-unit encoding check is decoration).
 */
test('fold shape hashes are derived, stable and distinct', () => {
  const a = buildFoldWorld('')
  const b = buildFoldWorld('')
  const seen = new Map<string, string>()
  for (const unit of a.units) {
    const twin = b.units.find((u) => u.id === unit.id)
    assert.ok(twin)
    assert.equal(moduleShapeHash(unit), moduleShapeHash(twin), `${unit.id}: the hash must not depend on the instance`)
    const prior = seen.get(moduleShapeHash(unit))
    assert.equal(prior, undefined, `${unit.id} and ${prior} declare the same shape hash`)
    seen.set(moduleShapeHash(unit), unit.id)
  }
})
