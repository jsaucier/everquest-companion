// gear/GearFilterBar.tsx — the Gear tab's two toolbar rows.
//
// TWO ROWS, EACH `nowrap`, AND THAT IS THE flexWrap LAW rather than a layout preference: wrapping
// converts content overflow into HEIGHT, so a bar that wraps turns a toolbar into a growing block
// and pushes the table it filters off the bottom of the pane. Two DELIBERATE rows is not wrapping
// — it is a stated shape, and each of them holds controls that never shrink beside exactly one
// thing that may (the search box on the first, the threshold chips on the second).
//
// THE SPLIT IS BY QUESTION, not by fit. The first row asks WHICH ITEMS — name, slot, classes,
// effect kind, era. The second asks WHAT THEY READ — the plus-state being simulated, the weapon
// ratio floor, and the stat thresholds. That is also the order the two get used in: you narrow to
// a slot and then you ask what the good ones have.
//
// NO POPPER ON ANY OF IT (JOS-143). The hints are native `title`s: these controls sit directly
// above a dense windowed table, and an interactive MUI Tooltip opened from a chip up here lands on
// the header row and eats the sort click aimed at it.
//
// THE CLASS FILTER IS A FILTER AND NEVER A RULE (V2, plannerClasses.ts). It shows what the app
// currently infers you are running; touching it PINS your choice, and detection may then only
// OFFER — the "detected: …" chip, one click and reversible. A row outside the filter is hidden
// only while "Usable by these" is on, and a row shown anyway is chipped rather than removed.

import { type JSX, useState } from 'react'
import { Chip, MenuItem, Stack, TextField } from '@mui/material'
import { CLASS_ABBRS } from '@shared/classCombo'
import type { ItemUpgradeState } from '@shared/itemUpgrade'
import { EQUIP_SLOTS, type EquipSlot } from '@shared/planner/types'
import ChipMultiSelect from '../../components/ChipMultiSelect'
import { CURRENT_ERA_LABEL } from '../planner/plannerData'
import { SOCKET_LABEL } from '../planner/plannerGroups'
import UpgradeSlider from './UpgradeSlider'
import {
  parseThreshold,
  thresholdLabel,
  withThreshold,
  type EffectFilter,
  type GearFilters
} from './gearFilter'
import type { GearClasses } from './gearData'

/** The effect select's options, in the donor vocabulary plus the two a socket cannot express. */
const EFFECT_OPTIONS: { value: EffectFilter; label: string }[] = [
  { value: 'any', label: 'Any effect' },
  { value: 'has', label: 'Has an effect' },
  { value: 'proc', label: SOCKET_LABEL.proc },
  { value: 'worn', label: SOCKET_LABEL.worn },
  { value: 'focus', label: SOCKET_LABEL.focus },
  { value: 'click', label: SOCKET_LABEL.click }
]

