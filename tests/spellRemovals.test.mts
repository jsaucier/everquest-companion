// JOS-337 — THE WIKI CARRIES A SPELL THE GAME DOES NOT HAVE, AND THE OVERLAY LEARNS TO SAY SO.
//
// `src/main/data/spells.json` is a SCRAPE and `scripts/scrape-spells.ts` rewrites it wholesale, so
// a hand-DELETE out of it is undone by the next re-scrape exactly the way a hand-EDIT is. JOS-150
// built the edit half (`spellCorrections.ts`); this is the delete half, and
// `src/main/data/spellRemovalsList.ts` carries its evidence bar — which is NOT the corrections bar
// and cannot be, because the corrections bar is a line count and absence cannot be counted.
// READ THAT HEADER FIRST. This suite is the guard that keeps the layer from becoming a way to
// delete rows nobody checked.
//
// WHAT IS PINNED HERE:
//
//   1. THE ACCEPTANCE, BY NAME. The corrections layer gets an anti-rot guard for free — every
//      entry restates the text it replaces, so a wiki that moves reports `stale`. A removal has
//      nothing to restate: a misspelled name and a naturally-dropped page are indistinguishable at
//      run time, and the layer deliberately calls BOTH of them `satisfied` (see THE TOMBSTONE).
//      That decision has a price and this is where it is paid: every entry is asserted BY NAME
//      against the committed DB, so a typo is caught in the commit that writes it rather than
//      never.
//   2. THE SHAPE OF THE BAR. A dated verification, an explicitly-stated (or explicitly-null)
//      mechanical reason, and evidence — checked as DATA, because a bar that lives only in prose
//      is a bar the next entry can quietly skip.
//   3. THE CONTRADICTION. A spell cannot be both removed and corrected. The load order makes that
//      fail on its own (a correction naming a removed row reports `unknownSpells`); this refuses
//      the pair STATICALLY too, so the report names the real defect.
//   4. IDEMPOTENCE, NON-MUTATION, AND THE RE-SCRAPE — both directions, the way
//      tests/spellCorrections.test.mts asks them of every correction.
//   5. THE RIPPLE. The layer exists because a phantom spell is OFFERED to the player, so the
//      tests that matter are the two surfaces that were offering Invigor: the New-at-this-level
//      panel (`buildLevelUnlocks`) and the suggested-alerts catalog (`buildSpellCatalog`).
//
// NO REPORTER BYTES AND NO THIRD-PARTY SPEECH ENTER THIS FILE. The measurements quoted in the list
// file's header were taken over the owner's own log and are stated there as counts; nothing here
// needs a log line at all, because the whole subject is a row that should not exist.
//
// Run: `npm test`.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { applySpellRemovals, SPELL_REMOVALS } from '../src/main/data/spellRemovals.ts'
import { SPELL_CORRECTIONS } from '../src/main/data/spellCorrections.ts'
import {
  buildSpellCatalog,
  loadSpellDb,
  spellCorrectionsReport,
  spellRemovalsReport
} from '../src/main/data/spellDb.ts'
import { buildLevelUnlocks } from '../src/main/data/levelUnlocks.ts'
import { classesForSpell } from '../src/main/data/spellClasses.ts'
import type { SpellDbFile, SpellEntry } from '../src/shared/types.ts'
import spellsJson from '../src/main/data/spells.json' with { type: 'json' }

const RAW = (spellsJson as SpellDbFile).spells

// ---------------------------------------------------------------------------------------------
// 1 — THE ACCEPTANCE, BY NAME: the only typo guard this class admits
// ---------------------------------------------------------------------------------------------

test('THE REPORTED DEFECT: Invigor is in the scrape and is NOT in the effective DB', () => {
  // The row the owner's New-at-this-level panel was reading: one row, `Decrease Stamina Loss by
  // 35`, placed at CLR 9 / PAL 22 / DRU 14 / SHM 24 / ENC 24 / RNG 30.
  const before = RAW.filter((s) => s.name === 'Invigor')
  assert.equal(before.length, 1, 'the committed scrape still carries the row this entry removes')
  assert.ok(before[0].classes?.includes('Paladin - Level 22'), 'and still places it at the levels the report names')

  const { spells, report } = applySpellRemovals(RAW)
  assert.equal(spells.filter((s) => s.name === 'Invigor').length, 0, 'the layer drops it')
  assert.equal(report.removed, 1, 'one row, counted')
  assert.deepEqual(report.satisfied, [], 'and nothing was already gone')
})

