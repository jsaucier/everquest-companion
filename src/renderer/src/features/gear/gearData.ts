// gear/gearData.ts — the candidate index in the renderer: fetched once, widened, and the two
// pieces of state the Gear tab keeps beside it (the global plus-state, and the class combo).
//
// ONE FETCH PER WINDOW, the `plannerData.ts` precedent and for the same reasons: `items.json` is
// 8.6 MB and stays in MAIN, the gear index is built there once and arrives over ONE IPC call, and
// the corpus is committed data that cannot change while the app runs. The promise is cached too,
// so two mounts in the same frame share one round trip.
//
// THE PAYLOAD IS VERSIONED, AND A VERSION WE DO NOT KNOW IS REFUSED (gear.ts states the contract).
// A renderer that met a `GEAR_INDEX_VERSION` from the future would be drawing a vector whose keys
// or units mean something else — so it draws nothing and says so, which is the only honest
// failure. In practice both halves ship together; this is what makes that assumption checkable.
//
// THE SEARCH KEY IS WIDENED HERE, ONCE PER DATA CHANGE. The index's own `searchKey` is the item
// NAME (gear.ts, pinned by tests/gearIndex.test.mts) because that is the only haystack a shared
// index can commit to. A player searching this table means "Improved Healing" as often as they
// mean "Blade of Light", so the table's copy folds the effect names in — the exact widening
// `plannerData.toRow` performs for donor rows, computed once here rather than per keystroke per
// row (the standing search law).

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ClassAbbr } from '@shared/classCombo'
import { resolvedClasses } from '@shared/classCombo'
import { ITEM_UPGRADE_BASE, type ItemUpgradeState } from '@shared/itemUpgrade'
import { GEAR_INDEX_VERSION, type GearBuildStats, type GearRow } from '@shared/planner/gear'
import { useComboSnap } from '../profiles/ClassComboData'
// ONE era verdict for the whole app: the exaltation browser's, reached through the same three
// witnesses (mob catalog ∪ the page's own drop list ∪ the era banner). A `GearRow` carries `key`,
// `wikiSources` and `eraTag`, which is exactly what an `EraSubject` is — so this is a call, never
// a second copy of the rule.
import { eraChip, eraHides, type EraChipInfo } from '../planner/plannerData'
import { sourceIndex } from '../planner/sourceIndex'
import { sameClasses } from '../planner/plannerClasses'

// ---- the fetch ----------------------------------------------------------------------

/** The effect text a search should reach: the name, and the parenthetical the wiki wrote after it. */
function effectHaystack(row: GearRow): string {
  return row.effects.map((e) => `${e.name} ${e.detail ?? ''}`).join(' ')
}

/** The index row with the table's own, wider search key. Same type — only the haystack grew. */
function toRow(row: GearRow): GearRow {
  return { ...row, searchKey: `${row.name} ${effectHaystack(row)}`.toLowerCase() }
}

export interface GearIndexState {
  rows: GearRow[]
  /** false until the first fetch settles */
  ready: boolean
  /** the corpus's own `scrapedAt` — WHEN the data is from */
  scrapedAt: string | null
  stats: GearBuildStats | null
  /** the payload stated a version this build does not know — nothing is drawn */
  refused: boolean
}

const EMPTY: GearIndexState = { rows: [], ready: false, scrapedAt: null, stats: null, refused: false }

let CACHE: GearIndexState | null = null
let INFLIGHT: Promise<GearIndexState> | null = null

async function fetchIndex(): Promise<GearIndexState> {
  const payload = await window.eq.gearIndex()
  CACHE =
    payload.version === GEAR_INDEX_VERSION
      ? {
          rows: payload.rows.map(toRow),
          ready: true,
          scrapedAt: payload.scrapedAt,
          stats: payload.stats,
          refused: false
        }
      : { ...EMPTY, ready: true, refused: true }
  return CACHE
}

