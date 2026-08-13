// gear/gearFilter.ts — THE GEAR TABLE'S MODEL: scale, then filter, then sort (JOS-284, phase 3).
//
// THE ORDER IS THE WHOLE DESIGN, and it is not negotiable. The global plus-state selector changes
// what every row IS — a weapon's ratio improves with every tier because DMG scales and DELAY does
// not (phase 0's rule, `gearScale.ts`'s header) — so a threshold filter or a sort that ran on BASE
// numbers under a `+5` slider would be answering a question nobody asked. Everything below reads
// the SCALED vector:
//
//     scaleAll(rows, state) → filterGearRows(…) → sortGearRows(…)
//
// `scaleAll` is measured at ~18 ms for the whole 6,766-row index (tests/gearIndex.test.mts prints
// it every run), which is what lets the selector be a live slider rather than an Apply button.
//
// PURE AND NODE-TESTABLE (`tests/gearFilter.test.mts`), the plannerGroups/plannerClasses precedent:
// value imports are RELATIVE, nothing here touches React, storage, IPC or the corpus. The one rule
// this file does NOT own is the ERA verdict — that lives in `plannerData.eraHides`, which reaches
// the renderer's mob-catalog inversion and cannot be imported under the node runner. So it arrives
// as an injected predicate (`GearFilterDeps.eraHidden`) rather than being restated here, which is
// also what keeps the gear table and the exaltation browser from ever disagreeing about an era.
//
// ABSENT IS NOT ZERO — THE RULE THIS FILE APPLIES THREE TIMES. `GearStats` omits a key the item
// never stated (gear.ts, law 1), so:
//   * a THRESHOLD is met only by a row that STATES the key at or above the number. An absent stat
//     fails even `>= 0`: "no HASTE line" is not "0% haste", and a filter that read the two the same
//     way would answer "items with at least 0 haste" with the entire corpus.
//   * a SORT puts absent LAST in both directions. Ascending by haste must not rank six thousand
//     plain items above the sixty-four that state one; descending must not either.
//   * a RATIO is `undefined` for anything that is not a weapon (`gearRatio`), so a ratio sort never
//     ranks 5,000 non-weapons at zero and a ratio FILTER excludes them outright.

import type { ClassAbbr } from '../../../../shared/classCombo'
import { normalizeStatKey, type ItemUpgradeState } from '../../../../shared/itemUpgrade'
import {
  isGearStatKey,
  type GearRow,
  type GearStatKey
} from '../../../../shared/planner/gear'
import { gearRatio, scaleGearRow } from '../../../../shared/planner/gearScale'
import type { EquipSlot, SocketType } from '../../../../shared/planner/types'

// ---- the filter model ---------------------------------------------------------------------

/** One stat threshold: `HP >= 50`. Only `min` — see the header on why `>= 0` is not "everything". */
export interface StatThreshold {
  key: GearStatKey
  min: number
}

/**
 * The effect filter, in the DONOR vocabulary (`SocketType`) plus the two answers a socket cannot
 * give. `any` does not filter; `has` is "states any effect line at all", which is the question a
 * player asks before they know which kind they want.
 */
export type EffectFilter = 'any' | 'has' | SocketType

/**
 * Everything the table filters on, combinable — every field is ANDed, and each is INERT at its
 * empty value (`''`, `null`, `[]`, `'any'`, `false`). That is what makes "any stat threshold, and
 * a slot, and a class combo, and an effect kind, and an era" one object rather than five modes.
 */
export interface GearFilters {
  /** the DEFERRED search text (the standing search law — the view owns the `useDeferredValue`) */
  text: string
  /** `null` = every slot */
  slot: EquipSlot | null
  /**
   * The class combo the table is reading for. It is a FILTER AND NEVER A RULE (the V2 law that
   * `plannerClasses.ts` was written for): an empty list asks for no class filter at all, and a row
   * outside it is hidden only while `classOnly` is on — never marked invalid, never removed from
   * the corpus.
   */
  classes: ClassAbbr[]
  /** hide rows no class in `classes` can use. A row whose page stated NO class list is KEPT. */
  classOnly: boolean
  effect: EffectFilter
  /** minimum weapon damage ratio; non-weapons never pass it */
  minRatio: number | null
  /** combinable stat thresholds, ANDed */
  thresholds: StatThreshold[]
  /** hide rows the era join places outside the current expansion */
  eraOnly: boolean
  /**
   * THE OWNER'S CHECKBOX (JOS-285): keep only what this character owns or has looted.
   *
   * "Or looted" is not a softening — it is the second witness. The dump is one instant and the log
   * is a history, and an item you looted last week and put in a bag the dump does not cover is
   * still an item you have handled. `gearOwnership.ts` decides what qualifies (a wearable copy, an
   * exaltation made from one, or a loot line); this flag only says whether to apply it.
   */
  ownedOnly: boolean
}

