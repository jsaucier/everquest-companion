// GEAR TAB — the filter, the sort, the threshold parser and the plus-state wiring (JOS-284,
// phase 3). Pure model only: `src/renderer/src/features/gear/gearFilter.ts` and `gearColumns.ts`
// touch no React, no storage and no IPC, so they run under the node runner like `plannerGroups`
// and `plannerClasses` before them.
//
// THE FIXTURES ARE THE TWO ITEMS PHASE 0 IS PINNED ON, with their base vectors copied from
// `tests/gearIndex.test.mts` (which asserts them against the REAL corpus). That is the point of
// spelling them out here rather than building the index: if the corpus ever states different
// numbers for Thelvorn, gearIndex.test.mts goes red FIRST and names the corpus, instead of this
// file going red and blaming the filter.
//
// WHAT THIS FILE IS FOR, in one sentence: the gear table's answers must be the SCALED ones. A
// threshold, a ratio floor and a sort all read the vector AFTER `scaleAll`, so "weapons at ratio
// 1.0" under a +5 slider means the weapons that reach 1.0 at +5 — and the test that proves it is
// `a ratio floor no weapon meets at base is met at the checkpoint`, below.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { GearRow } from '../src/shared/planner/gear'
import { scaleGearRow } from '../src/shared/planner/gearScale'
import type { ItemUpgradeState } from '../src/shared/itemUpgrade'
import {
  DEFAULT_GEAR_FILTERS,
  DEFAULT_GEAR_SORT,
  classMismatch,
  effectMatches,
  filterGearRows,
  gearTableRows,
  matchesGear,
  meetsThresholds,
  parseThreshold,
  scaleAll,
  sortGearRows,
  sortValue,
  thresholdLabel,
  withThreshold,
  type GearFilters
} from '../src/renderer/src/features/gear/gearFilter'
import {
  CORE_COLUMNS,
  MAX_DERIVED_COLUMNS,
  columnLabel,
  numericWidth,
  statText,
  visibleColumns
} from '../src/renderer/src/features/gear/gearColumns'

// =================================================================================
// FIXTURES
// =================================================================================

function row(over: Partial<GearRow> & Pick<GearRow, 'key' | 'name'>): GearRow {
  return {
    searchKey: over.name.toLowerCase(),
    slots: [],
    classes: [],
    races: ['ALL'],
    flags: [],
    quest: false,
    playerCrafted: false,
    stats: {},
    effects: [],
    ...over
  }
}

/** Thelvorn, Blade of Light — DMG 20, Atk Delay 26, WIS +15, WT 3.0 (tests/gearIndex.test.mts). */
const THELVORN = row({
  key: 'thelvorn, blade of light',
  name: 'Thelvorn, Blade of Light',
  slots: ['PRIMARY'],
  classes: ['PAL'],
  skill: '1H Slashing',
  stats: { WIS: 15, DMG: 20, DELAY: 26, WEIGHT: 3 },
  effects: [{ name: 'Dismiss Summoned', kind: 'combat', socket: 'proc', tierRequired: 4 }]
})

/** Crown of King Tranix — AC 13, CHA +15, SV MAGIC +20, WT 1.0, and the SV VOID synthesis case. */
const CROWN = row({
  key: 'crown of king tranix',
  name: 'Crown of King Tranix',
  slots: ['HEAD'],
  classes: ['CLR', 'ENC', 'MAG', 'NEC', 'WIZ'],
  stats: { AC: 13, CHA: 15, SV_MAGIC: 20, WEIGHT: 1 },
  voidSynth: true,
  effects: [{ name: 'Shielding', kind: 'worn', socket: 'worn', tierRequired: 3 }],
  eraTag: 'Classic'
})

/** A plain, effect-free, stat-free row — the "states none" case every rule has to survive. */
const PLAIN = row({ key: 'cloth cap', name: 'Cloth Cap', slots: ['HEAD'], classes: [], stats: { WEIGHT: 0.5 } })

/** A second weapon with a WORSE base ratio but a haste line, for the sort and threshold tests. */
const CLUB = row({
  key: 'wooden club',
  name: 'Wooden Club',
  slots: ['PRIMARY', 'SECONDARY'],
  classes: ['WAR', 'PAL'],
  stats: { DMG: 5, DELAY: 30, HASTE: 10, HP_REGEN: 2, WEIGHT: 2 },
  effects: []
})

