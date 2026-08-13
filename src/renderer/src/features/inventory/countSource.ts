// features/inventory/countSource.ts — WHICH WITNESS THE APP COUNTS YOU BY, and how that choice is
// spelled on screen (JOS-294).
//
// THE DEFAULT MOVED FROM `log` TO `both`, and this file is where it moved. Four reports across
// three releases shared one root cause: a player runs `/outputfile inventory`, the app loads the
// dump by itself (JOS-253), and not one number changes — because the count source nobody had ever
// opened was `log`, and `log` reads the dump for nothing at all (reconcile.ts's `baseCounts` /
// `netCount`). A dump holding every required item read 0/2. Worse for the reporter whose log had
// been deleted: `LootModule` is an in-memory replay of the log, so a fresh log means zero held
// items, and under `log` the dump could not answer for a single one of them.
//
// AND THE FLIP IS PROVABLY A NO-OP FOR ANYONE WITHOUT A DUMP, which is why it can be a default
// change rather than a migration. With no dump loaded, `ProgressState.inventory` is `{}`, so
// `foldInventoryByKey` returns `{}` and `invByKey[k] ?? 0` is 0 for EVERY key. Then, in
// reconcile.ts:
//
//   the key set     `new Set([...keys(log), ...keys(invByKey)])` — invByKey is empty, so this is
//                   keys(log), and it is computed the same way under every source anyway.
//   baseCounts      `log`  → l                     `both` → max(l, 0) = l, since l >= 0.
//   netCount        `log`  → fromLog               `both` → max(0, fromLog) = fromLog, since
//                   fromLog is `Math.max(0, log - consumed)` and therefore >= 0 by construction.
//   the row filter  `l === 0 && i === 0 && spent === 0` — i is 0 either way and `spent` is
//                   `base - net`, identical by the two lines above.
//
// So every row, every `net` entry and the row ORDER reduce byte-identically to the log arithmetic.
// `l >= 0` is not an assumption: held counts are a sum of `e.count ?? 1` over loot lines
// (posky/heldCounts.ts), and no path subtracts. tests/countSourceDefault.test.mts pins the whole
// reduction as a deep-equality over a generated space rather than as prose.
//
// AN EXPLICIT CHOICE IS UNTOUCHED. `resolveCountSource` answers the default ONLY for a stored value
// that is absent or unreadable; every stored `log`, `inventory` or `both` comes back exactly as it
// was written. A user who picked the log on purpose keeps it, and the flip reaches only the players
// who never opened the dropdown — which is every reporter in this ticket.
//
// AND THE LABELS ARE TRUTHFUL AGAIN (JOS-294 scope D). Two of the three described JOS-128's reset
// semantics — "Export, plus loot since" and "Export if any, else log" — and JOS-141 REVERTED that
// rule nine releases ago. `inventory` is the dump EXACTLY (reconcile.ts:115,222; it never consults
// the log, and "plus loot since" was the single most misleading thing on screen for the user
// debugging why their export was not counted), and `both` is a per-item MAXIMUM, not a fallback:
// with a dump of 3 and a log of 5 it answers 5, which "Export if any, else log" says it will not.
// The labels live HERE, in one exported table, because the same three options are drawn by the Sky
// tab (QuestFilterBar) and the Loot ledger (LootChrome) off the same stored key, and they had
// drifted into two hand-maintained copies of the same wrong sentence.

import type { CountSource } from '@shared/types'

/** Where the pick is stored. One key, read by the Sky tab and the Loot ledger alike. */
export const COUNT_SOURCE_KEY = 'eq.countSource'

/**
 * What a player who has never opened the dropdown counts by (JOS-294).
 *
 * `both` and not `inventory`: the dump is a partial observation (it covers only what was OPEN when
 * it was written — JOS-141's whole argument), so making it the sole witness would hide banked items
 * from anyone whose bank window was shut. `both` takes whichever witness can vouch for more, which
 * is the only one of the three that is never worse than what the player saw before.
 */
export const DEFAULT_COUNT_SOURCE: CountSource = 'both'

const KNOWN: readonly string[] = ['log', 'inventory', 'both']

/**
 * A stored pick, or the default. `null` (never chosen) and an unreadable value both mean "this user
 * has stated nothing", which is exactly the population the default is for.
 */
export function resolveCountSource(stored: string | null): CountSource {
  return KNOWN.includes(stored ?? '') ? (stored as CountSource) : DEFAULT_COUNT_SOURCE
}

export interface CountSourceOption {
  value: CountSource
  /** the dropdown's own words */
  label: string
  /** the same fact as a sentence fragment, for a line that reads "counting from …" */
  phrase: string
}

/**
 * The three options, in the order a player widens: one witness, the other witness, both.
 *
 * Each label states what the source COUNTS and what it ignores, because the reverted labels failed
 * on exactly that: they described a combination rule the app no longer has. `only` carries the
 * ignoring half in one word, and "higher of the two" is the max rule said in the way a player
 * checking a number can verify it.
 */
export const COUNT_SOURCE_OPTIONS: readonly CountSourceOption[] = [
  {
    value: 'log',
    label: 'Log only (ever looted)',
    phrase: 'the looted log only - the inventory export is ignored'
  },
  {
    value: 'inventory',
    label: 'Export only (as dumped)',
    phrase: 'the inventory export only - the looted log is ignored'
  },
  {
    value: 'both',
    label: 'Both (higher of the two)',
    phrase: 'the log and the inventory export, whichever holds more of each item'
  }
]

/** The counting-from sentence fragment for a source. Falls back to the value, which cannot happen
 *  through `resolveCountSource` and is still not worth throwing over on a caption. */
export function countSourcePhrase(s: CountSource): string {
  return COUNT_SOURCE_OPTIONS.find((o) => o.value === s)?.phrase ?? s
}

/**
 * IS THE DUMP IN PLAY AT ALL — the gate JOS-268 put on the freshness caption, moved here in JOS-294
 * because a second surface (the Ready tab) now asks the same question.
 *
 * Two of the three sources read the export; `log` reads it for nothing, so under `log` the file
 * could be a year old or missing and not one number on screen would differ. Read as SELECTED, not
 * as offered — every option is always offered, which would make the gate a no-op.
 */
export const countsFromInventory = (s: CountSource): boolean => s !== 'log'
