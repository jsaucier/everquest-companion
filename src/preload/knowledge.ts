// knowledge.ts — the slice of the main app's bridge that asks main WHAT SOMETHING IS: a spell, an
// item, a mob. The renderer-side twin of src/main/ipc/knowledge.ts, method for method.
//
// A separate file for FILE MASS, not for scope: src/preload/index.ts sits at the measured
// 400-code-line ceiling and the rule here is to SPLIT rather than ratchet (roster.ts, windows.ts,
// sounds.ts and perf.ts are the same pattern). This object is spread into that bridge, so every
// method below is an ordinary member of the one `window.eq` surface and no call site moved.
//
// THEY SHARE ONE PROPERTY AND IT IS WHY THEY ARE ONE FILE: none of them ever rejects. Main
// degrades an unknown spell to a `found:false` record and a failed item/mob fetch to a cached
// negative or offline one, so a card body can render the answer instead of a spinner that never
// resolves. A renderer that has to handle a rejection here is a renderer reading a bug.

import { ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { ItemKnowledge, MobKnowledge, SpellCatalog } from '../shared/types'
import type { LevelUnlockData } from '../shared/levelUnlocks'
// The rich spell card's record (JOS-293) — one definition for main's join, this bridge and the card.
import type { SpellDetail } from '../shared/spellDetail'

export const knowledgeBridge = {
  /** Suggested-alerts wizard (Task #38): the searchable spell catalog + live usage. */
  getSpellCatalog: (): Promise<SpellCatalog> => ipcRenderer.invoke(IPC.spellsCatalog),
  /**
   * ONE spell, in full (JOS-293) — what the rich hover card draws: every field spells.json states
   * for this name, the effect classes derived from its effect list, and the ranks of its line that
   * a source names. A name no page carries comes back as a `found: false` record.
   *
   * A DEDICATED CHANNEL rather than another flag on the catalog: it takes an argument and answers
   * about one row. See `getLevelUnlocks` below for the arrangement this one is deliberately not.
   */
  lookupSpell: (name: string): Promise<SpellDetail> => ipcRenderer.invoke(IPC.spellsDetail, name),
  /**
   * "What's new at this level" (docs/plans/levelup-whats-new.md): every (class, level) unlock the
   * committed DBs state — spells from spells.json, skills/discs/innates from classes.json.
   *
   * The SAME channel as the catalog above, with a flag, because shared/ipc.ts belonged to a
   * concurrent wave the day this landed. Two questions of one door, both about the spell DB; the
   * flag is re-validated in main. A dedicated channel is the right shape and is three lines away.
   */
  getLevelUnlocks: (): Promise<LevelUnlockData> => ipcRenderer.invoke(IPC.spellsCatalog, { unlocks: true }),
  /**
   * Item knowledge (Task #53): "what's this lore/quest item for" — local posky-first, then a
   * cached, politely-throttled wiki lookup. Never rejects (degrades to a cached-negative/offline
   * record that still carries local posky associations).
   */
  lookupItem: (name: string): Promise<ItemKnowledge> => ipcRenderer.invoke(IPC.itemsLookup, name),
  /**
   * Mob knowledge (Task #63): "what does this thing drop" — your own loot history + the local
   * quest catalog first, then a cached, politely-throttled wiki lookup. Never rejects.
   */
  lookupMob: (name: string): Promise<MobKnowledge> => ipcRenderer.invoke(IPC.mobsLookup, name)
}
