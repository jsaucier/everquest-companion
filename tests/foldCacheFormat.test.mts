/**
 * foldCacheFormat.test.mts — the container, the declaration grammar, the identity anchors and the
 * feature flag, each held to its own contract (JOS-208).
 *
 * The differential harness proves the FOLD is right. This proves the parts underneath it are right
 * for the reasons they claim to be — which matters because every one of them is a place where a
 * bug would look like "it silently cold-started forever" or, far worse, "it accepted a container it
 * should have refused".
 */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { CACHE_SCHEMA_VERSION, decodeCache, encodeCache, type CacheHeader } from '../src/main/foldCache/format'
import {
  ANCHOR_BYTES,
  computeIdentity,
  computeIdentitySync,
  identityFrom,
  sampleOffsets,
  verifyIdentity,
  type ReadRange
} from '../src/main/foldCache/identity'
import { resolveFoldCacheFlag } from '../src/main/foldCache/flag'
import { canonical, S, shapeHash, validate } from '../src/main/foldCache/schema'
import { cacheStem } from '../src/main/foldCache/name'

// ------------------------------------------------------------------------------ the declaration

test('schema: the shape hash is canonical — field ORDER is not a change, a field is', () => {
  const a = S.obj({ x: S.num, y: S.str })
  const b = S.obj({ y: S.str, x: S.num })
  assert.equal(shapeHash(a), shapeHash(b), 'declaring the same fields in another order must not churn the fleet')
  assert.notEqual(shapeHash(a), shapeHash(S.obj({ x: S.num, y: S.str, z: S.bool })), 'a new stored field must invalidate')
  assert.notEqual(shapeHash(a), shapeHash(S.obj({ x: S.str, y: S.str })), 'a field changing type must invalidate')
  assert.notEqual(shapeHash(a), shapeHash(S.obj({ x: S.opt(S.num), y: S.str })), 'optionality is part of the shape')
  assert.notEqual(shapeHash(a), shapeHash(S.obj({ x: S.num, w: S.str })), 'a RENAMED field must invalidate')
  // A tuple's positions are meaningful; an enum's members are not ordered.
  assert.notEqual(shapeHash(S.tuple(S.num, S.str)), shapeHash(S.tuple(S.str, S.num)))
  assert.equal(shapeHash(S.enum('a', 'b')), shapeHash(S.enum('b', 'a')))
  assert.notEqual(shapeHash(S.enum('a', 'b')), shapeHash(S.enum('a', 'b', 'c')))
  assert.equal(canonical(a), 'object(x:number,y:string)')
})

test('schema: validation is the plain-data gate, in both directions', () => {
  const schema = S.obj({ id: S.str, n: S.num, tags: S.arr(S.str), via: S.opt(S.enum('a', 'b')) })
  assert.equal(validate(schema, { id: 'x', n: 1, tags: [] }).ok, true)
  assert.equal(validate(schema, { id: 'x', n: 1, tags: [], via: 'a' }).ok, true)

  // A MISSING required field, a WRONG type, and an EXTRA field are all refusals. The extra field is
  // the one that matters most: it is how a class instance with the right properties gets in.
  assert.equal(validate(schema, { n: 1, tags: [] }).ok, false)
  assert.equal(validate(schema, { id: 'x', n: '1', tags: [] }).ok, false)
  assert.equal(validate(schema, { id: 'x', n: 1, tags: [], surprise: 1 }).ok, false)
  assert.equal(validate(schema, { id: 'x', n: 1, tags: [], via: 'c' }).ok, false)

  // NaN and Infinity survive a structured clone and poison every comparison after it.
  assert.equal(validate(S.num, Number.NaN).ok, false)
  assert.equal(validate(S.num, Number.POSITIVE_INFINITY).ok, false)

  // A CLASS INSTANCE carrying exactly the declared fields is still refused — the whole point.
  class Sneaky {
    id = 'x'
    n = 1
    tags: string[] = []
  }
  const res = validate(schema, new Sneaky())
  assert.equal(res.ok, false)
  assert.match(res.ok ? '' : res.error.got, /instance of Sneaky/)

  // …and so are the structured-clone types the grammar deliberately has no kind for.
  assert.equal(validate(S.obj({ m: S.arr(S.num) }), { m: new Set([1]) }).ok, false)
  assert.equal(validate(S.obj({ d: S.num }), { d: new Date() }).ok, false)

  // The error names the PATH, because a refusal nobody can locate is a refusal nobody fixes.
  const deep = validate(S.obj({ rows: S.arr(S.obj({ ts: S.num })) }), { rows: [{ ts: 1 }, { ts: 'no' }] })
  assert.equal(deep.ok, false)
  assert.equal(deep.ok ? '' : deep.error.path, 'rows[1].ts')
})

