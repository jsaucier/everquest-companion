// gear/gearColumns.ts — WHICH numeric columns the table draws, and how wide they are.
//
// THE PROBLEM THIS SOLVES. `GEAR_STAT_KEYS` is 32 keys wide and the ticket asks to sort by ANY of
// them, regens and backstab included. Thirty-two columns is not a table anyone can read, and a
// "pick your columns" dialog is a second surface to maintain for a question the user has already
// answered somewhere else — because ASKING ABOUT A STAT IS ALREADY SAYING YOU WANT TO SEE IT. So
// the column list is DERIVED: a small always-on core, plus a column for every stat currently being
// thresholded and for whatever the table is sorted by. Filter on `HP_REGEN` and the regen column
// appears; sort by `BACKSTAB` and the backstab column appears; clear them and the table narrows
// back down. Nothing to configure and nothing to forget you configured.
//
// WIDTHS ARE PERCENTAGES, AND THAT IS JOS-260's LAW, not a preference. The table is
// `tableLayout: fixed` (a windowed table whose columns re-measure per slice moves its row heights
// under a hook whose every index assumes they cannot — LootTables.tsx states the full argument),
// and a fixed table whose stated widths exceed its box grows past it and hands the pane a
// horizontal scrollbar. So the numeric columns SHARE a fixed budget: N columns each take
// `NUMERIC_BUDGET / N`, the identity columns take a constant, and the NAME column states no width
// at all — it takes whatever is left, which is the one column that can usefully absorb the slack.
//
// PURE AND NODE-TESTABLE (relative value imports, the house law): this file decides the shape of
// the table, so `tests/gearFilter.test.mts` can assert that a threshold brings its column with it.

import { GEAR_PERCENT_STAT_KEYS, type GearStatKey } from '../../../../shared/planner/gear'
import type { GearFilters, GearSort, GearSortKey } from './gearFilter'

/**
 * The columns that are always there: armour, the two pools every class reads, and the weapon
 * ratio. Ratio earns its permanent place because it is the one number the plus-state selector
 * MOVES for a reason that is not obvious (DELAY never scales — phase 0), and watching it move is
 * half of what the selector is for.
 */
export const CORE_COLUMNS: readonly GearSortKey[] = ['AC', 'HP', 'MP', 'RATIO']

/**
 * How many derived columns may join the core before the table stops being readable. Past this the
 * extra thresholds still FILTER — they just stop drawing a column of their own, which is the
 * honest trade: the rows on screen are all answers to those thresholds anyway.
 */
export const MAX_DERIVED_COLUMNS = 6

/** Percent of the table the numeric columns share between them. */
const NUMERIC_BUDGET = 52
/** …and the floor one column may shrink to, which is what caps the derived count above. */
const MIN_NUMERIC_WIDTH = 5

export const SLOT_COLUMN_WIDTH = '13%'
export const CLASS_COLUMN_WIDTH = '11%'

/**
 * THE OWNERSHIP COLUMN (JOS-285, phase 4) — appended AFTER `visibleColumns`' numerics, and only
 * when the character has a dump to answer from.
 *
 * IT IS ONE COLUMN, not three. "Do you own it", "where" and "at what +N" are one sentence about
 * one item (`ownedCellText`: `Equipped · Bank +2`), and splitting them into three columns would
 * put three blank cells on every one of the ~6,700 rows a player does not own. It is also NOT a
 * `GearColumn`: those keys are `GearSortKey`s and every one of them is a number the plus-state
 * scaler moves. Ownership is text off a live file, so it lives beside the numeric list rather than
 * inside it — which is exactly why it needs no entry in the shared numeric budget below.
 *
 * NOTHING TO ANSWER FROM ⇒ NO COLUMN. On a machine with no dump AND no loot history, an empty
 * ownership cell would be indistinguishable from "you do not own this" — and the app cannot tell
 * the difference either. So the column is absent and the `/outputfile` freshness line beside the
 * count says why (GearView). Either witness alone is enough to draw it.
 */
export const OWNED_COLUMN_WIDTH = '15%'

export interface GearColumn {
  key: GearSortKey
  /** the header's words — `SV MAGIC`, `HP REGEN`, `Ratio` */
  label: string
  /** rendered with a trailing `%` (HASTE, and the census says only HASTE) */
  percent: boolean
}

const PERCENT_KEYS: ReadonlySet<string> = new Set<string>(GEAR_PERCENT_STAT_KEYS)

/** `HP_REGEN` → `HP REGEN`, `RATIO` → `Ratio`. The underscore is a key's spelling, not a word. */
export function columnLabel(key: GearSortKey): string {
  if (key === 'RATIO') return 'Ratio'
  if (key === 'name') return 'Item'
  return key.replace(/_/g, ' ')
}

function column(key: GearSortKey): GearColumn {
  return { key, label: columnLabel(key), percent: PERCENT_KEYS.has(key) }
}

/**
 * The numeric columns for these filters and this sort: the core, then every thresholded stat, then
 * the sort key — deduped, in that order, capped at `MAX_DERIVED_COLUMNS` derived entries.
 *
 * ORDER IS STABLE ON PURPOSE. The core never moves, so adding a threshold appends a column instead
 * of re-arranging the four the eye has already learned; and a sort key that is already a core
 * column adds nothing at all.
 */
export function visibleColumns(filters: GearFilters, sort: GearSort): GearColumn[] {
  const keys: GearSortKey[] = [...CORE_COLUMNS]
  const derived: GearSortKey[] = [...filters.thresholds.map((t) => t.key), sort.key]
  for (const key of derived) {
    if (key === 'name' || keys.includes(key)) continue
    if (keys.length - CORE_COLUMNS.length >= MAX_DERIVED_COLUMNS) break
    keys.push(key)
  }
  return keys.map(column)
}

/** One numeric column's width, as the percentage string the header cell states. */
export function numericWidth(count: number): string {
  const each = count > 0 ? NUMERIC_BUDGET / count : NUMERIC_BUDGET
  return `${String(Math.max(MIN_NUMERIC_WIDTH, Math.round(each * 10) / 10))}%`
}

/**
 * A cell's text. ABSENT RENDERS BLANK, never `0` and never a dash: the vector omits a key the item
 * never stated (law 1), and printing `0` would be this table inventing a stat line the wiki does
 * not have. A blank cell in a dense numeric grid reads as "states none", which is what it means.
 */
export function statText(value: number | undefined, key: GearSortKey): string {
  if (value === undefined) return ''
  if (key === 'RATIO') return value.toFixed(2)
  if (key === 'WEIGHT') return value.toFixed(1)
  if (PERCENT_KEYS.has(key)) return `${String(value)}%`
  return String(value)
}

/** The stat keys a column list draws, for a caller that only needs the vector keys. */
export function statKeysOf(columns: readonly GearColumn[]): GearStatKey[] {
  return columns.flatMap((c) => (c.key === 'name' || c.key === 'RATIO' ? [] : [c.key]))
}
