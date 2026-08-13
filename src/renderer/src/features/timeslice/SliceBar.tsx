// SliceBar — THE ONE TIMESLICE CONTROL, on every loot and xp analysis surface (JOS-130).
//
// It absorbs the Leveling tab's timescale (JOS-71) rather than sitting beside it: two controls
// over one time base is exactly the disagreement world-model law 9 exists to prevent, and the
// duration rungs are just four more slices in the same id space (`shared/timeslice.ts`).
//
// IT SAYS WHAT YOU ARE LOOKING AT AND NOTHING ABOUT HOW. The buttons name slices (`All`,
// `Session`, `Zone`), the caption names the slice's ends and the zone it is restricted to, and
// neither mentions filtering, zooming or bucketing (UI conventions: state, never process).
//
// NO TOOLTIPS, and that is a rule this surface inherits twice over. The labels are the whole
// vocabulary; and this is an INTERACTIVE control that sits directly above tables and charts, which
// is the exact geometry JOS-127 removed the loot ledger's hover cards for — a popper over a
// control eats the click aimed at it. What a preset MEANS is stated in `shared/timeslice.ts` and
// in the caption under the buttons, where it cannot cover anything.
//
// A SHORT HISTORY LOSES THE BUTTONS, NOT THE CAPTION. When the record can offer only one slice
// there is no choice to draw, and the caption still states which stretch the numbers cover — the
// same honest degradation `TimescaleBar` shipped with.
//
// THE TWO HALVES ARE SEPARATELY MOUNTABLE (JOS-301). `SliceControls` is the buttons and
// `SliceCaption` is the sentence under them; `SliceBar` is the pair on ONE line, which is what the
// loot ledger mounts and has always looked like. `ScopeBar` takes them apart instead — its row
// carries three sets of controls and ONE caption line beneath all of them, so the slice's words
// have to be able to travel without the buttons they belong to. Neither half is a copy of the
// other's text: the words live here, in `SliceCaption`, wherever they are drawn.

