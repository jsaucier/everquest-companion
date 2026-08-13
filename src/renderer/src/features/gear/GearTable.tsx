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

import { type JSX, memo } from 'react'
import { Stack, Table, TableBody, TableCell, TableHead, TableRow, TableSortLabel } from '@mui/material'
import type { GearRow } from '@shared/planner/gear'
import type { WindowedRows } from '../../lib/useWindowedRows'
import { EraChip, DonorName, MismatchChip } from '../planner/PlannerChips'
import {
  CLASS_COLUMN_WIDTH,
  OWNED_COLUMN_WIDTH,
  SLOT_COLUMN_WIDTH,
  numericWidth,
  statText,
  type GearColumn
} from './gearColumns'
import { classMismatch, sortValue, type GearSort, type GearSortKey } from './gearFilter'
import { ownedCellText, ownedCellTitle, ownershipFor, type GearOwnershipMap } from './gearOwnership'
import type { ClassAbbr } from '@shared/classCombo'

/** Dense row height (px), MUI `size="small"` — the number the windowing hook is handed. */
export const ROW_HEIGHT = 37

const FIXED_TABLE = { tableLayout: 'fixed' } as const

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
  /** the class filter the mismatch chip is measured against — never enforced, only pointed at */
  classes: readonly ClassAbbr[]
  /**
   * The ownership join (JOS-285), keyed by `row.key` — `null` when this character has never
   * written a dump, which removes the column entirely rather than drawing a blank one
   * (gearColumns.ts states why).
   */
  ownership: GearOwnershipMap | null
  /** the Owned header's own explanation, including the uncounted-keyring note when there is one */
  ownedHint: string
  onSort: (key: GearSortKey) => void
  /** deep-link an item into the Loot tab's drill-down, where the ItemWindow draws its tier block */
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
  classes,
  ownership,
  onOpenLoot
}: {
  row: GearRow
  columns: readonly GearColumn[]
  classes: readonly ClassAbbr[]
  ownership: GearOwnershipMap | null
  onOpenLoot?: (item: string) => void
}): JSX.Element {
  const mismatch = classMismatch(row.classes, classes)
  // ONE MAP LOOKUP PER RENDERED ROW, and only for the screenful the window mounted. `row.key` is
  // already the ownership key — phase 3's seam — so there is nothing to normalise here.
  const owned = ownership === null ? null : ownershipFor(ownership, row)
  return (
    <TableRow hover data-testid="gear-row" data-item-key={row.key} sx={FIXED_ROW}>
      <TableCell>
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexWrap: 'nowrap', minWidth: 0 }}>
          <DonorName name={row.name} onOpen={onOpenLoot} />
          {/* The two chips a gear row can wear, both of them POINTERS rather than verdicts: the
              era join's (out of era / era?) and the class filter's. A mismatch is chipped, never
              removed — the trio is a filter and never a rule (V2, plannerClasses.ts). */}
          <EraChip subject={row} />
          {mismatch && <MismatchChip classes={row.classes} />}
        </Stack>
      </TableCell>
      <TableCell title={row.slots.join(' ')}>{row.slots.join(' ')}</TableCell>
      <TableCell title={row.classes.join(' ')}>{classText(row.classes)}</TableCell>
      {columns.map((c) => (
        <TableCell key={c.key} align="right" data-testid={`gear-cell-${c.key}`}>
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
    <TableCell align={align} sx={width === undefined ? undefined : { width }}>
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
  classes,
  ownership,
  ownedHint,
  onSort,
  onOpenLoot
}: GearTableProps): JSX.Element {
  const span = columns.length + (ownership === null ? 3 : 4)
  const width = numericWidth(columns.length)
  return (
    <Table size="small" stickyHeader sx={FIXED_TABLE}>
      <TableHead>
        <TableRow>
          {/* No width: the item NAME takes whatever the stated columns leave (LootTables.tsx). */}
          <SortHeader column={{ key: 'name', label: 'Item' }} sort={sort} onSort={onSort} />
          <TableCell sx={{ width: SLOT_COLUMN_WIDTH }}>Slot</TableCell>
          <TableCell sx={{ width: CLASS_COLUMN_WIDTH }}>Classes</TableCell>
          {columns.map((c) => (
            <SortHeader key={c.key} column={c} sort={sort} width={width} align="right" onSort={onSort} />
          ))}
          {/* The one column that is not a number and not sortable: it reports a live file, and the
              header carries the two things a reader has to know about it — that a `+N` is its own
              copy, and which key rings the fold left out. */}
          {ownership !== null && (
            <TableCell sx={{ width: OWNED_COLUMN_WIDTH }} title={ownedHint} data-testid="gear-owned-header">
              Owned
            </TableCell>
          )}
        </TableRow>
      </TableHead>
      <TableBody>
        <PadRow height={win.topPad} colSpan={span} />
        {rows.slice(win.start, win.end).map((row) => (
          <GearLine
            key={row.key}
            row={row}
            columns={columns}
            classes={classes}
            ownership={ownership}
            onOpenLoot={onOpenLoot}
          />
        ))}
        <PadRow height={win.bottomPad} colSpan={span} />
      </TableBody>
    </Table>
  )
}
