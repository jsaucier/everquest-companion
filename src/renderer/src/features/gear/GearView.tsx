// gear/GearView.tsx — THE GEAR TAB (JOS-284, phase 3 of the gear planner).
//
// WHAT IT IS. A searchable, sortable, filterable table over the whole candidate index — 6,766
// equippable items, every one of them described in numbers (`GearRow`, phase 2). SEARCH IS THE
// DEFAULT SURFACE (owner ruling): no set, no plan and no selection is needed to use it. You open
// the tab and you are looking at the corpus.
//
// THE PIPELINE IS THREE MEMOS, IN THIS ORDER, AND THE ORDER IS THE FEATURE:
//
//     scaleAll(rows, plusState)  →  filterGearRows(…)  →  sortGearRows(…)
//
// The global plus-state selector changes what every row IS, so filtering and sorting run on the
// SCALED numbers — ask for "ratio at least 1.0" under a +5 slider and you get the weapons that
// reach 1.0 AT +5, which is the question the control exists to ask. Splitting it into three memos
// is what keeps each keystroke cheap: a search keystroke re-runs the filter and the sort but never
// re-scales 6,766 rows, and a header click re-runs only the sort.
//
// TWO DEFERRALS, ONE LAW. The search box echoes instantly and the FILTER runs on
// `useDeferredValue(text)` — the standing search law, with the lowercase key precomputed once in
// `gearData.toRow`. The plus-state slider obeys the SAME law for the same reason, and the state is
// deferred as a STRING (`"2:3"`) rather than as the `{full, fraction}` object: `useDeferredValue`
// compares by identity, so deferring a fresh object every render would defer nothing at all, and
// deferring the two numbers separately could tear into a combination neither slider was ever in.
// One primitive, parsed back on the other side.
//
// THE LIST IS WINDOWED AND THE BOX IS BOUNDED. `useWindowedRows` keeps the mounted DOM at about a
// screenful whether the filter matches 12 rows or 6,766, and the table lives inside its own
// fixed-height scroller so a growing list never grows the page (the standing UI law).
//
// WHAT IS DELIBERATELY NOT HERE. Ownership — "do I own it", "where is it", "at what plus" — is
// PHASE 4 (JOS-285). The seam is already in place and is the row key: `row.key` is `itemKey(name)`,
// the join key the ownership index (JOS-282) is built on, and it is on every row as
// `data-item-key`. Sets are phase 5. Neither is stubbed here, because a stub is a promise this
// file would then have to keep.

import { type JSX, useDeferredValue, useMemo, useRef, useState } from 'react'
import { Box, Stack, Typography } from '@mui/material'
import type { ItemUpgradeState } from '@shared/itemUpgrade'
import type { GearRow } from '@shared/planner/gear'
import { useWindowedRows } from '../../lib/useWindowedRows'
import GearFilterBar from './GearFilterBar'
import GearTable, { ROW_HEIGHT } from './GearTable'
import { visibleColumns, type GearColumn } from './gearColumns'
import { useEraHidden, useGearClasses, useGearIndex, useUpgradeState } from './gearData'
import {
  DEFAULT_GEAR_FILTERS,
  DEFAULT_GEAR_SORT,
  filterGearRows,
  scaleAll,
  sortGearRows,
  type GearFilters,
  type GearSort,
  type GearSortKey
} from './gearFilter'

/** The plus-state as one primitive, so `useDeferredValue` has something it can actually compare. */
function stateKey(state: ItemUpgradeState): string {
  return `${String(state.full)}:${String(state.fraction)}`
}

function parseStateKey(key: string): ItemUpgradeState {
  const [full, fraction] = key.split(':')
  return { full: Number(full), fraction: Number(fraction) }
}

/** Flip the direction when the same column is clicked again; a new column opens on its natural end. */
function nextSort(sort: GearSort, key: GearSortKey): GearSort {
  if (sort.key === key) return { key, dir: sort.dir === 'desc' ? 'asc' : 'desc' }
  // Names read A→Z; every number reads best-first, which for WEIGHT and DELAY is still "most" —
  // this table states what an item HAS, and inverting two columns' defaults would be a preference
  // the user can express in one click anyway.
  return { key, dir: key === 'name' ? 'asc' : 'desc' }
}

interface TableState {
  rows: GearRow[]
  columns: GearColumn[]
  /** how many rows the era filter alone is holding back — only computed when the table is EMPTY */
  hiddenByEra: number
}

/**
 * The three stages, as three memos (see the header). Split out of the component so the view stays
 * inside the function-length ceiling and so the ORDER is readable in one place.
 */
