// SPELLS THE WIKI CARRIES AND THE GAME DOES NOT HAVE (JOS-337).
//
// `spells.json` is a SCRAPE of eqlwiki's `Template:Spellpage`, and `scripts/scrape-spells.ts`
// rewrites it wholesale — so a spell deleted out of it by hand comes back on the next re-scrape,
// exactly the way a hand-edited SENTENCE comes back. `spellCorrectionsList.ts` is the file that
// solved that for sentences; this is the same arrangement for the one thing a correction cannot
// express. The wiki dataset stays PRISTINE and IDEMPOTENT under re-scrape, and everything we know
// that the wiki does not lives beside it: five drift classes of wrong WORDS over there, and over
// here the sixth, which is not a drift in the words at all.
//
// THE DRIFT CLASS. eqlwiki documents EverQuest as the fan community has known it across decades of
// clients. EQ Legends is a particular server running a particular build, and it does not have
// every page the wiki has. When the wiki carries a spell the game lacks, nothing about the entry
// is misspelled: its messages are fine, its name is fine, its classes and levels are fine, and
// every one of them is a fact about a spell that is not there. The corrections layer patches four
// fields — `msgCastOnYou`, `msgCastOnOther`, `msgWearsOff`, `name` — and there is no assignment to
// any of them that makes a nonexistent spell stop existing.
//
// WHY IT MATTERS AT ALL, and it is not the parser this time. A message for a spell nobody can cast
// is inert: no line ever matches it, and the cost is a candidate in a list. What is NOT inert is
// everything that reads the DB as a CATALOG and shows it to the player as something they can act
// on. `buildLevelUnlocks` joins `classes` to level and the New-at-this-level panel offers the
// spell as a thing to go buy at 22, 24 and 30. `buildSpellCatalog` offers it in the alert wizard as
// a thing to set a sound for. Both are the app telling the owner, in his own words, to go do
// something the game will not let him do — which is the same failure the corrections layer exists
// to prevent, arriving from the opposite direction. A correction fixes an alert that can never
// fire; a removal withdraws an offer that can never be taken.
//
// ---------------------------------------------------------------------------------------------
// THE EVIDENCE BAR — this class's own, and it CANNOT be the corrections bar
// ---------------------------------------------------------------------------------------------
//
// Read the corrections bar first (`spellCorrectionsList.ts`, THE EVIDENCE BAR) and then notice
// that all four of its rules rest on the same instrument: counting occurrences of a sentence in
// 1.6M lines of the owner's log. Rule 1 wants zero of the wiki's text, rule 2 wants some of the
// replacement's, rules 3 and 4 read the two against each other. That instrument is not merely
// unavailable here — the corrections file already states, in so many words, why pointing it at an
// absence gives a wrong answer:
//
//     "The large majority of 'the DB says a sentence the log never prints' is not drift at all: a
//      DETRIMENTAL spell you cast lands on a MOB, so its msgCastOnYou and msgWearsOff print to the
//      MOB and are unobservable in your own log forever. … Absence of evidence is not evidence of
//      drift."
//
// The same sentence, one word changed, is why zero log lines can never remove a spell. A spell may
// be missing from a log because it is not in the game, because this character's classes cannot
// cast it, because nobody standing near him cast it, because it is detrimental and its lines print
// to somebody else, or because he simply never bothered. Five explanations, one observation, and
// the log cannot separate them. A layer that deleted rows on a zero count would delete hundreds of
// real spells, and it would do it silently.
//
// So the instrument is a PERSON. The bar is:
//
//   1. AN EXPLICIT, DATED OWNER VERIFICATION, PER ENTRY. Somebody with the game open looked for
//      this spell — in the spellbook, at the vendor, wherever it should be — and it was not there.
//      The date is `verified`, a required field rather than a line of prose, because it is the
//      only evidence this class has and a claim about a live service goes stale: a patch can add
//      the spell back, and a reader in six months needs to know how old the look was. ONE ENTRY,
//      ONE SPELL. The corrections layer can settle a family with one measurement because the
//      siblings share the sentence being measured; nobody's one look settles a family, and
//      `SpellRemoval` is singular so that no entry can pretend otherwise.
//
//   2. A STATED MECHANICAL REASON WHERE ONE EXISTS — AND `null` WHERE ONE DOES NOT. A verification
//      says "it is not there". A mechanical reason says "and here is the system it belonged to,
//      which is also not there", which is a far broader claim: it would license removing every
//      other spell in the same family, and the first entry below is precisely the case where
//      somebody nearly did. The field is held to its own bar, separately, and `null` is a real
//      answer that costs the entry nothing — rule 1 alone admits it.
//
//   3. THE REMOVAL MUST BE THE ONLY FIX. If the game HAS the spell under another name, that is
//      drift class five and it is a `name` correction, not a removal (`Solon's Bravura` was one
//      look away from being deleted for exactly this reason). If the game has it with different
//      words, that is classes one through four. A removal is admitted only where there is no
//      sentence, no name and no field that would make the row true.
//
//   4. SAY WHAT THE REMOVAL DOES NOT TAKE WITH IT. A row's messages are frequently SHARED (world
//      model law 3), and dropping one owner of a shared sentence must not be mistaken for dropping
//      the sentence. Each entry states which of its texts survive under other spells, because that
//      is the sentence a reader will otherwise go looking for after the row is gone.
//
// AND THE BOUNDARY THE WHOLE LAYER SITS ON: THIS REMOVES WHAT THE APP OFFERS, NEVER WHAT IT CAN
// DESCRIBE. A removal is the statement "no player can go and learn this spell", and that is a
// narrower statement than "this name means nothing". The first entry below is also the case that
// proves the difference: SEVEN items in the committed corpus carry an `Invigor` effect — Frozen
// Efreeti Boots, Tolan's Darkwood Boots, Mrylokar's Greaves, Singing Steel Vambraces, Camii's
// Bracer of Vigor, Abram's Axe of the Stoic, Orb of the Crimson Bull — and the gear planner joins
// an item's `Effect:` line to the spell page of the same name to print its one-liner
// (`planner/effectIndex.ts`). Feeding that join a list this layer has shortened would blank the
// description on seven real, obtainable items in order to hide a spell scroll: a regression bought
// with a fix. So the seam is applied where the app makes an OFFER (the level-unlock cards, the
// alert wizard's catalog, the parser's own tables) and deliberately NOT where it merely explains
// something the player is holding. `tests/spellRemovals.test.mts` enumerates every importer of the
// scrape and makes each one state which side of that line it is on.
//
// WHAT THIS FILE IS NOT FOR, stated so the reader can tell it apart from what it is for:
//
//   * A SPELL NOBODY LOOKED FOR. "It has no log lines and it looks like an old mechanic" is the
//     shape of every wrong removal, and it is not admissible. See the first entry: the pure
//     stamina-loss family has SEVEN more members and exactly one of them has been verified.
//   * AN ERA GATE. `spells.json` carries Kunark and Velious rows on purpose, and content this
//     server has not opened yet is not content the wiki got wrong. If a whole expansion needs
//     hiding, that is a filter with an era column behind it, not a hand list of names.
//   * A SPELL A CLASS CANNOT USE. `classes` already answers that, and `parseSpellClasses` already
//     drops what it cannot place. A spell the owner's loadout cannot cast is still in the game.
//
// ---------------------------------------------------------------------------------------------
// THE TOMBSTONE — what a re-scrape does to an entry, in both directions
// ---------------------------------------------------------------------------------------------
//
// The corrections layer gets its anti-rot guard for free: every correction restates the text it
// replaces, so a wiki that moves out from under it reports `stale` and the suite goes red. A
// removal has nothing to restate. It names a row and deletes it, and the only two states it can
// observe are "the row is here" and "the row is not".
//
// SO THE DECISION IS EXPLICIT, AND IT FOLLOWS `from: null`. That correction shape faces the same
// shortage — an ABSENT field has no text to compare — and resolves it by making absence itself the
// match condition: `from: null` applies while the field is empty, and reports `satisfied` the
// moment a re-scrape supplies the same text, because the world has arrived where the entry was
// pointing. A removal is that argument with the row in place of the field. If a future re-scrape
// drops the page naturally — the wiki editors notice, the template stops emitting it, the spell
// list shrinks — then the entry has got exactly what it asked for, and it reports `satisfied`. It
// does NOT fail the suite. `RemovalsReport` therefore has no `stale` list and no `unknownSpells`
// list; there is no third state for it to describe.
//
// THE ENTRY STAYS. A satisfied removal is a TOMBSTONE and is kept, which is the one place this
// layer's advice differs from the corrections layer's (whose header says an upstream fix means "we
// can drop it"). The wiki is a live, editable document and a re-scrape is a data change, not a
// refresh: a page that vanished in June can be restored in July by one editor, and the entry is
// the only record that somebody once opened the game and looked. Deleting it would mean the spell
// silently reappears in the unlock panel the next time somebody re-scrapes, with nothing in the
// tree remembering why it should not. `satisfied` is reported by NAME in the boot line so a
// tombstone that has been dead for years is visible rather than merely cheap.
//
// AND THE TYPO IS CAUGHT SOMEWHERE ELSE, WHICH IS THE PRICE OF THAT DECISION — stated plainly
// because it is the honest cost. A misspelled `spell` name and a naturally-dropped page are
// indistinguishable at run time: both are entries that match nothing. So the guard cannot be the
// report, and it is not: `tests/spellRemovals.test.mts` asserts by NAME, per entry, what the
// committed DB looks like after the pass. A new removal is authored against the committed
// spells.json in the same commit, where a typo removes nothing and the named acceptance fails
// immediately. That is a weaker guard than the corrections layer's and it is the strongest one
// this class admits.
//
// A REMOVED SPELL MAY NOT ALSO BE CORRECTED. The two lists are applied in order — removals, then
// corrections — so a correction naming a removed row would report `unknownSpells` at load and fail
// the corrections audit. That is a real backstop and it is not the guard: the audit refuses the
// pair STATICALLY, by reading both lists, so the contradiction is reported as what it is (two
// entries that disagree about whether a spell exists) rather than as a rotted correction.
//
// THE MECHANISM IS NEXT DOOR. `spellRemovals.ts` holds the types, the report and
// `applySpellRemovals` — which is what every consumer imports, and which re-exports this list so
// the seam is one import. The two are apart only because this one is a DATA file that grows by one
// entry per defect and the repo's max-lines ceiling is about code mass; keeping the prose above
// beside the entries it governs is the whole point of the split.