test('every removal removes something in the committed DB, or is a stated tombstone', () => {
  // THE PRICE OF THE TOMBSTONE DECISION, paid here. `satisfied` cannot distinguish "the wiki
  // dropped the page" from "somebody misspelled the name", so the report will never fail on a
  // typo. This test is what does: an entry authored against today's spells.json either removes a
  // row or it is a typo, and the day the wiki really drops a page this assertion is the ONE place
  // that has to be updated — deliberately, by a person, who then writes the page's disappearance
  // into the entry's evidence.
  const { report } = applySpellRemovals(RAW)
  assert.deepEqual(
    report.satisfied,
    [],
    'a removal matching no row is a typo until somebody records that the wiki dropped the page'
  )
  assert.equal(report.removed, SPELL_REMOVALS.length, 'one row per entry, on the committed scrape')
})

test('a removal that names a spell nobody looked for cannot hide in the list', () => {
  // The bar's own counter-example, kept executable: `Extinguish Fatigue` is the sibling that shares
  // BOTH of Invigor's messages and is likewise a pure stamina-loss spell — exactly the row a
  // family inference would have swept up. It is still here, because nobody has verified it.
  const { spells } = applySpellRemovals(RAW)
  assert.ok(
    spells.some((s) => s.name === 'Extinguish Fatigue'),
    'absence of evidence is not evidence of absence: an unverified sibling stays in the DB'
  )
})

// ---------------------------------------------------------------------------------------------
// 2 — THE SHAPE OF THE BAR, checked as data
// ---------------------------------------------------------------------------------------------

test('every removal states a dated owner verification, a reason field and evidence', () => {
  const seen = new Set<string>()
  for (const r of SPELL_REMOVALS) {
    assert.ok(r.spell.length > 0, 'a removal with no spell removes nothing')
    assert.ok(!seen.has(r.spell), `two removals name ${r.spell}`)
    seen.add(r.spell)
    // The date is the whole evidence base for this class, so its shape is checked rather than
    // trusted: a claim about a live service goes stale, and a reader needs to know how old the
    // look was without parsing prose.
    assert.match(r.verified, /^\d{4}-\d{2}-\d{2}$/, `${r.spell}: \`verified\` is an ISO date, not prose`)
    assert.ok(!Number.isNaN(Date.parse(r.verified)), `${r.spell}: \`verified\` must be a real date`)
    // `null` is a REAL answer and the point of the field: a mechanical reason is a much wider claim
    // than a verification and is held to its own bar. What is refused is the empty gesture — a
    // blank string, or whitespace, which reads as "stated" and says nothing.
    assert.ok(r.reason === null || r.reason.trim().length > 20, `${r.spell}: state a real reason or state null`)
    assert.ok(r.evidence.length > 20, `${r.spell}: say what was done and what was found`)
  }
})

test('no spell is both removed and corrected', () => {
  // The load order already makes this fail — removals run first, so a correction naming a removed
  // row reports `unknownSpells` and tests/spellCorrections.test.mts goes red. That backstop reports
  // a rotted CORRECTION, which is the wrong diagnosis: the real defect is two entries disagreeing
  // about whether a spell exists, and it belongs in the lists rather than in a load report.
  const removed = new Set(SPELL_REMOVALS.map((r) => r.spell))
  for (const c of SPELL_CORRECTIONS) {
    for (const s of c.spells) {
      assert.ok(!removed.has(s), `${s} is removed AND corrected — one of the two entries is wrong`)
    }
    // A `name` correction produces a name too, and removing the row it produces would be the same
    // contradiction wearing the destination's spelling.
    if (c.field === 'name') {
      assert.ok(!removed.has(c.to), `${c.to} is removed AND is the target of a rename`)
    }
  }
})

// ---------------------------------------------------------------------------------------------
// 3 — IDEMPOTENCE, NON-MUTATION, AND THE RE-SCRAPE (THE TOMBSTONE)
// ---------------------------------------------------------------------------------------------

test('applying the layer twice is applying it once, and the second pass is all tombstone', () => {
  const first = applySpellRemovals(RAW)
  const second = applySpellRemovals(first.spells)
  assert.deepEqual(second.spells, first.spells, 'the second pass must be a no-op on the entries')
  assert.equal(second.report.removed, 0, 'nothing left to remove')
  assert.deepEqual(
    second.report.satisfied,
    SPELL_REMOVALS.map((r) => r.spell),
    'every entry reports satisfied, which is the SAME answer a natural upstream drop produces'
  )
})