const ALL = [THELVORN, CROWN, PLAIN, CLUB]

/** "Tier 2   3 / 4" — the owner screenshot every phase-0 number in this repo is verified against. */
const CHECKPOINT: ItemUpgradeState = { full: 2, fraction: 3 }
const BASE: ItemUpgradeState = { full: 0, fraction: 0 }

function filters(over: Partial<GearFilters> = {}): GearFilters {
  // Era OFF unless a test is about era: the default is ON, and the injected verdict is the one
  // thing this pure module cannot answer, so leaving it on would silently depend on the injection.
  return { ...DEFAULT_GEAR_FILTERS, eraOnly: false, ...over }
}

const names = (rows: readonly GearRow[]): string[] => rows.map((r) => r.name)

// =================================================================================
// THRESHOLD PARSING
// =================================================================================

test('a threshold is parsed in the spellings a player types, and folded by phase 0', () => {
  assert.deepEqual(parseThreshold('hp 50'), { key: 'HP', min: 50 })
  assert.deepEqual(parseThreshold('HP>=50'), { key: 'HP', min: 50 })
  assert.deepEqual(parseThreshold('  ac  >  20 '), { key: 'AC', min: 20 })
  assert.deepEqual(parseThreshold('sv magic: 20'), { key: 'SV_MAGIC', min: 20 })
  // The aliases are `normalizeStatKey`'s, never a second table here — MANA → MP, REGEN → HP_REGEN.
  assert.deepEqual(parseThreshold('mana 100'), { key: 'MP', min: 100 })
  assert.deepEqual(parseThreshold('regen 3'), { key: 'HP_REGEN', min: 3 })
  assert.deepEqual(parseThreshold('mana regen 2'), { key: 'MANA_REGEN', min: 2 })
  assert.deepEqual(parseThreshold('wt 2.5'), { key: 'WEIGHT', min: 2.5 })
  assert.deepEqual(parseThreshold('backstab 9'), { key: 'BACKSTAB', min: 9 })
  assert.deepEqual(parseThreshold('str -5'), { key: 'STR', min: -5 })
})

test('a threshold the vector cannot compare is REFUSED, never half-understood', () => {
  assert.equal(parseThreshold(''), null)
  assert.equal(parseThreshold('hp'), null, 'no number is not a threshold')
  assert.equal(parseThreshold('50'), null, 'no key is not a threshold')
  assert.equal(parseThreshold('sparkle 5'), null, 'an unknown stat')
  // CHARGES / COOLDOWN / CAST TIME / REQUIRED LEVEL are deliberately out of the vector (gear.ts),
  // so the table has no column to show them in and no value to compare — refused, not silently on.
  assert.equal(parseThreshold('charges 5'), null)
  assert.equal(parseThreshold('required level 40'), null)
})

test('one key carries one minimum, and the chip says which', () => {
  const first = withThreshold([], { key: 'HP', min: 20 })
  const second = withThreshold(first, { key: 'HP', min: 50 })
  assert.deepEqual(second, [{ key: 'HP', min: 50 }], 'the newer number replaces the older')
  assert.equal(withThreshold(second, { key: 'AC', min: 10 }).length, 2)
  assert.equal(thresholdLabel({ key: 'SV_MAGIC', min: 20 }), 'SV MAGIC >= 20')
})

// =================================================================================
// THE PREDICATES — absent is not zero
// =================================================================================

test('a threshold is met only by a row that STATES the stat', () => {
  assert.equal(meetsThresholds(THELVORN, [{ key: 'WIS', min: 15 }]), true)
  assert.equal(meetsThresholds(THELVORN, [{ key: 'WIS', min: 16 }]), false)
  // THE RULE THIS WHOLE FILE EXISTS FOR: an item with no HASTE line is not an item with 0% haste.
  assert.equal(meetsThresholds(THELVORN, [{ key: 'HASTE', min: 0 }]), false)
  assert.equal(meetsThresholds(CLUB, [{ key: 'HASTE', min: 0 }]), true)
  // …and thresholds AND: the club states both, Thelvorn neither.
  assert.equal(meetsThresholds(CLUB, [{ key: 'HASTE', min: 10 }, { key: 'HP_REGEN', min: 2 }]), true)
  assert.equal(meetsThresholds(CLUB, [{ key: 'HASTE', min: 10 }, { key: 'HP_REGEN', min: 3 }]), false)
  assert.equal(meetsThresholds(PLAIN, []), true, 'no thresholds is not a filter')
})

