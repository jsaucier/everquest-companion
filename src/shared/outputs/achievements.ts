// ============================================================================
// shared/outputs/achievements.ts — THE `/outputfile achievements` FORMAT, characterized from a
// real dump, and the ONE thing this app reads out of it.
// ============================================================================
//
// JOS-429. Three reporters and a Reddit thread asked the same question in four wordings: I did Sky
// content before I installed this / on another PC / with logging off — how do I import it? The game
// answers it already. `/outputfile achievements` writes what the SERVER thinks you have done, and
// for the Plane of Sky that is not a hint or a heuristic: the class-unlock achievement carries one
// row per Sky quest reward and the server has already decided whether you obtained it.
//
// ---------------------------------------------------------------------------
// THE FORMAT, MEASURED — the owner's own dump, 2026-08-20.
// ---------------------------------------------------------------------------
// `<EQ root>\Primitive_freeport-Achievements.txt`, 64,539 bytes, 1,884 CRLF-terminated lines,
// committed verbatim as `tests/fixtures/Primitive_freeport-Achievements.txt`. Discovered exactly
// the way the inventory dump is (outputs/discovery.ts under `effectiveEqRoot()`, the
// `<Character>_<server>-<Kind>.txt` name), so the `Achievements` filename suffix is MEASURED now
// and `fileKindVerified` says so.
//
// Pure ASCII, no BOM, CRLF throughout (zero bare LFs), trailing newline. TAB-SEPARATED, and the
// tabs are an INDENT: a row's field count is its depth in a three-level tree, with the leading
// field carrying a one-letter status on every row except the top.
//
//   Untapped Potential: Classes                              1 field  — CATEGORY, no status
//   I<TAB>Primary Class Unlock - Bard                        2 fields — ACHIEVEMENT, status first
//   C<TAB><TAB>Obtain Mask of Song.                          3 fields — COMPONENT, col 1 empty
//   I<TAB><TAB>Gnolls<TAB>2/5000                             4 fields — COMPONENT + counter
//
// Status is `C` (complete) or `I` (incomplete) and nothing else — 520 `C`, 1,338 `I`, zero other
// values across the whole file. The middle field of a 3- or 4-field row is ALWAYS empty (1,251 of
// 1,251), the 4th field is always `<n>/<m>` and appears only under the three `Slayer:` categories.
// The audit found ZERO anomalies of any kind, which is why the parser below refuses rather than
// tolerating: a shape this regular that stops being regular is news, not noise.
//
// 26 categories, each `Family: Group` (`Untapped Potential: Classes`, `EverQuest: Raids`, …),
// 501 achievements, 1,357 components.
//
// A PARENT'S STATUS IS NOT ITS CHILDREN'S, and this is the trap the reader below avoids. The
// owner's `Primary Class Unlock - Paladin` row is `C` while only five of its six components are —
// because the achievement also completes when you simply ARE a Paladin ("This achievement will
// autocomplete if you chose to confirm your Primary Class as a Paladin."). Reading the achievement
// row would mark every Paladin Sky quest done for every Paladin. Only the COMPONENT rows are read.
//
// ---------------------------------------------------------------------------
// WHY THIS FILE ANSWERS THE SKY QUESTION, AND HOW EXACTLY IT JOINS.
// ---------------------------------------------------------------------------
// `Untapped Potential: Classes` holds sixteen `Primary Class Unlock - <Class>` achievements whose
// components are, apart from two boilerplate sentences each, exactly `Obtain <Item>` — the Sky
// quest rewards. MEASURED against the committed scrape: 95 `Obtain` rows, 95 Sky quests, and the
// per-class counts agree class for class. That 1:1 is the whole basis of the join.
//
// THE ORDER DOES NOT ALIGN and must never be used. Within a class the achievement lists its
// components in a different order from the wiki's quest table (Cleric: the file leads with
// Necklace of Resolution, the scrape with Truewind Earring), so an ordinal join would silently
// credit the wrong quest for eleven of the sixteen classes. The join is BY ITEM NAME, inside the
// class the achievement names — the class is a check, not a tiebreak, since every reward is unique
// to its quest anyway (rewardInference.ts measured that).
//
// THE CLASS NAME IS THE GAME'S SPELLING, not the wiki's: the file says `Shadowknight`, the scrape
// says `Shadow Knight`. Folded on comparison, never rewritten.
//
// ---------------------------------------------------------------------------
// WHAT THIS FILE DOES **NOT** DECIDE.
// ---------------------------------------------------------------------------
// The join against the quest set lives in the renderer
// (renderer/src/features/posky/achievementInference.ts), because the Sky quest data is the
// renderer's bundle — the same split `rewardInference.ts` already has, where main persists a flat
// artifact and the renderer joins it against posky.json. This module knows the FILE and nothing
// about Plane of Sky beyond the category name.
//
// AND IT IS ONE-DIRECTIONAL, decided here so no reader has to re-derive it. `C` on a component is
// evidence the quest was turned in. `I` is NOT evidence it was not: it is the same "a dump adds, it
// never subtracts" promise the inventory export already makes (progressState.ts), and the reason
// `classUnlockClaims` returns only the EARNED rows — a record that cannot express a denial cannot
// be misread as one.

