// JOS-259 — A SPELL ALERT FIRES FOR EVERY RANK OF THE SPELL.
//
// THE REPORT (feedback 01KZV6X5MVY3904VVBKQMATEMV, 0.23.0). A wizard's "resisted" alert for
// Elemental Maelstrom stopped firing. Nothing about the alert changed; what changed is that they
// unlocked rank II. Their FADE alert for the same spell kept working the whole time, which is the
// detail that names the mechanism:
//
//   [22:31:05] You begin casting Elemental Maelstrom II.                          ← ranked
//   [22:31:07] Cleric of Innoruuk resisted your Elemental Maelstrom II!           ← ranked
//   [22:45:__] Your Elemental Maelstrom spell has worn off of Cleric of Innoruuk. ← NOT ranked
//
// EQ Legends re-tiers the classic spells as roman-numeral ranks of one base name, and only SOME
// of the lines a spell prints carry the suffix (log/parseCombat.ts keeps the display form on
// `resist`; `castBegin` keeps it too; the wear-off family prints the bare name). A literal
// `where.spell` matcher compiled to whole-string equality (modules/alerts.ts `compileFieldMatch`),
// so one def could satisfy one half of its own spell's lines and never the other. The wizard's
// rank chip had pinned the unsuffixed name — the rank this character was casting when they clicked
// it — and the day the log started printing "II" the alert went silent with no error and no offer.
//
// THE OWNER'S RULING (2026-08-12): rank-blind matching, full stop. A spell alert just works with
// ALL ranks of the spell, and no upgrade offer is needed to keep an alert firing. The domain law
// behind it, verbatim: once you upgrade a spell it never downgrades, even on a loadout swap.
//
// THE FIX UNDER TEST: a LITERAL `where.spell` spec compiles with `spellLineKey(spec)` beside it,
// and `accepts` compares the rank-folded keys when the exact compare misses. It is a pure
// widening — a def pinned to a rank still fires on that rank — and it touches neither `/regex/`
// specs (a user-authored pattern is intent, not a spelling) nor any other `where` key.
//
// THE LINES ARE QUOTED, NEVER COMMITTED. The reporter's slice is a user's own game log; `.gitignore`
// says those bytes are read locally and never enter git. What is reproduced below is the handful of
// individual client notices this defect lives on — the same treatment tests/suggestedAlertsFire.mts
// gives JOS-84's reporter — with mob names left as the log spelled them, because they are mobs. No
// window, no state, no session.
//
// THE DEFS ARE NOT HAND-WRITTEN where the wizard authors them: the reporter's resisted alert comes
// out of the REAL path (buildSpellCatalog(loadSpellDb()) → suggestionsFor(entry, rank)) and into
// the REAL AlertsModule through the REAL parser.
//
// Run: `npm test`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseEvent } from '../src/main/log/parser'
import { installSpellDb } from '../src/main/log/rulesets'
import { buildSpellCatalog, loadSpellDb } from '../src/main/data/spellDb'
import { AlertsModule } from '../src/main/modules/alerts'
import { suggestionsFor } from '../src/renderer/src/features/alerts/suggestions'
import type { SpellRank } from '../src/shared/spellLines'
import type { AlertDef, FiredAlert, SpellCatalogEntry } from '../src/shared/types'

// Installed exactly as main installs it — the shared-sentence families below resolve against it,
// and the reporter's own def is built from the catalog it feeds. Node runs each test FILE in its
// own process, so this global injection cannot reach a sibling suite.
const db = loadSpellDb()
installSpellDb(db)
const catalog = buildSpellCatalog(db, new Map())

/** The reporter's own lines, verbatim from slice 01KZV6X5MVY3904VVBKQMATEMV. */
const SLICE = {
  cast: '[Tue Aug 11 22:31:05 2026] You begin casting Elemental Maelstrom II.',
  resistCleric: '[Tue Aug 11 22:31:07 2026] Cleric of Innoruuk resisted your Elemental Maelstrom II!',
  resistBanshee: '[Tue Aug 11 22:34:15 2026] A scorn banshee resisted your Elemental Maelstrom II!',
  fadeCleric:
    '[Tue Aug 11 22:39:12 2026] Your Elemental Maelstrom spell has worn off of Cleric of Innoruuk.'
}

function entryFor(key: string): SpellCatalogEntry {
  const e = catalog.entries.find((x) => x.key === key)
  assert.ok(e, `spells.json must carry a catalog entry for "${key}"`)
  return e
}

/**
 * The rank the wizard pins its chips to, shaped as the alerts snapshot supplies it.
 *
 * `suffixed:false, rank:1` IS THE REPORTER'S CASE and is not a simplification: a rank chip is
 * offered only for a rank actually seen cast, so before the unlock the only name their log had
 * ever printed was the bare "Elemental Maelstrom".
 */