/** The bar's ON/OFF idiom, lifted verbatim from EffectFilterBar: one chip, lit when the filter is on. */
function ToggleChip({
  label,
  hint,
  on,
  testId,
  onToggle
}: {
  label: string
  hint: string
  on: boolean
  testId: string
  onToggle: () => void
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
 * THE THRESHOLD INPUT — one text box that speaks the stat vocabulary. `hp 50`, `sv magic >= 20`,
 * `mana regen 3`. It commits on Enter and REFUSES anything that does not fold to an indexed column
 * (`parseThreshold`), because a typo must add no chip rather than a chip filtering on something
 * else; the box turns red and keeps the text, so the fix is one keystroke rather than a re-type.
 */
function ThresholdInput({ filters, onChange }: { filters: GearFilters; onChange: (f: GearFilters) => void }): JSX.Element {
  const [text, setText] = useState('')
  const [bad, setBad] = useState(false)
  const commit = (): void => {
    const parsed = parseThreshold(text)
    if (parsed === null) {
      setBad(text.trim() !== '')
      return
    }
    onChange({ ...filters, thresholds: withThreshold(filters.thresholds, parsed) })
    setText('')
    setBad(false)
  }
  return (
    <TextField
      size="small"
      label="Stat at least"
      placeholder="hp 50"
      value={text}
      error={bad}
      data-testid="gear-threshold-input"
      title="A stat and a minimum - hp 50, sv magic >= 20, mana regen 3. Enter adds it."
      onChange={(e) => {
        setText(e.target.value)
        setBad(false)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
      }}
      sx={{ width: 150, flexShrink: 0 }}
    />
  )
}

/** The committed thresholds, each removable. Their own scroller — wide content never widens a bar. */
function ThresholdChips({ filters, onChange }: { filters: GearFilters; onChange: (f: GearFilters) => void }): JSX.Element {
  return (
    <Stack
      direction="row"
      spacing={0.5}
      alignItems="center"
      sx={{ flexWrap: 'nowrap', overflowX: 'auto', minWidth: 0, flexShrink: 1, py: 0.25 }}
    >
      {filters.thresholds.map((t) => (
        <Chip
          key={t.key}
          size="small"
          color="primary"
          variant="outlined"
          label={thresholdLabel(t)}
          data-testid="gear-threshold-chip"
          title="Only items that STATE this stat at or above the number - an absent stat is not a zero."
          onDelete={() =>
            onChange({ ...filters, thresholds: filters.thresholds.filter((x) => x.key !== t.key) })
          }
          sx={{ flexShrink: 0 }}
        />
      ))}
    </Stack>
  )
}

export interface GearFilterBarProps {
  filters: GearFilters
  setFilters: (f: GearFilters) => void
  /** the RAW search text (the view defers it before filtering — the standing search law) */
  text: string
  setText: (v: string) => void
  classes: GearClasses
  upgrade: { state: ItemUpgradeState; set: (s: ItemUpgradeState) => void }
}

/** WHICH ITEMS: name, slot, classes, effect kind, era. */
function IdentityRow({ filters, setFilters, text, setText, classes }: Omit<GearFilterBarProps, 'upgrade'>): JSX.Element {
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'nowrap' }}>
      <TextField
        size="small"
        label="Search gear"
        value={text}
        data-testid="gear-search"
        onChange={(e) => setText(e.target.value)}
        sx={{ minWidth: 150, flexShrink: 1 }}
      />

      <TextField
        select
        size="small"
        label="Slot"
        value={filters.slot ?? 'ALL'}
        data-testid="gear-slot"
        onChange={(e) => setFilters({ ...filters, slot: e.target.value === 'ALL' ? null : (e.target.value as EquipSlot) })}
        sx={{ minWidth: 120, flexShrink: 0 }}
      >
        <MenuItem value="ALL">All slots</MenuItem>
        {EQUIP_SLOTS.map((s) => (
          <MenuItem key={s} value={s} data-testid={`gear-slot-${s}`}>
            {s}
          </MenuItem>
        ))}
      </TextField>

      <TextField
        select
        size="small"
        label="Effect"
        value={filters.effect}
        data-testid="gear-effect"
        onChange={(e) => setFilters({ ...filters, effect: e.target.value as EffectFilter })}
        sx={{ minWidth: 130, flexShrink: 0 }}
      >
        {EFFECT_OPTIONS.map((o) => (
          <MenuItem key={o.value} value={o.value}>
            {o.label}
          </MenuItem>
        ))}
      </TextField>

      {/* The app's one "pick several from a closed list" control (components/ChipMultiSelect) —
          the same one the Sky tracker and the exaltation board use for exactly this question. */}
      <ChipMultiSelect
        options={CLASS_ABBRS}
        value={classes.classes}
        onChange={classes.set}
        label="Classes"
        placeholder="every class"
        minWidth={190}
        testId="gear-classes"
      />

      <ToggleChip
        label="Usable by these"
        testId="gear-class-toggle"
        on={filters.classOnly}
        onToggle={() => setFilters({ ...filters, classOnly: !filters.classOnly })}
        hint="Hide items no class in the filter can use. An item whose page states no class list is kept."
      />

      <ToggleChip
        label="Current era"
        testId="gear-era-toggle"
        on={filters.eraOnly}
        onToggle={() => setFilters({ ...filters, eraOnly: !filters.eraOnly })}
        hint={`Hide items from outside ${CURRENT_ERA_LABEL}`}
      />

      {/* THE OWNER'S CHECKBOX (JOS-285). It belongs on the WHICH ITEMS row, beside era and class:
          all three ask who a row is, none of them asks what it reads. The hint states both
          witnesses and the one thing a player would otherwise have to guess — that "not counted"
          key rings exist; which ones, over their own dump, is on the Owned column's header. */}
      <ToggleChip
        label="Owned or looted"
        testId="gear-owned-toggle"
        on={filters.ownedOnly}
        onToggle={() => setFilters({ ...filters, ownedOnly: !filters.ownedOnly })}
        hint="Keep only what your newest /outputfile inventory dump names or your loot history saw. Some key rings are not counted - see the Owned column."
      />

      {classes.offer !== null && (
        <Chip
          size="small"
          color="warning"
          variant="outlined"
          label={`detected: ${classes.offer.join(' ')}`}
          data-testid="gear-class-offer"
          title="What the app currently infers you are running. Click to read the table for it."
          onClick={classes.adopt}
          sx={{ flexShrink: 0 }}
        />
      )}
    </Stack>
  )
}

/** WHAT THEY READ: the simulated plus-state, the ratio floor, the stat thresholds. */
function NumbersRow({ filters, setFilters, upgrade }: Pick<GearFilterBarProps, 'filters' | 'setFilters' | 'upgrade'>): JSX.Element {
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'nowrap', minWidth: 0 }}>
      <UpgradeSlider state={upgrade.state} onChange={upgrade.set} />

      <TextField
        size="small"
        label="Min ratio"
        placeholder="1.0"
        value={filters.minRatio === null ? '' : String(filters.minRatio)}
        data-testid="gear-min-ratio"
        title="Weapon damage ratio (DMG / delay) at the simulated upgrade state. Non-weapons state none, so they never pass it."
        onChange={(e) => {
          const raw = e.target.value.trim()
          const n = Number(raw)
          setFilters({ ...filters, minRatio: raw === '' || !Number.isFinite(n) ? null : n })
        }}
        sx={{ width: 110, flexShrink: 0 }}
      />

      <ThresholdInput filters={filters} onChange={setFilters} />
      <ThresholdChips filters={filters} onChange={setFilters} />
    </Stack>
  )
}

export default function GearFilterBar(props: GearFilterBarProps): JSX.Element {
  const { filters, setFilters, text, setText, classes, upgrade } = props
  return (
    <Stack spacing={1} sx={{ mb: 1, flexShrink: 0 }}>
      <IdentityRow filters={filters} setFilters={setFilters} text={text} setText={setText} classes={classes} />
      <NumbersRow filters={filters} setFilters={setFilters} upgrade={upgrade} />
    </Stack>
  )
}
