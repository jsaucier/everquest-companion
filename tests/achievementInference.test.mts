// ============================================================================
// THE ACHIEVEMENTS → SKY QUEST JOIN (JOS-429), and the ladder it composes on.
// ============================================================================
//
// THE AUDIT IS THE POINT OF THIS FILE. The join is 95 item names on one side and 95 item names on
// the other, and a name is a join key (world-model law 2) — so a re-scrape that renames a reward, a
// client patch that rewords an `Obtain` row, or a correction landing upstream all break it SILENTLY
// unless something counts. `covers every Sky quest` is that count, run against the committed
// fixture and the committed scrape, and it fails the moment either side moves.
//
// It is also why `ACHIEVEMENT_REWARD_ALIASES` states what the SCRAPE says today rather than only
// what the file says: an alias whose `reward` no longer matches any quest has stopped describing
// anything, and the audit says so instead of letting a dead row look like coverage. That is the
// `SkyQuestReward.from` idempotence rule, restated for this table.
//
// THE QUEST DATA IS READ THROUGH THE SAME CORRECTIONS THE APP APPLIES (`renderer/src/data/index.ts`
// composes `renameItemName` and `correctSkyQuestReward` onto the scrape). Testing the raw JSON
// would be testing a dataset no surface ever sees — and would miss the finding that the
// achievements file independently CONFIRMS both overlays.
//
// Run: `npm test`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { classUnlockClaims, parseAchievementsDump } from '../src/shared/outputs/achievements'
import {
  ACHIEVEMENT_REWARD_ALIASES,
  achievementItemsFor,
  achievementVouchedQuests
} from '../src/renderer/src/features/posky/achievementInference'
import { rewardInferredQuests } from '../src/renderer/src/features/posky/rewardInference'
import { withDerivedCompletion } from '../src/renderer/src/features/posky/questCompletion'
import { questKey } from '../src/renderer/src/features/posky/keys'
import { renameItemName } from '../src/shared/itemRenames'
import { correctSkyQuestReward } from '../src/shared/skyQuestRewards'
import {
  DERIVED_EVIDENCE_RANK,
  derivedCompletion,
  type DerivedCompletionSource
} from '../src/shared/questTurnIns'
import posky from '../src/renderer/src/data/eqlegends/posky.json'
import type { QuestProgress } from '../src/renderer/src/features/posky/useProgress'

const FIXTURE = join(import.meta.dirname, 'fixtures', 'Primitive_freeport-Achievements.txt')
const DUMP = parseAchievementsDump(readFileSync(FIXTURE, 'utf8'))

/** The quest set as the RENDERER sees it: the scrape with both correction overlays applied. */
const QUESTS = posky.quests.map((q) => {
  const c = correctSkyQuestReward({
    className: q.className,
    name: q.name,
    reward: q.reward,
    rewardPage: q.rewardPage,
    rewardStats: q.rewardStats
  })
  return {
    className: q.className,
    name: q.name,
    reward: c.reward === undefined ? undefined : renameItemName(c.reward),
    rewardStats: c.rewardStats
  }
})

/** Every `Obtain` row, earned or not — coverage is a claim about all 95, not about the owner's 48. */
const ALL_OBTAIN = DUMP.rows
  .filter(
    (r) =>
      r.category === 'Untapped Potential: Classes' && r.component?.startsWith('Obtain ') === true
  )
  .map((r) => ({
    className: r.achievement.replace('Primary Class Unlock - ', ''),
    item: (r.component ?? '').replace('Obtain ', '').replace(/\.$/, '')
  }))

// ---------------------------------------------------------------------------
// THE AUDIT.
// ---------------------------------------------------------------------------

test('the two sides are the same size, class for class', () => {
  assert.equal(ALL_OBTAIN.length, 95, 'Obtain rows in the real dump')
  assert.equal(QUESTS.length, 95, 'Sky quests in the committed scrape')
  const fold = (s: string): string => s.toLowerCase().replace(/\s+/g, '')
  const perClass = (rows: { className: string }[]): Map<string, number> => {
    const m = new Map<string, number>()
    for (const r of rows) m.set(fold(r.className), (m.get(fold(r.className)) ?? 0) + 1)
    return m
  }
  assert.deepEqual(
    [...perClass(ALL_OBTAIN)].sort(),
    [...perClass(QUESTS)].sort(),
    'per-class counts agree — the file says Shadowknight, the scrape Shadow Knight'
  )
})

test('every Sky quest is covered by exactly one achievement row', () => {
  // Pretend the whole file is earned: coverage is a fact about the JOIN, not about the owner.
  const vouched = achievementVouchedQuests(QUESTS, ALL_OBTAIN)
  const missing = QUESTS.filter((q) => !vouched.has(questKey(q)))
  assert.deepEqual(
    missing.map((q) => `${q.className} / ${q.name} / ${String(q.reward)}`),
    [],
    'no Sky quest is left without an achievement row'
  )
  assert.equal(vouched.size, 95)
})

