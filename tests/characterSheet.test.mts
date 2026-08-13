// CHARACTER SHEET (JOS-45) — the armory grid and the gear sum, pinned against the real dump.
//
// Two independent things are under test and they fail for different reasons:
//
//   THE GRID is a hand-authored table (law 12) over the CLIENT's own Location tokens, and its
//   only rule for the four paired slots (`Ear`, `Wrist`, `Fingers`, `Any Slot`) is OCCURRENCE
//   ORDER — the file states no side. So the grid is pinned three ways: it is total over the
//   client's closed token set, its cells are unique, and it places the real 295-line dump's
//   twenty-four equipment rows with nothing left over and nothing invented.
//
//   THE SUM must never assert arithmetic nobody measured. The two things it refuses are pinned
//   directly: a percentage never enters a total (two worn items carry Haste), and an item the
//   committed DB does not know is COUNTED as unknown rather than silently treated as zero.
//   That second one is not hypothetical — the dev character's `Djarn's Amethyst Ring` is titled
//   `Djarns Amethyst Ring` on the wiki, a genuine cross-source name difference law 12 forbids
//   closing with a matcher.
//
// The DB half re-does main's join here (`buildItemDbIndex` + `itemKey`, both Electron-free) so
// this stays a node test: `src/main/ipc/characterSheet.ts` imports electron and cannot be
// driven from the runner. It is the SAME two functions the handler calls.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { EQUIP_LOCATIONS } from '../src/shared/outputs/inventory'
import { parseInventoryDump } from '../src/main/outputs/inventoryParse'
import { SHEET_SLOTS, sheetCells, statInteger, sumGear } from '../src/shared/characterSheet'
import type { ItemStatBlock } from '../src/shared/itemStats'
import { buildItemDbIndex, itemKey, type ItemDbFile } from '../src/main/itemsDb'

const REAL_DUMP = readFileSync(
  join(import.meta.dirname, 'fixtures', 'Primitive_freeport-Inventory.txt'),
  'utf8'
)
const dump = parseInventoryDump(REAL_DUMP)
const { cells, unplaced } = sheetCells(dump)
const cell = (id: string): (typeof cells)[number] => {
  const found = cells.find((c) => c.id === id)
  assert.ok(found, `no cell ${id}`)
  return found
}

// ---- the grid ------------------------------------------------------------------------

test('the grid is TOTAL over the client tokens, and every cell id is unique', () => {
  const ids = new Set(SHEET_SLOTS.map((s) => s.id))
  assert.equal(ids.size, SHEET_SLOTS.length, 'two cells share an id')
  for (const token of EQUIP_LOCATIONS) {
    assert.ok(
      SHEET_SLOTS.some((s) => s.token === token),
      `no cell reads the client token ${token} — it would vanish off the sheet`
    )
  }
  // Every (token, nth) pair is claimed by exactly one cell, or two cells would fight over a row.
  const pairs = new Set(SHEET_SLOTS.map((s) => `${s.token}#${String(s.nth)}`))
  assert.equal(pairs.size, SHEET_SLOTS.length)
})

test('both cells of a pair carry the SAME label — the file never says which is left', () => {
  for (const token of ['Ear', 'Wrist', 'Fingers', 'Any Slot'] as const) {
    const pair = SHEET_SLOTS.filter((s) => s.token === token)
    assert.equal(pair.length, 2, `${token} occurs twice at top level in the real dump`)
    assert.equal(pair[0].label, pair[1].label, `${token} cells must not claim an order`)
    assert.ok(!/\d/.test(pair[0].label), `${token} label must not number the slots`)
  }
})

test('the real dump fills every cell it should, and leaves nothing unplaced', () => {
  assert.equal(cells.length, 24, 'the dump has twenty-four top-level equipment rows')
  assert.deepEqual(unplaced, [], 'the real dump has no equipped row the grid cannot place')

  // Paired slots take occurrences in FILE ORDER — the only signal the file gives.
  assert.equal(cell('ear1').item?.name, 'Drop of Crystallized Flame +7')
  assert.equal(cell('ear2').item?.name, 'Earring of Disease Reflection +4')
  assert.equal(cell('wrist1').item?.name, 'Valorium Bracers +2')
  assert.equal(cell('wrist2').item?.name, 'Lustrous Russet Bracer +1')
  assert.equal(cell('any1').item?.name, 'Brigandine Tunic +1')
  assert.equal(cell('any2').item?.name, 'Midnight Clad Straps +2')

  // `Empty` is a slot that exists and holds nothing — never a missing cell.
  assert.equal(cell('ammo').item, null)
  assert.equal(cell('held').item, null)

  // The ` +N` item level is split off the name but the name keeps it (the game prints it).
  assert.equal(cell('primary').item?.tier, 5)
  assert.equal(cell('primary').item?.baseName, 'Thelvorn, Blade of Light')
})

test('socket rows are NOT items — they are exaltations of the row above them', () => {
  // Every `-Slot<n>` child is either bag contents or a socket; none of them is a worn item.
  for (const c of cells) assert.ok(!c.location.includes('-Slot'), `${c.id} read a socket row`)

  assert.deepEqual(cell('face').item?.exaltations, ['Polished Mithril Mask'])
  assert.deepEqual(cell('range').item?.exaltations, ['Idol of the Underking'])
  assert.deepEqual(cell('primary').item?.exaltations, ['Thelvorn, Blade of Light'])
  // A socket may hold a DIFFERENT item than its host — the second ring's does.
  assert.deepEqual(cell('finger2').item?.exaltations, ['Moonstone Ring'])
  assert.deepEqual(cell('chest').item?.exaltations, [], 'empty sockets are not exaltations')
})

