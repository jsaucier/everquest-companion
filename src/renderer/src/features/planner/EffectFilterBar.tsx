// planner/EffectFilterBar.tsx — the Effects browser's one toolbar row.
//
// Split out of `EffectBrowser.tsx` when the non-equippable toggle pushed that file past the
// measured 400-code-line ceiling (2026-08-04), and this is the seam the ceiling was pointing at:
// the browser is a windowed LIST, the bar is a set of independent CONTROLS, and they share nothing
// but the filter object they read and write. No behaviour changed in the move.
//
// ONE NOWRAP ROW (the flexWrap law): every control keeps its size and the search box is the only
// thing allowed to shrink — a bar that wraps turns a toolbar into a growing block and pushes the
// list it filters off the bottom of the pane.
//
// FIVE CONTROLS, TWO KINDS. Socket type / search / slot are this mount's own state; "Usable by this
// set" reads the plan. "Current era", "Non-equippable" and "Group by" are the PERSISTED set
// (`eq.planner.*`), handed in as their `useState`-shaped tuples so this file owns none of that
// storage — see plannerData for what each one means and why the two toggles' defaults are opposites.
//
// …AND ONE LEADING CHIP THAT NAMES THE ITEM (JOS-210). It is one control in two states: nothing
// picked, so it offers to pick; or an item picked, so it says which and can be cleared. Whether the
// item arrived from the Inventory tab (a `BrowsePreset`, which also names the cell and forces the
// socket) or was typed into its picker, one chip is what the row spends on it — and the SOCKET TABS
// no longer clear it, because "show me this item's worn effects instead of its procs" is one
// question, not two (the bug half of JOS-210: every filter-bar write used to hand the browser back).
//
// GROUP BY offers only the axes its socket tab can serve (`plannerGroups.axesFor` — "Focus family"
// exists on the Focus tab and nowhere else), so the control can never ask for a fold the model
// would answer with one header.
//
// AND NO POPPER (JOS-143). The three toggle chips sit immediately right of the Slot and Group by
// selects on a NOWRAP row, and their hints are sentences — a popper is centred on its anchor, so a
// card wide enough to hold "Hide donors from outside <era>" reaches back across the select beside
// it and, being interactive by default, eats the click aimed at that select. The hints are native
// `title`s now: same words, no DOM node, no hit area.

import { type JSX, useState } from 'react'
import { Chip, MenuItem, Stack, TextField, ToggleButton, ToggleButtonGroup } from '@mui/material'
import { EQUIP_SLOTS, planSlotLabel, type EquipSlot, type SocketType } from '@shared/planner/types'
import ItemFilterPicker from './ItemFilterPicker'
import { CURRENT_ERA_LABEL, type DonorFilters } from './plannerData'
import { AXIS_LABEL, SOCKET_LABEL, axesFor, type GroupAxis } from './plannerGroups'
import type { ItemFocus } from './plannerPreset'

/** The socket tabs, in the order the planner leads with (proc first — see DEFAULT_FILTERS). */
const SOCKETS: SocketType[] = ['proc', 'worn', 'focus', 'click']

/**
 * The bar's ON/OFF idiom: one chip, lit when the filter is on, and hover text that says what it
 * hides and what it deliberately keeps. Three of them read identically because they ARE identical
 * — the differences worth seeing are in the words, not in the markup.
 */
function ToggleChip({
  label,
  hint,
  on,
  onToggle,
  testId
}: {
  label: string
  hint: string
  on: boolean
  onToggle: () => void
  testId?: string
}): JSX.Element {
  return (
    <Chip
      size="small"
      label={label}
      data-testid={testId}
      title={hint}
      color={on ? 'primary' : 'default'}
      variant={on ? 'filled' : 'outlined'}
      onClick={onToggle}
      sx={{ flexShrink: 0 }}
    />
  )
}

/**
 * THE ITEM CHIP (V8's preset chip, generalised by JOS-210) — ONE control in two states.
 *
 * EMPTY, it offers the second door into the browser: pick any item the DB carries and see what can
 * go in it. FILLED, it is the browser's honesty about what it is narrowed to — and when the item
 * arrived from the Inventory tab it names the CELL and the SOCKET too, because the tabs and the
 * slot select beside it are then showing values the user did not choose.
 *
 * `planSlotLabel`, never the raw key: the chip is what the user reads back, and the keys are not
 * words ("FINGER2", "ANY1"). One spelling of a cell, everywhere.
 *
 * The X clears the narrowing; clicking the chip itself re-opens the picker, so swapping which item
 * you are filling costs one click rather than a clear and a re-open.
 */
function ItemChip({
  focus,
  socket,
  onOpen,
  onClear
}: {
  focus: ItemFocus | null
  /** the kind tab in force — the preset's socket MOVES with it now (JOS-210) */
  socket: SocketType
  onOpen: (anchor: HTMLElement) => void
  onClear: () => void
}): JSX.Element {
  if (focus === null) {
    return (
      <Chip
        size="small"
        variant="outlined"
        label="For an item…"
        data-testid="planner-item-filter"
        title="Narrow the list to effects that can be socketed into one item"
        onClick={(e) => onOpen(e.currentTarget)}
        sx={{ flexShrink: 0 }}
      />
    )
  }
  const fromCell = focus.cell !== undefined
  return (
    <Chip
      size="small"
      color="primary"
      label={
        focus.cell === undefined
          ? focus.name
          : `${planSlotLabel(focus.cell)} · ${SOCKET_LABEL[socket]} · ${focus.name}`
      }
      data-testid={fromCell ? 'planner-preset-chip' : 'planner-item-chip'}
      title={
        focus.slots.length === 0
          ? `Showing effects compatible with ${focus.name}`
          : `Showing effects that can be socketed into ${focus.name} (${focus.slots.join(' ')})`
      }
      onClick={(e) => onOpen(e.currentTarget)}
      onDelete={onClear}
      sx={{ flexShrink: 0, maxWidth: 260 }}
    />
  )
}