test('no achievement row is left without a quest', () => {
  // The other direction: a row that matches nothing is data drift the audit must also catch.
  const claimed = new Set<string>()
  for (const q of QUESTS) {
    if (q.reward === undefined) continue
    for (const item of achievementItemsFor(q.className, q.reward)) {
      claimed.add(`${q.className.toLowerCase().replace(/\s+/g, '')} ${item.toLowerCase()}`)
    }
  }
  const orphans = ALL_OBTAIN.filter(
    (r) => !claimed.has(`${r.className.toLowerCase().replace(/\s+/g, '')} ${r.item.toLowerCase()}`)
  )
  assert.deepEqual(orphans, [])
})

test('the alias table still describes the scrape it was written against', () => {
  assert.equal(ACHIEVEMENT_REWARD_ALIASES.length, 3, 'three rows; 92 of 95 need none')
  for (const a of ACHIEVEMENT_REWARD_ALIASES) {
    const q = QUESTS.find((q) => q.className === a.className && q.name === a.questName)
    assert.ok(q, `${a.questName} is a real quest`)
    assert.equal(
      q?.reward,
      a.reward,
      `${a.questName}: the scrape still says "${a.reward}" — if a re-scrape fixed it, delete this row`
    )
    assert.ok(
      ALL_OBTAIN.some((r) => r.item === a.achievementItem),
      `${a.questName}: the file still says "${a.achievementItem}"`
    )
    assert.match(a.verified, /^\d{4}-\d{2}-\d{2}$/, 'a checked date')
    assert.ok(a.evidence.length > 60, 'an entry with no stated evidence is a guess')
  }
})

test('the achievements file independently confirms both existing overlays', () => {
  // JOS-428 corrected Bard Test of Wind's reward from the wiki's `Fae Amulet` to `Amulet of the
  // Fae` on the strength of a reporter's inventory export; JOS-415 renamed `Scintillating` to
  // `Shimmering Bracer of Protection` on the strength of a wiki redirect. Neither consulted this
  // file, which did not exist yet — and the game agrees with both. Needing NO alias row for either
  // is what proves it, so this asserts the absence.
  assert.ok(ALL_OBTAIN.some((r) => r.item === 'Amulet of the Fae'))
  assert.equal(ALL_OBTAIN.some((r) => r.item === 'Fae Amulet'), false)
  assert.ok(ALL_OBTAIN.some((r) => r.item === 'Shimmering Bracer of Protection'))
  assert.equal(ALL_OBTAIN.some((r) => r.item === 'Scintillating Bracer of Protection'), false)
  for (const name of ['Bard Test of Wind', 'Rogue Test of Stealth']) {
    assert.equal(
      ACHIEVEMENT_REWARD_ALIASES.some((a) => a.questName === name),
      false,
      `${name} needs no alias — the overlay already agrees with the game`
    )
  }
})

// ---------------------------------------------------------------------------
// THE JOIN, on the owner's real dump — the ticket's acceptance criterion.
// ---------------------------------------------------------------------------

test('the owner’s own achievements file marks their completed Sky quests', () => {
  const vouched = achievementVouchedQuests(QUESTS, classUnlockClaims(DUMP))
  assert.equal(vouched.size, 48, 'the 48 rewards the owner’s dump marks C')
  assert.ok(vouched.has('Bard::Bard Test of Wind'), 'a quest whose reward needed JOS-428’s fix')
  assert.ok(vouched.has('Ranger::Ranger Test of Defense'), 'Dark Cloak of the Sky')
  assert.equal(
    vouched.has('Berserker::Berserker Test of Fools Errand'),
    false,
    'Cudgel of the Fool is I — not vouched for'
  )
})

test('a file with no sky rows changes nothing', () => {
  const other = parseAchievementsDump(
    ['EverQuest: Raids', 'C\tConqueror of Kedge Keep', 'C\t\tPhinigel Autropos'].join('\r\n')
  )
  assert.equal(achievementVouchedQuests(QUESTS, classUnlockClaims(other)).size, 0)
  assert.equal(achievementVouchedQuests(QUESTS, []).size, 0)
  assert.equal(achievementVouchedQuests(QUESTS, undefined).size, 0, 'command never run')
})

test('the class is checked, so a reward under the wrong class vouches for nothing', () => {
  const q = QUESTS.find((q) => q.name === 'Ranger Test of Defense')
  assert.ok(q?.reward)
  assert.equal(
    achievementVouchedQuests(QUESTS, [{ className: 'Wizard', item: q?.reward ?? '' }]).size,
    0
  )
  assert.equal(
    achievementVouchedQuests(QUESTS, [{ className: 'Ranger', item: q?.reward ?? '' }]).size,
    1
  )
})