// -------------------------------------------------------------------------------- the container

const identityFixture = (b: number): CacheHeader['identity'] => ({
  characterKey: 'primitive@freeport',
  b,
  size: b + 10,
  headHash: 'h',
  shoulderHash: 's',
  lastLineHash: 'l',
  blocks: [],
  lastEventTs: 5
})

function sampleContainer(): Buffer {
  const header: CacheHeader = {
    foldSemantics: 1,
    seq: 42,
    writtenAtMs: 0,
    identity: identityFixture(1000),
    modules: [
      { id: 'loot', shapeHash: 'aaaaaaaaaaaaaaaa' },
      { id: 'respawn', shapeHash: 'bbbbbbbbbbbbbbbb' }
    ]
  }
  const states = new Map<string, unknown>([
    ['loot', { rows: [{ ts: 1, item: 'Bone Chips' }] }],
    ['respawn', { history: [['a::b', { kills: 2 }]] }]
  ])
  return encodeCache(header, states)
}

test('container: a round trip returns exactly what went in', () => {
  const decoded = decodeCache(sampleContainer())
  assert.equal(decoded.ok, true)
  if (!decoded.ok) return
  assert.equal(decoded.value.header.seq, 42)
  assert.equal(decoded.value.header.identity.b, 1000)
  assert.deepStrictEqual(decoded.value.blobs.get('loot'), { rows: [{ ts: 1, item: 'Bone Chips' }] })
  assert.deepStrictEqual(decoded.value.blobs.get('respawn'), { history: [['a::b', { kills: 2 }]] })
})

test('container: every corruption is a RESULT, never a throw', () => {
  const good = sampleContainer()
  const bad = (mutate: (b: Buffer) => Buffer): string => {
    const res = decodeCache(mutate(Buffer.from(good)))
    assert.equal(res.ok, false)
    return res.ok ? '' : res.error
  }
  assert.equal(bad((b) => b.subarray(0, 8)), 'too-small')
  assert.equal(
    bad((b) => {
      b.write('NOTOURS1', 0, 'ascii')
      return b
    }),
    'bad-magic'
  )
  // A flip ANYWHERE is caught, and the whole-file digest is checked first so a plausible prefix is
  // never reasoned about. Three positions: the header, a blob, and the trailing digest itself.
  for (const at of [20, Math.floor(good.length / 2), good.length - 1]) {
    const err = bad((b) => {
      b[at] = (b[at] ?? 0) ^ 0xff
      return b
    })
    assert.match(err, /^(file-digest|header-digest|blob-digest|truncated|header-json|schema-version)$/)
  }
  // APPENDED bytes are a different file, whatever the header says.
  assert.equal(decodeCache(Buffer.concat([good, Buffer.from([0])])).ok, false)
  assert.equal(CACHE_SCHEMA_VERSION, 1)
})

test('container: an empty state set still encodes and decodes', () => {
  // Nothing checkpointable registered is a legitimate state (a build mid-rollout), and it must not
  // be a special case anywhere — least of all a crash on the startup path.
  const header: CacheHeader = {
    foldSemantics: 1,
    seq: 0,
    writtenAtMs: 0,
    identity: identityFixture(1),
    modules: []
  }
  const decoded = decodeCache(encodeCache(header, new Map()))
  assert.equal(decoded.ok, true)
})

// --------------------------------------------------------------------------------- the identity

test('identity: sample offsets are a pure function of B and never touch the anchors', () => {
  assert.deepStrictEqual(sampleOffsets(1000), [], 'a log shorter than the two anchors gets no samples')
  const big = sampleOffsets(10_000_000)
  assert.deepStrictEqual(big, sampleOffsets(10_000_000), 'the same B must give the same list, every time')
  assert.ok(big.length > 0)
  for (const off of big) {
    assert.ok(off >= ANCHOR_BYTES, 'a sample must not re-hash the head')
    assert.ok(off + 4096 <= 10_000_000 - ANCHOR_BYTES, 'a sample must not re-hash the shoulder')
  }
  assert.deepStrictEqual([...big].sort((a, b) => a - b), big, 'ascending, so a reader can stream them')
})