test('THE TOMBSTONE: a re-scrape that drops the page reports satisfied, not a failure', () => {
  // The decision this layer had to make, stated as a test. The corrections layer's `from: null`
  // faces the same shortage (an absent field has no text to compare) and resolves it by making
  // absence the match condition; a removal is that argument with the ROW in place of the field.
  // The entry has got exactly what it asked for, so the suite must not go red — and the entry
  // STAYS, because the wiki is editable and a page that vanished in June can be restored in July.
  const dropped = RAW.filter((s) => s.name !== 'Invigor')
  const { spells, report } = applySpellRemovals(dropped)
  assert.equal(report.removed, 0, 'there was nothing left to remove')
  assert.deepEqual(report.satisfied, ['Invigor'], 'and the entry stands as a tombstone, named')
  assert.equal(spells.length, dropped.length, 'the list is untouched')
})

test('a removal takes EVERY row of its name, the way a NAME correction does', () => {
  // The scrape carries era/rank duplicates, and `rowsFor` in spellCorrections.ts explains why a
  // MESSAGE correction deliberately writes only the first of them: their messages may genuinely
  // differ. Existence cannot differ. Half a removal leaves a phantom that `byKey`,
  // `buildSpellCatalog` and `buildLevelUnlocks` would all still find, which is the whole defect.
  const twinned: SpellEntry[] = RAW.flatMap((s) => (s.name === 'Invigor' ? [s, { ...s, durationMs: 36_000 }] : [s]))
  assert.equal(twinned.filter((s) => s.name === 'Invigor').length, 2)
  const { spells, report } = applySpellRemovals(twinned)
  assert.equal(spells.filter((s) => s.name === 'Invigor').length, 0, 'both rows, or the row is still there')
  assert.equal(report.removed, 2, 'counted per ROW, not per entry')
})

test('the layer never writes through the imported JSON module', () => {
  // spells.json is one shared object for the whole process and several suites read it raw
  // (tests/buffUnifiedModel.test.mts reads it for the spellType oracle). The pass copies.
  const before = RAW.length
  applySpellRemovals(RAW)
  assert.equal(RAW.length, before, 'mutating it would leak into every importer')
  assert.ok(RAW.some((s) => s.name === 'Invigor'), 'and the committed scrape still carries what the wiki carries')
})

test('a removal names the SCRAPE`s spelling, so the corrections overlay never sees the row', () => {
  // The order is semantics, not legibility. Removals run first, so a corrected name does not exist
  // yet when the removals list is read — an entry naming a post-correction spelling would silently
  // match nothing and report itself satisfied.
  const corrected = new Set(SPELL_CORRECTIONS.filter((c) => c.field === 'name').map((c) => c.to))
  for (const r of SPELL_REMOVALS) {
    assert.ok(!corrected.has(r.spell), `${r.spell} is a name the corrections layer PRODUCES; name the scrape`)
  }
})

// ---------------------------------------------------------------------------------------------
// 4 — THE LOAD SEAM: the layer reaches every derived structure, and runs before the corrections
// ---------------------------------------------------------------------------------------------

test('loadSpellDb builds its tables from the list the removals left behind', () => {
  const db = loadSpellDb()
  const removals = spellRemovalsReport()
  assert.ok(removals, 'the load path reports what it removed')
  assert.equal(removals.removed, SPELL_REMOVALS.length)
  assert.deepEqual(removals.satisfied, [])

  assert.equal(db.byKey.get('invigor'), undefined, 'the join key a cast line would fold to is gone')
  assert.equal(db.spells.length, RAW.length - removals.removed, 'and the row count says so')
  for (const table of [db.castOnYou, db.wearsOff, db.castOnOtherSuffix]) {
    for (const cands of table.values()) {
      assert.ok(!cands.some((c) => c.name === 'Invigor'), 'no derived table may still hold the row')
    }
  }
})

test('the corrections overlay still describes everything, applied AFTER the removals', () => {
  // The real backstop for the contradiction the static test above refuses: if a correction named a
  // removed spell, this report would carry it in `unknownSpells`. The corrections suite runs its
  // own audit over the RAW list, so this is the only place the POST-REMOVAL list is audited.
  const c = spellCorrectionsReport()
  assert.ok(c, 'the load path reports the corrections too')
  assert.deepEqual(c.unknownSpells, [], 'a correction naming a removed spell would land here')
  assert.deepEqual(c.stale, [], 'and removing a row must not move a sentence out from under a correction')
  assert.ok(c.applied > 0, 'the corrections still do their job on the shorter list')
})