test('the class fold spans the game’s spelling and the wiki’s', () => {
  const sk = QUESTS.find((q) => q.className === 'Shadow Knight')
  assert.ok(sk?.reward, 'the scrape spells it with a space')
  // The FILE spells it Shadowknight, and that is the spelling stored in `achievementUnlocks`.
  const vouched = achievementVouchedQuests(QUESTS, [
    { className: 'Shadowknight', item: sk?.reward ?? '' }
  ])
  assert.equal(vouched.size, 1)
  assert.ok(vouched.has(questKey(sk as { className: string; name: string })))
})

test('the item fold is case and whitespace only — apostrophes are load-bearing', () => {
  const q = QUESTS.find((q) => q.reward === "Al`Kabor's Cap of Binding")
  assert.ok(q, 'the backtick-and-apostrophe reward is in the data')
  assert.equal(
    achievementVouchedQuests(QUESTS, [
      { className: 'Wizard', item: "al`kabor's cap of binding" }
    ]).size,
    1,
    'case folds'
  )
  assert.equal(
    achievementVouchedQuests(QUESTS, [{ className: 'Wizard', item: 'AlKabors Cap of Binding' }]).size,
    0,
    'punctuation does NOT fold — a looser fold is a guess bought for nothing'
  )
})

// ---------------------------------------------------------------------------
// THE LADDER — which source speaks, and what the row is labelled.
// ---------------------------------------------------------------------------

const row = (over: Partial<QuestProgress> = {}): QuestProgress => ({
  key: 'Bard::Bard Test of Wind',
  className: 'Bard',
  name: 'Bard Test of Wind',
  items: [],
  haveCount: 0,
  needCount: 0,
  ratio: 0,
  missing: [],
  turnIns: 0,
  logTurnIns: 0,
  completed: false,
  ...over
})

const sources = (a: string[], r: string[]): DerivedCompletionSource[] => [
  { evidence: 'achievement', vouched: new Set(a) },
  { evidence: 'reward', vouched: new Set(r) }
]

test('the ladder ranks the server’s answer above the inference from possession', () => {
  assert.deepEqual([...DERIVED_EVIDENCE_RANK], ['achievement', 'reward'])
  const both = sources(['q'], ['q'])
  assert.equal(derivedCompletion('q', both), 'achievement')
  // …and the array's ORDER must not decide it.
  assert.equal(derivedCompletion('q', [...both].reverse()), 'achievement')
  assert.equal(derivedCompletion('q', sources([], ['q'])), 'reward')
  assert.equal(derivedCompletion('q', sources([], [])), null)
})

test('a derived floor is one turn-in, completed, and says which source', () => {
  const q = withDerivedCompletion(row(), sources(['Bard::Bard Test of Wind'], []))
  assert.equal(q.turnIns, 1)
  assert.equal(q.completed, true)
  assert.equal(q.completionEvidence, 'achievement')
  assert.equal(q.logTurnIns, 0, 'the log’s share is a fact about the log')
})

test('two sources vouching for one quest are two witnesses, not two turn-ins', () => {
  const q = withDerivedCompletion(row(), sources(['Bard::Bard Test of Wind'], ['Bard::Bard Test of Wind']))
  assert.equal(q.turnIns, 1, 'they do not add')
  assert.equal(q.completionEvidence, 'achievement', 'the stronger one is named')
})

test('any ledger evidence wins outright — count AND label', () => {
  const q = withDerivedCompletion(row({ turnIns: 3, logTurnIns: 3, completed: true }), sources(['Bard::Bard Test of Wind'], []))
  assert.equal(q.turnIns, 3, 'a derived floor can only say "at least once"')
  assert.equal(q.completionEvidence, undefined, 'so it does not label a ledger row')
})

test('a quest no source vouches for is returned untouched, by identity', () => {
  const before = row()
  assert.equal(withDerivedCompletion(before, sources([], [])), before)
  assert.equal(withDerivedCompletion(before, []), before)
})

test('the two derived sources compose on the real data', () => {
  // The reward inference alone vouches for what the export holds; the achievements dump alone
  // vouches for 48. Composed, the achievement label wins wherever both speak — which is exactly
  // the ordering the ticket asked for.
  const achievement = achievementVouchedQuests(QUESTS, classUnlockClaims(DUMP))
  const reward = rewardInferredQuests(QUESTS, { 'dark cloak of the sky': 1 })
  assert.equal(reward.size, 1, 'the export holds one reward')
  const key = [...reward][0]
  assert.ok(achievement.has(key), 'and the achievements dump marks that quest too')
  const both: DerivedCompletionSource[] = [
    { evidence: 'achievement', vouched: achievement },
    { evidence: 'reward', vouched: reward }
  ]
  assert.equal(withDerivedCompletion(row({ key }), both).completionEvidence, 'achievement')
  // A quest ONLY the export can speak for still reads 'reward'.
  const rewardOnly: DerivedCompletionSource[] = [
    { evidence: 'achievement', vouched: new Set<string>() },
    { evidence: 'reward', vouched: reward }
  ]
  assert.equal(withDerivedCompletion(row({ key }), rewardOnly).completionEvidence, 'reward')
})
