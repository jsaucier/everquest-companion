// WHAT A SPELL DOES, DERIVED FROM WHAT THE WIKI SAID IT DOES (JOS-251).
//
// THE LINEAGE THIS FILE EXISTS TO END. Until now the only way this app could answer "is this spell
// a charm?" was to match its NAME against a regex of stems (`CHARM_STEMS` / `CC_STEMS` in
// src/main/log/rulesets.ts), because the scraped catalog carried no column saying what a spell did
// — `spellType` is `Beneficial`/`Detrimental` and nothing more. Guessing from names shipped four
// defects in a row:
//
//   JOS-84   a message family was used as an effect family, sweeping three bard songs into the mez
//            roster on the strength of a shared landing sentence.
//   JOS-200  one of them was the bard CHARM, and the reversal had to be argued from a reporter's
//            slice rather than read off a column.
//   JOS-225  the other direction: two songs in the mez roster that hold nothing at all.
//   JOS-250  the audit. `charm` matched two item focus effects and a necro self-buff; `boltran`
//            matched a PET SUMMON and armed a 10.5-second false charm window; and THREE druid
//            charms had no stem at all, one of them a 3-hour hold whose break was silent.
//
// The eqlwiki spell page has stated the answer the whole time, in the numbered effect list every
// page prints: `1: Charm (up to L37)`, `2: Decrease Magic Resist by 4 (L27) to 8 (L60)`. JOS-251
// taught the scrape to capture those lines verbatim (`SpellEntry.effects`), and this module is the
// reader for them.
//
// ── IT IS AN OVERLAY, AND THAT IS THE POINT ─────────────────────────────────────────────────────
//
// The owner's constraint, and the same architecture `spellCorrections.ts` was built under: the
// scraped file records WHAT THE WIKI SAID and nothing else, and everything WE conclude lives in a
// separable layer that can be deleted without taking the data with it. Delete this file and
// spells.json is still a valid, complete scrape; nothing here writes back into an entry, and every
// function is pure over the argument it is handed. `tests/spellEffectClass.test.mts` asserts the
// separation directly by classifying rows loaded straight out of the raw JSON with no overlay of
// any kind applied.
//
// ── THE GRAMMAR, AND WHY IT IS ANCHORED ─────────────────────────────────────────────────────────
//
// An effect line names its effect FIRST and then quantifies it: "Charm up to level 25",
// "Mesmerize (2/55)", "Decrease Attack Speed by 30%", "Stun for 8.0 seconds". So every rule below
// is anchored at the START of the line, which is what makes this different in kind from the stem
// regexes it replaces — a stem matched a substring of a NAME (which is why `charm` found
// `Charm of Fire` and `allure` found `Allure of Death`), while these match the head of a sentence
// the wiki wrote to describe a mechanic. The anchor is doing real work: it is the only reason
// `Add Melee Proc: Stunning Strike` is not a stun and `See Invisible(1)` is not invisibility.
//
// MEASURED against the 1,928-row committed catalog, every class below is exact — the membership
// was read out and checked spell by spell, and the test pins the counts so a re-scrape that widens
// or narrows one fails loudly instead of drifting.
//
// WHAT IS DELIBERATELY NOT HERE. Damage, healing, stat and resist lines are the overwhelming bulk
// of the corpus (1,877 distinct strings this module does not classify) and no consumer has asked
// for them; classifying them "while we are in here" would be inventing a taxonomy nobody has
// checked. The awaiting-sample law: a class ships when something needs it and the membership has
// been read.

import type { SpellEntry } from '../../shared/types'
// The ONE canonical-name rule in the tree (rank tail stripped, lowercased) — imported rather than
// re-spelled, because a roster keyed by a second opinion about what "Mesmerize IV" folds to is a
// roster that disagrees with the parser on exactly the lines that matter. parseCommon's only
// reference back this way is an `import type`, so this edge is one-way at runtime.
import { spellCanonKey } from '../log/parseCommon'