/**
 * The chip plus the picker it opens — one control, and the only state the bar itself owns (which
 * element the popover is anchored to). Kept together so the bar's own body stays a list of
 * controls rather than a control with a popover hanging off it.
 */
function ItemNarrowing({
  focus,
  socket,
  setFocus
}: {
  focus: ItemFocus | null
  socket: SocketType
  setFocus?: (f: ItemFocus | null) => void
}): JSX.Element {
  const [picking, setPicking] = useState<HTMLElement | null>(null)
  return (
    <>
      <ItemChip focus={focus} socket={socket} onOpen={setPicking} onClear={() => setFocus?.(null)} />
      <ItemFilterPicker
        anchor={picking}
        onClose={() => setPicking(null)}
        onPick={(hit) => {
          setFocus?.({ key: hit.key, name: hit.name, slots: hit.slots, classes: hit.classes })
          setPicking(null)
        }}
      />
    </>
  )
}

export interface EffectFilterBarProps {
  filters: DonorFilters
  /** every control BUT the socket tabs — a write here hands the browser back (see `setSocket`) */
  setFilters: (f: DonorFilters) => void
  /** the kind tabs, which KEEP the item filter and move the preset's socket with them (JOS-210) */
  setSocket: (s: SocketType) => void
  /** the RAW search text (the browser defers it before filtering — the standing search law) */
  text: string
  setText: (v: string) => void
  era: [boolean, (v: boolean) => void]
  nonEquip: [boolean, (v: boolean) => void]
  groupBy: [GroupAxis, (v: GroupAxis) => void]
  /** the item the browser is narrowed to, from either door, or null */
  focus?: ItemFocus | null
  /** pick one by hand, or clear whatever is there (`null`) */
  setFocus?: (f: ItemFocus | null) => void
}

export default function EffectFilterBar({
  filters,
  setFilters,
  setSocket,
  text,
  setText,
  era,
  nonEquip,
  groupBy,
  focus = null,
  setFocus
}: EffectFilterBarProps): JSX.Element {
  const [eraOnly, setEraOnly] = era
  const [showNonEquip, setShowNonEquip] = nonEquip
  const [axis, setAxis] = groupBy
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'nowrap', mb: 1 }}>
      <ItemNarrowing focus={focus} socket={filters.socket} setFocus={setFocus} />
      <ToggleButtonGroup
        exclusive
        size="small"
        value={filters.socket}
        onChange={(_e, v: SocketType | null) => {
          if (v !== null) setSocket(v)
        }}
        sx={{ flexShrink: 0 }}
      >
        {SOCKETS.map((s) => (
          <ToggleButton key={s} value={s} data-testid={`planner-socket-${s}`} sx={{ px: 1.5 }}>
            {SOCKET_LABEL[s]}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      <TextField
        size="small"
        label="Search effect or item"
        value={text}
        onChange={(e) => setText(e.target.value)}
        sx={{ minWidth: 140, flexShrink: 1 }}
      />

      <TextField
        select
        size="small"
        label="Slot"
        value={filters.slot ?? 'ALL'}
        onChange={(e) => setFilters({ ...filters, slot: e.target.value === 'ALL' ? null : (e.target.value as EquipSlot) })}
        sx={{ minWidth: 130, flexShrink: 0 }}
      >
        {/* "All slots", not "Any slot" — since JOS-104 an ANY SLOT is a REAL place on the board,
            and a filter option reading "Any slot" beside two cells called ANY SLOT 1 and 2 would
            read as a filter FOR them. This one has always meant "do not filter by slot". */}
        <MenuItem value="ALL">All slots</MenuItem>
        {EQUIP_SLOTS.map((s) => (
          <MenuItem key={s} value={s}>
            {s}
          </MenuItem>
        ))}
      </TextField>

      <TextField
        select
        size="small"
        label="Group by"
        data-testid="planner-groupby"
        value={axis}
        onChange={(e) => setAxis(e.target.value as GroupAxis)}
        sx={{ minWidth: 130, flexShrink: 0 }}
      >
        {axesFor(filters.socket).map((a) => (
          <MenuItem key={a} value={a} data-testid={`planner-groupby-${a}`}>
            {AXIS_LABEL[a]}
          </MenuItem>
        ))}
      </TextField>

      <ToggleChip
        label="Usable by this set"
        on={filters.trioOnly}
        onToggle={() => setFilters({ ...filters, trioOnly: !filters.trioOnly })}
        hint="Hide donors no class in this set can use"
      />

      <ToggleChip
        label="Current era"
        testId="planner-era-toggle"
        on={eraOnly}
        onToggle={() => setEraOnly(!eraOnly)}
        hint={`Hide donors from outside ${CURRENT_ERA_LABEL}`}
      />

      <ToggleChip
        label="Non-equippable"
        testId="planner-nonequip-toggle"
        on={showNonEquip}
        onToggle={() => setShowNonEquip(!showNonEquip)}
        hint="Show items whose page states no equipment slot"
      />
    </Stack>
  )
}
