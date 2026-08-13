// gear/GearTable.tsx — the windowed table: one uniform row per candidate item.
//
// THE FIXED-HEIGHT CONTRACT (JOS-260, lootRows.tsx states the full argument). `useWindowedRows` is
// a FIXED-row-height hook: every spacer, index and scroll offset it computes assumes each row is
// exactly `ROW_HEIGHT`, so a row that wraps to two lines desyncs the whole window and the drift
// compounds with every row above the viewport. `height` alone is only a MINIMUM for a table row,
// so the row states a maximum too and every cell is one clipped, ellipsised line — and the table
// is `tableLayout: fixed` with PERCENTAGE widths, so the columns are taken from the header alone
// (a windowed table can only ever SEE a screenful, and an auto layout would re-measure its columns
// every time scrolling swapped the rows underneath).
//
// A ROW'S KEY IS `row.key` — `itemKey(name)`, the corpus join key every other index in this app
// uses (loot, ownership, donors). That is deliberate and load-bearing beyond React, and phase 4
// (JOS-285) is what it was for: the OWNED column appends after `visibleColumns`' numerics and its
// cell is one `Map.get(row.key)` — no name matching, no normalising, nothing per row but a lookup.
// The words in that cell are all decided in `gearOwnership.ts`, which is pure and node-tested; the
// only judgement made HERE is that no witness at all means no column, because a blank ownership
// cell and "you do not own this" are two different statements and the app cannot tell them apart.
//
// NO MUI TOOLTIP ANYWHERE (JOS-143). These are dense rows under a toolbar full of selects and a
// slider; an interactive popper opened from the first row lands on those controls and eats the
// clicks aimed at them. Every explanation is a native `title`.
//
// AND SINCE JOS-297 THE COLUMN SET CAN BE WIDER THAN THE PANE. Nothing above changes: the table is
// still `tableLayout: fixed`, the row is still exactly `ROW_HEIGHT` tall with one clipped line per
// cell, and the windowing hook's contract does not know that widths exist. What changes is where
// the widths come from — `gearTableLayout` states percentages while they fit and stated pixels plus
// a table `minWidth` once they do not, so a thirty-column set overflows the table's OWN scroller
// (GearView's `gear-list` box, already `overflow: auto`) and never the page. Both halves are
// measured in `tests/e2e/gearColumnSteps.mts`, container-scroll and page-no-scroll in one step.

import { type JSX, memo, useMemo } from 'react'
import { Stack, Table, TableBody, TableCell, TableHead, TableRow, TableSortLabel } from '@mui/material'
import type { GearRow } from '@shared/planner/gear'
import type { WindowedRows } from '../../lib/useWindowedRows'
import { EraChip, DonorName } from '../planner/PlannerChips'
import { gearTableLayout, statText, type GearColumn } from './gearColumns'
import { sortValue, type GearSort, type GearSortKey } from './gearFilter'
import { ownedCellText, ownedCellTitle, ownershipFor, type GearOwnershipMap } from './gearOwnership'
import type { ClassAbbr } from '@shared/classCombo'

/** Dense row height (px), MUI `size="small"` — the number the windowing hook is handed. */
export const ROW_HEIGHT = 37

const FIXED_ROW = {
  height: ROW_HEIGHT,
  maxHeight: ROW_HEIGHT,
  '& td': {
    py: 0,
    maxHeight: ROW_HEIGHT,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  }
} as const

/**
 * The numeric columns' halved side padding — the other half of `MAX_NUMERIC_WIDTH`'s bargain
 * (gearColumns.ts). The ceiling only holds if a sortable header (label + arrow, ~60px for
 * `Ratio`) fits the cell it states: a label wider than its sticky cell slides under the NEXT
 * header, which then intercepts the click aimed at it — gear.e2e.mts measured exactly that.
 * MUI's default 16px a side spends 32px of a ~60px cell on air; 8px keeps the header its own.
 */
const NUMERIC_PAD = { px: 1 } as const

