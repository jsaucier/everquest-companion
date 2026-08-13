/**
 * Headless Electron integration test for the GEAR tab (JOS-284, phase 3 of the gear planner).
 *
 * WHY ITS OWN FILE: one spec per surface, all of them sharing `appHarness.mts` and running back to
 * back from `npm run test:e2e`. `EQ_E2E=1` (src/main/e2e.ts) shows no window, skips the
 * single-instance lock and points `userData` at a throwaway temp dir, so this runs invisibly
 * beside the user's game and dev app.
 *
 * WHAT IT ASSERTS, against the REAL committed item corpus and through the REAL IPC: the nav row
 * mounts a table with no set, no plan and no selection first (search is the default surface —
 * owner ruling); the list is its own bounded scroller; the search box narrows it and finds a named
 * item; the era toggle actually holds rows back; a stat threshold and a slot filter COMBINE, and
 * the threshold brings its own column with it; a header click sorts by ratio and the order is
 * monotone; and — the one this phase exists for — moving the GLOBAL plus-state selector makes the
 * table state the numbers `scaleGearRow` states at that state.
 *
 * THE FIXTURE IS THELVORN, and its numbers are not written here. The spec imports phase 0's own
 * scaler and asks it, so this file can never drift from the arithmetic it is checking: what it
 * pins is that the SCREEN agrees with `scaleGearRow`, at base and at the owner's checkpoint. The
 * base vector is copied from `tests/gearIndex.test.mts`, which asserts it against the corpus — so
 * a rescrape that changes Thelvorn turns THAT file red first, naming the corpus rather than the UI.
 *
 * The one thing it deliberately does NOT assert is a row count: the corpus grows (AGENTS.md,
 * "frozen numbers rot"), so every count here is a floor or an identity.
 *
 * Run: `npm run test:e2e -- gear`.
 */
import type { Page } from 'playwright-core'
import {
  buildIfStale,
  check,
  countOf,
  dumpArtifacts,
  failures,
  note,
  pageOverflow,
  reportRun,
  settle,
  settleCount
} from './appHarness.mjs'
import { mainWindow } from './appWindow.mjs'
import { launchOnFixture } from './logFixture.mjs'
// Phase 0's scaler and phase 2's ratio, so the EXPECTED numbers are computed rather than typed.
import { gearRatio, scaleGearRow } from '../../src/shared/planner/gearScale'
import type { GearRow } from '../../src/shared/planner/gear'
import type { ItemUpgradeState } from '../../src/shared/itemUpgrade'

const NAV = '[data-testid="nav-gear"]'
const VIEW = '[data-testid="gear-view"]'
const LIST = '[data-testid="gear-list"]'
const ROW = '[data-testid="gear-row"]'
const COUNT = '[data-testid="gear-count"]'
const EMPTY = '[data-testid="gear-empty"]'
const SEARCH = '[data-testid="gear-search"] input'
const ERA_TOGGLE = '[data-testid="gear-era-toggle"]'
const SLOT_SELECT = '[data-testid="gear-slot"] .MuiSelect-select'
const THRESHOLD = '[data-testid="gear-threshold-input"] input'
const THRESHOLD_CHIP = '[data-testid="gear-threshold-chip"]'
const SORT_RATIO = '[data-testid="gear-sort-RATIO"]'
const TIER_SLIDER = '[data-testid="gear-tier-slider"] input[type="range"]'
const FRACTION_SLIDER = '[data-testid="gear-fraction-slider"] input[type="range"]'
const UPGRADE_LABEL = '[data-testid="gear-upgrade-label"]'

/** The row key every index in this app joins on — and, from phase 4, the ownership join key. */
const THELVORN_KEY = 'thelvorn, blade of light'

/**
 * Thelvorn's BASE vector, exactly as `tests/gearIndex.test.mts` asserts the corpus states it. Only
 * the fields the scaler reads are filled in; everything else is what a `GearRow` requires.
 */