import { type JSX } from 'react'
import { Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { sliceLabel, type SliceId, type SliceRange, type Timeslice } from '@shared/timeslice'
import { formatDateTime } from '../../lib/formatDate'

/** One shape for both ends, whatever the slice: `Aug 5, 18:00`. */
function edge(ts: number): string {
  return formatDateTime(ts, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}

/**
 * `<input type="datetime-local">` speaks LOCAL wall time with no zone, so the conversion has to
 * go through the local parts rather than through `toISOString` (which would shift the value by
 * the offset and hand the user back a different minute than they typed).
 */
function toLocalInput(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** NaN for an incomplete value — the caller keeps the previous range rather than jumping to 1970. */
function fromLocalInput(v: string): number {
  return new Date(v).getTime()
}

/** The two instants of the custom slice. Rendered only under `custom`, so the bar stays one row
 *  for the eight presets that need no input. */
function CustomRange({
  range,
  onChange,
  testId
}: {
  range: SliceRange
  onChange: (r: SliceRange) => void
  testId: string
}): JSX.Element {
  const field = (label: string, value: number, key: 't0' | 't1'): JSX.Element => (
    <TextField
      size="small"
      type="datetime-local"
      label={label}
      value={toLocalInput(value)}
      data-testid={`${testId}-custom-${key === 't0' ? 'from' : 'to'}`}
      onChange={(e) => {
        const ts = fromLocalInput(e.target.value)
        if (Number.isFinite(ts)) onChange({ ...range, [key]: ts })
      }}
      slotProps={{ inputLabel: { shrink: true } }}
      sx={{ '& input': { fontSize: 12, py: 0.5 } }}
    />
  )
  return (
    <>
      {field('From', range.t0, 't0')}
      {field('To', range.t1, 't1')}
    </>
  )
}

export interface SliceBarProps {
  /** The ids this record can offer, in render order (`shared/timeslice.availableSlices`). */
  available: readonly SliceId[]
  /** The resolved slice in force — the SAME object every number on the surface was measured
   *  over, so the caption cannot lie about what it is describing. */
  slice: Timeslice
  onPick: (id: SliceId) => void
  onCustom: (range: SliceRange) => void
  /**
   * Prefix for this surface's testids: `<prefix>`, `<prefix>-<sliceId>`, `<prefix>-window`, and
   * `<prefix>-custom-from` / `-custom-to`. Per surface because two slice bars can be mounted at
   * once (tabs stay mounted), and a shared id would make a selector ambiguous.
   */
  testId: string
}

/** THE BUTTONS ALONE — the half that is a control, mountable beside other controls (JOS-301). */
export function SliceControls({ available, slice, onPick, onCustom, testId }: SliceBarProps): JSX.Element {
  return (
    <Stack
      direction="row"
      spacing={1.5}
      alignItems="center"
      data-testid={testId}
      sx={{ flexWrap: 'wrap', rowGap: 1 }}
      useFlexGap
    >
      {available.length > 1 && (
        <ToggleButtonGroup
          size="small"
          exclusive
          value={slice.id}
          onChange={(_e, next: SliceId | null) => {
            // MUI reports null when the active button is clicked again. Some slice is always in
            // force, so that is a no-op rather than an empty selection.
            if (next) onPick(next)
          }}
        >
          {available.map((id) => (
            <ToggleButton
              key={id}
              value={id}
              data-testid={`${testId}-${id}`}
              sx={{ px: 1.1, py: 0.25, fontSize: 11, lineHeight: 1.4, textTransform: 'none' }}
            >
              {sliceLabel(id)}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      )}
      {slice.id === 'custom' && <CustomRange range={slice.range} onChange={onCustom} testId={testId} />}
    </Stack>
  )
}

/**
 * THE SENTENCE ALONE — the half that describes, wherever it ends up being drawn (JOS-301).
 *
 * It states the slice's ends and, when the slice is restricted to one zone, which zone AND WHICH OF
 * ITS TIERS (`Timeslice.zoneCaption`, JOS-291) — the halves of a slice, in the one place that is
 * allowed to describe it. The membership clause is printed even under the default, because the
 * default admits visits whose names this line does not print, and a caption that named only the
 * current tier while measuring every one of them is the defect JOS-291 was filed for (JOS-288's
 * honesty rule: the span line IS the denominator).
 *
 * It renders as a `span` because it is a CLAUSE: on the loot ledger it is the second item of a
 * one-line bar, and on `ScopeBar` it is the first clause of a caption line it shares with the
 * basis. `noWrap` is the CALLER's call for the same reason — it belongs to whoever owns the line
 * (the compact-bar contract: the control never shrinks, the caption does).
 */
export function SliceCaption({
  slice,
  testId,
  noWrap = false
}: {
  slice: Timeslice
  testId: string
  noWrap?: boolean
}): JSX.Element {
  return (
    <Typography
      component="span"
      variant="caption"
      color="text.secondary"
      noWrap={noWrap}
      sx={{ minWidth: 0 }}
      data-testid={`${testId}-window`}
    >
      {edge(slice.range.t0)} → {edge(slice.range.t1)}
      {slice.zoneCaption ? ` · ${slice.zoneCaption}` : ''}
    </Typography>
  )
}

/** BOTH HALVES ON ONE LINE — the loot ledger's bar, unchanged since JOS-130. */
export function SliceBar(props: SliceBarProps): JSX.Element {
  return (
    <Stack
      direction="row"
      spacing={1.5}
      alignItems="center"
      sx={{ flexWrap: 'wrap', rowGap: 1, minWidth: 0 }}
      useFlexGap
    >
      <SliceControls {...props} />
      <SliceCaption slice={props.slice} testId={props.testId} noWrap />
    </Stack>
  )
}