function rank(name: string, ordinal = 1): SpellRank {
  return {
    name,
    rank: ordinal,
    suffixed: ordinal > 1,
    lastCastMs: Date.parse('2026-08-11T22:20:00Z')
  }
}

/** Feed raw log lines through the real parser into a module holding `defs`; return the fires. */
function fire(defs: AlertDef[], lines: string[]): FiredAlert[] {
  const mod = new AlertsModule()
  mod.setDefs(defs)
  mod.reset()
  let seq = 0
  for (const line of lines) {
    const ev = parseEvent(line, seq++)
    if (ev) mod.onEvent(ev, true)
  }
  return mod.flushDelta()?.delta.fired ?? []
}

/** A hand-written def — the shape the alert editor stores. `cooldownMs:0` so nothing is swallowed. */
function def(id: string, kind: string, where: Record<string, string>): AlertDef {
  return {
    id,
    name: id,
    enabled: true,
    trigger: { type: 'event', kind, where } as AlertDef['trigger'],
    sound: { packId: 'alan-rickman', soundId: 'task-error-task-error-01' },
    cooldownMs: 0
  }
}

// ── THE ACCEPTANCE FIXTURE ────────────────────────────────────────────────────────────────────

test('JOS-259 A1: the reporter\'s resisted alert fires on their rank-II resist lines', () => {
  const suggestion = suggestionsFor(entryFor('elemental maelstrom'), rank('Elemental Maelstrom'))
    .find((s) => s.template === 'resistRank')
  assert.ok(suggestion, 'the wizard must still offer a resisted chip for a detrimental spell')
  const resisted = suggestion.def
  // The def is UNCHANGED by this fix — pinned to the name the wizard had, as authored. `caster`
  // is what keeps a bystander's resist of the same spell out of your ears (Task #51).
  assert.deepEqual(resisted.trigger, {
    type: 'event',
    kind: 'resist',
    where: { caster: 'you', spell: 'Elemental Maelstrom' }
  })

  const fired = fire([resisted], [SLICE.resistCleric, SLICE.resistBanshee])
  assert.equal(fired.length, 2, 'both rank-II resists must fire the base-name def')
  assert.deepEqual(fired.map((f) => f.matchedText), [SLICE.resistCleric, SLICE.resistBanshee])
  // It SAYS what the log said. The def's spelling is the alert's business; the rank is the log's.
  assert.deepEqual(fired.map((f) => f.spell), ['Elemental Maelstrom II', 'Elemental Maelstrom II'])
})

test('JOS-259 A2: the fade path keeps working — same def, rank-less line', () => {
  // The `fade` template's exact trigger shape (suggestions.ts SUGGEST_TEMPLATES.fade), pinned to
  // the same base name. This is the half that never broke, and the half a widening could break.
  const fade = def('fade', 'buffFade', { spell: 'Elemental Maelstrom' })
  const fired = fire([fade], [SLICE.fadeCleric])
  assert.equal(fired.length, 1, 'the rank-less wear-off must still fire')
  assert.equal(fired[0].spell, 'Elemental Maelstrom')

  // And ONE def now owns both halves of the spell's own vocabulary — the whole ticket in one line.
  const both = fire(
    [def('resisted', 'resist', { caster: 'you', spell: 'Elemental Maelstrom' }), fade],
    [SLICE.cast, SLICE.resistCleric, SLICE.fadeCleric]
  )
  assert.deepEqual(both.map((f) => f.alertId), ['resisted', 'fade'])
})

test('JOS-259 A3: the evidence — one spell, two spellings, straight off the parser', () => {
  const resist = parseEvent(SLICE.resistCleric, 0)
  assert.equal(resist?.kind, 'resist')
  if (resist?.kind !== 'resist') return
  assert.equal(resist.spell, 'Elemental Maelstrom II', 'a resist line KEEPS the rank')
  assert.equal(resist.caster, 'you')
  assert.equal(resist.target, 'Cleric of Innoruuk')

  const cast = parseEvent(SLICE.cast, 1)
  assert.equal(cast?.kind === 'castBegin' && cast.spell, 'Elemental Maelstrom II')

  const fade = parseEvent(SLICE.fadeCleric, 2)
  assert.equal(fade?.kind, 'buffFade')
  if (fade?.kind !== 'buffFade') return
  assert.equal(fade.spell, 'Elemental Maelstrom', 'the wear-off line NEVER carries the rank')
})

// ── WHAT FOLDS, AND WHAT STAYS EXACT ──────────────────────────────────────────────────────────

