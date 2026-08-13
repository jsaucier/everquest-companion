// PLANNER ERA — THE OUT-OF-ERA OVERRIDE, SWEPT OVER THE REAL CORPUS (JOS-298).
//
// `tests/plannerEra.test.mts` proves what the rules SAY (zone folds, the tag table, the register
// mirrored key for key). This file proves what they DO to 11,351 committed item keys, because the
// rule the owner's report produced is a blunt one — an out-of-era badge overrules the drop zone —
// and a blunt rule is only safe if the set it hides is a list somebody read.
//
// THE REPORT, verbatim from the ticket: Breastplate of the Righteous "tops the breastplate AC list
// as in-era while its wiki page carries out-of-era markers all over". That page is here, decided
// from its own committed record, red-before / green-after.
//
// THE PROPERTY is one-directionality: every verdict this wave changed went in-era -> out-of-era,
// and every one of them is backed by the banner the WIKI put on the page rather than by our
// reasoning about it. Measuring a difference needs both sides, so the pre-JOS-298 rule is
// transcribed below as a dated baseline. It is not a second implementation and nothing outside
// these tests may call it.
//
// The join is the app's own (`plannerData.eraZones`): the mob catalog's zones for this item key,
// UNION the zones the item page itself named. It is rebuilt here rather than imported so this
// suite stays Electron-free and React-free; `tests/gearIndex.test.mts` asks the same question
// through the shipped renderer path, which is where a drift between the two would show.
//
// No Electron, no fixtures, no game directory ⇒ this suite never skips.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CURRENT_ERA,
  eraBadge,
  eraRank,
  eraVerdict,
  layeredVerdict,
  type Era,
  type EraVerdict
} from '../src/shared/planner/era'
import mobsJson from '../src/renderer/src/data/eqlegends/mobs.json'
import itemsJson from '../src/main/data/items.json'
import { itemKey, type ItemDbFile } from '../src/main/itemsDb'
import type { MobData } from '../src/shared/types'

const catalog = mobsJson as unknown as MobData
const corpus = itemsJson as unknown as ItemDbFile

/** itemKey → every zone the mob catalog places a dropper of it in. */
const CATALOG_ZONES_BY_ITEM = ((): Map<string, Set<string>> => {
  const m = new Map<string, Set<string>>()
  for (const mob of catalog.mobs) {
    for (const drop of mob.drops ?? []) {
      const key = itemKey(drop)
      if (key === '') continue
      let zones = m.get(key)
      if (!zones) m.set(key, (zones = new Set()))
      for (const zone of mob.zones ?? []) zones.add(zone)
    }
  }
  return m
})()

interface CorpusRow {
  key: string
  page: string
  tag?: string
  zones: string[]
  ac: number
}

const CORPUS: CorpusRow[] = Object.entries(corpus.items).map(([key, entry]) => {
  const zones = new Set(CATALOG_ZONES_BY_ITEM.get(key) ?? [])
  for (const src of entry.dropsFrom ?? []) if (src.zone !== undefined) zones.add(src.zone)
  return {
    key,
    page: entry.page,
    tag: entry.eraTag,
    zones: [...zones],
    ac: Number(entry.stats?.ac ?? 0)
  }
})

/**
 * THE VERDICT AS IT STOOD BEFORE JOS-298, transcribed on purpose. There is no other way to state
 * "this change only ever hides" as a property: the claim is about a DIFFERENCE, so both sides have
 * to be computable. Zones first and final; `eraFromTag` only into silence; `FearHateRevamp` read
 * `classic`. A dated BASELINE, not a second implementation — nothing outside this file may call
 * it, and nothing asks it for today's answer to anything.
 */
function verdictBeforeJos298(zones: readonly string[], tag: string | undefined): EraVerdict {
  const OLD_TABLE: Record<string, Era | null> = {
    classic: 'classic',
    sky: 'classic',
    fear: 'classic',
    hate: 'classic',
    fearhaterevamp: 'classic',
    temple: 'classic',
    paineel: 'classic',
    epics: 'kunark',
    epicquests: 'kunark',
    kunark: 'kunark',
    chardok: 'kunark',
    'chardok revamp': 'kunark',
    velious: 'velious',
    luclin: 'luclin',
    unknown: null
  }
  const byZone = eraVerdict(zones)
  if (byZone !== 'unknown') return byZone
  const named = tag === undefined || tag === '' ? null : (OLD_TABLE[tag.trim().toLowerCase()] ?? null)
  if (named === null) return 'unknown'
  return eraRank(named) <= eraRank(CURRENT_ERA) ? 'in-era' : 'out-of-era'
}

const FLIPPED = CORPUS.filter(
  (r) => verdictBeforeJos298(r.zones, r.tag) !== layeredVerdict(r.zones, r.tag)
)