/**
 * The effect classes this module can read off a wiki effect line.
 *
 * `charm` and `mez` are the deliverables JOS-251 was filed for. The rest are here because the same
 * anchored read gives them for free AND their membership was checked by hand; each carries the
 * exact phrasing family it answers to in the rule table below.
 */
export type SpellEffectClass =
  | 'charm'
  | 'summonPet'
  | 'mez'
  | 'root'
  | 'snare'
  | 'slow'
  | 'haste'
  | 'fear'
  | 'stun'
  | 'blind'
  | 'pacify'
  | 'memblur'
  | 'invisibility'
  | 'feignDeath'

interface EffectRule {
  klass: SpellEffectClass
  test: RegExp
  /** The wiki phrasings this rule answers to, and the near-misses the anchor keeps out. */
  note: string
}

/**
 * THE RULE TABLE. One rule per class, each anchored at the head of the effect line.
 *
 * A line matches AT MOST ONE class — the classes are disjoint by construction (no two heads are
 * prefixes of one another), which is checked as an assertion rather than assumed.
 */
const EFFECT_RULES: readonly EffectRule[] = [
  {
    klass: 'charm',
    test: /^charm\b/i,
    note: 'Both phrasings: "Charm up to level 25" (17 rows) and "Charm (up to L37)" (7). 24 rows, 23 names, and it is the JOS-250 audit roster exactly.'
  },
  {
    klass: 'summonPet',
    // JOS-258. THE PET SUMMON, read the same way — and the reason it is a rule here rather than a
    // `spellType === 'Pet'` test is that the wiki's TYPE column is narrower than its own effect
    // list: 83 rows are typed Pet, 104 rows say `Summon Pet:` in so many words, and the 18 the type
    // column misses include every Vocarate/Greater Vocaration (the magician's top elementals) and
    // `Zumaik\`s Animation`. Reading what the spell DOES finds them; reading how somebody filed it
    // does not — which is the whole argument of this module, applied one class further.
    //
    // THREE HEADS, all measured, because the necromancer's two top pets are spelled differently:
    // `Summon Pet: Level 19 Skeletal Pet` (98 rows), `Summon Skeleton Pet: skel_pet_43_` (Minion of
    // Shadows, Servant of Bones) and `Summon Spectre Pet` (Emissary of Thule). DELIBERATELY NOT in
    // the family: `Call Pet` (Summon Companion — it TELEPORTS the pet you already have and summons
    // nothing), `Pet Power Increase`, `Decrease Pet Size by 50%` (Tiny Companion) and the whole
    // `Summon Item` head, which is 141 rows away from anything with a name of its own.
    test: /^summon (pet|spectre pet|skeleton pet)\b/i,
    note: '104 rows / 102 canonical names; 101 of the rows (99 names) are player-castable. Both the Self forms and the one Single form (Flaming Sword of Xuzl) count - a summon is a summon whoever the wiki says it targets.'
  },
  {
    klass: 'mez',
    test: /^mesmeriz/i,
    note: '"Mesmerize (2/55)" (the enchanter/necro form) and "Mesmerize (up to L45)" (the bard form). 16 spells.'
  },
  {
    klass: 'root',
    test: /^root\b/i,
    note: 'The bare word, always. 24 rows — three of them BENEFICIAL Self forms (Treeform, Spirit of Oak, Illusion: Tree) that root the CASTER, which is why the target-side helpers below gate on targetType.'
  },
  {
    klass: 'snare',
    test: /^decrease movement speed\b/i,
    note: '"Decrease Movement Speed by 40%" and its level formulas. 36 spells.'
  },
  {
    klass: 'slow',
    test: /^decrease attack speed\b/i,
    note: '"Decrease Attack Speed by 30%". 36 spells — the effect-line twin of shared/alertGroups.ts SLOW_SPELLS, which is a hand-written name list.'
  },
  {
    klass: 'haste',
    test: /^increase (attack speed|melee haste)\b/i,
    note: 'The wiki writes the player-cast family as "Increase Attack Speed by 60%" and a handful of item/song effects as "Increase Melee Haste by 10%". 50 spells.'
  },
  {
    klass: 'fear',
    test: /^fear\b(?! immunity)/i,
    note: '"Fear(1)" and "Fear (up to L52)". The one exclusion is literal: `Fear Immunity` is the opposite effect and shares the head.'
  },
  {
    klass: 'stun',
    test: /^(spin)?stun\b/i,
    note: '"Stun for 8.0 seconds", "Stun (1.00 sec/55)", "SpinStun". 96 spells. The anchor is what keeps `Add Melee Proc: Stunning Strike` out — that line adds a proc, it does not stun.'
  },
  {
    klass: 'blind',
    test: /^blind(ness)?\b/i,
    note: '"Blindness(-1)", "Blindness", "Blind". 14 spells.'
  },
  {
    klass: 'pacify',
    test: /^(pacify|lull|reaction radius)\b/i,
    note: 'The lull line writes itself three ways; `Reaction Radius (10/50)` is the same mechanic under its engine name. 12 spells, and they are exactly the family spellDb.ts CALM_LANDING_MESSAGES reaches by landing sentence.'
  },
  {
    klass: 'memblur',
    test: /^memblur\b/i,
    note: '"Memblur(20%)". 17 spells. Named as the wiki names it rather than "memory blur", because the string is the evidence.'
  },
  {
    klass: 'invisibility',
    test: /^(improved )?invisibility\b/i,
    note: '"Invisibility", "Invisibility versus Undead", "Improved Invisibility". 21 spells. `See Invisible(1)` is the DETECTION effect and the anchor excludes it.'
  },
  {
    klass: 'feignDeath',
    test: /^feign death\b/i,
    note: 'Two spells (Death Peace, Feign Death). Kept because it is unambiguous, not because anything reads it yet.'
  }
]

