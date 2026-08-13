// gear/gearPrefs.ts — WHAT THE USER CHOSE about the Gear tab's shape, and how a stored choice
// degrades (JOS-297).
//
// TWO CHOICES, ONE SHAPE. Which numeric COLUMNS the table draws, and which FILTER CONTROLS the
// toolbar shows. Both are machine-class view preferences — they say how you like to READ the
// corpus, not anything about your character — so both live in raw `localStorage` under `eq.gear.*`
// and neither ever crosses IPC. (They shared that namespace with the sets pane's own two keys,
// `eq.gear.set` / `eq.gear.setsOpen`, until JOS-325 retired the pane; nothing reads those now.)
//
// ABSENT IS NOT EMPTY, and every function here exists to keep those two apart. `null` means the
// user has never expressed a preference, so the app's own default answers: the derived column seed
// (`gearColumns.visibleColumns`), and the full toolbar. An ARRAY — including `[]` — is a statement,
// and it wins outright. Folding the two together is the bug this file is shaped to prevent: it
// would make "I want no stat columns" unexpressible and would silently re-derive columns under
// somebody who had removed them.
//
// A STORED VALUE DEGRADES, IT NEVER ERRORS (JOS-105). Storage is a string somebody else's build
// wrote: it can be truncated JSON, an object, a key this version dropped, or the same key twice.
// The sanitizers take `unknown`, drop what they do not recognise and preserve the order of what
// they do — so a vocabulary change is a shrinking list rather than a blank tab.
//
// AND A HIDDEN CONTROL MAY NEVER BE FILTERING. `inertFilters` is the other half of a configurable
// toolbar and the half that is easy to skip: hiding "Current era" while it is ON would leave 3,000
// rows held back by a control that is not on screen to explain it, which is the exact failure the
// JOS-67 law names (a filter that can hide everything must be able to admit it). So a control that
// is hidden has its field forced to its INERT value — not its DEFAULT value, which for era is ON.
// The user's own value survives in state, so re-showing the control brings it back unchanged.
//
// PURE AND NODE-TESTABLE (relative value imports, the house law) — `tests/gearColumnPrefs.test.mts`
// drives every branch without a DOM, a React tree or a `localStorage`.

import { PICKABLE_COLUMNS } from './gearColumns'
import { DEFAULT_GEAR_FILTERS, type GearFilters, type GearSortKey } from './gearFilter'

// ---- the column choice ---------------------------------------------------------------------

const PICKABLE: ReadonlySet<string> = new Set<string>(PICKABLE_COLUMNS)

/**
 * A stored column choice, or `null` when there is none to read. Unknown keys and repeats are
 * dropped; the surviving order is the one that was stored, because the user's column order is
 * something they can see.
 */
export function sanitizeColumns(raw: unknown): GearSortKey[] | null {
  if (!Array.isArray(raw)) return null
  const out: GearSortKey[] = []
  for (const value of raw) {
    if (typeof value !== 'string' || !PICKABLE.has(value)) continue
    const key = value as GearSortKey
    if (!out.includes(key)) out.push(key)
  }
  return out
}

/**
 * Add or remove one key, ALWAYS IN VOCABULARY ORDER. Clicking a checkbox is saying "show me this
 * stat", never "and put it here" — an order that followed click history would re-arrange the table
 * under the eye every time somebody added a column, and there is no second gesture (a drag) that
 * would let them fix it. `base` is what the checkboxes were showing, which is the derived seed
 * while nothing is chosen — so the first click PROMOTES the seed to an explicit list.
 */
export function toggleColumn(base: readonly GearSortKey[], key: GearSortKey): GearSortKey[] {
  const on = new Set<string>(base)
  if (on.has(key)) on.delete(key)
  else on.add(key)
  return PICKABLE_COLUMNS.filter((k) => on.has(k))
}

// ---- the toolbar choice --------------------------------------------------------------------

/**
 * The filter bar's configurable controls, in the order the bar draws them: the WHICH ITEMS row
 * first, then the WHAT THEY READ row (GearFilterBar states that split).
 *
 * SEARCH IS NOT IN THE LIST, on purpose. Search is the tab's default surface (the owner's ruling
 * that shaped phase 3) — it is the one control that is not a narrowing of the corpus but the way
 * into it, and a Gear tab you cannot type into is not a configuration anyone meant to reach.
 */
export const GEAR_CONTROLS = ['slot', 'weapon', 'effect', 'classes', 'era', 'owned', 'upgrade'] as const

export type GearControl = (typeof GEAR_CONTROLS)[number]

/** The picker's words for each control — the control's own label, so the list reads as the bar does. */
export const GEAR_CONTROL_LABEL: Record<GearControl, string> = {
  slot: 'Slots',
  weapon: 'Weapon type',
  effect: 'Effect',
  classes: 'Classes',
  era: 'Current era',
  owned: 'Owned or looted',
  upgrade: 'Upgrade state'
}

const CONTROLS: ReadonlySet<string> = new Set<string>(GEAR_CONTROLS)

/** A stored toolbar choice, or `null` when there is none. Same degradation rules as the columns. */
export function sanitizeControls(raw: unknown): GearControl[] | null {
  if (!Array.isArray(raw)) return null
  const out: GearControl[] = []
  for (const value of raw) {
    if (typeof value !== 'string' || !CONTROLS.has(value)) continue
    const key = value as GearControl
    if (!out.includes(key)) out.push(key)
  }
  return out
}

/** Which controls the bar draws: the user's list, or all of them when they have not said. */
export function controlsVisible(chosen: readonly GearControl[] | null): ReadonlySet<GearControl> {
  return new Set<GearControl>(chosen ?? GEAR_CONTROLS)
}

/** Add or remove one control, in the bar's own order — `toggleColumn`'s argument, same reason. */
export function toggleControl(base: readonly GearControl[], key: GearControl): GearControl[] {
  const on = new Set<string>(base)
  if (on.has(key)) on.delete(key)
  else on.add(key)
  return GEAR_CONTROLS.filter((k) => on.has(k))
}

/**
 * THE FILTERS AS A HIDDEN TOOLBAR LEAVES THEM: every field whose control is off screen forced to
 * the value that does not filter. See the header on why this is inert-not-default, and on why the
 * caller keeps its own unforced copy.
 *
 * `classes` GOING EMPTY IS THE LOAD-BEARING ONE NOW (JOS-302). The class list narrows the corpus on
 * this surface, and the view fills it from DETECTION rather than from a click — so a hidden Classes
 * control would otherwise hold rows back on the strength of an inference the user never made and
 * cannot see. Empty is the only honest value for a picker that is not on screen.
 */
export function inertFilters(filters: GearFilters, visible: ReadonlySet<GearControl>): GearFilters {
  const d = DEFAULT_GEAR_FILTERS
  return {
    ...filters,
    slots: visible.has('slot') ? filters.slots : d.slots,
    weaponTypes: visible.has('weapon') ? filters.weaponTypes : d.weaponTypes,
    effect: visible.has('effect') ? filters.effect : d.effect,
    classes: visible.has('classes') ? filters.classes : [],
    // NOT `d.eraOnly` — that is `true`. Inert is the value that hides nothing.
    eraOnly: visible.has('era') ? filters.eraOnly : false,
    ownedOnly: visible.has('owned') ? filters.ownedOnly : false
  }
}