const THELVORN_BASE: GearRow = {
  key: THELVORN_KEY,
  name: 'Thelvorn, Blade of Light',
  searchKey: THELVORN_KEY,
  slots: ['PRIMARY'],
  classes: ['PAL'],
  races: ['ALL'],
  flags: [],
  quest: false,
  playerCrafted: false,
  stats: { WIS: 15, DMG: 20, DELAY: 26, WEIGHT: 3 },
  effects: []
}

/** "Tier 2   3 / 4" — the owner screenshot every phase-0 number in this repo is verified against. */
const CHECKPOINT: ItemUpgradeState = { full: 2, fraction: 3 }

function until(fn: () => Promise<boolean>, ms: number): Promise<boolean> {
  return settle(fn, (ok) => ok, { timeoutMs: ms })
}

function textOf(page: Page, sel: string): Promise<string> {
  return page.evaluate((s) => (document.querySelector(s) as HTMLElement | null)?.innerText ?? '', sel)
}

/** Box + scroll geometry — enough to prove a growing list is a BOUNDED scroller. */
function boxOf(page: Page, sel: string): Promise<{ h: number; scrollH: number; clientH: number } | null> {
  return page.evaluate((s) => {
    const el = document.querySelector(s)
    if (!el) return null
    return { h: Math.round(el.getBoundingClientRect().height), scrollH: el.scrollHeight, clientH: el.clientHeight }
  }, sel)
}

/** `"212 of 6,766 items"` → `[212, 6766]`. The readout is the only place the total is stated. */
async function counts(page: Page): Promise<{ shown: number; total: number }> {
  const text = await textOf(page, COUNT)
  const nums = [...text.matchAll(/[\d,]+/g)].map((m) => Number(m[0].replace(/,/g, '')))
  return { shown: nums[0] ?? 0, total: nums[1] ?? 0 }
}

/**
 * One numeric cell of one row, as text. `''` covers both "the row is not on screen" and "the item
 * states none" — the second is what a blank cell MEANS, and a spec that distinguished them would
 * be asserting on the windowing rather than on the number.
 */
function cellText(page: Page, key: string, column: string): Promise<string> {
  return page.evaluate(
    ([k, c]) => {
      const cell = document
        .querySelector(`[data-testid="gear-row"][data-item-key="${k}"]`)
        ?.querySelector(`[data-testid="gear-cell-${c}"]`)
      return cell instanceof HTMLElement ? cell.innerText.trim() : ''
    },
    [key, column]
  )
}

/** Type into a filter box and let the DEFERRED filter land — the count settling IS the condition. */
async function typeAndSettle(page: Page, sel: string, value: string): Promise<number> {
  await page.fill(sel, value, { timeout: 15_000 })
  let last = -1
  await settle(
    async () => {
      const { shown } = await counts(page)
      const stable = shown === last
      last = shown
      return stable
    },
    (ok) => ok,
    { timeoutMs: 15_000 }
  )
  return last
}

/** 1. THE NAV ROW MOUNTS THE TABLE — with nothing selected first. That is the owner's ruling. */
async function stepMount(page: Page): Promise<boolean> {
  const hasRow = await page.waitForSelector(NAV, { timeout: 60_000 }).then(
    () => true,
    () => false
  )
  if (!check('the nav drawer has a Gear row', hasRow)) return false
  const label = (await textOf(page, NAV)).replace(/\s+/g, ' ').trim()
  check('…and it is called Gear', label.includes('Gear'), `reads "${label}"`)
  await page.click(NAV, { timeout: 15_000 })

  const mounted = await until(async () => (await countOf(page, VIEW)) > 0, 30_000)
  if (!mounted) {
    const noLogs = (await textOf(page, 'main')).includes('No EverQuest logs found')
    check('clicking Gear mounts the table (or the no-logs empty state explains why not)', noLogs)
    if (noLogs) note('no character logs on this machine — the app shows its fresh-machine empty state')
    return false
  }
  check('clicking the Gear nav row mounts the table with no set and no selection first', mounted)
  return true
}