export const DEFAULT_GEAR_FILTERS: GearFilters = {
  text: '',
  slot: null,
  classes: [],
  // OFF by default, unlike the exaltation browser's `trioOnly`. Search IS the default surface here
  // (owner ruling): the table opens on the whole corpus and every narrowing is one the user chose,
  // where the browser opens inside a SET whose trio is the question it was created to ask.
  classOnly: false,
  effect: 'any',
  minRatio: null,
  thresholds: [],
  // ON by default — the same argument the exaltation browser's era toggle carries: more than half
  // the corpus drops in expansions this server has not opened, and a plan built on them is a wish
  // list. `plannerData.eraHides` is the one verdict; this flag only says whether to apply it.
  eraOnly: true,
  // OFF by default, and that is the search-first ruling again: the tab opens on the CORPUS, which
  // is the question a planner asks first ("what is out there"). "What do I already have" is the
  // second question and it is one click away.
  ownedOnly: false
}

/** What the pure model cannot answer for itself — see the header. */
export interface GearFilterDeps {
  /** `plannerData.eraHides(row, true)`, injected. Default: nothing is ever hidden by era. */
  eraHidden?: (row: GearRow) => boolean
  /**
   * Does this character own or have they looted this row (`gearOwnership.ts`)? Injected for the
   * same reason `eraHidden` is: the answer comes from a live dump and the loot module, neither of
   * which a pure filter may reach.
   *
   * DEFAULT: NOTHING QUALIFIES — so a caller that turns `ownedOnly` on without supplying an
   * answer gets an EMPTY table rather than a filter that silently did nothing. An empty table is
   * visible and the view names the toggle responsible for it (the JOS-67 law); a no-op filter is
   * a control that lies about being on.
   */
  ownedOrLooted?: (row: GearRow) => boolean
}

// ---- threshold parsing --------------------------------------------------------------------

// `hp 50`, `HP>=50`, `sv magic >= 20`, `mana regen: 3`, `wt 2.5`, `dmg=20`. The key half is
// matched loosely and then folded by PHASE 0's own `normalizeStatKey` — never by a second alias
// table here, which is the same discipline `gear.ts` states for the vector's keys (MANA → MP,
// REGEN → HP_REGEN). A key that does not fold to an indexed column is refused rather than
// half-understood: the table has no column to show it in and no vector value to compare.
const THRESHOLD_RE = /^\s*([a-z][a-z_ -]*?)\s*(?:>=|>|:|=)?\s*(-?\d+(?:\.\d+)?)\s*$/i

/**
 * One typed threshold, or `null` when the text is not one. Refusing is the point: a typo must add
 * no chip rather than a chip that silently filters on something else.
 */
export function parseThreshold(text: string): StatThreshold | null {
  const m = THRESHOLD_RE.exec(text)
  if (m === null) return null
  const key = normalizeStatKey(m[1])
  if (!isGearStatKey(key)) return null
  const min = Number(m[2])
  return Number.isFinite(min) ? { key, min } : null
}

/**
 * Add a threshold, replacing any existing one on the same key. One key can only carry one minimum
 * — two chips reading `HP >= 20` and `HP >= 50` would draw a contradiction the AND has already
 * resolved, so the newer number wins and the row of chips stays readable.
 */
export function withThreshold(
  thresholds: readonly StatThreshold[],
  next: StatThreshold
): StatThreshold[] {
  return [...thresholds.filter((t) => t.key !== next.key), next]
}

/** The chip's own words: `HP >= 50`, spelled the way the column header is. */
export function thresholdLabel(t: StatThreshold): string {
  return `${t.key.replace(/_/g, ' ')} >= ${String(t.min)}`
}

// ---- the predicates ------------------------------------------------------------------------

/**
 * R2's class half, three-valued — the SAME rule `plannerData.classFit` reads, restated here in the
 * one direction this table needs. Both empties are unknowns and neither is a mismatch: an empty
 * filter asks for no filter, and a page that stated no class list stayed silent (law 1).
 */
export function classMismatch(rowClasses: readonly ClassAbbr[], filter: readonly ClassAbbr[]): boolean {
  if (rowClasses.length === 0 || filter.length === 0) return false
  return !rowClasses.some((c) => filter.includes(c))
}

/** Does this row state an effect of the kind asked for? */
export function effectMatches(row: GearRow, effect: EffectFilter): boolean {
  if (effect === 'any') return true
  if (effect === 'has') return row.effects.length > 0
  return row.effects.some((e) => e.socket === effect)
}

/**
 * Every threshold, ANDed, on the SCALED vector. Absent fails — see the header.
 */
export function meetsThresholds(row: GearRow, thresholds: readonly StatThreshold[]): boolean {
  for (const t of thresholds) {
    const value = row.stats[t.key]
    if (value === undefined || value < t.min) return false
  }
  return true
}

/** WHO this row is: the name, the slot and the class combo. */
function matchesIdentity(row: GearRow, filters: GearFilters): boolean {
  const needle = filters.text.trim().toLowerCase()
  if (needle !== '' && !row.searchKey.includes(needle)) return false
  if (filters.slot !== null && !row.slots.includes(filters.slot)) return false
  return !(filters.classOnly && classMismatch(row.classes, filters.classes))
}