/** The one-letter status column, as English. `C`/`I` are the only two values a real dump carries. */
export type AchievementStatus = 'complete' | 'incomplete'

/**
 * ONE ROW of the dump, with its place in the tree resolved.
 *
 * `component` absent ⇒ this row IS the achievement (a 2-field line); present ⇒ it is one of the
 * achievement's requirement lines. `category` is the un-statused header the rows sit under.
 */
export interface AchievementRow {
  /** the `Family: Group` header, verbatim */
  category: string
  /** the achievement's name, verbatim */
  achievement: string
  /** the requirement line, verbatim; absent on the achievement row itself */
  component?: string
  status: AchievementStatus
  /** the `<n>/<m>` counter the Slayer components carry, verbatim; absent everywhere else */
  progress?: string
}

/** A parsed dump. A list, because the file is one and the tree is already resolved onto each row. */
export interface AchievementsDump {
  rows: AchievementRow[]
}

/** The category holding the Sky class-unlock achievements. */
export const CLASS_UNLOCK_CATEGORY = 'Untapped Potential: Classes'

/** What every class-unlock achievement's name starts with; the rest is the class. */
export const CLASS_UNLOCK_PREFIX = 'Primary Class Unlock - '

/** What every reward component line starts with; the rest is the item. */
const OBTAIN_PREFIX = 'Obtain '

/**
 * ONE EARNED REWARD, as the achievements file states it — the flat artifact main persists and the
 * renderer joins against the quest set.
 *
 * Both fields are the GAME's spelling, kept verbatim: `className` is `Shadowknight` where the
 * scrape says `Shadow Knight`, and `item` is whatever the row said with only a trailing period
 * taken off (the file is inconsistent about it — `Obtain Mask of Song.` and `Obtain Molten Coil`
 * are both real rows). Normalizing here would throw away the evidence and leave the join matching
 * our own guess against our own guess.
 */
export interface ClassUnlockClaim {
  className: string
  item: string
}

/**
 * WHAT WE KNOW ABOUT THE ACHIEVEMENTS DUMP WE READ — `ProgressState.achievementsSource`.
 *
 * The `InventorySource` shape minus everything the inventory baseline needed and this does not.
 * There is no generation instant to resolve: the log's `Outputfile Complete:` receipt is joined by
 * FILE NAME and would work here too, but nothing in this path compares an instant against
 * anything, so recording one would be a field with no reader (`loadInventoryDump`'s own rule about
 * persisted keys nobody reads). The two instants that ARE read are the file's and ours.
 */
