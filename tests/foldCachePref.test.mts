// ============================================================================
// foldCachePref.test.mts — THE CHECKPOINT'S USER-FACING SWITCH (JOS-208, owner addition).
// ============================================================================
//
// The flag itself is resolved by `resolveFoldCacheFlag`, whose truth table (including the env
// var winning in BOTH directions) is pinned in `foldCacheFormat.test.mts` and is not re-tested
// here. What THIS file is about is the half the owner asked for: the preference is the
// user-facing switch, the environment variable is a dev escape hatch, and the surface must not
// lie about which of them this launch obeyed.
//
// TWO HALVES, the `uiScale.test.mts` shape:
//
//   1. THE SHARED PREDICATE the caption branches on — a pure function over the four decisions,
//      which is the only piece of this that a unit test can execute directly.
//   2. SOURCE PINS for the claims that live across a process boundary and would otherwise need a
//      running Electron app to observe: that the main-side state is resolved through the SAME
//      rule the launch used (not a second copy), that a non-boolean leaves the preference alone,
//      that the preload exposes both directions, and that the card is wired into Preferences
//      with copy in the app's plain voice. The BEHAVIOUR — clicking the switch and the answer
//      surviving into main's store — is `tests/e2e/perf.e2e.mts`, on the real app.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { foldCacheOverridden, type FoldCacheState } from '../src/shared/foldCachePrefs'

const src = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8')

const state = (over: Partial<FoldCacheState>): FoldCacheState => ({
  stored: false,
  active: false,
  why: 'default-off',
  ...over
})

// -------------------------------------------------------------------------------- the predicate

test('fold cache pref: only the ENVIRONMENT counts as an override', () => {
  // The two ordinary answers — the switch decided, and the surface may speak for it.
  assert.equal(foldCacheOverridden(state({ why: 'default-off' })), false)
  assert.equal(foldCacheOverridden(state({ why: 'pref-on', stored: true, active: true })), false)
  // The two the caption has to lead with, because the switch and the launch disagree.
  assert.equal(foldCacheOverridden(state({ why: 'env-on', stored: false, active: true })), true)
  assert.equal(foldCacheOverridden(state({ why: 'env-off', stored: true, active: false })), true)
})

test('fold cache pref: the state carries what the LAUNCH did, not only what is stored', () => {
  // The shape's whole reason for existing: `stored` and `active` are allowed to differ, and a
  // consumer that reduced them to one boolean would show a switch that is quietly wrong.
  const overridden = state({ stored: true, active: false, why: 'env-off' })
  assert.notEqual(overridden.stored, overridden.active)
})

// ------------------------------------------------------------------------------- the source pins

test('fold cache pref: main resolves the switch through the launch’s OWN rule', () => {
  const ipc = src('../src/main/ipc/foldCache.ts')
  assert.match(
    ipc,
    /resolveFoldCacheFlag\(\{\s*pref:/,
    'the handler must answer through resolveFoldCacheFlag — a second copy of the rule is a second answer'
  )
  assert.match(ipc, /process\.env\.EQ_FOLD_CACHE/, 'the environment override must be part of the answer')
  assert.match(
    ipc,
    /typeof enabled === 'boolean'/,
    'the setter must validate at the handler; a non-boolean leaves the preference exactly as it was'
  )
  // NO "apply now": the checkpoint is resolved once per launch, at character attach.
  assert.ok(
    !/restoreFold|saveFold|registry\./.test(ipc),
    'flipping the switch must not try to change this session’s fold — it takes effect next launch'
  )
})

test('fold cache pref: the preference is reachable from the renderer, both ways', () => {
  // The bridge slice is `preload/perf.ts` because the card is an item of Preferences →
  // Performance; `preload/index.ts` is at the repo's line ceiling and spreads it in.
  const preload = src('../src/preload/perf.ts')
  assert.match(preload, /getFoldCache: \(\): Promise<FoldCacheState>/)
  assert.match(preload, /setFoldCache: \(enabled: boolean\): Promise<FoldCacheState>/)
  const ipcNames = src('../src/shared/ipc.ts')
  assert.match(ipcNames, /foldCacheGet: 'foldCache:get'/)
  assert.match(ipcNames, /foldCacheSet: 'foldCache:set'/)
  const index = src('../src/main/ipc/index.ts')
  assert.match(index, /registerFoldCacheIpc\(\)/, 'the handlers must actually be registered')
})

test('fold cache pref: the card is in Preferences, and speaks the app’s plain voice', () => {
  const perf = src('../src/renderer/src/features/preferences/PerfSetting.tsx')
  assert.match(perf, /<FoldCacheSetting \/>/, 'the card must be an item of the Performance section')
  assert.match(perf, /id: 'fold-cache'/)

  const card = src('../src/renderer/src/features/preferences/FoldCacheSetting.tsx')
  assert.match(card, /data-testid="pref-fold-cache-enabled"/, 'the e2e drives it by test id')
  // IT TAKES EFFECT NEXT LAUNCH, and the copy has to say so — a switch that appears to do nothing
  // is the defect this sentence prevents.
  assert.match(card, /next launch/i)
  // STATE, NEVER PROCESS: no checkpoint/byte-offset/container vocabulary in what the user reads.
  // Only the CAPTION FUNCTION's own strings — the file's header is allowed to name the mechanism,
  // and does, at length.
  const body = card.slice(card.indexOf('function caption('), card.indexOf('export function FoldCacheSetting'))
  assert.ok(body.length > 200, 'the caption function must be findable')
  const captions = [...body.matchAll(/'([^'\\]{40,})'/g)].map((m) => m[1])
  assert.ok(captions.length >= 4, `the four caption cases must all be present, found ${captions.length}`)
  for (const line of captions) {
    assert.ok(
      !/checkpoint|byte|offset|container|digest|fold\b|serializ/i.test(line),
      `the caption leaks implementation vocabulary: ${line}`
    )
  }
  // …and the override case is worded, rather than the switch silently disagreeing with the launch.
  assert.ok(
    captions.some((c) => c.includes('EQ_FOLD_CACHE')),
    'the caption must name the environment override when it is the thing deciding'
  )
})