/** 2. THE TABLE IS THE COMMITTED CORPUS, IN A BOUNDED SCROLLER. */
async function stepRows(page: Page): Promise<boolean> {
  const listed = (await settleCount(page, ROW, 1, { timeoutMs: 60_000 })) > 0
  if (!check('the gear table renders rows from the committed item index', listed, await textOf(page, EMPTY))) {
    return false
  }
  const { shown, total } = await counts(page)
  check(
    'the table states how much of the index it is showing',
    total >= 6000 && shown > 0 && shown <= total,
    `${String(shown)} of ${String(total)}`
  )
  // WINDOWED: the mounted rows are a screenful, not the answer — the count readout is the answer.
  const mounted = await countOf(page, ROW)
  check(
    'the list is windowed — the DOM holds a screenful, never the whole result',
    mounted < shown || shown < 60,
    `${String(mounted)} rows mounted for ${String(shown)} matches`
  )
  const box = await boxOf(page, LIST)
  check(
    'the gear list is its own scroller (a growing list never grows the page)',
    box !== null && box.h > 0 && box.scrollH >= box.clientH,
    box ? `${String(box.h)}px tall · scrollHeight ${String(box.scrollH)} vs clientHeight ${String(box.clientH)}` : 'absent'
  )
  return true
}

/**
 * 3. THE ERA TOGGLE HOLDS ROWS BACK — asserted as an IDENTITY, never as a number.
 *
 * The committed corpus documents every expansion, so "off shows more" is a fact about the wiki
 * rather than about today's scrape. It is turned OFF and LEFT off: Thelvorn's era is the corpus's
 * business, and a later step reading its numbers must not depend on that verdict.
 */
async function stepEra(page: Page): Promise<void> {
  const before = (await counts(page)).shown
  await page.click(ERA_TOGGLE, { timeout: 15_000 })
  const grew = await until(async () => (await counts(page)).shown > before, 15_000)
  const after = (await counts(page)).shown
  check(
    'the Current era filter is ON by default and switching it off reveals more of the corpus',
    grew,
    `${String(before)} in era → ${String(after)} in total`
  )
}

/** 4. SEARCH NARROWS THE TABLE, and it finds an item by name. */
async function stepSearch(page: Page): Promise<boolean> {
  const total = (await counts(page)).shown
  const shown = await typeAndSettle(page, SEARCH, 'thelvorn')
  check('typing narrows the table', shown > 0 && shown < total, `${String(shown)} of ${String(total)}`)
  const found = await countOf(page, `${ROW}[data-item-key="${THELVORN_KEY}"]`)
  check('…to the item that was typed, keyed by the corpus join key', found === 1, `${String(found)} matching rows`)
  return found === 1
}

/**
 * 5. A STAT THRESHOLD AND A SLOT FILTER COMBINE — and the threshold brings its column with it.
 *
 * Asking about a stat is already saying you want to see it (gearColumns.ts), so `wis 10` must put
 * a WIS column on the table. Both filters are left ON for the sort step below.
 */
async function stepFilters(page: Page): Promise<void> {
  await typeAndSettle(page, SEARCH, '')
  const all = (await counts(page)).shown

  await page.click(SLOT_SELECT, { timeout: 15_000 })
  await page.click('[data-testid="gear-slot-PRIMARY"]', { timeout: 15_000 })
  const primaries = await until(async () => (await counts(page)).shown < all, 15_000)
  const afterSlot = (await counts(page)).shown
  check('the slot filter narrows the table to one equipment slot', primaries, `${String(afterSlot)} primaries`)

  await page.fill(THRESHOLD, 'wis 10', { timeout: 15_000 })
  await page.press(THRESHOLD, 'Enter', { timeout: 15_000 })
  const chipped = (await settleCount(page, THRESHOLD_CHIP, 1, { timeoutMs: 10_000 })) > 0
  check('a typed stat threshold becomes a chip', chipped, await textOf(page, THRESHOLD_CHIP))
  const afterBoth = (await counts(page)).shown
  check(
    'the two filters COMBINE — slot AND threshold, never one replacing the other',
    afterBoth > 0 && afterBoth < afterSlot,
    `${String(afterSlot)} primaries → ${String(afterBoth)} of them stating WIS 10+`
  )
  check(
    '…and the stat asked about gets a column of its own',
    (await countOf(page, '[data-testid="gear-sort-WIS"]')) === 1
  )
  // A threshold is met only by a row that STATES the stat, so every visible cell carries a number.
  const blanks = await page.evaluate(
    () => [...document.querySelectorAll('[data-testid="gear-cell-WIS"]')].filter((c) => (c as HTMLElement).innerText.trim() === '').length
  )
  check('every row that survived a WIS threshold states a WIS — absent is not zero', blanks === 0, `${String(blanks)} blanks`)
}

