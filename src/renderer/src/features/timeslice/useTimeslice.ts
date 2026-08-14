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
// THE ZONE MEMBERSHIP IS APPLIED HERE AND NO LONGER KEPT HERE (JOS-291, moved by JOS-332). It is
// the same KIND of thing as the pick — a dimension of "which stretch of play am I looking at" — so
// it is app-wide (a reader who narrows to this tier and then looks at what dropped there is asking
// ONE question, and the answer follows them) and session-lifetime (a membership is a thing you
// choose while you are looking, not a preference). What changed is HOW FAR "app-wide" reaches: it
// used to be a module variable in this file, which meant the XP overlay — a separate renderer
// process — kept its own second copy, and the owner read `elapsed 27m` off this tab with *this
// tier* showing in a window that had never told this one. So the value moved to MAIN, which is the
// only process that can reach every window, and this file now reads it through `useScopeSelection`
// like every other surface does. `shared/scopeSelection.ts` carries the whole argument and the
// measurement behind it; the OPENING is `exactTier` (owner ruling), not the model's `allTiers`.
//
// The store below is a five-line external store rather than a context: every consumer is a leaf,
// the value is two scalars, and `useSyncExternalStore` over a VERSION counter is the whole thing (a
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
import type { ZoneScope } from '@shared/zoneScope'
import { useModule } from '../../lib/useModule'
import { EMPTY_PROGRESSION, applyProgressionDelta } from '../leveling/progressionDelta'
import { dataBounds, type DataBounds } from '../leveling/zoneBands'
import { resetScopeSelection, useScopeSelection } from './useScopeSelection'

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
 *  `resolveSliceId` degrades a pick the new record cannot define.
 *
 *  IT STILL CLEARS EVERY DIMENSION OF THE PICK, including the membership — which now lives one file
 *  over, so this delegates rather than assigns. A reset that left a membership behind for the next
 *  test is the bug this line has always been about; the value moving to main did not retire it. */
export function resetTimeslice(): void {
  pickedId = null
  pickedCustom = null
  resetScopeSelection()
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

/**
 * WHICH TIERS of the current zone the slice admits (JOS-291), and the setter for it.
 *
 * Its OWN hook, exactly like `useRateBasis` is its own beside this file: the control that renders
 * it (`ZoneScopeBar`) is a leaf that needs the membership and nothing else, and making it a member
 * of `TimesliceState` would mean every surface hauling two more props through its layout to reach
 * one button.
 *
 * SINCE JOS-332 IT IS A NAMED VIEW OF THE APP-WIDE SCOPE SELECTION rather than a store of its own.
 * `useTimeslice` reads the SAME hook to resolve the slice, so a reader can never see a membership
 * the numbers did not use — and now neither can they see one the XP overlay did not use, because
 * both windows read the value main holds.
 */
export function useZoneScope(): { zoneScope: ZoneScope; setZoneScope: (next: ZoneScope) => void } {
  const { zoneScope, setZoneScope } = useScopeSelection(window.eq)
  return { zoneScope, setZoneScope }
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
  // THE MEMBERSHIP IS READ, NEVER KEPT (JOS-332). One value per app, held in main, so the tab and
  // the floating window cannot be on different tiers while both say `this tier`.
  const { zoneScope } = useScopeSelection(window.eq)

  const bounds = useMemo(() => dataBounds(prog, extraTs), [prog, extraTs])
  const available = useMemo(() => availableSlices(prog, bounds), [prog, bounds])
  // A pick the record can no longer define degrades to `all` rather than to a window the log
  // cannot fill — the `resolveTimescale` rule this absorbs, over a wider id space. The surface's
  // own opening goes through the very same degrade, so a log with no logout in it cannot open the
  // Leveling tab on a `Zone + Session` this record could not define.
  const id = resolveSliceId(pickedId ?? initialId, prog, bounds)
  const custom = pickedCustom
  const slice = useMemo(
    () => resolveSlice({ snap: prog, bounds, id, custom, zoneScope }),
    [prog, bounds, id, custom, zoneScope]
  )

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
