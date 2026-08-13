// THE RICH SPELL CARD STATES ONLY WHAT A SOURCE STATES (JOS-293) — the fact selection behind
// src/renderer/src/lib/SpellCard.tsx, and the rank lineage behind its "replaces" line.
//
// TWO CLAIMS, and both are about ABSENCE as much as presence:
//
//   1. `spellStatRows` draws a row if and only if the committed DB stated the field behind it. A
//      wiki page that omits mana yields no mana row - not a `0`, not a `-`. The counter-case is
//      just as load-bearing: `mana: 0` is a STATED zero (every bard song states it) and must draw
//      one, which is why the selection tests `!== undefined` and not truthiness.
//   2. `buildSpellDetail`'s lineage names a rank only when a source NAMES it. The committed DB
//      carries rank siblings for 72 of its ~1,800 lines; the log names every rank you have cast.
//      There is deliberately no "rank 3 of 5" anywhere in this file, because no source in this
//      repo states how many ranks a line has and a denominator would be invented.
//
// It runs against the REAL committed DB (`loadSpellDb`), not a fixture literal, so a re-scrape
// that drops a field this card leans on fails here rather than in front of a user. The three
// spells it pins by name are chosen for what they are missing as much as for what they state.
//
// Run: `npm test`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadSpellDb } from '../src/main/data/spellDb'
import { buildSpellDetail } from '../src/main/data/spellDetail'
import {
  spellClassLine,
  spellEffectClassLabels,
  spellFactsAreForLine,
  spellLineageLine,
  spellLineageMembers,
  spellStatRows,
  type SpellDetail
} from '../src/shared/spellDetail'

const db = loadSpellDb()

/** A record with nothing stated at all - the shape every "absent" assertion is written against. */
function bare(over: Partial<SpellDetail> = {}): SpellDetail {
  return {
    queried: 'Nothing',
    found: true,
    nature: 'unknown',
    illusion: false,
    classLevels: [],
    effectClasses: [],
    lineage: null,
    ...over
  }
}

const idsOf = (d: SpellDetail): string[] => spellStatRows(d).map((r) => r.id)

// ─────────────────────────── 1. states only what is stated ───────────────────────────────────

test('D1 a record that states nothing draws no stat rows at all', () => {
  assert.deepEqual(spellStatRows(bare()), [])
  assert.equal(spellClassLine(bare()), null)
  assert.deepEqual(spellEffectClassLabels(bare()), [])
  assert.equal(spellLineageLine(bare()), null)
  assert.deepEqual(spellLineageMembers(bare()), [])
})

test('D2 each stat row appears exactly when its own field is stated', () => {
  assert.deepEqual(idsOf(bare({ spellType: 'Beneficial' })), ['type'])
  assert.deepEqual(idsOf(bare({ targetType: 'Single Hostile' })), ['target'])
  assert.deepEqual(idsOf(bare({ castTimeMs: 4000 })), ['cast'])
  assert.deepEqual(idsOf(bare({ mana: 75 })), ['mana'])
  assert.deepEqual(idsOf(bare({ durationText: '24 Sec' })), ['duration'])
  assert.deepEqual(idsOf(bare({ instrumentEnhanced: 'Required' })), ['instrument'])
})

test('D3 a STATED ZERO is a fact and draws its row (mana 0, cast 0 - every bard song)', () => {
  const song = bare({ mana: 0, castTimeMs: 0 })
  assert.deepEqual(idsOf(song), ['cast', 'mana'])
  const rows = spellStatRows(song)
  assert.equal(rows.find((r) => r.id === 'mana')?.value, '0')
  assert.equal(rows.find((r) => r.id === 'cast')?.value, '0.0s')
})

test('D4 the values are the source’s own words, never a re-spelling of them', () => {
  const rows = spellStatRows(
    bare({ durationText: 'Permanent', targetType: 'Single Friendly (or Self)', spellType: 'Resist Buff' })
  )
  assert.equal(rows.find((r) => r.id === 'duration')?.value, 'Permanent')
  assert.equal(rows.find((r) => r.id === 'target')?.value, 'Single Friendly (or Self)')
  assert.equal(rows.find((r) => r.id === 'type')?.value, 'Resist Buff')
})

