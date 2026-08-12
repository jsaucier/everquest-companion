/**
 * Headless Electron integration test for THE SKY TAB LOADING THE INVENTORY DUMP BY ITSELF (JOS-253).
 *
 * THE REPORT (feedback 01KZV7C6F9GB93XCZCJSGJJKWA, v0.23.0): the inventory reload button in the
 * Plane of Sky section stays disabled even after running `/outputfile` in game. There was no log
 * slice with it, and there did not need to be — the cause is one clause in `QuestFilterBar.tsx`,
 * `disabled={countSource === 'log'}`, and `log` is the DEFAULT count source. So the control was
 * born disabled on a fresh install and no detection path was ever consulted: the app never looked
 * for the reporter's file, never failed to find it, and never said anything either way. The same
 * clause hid the freshness line, so the tab's whole answer to "I ran the command, why did nothing
 * happen?" was blank space.
 *
 * THE OWNER'S RULING (2026-08-12) is that the button was the wrong shape of answer regardless:
 * stop making the user press one. Load the dump when it changes, the way the app already follows
 * files, and show BOTH instants — when the file was written and when we read it — so a stale copy
 * is visibly stale.
 *
 * WHY THIS NEEDS A REAL APP, AND A REAL FILE. Every piece of the arc is a seam between processes:
 * chokidar in main sees a write into the EQ install root → the outputs registry re-finds and
 * re-stats the file → `loadInventory` parses it and stamps `readAt` → the store → two IPC pushes →
 * a hook re-asking `outputsStatus` and a hook re-reading progress → two words on a line. Unit
 * tests can pin the WORDS (tests/outputsRegistry.test.mts owns the three-plus-two states without a
 * DOM) and cannot pin the chain, and this ticket is entirely the chain. So the assertions here are
 * driven by WRITING THE DUMP into the staged install — the same act as typing the command in game —
 * and read off the line a player is looking at.
 *
 * TWO LAUNCHES, BECAUSE "IT FOLLOWS THE FILE" IS TWO PROMISES.
 *
 *   LAUNCH 1 — a machine where `/outputfile inventory` has NEVER been run (the staged install has
 *   a log and nothing else, which is what every e2e launch used to be). It pins the regression
 *   first: with the count source untouched at its default, the freshness line is on screen and the
 *   Reload button is ENABLED. Then the dump is written while the app is up, and the two slots have
 *   to go from "not yet run"/"not loaded yet" to a pair of real instants WITH NO CLICK. That is the
 *   watcher's appear-then-arm path (`watchForOutputFile`), which is exactly the player the
 *   instructions card is talking to.
 *
 *   LAUNCH 2 — the dump is rewritten while the app is DOWN, then the app comes back on the SAME
 *   userData dir. A watcher cannot see a change that predates it (`ignoreInitial: true`), so
 *   nothing but the startup read can move the load instant here — and before this ticket nothing
 *   did: the store kept the previous run's copy and the app tailed a character against a dump it
 *   had never opened. The assertion is that the load instant DIFFERS from the one launch 1 ended
 *   on, which is locale-independent and cannot be satisfied by the watcher.
 *
 * WHY THE LOAD INSTANT IS READ AS A `title` AND NOT AS TEXT. The visible words are deliberately
 * coarse (`formatAge`: anything under 90 seconds is "just now"), so two loads a few seconds apart
 * read identically — the text is right for a human and useless as evidence. The exact clock is
 * already on the element as its tooltip, for the reason OutputFileLine states, so the spec reads
 * the precise value and compares STRINGS rather than parsing a localised date.
 *
 * AND THE STALE COLOUR IS READ AS A RELATION, not as a hex value: the load slot goes warning-
 * coloured only when the file is newer than our copy, so "not stale" is asserted as "the same
 * colour as the age slot beside it". That survives a theme change, which comparing against a
 * literal would not.
 *
 * WHAT IT DOES NOT ASSERT: which items the dump adds to the held counts. That is
 * `reconcile`/`heldCountsFromDump`, pinned against the real 295-row dump without a browser
 * (tests/outputsInventory.test.mts, tests/inventoryBaseline.test.mts), and repeating it here would
 * only make this spec depend on the committed dump staying the shape it is. The subject here is
 * whether the app NOTICES the file.
 *
 * WHY IT NEVER TAKES THE SCREEN: `EQ_E2E=1` (src/main/e2e.ts) shows no window, skips the
 * single-instance lock, and points `userData` at a throwaway temp dir per launch.
 *
 * Run: `npm run test:e2e -- sky-inventory-autoload`.
 */