/** WHAT this row reads AT THE CURRENT PLUS-STATE: its effects, its thresholds, its ratio. */
function matchesNumbers(row: GearRow, filters: GearFilters): boolean {
  if (!effectMatches(row, filters.effect)) return false
  if (!meetsThresholds(row, filters.thresholds)) return false
  if (filters.minRatio === null) return true
  const ratio = gearRatio(row.stats)
  return ratio !== undefined && ratio >= filters.minRatio
}

/**
 * The whole filter for one row — the three predicates above, ANDed, and the two injected verdicts.
 *
 * The two injected ones are LAST on purpose: both reach data outside this module (the mob-catalog
 * inversion, a parsed dump), and a row rejected by a cheap local predicate never pays for them.
 */
export function matchesGear(row: GearRow, filters: GearFilters, deps: GearFilterDeps = {}): boolean {
  if (!matchesIdentity(row, filters)) return false
  if (!matchesNumbers(row, filters)) return false
  if (filters.ownedOnly && !(deps.ownedOrLooted?.(row) ?? false)) return false
  return !(filters.eraOnly && (deps.eraHidden?.(row) ?? false))
}

/** The filtered rows, in the input's order — SORTING is the next stage's job, never this one's. */
export function filterGearRows<T extends GearRow>(
  rows: readonly T[],
  filters: GearFilters,
  deps: GearFilterDeps = {}
): T[] {
  return rows.filter((r) => matchesGear(r, filters, deps))
}

// ---- the sort ------------------------------------------------------------------------------

/**
 * Any numeric column, plus the two derived ones. `RATIO` is `gearRatio` (never a second opinion on
 * DMG/DELAY) and `name` is the only non-numeric axis.
 */
export type GearSortKey = 'name' | 'RATIO' | GearStatKey

export interface GearSort {
  key: GearSortKey
  dir: 'asc' | 'desc'
}

/** The table opens on the highest AC — a ranking, so the first screen says something. */
export const DEFAULT_GEAR_SORT: GearSort = { key: 'AC', dir: 'desc' }

/** The number a sort reads, or `undefined` when the row states none (which sorts LAST, both ways). */
export function sortValue(row: GearRow, key: GearSortKey): number | undefined {
  if (key === 'name') return undefined
  if (key === 'RATIO') return gearRatio(row.stats)
  return row.stats[key]
}

/**
 * A new, sorted array — never a mutation of the caller's, because the filtered array is a memo
 * another render still holds.
 *
 * NAME IS THE TIEBREAK EVERYWHERE, so the order is TOTAL: four hundred rows sharing `AC 20` would
 * otherwise re-shuffle on every re-sort (`Array.prototype.sort` is stable, but the array reaching
 * it is a fresh filter each time), and a windowed list whose rows swap under the scrollbar is the
 * bug that looks like a rendering fault.
 */
export function sortGearRows<T extends GearRow>(rows: readonly T[], sort: GearSort): T[] {
  const sign = sort.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    if (sort.key === 'name') return sign * a.name.localeCompare(b.name)
    const av = sortValue(a, sort.key)
    const bv = sortValue(b, sort.key)
    if (av === undefined || bv === undefined) {
      if (av === bv) return a.name.localeCompare(b.name)
      return av === undefined ? 1 : -1
    }
    return av === bv ? a.name.localeCompare(b.name) : sign * (av - bv)
  })
}

// ---- the plus-state stage -------------------------------------------------------------------

/**
 * Every row at `state`, as a PURE MAP — `scaleGearRow`'s own answer, kept in the caller's row type
 * so a renderer row that carries extra fields (the widened `searchKey`, and the ownership join
 * phase 4 will hang off `row.key`) survives the scaling.
 *
 * The base rows are never mutated: the next slider position starts from the same numbers, which is
 * what makes dragging the selector reversible rather than cumulative.
 */
export function scaleAll<T extends GearRow>(rows: readonly T[], state: ItemUpgradeState): T[] {
  return rows.map((r) => ({ ...r, stats: scaleGearRow(r, state).stats }))
}

/**
 * The three stages composed, for callers that want the answer in one call (the unit test, and any
 * future consumer that is not a React tree). THE VIEW DOES NOT USE THIS: it runs the stages in
 * separate memos so a keystroke re-filters without re-scaling 6,766 rows, and a header click
 * re-sorts without re-filtering them.
 */
export function gearTableRows<T extends GearRow>(
  rows: readonly T[],
  state: ItemUpgradeState,
  opts: { filters: GearFilters; sort?: GearSort; deps?: GearFilterDeps }
): T[] {
  const scaled = scaleAll(rows, state)
  return sortGearRows(filterGearRows(scaled, opts.filters, opts.deps), opts.sort ?? DEFAULT_GEAR_SORT)
}