test('JOS-259 B1: a rank-pinned def keeps firing on its rank, and now on the others', () => {
  const pinned = def('pinned', 'resist', { caster: 'you', spell: 'Elemental Maelstrom II' })
  // The narrower def still answers the line it was built from — the widening subsumes the old
  // equality, it does not replace it with something else.
  assert.equal(fire([pinned], [SLICE.resistCleric]).length, 1)
  // …and it no longer goes stale in either direction. Rank III is the level-up the reporter hit;
  // rank I is the loadout swap the owner's domain law says never happens, tested anyway because a
  // fold that only worked upwards would be a second rule to remember.
  const lines = [
    '[Tue Aug 11 22:40:00 2026] A scorn banshee resisted your Elemental Maelstrom III!',
    '[Tue Aug 11 22:41:00 2026] A scorn banshee resisted your Elemental Maelstrom!'
  ]
  assert.equal(fire([pinned], lines).length, 2, 'rank-blind means every rank, not just upwards')
})

test('JOS-259 B2: a /regex/ spec is user intent and is left exactly alone', () => {
  const narrow = def('narrow', 'resist', { caster: 'you', spell: '/^Elemental Maelstrom II$/' })
  const loose = def('loose', 'resist', { caster: 'you', spell: '/maelstrom/' })
  const three = '[Tue Aug 11 22:40:00 2026] A scorn banshee resisted your Elemental Maelstrom III!'

  assert.deepEqual(fire([narrow, loose], [SLICE.resistCleric]).map((f) => f.alertId), [
    'narrow',
    'loose'
  ])
  assert.deepEqual(
    fire([narrow, loose], [three]).map((f) => f.alertId),
    ['loose'],
    'someone who anchored their pattern to a rank asked a narrower question on purpose'
  )
})

test('JOS-259 B3: only the spell key folds — the other where entries still gate', () => {
  const mine = def('mine', 'resist', { caster: 'you', spell: 'Elemental Maelstrom' })
  // The same spell, resisted off somebody else's cast. `caster` is not a spell name and does not
  // fold; the def is still yours-only.
  const theirs = "[Tue Aug 11 22:42:00 2026] A scorn banshee resisted Nightbane's Elemental Maelstrom II!"
  const ev = parseEvent(theirs, 0)
  assert.equal(ev?.kind === 'resist' && ev.caster, 'Nightbane')
  assert.equal(fire([mine], [theirs]).length, 0, 'a bystander\'s resist is still not your alert')

  // A spec that is NOTHING BUT a rank folds to the empty string, and an empty key would accept
  // every spell in the game. It stays a literal instead.
  const romanOnly = def('roman', 'castBegin', { spell: 'II' })
  assert.equal(fire([romanOnly], [SLICE.cast]).length, 0, 'the fold must never become a wildcard')
})

// ── CONSISTENCY ACROSS EVERY KIND THAT NAMES A SPELL ──────────────────────────────────────────

test('JOS-259 C1: every spell-naming kind answers to one def, ranked line or not', () => {
  // The mirror image of the reporter's case, and the reason this has to be one rule rather than a
  // resist patch: the CAST line is the ranked one and the BREAK line is bare, so a def pinned to
  // the rank the wizard saw you cast could never hear its own hold end.
  const mez = def('mez', 'cc', { spell: 'Mesmerization III', refresh: 'true' })
  const charm = def('charm', 'uncharm', { spell: 'Allure VI' })
  const cast = def('cast', 'castBegin', { spell: 'Mesmerization' })
  const lines = [
    '[Tue Aug 11 22:50:00 2026] You begin casting Mesmerization IV.',
    '[Tue Aug 11 22:50:30 2026] Your Mesmerization spell has worn off of a froglok ton knight.',
    '[Tue Aug 11 22:50:40 2026] Your Allure spell has worn off of a froglok ton knight.'
  ]
  assert.deepEqual(fire([mez, charm, cast], lines).map((f) => f.alertId), ['cast', 'mez', 'charm'])
})

test('JOS-259 C2: the candidate list folds too, and the fire says the name it matched', () => {
  // A shared-message family (JOS-84): the sentence names no spell, `spell` is a best-effort
  // alphabetical pick and `candidates` carries the truth — all of them rank-less DB names. A def
  // pinned to a RANK of one of them must still be admitted through that list, or the two widenings
  // would each work only where the other was not needed.
  const slow = def('slow', 'buffApply', { spell: 'Shiftless Deeds V' })
  const landed = '[Tue Aug 11 22:55:00 2026] a froglok ton knight slows down.'
  const ev = parseEvent(landed, 0)
  assert.equal(ev?.kind, 'buffApply')
  if (ev?.kind !== 'buffApply') return
  assert.notEqual(ev.spell, 'Shiftless Deeds', 'the best-effort pick is not the user\'s spell')
  assert.ok(ev.candidates?.some((c) => c.name === 'Shiftless Deeds'))

  const fired = fire([slow], [landed])
  assert.equal(fired.length, 1, 'a rank-pinned def must still reach the candidate list')
  assert.equal(
    fired[0].spell,
    'Shiftless Deeds',
    'the fire names the candidate that satisfied the matcher, not the alphabetical pick'
  )
})
