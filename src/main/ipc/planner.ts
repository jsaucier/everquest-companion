// IPC: the EXALTATION PLANNER's door (docs/plans/exaltation-planner.md §4.1, §6).
//
// Two reads over the committed item corpus and one per-character read/write pair. Nothing here
// touches the network, and nothing rejects: the corpus is compiled into this bundle.
//
// LAZY + MEMOIZED. `items.json` is already an ES import in `itemLookup.ts` (electron-vite inlines
// it), so importing the same module here costs no extra bytes — but WALKING it does, so the index
// is built on the first call and kept for the life of the process. An install that never opens
// the Planner never pays for it; one that opens it twice pays once. Same shape as itemLookup's
// module-scope index, just deferred.
//
// The renderer is UNTRUSTED, here as everywhere: the search query must be a string, and a set
// list is re-validated field by field against the closed slot/socket/class allowlists
// (../planner/validate.ts) before a byte of it reaches the store.

import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import { equippedHosts, type PlannerInventory } from '../../shared/planner/inventorySlots'
import { buildPlannerIndex, searchPlannerItems, type PlannerIndex } from '../planner/effectIndex'
import { buildGearIndex } from '../planner/gearIndex'
import type { GearIndexPayload } from '../../shared/planner/gear'
import { sanitizeExaltPlans } from '../planner/validate'
import { loadInventoryDump } from '../outputs'
import { activeCharId, getActiveCharacter } from '../session'
import { getExaltPlans, setExaltPlans } from '../store'
import { itemKey, type ItemDbFile } from '../itemsDb'
// The COMMITTED wiki item database — the same module itemLookup.ts imports, so the JSON is
// inlined into the main bundle exactly once.
import itemsJson from '../data/items.json'

let index: PlannerIndex | null = null
let gear: GearIndexPayload | null = null

/** The donor + item indices, built on first use. */
function plannerIndex(): PlannerIndex {
  index ??= buildPlannerIndex(itemsJson as unknown as ItemDbFile)
  return index
}

/**
 * The GEAR candidate index (JOS-283), memoized the same way and for the same reason. It lives in
 * THIS file rather than a gear-only handler module because the memoization is per-import of a
 * committed corpus: two handler modules would each hold their own walk of the same 8.6 MB.
 */
function gearIndex(): GearIndexPayload {
  gear ??= buildGearIndex(itemsJson as unknown as ItemDbFile)
  return gear
}

export function registerPlannerIpc(): void {
  // Every effect the corpus states, one row per (item, effect). The renderer fetches this once
  // and keeps it — it is derived from committed bytes and cannot change while the app runs.
  ipcMain.handle(IPC.plannerDonors, () => plannerIndex().donors)

  // Every equippable item, described in numbers (JOS-283). One versioned payload, fetched once —
  // the renderer scales it to any plus-state itself (shared/planner/gearScale.ts), so no upgrade
  // slider ever comes back here.
  ipcMain.handle(IPC.gearIndex, (): GearIndexPayload => gearIndex())

  // Host picking: substring over item names, capped. A non-string query is not an error the UI
  // should have to render — it is simply no hits.
  ipcMain.handle(IPC.plannerSearchItems, (_e, query: unknown) =>
    typeof query === 'string' ? searchPlannerItems(plannerIndex().items, query) : []
  )

  // V7 — what the character is WEARING, from their newest `/outputfile inventory` dump. Read on
  // demand (the dump is a file already on disk and parses in milliseconds; nothing is persisted —
  // outputs/index.ts states why) and never cached here, because the renderer re-asks on the
  // auto-reload push and a cache would hand it the answer from before the player typed the
  // command. No dump ⇒ null, which is the Inventory tab's instructions card, not an error.
  ipcMain.handle(IPC.plannerInventory, (): PlannerInventory | null => {
    const character = getActiveCharacter()
    const loaded = loadInventoryDump(character?.name, character?.server)
    if (!loaded) return null
    return {
      path: loaded.path,
      loadedAt: loaded.loadedAt,
      // `itemKey` is applied HERE and not in the shared join: the key is main's definition
      // (itemsDb.ts, law 2) and shared/planner/inventorySlots.ts must stay dependency-free.
      hosts: equippedHosts(loaded.dump).map((h) => ({ ...h, key: itemKey(h.name) }))
    }
  })

  // The active character's sets. Both directions run through the same validator (see store.ts).
  ipcMain.handle(IPC.plannerGetPlans, () => getExaltPlans(activeCharId()))
  // Validated AT THE HANDLER (and again in the store, where it is also the READ path's
  // normalizer — sanitizing is a fixed point, so the second pass costs nothing and the store can
  // never be reached by an unvalidated route).
  ipcMain.handle(IPC.plannerSetPlans, (_e, plans: unknown) => {
    setExaltPlans(activeCharId(), sanitizeExaltPlans(plans))
  })
}