function useTableRows(
  rows: readonly GearRow[],
  state: ItemUpgradeState,
  filters: GearFilters,
  sort: GearSort
): TableState {
  const deps = useEraHidden()
  const scaled = useMemo(() => scaleAll(rows, state), [rows, state])
  const filtered = useMemo(() => filterGearRows(scaled, filters, deps), [scaled, filters, deps])
  const sorted = useMemo(() => sortGearRows(filtered, sort), [filtered, sort])
  const columns = useMemo(() => visibleColumns(filters, sort), [filters, sort])
  // WHY THE LIST IS EMPTY, when it is (the JOS-67 law: a filter that can hide everything must be
  // able to admit it). The era filter is the one that is on by DEFAULT rather than by choice, and
  // it is the one that can quietly hold back a real answer. Costs one extra pass, at the moment
  // there is nothing else to draw.
  const hiddenByEra = useMemo(
    () =>
      sorted.length > 0 || !filters.eraOnly
        ? 0
        : filterGearRows(scaled, { ...filters, eraOnly: false }, deps).length,
    [sorted.length, scaled, filters, deps]
  )
  return { rows: sorted, columns, hiddenByEra }
}

/** The one sentence an empty table says, naming the filter responsible when there is one. */
function emptyText(ready: boolean, refused: boolean, hiddenByEra: number): string {
  if (refused) return 'This build cannot read the gear index it was served - it states a newer version.'
  if (!ready) return 'Reading the item database…'
  if (hiddenByEra > 0) {
    return `No gear matches these filters - but ${String(hiddenByEra)} items are hidden by the Current era toggle above.`
  }
  return 'No gear matches these filters.'
}

export interface GearViewProps {
  /**
   * Deep-link an item name into the Loot tab's drill-down (App's `openLoot`) — where the ItemWindow
   * already draws the per-item tier block. That is the per-item half of the upgrade sim: the table
   * answers "what does the whole corpus read at +N", the drill answers "and what about this one".
   */
  onOpenLoot?: (item: string) => void
}

export default function GearView({ onOpenLoot }: GearViewProps = {}): JSX.Element {
  const { rows, ready, refused, scrapedAt } = useGearIndex()
  const classes = useGearClasses()
  const upgrade = useUpgradeState()
  const [own, setOwn] = useState<GearFilters>(DEFAULT_GEAR_FILTERS)
  const [text, setText] = useState('')
  const [sort, setSort] = useState<GearSort>(DEFAULT_GEAR_SORT)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Both deferrals, and nothing else deferred: the two controls whose every movement re-derives
  // six thousand rows (see the header).
  const deferredText = useDeferredValue(text)
  const deferredState = useDeferredValue(stateKey(upgrade.state))
  const state = useMemo(() => parseStateKey(deferredState), [deferredState])

  // The class trio lives in its own hook (it FOLLOWS detection until pinned), so it is merged in
  // here rather than stored twice — one answer to "which classes", however it was arrived at.
  const filters = useMemo(
    () => ({ ...own, text: deferredText, classes: classes.classes }),
    [own, deferredText, classes.classes]
  )
  const table = useTableRows(rows, state, filters, sort)
  const win = useWindowedRows({ count: table.rows.length, rowHeight: ROW_HEIGHT, scrollRef })

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }} data-testid="gear-view">
      <GearFilterBar
        filters={filters}
        setFilters={setOwn}
        text={text}
        setText={setText}
        classes={classes}
        upgrade={upgrade}
      />

      <Stack direction="row" spacing={1} alignItems="baseline" sx={{ mb: 0.5, flexShrink: 0 }}>
        <Typography variant="caption" color="text.secondary" data-testid="gear-count">
          {table.rows.length.toLocaleString()} of {rows.length.toLocaleString()} items
        </Typography>
        {/* WHEN the data is from, never when the index was built — the corpus's own `scrapedAt`. */}
        {scrapedAt !== null && (
          <Typography variant="caption" color="text.secondary">
            · wiki data from {scrapedAt.slice(0, 10)}
          </Typography>
        )}
      </Stack>

      <Box
        ref={scrollRef}
        data-testid="gear-list"
        sx={{ flexGrow: 1, minHeight: 0, overflow: 'auto', border: 1, borderColor: 'divider', borderRadius: 1 }}
      >
        <GearTable
          rows={table.rows}
          columns={table.columns}
          win={win}
          sort={sort}
          classes={classes.classes}
          onSort={(key) => setSort((prev) => nextSort(prev, key))}
          onOpenLoot={onOpenLoot}
        />
        {table.rows.length === 0 && (
          <Typography variant="body2" color="text.secondary" data-testid="gear-empty" sx={{ p: 2 }}>
            {emptyText(ready, refused, table.hiddenByEra)}
          </Typography>
        )}
      </Box>
    </Box>
  )
}
