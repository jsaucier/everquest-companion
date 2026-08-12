// planner/plannerPreset.ts — WHICH ITEM IS THE BROWSER NARROWED TO, and how it got there.
//
// The planner had one way in: pick an effect, then say which slot it lands in. The owner asked for
// the other one, which is how the game itself presents the decision — you open an item, you see
// its sockets, and you fill one. That is what the Inventory tab's cells are (V8): the host, then
// its four sockets with their unlock tiers, and clicking a socket takes you to the effect browser
// ALREADY NARROWED to what can legally go there.
//
// SINCE JOS-210 THERE ARE TWO DOORS INTO THE SAME NARROWING, and one shape behind both.
//
//   * A `BrowsePreset` is the trip FROM THE INVENTORY TAB: a cell, one of its four sockets, and the
//     host that cell is wearing. It is a message between two modes, so it stays the small,
//     serialisable thing PlanBoard already builds.
//   * An `ItemFocus` is what the BROWSER actually filters by, and it is the union of what both
//     doors know: the item's identity, WHERE it is worn and WHO can use it. The second door is the
//     filter bar's own item picker, which reaches ANY item in the committed DB — not only the ones
//     your set already plans hosts for, which was the whole of the owner's ask.
//
// THE HOST'S FACTS ARE LOOKED UP, NOT ASSUMED. An auto-filled host comes from an inventory dump,
// which states no classes and no slots at all, and a hand-picked one was chosen before this preset
// existed. So the lookup goes through main's item index by EXACT KEY (`plannerSearchItems` ranks the
// typed name first, and the answer is taken only when the key matches — a name match alone would be
// the fuzzy join law 12 forbids). An item the index does not carry yields nothing, and the focus
// falls back to the CELL's own equip slot with an unknown class list — which is exactly what the
// preset filtered by before this file knew what an ItemFocus was.
//
// AND THE FOCUS SURVIVES A KIND SWITCH (JOS-210, the bug half). It used to be dropped by every
// write the filter bar made, including the proc/worn/focus/click tabs — see EffectBrowser's
// `setSocket`, which now MOVES the preset's socket instead of clearing the item out from under it.

import { useEffect, useMemo, useState } from 'react'
import type { ClassAbbr } from '@shared/classCombo'
// RELATIVE value imports (the mobSearch house law): `itemFits` is reached under the node runner by
// tests/plannerItemFilter.test.mts, where the vite-only `@shared` alias does not resolve.
import { socketCompatibility } from '../../../../shared/planner/rules'
import {
  EQUIP_SLOTS,
  equipSlotOf,
  type EquipSlot,
  type PlanSlotId,
  type PlannerDonor,
  type PlannerItemHit,
  type SocketType
} from '../../../../shared/planner/types'
import { classesMismatch } from './plannerClasses'

/** Which socket of which host the browser was opened from — the Inventory tab's message. */
export interface BrowsePreset {
  /** the CELL you clicked — the browser filters by `equipSlotOf(slot)` and WRITES to this (JOS-67) */
  slot: PlanSlotId
  socket: SocketType
  /** `itemKey(name)` of the host — the identity the item lookup matches on */
  hostKey: string
  hostName: string
}

/**
 * THE ITEM THE BROWSER IS FILTERING BY — one shape, whichever door it came through.
 *
 * `slots` and `classes` are R2's two halves as facts about the ITEM, and both are empty when
 * nothing states them: an empty list is UNKNOWN and narrows nothing (law 1), never "nowhere" or
 * "nobody".
 */
export interface ItemFocus {
  /** `itemKey(name)` */
  key: string
  name: string
  /** where it is worn. `[]` = unknown, which filters nothing. */
  slots: readonly EquipSlot[]
  /** who can use it. `[]` = unknown, which filters nothing. */
  classes: readonly ClassAbbr[]
  /**
   * The CELL this focus came from, when it came from the Inventory tab — present only for a
   * `BrowsePreset`, and what makes an add write to that exact place rather than open the slot menu.
   */
  cell?: PlanSlotId
}

