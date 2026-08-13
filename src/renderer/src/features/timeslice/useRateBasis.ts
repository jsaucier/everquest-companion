// useRateBasis — WHICH HOUR THE IN-APP RATES ARE PER, app-wide (JOS-288).
//
// The sibling of `useTimeslice`, one question over: that hook keeps WHICH STRETCH a reader is
// looking at, this one keeps WHICH DENOMINATOR its rates are divided by. The vocabulary, the
// default and the just-arrived gate are all `shared/rateBasis.ts`'s; this file is the two things a
// renderer has to add to them — a store and a hook.
//
// WHY IT IS APP-WIDE AND NOT PER PANEL. It is `useTimeslice`'s argument verbatim: a reader who
// flips the Leveling hero to active time and then looks down at the per-zone table or across at the
// AA pace is asking ONE question, and a page whose halves divide by different hours is the exact
// thing the two-denominator vocabulary exists to prevent. One flip, one hour, every rate on the tab.
//
// WHY IT IS SESSION-LIFETIME AND UNPERSISTED. The same argument again, and the same owner direction
// behind it: a denominator is a thing you choose while you are looking, and the default is the one
// the owner ruled for (`RATE_BASIS_DEFAULT` — elapsed) EVERY time the app starts. The XP overlay's
// copy of this knob IS persisted, and that is not an inconsistency: an overlay remembers everything
// about itself (its position, its rows, its slice) because it is a window you set up once and leave
// floating over the game, while a tab is a place you visit.
//
// THE STORE IS THE FIVE-LINE EXTERNAL ONE `useTimeslice` uses, for its reasons: every consumer is a
// leaf, the value is one scalar, and `useSyncExternalStore` over a VERSION counter is the whole
// thing (a getSnapshot returning a fresh object would re-render forever).

import { useCallback, useSyncExternalStore } from 'react'
import { RATE_BASIS_DEFAULT, toggleRateBasis, type RateBasis } from '@shared/rateBasis'

let basis: RateBasis = RATE_BASIS_DEFAULT
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

/** Reset to the ruled default. Exported for tests, exactly like `resetTimeslice`. */
export function resetRateBasis(): void {
  basis = RATE_BASIS_DEFAULT
  emit()
}

export interface RateBasisState {
  /** The hour in force. Every rate on the surface divides by this one. */
  basis: RateBasis
  /** Flip to the other one — there are exactly two, so this is the whole control. */
  toggle: () => void
  /** Set it outright, for a control that renders both options rather than a flip. */
  setBasis: (next: RateBasis) => void
}

export function useRateBasis(): RateBasisState {
  useSyncExternalStore(subscribe, getVersion, getVersion)
  const toggle = useCallback(() => {
    basis = toggleRateBasis(basis)
    emit()
  }, [])
  const setBasis = useCallback((next: RateBasis) => {
    basis = next
    emit()
  }, [])
  return { basis, toggle, setBasis }
}