/** 6. SORTING BY RATIO IS MONOTONE, and it reads `gearRatio` rather than a second opinion. */
async function stepSort(page: Page): Promise<void> {
  await page.click(SORT_RATIO, { timeout: 15_000 })
  const ratios = await until(async () => {
    const values = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="gear-cell-RATIO"]')]
        .map((c) => (c as HTMLElement).innerText.trim())
        .filter((t) => t !== '')
    )
    return values.length > 1
  }, 15_000)
  if (!check('sorting by ratio leaves weapons on screen with ratios to compare', ratios)) return

  const values = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="gear-cell-RATIO"]')].map((c) => (c as HTMLElement).innerText.trim())
  )
  const numbers = values.filter((t) => t !== '').map(Number)
  const descending = numbers.every((n, i) => i === 0 || numbers[i - 1] >= n)
  check(
    'a ratio sort ranks the visible rows highest first',
    descending,
    numbers.slice(0, 5).map((n) => n.toFixed(2)).join(' ')
  )
  // …and NOTHING that lacks a ratio is ranked among them: an absent value sorts last, never as 0.
  const firstBlank = values.indexOf('')
  check(
    'a row with no ratio never outranks one that has a ratio',
    firstBlank === -1 || values.slice(firstBlank).every((t) => t === ''),
    `first blank at ${String(firstBlank)} of ${String(values.length)}`
  )
}

/** Focus a slider and drive it with the keyboard — the same path the control gives a user. */
async function driveSlider(page: Page, sel: string, keys: readonly string[]): Promise<void> {
  await page.focus(sel, { timeout: 15_000 })
  for (const key of keys) await page.press(sel, key, { timeout: 15_000 })
}

/** What `scaleGearRow` says this row reads at one state — the expectation, computed not typed. */
function expectedAt(state: ItemUpgradeState): { dmg: string; wis: string; ratio: string } {
  const scaled = scaleGearRow(THELVORN_BASE, state)
  return {
    dmg: String(scaled.stats.DMG),
    wis: String(scaled.stats.WIS),
    ratio: gearRatio(scaled.stats)?.toFixed(2) ?? ''
  }
}

/** The three cells this step is about, read off the screen. */
async function screenAt(page: Page): Promise<{ dmg: string; wis: string; ratio: string }> {
  return {
    dmg: await cellText(page, THELVORN_KEY, 'DMG'),
    wis: await cellText(page, THELVORN_KEY, 'WIS'),
    ratio: await cellText(page, THELVORN_KEY, 'RATIO')
  }
}

/**
 * Tier 0 → 2 (Home, then two steps), then every banked point of that tier (End on the fraction
 * slider, whose maximum IS 2^full - 1). Keyboard rather than a drag: same control, same handler,
 * no pixel arithmetic to get wrong.
 */