/**
 * CAN THIS DONOR'S EFFECT MOVE INTO THIS ITEM? — R2 and R3, asked as a FILTER.
 *
 * The rule itself is `socketCompatibility` (shared/planner/rules.ts) and is not restated here: it
 * owns R3's flat no on haste and R2's slot half, and passing it an EMPTY class list is how this
 * file asks for those two alone. The class half is then `classesMismatch`, which is the one rule
 * the browser filter and the Board's mismatch chip already share.
 *
 * WHY THE CLASS HALF IS ASKED SEPARATELY: `socketCompatibility` answers for a PLANNED socket, where
 * an unknown must be reported rather than passed ("this page states no class list"). A browser
 * filter has the opposite obligation — hiding every donor whose page stayed silent would assert a
 * fact the wiki declined to state (law 1) — so an unknown on either side passes here and the row is
 * chipped instead.
 *
 * An item with NO STATED SLOTS narrows nothing rather than matching nothing: the filter bar's
 * picker only ever offers items that state one, so this case is a preset whose host the index does
 * not carry, and refusing every donor there would blank the browser over a gap in our own data.
 */
export function itemFits(donor: PlannerDonor, item: ItemFocus): boolean {
  const slots = item.slots.length === 0 ? EQUIP_SLOTS : item.slots
  if (!socketCompatibility(donor, slots, []).ok) return false
  return !classesMismatch(donor.classes, item.classes)
}

// ---- the item index, as the two pickers ask it ----------------------------------------

/** Shortest query worth a round trip — one letter matches thousands of items and says nothing. */
export const MIN_QUERY = 2

export interface ItemHitsState {
  hits: PlannerItemHit[]
  loading: boolean
}

/**
 * One search per settled query, shared by the host picker and the filter bar's item picker. An
 * in-flight answer for an older query is dropped, not shown; `enabled` is the popover's own open
 * state, because a closed picker must not keep asking.
 */
export function useItemSearch(query: string, enabled: boolean): ItemHitsState {
  const [state, setState] = useState<ItemHitsState>({ hits: [], loading: false })
  useEffect(() => {
    if (!enabled || query.trim().length < MIN_QUERY) {
      setState({ hits: [], loading: false })
      return
    }
    let alive = true
    setState((prev) => ({ hits: prev.hits, loading: true }))
    void window.eq
      .plannerSearchItems(query.trim())
      .then((hits) => {
        if (alive) setState({ hits, loading: false })
      })
      .catch(() => {
        /* main never rejects; an empty list is the honest answer */
        if (alive) setState({ hits: [], loading: false })
      })
    return () => {
      alive = false
    }
  }, [query, enabled])
  return state
}

/**
 * The preset host's row in main's item index, or null while unknown (still loading, not in the
 * index). Re-runs when the preset changes; an answer for a stale preset is dropped.
 */
function useHostItem(preset: BrowsePreset | null): PlannerItemHit | null {
  const [hit, setHit] = useState<PlannerItemHit | null>(null)
  const key = preset?.hostKey ?? null
  const name = preset?.hostName ?? null

  useEffect(() => {
    setHit(null)
    if (key === null || name === null) return
    let alive = true
    void window.eq
      .plannerSearchItems(name)
      .then((hits) => {
        if (alive) setHit(hits.find((h) => h.key === key) ?? null)
      })
      .catch(() => {
        /* main never rejects; an unknown item filters by the cell alone */
      })
    return () => {
      alive = false
    }
  }, [key, name])

  return hit
}

/**
 * THE ONE ITEM THE BROWSER IS NARROWED TO — the preset's host if there is one, else the item the
 * user typed into the filter bar.
 *
 * The preset WINS while it is on, because the socket and the cell it names are facts about the item
 * window you came from rather than preferences; picking an item by hand clears it (EffectBrowser's
 * `pickItem`), so the two can never be on screen disagreeing about which item is being filled.
 *
 * A preset whose host the index carries filters by THE ITEM'S OWN SLOTS, not the cell's: R2 is a
 * rule about two items (types.ts, above `AnyCell`), so a two-slot sword hosted in PRIMARY may take
 * a SECONDARY-only donor's effect, and an any-cell — which constrains nothing — is finally narrowed
 * by the thing that does. Without the lookup it falls back to the cell's slot, which is what the
 * preset has always filtered by.
 */
export function useItemFocus(preset: BrowsePreset | null, picked: ItemFocus | null): ItemFocus | null {
  const host = useHostItem(preset)
  return useMemo(() => {
    if (preset === null) return picked
    const cellSlot = equipSlotOf(preset.slot)
    return {
      key: preset.hostKey,
      name: preset.hostName,
      cell: preset.slot,
      slots: host?.slots ?? (cellSlot === null ? [] : [cellSlot]),
      classes: host?.classes ?? []
    }
  }, [preset, picked, host])
}
