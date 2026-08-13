// useTimeslice — THE PICK, shared by every surface that has a slice control (JOS-130).
//
// The definitions are pure and live in `shared/timeslice.ts`; this file is the two things a
// renderer has to add to them: a subscription to the `progression` snapshot the slice is resolved
// against, and the ONE place the user's choice is kept.
//
// WHY THE CHOICE IS APP-WIDE AND NOT PER TAB. The ticket is "one control everywhere", and a
// control that reads `Session` on the Loot tab while the Leveling tab quietly still reads `All`
// is two controls wearing one design. A reader who narrows to this session and then goes looking
// for the xp rate behind those drops is asking ONE question; the answer follows them.
//
// IT IS SESSION-LIFETIME AND UNPERSISTED, exactly like the timescale it absorbs (JOS-71) and the
// chart's range selection: a slice is a thing you choose while you are looking, not a preference.
// A store key would mean a user who once looked at one zone comes back tomorrow to a ledger that is
// quietly hiding most of their loot.
//
// THE PICK IS GLOBAL; THE UNCHOSEN OPENING IS NOT (JOS-288). `All` was the opening on every surface
// (owner direction 2026-08-09) until the owner ruled that the exp surfaces open on `Zone + Session`
// — the camp you are standing in, this session — while the LOOT LEDGER'S opening is untouched and
// stays `All` (its own owner direction: the ledger comes up hiding nothing). Those two are not in
// conflict, because "the choice is app-wide" is a statement about a CHOICE and nobody has made one
// yet at startup. So `pickedId` starts as null and each surface declares the id it opens on; the
// FIRST press anywhere writes the shared pick, and from that instant the answer follows the reader
// between tabs exactly as it always has — which is the property the header above is about. A reader
// who never touches the control sees each surface's own honest opening, which is what they saw
// before this existed on both of them.
//
// The store is a five-line external store rather than a context: every consumer is a leaf, the
// value is two scalars, and `useSyncExternalStore` over a VERSION counter is the whole thing (a
// getSnapshot returning a fresh object would re-render forever).

import { useCallback, useMemo, useSyncExternalStore } from 'react'
import type { ProgressionDelta, ProgressionSnap } from '@shared/types'
import {
  availableSlices,
  resolveSlice,
  resolveSliceId,
  type SliceId,
  type SliceRange,
  type Timeslice
} from '@shared/timeslice'
import { useModule } from '../../lib/useModule'
import { EMPTY_PROGRESSION, applyProgressionDelta } from '../leveling/progressionDelta'
import { dataBounds, type DataBounds } from '../leveling/zoneBands'

/** NULL means nobody has pressed the control yet — each surface then opens on its own
 *  `initialId`. See the header for why that is not a second control. */
let pickedId: SliceId | null = null
let pickedCustom: SliceRange | null = null
let version = 0
const listeners = new Set<() => void>()

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function getVersion(): number {
  return version
}

function emit(): void {
  version++
  for (const cb of [...listeners]) cb()
}

/** Reset to the default. Exported for tests and for a character rebuild that wants a clean slate;
 *  nothing in the app calls it today, and a slice surviving a character switch is fine because
 *  `resolveSliceId` degrades a pick the new record cannot define. */
export function resetTimeslice(): void {
  pickedId = null
  pickedCustom = null
  emit()
}

export interface TimesliceState {
  /** The snapshot the slice was resolved against — handed back so a consumer that also needs
   *  `rangeStats` does not subscribe to the same module twice. */
  prog: ProgressionSnap
  /** Where the record starts and ends, or null when nothing carries a timestamp. */
  bounds: DataBounds | null
  /** The ids this record can offer, in render order (`shared/timeslice.availableSlices`). */
  available: SliceId[]
  /** The resolved slice — range, zone filter and wording. The whole object travels together. */
  slice: Timeslice
  /** The pick AFTER `resolveSliceId`, which is what the control must render as selected. */
  id: SliceId
  setId: (id: SliceId) => void
  custom: SliceRange | null
  setCustom: (range: SliceRange | null) => void
}

const NO_EXTRA: readonly number[] = []

/**
 * The slice in force on this surface.
 *
 * `extraTs` widens the record's bounds with series the progression snapshot does not carry — the
 * Leveling tab's level dings and AA gains. Pass a MEMOIZED array; it is a dependency.
 *
 * `initialId` is what THIS surface opens on before anyone has pressed the control (see the header).
 * It defaults to `all`, so a caller that says nothing gets the behaviour every caller had.
 */
export function useTimeslice(extraTs: readonly number[] = NO_EXTRA, initialId: SliceId = 'all'): TimesliceState {
  const prog = useModule<ProgressionSnap, ProgressionDelta>('progression', applyProgressionDelta) ?? EMPTY_PROGRESSION
  useSyncExternalStore(subscribe, getVersion, getVersion)

  const bounds = useMemo(() => dataBounds(prog, extraTs), [prog, extraTs])
  const available = useMemo(() => availableSlices(prog, bounds), [prog, bounds])
  // A pick the record can no longer define degrades to `all` rather than to a window the log
  // cannot fill — the `resolveTimescale` rule this absorbs, over a wider id space. The surface's
  // own opening goes through the very same degrade, so a log with no logout in it cannot open the
  // Leveling tab on a `Zone + Session` this record could not define.
  const id = resolveSliceId(pickedId ?? initialId, prog, bounds)
  const custom = pickedCustom
  const slice = useMemo(() => resolveSlice({ snap: prog, bounds, id, custom }), [prog, bounds, id, custom])

  const setId = useCallback((next: SliceId) => {
    pickedId = next
    emit()
  }, [])
  const setCustom = useCallback((range: SliceRange | null) => {
    pickedCustom = range
    // Choosing a range IS choosing the custom slice — a control that made you press two buttons
    // to see what you just typed would be stating the pick twice.
    if (range) pickedId = 'custom'
    emit()
  }, [])

  return { prog, bounds, available, slice, id, setId, custom, setCustom }
}