async function setCheckpoint(page: Page): Promise<void> {
  await driveSlider(page, TIER_SLIDER, ['Home', 'ArrowRight', 'ArrowRight'])
  const fractionAppeared = await until(async () => (await countOf(page, FRACTION_SLIDER)) > 0, 10_000)
  check('a tier with exp to bank offers the fraction slider beside it', fractionAppeared)
  if (fractionAppeared) await driveSlider(page, FRACTION_SLIDER, ['End'])

  const label = (await textOf(page, UPGRADE_LABEL)).replace(/\s+/g, ' ').trim()
  const says = label.includes('Tier 2') && label.includes('3/4') && label.includes('+27.5%')
  check('the selector says what it is simulating, in the item window’s own words', says, label)
}

/**
 * 7. THE GLOBAL PLUS-STATE SELECTOR — the one this phase exists for.
 *
 * The table is narrowed to Thelvorn, its DMG and WIS columns are asked for by threshold, and the
 * cells are read TWICE: at base, and at the owner's checkpoint (tier 2 + 3/4). Both readings are
 * compared against `scaleGearRow`'s own answer, computed here — so what is pinned is that the
 * screen and phase 0 agree, not a number somebody typed into a spec.
 */
async function stepUpgrade(page: Page): Promise<void> {
  // A fresh narrowing: the slot filter above is left on (Thelvorn is PRIMARY), and the two
  // thresholds put DMG and WIS on the table. Both are floors every tier clears, so the row cannot
  // filter itself out from under the assertion when the slider moves.
  await page.fill(THRESHOLD, 'dmg 1', { timeout: 15_000 })
  await page.press(THRESHOLD, 'Enter', { timeout: 15_000 })
  await typeAndSettle(page, SEARCH, 'thelvorn')
  const onScreen = (await countOf(page, `${ROW}[data-item-key="${THELVORN_KEY}"]`)) === 1
  if (!check('the upgrade step has its row', onScreen)) return

  const base = expectedAt({ full: 0, fraction: 0 })
  const atBase = await screenAt(page)
  check(
    'at base the table states the corpus’s own numbers',
    atBase.dmg === base.dmg && atBase.wis === base.wis,
    `screen DMG ${atBase.dmg} WIS ${atBase.wis} ratio ${atBase.ratio}`
  )

  await setCheckpoint(page)

  const want = expectedAt(CHECKPOINT)
  await until(async () => (await cellText(page, THELVORN_KEY, 'DMG')) === want.dmg, 15_000)
  const got = await screenAt(page)
  check(
    'moving the global selector restates every displayed number at that plus — scaleGearRow’s answer, exactly',
    got.dmg === want.dmg && got.wis === want.wis && got.ratio === want.ratio,
    `screen ${got.dmg}/${got.wis}/${got.ratio} · scaleGearRow ${want.dmg}/${want.wis}/${want.ratio}`
  )
  // DELAY never scales, which is the whole reason the ratio moved — 0.77 at base, 0.96 here.
  check(
    '…and the ratio moved because the damage did and the delay did not',
    want.ratio !== base.ratio,
    `${base.ratio} → ${want.ratio}`
  )
}

async function steps(page: Page): Promise<void> {
  if (!(await stepRows(page))) return
  await stepEra(page)
  if (await stepSearch(page)) {
    await stepFilters(page)
    await stepSort(page)
    await stepUpgrade(page)
  }
  const over = await pageOverflow(page)
  check(
    'Gear never scrolls the page (its table clips inside its own box)',
    over.doc === 0 && over.content === 0,
    `document +${String(over.doc)}px · content area +${String(over.content)}px`
  )
}

async function main(): Promise<void> {
  buildIfStale()

  console.log('launch: hidden Electron (EQ_E2E=1) against tests/fixtures/e2e-planner.log…')
  const { app, close } = await launchOnFixture('e2e-planner.log')

  let page: Page | null = null
  try {
    page = await mainWindow(app)
    const consoleErrors: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text())
    })
    page.on('pageerror', (e) => consoleErrors.push(String(e)))

    if (await stepMount(page)) await steps(page)

    check('no renderer console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))

    if (failures.length) await dumpArtifacts(page, 'gear-FAIL')
    else await dumpArtifacts(page, 'gear-pass')
  } finally {
    await close()
  }

  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error —', err)
  process.exitCode = 1
})
