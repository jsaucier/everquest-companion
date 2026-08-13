// THIS TIER, OR EVERY TIER OF THE ZONE (JOS-291) — the membership option, end to end.
//
// Owner directive 2026-08-13: *there should be an option to differentiate between levels of the
// zone, d0 -> d4, vs not*. The zone half of a `Zone` / `Zone + Session` slice has folded the tier
// away since JOS-130 (`Befallen 2 (Adaptive)` → `befallen`), which is right for "the place I am
// standing in" and wrong for "how is THIS tier paying" — the tiers do not pay alike. So membership
// is now a choice between the two zone folds this app already carried, and this file pins the five
// things that choice can get quietly wrong:
//
//   1. THE FOLDS, BOTH WAYS, over the tiered names EQ Legends actually prints. `allTiers` admits
//      every spelling of the camp; `exactTier` admits the one the zone line named, and neither
//      admits the zone next door. The golden-window half of this — the same question over the real
//      `The Plane of Hate - Solo 1 (Awakened)` / `- Solo 2 (Adaptive)` pair in a committed fixture
//      — is in tests/progressionWindows.test.mts.
//
//   2. THE DEFAULT IS `allTiers` AND IT IS BYTE-IDENTICAL to the read before the option existed —
//      the resolved slice field for field, and `rangeStats` / `windowItemRows` field for field,
//      filtered and unfiltered. A user who never touches the control sees what this app showed.
//
//   3. THE CAPTION NAMES WHAT MEMBERSHIP ADMITTED, under both settings. This is JOS-288's honesty
//      rule applied to the zone half — the span line IS the denominator — and it is why the clause
//      is printed even under the default: `Befallen 2 (Adaptive)` over numbers that had counted
//      plain `Befallen` too is the exact defect this ticket was filed for.
//
//   4. A MEMBERSHIP WITH NO SUBJECT IS NOT A SETTING. On `All`, a rung or a custom range the pick
//      changes nothing and says nothing, and no control is drawn for it.
//
//   5. THE TWO SURFACES KEEP THE CHOICE IN TWO DIFFERENT PLACES, ON PURPOSE — and a copy-paste in
//      either direction would be invisible to every other test in the suite:
//        • IN-APP (`ScopeBar`) — SESSION-LIFETIME AND UNPERSISTED, in `useTimeslice`'s own
//          module-scope store, exactly like the slice pick and the rate basis beside it. A
//          membership is a thing you choose while you are looking; a store key would mean a reader
//          who once narrowed to one tier comes back tomorrow to a tab hiding most of their camp.
//        • THE XP OVERLAY — PERSISTED per window beside `xpRows` / `xpSlice` / `xpBasis`, and
//          REBUILT RATHER THAN TRUSTED on the way in. An overlay remembers everything about itself
//          because it is a window you set up once and leave floating over the game
//          (useRateBasis.ts's header states the distinction at length).
//
// Rules 1–4 are pure model over hand-built snapshots, so they never skip. Rule 5 is a source pin in
// tests/fightSelection.test.mts' technique — comments stripped first, because this repo explains
// itself in prose that would otherwise satisfy its own greps.
//
// Imported RELATIVELY: node tests run through tsx with no `@shared` alias.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { rangeStats } from '../src/shared/progressionStats'
import { windowItemRows } from '../src/shared/lootRates'
import { TAIL_MS, inSlice, resolveSlice, type SliceId } from '../src/shared/timeslice'
import {
  ZONE_SCOPES,
  ZONE_SCOPE_DEFAULT,
  ZONE_SCOPE_TITLE,
  isZoneScope,
  normalizeZoneScope,
  resolveZoneScope,
  toggleZoneScope,
  zoneAdmits,
  zoneIdKey
} from '../src/shared/zoneScope'
import type { LootEvent } from '../src/shared/types'
import type { ProgressionSnap } from '../src/shared/progressionTypes'

const MIN = 60_000
const HOUR = 60 * MIN
/** An arbitrary, readable anchor — nothing here depends on the wall clock. */
const T0 = Date.parse('Sat Aug 01 12:00:00 2026')

function emptySnap(): ProgressionSnap {
  return {
    expTs: [], expPct: [], expFlag: [],
    killTs: [], killZone: [], killCredit: [],
    witnessTs: [], recentKills: [], lootTs: [],
    zoneStart: [], zoneEnd: [], zoneName: [],
    offlineStart: [], offlineEnd: [], offlineCamped: [],
    levelTs: [], levelValue: [], aaGainTs: [], aaGainAmount: [],
    lastTs: 0, windowStart: 0, dropped: 0
  }
}