test('THE BREASTPLATE: the row the owner reported, decided from its own committed record', () => {
  // Not a fixture — the actual entry, joined the way the app joins it. AC 42, one drop zone, and
  // that zone is one this server ships, which is precisely why the zone could not be the witness.
  const bp = CORPUS.find((r) => r.key === 'breastplate of the righteous')
  assert.ok(bp, 'Breastplate of the Righteous left the corpus')
  assert.equal(bp.page, 'Breastplate of the Righteous')
  assert.equal(bp.tag, 'FearHateRevamp')
  assert.deepEqual(bp.zones, ['Plane of Hate'])
  assert.equal(bp.ac, 42)
  assert.equal(eraVerdict(bp.zones), 'in-era', 'Plane of Hate is a zone this server ships')
  assert.equal(eraBadge(bp.tag), 'out', 'and its own page carries the red Out of Era badge')

  // RED BEFORE, GREEN AFTER. This is the whole bug in two lines.
  assert.equal(verdictBeforeJos298(bp.zones, bp.tag), 'in-era')
  assert.equal(layeredVerdict(bp.zones, bp.tag), 'out-of-era')

  // And it is a SET, not one page: the four armour families the sweep named all read out-of-era.
  for (const family of ['of the righteous', 'of the untamed', 'legionnaire scale', 'greenmist']) {
    const rows = CORPUS.filter((r) => r.key.includes(family) && r.tag !== undefined)
    assert.ok(rows.length >= 4, `only ${String(rows.length)} rows match "${family}"`)
    for (const row of rows) {
      assert.equal(layeredVerdict(row.zones, row.tag), 'out-of-era', `${row.page} [${String(row.tag)}]`)
    }
  }
})

test('the override is ONE-DIRECTIONAL over the whole corpus: it hides, it never reveals', () => {
  // THE PROPERTY. Every single verdict this wave changed went in-era -> out-of-era. Nothing that
  // was hidden became visible, and nothing that was silent started making a claim it could not
  // support — which is what makes a rule this blunt safe to ship: the worst case is a row the
  // player can still see by turning the era filter off, with a chip naming the banner responsible.
  for (const row of FLIPPED) {
    assert.equal(verdictBeforeJos298(row.zones, row.tag), 'in-era', `${row.page} was not in-era`)
    assert.equal(layeredVerdict(row.zones, row.tag), 'out-of-era', `${row.page} did not become out`)
  }

  // EVERY ONE OF THEM IS JUSTIFIED BY ITS OWN PAGE. Not by our reasoning about revamps — by the
  // banner the wiki put on the page, which `Template:PageEra` renders as a red `Out of Era` box.
  // If a row is ever hidden without that badge, this assertion names it.
  for (const row of FLIPPED) {
    assert.ok(row.tag !== undefined && row.tag !== '', `${row.page} was hidden with NO banner`)
    assert.equal(eraBadge(row.tag ?? ''), 'out', `${row.page} [${String(row.tag)}] is not badged out`)
  }

  // Measured 2026-08-13 over the refreshed scrape: 151 keys, 113 of them slotted, 80 AC-bearing,
  // spread over 7 banner tokens (FearHateRevamp 53 · Velious 31 · Kunark 27 · EpicQuests 23 ·
  // Epics 10 · Luclin 5 · Unknown 2). It read 156 against the 2026-08-05 corpus; this wave's own
  // `--refresh` corrected 5 stale banners out of the set (Bronze Tanto and the four Torn Pages of
  // Mastery, all re-bannered Classic upstream). A FLOOR, not a count — a later refresh will
  // correct more, and that must not turn this red.
  assert.ok(FLIPPED.length >= 140, `only ${String(FLIPPED.length)} verdicts changed`)
  assert.ok(FLIPPED.filter((r) => r.ac > 0).length >= 70, 'the AC-bearing damage stopped reproducing')
})

test('no banner token in the corpus reaches the register default (the new-template tripwire)', () => {
  // `eraBadge` mirrors `#default = out`, which is right — the live page renders the red box for a
  // key the switch does not know. But it means a NEW era template the wiki adds as `in` would
  // silently hide a shelf of items here. So: every token the corpus actually carries must be a key
  // the register NAMES. A rescrape that introduces one turns this red, by name, on the run that
  // introduces it — which is the moment to go and read `Template:PageEra` again.
  const NAMED = new Set([
    'classic', 'kunark', 'velious', 'luclin', 'chardok', 'chardokrevamp', 'fear', 'hate', 'hole',
    'holevp', 'sky', 'stonebrunt', 'temple', 'warrens', 'warrensfearhaterevamp', 'fearhaterevamp',
    'paineel', 'epics', 'epicquests', 'unknown'
  ])
  const tokens = new Set(CORPUS.flatMap((r) => (r.tag === undefined ? [] : [r.tag])))
  assert.ok(tokens.size >= 14, `only ${String(tokens.size)} distinct banner tokens in the corpus`)
  for (const token of tokens) {
    const folded = token.trim().toLowerCase().replace(/[\s_]+/g, '')
    assert.ok(NAMED.has(folded), `banner token "${token}" folds to "${folded}", unknown to the register`)
  }
})