test('D5 the row order is the spell window’s, whichever subset is present', () => {
  const full = bare({
    spellType: 'Beneficial',
    targetType: 'Group',
    castTimeMs: 3000,
    mana: 0,
    durationText: '3 ticks',
    instrumentEnhanced: 'Yes'
  })
  assert.deepEqual(idsOf(full), ['type', 'target', 'cast', 'mana', 'duration', 'instrument'])
})

// ─────────────────────────── 2. the real DB, read end to end ─────────────────────────────────

test('D6 Celestial Remedy reads out of the committed DB with every field it states', () => {
  const d = buildSpellDetail(db, 'Celestial Remedy')
  assert.equal(d.found, true)
  assert.equal(d.name, 'Celestial Remedy')
  assert.equal(d.nature, 'beneficial')
  // Verbatim from src/main/data/spells.json.
  assert.equal(d.durationText, '24 Sec')
  assert.equal(d.castTimeMs, 4000)
  assert.equal(d.mana, 75)
  assert.equal(d.targetType, 'Single Friendly (or Self)')
  assert.deepEqual(d.effects, ['Increase Hitpoints by 35 per tick'])
  assert.deepEqual(d.classLevels, [{ cls: 'CLR', level: 19 }])
  assert.equal(spellClassLine(d), 'CLR 19')
  assert.deepEqual(idsOf(d), ['type', 'target', 'cast', 'mana', 'duration'])
  // The page carries no bard instrument row, so no instrument row is drawn.
  assert.equal(d.instrumentEnhanced, undefined)
})

test('D7 a name no page carries answers found:false and states nothing else', () => {
  const d = buildSpellDetail(db, 'Vorpal Sword of Nothing')
  assert.equal(d.found, false)
  assert.equal(d.name, undefined)
  assert.deepEqual(spellStatRows(d), [])
  assert.equal(d.lineage, null)
  assert.equal(spellFactsAreForLine(d), false)
})

test('D8 the derived effect classes come off the effect list, not off the name', () => {
  // `Charm` reads its own effect line; the JOS-251 law is that a name stem would have matched
  // items and near-misses instead.
  const charm = buildSpellDetail(db, 'Charm')
  assert.ok(charm.effectClasses.includes('charm'), `Charm effect classes: ${charm.effectClasses.join(',')}`)
  assert.ok(spellEffectClassLabels(charm).includes('charm'))
  // A pure heal derives no roster at all - and an empty list draws no line.
  const remedy = buildSpellDetail(db, 'Celestial Remedy')
  assert.deepEqual(remedy.effectClasses, [])
})

// ─────────────────────────── 3. the rank lineage, and its boundary ───────────────────────────

test('D9 a rank the DB itself carries names what it replaces, from the DB alone', () => {
  const d = buildSpellDetail(db, 'Rune III')
  assert.equal(d.found, true)
  assert.equal(d.lineage?.rank, 3)
  assert.equal(d.lineage?.suffixed, true)
  assert.equal(d.lineage?.replaces, 'Rune II')
  assert.equal(spellLineageLine(d), 'Rank III · replaces Rune II')
  // Every member is the DB's, so none of them wears the "your log" tag.
  const members = spellLineageMembers(d)
  assert.ok(members.includes('Rune II'), members.join(' | '))
  assert.ok(!members.some((m) => m.includes('your log')), members.join(' | '))
  // And the DB has a row per rank here, so the numbers on the card are rank III's own.
  assert.equal(d.name, 'Rune III')
  assert.equal(spellFactsAreForLine(d), false)
})