test('identity: the async and sync arms compute the same block', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'eqfold-id-'))
  const logPath = join(dir, 'log.txt')
  const bytes = readFileSync(join(import.meta.dirname, 'fixtures', 'e2e-combat.log'))
  writeFileSync(logPath, bytes)
  const b = 120_000
  const asyncId = await computeIdentity(logPath, b, 'primitive@freeport', 7)
  const syncId = computeIdentitySync(logPath, b, 'primitive@freeport', 7)
  assert.deepStrictEqual(asyncId, syncId, 'two arms of one algorithm must not be two algorithms')
  // …and the pure core agrees with both, which is what makes it the shared definition.
  const read: ReadRange = (off, len) => bytes.subarray(Math.max(0, off), Math.max(0, off) + len)
  assert.deepStrictEqual(identityFrom(read, { size: bytes.length, b, characterKey: 'primitive@freeport', lastEventTs: 7 }), asyncId)
})

test('identity: it refuses what it cannot describe, and accepts a log that only GREW', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'eqfold-id2-'))
  const logPath = join(dir, 'log.txt')
  const bytes = readFileSync(join(import.meta.dirname, 'fixtures', 'e2e-combat.log'))
  writeFileSync(logPath, bytes)
  const b = 120_000
  const id = await computeIdentity(logPath, b, 'primitive@freeport', 7)
  assert.ok(id)

  // GROWTH IS THE NORMAL CASE and must be accepted — this is a log that is still being written.
  writeFileSync(logPath, Buffer.concat([bytes, Buffer.from('[Tue Aug 11 00:00:00 2026] You have entered somewhere.\n')]))
  assert.deepStrictEqual(await verifyIdentity(logPath, id, 'primitive@freeport'), { ok: true })

  // A checkpoint about bytes that do not exist is never WRITTEN in the first place.
  assert.equal(await computeIdentity(logPath, bytes.length * 10, 'primitive@freeport', 0), null)
  assert.equal(await computeIdentity(join(dir, 'nope.txt'), 10, 'primitive@freeport', 0), null)
  assert.equal(computeIdentitySync(join(dir, 'nope.txt'), 10, 'primitive@freeport', 0), null)

  // A FORGED sample-offset list is refused before any of its hashes are believed.
  const forged = { ...id, blocks: [...id.blocks, { off: 999_999, hash: 'x' }] }
  const res = await verifyIdentity(logPath, forged, 'primitive@freeport')
  assert.deepStrictEqual(res, { ok: false, reason: 'sample-offsets' })
})

// ------------------------------------------------------------------------------------- the flag

test('flag: off by default, and the env var wins in BOTH directions', () => {
  assert.deepStrictEqual(resolveFoldCacheFlag({}), { enabled: false, why: 'default-off' })
  assert.deepStrictEqual(resolveFoldCacheFlag({ pref: false }), { enabled: false, why: 'default-off' })
  assert.deepStrictEqual(resolveFoldCacheFlag({ pref: true }), { enabled: true, why: 'pref-on' })
  for (const on of ['1', 'true', 'ON', ' on ']) {
    assert.equal(resolveFoldCacheFlag({ env: on }).enabled, true, `${on} must turn it on`)
  }
  // A KILL SWITCH A PREFERENCE CAN OVERRIDE IS NOT A KILL SWITCH.
  for (const off of ['0', 'false', 'OFF']) {
    assert.deepStrictEqual(resolveFoldCacheFlag({ pref: true, env: off }), { enabled: false, why: 'env-off' })
  }
  // Anything unrecognized falls through to the preference rather than guessing.
  assert.deepStrictEqual(resolveFoldCacheFlag({ pref: true, env: 'maybe' }), { enabled: true, why: 'pref-on' })
})

test('paths: a character id becomes a filename that cannot leave its directory', () => {
  assert.equal(cacheStem('Primitive_freeport'), 'primitive_freeport')
  assert.equal(cacheStem('../../etc/passwd'), '______etc_passwd')
  assert.equal(cacheStem(''), 'unknown')
  assert.ok(!cacheStem('a/b\\c:d*e?f').includes('/'))
  assert.equal(cacheStem('x'.repeat(200)).length, 64)
})