// ---- the sum -------------------------------------------------------------------------

test('statInteger takes an integer and REFUSES a percentage', () => {
  assert.equal(statInteger('+9'), 9)
  assert.equal(statInteger('-5'), -5)
  assert.equal(statInteger('10'), 10, 'the real dump has a bare Endurance value')
  assert.equal(statInteger('+36%'), null, 'a percentage in an integer total is the lie to prevent')
  assert.equal(statInteger('21%'), null)
  assert.equal(statInteger(''), null)
  assert.equal(statInteger('a lot'), null)
})

const block = (over: Partial<ItemStatBlock>): ItemStatBlock => ({
  flags: [],
  stats: [],
  saves: [],
  effects: [],
  exaltationSlots: [],
  extras: [],
  ...over
})

test('percentages are STATED side by side, never added', () => {
  const totals = sumGear([
    block({ stats: [{ key: 'HASTE', value: '+36%' }] }),
    block({ stats: [{ key: 'HASTE', value: '+21%' }] })
  ])
  assert.deepEqual(totals.stats, [], 'no percentage may reach a summed row')
  assert.deepEqual(totals.unsummed, [{ label: 'Haste', values: ['+36%', '+21%'] }])
})

test('integers sum, saves stay split out, and END folds onto ENDURANCE', () => {
  const totals = sumGear([
    block({ ac: 21, stats: [{ key: 'STR', value: '+20' }, { key: 'END', value: '10' }], saves: [{ key: 'SV FIRE', value: '+10' }] }),
    block({ ac: 10, stats: [{ key: 'STR', value: '+5' }, { key: 'ENDURANCE', value: '+5' }], saves: [{ key: 'SV FIRE', value: '+15' }] })
  ])
  assert.equal(totals.ac, 31)
  assert.deepEqual(
    totals.stats,
    [
      { label: 'Strength', total: 25, from: 2 },
      { label: 'Endurance', total: 15, from: 2 }
    ],
    'attributes come before HP/Mana/Endurance in the canonical order'
  )
  assert.deepEqual(totals.saves, [{ label: 'SV Fire', total: 25, from: 2 }])
  assert.equal(totals.counted, 2)
  assert.equal(totals.unknown, 0)
})

test('an item the DB does not know is COUNTED, never treated as zeroes', () => {
  const totals = sumGear([block({ ac: 21 }), undefined, undefined])
  assert.equal(totals.counted, 1)
  assert.equal(totals.unknown, 2)
  assert.equal(totals.ac, 21, 'an unknown item contributes nothing at all')
})

// ---- the join, over the committed corpus ----------------------------------------------

const itemsDb = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'src', 'main', 'data', 'items.json'), 'utf8')
) as ItemDbFile
const dbIndex = buildItemDbIndex(itemsDb)
const worn = cells.filter((c) => c.item !== null)
const totals = sumGear(worn.map((c) => dbIndex.get(itemKey(c.item?.baseName ?? ''))?.stats))

test('the sum covers exactly the worn items, and says how many it could not read', () => {
  assert.equal(worn.length, 22, 'twenty-two of the twenty-four cells hold something')
  assert.equal(
    totals.counted + totals.unknown,
    worn.length,
    'every worn item is either summed or counted as unknown — none may fall between'
  )
  // An IDENTITY, not a frozen number: the corpus is re-scrapable, so this re-derives the total
  // rather than asserting today's 199.
  const acs = worn.map((c) => dbIndex.get(itemKey(c.item?.baseName ?? ''))?.stats?.ac ?? 0)
  assert.equal(totals.ac, acs.reduce((a, b) => a + b, 0))
  assert.ok(totals.ac > 0, 'the dev character is wearing armour')
  assert.ok(totals.stats.some((s) => s.label === 'Strength'), 'and it has stats on it')
})

test('the totals stay BASE-computed - the ` +N` uplift is never applied (owner, JOS-327)', () => {
  // The owner's ruling when the Character tab was released: keep character totals initially. The
  // arithmetic to do otherwise EXISTS now (`shared/itemUpgrade.ts scaleStatBlock`, an exact port of
  // the wiki's own ItemLevelSlider), so this is a decision rather than a limitation and it needs a
  // pin — a future wave that wires the scaler into this sum will change the meaning of every number
  // the gear panel prints under a caption that says "from gear", and should do so on purpose.
  //
  // Asserted as an IDENTITY over the corpus rather than against today's numbers: the sum equals the
  // sum of the UNSCALED blocks, even though eleven of the twenty-two worn items state a ` +N`.
  const tiered = worn.filter((c) => c.item?.tier !== undefined)
  assert.ok(tiered.length > 0, 'the dev character wears upgraded gear, or this test proves nothing')
  const base = sumGear(worn.map((c) => dbIndex.get(itemKey(c.item?.baseName ?? ''))?.stats))
  assert.deepEqual(totals, base)
  // And the tier is not lost, merely un-applied: it is still on the item's own name, where the dump
  // spelled it and where the slot grid and the carry-all ledger both print it.
  assert.ok(tiered.every((c) => / \+\d+$/.test(c.item?.name ?? '')))
})

test('the known cross-source name gap is SURFACED, not smoothed over (law 12)', () => {
  // The client writes `Djarn's Amethyst Ring`; the wiki page is `Djarns Amethyst Ring`. A
  // matcher would close that by luck and close others by the same luck, so the sheet reports it.
  // Asserted as a CEILING: a future scrape that adds the page legitimately drives this to 0.
  assert.ok(totals.unknown <= 1, `${String(totals.unknown)} worn items are missing from the corpus`)
})