test('D10 a rank ONLY your log names is named, and is labelled as your log’s', () => {
  // The DB holds ONE `Celestial Remedy` row and no rank siblings - the case the owner named.
  // Without the log there is nothing to say beyond the numeral in the name.
  const alone = buildSpellDetail(db, 'Celestial Remedy III')
  assert.equal(spellLineageLine(alone), 'Rank III')
  assert.equal(alone.lineage?.replaces, undefined)
  // With the ranks the log has actually seen cast, the lower rank can be named - and the card
  // says which source named it, because it is not the one every other fact came from.
  const observed = ['Celestial Remedy II', 'Celestial Remedy III']
  const d = buildSpellDetail(db, 'Celestial Remedy III', observed)
  assert.equal(d.lineage?.replaces, 'Celestial Remedy II')
  assert.equal(spellLineageLine(d), 'Rank III · replaces Celestial Remedy II')
  const members = spellLineageMembers(d)
  assert.ok(members.includes('Celestial Remedy II (your log)'), members.join(' | '))
  // The base row is the DB's and stays untagged; the ranks are the log's and are tagged.
  assert.ok(members.includes('Celestial Remedy'), members.join(' | '))
})

test('D11 the facts for a rank the DB has no row for are the LINE’s, and the card says so', () => {
  const d = buildSpellDetail(db, 'Celestial Remedy III')
  assert.equal(d.name, 'Celestial Remedy')
  assert.equal(spellFactsAreForLine(d), true)
  // The line's numbers are still the line's numbers - nothing is scaled or guessed per rank.
  assert.equal(d.mana, 75)
})

test('D12 "replaces" is the highest rank BELOW this one that a source names, never "rank minus one"', () => {
  // A source that names I and III and nothing between: asked about III, the honest answer is I.
  const d = buildSpellDetail(db, 'Cannibalize IV')
  assert.equal(d.lineage?.rank, 4)
  const below = d.lineage?.members.filter((m) => m.rank < 4).map((m) => m.name) ?? []
  assert.ok(below.length > 0, 'the DB carries Cannibalize rank siblings')
  assert.equal(d.lineage?.replaces, below[below.length - 1])
  // Measured on the committed DB: the line is Cannibalize, Cannibalize III, Cannibalize IV -
  // there is no rank II row, and the card must not invent one.
  assert.ok(!below.includes('Cannibalize II'), below.join(' | '))
})

test('D13 a single-rank line with an unsuffixed name has NO lineage block', () => {
  const d = buildSpellDetail(db, 'Celestial Remedy')
  assert.equal(d.lineage, null)
  assert.equal(spellLineageLine(d), null)
  assert.deepEqual(spellLineageMembers(d), [])
})

test('D14 an unsuffixed name whose line HAS siblings lists them, without claiming a rank', () => {
  const d = buildSpellDetail(db, 'Rune')
  assert.equal(d.lineage?.suffixed, false)
  // No "Rank I" sentence: the name states no numeral, so the card states none.
  assert.equal(spellLineageLine(d), null)
  assert.ok((spellLineageMembers(d).length ?? 0) > 1, spellLineageMembers(d).join(' | '))
})

test('D15 an observed rank of a DIFFERENT line never joins this one', () => {
  const d = buildSpellDetail(db, 'Rune III', ['Clarity III', 'Mesmerization III'])
  const members = d.lineage?.members.map((m) => m.name) ?? []
  assert.ok(members.every((m) => m.toLowerCase().startsWith('rune')), members.join(' | '))
})

test('D16 a name the DB and the log BOTH carry is not listed twice', () => {
  const d = buildSpellDetail(db, 'Rune III', ['Rune III', 'Rune II'])
  const names = d.lineage?.members.map((m) => m.name) ?? []
  assert.equal(new Set(names.map((n) => n.toLowerCase())).size, names.length, names.join(' | '))
  assert.equal(d.lineage?.members.find((m) => m.name === 'Rune III')?.source, 'both')
  // A rank both sources name is NOT tagged - the tag means "only your log states this".
  assert.ok(spellLineageMembers(d).includes('Rune III'))
})

test('D17 an empty / whitespace name is answered, never thrown on', () => {
  assert.equal(buildSpellDetail(db, '').found, false)
  assert.equal(buildSpellDetail(db, '   ').found, false)
})
