// ============================================================================
// schema.ts — THE ENCODING AXIS: a module DECLARES its stored shape (JOS-208, design revision).
// ============================================================================
//
// A checkpoint is a memo of a pure function of (byte prefix, the fold). Invalidation therefore has
// exactly two axes, and this file is the first of them:
//
//   ENCODING  — did the SHAPE of what we store change? Mechanized, here. A module declares its
//               serialized shape as data; the shape hash is derived FROM THE DECLARATION, so a
//               refactor that renames a private field, splits a function or reorders a method
//               churns nothing, and adding a stored field changes the hash without anybody
//               remembering to say so.
//   SEMANTICS — did the MEANING of the same shape change? Not mechanizable from source (the fold
//               is what changed, not its type), so it is a manual constant policed by golden fold
//               fingerprints over the fixture corpus. See semantics.ts.
//
// THE DECLARATION DOES THREE JOBS, which is the whole reason it is data rather than a TypeScript
// type (types evaporate at runtime and can prove nothing about a blob read off disk):
//
//   1. THE SHAPE HASH. Canonicalized and digested — see `shapeHash`.
//   2. THE LOAD-TIME VALIDATOR. `validate()` is what `deserializeFold` runs against the bytes a
//      file handed it. A hand-edited container, a blob from a build whose hash happened to match,
//      a half-written state: all of them are refused by the same code that produced the hash, so
//      "the hash says this is my shape" and "this really is my shape" cannot drift apart.
//   3. THE PLAIN-DATA ENFORCEMENT POINT. The grammar below has no kind for a function, a class
//      instance, a Map, a Set, a Date or a typed array. A value that validates IS plain data, by
//      construction rather than by inspection — and `validate` additionally refuses a non-plain
//      prototype and any field the declaration does not name, so a class instance cannot sneak
//      through by having the right properties.
//
// WHY NOT Map/Set/Date, when V8's structured clone carries all three? Because a Map in a blob is a
// Map in a SCHEMA. The one thing this format cannot afford is a stored shape whose meaning depends
// on which class was in scope when it was written; entries-arrays and epoch numbers say the same
// thing with no such dependency, and the module rebuilds whatever it likes on the way in.

import { createHash } from 'node:crypto'

/** The grammar. Every kind here is plain data; there are deliberately no others. */
export type FoldSchema =
  | { k: 'string' }
  | { k: 'number' }
  | { k: 'boolean' }
  /** A string from a fixed set — the shape hash then moves when the set does. */
  | { k: 'enum'; of: readonly string[] }
  | { k: 'array'; of: FoldSchema }
  /** A fixed-length, positionally-typed array — how an entries pair is declared. */
  | { k: 'tuple'; of: readonly FoldSchema[] }
  | { k: 'object'; fields: Readonly<Record<string, FoldSchema>> }
  /**
   * A plain object with ARBITRARY string keys, all values of one type — a `Record<string, T>`.
   *
   * Added in phase 2 for the modules whose live state already IS one (`kills`' KillMap,
   * `itemTiers`' rows, the per-tier runs inside a kill). It is NOT a Map by another name and the
   * distinction is the same one the header makes: an object's meaning does not depend on which
   * class was in scope, and a reader that walks its keys needs nothing but `Object.keys`. Where
   * the live state is a MAP whose INSERTION ORDER is load-bearing (an LRU, a
   * least-recently-fired eviction), the declaration stays an array of `tuple(key, value)` — a
   * record's key order is an accident of the engine and must never carry meaning.
   */
  | { k: 'record'; of: FoldSchema }
  /** The field may be ABSENT. An absent fact is the grammar's ONLY way to say "no such fact". */
  | { k: 'optional'; of: FoldSchema }
  /**
   * The value may be the literal `null` — and this kind exists for exactly one situation, stated
   * so it is not reached for casually.
   *
   * The rule is unchanged: a fold NEVER stores null to mean "absent" (use `optional`). But a few
   * pieces of fold state are also WIRE types the renderer hydrates, and two of them —
   * `ActiveBuff.estimatedMs` / `p25` / `p75` / `overlayDurationMs` — declare `number | null` with
   * the key always present, where null is a STATED "the model has no estimate" that the UI renders
   * as such. The differential law compares published snapshots with `deepStrictEqual`, so a
   * restore that turned one of those nulls into an absent key would be a real divergence in a
   * real payload. The checkpoint reproduces the shape the module publishes; it does not get to
   * improve it.
   *
   * `null` survives a structured clone unchanged, so this widens nothing about plainness.
   */
  | { k: 'nullable'; of: FoldSchema }