test('WHAT THE REMOVAL DOES NOT TAKE WITH IT: both shared sentences keep an owner', () => {
  // Bar rule 4, executable. Invigor's two messages are shared VERBATIM with `Extinguish Fatigue`,
  // so dropping the row changes no message table at all — a line printing either sentence still
  // resolves, and the only thing that changed is who the app OFFERS.
  const db = loadSpellDb()
  const you = db.castOnYou.get('Your body zings with energy.')
  assert.ok(you, 'the self landing is still a message the parser knows')
  assert.deepEqual(you.map((s) => s.name), ['Extinguish Fatigue'], 'under its surviving owner')
  const other = db.castOnOtherSuffix.get('looks energized.')
  assert.ok(other, 'and so is the third-person landing')
  assert.deepEqual(other.map((s) => s.name), ['Extinguish Fatigue'])
})

// ---------------------------------------------------------------------------------------------
// 5 — THE RIPPLE: the two surfaces that were OFFERING the spell
// ---------------------------------------------------------------------------------------------

test('THE UNLOCK PANEL no longer offers Invigor at 22, 24 or 30', () => {
  // The reported surface. `buildLevelUnlocks` joins the DB's `classes` bullet list to level, and
  // the New-at-this-level panel turns each row into a card telling the player what they can go
  // buy — so the owner's PAL/RNG/SHM loadout was being sent to a vendor for a spell that is not
  // there, three times over.
  const data = buildLevelUnlocks()
  assert.equal(data.spells.filter((s) => s.name === 'Invigor').length, 0, 'no card names it')
  const staminaSiblings = data.spells.filter((s) => s.name === 'Extinguish Fatigue')
  assert.equal(staminaSiblings.length, 1, 'and the unverified sibling is untouched — this is not a family purge')
  // The three levels the report names, read the way the panel reads them.
  for (const [cls, level] of [['PAL', 22], ['SHM', 24], ['RNG', 30]] as const) {
    const atLevel = data.spells.filter((s) => s.at.some((a) => a.cls === cls && a.level === level))
    assert.ok(!atLevel.some((s) => s.name === 'Invigor'), `${cls} ${level} must not list it`)
  }
})

test('THE ALERT WIZARD no longer offers Invigor a suggestion', () => {
  // The second surface `buildSpellCatalog` feeds. Invigor is Beneficial with a `msgWearsOff`-less
  // entry, so it earned the `fade` template and was searchable and offerable — an alert for a
  // spell that can never be cast, which is the same law JOS-84 states from the other direction.
  const catalog = buildSpellCatalog(loadSpellDb(), new Map())
  assert.equal(catalog.entries.filter((e) => e.key === 'invigor').length, 0, 'not in the catalog')
  assert.ok(!catalog.entries.some((e) => e.name === 'Invigor'), 'under any key')
  // THE SEARCH BOX, precisely. `searchText` is a substring surface, so "invigor" still matches two
  // OTHER spells and asserting it matches nothing would be asserting a falsehood: `Invigorate` is
  // the NPC-only heal, and `Jaxan's Jig o' Vigor` is the bard song whose wear-off reads `You are no
  // longer invigorated.` — the very song the list file's header measures 1,028 landings of. Both
  // are real rows and both must stay; what must be gone is the entry the search used to name.
  assert.deepEqual(
    catalog.entries.filter((e) => e.searchText.includes('invigor')).map((e) => e.key).sort(),
    ["invigorate", "jaxan's jig o' vigor"],
    'typing "invigor" finds the two spells that exist, and not the one that does not'
  )
  assert.ok(
    catalog.entries.some((e) => e.key === 'extinguish fatigue'),
    'while the unverified sibling stays offerable'
  )
})

test('THE CLASS INDEX places nobody by a spell the game does not have', () => {
  // `spellClasses.ts` is keyed by spell name and read with the name a `castBegin` line carries. No
  // cast line can ever name a spell that is not in the game, so its six classes are evidence about
  // a game that is not running — and `classesForSpell` returning `[]` is the honest answer the
  // module already gives for every NPC-only row.
  assert.deepEqual(classesForSpell('Invigor'), [], 'six classes, none of whom can cast it')
  assert.deepEqual(
    classesForSpell('Extinguish Fatigue'),
    ['CLR', 'DRU', 'ENC', 'RNG', 'SHM'],
    'and the sibling still places exactly who the wiki says'
  )
})

// ---------------------------------------------------------------------------------------------
// 6 — THE SEAM AUDIT: nothing indexes the scrape in front of the overlay
// ---------------------------------------------------------------------------------------------