/** The whole index, fetched at most once per window. */
export function useGearIndex(): GearIndexState {
  const [state, setState] = useState<GearIndexState>(() => CACHE ?? EMPTY)

  useEffect(() => {
    if (CACHE !== null) return
    let alive = true
    INFLIGHT ??= fetchIndex()
    void INFLIGHT.then((next) => {
      if (alive) setState(next)
    }).catch(() => {
      /* main never rejects; an empty index renders the honest empty state */
      if (alive) setState({ ...EMPTY, ready: true })
    })
    return () => {
      alive = false
    }
  }, [])

  // Warm the mob-catalog inversion AFTER mount, not on the render path: the first row to ask the
  // era join for a source would otherwise pay the whole ~33k-link build inside a paint (the
  // EffectBrowser precedent).
  useEffect(() => {
    sourceIndex()
  }, [])

  return state
}

/** The era verdict as the pure filter model wants it — a stable identity, so the memo can key on it. */
export function useEraHidden(): { eraHidden: (row: GearRow) => boolean } {
  return useMemo(() => ({ eraHidden: (row: GearRow) => eraHides(row, true) }), [])
}

/** The one chip the era join draws on a gear row, or null when it is in-era and has nothing to say. */
export function gearEraChip(row: GearRow): EraChipInfo | null {
  return eraChip(row)
}

// ---- the global plus-state ------------------------------------------------------------

/**
 * THE UPGRADE SIMULATION'S STATE, and the one design decision in it: IT IS NOT PERSISTED.
 *
 * Every other planner preference is remembered machine-side (`eq.planner.*`) because every other
 * one is a way of READING the corpus. This one changes what the corpus SAYS — at `+5` the table
 * states numbers no item in your bags has — so a tab that silently reopened at +5 would be lying
 * quietly, and the lie would be invisible precisely because the slider is the thing you stopped
 * looking at. It resets to base on every mount, which is the state the data is actually in.
 */
export function useUpgradeState(): {
  state: ItemUpgradeState
  /** the value the CONTROL echoes — see GearView on why the table reads a deferred copy */
  set: (next: ItemUpgradeState) => void
} {
  const [state, setState] = useState<ItemUpgradeState>(ITEM_UPGRADE_BASE)
  return { state, set: setState }
}

// ---- the class combo -------------------------------------------------------------------

/**
 * THE CLASS FILTER, AND ITS PROVENANCE (V2's rule, `plannerClasses.ts` — a trio is a FILTER and
 * never a rule).
 *
 * `detected` is the default: the table reads for whatever the app currently believes this
 * character is running, and a loadout switch rewrites it silently and correctly, because nobody
 * has said otherwise yet. The moment the user edits the selection it PINS (`user`), and detection
 * may never overwrite it again — it can only offer, which is what `detectedOffer` is for on the
 * exaltation board and what the toolbar's "detected: …" chip does here.
 *
 * NOTHING IS EVER ENFORCED BY IT. A row outside the filter is hidden only while "Usable by these
 * classes" is on, and a row shown despite a mismatch is CHIPPED rather than removed (the
 * `MismatchChip` the planner already draws). Same rule, same chip, same words.
 */
export interface GearClasses {
  /** the classes the filter is reading for */
  classes: ClassAbbr[]
  /** what the app currently infers, whether or not the filter follows it */
  detected: ClassAbbr[]
  /** true while the filter is following detection */
  following: boolean
  /** the detected trio, when it is worth offering (pinned, resolved, and different) */
  offer: ClassAbbr[] | null
  /** the user picking classes by hand — this PINS the filter */
  set: (next: ClassAbbr[]) => void
  /** take the detected trio and stay pinned to it (the offer chip) */
  adopt: () => void
}

export function useGearClasses(): GearClasses {
  const combo = useComboSnap()
  const current = combo.current
  // An unresolved slot contributes nothing, so a half-known combo yields the classes it does know
  // and nothing it does not (law 1) — the same read PlannerView makes.
  const detected = useMemo(() => (current === null ? [] : resolvedClasses(current)), [current])
  const [pinned, setPinned] = useState<ClassAbbr[] | null>(null)

  const set = useCallback((next: ClassAbbr[]) => {
    setPinned(next)
  }, [])
  const adopt = useCallback(() => {
    setPinned(detected)
  }, [detected])

  const classes = pinned ?? detected
  const offer = pinned !== null && detected.length > 0 && !sameClasses(pinned, detected) ? detected : null
  return { classes, detected, following: pinned === null, offer, set, adopt }
}