// ------------------------------------------------------------------ tiny constructors, for reading

export const S = {
  str: { k: 'string' } as const,
  num: { k: 'number' } as const,
  bool: { k: 'boolean' } as const,
  enum: (...of: string[]): FoldSchema => ({ k: 'enum', of: [...of].sort() }),
  arr: (of: FoldSchema): FoldSchema => ({ k: 'array', of }),
  tuple: (...of: FoldSchema[]): FoldSchema => ({ k: 'tuple', of }),
  obj: (fields: Record<string, FoldSchema>): FoldSchema => ({ k: 'object', fields }),
  rec: (of: FoldSchema): FoldSchema => ({ k: 'record', of }),
  opt: (of: FoldSchema): FoldSchema => ({ k: 'optional', of }),
  nullable: (of: FoldSchema): FoldSchema => ({ k: 'nullable', of })
}

/**
 * THE SHAPE HASH: a canonical rendering of the declaration, digested.
 *
 * CANONICAL means object fields are emitted in SORTED order, so declaring the same fields in a
 * different order — a diff-only change — does not invalidate a fleet's caches. An enum's members
 * are sorted by the constructor for the same reason. Everything else about the tree IS meaningful
 * and is in the digest: a field's name, its type, its optionality, and a tuple's positions.
 *
 * 16 hex characters. It sits in a header beside one per module and gets read out of a log line by
 * a human diagnosing a cold start; 64 bits is far past the point where a collision is a thing that
 * happens to a set of fewer than twenty declarations.
 */
export function shapeHash(schema: FoldSchema): string {
  return createHash('sha256').update(canonical(schema)).digest('hex').slice(0, 16)
}

/** The canonical text of a declaration — the hash's actual input, and a readable diff on its own. */
export function canonical(schema: FoldSchema): string {
  switch (schema.k) {
    case 'string':
    case 'number':
    case 'boolean':
      return schema.k
    case 'enum':
      return `enum(${[...schema.of].sort().join('|')})`
    case 'array':
      return `array(${canonical(schema.of)})`
    case 'tuple':
      return `tuple(${schema.of.map(canonical).join(',')})`
    case 'record':
      return `record(${canonical(schema.of)})`
    case 'nullable':
      return `nullable(${canonical(schema.of)})`
    case 'optional':
      return `optional(${canonical(schema.of)})`
    case 'object': {
      const keys = Object.keys(schema.fields).sort()
      return `object(${keys.map((key) => `${key}:${canonical(schema.fields[key])}`).join(',')})`
    }
  }
}

/** Where a value stopped matching its declaration. `''` is the root. */
export interface ValidationError {
  path: string
  expected: string
  got: string
}
export type ValidateResult = { ok: true } | { ok: false; error: ValidationError }

/**
 * Validate a value against a declaration — the load-time gate AND the plain-data proof.
 *
 * STRICT IN BOTH DIRECTIONS. A missing non-optional field is an error, and so is a field the
 * declaration does not name: an unexpected property is either a shape that moved without its hash
 * moving (impossible if the hash is derived, so: someone edited the file) or a class instance
 * pretending, and both must land on the cold path.
 */
export function validate(schema: FoldSchema, value: unknown, path = ''): ValidateResult {
  switch (schema.k) {
    case 'optional':
      return value === undefined ? OK : validate(schema.of, value, path)
    case 'nullable':
      return value === null ? OK : validate(schema.of, value, path)
    case 'array':
      return validateArray(schema.of, value, path)
    case 'tuple':
      return validateTuple(schema.of, value, path)
    case 'object':
      return validateObject(schema.fields, value, path)
    case 'record':
      return validateRecord(schema.of, value, path)
    default:
      return validateLeaf(schema, value, path)
  }
}