/** Sixteen classes is `Class: ALL`, and sixteen chips would be the widest cell in the table. */
function classText(classes: readonly ClassAbbr[]): string {
  if (classes.length === 0) return ''
  if (classes.length >= 16) return 'ALL'
  return classes.join(' ')
}

export interface GearTableProps {
  rows: readonly GearRow[]
  columns: readonly GearColumn[]
  win: WindowedRows
  sort: GearSort
  /**
   * The ownership join (JOS-285), keyed by `row.key` — `null` when this character has never
   * written a dump, which removes the column entirely rather than drawing a blank one
   * (gearColumns.ts states why).
   */
  ownership: GearOwnershipMap | null
  /** the Owned header's own explanation, including the uncounted-keyring note when there is one */
  ownedHint: string
  onSort: (key: GearSortKey) => void
  /**
   * Deep-link an item into the Loot tab's drill-down, where the ItemWindow draws its tier block.
   *
   * THE ONLY PER-ROW ACTION THIS TABLE HAS, since JOS-325. There was a second — `onAssign`, the `+`
   * that dropped a search row into the selected gear set (JOS-286) — and it went with the sets
   * surface the owner retired: no pane, no set to add to, nothing for the button to mean. The
   * argument it used to carry (absent beats disabled, because a button that does nothing is a worse
   * answer than no button) survives it as a general rule, and this prop is now the whole of its
   * application here: a host that has nowhere to send the click passes nothing, and `DonorName`
   * draws plain text rather than a link that goes nowhere.
   */
  onOpenLoot?: (item: string) => void
}

/** The spacer rows that reserve the full scroll height — see useWindowedRows. */
function PadRow({ height, colSpan }: { height: number; colSpan: number }): JSX.Element | null {
  if (height <= 0) return null
  return (
    <TableRow style={{ height }}>
      <TableCell colSpan={colSpan} sx={{ p: 0, border: 0 }} />
    </TableRow>
  )
}

/**
 * ONE CANDIDATE. Every number on it is the SCALED one — the row this component is handed has
 * already been through `scaleAll` at the table's plus-state, so nothing here knows the simulation
 * exists. `memo` because a slider drag re-renders the table and most visible rows are unchanged
 * objects when only the sort moved.
 */
const GearLine = memo(function GearLine({
  row,
  columns,
  ownership,
  on
}: {
  row: GearRow
  columns: readonly GearColumn[]
  ownership: GearOwnershipMap | null
  on: { openLoot?: (item: string) => void }
}): JSX.Element {
  // ONE MAP LOOKUP PER RENDERED ROW, and only for the screenful the window mounted. `row.key` is
  // already the ownership key — phase 3's seam — so there is nothing to normalise here.
  const owned = ownership === null ? null : ownershipFor(ownership, row)
  return (
    <TableRow hover data-testid="gear-row" data-item-key={row.key} sx={FIXED_ROW}>
      <TableCell>
        {/* THE `+` IS GONE FROM THIS CELL (JOS-325). It put the row into the selected gear set, and
            the sets are retired — see `GearTableProps.onOpenLoot`. The `Stack` stays because the
            name still shares the cell with the era chip, and the FIXED_ROW contract above is what
            makes that one clipped line rather than two. */}
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexWrap: 'nowrap', minWidth: 0 }}>
          <DonorName name={row.name} onOpen={on.openLoot} />
          {/* THE ONE CHIP A SEARCH ROW WEARS, and it is a POINTER rather than a verdict: the era
              join's (out of era / era?), which explains a row you can SEE.

              THE CLASS MISMATCH CHIP IS GONE FROM THIS TABLE (owner ruling 2026-08-13, JOS-302:
              *obviously wrong, it should just be removed*). A row this character's classes cannot
              use is no longer chipped here — it is not here at all, because `filterGearRows` now
              removes it (gearFilter.ts `GearFilters.classes` carries the full argument, including
              why the planner build pane's own mismatch chip stays exactly where it is). A chip that
              can only ever appear on a row the filter already removed would be dead code pretending
              to be a law. */}
          <EraChip subject={row} />
        </Stack>
      </TableCell>
      <TableCell title={row.slots.join(' ')}>{row.slots.join(' ')}</TableCell>
      <TableCell title={row.classes.join(' ')}>{classText(row.classes)}</TableCell>
      {columns.map((c) => (
        <TableCell key={c.key} align="right" data-testid={`gear-cell-${c.key}`} sx={NUMERIC_PAD}>
          {statText(sortValue(row, c.key), c.key)}
        </TableCell>
      ))}
      {owned !== null && (
        <TableCell data-testid="gear-cell-owned" title={ownedCellTitle(owned)}>
          {ownedCellText(owned)}
        </TableCell>
      )}
    </TableRow>
  )
})