import type { Page } from 'playwright-core'
import { buildIfStale, check, countOf, dumpArtifacts, failures, reportRun, settle } from './appHarness.mjs'
import { mainWindow, makeUserData, removeUserData } from './appWindow.mjs'
import { launchOnFixture, stageFixture, writeInventoryDump, type FixtureLog } from './logFixture.mjs'

const NAV_SKY = '[data-testid="nav-posky"]'
const NAV_OVERVIEW = '[data-testid="nav-overview"]'
/** The `/outputfile` line the Sky tab renders — the whole surface under test. */
const FRESH = '[data-testid="posky-inventory-fresh"]'
/** Its two slots: when the PLAYER wrote the dump, and when THIS APP read it. */
const AGE = '[data-testid="posky-inventory-fresh-age"]'
const LOADED = '[data-testid="posky-inventory-fresh-loaded"]'
/** The control the report was about. */
const RELOAD = '[data-testid="posky-reload-inventory"]'
/** The dropdown whose untouched default disabled it. */
const COUNT_SOURCE = '[data-testid="posky-count-source"] [role="combobox"]'
/** The committed dump a real `/outputfile inventory` produced (tests/fixtures/). */
const DUMP = 'Primitive_freeport-Inventory.txt'

/** A slot, as the user sees it and as the DOM knows it: the words, the exact clock, the colour. */
interface Slot {
  text: string
  title: string
  color: string
}

function slot(page: Page, sel: string): Promise<Slot> {
  return page.evaluate((s) => {
    const el = document.querySelector(s)
    if (!el) return { text: '', title: '', color: '' }
    return {
      text: (el as HTMLElement).innerText.trim(),
      title: el.getAttribute('title') ?? '',
      color: getComputedStyle(el).color
    }
  }, sel)
}

function appears(page: Page, sel: string, ms = 20_000): Promise<boolean> {
  return page.waitForSelector(sel, { timeout: ms }).then(
    () => true,
    () => false
  )
}

/** Land, then open the Sky tab on the filter bar the report is about. */
async function openSky(page: Page): Promise<boolean> {
  if (!check('the app lands on the nav', await appears(page, NAV_OVERVIEW, 60_000))) return false
  await page.click(NAV_SKY, { timeout: 30_000 })
  return check('the Sky tab opens on its filter bar', await appears(page, RELOAD, 60_000))
}

/**
 * THE REGRESSION, pinned before anything else moves: with the count source never touched, the line
 * is on screen and the button can be pressed.
 *
 * The count source is read first and asserted to BE the default, because that is the whole
 * precondition — a spec that clicked the dropdown on its way in would be testing the state the
 * reporter was never in. `Log (ever looted)` is the option label `loadCountSource`'s `'log'`
 * renders (QuestFilterBar's `InventorySource`).
 */
async function stepDefaultSourceStillOffersBoth(page: Page): Promise<void> {
  const source = await page.evaluate(
    (s) => (document.querySelector(s) as HTMLElement | null)?.innerText.trim() ?? '',
    COUNT_SOURCE
  )
  check('the count source starts at its stored default', source === 'Log (ever looted)', source)
  const disabled = await page.evaluate(
    (s) => (document.querySelector(s) as HTMLButtonElement | null)?.disabled ?? null,
    RELOAD
  )
  // THE REPORTED DEFECT, as one boolean.
  check('the Reload inventory button is enabled under that default', disabled === false, `disabled=${String(disabled)}`)
  check('…and the freshness line is on screen beside it', (await countOf(page, FRESH)) === 1)
}

/** The never-run pair: the player has typed nothing and we have loaded nothing, said separately. */
async function stepNeverRun(page: Page): Promise<void> {
  const age = await slot(page, AGE)
  const loaded = await slot(page, LOADED)
  check('with no dump on the machine, the file slot says the command was never run', age.text === 'not yet run', age.text)
  check('…and the load slot says so in its own words — a different fact', loaded.text === 'not loaded yet', loaded.text)
  // Neither can claim an instant it does not have, so neither carries an exact clock.
  check('…neither slot offers a clock time it does not have', age.title === '' && loaded.title === '', `${age.title} | ${loaded.title}`)
}

/**
 * THE ACCEPTANCE CRITERION: write the dump — the simulated `/outputfile inventory` — and touch
 * nothing else. Both instants have to appear.
 *
 * `settle` rather than a sleep, per the suite's law: the watcher holds the change until the file
 * has been the same size for 400 ms (outputs/watch.ts) and then a whole chain runs, so the only
 * honest wait is on the reading itself.
 */