function addZone(snap: ProgressionSnap, ts: number, name: string): void {
  const n = snap.zoneStart.length
  if (n > 0) snap.zoneEnd[n - 1] = ts
  snap.zoneStart.push(ts)
  snap.zoneEnd.push(0)
  snap.zoneName.push(name)
  snap.lastTs = Math.max(snap.lastTs, ts)
}

/** One kill + the experience line the game printed with it, both at `ts`. */
function addPull(snap: ProgressionSnap, ts: number, pct: number): void {
  snap.expTs.push(ts)
  snap.expPct.push(pct)
  snap.expFlag.push(0)
  snap.killTs.push(ts)
  snap.killZone.push(snap.zoneStart.length - 1)
  snap.killCredit.push(0)
  snap.lastTs = Math.max(snap.lastTs, ts)
}

const src = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8')

/** The file with block and line comments removed — these pins are about what the code DOES. */
const code = (rel: string): string =>
  src(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

// ── 5a. the in-app knob: session-lifetime, app-wide, unpersisted ──────────────────────

test('the in-app membership lives in the timeslice store and never reaches disk', () => {
  const mod = code('../src/renderer/src/features/timeslice/useTimeslice.ts')
  // Module scope IS the reset: the initializer is the default and there is nothing to go stale
  // across launches. The same shape `pickedId` and `pickedCustom` have had since JOS-130.
  assert.match(mod, /let pickedZoneScope: ZoneScope = ZONE_SCOPE_DEFAULT/)
  assert.match(mod, /resolveSlice\(\{[^}]*zoneScope[^}]*\}\)/, 'the pick is applied to the slice here')
  assert.doesNotMatch(mod, /eqOverlay|setConfig|electron-store|localStorage/, 'the pick grew a persisted home')
  // `resetTimeslice` clears every dimension of the pick, or a test that resets the slice would
  // leave a membership behind for the next one.
  assert.match(mod, /resetTimeslice[\s\S]*?pickedZoneScope = ZONE_SCOPE_DEFAULT/)
})

test('the in-app control is mounted only while the slice carries a zone', () => {
  const bar = code('../src/renderer/src/features/timeslice/ScopeBar.tsx')
  assert.match(bar, /slice\.zoneKey !== null && <ZoneScopeBar/)
  // It is a THIRD control beside the other two, not a row inside either of them. Since JOS-301 the
  // other two arrive as their CONTROL halves (their captions moved to the one line under the row),
  // which is a change of where the words are drawn and not of how many picks there are.
  assert.match(bar, /<SliceControls/)
  assert.match(bar, /<RateBasisControls/)
  // The loot ledger mounts `SliceBar` alone and must not pick this up by accident.
  assert.doesNotMatch(code('../src/renderer/src/features/loot/LootChrome.tsx'), /ZoneScopeBar/)
})

/**
 * THE BUTTONS SAY WHAT THEY DO (JOS-304, owner feedback 2026-08-13: the toggle is *hard to
 * understand*).
 *
 * Two-word labels plus a caption that only names the pick left the READER to infer what `every
 * tier` admits, and the answer is this file's own header — which nobody hovering a button can read.
 * Three things are pinned, because each fails silently:
 *
 *   • BOTH memberships have a sentence, and they are the two SIDES of one difference (`every` says
 *     the tier is folded away, `this` says the other tiers are out). A reader learns the pair from
 *     whichever button the pointer happens to land on, which is why the unselected one carries its
 *     own words too.
 *   • THE SENTENCE IS ZONE-NAME FREE. The caption under the row already prints the zone and the
 *     clause; a name interpolated here would be a second copy of a fact that line owns.
 *   • IT IS A NATIVE `title`, NOT A POPPER. JOS-143's measured reason, inherited: an interactive
 *     tooltip opened over a dense control row lands on the neighbouring buttons and eats the clicks
 *     aimed at them. That refusal is what these bars have always been documenting, and adding a
 *     hover is not permission to break it.
 */
