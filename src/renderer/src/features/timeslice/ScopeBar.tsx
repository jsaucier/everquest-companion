// ScopeBar — WHICH STRETCH, AND PER HOUR OF WHAT (JOS-288).
//
// The two halves of one sentence, composed in one place so a surface cannot mount half of it. The
// SLICE (`SliceBar`, JOS-130) says which stretch of play the numbers are about; the BASIS
// (`RateBasisBar`) says which of the two honest denominators its rates are divided by. They are
// separate CONTROLS on purpose — a reader does not choose between `Session` and `active` — and one
// COMPONENT on purpose, because every exp surface needs both and a page carrying only the first
// would show rates over an hour it never named.
//
// IT IS NOT THE LOOT LEDGER'S CONTROL. That tab mounts `SliceBar` alone: its rate line prints BOTH
// readings side by side (JOS-261) precisely so neither can pass for the other, and a toggle there
// would replace a complete answer with half of one.

import { type JSX } from 'react'
import type { SliceId, SliceRange, Timeslice } from '@shared/timeslice'
import { RateBasisBar } from './RateBasisBar'
import { SliceBar } from './SliceBar'

export interface ScopeBarProps {
  available: readonly SliceId[]
  slice: Timeslice
  onPick: (id: SliceId) => void
  onCustom: (range: SliceRange) => void
  /** Prefix for BOTH controls' testids: `<prefix>-slice…` and `<prefix>-basis…`. */
  testId: string
}

export function ScopeBar({ available, slice, onPick, onCustom, testId }: ScopeBarProps): JSX.Element {
  return (
    <>
      <SliceBar
        available={available}
        slice={slice}
        onPick={onPick}
        onCustom={onCustom}
        testId={`${testId}-slice`}
      />
      <RateBasisBar testId={`${testId}-basis`} />
    </>
  )
}