/** One sortable header cell — clicking it sorts by that column, clicking again flips direction. */
function SortHeader({
  column,
  sort,
  width,
  align,
  onSort
}: {
  column: { key: GearSortKey; label: string }
  sort: GearSort
  width?: string
  align?: 'right'
  onSort: (key: GearSortKey) => void
}): JSX.Element {
  const active = sort.key === column.key
  return (
    <TableCell align={align} sx={{ ...(width === undefined ? {} : { width }), ...(align === 'right' ? NUMERIC_PAD : {}) }}>
      <TableSortLabel
        active={active}
        direction={active ? sort.dir : 'desc'}
        data-testid={`gear-sort-${column.key}`}
        onClick={() => onSort(column.key)}
      >
        {column.label}
      </TableSortLabel>
    </TableCell>
  )
}

export default function GearTable({
  rows,
  columns,
  win,
  sort,
  ownership,
  ownedHint,
  onSort,
  onOpenLoot
}: GearTableProps): JSX.Element {
  const span = columns.length + (ownership === null ? 3 : 4)
  const layout = gearTableLayout(columns.length, ownership !== null)
  // ONE object for the row's callbacks, memoized on the callbacks themselves: `GearLine` is
  // `memo`'d and a fresh literal per render would defeat it on every keystroke. It held two until
  // JOS-325 retired the `+`; it stays an object because the wrapper is what the memo depends on.
  const handlers = useMemo(() => ({ openLoot: onOpenLoot }), [onOpenLoot])
  return (
    <Table
      size="small"
      stickyHeader
      data-testid="gear-table"
      data-layout={layout.mode}
      // `minWidth`, never `width`: a pane wider than the set still fills it, a narrower one scrolls
      // the table sideways inside its own box. 0 in percentage mode means the table IS the pane.
      sx={{ tableLayout: 'fixed', minWidth: layout.minWidth === 0 ? undefined : layout.minWidth }}
    >
      <TableHead>
        <TableRow>
          {/* In percentage mode the item NAME states no width and takes whatever the stated columns
              leave (LootTables.tsx); in pixel mode every column is stated, because the SUM is what
              makes the table wider than the pane. */}
          <SortHeader column={{ key: 'name', label: 'Item' }} sort={sort} width={layout.name} onSort={onSort} />
          <TableCell sx={{ width: layout.slot }}>Slot</TableCell>
          <TableCell sx={{ width: layout.classes }}>Classes</TableCell>
          {columns.map((c) => (
            <SortHeader key={c.key} column={c} sort={sort} width={layout.numeric} align="right" onSort={onSort} />
          ))}
          {/* The one column that is not a number and not sortable: it reports a live file, and the
              header carries the two things a reader has to know about it — that a `+N` is its own
              copy, and which key rings the fold left out. It stays LAST whatever the picker shows
              (JOS-297): the numerics are what an item reads, this is what you have. */}
          {ownership !== null && (
            <TableCell sx={{ width: layout.owned }} title={ownedHint} data-testid="gear-owned-header">
              Owned
            </TableCell>
          )}
        </TableRow>
      </TableHead>
      <TableBody>
        <PadRow height={win.topPad} colSpan={span} />
        {rows.slice(win.start, win.end).map((row) => (
          <GearLine key={row.key} row={row} columns={columns} ownership={ownership} on={handlers} />
        ))}
        <PadRow height={win.bottomPad} colSpan={span} />
      </TableBody>
    </Table>
  )
}