test('a class list nobody stated is an unknown, and an unknown is never a mismatch', () => {
  assert.equal(classMismatch(['PAL'], ['WAR', 'ROG']), true)
  assert.equal(classMismatch(['PAL'], ['PAL', 'ROG']), false)
  assert.equal(classMismatch([], ['WAR']), false, 'the page stated no class list')
  assert.equal(classMismatch(['PAL'], []), false, 'an empty filter asks for no filter')
})

test('the effect filter speaks the donor vocabulary, plus "has one at all"', () => {
  assert.equal(effectMatches(PLAIN, 'any'), true)
  assert.equal(effectMatches(PLAIN, 'has'), false)
  assert.equal(effectMatches(THELVORN, 'has'), true)
  assert.equal(effectMatches(THELVORN, 'proc'), true)
  assert.equal(effectMatches(THELVORN, 'worn'), false)
  assert.equal(effectMatches(CROWN, 'worn'), true)
})

// =================================================================================
// THE COMBINED FILTER
// =================================================================================

test('every filter is ANDed, and each is inert at its empty value', () => {
  assert.deepEqual(names(filterGearRows(ALL, filters())), names(ALL), 'the empty filter filters nothing')

  assert.deepEqual(names(filterGearRows(ALL, filters({ slot: 'PRIMARY' }))), ['Thelvorn, Blade of Light', 'Wooden Club'])
  assert.deepEqual(names(filterGearRows(ALL, filters({ text: 'blade' }))), ['Thelvorn, Blade of Light'])
  assert.deepEqual(names(filterGearRows(ALL, filters({ effect: 'proc' }))), ['Thelvorn, Blade of Light'])

  // Four at once: slot AND class AND threshold AND search.
  const narrow = filters({
    slot: 'PRIMARY',
    classes: ['PAL'],
    classOnly: true,
    thresholds: [{ key: 'WIS', min: 10 }],
    text: 'thelvorn'
  })
  assert.deepEqual(names(filterGearRows(ALL, narrow)), ['Thelvorn, Blade of Light'])
  // …and one contradiction empties it, without any of the others being wrong.
  assert.deepEqual(filterGearRows(ALL, { ...narrow, thresholds: [{ key: 'WIS', min: 99 }] }), [])
})

test('the class filter HIDES only while it is on, and never enforces', () => {
  const wrongClass = filters({ classes: ['ROG'] })
  assert.equal(filterGearRows(ALL, wrongClass).length, 4, 'off, it hides nothing')
  const enforced = filterGearRows(ALL, { ...wrongClass, classOnly: true })
  // The Cloth Cap states NO class list, so it survives: silence is not a refusal (law 1).
  assert.deepEqual(names(enforced), ['Cloth Cap'])
})

test('the era verdict is INJECTED, and only applies while the toggle is on', () => {
  const hidesCrown = { eraHidden: (r: GearRow) => r.key === CROWN.key }
  assert.equal(matchesGear(CROWN, filters({ eraOnly: true }), hidesCrown), false)
  assert.equal(matchesGear(CROWN, filters({ eraOnly: false }), hidesCrown), true)
  assert.equal(matchesGear(CROWN, filters({ eraOnly: true }), {}), true, 'no verdict hides nothing')
})

test('a ratio floor excludes everything that is not a weapon', () => {
  const weapons = filterGearRows(ALL, filters({ minRatio: 0.1 }))
  assert.deepEqual(names(weapons), ['Thelvorn, Blade of Light', 'Wooden Club'])
  assert.deepEqual(names(filterGearRows(ALL, filters({ minRatio: 0.7 }))), ['Thelvorn, Blade of Light'])
})

// =================================================================================
// THE SORT
// =================================================================================

test('an absent stat sorts LAST in BOTH directions, and never as a zero', () => {
  for (const dir of ['asc', 'desc'] as const) {
    const sorted = sortGearRows(ALL, { key: 'HASTE', dir })
    assert.equal(sorted[0].name, 'Wooden Club', `${dir}: the only row stating HASTE leads`)
    assert.deepEqual(names(sorted).slice(1), ['Cloth Cap', 'Crown of King Tranix', 'Thelvorn, Blade of Light'])
  }
})