import type { SpellRemoval } from './spellRemovals'

/**
 * The removals, ordered oldest first. There is no family grouping here of the kind the corrections
 * list uses, because there are no families: every entry is one spell and one person's one look.
 */
export const SPELL_REMOVALS: readonly SpellRemoval[] = [
  // --- INVIGOR: the classic stamina buff the owner cannot find in EQ Legends ---------------------
  //
  // THE REPORT (owner directive, 2026-08-13). The New-at-this-level panel offered Invigor to a
  // PAL/RNG/SHM loadout at 22, 24 and 30 — three cards for a spell the owner says the game does not
  // have. One row in the scrape, `Decrease Stamina Loss by 35`, CLR 9 / PAL 22 / DRU 14 / SHM 24 /
  // ENC 24 / RNG 30. Nothing about the row is misspelled, which is what made it this layer's first
  // entry rather than a correction.
  //
  // WHAT THE REMOVAL DOES NOT TAKE WITH IT (bar rule 4). Both of Invigor's messages are SHARED with
  // `Extinguish Fatigue` (CLR 19 / DRU 29 / SHM 39 / ENC 44 / RNG 52), verbatim: `Your body zings
  // with energy.` and `Someone looks energized.` Dropping this row therefore changes no message
  // table at all — both sentences keep an owner, and a line that printed either would still
  // resolve. The only thing that changes is who the app OFFERS, which is the entire point.
  //
  // AND THE MECHANICAL REASON IS `null`, WHICH IS THE PART WORTH READING (bar rule 2). The ticket
  // proposed one — "the classic stamina-loss mechanic does not exist in EQL" — and the owner's own
  // log refutes it, which is exactly why rule 2 exists as a separate bar rather than as a clause of
  // rule 1. MEASURED, whole-log over `eqlog_Primitive_freeport.txt` (1,668,301 lines, 2026-08-13):
  //
  //     `Jaxan's Jig o' Vigor` (Bard 3) states ONE effect and it is `Decrease Stamina Loss by 10
  //     (L3) to 25 (L60)` — a pure stamina-loss spell with no second effect to carry it. Its
  //     cast-on-you sentence, `The jig sends energy zinging through your body.`, occurs 1,028 times
  //     in the owner's log; its wear-off, `You are no longer invigorated.`, 6 times; and at
  //     09:12:26 on the first of those days the log reads `Beginning to memorize Jaxan's Jig o`
  //     Vigor...`, so the owner was playing the bard who sang it. The mechanic was in the client he
  //     played.
  //
  //     THE HONEST QUALIFIER: all 1,028 landings fall on Sun Jul 19 2026, which is BEFORE official
  //     launch (2026-07-28, the epoch anchor) and is the only day the owner has played a bard. So
  //     the measurement establishes that the mechanic existed in the pre-launch client and does not
  //     establish that it survived to 2026-08-13. It does not need to: it is enough to show the
  //     wider claim was never checked, and an unchecked reason must not be written down as a fact
  //     that would license removing the seven other pure-stamina rows beside this one (Extinguish
  //     Fatigue, Jaxan's Jig o' Vigor, Word of Vigor, Cantana of Soothing, Cantana of
  //     Replenishment, Acumen, and the Yaulp ladder's stamina component).
  //
  // SO THE ENTRY RESTS ON RULE 1 AND NOTHING ELSE, which is what rule 1 is for: the owner looked
  // for Invigor and it was not there. That admits Invigor and admits nothing else, and the seven
  // siblings stay in the DB until somebody looks for them too.
  //
  // THE EFFECT IS NOT THE SPELL, and for this row that is a measurement rather than a caveat: the
  // committed items corpus carries SEVEN items whose `Effect:` is `Invigor` (Frozen Efreeti Boots,
  // Tolan's Darkwood Boots, Mrylokar's Greaves, Singing Steel Vambraces, Camii's Bracer of Vigor,
  // Abram's Axe of the Stoic, Orb of the Crimson Bull), five of them clickies a player equips and
  // uses. The removal says no player can go and LEARN Invigor; it does not say the name means
  // nothing, and the gear planner's one-liner join is exempted from this layer for exactly that
  // reason — see the boundary paragraph in the header, and the exemption table in the suite.
  //
  // ONE OBSERVATION THAT CUTS THE OTHER WAY, recorded rather than suppressed: the log carries a
  // single General-chat line from a stranger shopping for an Invigor spell scroll (Sun Jul 19
  // 2026). It is a third party's speech, so it is not quoted here and could never enter a fixture
  // (AGENTS.md's scrub law), and it proves nothing either way — a player can want a spell the
  // server does not have, and the wiki is where they would have read about it. It is noted because
  // a later reader searching the log for `invigor` will find it, and should find this paragraph
  // too rather than concluding the entry was written without seeing it.
  {
    spell: 'Invigor',
    verified: '2026-08-13',
    reason: null,
    evidence:
      'Owner verified absent from EQ Legends, 2026-08-13 (owner directive; the New-at-this-level panel was offering it to his PAL/RNG/SHM loadout at 22/24/30). No mechanical reason is claimed: the ticket proposed that the classic stamina-loss mechanic does not exist in EQL, and the owner`s own log measures the opposite for the pre-launch client — `Jaxan`s Jig o` Vigor`, whose ONLY effect is `Decrease Stamina Loss`, lands 1,028 times on Sun Jul 19 2026 and wears off 6 times, with the owner memorizing it himself. Both of Invigor`s messages survive the removal under `Extinguish Fatigue`, which carries them verbatim, so no message table changes.'
  }
]