/** The rule table, exported so the audit test can re-derive membership rather than restate it. */
export { EFFECT_RULES }

/**
 * Classify ONE raw effect line. `null` means "this module has no opinion", which is the honest
 * answer for the 1,877 distinct damage/heal/stat strings it deliberately does not read.
 */
export function classifyEffectLine(line: string): SpellEffectClass | null {
  const s = line.trim()
  for (const r of EFFECT_RULES) if (r.test.test(s)) return r.klass
  return null
}

/**
 * Every class a spell's effect list states, in rule-table order.
 *
 * A spell genuinely can carry several — `Solon's Song of the Sirens` is a charm AND a magic-resist
 * debuff, `Screaming Terror` is a mez AND a memblur — so this returns a SET rather than picking a
 * winner. Picking a winner is a consumer's job and depends on the question being asked.
 */
export function spellEffectClasses(entry: SpellEntry): SpellEffectClass[] {
  const found = new Set<SpellEffectClass>()
  for (const line of entry.effects ?? []) {
    const k = classifyEffectLine(line)
    if (k) found.add(k)
  }
  return EFFECT_RULES.filter((r) => found.has(r.klass)).map((r) => r.klass)
}

/** True when the wiki's effect list says this spell does `klass`. */
export function spellHasEffect(entry: SpellEntry, klass: SpellEffectClass): boolean {
  return (entry.effects ?? []).some((line) => classifyEffectLine(line) === klass)
}

// ── FROM AN EFFECT CLASS TO A PARSER ROSTER ─────────────────────────────────────────────────────
//
// A roster is narrower than a class, and the gap is where the remaining honesty lives.
//
// `Your <X> spell has worn off of <mob>.` is a sentence about a spell YOU cast on SOMETHING ELSE.
// So a roster derived for that reader has to refuse two kinds of member the class contains: the
// SELF forms (Treeform roots the druid, not the mob) and the NPC-only spells (no player can cast
// one, so no such line can ever name it — the same exclusion SLOW_SPELLS makes for Rejuvenation).
// Both gates read fields the scrape already carried; neither is a guess.