/**
 * Every `src/` module that ES-imports the scrape MUST route it through the removals seam, or be
 * named here with the reason it does not.
 *
 * WHY A GREP AND NOT A TYPE. AGENTS.md states the standing hazard in one line — "a raw-spells.json
 * importer that looks up BY NAME is a silent miss waiting to happen" — and JOS-161 paid for it
 * once already (`spellClasses.ts` and `levelUnlocks.ts` had to be retrofitted after the rename).
 * The import is the only thing a compiler can see; a new consumer that forgets the overlay type-
 * checks perfectly and is wrong.
 *
 * THE THREE EXEMPTIONS ARE REASONED, NOT GRANDFATHERED, and the third one is a rule about what
 * this layer MEANS rather than a concession.
 *
 * The first two build a name -> boolean ROSTER and both deliberately UNION the raw and corrected
 * spellings of every name, because the parser only ever sees the log's spelling and a membership
 * test must answer to both (charmModel.ts learned that one the hard way and says so in place). Two
 * consequences: passing them a shortened list would change nothing, since the raw list is unioned
 * in regardless — and charmModel.ts additionally walks `raw[i]`/`corrected[i]` in INDEX LOCKSTEP,
 * which a pass that deletes rows would silently break. Neither roster is a catalog anybody is
 * shown; the worst a stale member can do is keep the parser willing to recognize a spell nobody
 * can cast, which is inert.
 *
 * THE THIRD IS `effectIndex.ts`, AND IT MUST STAY ON THE RAW LIST. It joins an ITEM's `Effect:`
 * line to the spell page of the same name, to borrow the one-liner a gear row prints (type,
 * target, duration). A removal says "no player can learn this spell"; it does NOT say "no item
 * carries this effect", and for Invigor the committed items corpus settles it: SEVEN items carry
 * an `Invigor` effect, among them Frozen Efreeti Boots, Tolan's Darkwood Boots and Mrylokar's
 * Greaves. Feeding this join the shortened list would blank the one-liner on seven real,
 * obtainable items in order to hide a spell scroll — a regression bought with a fix. The boundary
 * is worth stating once, here: this layer removes what the app OFFERS the player, never what the
 * app can DESCRIBE.
 */
const RAW_IMPORT_EXEMPT: ReadonlyMap<string, string> = new Map([
  ['src/main/combat/charmModel.ts', 'name->boolean roster; unions raw+corrected and walks them in index lockstep'],
  ['src/main/combat/petNudge.ts', 'name->boolean roster; unions raw+corrected, so a shorter list changes nothing'],
  [
    'src/main/planner/effectIndex.ts',
    'item Effect: -> spell-page join; 7 committed items carry an Invigor effect and a removed row would blank their one-liners'
  ]
])

function tsFilesUnder(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) tsFilesUnder(path, out)
    else if (name.endsWith('.ts') || name.endsWith('.tsx')) out.push(path)
  }
  return out
}

test('every src importer of spells.json goes through the removals seam, or is exempt with a reason', () => {
  const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
  const offenders: string[] = []
  for (const file of tsFilesUnder(join(root, 'src'))) {
    const rel = file.replace(/\\/g, '/').slice(root.replace(/\\/g, '/').length).replace(/^\/+/, '')
    if (rel.endsWith('src/main/data/spellDb.ts')) continue
    const src = readFileSync(file, 'utf8')
    // The IMPORT, not a mention: every one of these files talks about spells.json in prose.
    if (!/^import\s+\w+\s+from\s+'[^']*spells\.json'/m.test(src)) continue
    if (rel === 'src/main/data/spellDb.ts') continue
    if (RAW_IMPORT_EXEMPT.has(rel)) continue
    if (!src.includes('applySpellRemovals')) offenders.push(rel)
  }
  assert.deepEqual(
    offenders,
    [],
    'a name-keyed index built on the raw scrape still offers spells EQ Legends does not have'
  )
})

test('the exemption list names only files that really exist and really import the scrape', () => {
  // An exemption that has rotted is worse than none: it looks like a decision somebody made about
  // a file, and the file may have been rewritten around it.
  const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
  for (const [rel, reason] of RAW_IMPORT_EXEMPT) {
    const src = readFileSync(join(root, rel), 'utf8')
    assert.match(src, /^import\s+\w+\s+from\s+'[^']*spells\.json'/m, `${rel} no longer imports the scrape`)
    assert.ok(reason.length > 20, `${rel}: an exemption states why`)
  }
})
