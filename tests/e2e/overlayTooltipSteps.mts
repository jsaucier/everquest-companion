// JOS-358 — TOOLTIPS LIVE IN THE TITLE BAR, AND NEVER OUTLIVE THE MOUSE.
//
// OWNER RULING, 2026-08-14, from hands-on testing and release-blocking, both halves: tooltips come
// off everything on the overlay windows EXCEPT the title bar (the unlock control keeps its own, by
// name), and "when your mouse leaves the window its sometimes leaving a tooltip behind".
//
// WHY THE REAL APP IS ASKED. tests/overlayTooltipPolicy.test.mts sweeps the SOURCE and drives the
// strip/restore bookkeeping directly, which is everything a node test can hold — a native tooltip
// is drawn by the widget and is not in the DOM at all. What only a running window can say is what
// the rendered tree actually carries, and that the dismissal is genuinely wired to the events.
//
// A SHARED STEPS MODULE, like overlayScopeSteps/overlayTotalSteps beside it: the claim belongs to
// every overlay kind, and both specs that host it were already at the repo's measured 400-line
// ceiling (AGENTS.md: split, never ratchet).

import type { Page } from 'playwright-core'
import { check, settle } from './appHarness.mjs'

/** The lock/unlock pin — the one control the ruling names by hand. Selected by the aria-label the
 *  shared IconButton carries, in whichever of its two states the window is in. */
const PIN = 'button[aria-label^="Lock"], button[aria-label^="Unlock"]'

/** What a window's tooltips look like right now, split at the title bar.
 *
 *  The header row is found through the DRAG GUTTER's parent rather than by a testid of its own:
 *  the gutter is the one element that exists only inside `OverlayHeader`, on every kind, in both
 *  modes (tests/e2e/overlayScopeSteps.mts aims at it for the same reason). */
function readTitles(page: Page): Promise<{ outside: string[]; inside: number }> {
  return page.evaluate(() => {
    const header = document.querySelector('[data-testid="overlay-drag-gutter"]')?.parentElement ?? null
    const all = [...document.querySelectorAll<HTMLElement>('[title]')]
    return {
      outside: all.filter((e) => !header?.contains(e)).map((e) => e.title),
      inside: all.filter((e) => header?.contains(e)).length
    }
  })
}

/**
 * THE POLICY, on whichever window is handed over: nothing below the title bar hovers, and the title
 * bar still does. Both halves matter — a blanket strip would pass the first and break the second,
 * and the second is the half the owner asked for explicitly.
 */
export async function stepTitleBarOnlyTooltips(page: Page, who: string): Promise<void> {
  const seen = await readTitles(page)
  check(`nothing below ${who}'s title bar hovers anything`, seen.outside.length === 0, JSON.stringify(seen.outside))
  check('…and the title bar itself still does', seen.inside > 0, `${String(seen.inside)} in the header`)
}

/**
 * …AND THE ROWS SPECIFICALLY, where a caller has some. Read off the row element rather than swept
 * out of the document, so the failure message names the surface that regressed.
 */
export async function stepRowsHoverNothing(page: Page, rowTestId: string): Promise<void> {
  const titles = await page.evaluate(
    (sel) => [...document.querySelectorAll<HTMLElement>(`[data-testid="${sel}"]`)].map((e) => e.title),
    rowTestId
  )
  if (!check(`there are ${rowTestId} rows to make the claim about`, titles.length > 0)) return
  check(`no ${rowTestId} hovers anything`, titles.every((t) => t === ''), JSON.stringify(titles))
}

/**
 * THE ORPHAN, and the owner's own case spelled for a window that has no cursor.
 *
 * An always-on-top frameless overlay loses the FOREGROUND when the pointer jumps onto the game, and
 * it need never receive a mouse-leave at all — so the blur is the signal dispatched here. The strip
 * is observed SYNCHRONOUSLY inside the dispatch, because the restore is a task of its own: if the
 * attribute is still there when `dispatchEvent` returns, the popup is already stranded over EQ.
 *
 * AND IT COMES BACK. A dismissal that kept the attribute off would have silently deleted the one
 * tooltip the ruling asks to keep, which is the failure mode worth a second assertion.
 */
export async function stepTooltipLeavesWithThePointer(page: Page): Promise<void> {
  const pass = await page.evaluate((sel) => {
    const pin = document.querySelector(sel)
    const before = pin?.getAttribute('title') ?? ''
    window.dispatchEvent(new Event('blur'))
    return { before, during: pin?.getAttribute('title') ?? '' }
  }, PIN)
  if (
    !check(
      'the pin’s tooltip is dismissed the moment the window loses the pointer',
      pass.before.length > 0 && pass.during === '',
      JSON.stringify(pass)
    )
  )
    return
  const restored = await settle(
    () => page.evaluate((sel) => document.querySelector(sel)?.getAttribute('title') ?? '', PIN),
    (t) => t.length > 0,
    { timeoutMs: 10_000 }
  )
  check('…and is back for the next hover, not deleted', restored === pass.before, restored)
}