test('each membership button hovers what picking it does, in the browser own tooltip', () => {
  for (const scope of ZONE_SCOPES) {
    const words = ZONE_SCOPE_TITLE[scope]
    assert.match(words, /^The numbers count /, `${scope}: the sentence is about the reads, not the fold`)
    assert.doesNotMatch(words, /Befallen|\$\{/, `${scope}: the zone name belongs to the caption`)
  }
  // The two sides of the one difference, each stated on its own button.
  assert.match(ZONE_SCOPE_TITLE.allTiers, /every visit to this camp, at any tier/)
  assert.match(ZONE_SCOPE_TITLE.allTiers, /folded away/)
  assert.match(ZONE_SCOPE_TITLE.exactTier, /only the tier you are standing in/)
  assert.match(ZONE_SCOPE_TITLE.exactTier, /left out/)

  const bar = code('../src/renderer/src/features/timeslice/ZoneScopeBar.tsx')
  // Per BUTTON and keyed by that button's own id — one `title` on the group would describe the pick
  // in force from the button that does not make it.
  assert.match(bar, /title=\{ZONE_SCOPE_TITLE\[id\]\}/)
  assert.doesNotMatch(bar, /Tooltip/, 'a MUI popper over this row eats the clicks aimed at it')
})

test('the slice caption is what reads the membership back on the in-app surfaces', () => {
  // `zoneCaption` carries the zone half WITH its membership clause; printing `zoneName` here would
  // put the current tier's name over numbers that admitted every tier — JOS-291's own defect.
  const bar = code('../src/renderer/src/features/timeslice/SliceBar.tsx')
  assert.match(bar, /slice\.zoneCaption/)
  assert.doesNotMatch(bar, /slice\.zoneName/)
})

// ── 5b. the overlay knob: persisted per window, rebuilt on the way in ─────────────────

test('the XP overlay persists its membership beside its slice and its denominator', () => {
  const overlay = code('../src/renderer/src/overlay/XpOverlay.tsx')
  // Written through the SAME per-kind config patch the row checklist and the basis toggle use.
  assert.match(overlay, /patch\(\{ xpZoneScope: toggleZoneScope\(slice\.zoneScope\) \}\)/)
  // Read back with ABSENT meaning the default, never a second opinion about what the default is.
  assert.match(overlay, /resolveZoneScope\(config\?\.xpZoneScope\)/)
  // And applied through `resolveSlice`, so the caption, the rates and the mote rows cannot end up
  // on different memberships.
  assert.match(overlay, /resolveSlice\(\{ snap: prog, bounds, id, zoneScope \}\)/)
  // Drawn only while the slice names a zone — the same rule as the in-app control.
  assert.match(overlay, /slice\.zoneName !== null && \(\s*<TierToggle/)
})

test('main REBUILDS the stored membership rather than trusting the renderer', () => {
  const store = code('../src/main/store.ts')
  assert.match(store, /const xpZoneScope = normalizeZoneScope\(next\.xpZoneScope\)/)
  // Present only on the 'xp' kind, deleted everywhere else — a malformed patch cannot grow a zone
  // membership on a damage meter (the `xpRows` / `xpBasis` rule, applied to the fourth knob).
  assert.match(store, /if \(xpZoneScope && kind === 'xp'\) next\.xpZoneScope = xpZoneScope\s*\n\s*else delete next\.xpZoneScope/)
})

test('the DEFAULT is never written out, on either surface', () => {
  // Absent means `allTiers` everywhere, so nothing seeds it into the store's own defaults — the
  // same argument the xp window's other three knobs are held to (src/main/store.ts's comment).
  const store = code('../src/main/store.ts')
  assert.doesNotMatch(store, /xp: \{[^}]*xpZoneScope/, 'the default was spelled into the shipped config')
  assert.doesNotMatch(store, /xpZoneScope: 'allTiers'/)
})
// ── 1-4. the model: the folds, the default, the caption, and the setting with no subject

/**
 * THE SHAPE THE TICKET IS ABOUT, in the owner's own example: one camp the log spells two ways, with
 * a different zone in between so a fold that admitted too much would be visible.
 *
 * `Befallen` is 1% a pull; `Befallen 2 (Adaptive)` is 5% — the tiers do not pay alike, which is the
 * whole reason a reader may want them apart. The current zone is the tiered one, so `exactTier`
 * admits the second visit and `allTiers` admits both.
 */
function tieredSnap(): { snap: ProgressionSnap; lo: number; hi: number } {
  const snap = emptySnap()
  addZone(snap, T0, 'Befallen')
  for (let m = 0; m < 60; m++) addPull(snap, T0 + m * MIN, 1)
  addZone(snap, T0 + HOUR, 'Lower Guk')
  for (let m = 0; m < 60; m++) addPull(snap, T0 + HOUR + m * MIN, 2)
  addZone(snap, T0 + 2 * HOUR, 'Befallen 2 (Adaptive)')
  for (let m = 0; m < 60; m++) addPull(snap, T0 + 2 * HOUR + m * MIN, 5)
  return { snap, lo: T0, hi: snap.lastTs }
}

/** The three tiered-camp drops, one per visit above. */
const tieredDrops: LootEvent[] = [
  { ts: T0 + 10 * MIN, item: 'Mote of Potential', zone: 'Befallen' },
  { ts: T0 + HOUR + 10 * MIN, item: 'Mote of Potential', zone: 'Lower Guk' },
  { ts: T0 + 2 * HOUR + 10 * MIN, item: 'Mote of Potential', zone: 'Befallen 2 (Adaptive)' }
]

test('the membership folds BOTH WAYS: the place, or the tier the zone line named', () => {
  const { snap, lo, hi } = tieredSnap()
  const bounds = { lo, hi }
  const every = resolveSlice({ snap, bounds, id: 'zone', zoneScope: 'allTiers' })
  const only = resolveSlice({ snap, bounds, id: 'zone', zoneScope: 'exactTier' })

  // ONE zone key either way — exact NARROWS, it never re-points the slice at another place.
  assert.equal(every.zoneKey, 'befallen')
  assert.equal(only.zoneKey, 'befallen')
  assert.equal(every.zoneExactKey, null, 'the default carries no exact key at all — see the pin below')
  assert.equal(only.zoneExactKey, zoneIdKey('Befallen 2 (Adaptive)'))
  assert.equal(only.zoneName, 'Befallen 2 (Adaptive)', 'and the RAW name is still what a caption shows')

  const everyStats = rangeStats({ snap, range: every.range, zoneKey: every.zoneKey, zoneExactKey: every.zoneExactKey })
  const onlyStats = rangeStats({ snap, range: only.range, zoneKey: only.zoneKey, zoneExactKey: only.zoneExactKey })
  assert.equal(everyStats.kills, 120, 'both tiers of the camp, and neither of the 60 kills in Guk')
  assert.equal(onlyStats.kills, 60, 'the tier the log last named, alone')
  assert.equal(everyStats.zones.length, 2, 'two spellings, two rows')
  assert.equal(onlyStats.zones.length, 1, 'one spelling admitted, one row back')
  // The point of the option, as a number: the tiers pay differently and the reads say so.
  assert.ok((onlyStats.levelsPerHourActive ?? 0) > (everyStats.levelsPerHourActive ?? 0))

  // …and the LOOT side folds identically, which is what rule 5 is for.
  assert.deepEqual(tieredDrops.filter((e) => inSlice(every, e.ts, e.zone)).map((e) => e.zone), [
    'Befallen',
    'Befallen 2 (Adaptive)'
  ])
  assert.deepEqual(tieredDrops.filter((e) => inSlice(only, e.ts, e.zone)).map((e) => e.zone), [
    'Befallen 2 (Adaptive)'
  ])
  const spans = { durationMs: HOUR, activeMs: HOUR, offlineMs: 0 }
  const args = { events: tieredDrops, t0: every.range.t0, t1: every.range.t1, spans }
  assert.equal(windowItemRows({ ...args, zoneKey: every.zoneKey })[0].drops, 2)
  assert.equal(windowItemRows({ ...args, zoneKey: only.zoneKey, zoneExactKey: only.zoneExactKey })[0].drops, 1)
})

test('the DEFAULT is all tiers, and all tiers is byte-identical to the read before the option', () => {
  const { snap, lo, hi } = tieredSnap()
  const bounds = { lo, hi }
  // The resolved SLICE first: saying nothing and saying `allTiers` are the same slice, field for
  // field — including the caption, so a build with the option cannot open on a different sentence.
  assert.deepEqual(resolveSlice({ snap, bounds, id: 'zone' }), resolveSlice({ snap, bounds, id: 'zone', zoneScope: 'allTiers' }))
  assert.equal(ZONE_SCOPE_DEFAULT, 'allTiers')
  assert.equal(resolveZoneScope(undefined), 'allTiers')

  // Then the ANSWERS, field for field, filtered and unfiltered: a null exact key is not a filter.
  const range = { t0: lo, t1: hi + TAIL_MS }
  assert.deepEqual(rangeStats({ snap, range, zoneExactKey: null }), rangeStats({ snap, range }))
  assert.deepEqual(
    rangeStats({ snap, range, zoneKey: 'befallen', zoneExactKey: null }),
    rangeStats({ snap, range, zoneKey: 'befallen' })
  )
  const spans = { durationMs: HOUR, activeMs: HOUR, offlineMs: 0 }
  const args = { events: tieredDrops, t0: lo, t1: hi + TAIL_MS, spans, zoneKey: 'befallen' }
  assert.deepEqual(windowItemRows({ ...args, zoneExactKey: null }), windowItemRows(args))

  // And `zoneAdmits` itself: no keys at all is "every zone", which is the unfiltered read.
  assert.ok(zoneAdmits('Befallen 2 (Adaptive)'))
  assert.ok(zoneAdmits('Befallen 2 (Adaptive)', 'befallen'))
  assert.ok(!zoneAdmits('Befallen', 'befallen', zoneIdKey('Befallen 2 (Adaptive)')), 'exact narrows')
  assert.ok(!zoneAdmits('Lower Guk', 'befallen'), 'and the place key still decides the place')
})

test('the CAPTION names what membership admitted, under both settings and under the default', () => {
  const { snap, lo, hi } = tieredSnap()
  const bounds = { lo, hi }
  const of = (id: SliceId, zoneScope: 'allTiers' | 'exactTier'): ReturnType<typeof resolveSlice> =>
    resolveSlice({ snap, bounds, id, zoneScope })

  // The default's clause is the fact the old caption was hiding: it printed `Befallen 2 (Adaptive)`
  // over numbers that had counted plain `Befallen` too. Naming it is JOS-288's honesty rule applied
  // to the zone half — the span line IS the denominator.
  assert.equal(of('zone', 'allTiers').caption, 'Befallen 2 (Adaptive), every tier')
  assert.equal(of('zone', 'exactTier').caption, 'Befallen 2 (Adaptive), this tier only')
  // The membership clause lands after the session phrase, so neither reads as "only this session".
  assert.equal(of('zoneSession', 'allTiers').caption, 'Befallen 2 (Adaptive) this session, every tier')
  assert.equal(of('zoneSession', 'exactTier').caption, 'Befallen 2 (Adaptive) this session, this tier only')
  // The ZONE HALF alone, for the controls that print the range themselves (`SliceBar`).
  assert.equal(of('zone', 'exactTier').zoneCaption, 'Befallen 2 (Adaptive), this tier only')
  assert.equal(of('zoneSession', 'allTiers').zoneCaption, 'Befallen 2 (Adaptive), every tier')
})

test('a slice with no zone in it has no membership to state, whatever was picked', () => {
  const { snap, lo, hi } = tieredSnap()
  const bounds = { lo, hi }
  for (const id of ['all', 'h1', 'custom'] as const) {
    const s = resolveSlice({ snap, bounds, id, zoneScope: 'exactTier' })
    assert.equal(s.zoneScope, 'allTiers', `${id}: a membership with no subject resolves to the default`)
    assert.equal(s.zoneExactKey, null)
    assert.equal(s.zoneCaption, null, '…and the caption says nothing about tiers')
    assert.deepEqual(s, resolveSlice({ snap, bounds, id }), '…so the pick cannot move an unzoned slice')
  }
})

test('the membership is a CLOSED union, because it is persisted', () => {
  assert.deepEqual([...ZONE_SCOPES], ['allTiers', 'exactTier'])
  assert.ok(isZoneScope('exactTier'))
  assert.ok(!isZoneScope('everyTier'), 'a spelling this build does not know is not a membership')
  assert.ok(!isZoneScope(2))
  // Rebuilt, never trusted: unknown ⇒ absent ⇒ the default, which is the honest degrade (a store
  // naming a membership this build cannot apply must not scope a rate by a rule nothing implements).
  assert.equal(normalizeZoneScope('exactTier'), 'exactTier')
  assert.equal(normalizeZoneScope('sometimes'), undefined)
  assert.equal(normalizeZoneScope(null), undefined)
  assert.equal(resolveZoneScope(normalizeZoneScope('sometimes')), ZONE_SCOPE_DEFAULT)
  // Two states, so the control is a flip and not a menu — and it round-trips.
  assert.equal(toggleZoneScope('allTiers'), 'exactTier')
  assert.equal(toggleZoneScope('exactTier'), 'allTiers')
  assert.equal(toggleZoneScope(toggleZoneScope(undefined)), ZONE_SCOPE_DEFAULT)
})