test('the sort is TOTAL — name is the tiebreak, so nothing re-shuffles under the scrollbar', () => {
  const a = row({ key: 'b ring', name: 'B Ring', slots: ['FINGER'], stats: { AC: 5 } })
  const b = row({ key: 'a ring', name: 'A Ring', slots: ['FINGER'], stats: { AC: 5 } })
  assert.deepEqual(names(sortGearRows([a, b], { key: 'AC', dir: 'desc' })), ['A Ring', 'B Ring'])
  assert.deepEqual(names(sortGearRows([b, a], { key: 'AC', dir: 'desc' })), ['A Ring', 'B Ring'])
  assert.deepEqual(names(sortGearRows([a, b], { key: 'name', dir: 'desc' })), ['B Ring', 'A Ring'])
})

test('ratio is a sort key of its own, and it is gearRatio - never a second opinion', () => {
  const sorted = sortGearRows(ALL, { key: 'RATIO', dir: 'desc' })
  assert.deepEqual(names(sorted).slice(0, 2), ['Thelvorn, Blade of Light', 'Wooden Club'])
  assert.equal(sortValue(THELVORN, 'RATIO')?.toFixed(2), '0.77')
  assert.equal(sortValue(CROWN, 'RATIO'), undefined, 'a crown has no damage ratio')
  assert.equal(sortValue(THELVORN, 'BACKSTAB'), undefined)
  assert.equal(sortValue(THELVORN, 'name'), undefined, 'the name is not a number')
})

// =================================================================================
// THE GLOBAL PLUS-STATE — the wiring this phase exists to add
// =================================================================================

test('scaleAll is a PURE MAP, and it is scaleGearRow s answer', () => {
  const scaled = scaleAll(ALL, CHECKPOINT)
  assert.equal(scaled.length, ALL.length)
  for (let i = 0; i < ALL.length; i++) {
    assert.deepEqual(scaled[i].stats, scaleGearRow(ALL[i], CHECKPOINT).stats, ALL[i].name)
    assert.equal(scaled[i].key, ALL[i].key, 'the row identity - and the ownership join key - survives')
  }
  // The bases are untouched, which is what makes dragging the slider reversible rather than
  // cumulative: the next state starts from the same numbers.
  assert.deepEqual(THELVORN.stats, { WIS: 15, DMG: 20, DELAY: 26, WEIGHT: 3 })
})

test('the table reproduces the owner screenshot at the checkpoint', () => {
  const [thelvorn] = scaleAll([THELVORN], CHECKPOINT)
  assert.equal(thelvorn.stats.DMG, 25)
  assert.equal(thelvorn.stats.WIS, 19) // floor(15 + round(4.125)), NOT 20
  assert.equal(thelvorn.stats.WEIGHT, 2.3) // ceil-to-one-decimal of 2.2420…
  assert.equal(thelvorn.stats.DELAY, 26) // delay never scales — which is why the ratio moves
  assert.equal(sortValue(thelvorn, 'RATIO')?.toFixed(2), '0.96')
  // The synthetic save is the one fact the vector cannot re-derive, so the row's cached answer
  // has to survive the scaling stage too — a filter on SV VOID must see it.
  const [crown] = scaleAll([CROWN], CHECKPOINT)
  assert.equal(crown.stats.SV_VOID, 2)
  assert.equal(meetsThresholds(crown, [{ key: 'SV_VOID', min: 1 }]), true)
  assert.equal(meetsThresholds(CROWN, [{ key: 'SV_VOID', min: 1 }]), false, 'not at base, it does not')
})

test('a ratio floor no weapon meets at base IS met at the checkpoint', () => {
  // THE LOAD-BEARING PROPERTY of the whole phase: filters and sorts read the SCALED vector, so the
  // answer to "ratio at least 0.9" depends on where the global selector is standing.
  const wanted = filters({ minRatio: 0.9 })
  assert.deepEqual(names(gearTableRows(ALL, BASE, { filters: wanted })), [])
  assert.deepEqual(names(gearTableRows(ALL, CHECKPOINT, { filters: wanted })), ['Thelvorn, Blade of Light'])

  // …and the same for a threshold: nothing has WIS 19 at base, Thelvorn does at the checkpoint.
  const wis19 = filters({ thresholds: [{ key: 'WIS', min: 19 }] })
  assert.deepEqual(names(gearTableRows(ALL, BASE, { filters: wis19 })), [])
  assert.deepEqual(names(gearTableRows(ALL, CHECKPOINT, { filters: wis19 })), ['Thelvorn, Blade of Light'])
})