async function stepAutoLoads(page: Page, installDir: string): Promise<Slot | null> {
  writeInventoryDump(installDir, DUMP)
  const age = await settle(
    () => slot(page, AGE),
    (s) => s.text !== 'not yet run',
    { timeoutMs: 30_000 }
  )
  if (!check('a dump written while the app is up is picked up with NO click', age.text !== 'not yet run', age.text)) {
    return null
  }
  check('…and the file slot dates it from the file itself', age.text === 'updated just now', age.text)
  check('…with the exact write time one hover away', age.title.length > 0, age.title)

  const loaded = await settle(
    () => slot(page, LOADED),
    (s) => s.text !== 'not loaded yet',
    { timeoutMs: 30_000 }
  )
  check('…and the load slot stops saying we have never read one', loaded.text === 'loaded just now', loaded.text)
  check('…carrying the instant WE read it', loaded.title.length > 0, loaded.title)
  // A load that just happened is never behind the file it just read.
  check(
    '…and a fresh load is not flagged stale (same colour as the slot beside it)',
    loaded.color === age.color,
    `loaded=${loaded.color} age=${age.color}`
  )
  return loaded
}

/**
 * THE OTHER HALF: a dump rewritten while the app was DOWN.
 *
 * The watcher is armed `ignoreInitial: true` and cannot see this write, so the load instant can
 * only move if main READS the dump when the session starts — which is what JOS-253 added beside
 * the watch, mirroring the log's own scan-then-tail. Compared as a string against what launch 1
 * ended on, because the visible words are too coarse to tell two loads a minute apart apart.
 */
async function stepStartupRead(page: Page, before: Slot): Promise<void> {
  const loaded = await settle(
    () => slot(page, LOADED),
    (s) => s.title.length > 0 && s.title !== before.title,
    { timeoutMs: 30_000 }
  )
  check(
    'a dump rewritten while the app was closed is read at startup, not left for a click',
    loaded.title !== '' && loaded.title !== before.title,
    `launch 1 read at ${before.title} · launch 2 read at ${loaded.title}`
  )
  const age = await slot(page, AGE)
  check('…so the app is not showing a copy older than the file (no stale flag)', loaded.color === age.color, `loaded=${loaded.color} age=${age.color}`)
  check('…and the file is dated from disk, as it always was', age.title.length > 0, age.title)
}

/**
 * ONE LAUNCH, WITH ITS CONSOLE WATCHED AND ITS ARTIFACTS DROPPED — the boilerplate both launches
 * need, factored so `main` reads as the two-act story the header describes rather than as four
 * levels of nesting. `run` gets the page and returns nothing; whatever it wants to keep it keeps
 * by closure.
 */
async function launch(
  log: FixtureLog,
  userData: string,
  tag: string,
  run: (page: Page) => Promise<void>
): Promise<void> {
  const app = await launchOnFixture(log, { userData })
  try {
    const page = await mainWindow(app.app)
    const consoleErrors: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text())
    })
    page.on('pageerror', (e) => consoleErrors.push(String(e)))

    await run(page)

    check(`no renderer console errors (${tag})`, consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
    await dumpArtifacts(page, failures.length ? `${tag}-FAIL` : `${tag}-pass`)
  } finally {
    await app.close()
  }
}

async function main(): Promise<void> {
  buildIfStale()

  // Owned by this spec: the startup-read assertion IS one launch's record outliving its process.
  const userData = makeUserData()
  // No `inventory:` option — launch 1's whole point is a machine that has never run the command.
  const log: FixtureLog = stageFixture('e2e-copy.log')
  let readAt: Slot | null = null

  try {
    console.log('launch 1: never-run machine, then write the dump underneath it…')
    await launch(log, userData, 'sky-inventory-autoload-1', async (page) => {
      if (!(await openSky(page))) return
      await stepDefaultSourceStillOffersBoth(page)
      await stepNeverRun(page)
      readAt = await stepAutoLoads(page, log.installDir)
    })

    const before = readAt
    if (before === null) {
      check('launch 1 never loaded a dump, so the startup read cannot be measured', false)
    } else {
      // THE WRITE THE APP CANNOT WATCH: it happens between the two processes.
      writeInventoryDump(log.installDir, DUMP)
      console.log('launch 2: same userData, a dump rewritten while nothing was running…')
      await launch(log, userData, 'sky-inventory-autoload-2', async (page) => {
        if (await openSky(page)) await stepStartupRead(page, before)
      })
    }
  } finally {
    await log.dispose()
    await removeUserData(userData)
  }

  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error —', err)
  process.exitCode = 1
})