export interface AchievementsSource {
  path: string
  /** The file's mtime, ISO. What the freshness line renders — when the PLAYER typed the command. */
  loadedAt: string
  /** When THIS APP last read it, epoch ms. The JOS-253 pair, for the same reason. */
  readAt: number
}

/**
 * Parse a dump's text into rows.
 *
 * STRICT, on the measurement above: a line whose leading field is neither `C` nor `I`, or whose
 * indent columns are not empty, or that is deeper than the format has ever been, is DROPPED rather
 * than guessed at. The real file produced zero such lines, so anything this skips is a format that
 * has changed under us — and half-reading a changed format is exactly what the registry's
 * no-guessing law exists to prevent. A component before any achievement is dropped for the same
 * reason: it has no parent to belong to.
 *
 * Blank lines are skipped (the trailing newline makes one). CR is stripped so a dump that has been
 * through a text tool and lost its CRLFs still reads.
 */
export function parseAchievementsDump(text: string): AchievementsDump {
  const rows: AchievementRow[] = []
  let category = ''
  let achievement: string | null = null
  for (const raw of text.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (line === '') continue
    const fields = line.split('\t')
    if (fields.length === 1) {
      category = line
      achievement = null
      continue
    }
    const status = STATUS[fields[0]]
    if (status === undefined) continue
    if (fields.length === 2) {
      if (fields[1] === '') continue
      achievement = fields[1]
      rows.push({ category, achievement, status })
      continue
    }
    // A component with no achievement above it has no parent to belong to.
    if (achievement === null) continue
    const row = componentRow(category, achievement, status, fields)
    if (row !== null) rows.push(row)
  }
  return { rows }
}

/**
 * One requirement line, or null when its shape is not one the real file has ever printed: exactly
 * one empty indent column, a non-empty name, and at most one counter after it. Split out of the
 * loop above so each half stays inside the measured complexity ceiling — and it reads better as
 * "what a component row is", which is the only rule in it.
 */
function componentRow(
  category: string,
  achievement: string,
  status: AchievementStatus,
  fields: string[]
): AchievementRow | null {
  if (fields.length > 4 || fields[1] !== '' || fields[2] === '') return null
  const progress = fields.length === 4 && fields[3] !== '' ? fields[3] : undefined
  return {
    category,
    achievement,
    component: fields[2],
    status,
    ...(progress === undefined ? {} : { progress })
  }
}

const STATUS: Record<string, AchievementStatus | undefined> = {
  C: 'complete',
  I: 'incomplete'
}

/**
 * THE EARNED CLASS-UNLOCK REWARDS a dump vouches for — the projection this whole module exists to
 * produce, and the only thing that leaves it.
 *
 * COMPONENT ROWS ONLY, and only the `C` ones (the header's two rules). The two boilerplate
 * components every class-unlock achievement carries ("This achievement will autocomplete if…",
 * "This achievement can be bypassed using a…") are not `Obtain` rows and so are never claims —
 * which matters, because on the owner's own dump the autocomplete row is `C` for the class they
 * actually play.
 *
 * A dump with no such rows yields an empty list, which is the acceptance criterion stated as code:
 * a file with nothing to say about Sky changes nothing.
 */
export function classUnlockClaims(dump: AchievementsDump): ClassUnlockClaim[] {
  const out: ClassUnlockClaim[] = []
  for (const row of dump.rows) {
    if (row.category !== CLASS_UNLOCK_CATEGORY) continue
    if (row.component === undefined || row.status !== 'complete') continue
    if (!row.component.startsWith(OBTAIN_PREFIX)) continue
    if (!row.achievement.startsWith(CLASS_UNLOCK_PREFIX)) continue
    const className = row.achievement.slice(CLASS_UNLOCK_PREFIX.length).trim()
    const item = row.component.slice(OBTAIN_PREFIX.length).trim().replace(/\.$/, '')
    if (className === '' || item === '') continue
    out.push({ className, item })
  }
  return out
}