/** `classes` lists at least one player class — the wiki writes them as `* [[Enchanter]] - Level 11`. */
export function isPlayerCastable(entry: SpellEntry): boolean {
  return (entry.classes ?? '').includes('*')
}

/** A spell that lands on something OTHER than the caster. */
export function affectsATarget(entry: SpellEntry): boolean {
  return entry.targetType !== 'Self'
}

export interface RosterOptions {
  /** Drop the NPC-only rows (default true — see the note above). */
  castableOnly?: boolean
  /** Drop `targetType: 'Self'` rows (default true). */
  targetOnly?: boolean
}

/**
 * The canonical names of every spell whose effect list states `klass`, ready to be tested against
 * a name a log line printed.
 *
 * KEYED BY `spellCanonKey`, which strips the roman-numeral rank tail — because the log prints
 * `Mesmerize IV` and the catalog carries `Mesmerize`. That is the whole of what the name STEMS are
 * still needed for once a roster is derived: a ranked display name folds to a key, and the key is
 * in the set or it is not.
 */
export function effectRoster(
  spells: readonly SpellEntry[],
  klass: SpellEffectClass,
  opts: RosterOptions = {}
): Set<string> {
  const castableOnly = opts.castableOnly ?? true
  const targetOnly = opts.targetOnly ?? true
  const out = new Set<string>()
  for (const s of spells) {
    if (!spellHasEffect(s, klass)) continue
    if (castableOnly && !isPlayerCastable(s)) continue
    if (targetOnly && !affectsATarget(s)) continue
    out.add(spellCanonKey(s.name))
  }
  return out
}

/**
 * THE CHARM ROSTER: every spell whose effect list says it charms.
 *
 * This is the list JOS-250's audit built by hand from the wiki, derived instead — and a re-scrape
 * that adds a charm adds it here for free, which is the entire argument for this ticket.
 */
export function charmRoster(spells: readonly SpellEntry[], opts?: RosterOptions): Set<string> {
  return effectRoster(spells, 'charm', opts)
}

/**
 * THE HOLD ROSTER: mez ∪ root — the two effects that STOP a mob, which is what the parser's `cc`
 * event means and what the "Mez / root broke" alert group announces.
 *
 * SNARE AND SLOW ARE NOT IN IT, deliberately and with a scar to point at. JOS-225's report was the
 * "Mez / root broke" alert firing on every `Largo's Melodic Binding` lapse, and JOS-233 ruled that
 * song a snare and an attack-speed debuff — a debuff whose target keeps swinging. A movement debuff
 * is not a hold, and the whole point of deriving the roster is that this distinction now comes from
 * the effect line rather than from remembering the incident.
 */
/**
 * THE PET-SUMMON ROSTER (JOS-258): every spell whose effect list says it summons you a pet.
 *
 * `targetOnly` is OFF here and that is the point of the override. The roster the charm reader wants
 * refuses `targetType: 'Self'` because its consumer is a sentence about a spell you cast on
 * something else; a pet summon is cast on NOBODY — 103 of the 104 rows are `Self` — and its
 * consumer is `You begin casting <Spell>.`, a line about the caster. Same data, opposite gate,
 * which is exactly why the gate is an argument rather than a property of the class.
 *
 * The CASTABLE gate stays on: `Manifest Elements`, `Mistwalker` and `Summon Golin` are NPC-only, so
 * no player ever prints a cast line for one.
 */
export function petSummonRoster(spells: readonly SpellEntry[], opts?: RosterOptions): Set<string> {
  return effectRoster(spells, 'summonPet', { targetOnly: false, ...opts })
}

export function holdRoster(spells: readonly SpellEntry[], opts?: RosterOptions): Set<string> {
  const out = effectRoster(spells, 'mez', opts)
  for (const k of effectRoster(spells, 'root', opts)) out.add(k)
  return out
}