test('a sort reads the SCALED numbers, non-linear curve and float artifact included', () => {
  // WEIGHT is the one key whose curve is not linear in the tier (`scaleWeight` takes
  // `totalProgression` through a log2), and phase 0 deliberately REPLICATES the IEEE754 artifact
  // the wiki's own slider has — 3.0 at tier 10 ceils to 0.4 where exact decimal math says 0.3.
  // A sort that re-derived weights any other way would disagree with the item page it came from.
  const byWeight = { key: 'WEIGHT', dir: 'asc' } as const
  const order = ['Cloth Cap', 'Crown of King Tranix', 'Wooden Club', 'Thelvorn, Blade of Light']
  assert.deepEqual(names(gearTableRows(ALL, BASE, { filters: filters(), sort: byWeight })), order)
  assert.deepEqual(gearTableRows(ALL, BASE, { filters: filters(), sort: byWeight }).map((r) => r.stats.WEIGHT), [
    0.5, 1, 2, 3
  ])

  const at10 = gearTableRows(ALL, { full: 10, fraction: 0 }, { filters: filters(), sort: byWeight })
  assert.deepEqual(names(at10), order, 'the ranking survives — every weight shrinks by the same curve')
  assert.deepEqual(at10.map((r) => r.stats.WEIGHT), [0.1, 0.2, 0.3, 0.4])
})

// =================================================================================
// THE COLUMNS — asking about a stat is already saying you want to see it
// =================================================================================

test('the columns are the core, plus whatever is being filtered or sorted on', () => {
  const base = visibleColumns(filters(), DEFAULT_GEAR_SORT)
  assert.deepEqual(base.map((c) => c.key), [...CORE_COLUMNS], 'the core, and only the core')

  const withRegen = visibleColumns(filters({ thresholds: [{ key: 'HP_REGEN', min: 2 }] }), DEFAULT_GEAR_SORT)
  assert.deepEqual(withRegen.map((c) => c.key), [...CORE_COLUMNS, 'HP_REGEN'])
  assert.equal(withRegen[withRegen.length - 1].label, 'HP REGEN')

  // A sort key brings its own column — and one that is already core adds nothing.
  const byBackstab = visibleColumns(filters(), { key: 'BACKSTAB', dir: 'desc' })
  assert.deepEqual(byBackstab.map((c) => c.key), [...CORE_COLUMNS, 'BACKSTAB'])
  assert.deepEqual(visibleColumns(filters(), { key: 'AC', dir: 'asc' }).map((c) => c.key), [...CORE_COLUMNS])
  assert.deepEqual(visibleColumns(filters(), { key: 'name', dir: 'asc' }).map((c) => c.key), [...CORE_COLUMNS])
})

test('the derived columns are capped, and the widths always fit the pane', () => {
  const many = filters({
    thresholds: [
      { key: 'STR', min: 1 },
      { key: 'STA', min: 1 },
      { key: 'AGI', min: 1 },
      { key: 'DEX', min: 1 },
      { key: 'WIS', min: 1 },
      { key: 'INT', min: 1 },
      { key: 'CHA', min: 1 },
      { key: 'HASTE', min: 1 }
    ]
  })
  const cols = visibleColumns(many, DEFAULT_GEAR_SORT)
  assert.equal(cols.length, CORE_COLUMNS.length + MAX_DERIVED_COLUMNS)
  // …and the eighth threshold still FILTERS, it just stops drawing a column of its own.
  assert.equal(matchesGear(THELVORN, many), false)

  const pct = Number(numericWidth(cols.length).replace('%', ''))
  assert.ok(pct * cols.length <= 60, `${String(cols.length)} columns at ${String(pct)}% overflow the table`)
  assert.equal(numericWidth(4), '13%')
})

test('a cell states what the item states - blank is "states none", never a zero', () => {
  assert.equal(statText(undefined, 'HP'), '')
  assert.equal(statText(0, 'HP'), '0', 'a stated zero IS a zero')
  assert.equal(statText(41, 'HASTE'), '41%')
  assert.equal(statText(2.3, 'WEIGHT'), '2.3')
  assert.equal(statText(0.9615, 'RATIO'), '0.96')
  assert.equal(columnLabel('RATIO'), 'Ratio')
  assert.equal(columnLabel('name'), 'Item')
  assert.equal(columnLabel('MANA_REGEN'), 'MANA REGEN')
})
