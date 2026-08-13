// RateBasisBar — WHICH HOUR THE RATES ON THIS SURFACE ARE PER (JOS-288).
//
// The sibling of `SliceBar`, and deliberately a SECOND control rather than another row of buttons
// inside it: the slice answers "which stretch of play", this answers "per hour of what", and they
// are orthogonal in exactly the way `shared/timeslice.ts` says a range and a zone are. Folding the
// two into one group would offer `Session` beside `active` as if a reader had to choose between
// them.
//
// IT SAYS WHAT YOU ARE LOOKING AT AND NOTHING ABOUT HOW (UI conventions, inherited from SliceBar).
// The buttons are the two words the loot ledger already uses — `elapsed` and `active` — and the
// caption states which one the numbers below are on. No tooltip on the buttons themselves, for
// SliceBar's measured reason (a popper over a control eats the click aimed at it); the DEFINITION
// of the hour in force rides the caption, which covers nothing.
//
// IT IS NOT ON THE LOOT TAB, and that is a decision rather than an omission: the ledger's rate line
// prints BOTH readings side by side (JOS-261) precisely so neither can pass for the other, and a
// toggle there would replace a complete answer with half of one.

import { type JSX } from 'react'
import { Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { RATE_BASES, type RateBasis } from '@shared/rateBasis'
import { BASIS_TITLE } from '../leveling/rangeStatsRows'
import { useRateBasis } from './useRateBasis'

export interface RateBasisBarProps {
  /**
   * Prefix for this surface's testids: `<prefix>` and `<prefix>-<basis>`. Per surface for
   * `SliceBarProps.testId`'s reason — tabs stay mounted, so two of these can exist at once.
   */
  testId: string
}

export function RateBasisBar({ testId }: RateBasisBarProps): JSX.Element {
  const { basis, setBasis } = useRateBasis()
  return (
    <Stack
      direction="row"
      spacing={1.5}
      alignItems="center"
      data-testid={testId}
      data-basis={basis}
      sx={{ flexWrap: 'wrap', rowGap: 1 }}
      useFlexGap
    >
      <ToggleButtonGroup
        size="small"
        exclusive
        value={basis}
        onChange={(_e, next: RateBasis | null) => {
          // MUI reports null when the active button is clicked again. Some hour is always in force,
          // so that is a no-op rather than an empty selection (SliceBar's rule, same reason).
          if (next) setBasis(next)
        }}
      >
        {RATE_BASES.map((id) => (
          <ToggleButton
            key={id}
            value={id}
            data-testid={`${testId}-${id}`}
            sx={{ px: 1.1, py: 0.25, fontSize: 11, lineHeight: 1.4, textTransform: 'none' }}
          >
            {id}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      {/* The control never shrinks; the caption does (the compact-bar contract). It is the ONE
          place the definition of the hour in force is stated on this tab — the rate captions below
          state the SPAN, which is a different fact about the same denominator. */}
      <Typography
        variant="caption"
        color="text.secondary"
        noWrap
        sx={{ minWidth: 0 }}
        data-testid={`${testId}-caption`}
        title={BASIS_TITLE[basis]}
      >
        rates per hour of {basis} time
      </Typography>
    </Stack>
  )
}