/** The scalar kinds. Split from `validate` only to keep each side under the complexity ceiling. */
function validateLeaf(
  schema: { k: 'string' } | { k: 'number' } | { k: 'boolean' } | { k: 'enum'; of: readonly string[] },
  value: unknown,
  path: string
): ValidateResult {
  const bad = (expected: string): ValidateResult => ({ ok: false, error: { path, expected, got: describe(value) } })
  switch (schema.k) {
    case 'string':
      return typeof value === 'string' ? OK : bad('string')
    case 'number':
      // FINITE, not merely `typeof number`. NaN and ±Infinity survive a structured clone and then
      // poison every comparison downstream; nothing this fold stores is legitimately either.
      return typeof value === 'number' && Number.isFinite(value) ? OK : bad('finite number')
    case 'boolean':
      return typeof value === 'boolean' ? OK : bad('boolean')
    case 'enum':
      return typeof value === 'string' && schema.of.includes(value) ? OK : bad(`enum(${schema.of.join('|')})`)
  }
}

const OK: ValidateResult = { ok: true }

function validateArray(of: FoldSchema, value: unknown, path: string): ValidateResult {
  if (!isPlainArray(value)) return { ok: false, error: { path, expected: 'array', got: describe(value) } }
  for (let i = 0; i < value.length; i++) {
    const r = validate(of, value[i], `${path}[${i}]`)
    if (!r.ok) return r
  }
  return OK
}

function validateTuple(of: readonly FoldSchema[], value: unknown, path: string): ValidateResult {
  if (!isPlainArray(value) || value.length !== of.length) {
    return { ok: false, error: { path, expected: `tuple of ${of.length}`, got: describe(value) } }
  }
  for (let i = 0; i < of.length; i++) {
    const r = validate(of[i], value[i], `${path}[${i}]`)
    if (!r.ok) return r
  }
  return OK
}

function validateObject(
  fields: Readonly<Record<string, FoldSchema>>,
  value: unknown,
  path: string
): ValidateResult {
  if (!isPlainObject(value)) return { ok: false, error: { path, expected: 'plain object', got: describe(value) } }
  for (const key of Object.keys(value)) {
    if (!(key in fields)) {
      return { ok: false, error: { path: join(path, key), expected: 'no such field', got: describe(value[key]) } }
    }
  }
  for (const key of Object.keys(fields)) {
    const r = validate(fields[key], value[key], join(path, key))
    if (!r.ok) return r
  }
  return OK
}

/**
 * Every value of an arbitrary-keyed plain object. The KEYS are unconstrained by design (they are
 * mob names, item keys, message texts — the fold's own vocabulary) and are never themselves
 * validated beyond being an object's own enumerable strings, which is all a plain object can hold.
 */
function validateRecord(of: FoldSchema, value: unknown, path: string): ValidateResult {
  if (!isPlainObject(value)) return { ok: false, error: { path, expected: 'plain object', got: describe(value) } }
  for (const key of Object.keys(value)) {
    const r = validate(of, value[key], join(path, key))
    if (!r.ok) return r
  }
  return OK
}

const join = (path: string, key: string): string => (path ? `${path}.${key}` : key)

/**
 * A PLAIN object: `{}`-shaped, with `Object.prototype` or no prototype at all. A class instance
 * fails here even when it carries exactly the declared fields, which is the plain-data rule
 * enforced rather than trusted.
 */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const proto: unknown = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

/** A plain `Array`, not a subclass and not a typed array. */
function isPlainArray(v: unknown): v is unknown[] {
  return Array.isArray(v) && Object.getPrototypeOf(v) === Array.prototype
}

/** What we actually got, for the error message. Deliberately names the CLASS when there is one. */
function describe(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  const t = typeof v
  if (t !== 'object') return t
  const ctor: unknown = (v as { constructor?: unknown }).constructor
  const name = typeof ctor === 'function' ? ctor.name : undefined
  return name && name !== 'Object' ? `instance of ${name}` : 'object'
}
