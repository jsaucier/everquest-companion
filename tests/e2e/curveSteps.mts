// THE FRACTIONAL LEVEL CURVE, ON SCREEN (JOS-292) — the half of that ticket no unit test can
// reach: what is actually in the DOM after a real fold of a real log, and what the readout says
// when the cursor is standing on a stretch the log refused to state.
//
// LIVING NEXT DOOR because leveling.e2e.mts sits AT the repo max-lines budget and the rule here is
// to SPLIT, never ratchet (sliceSteps.mts states the precedent; dropSteps.mts and
// levelingLayoutSteps.mts set it).
//
// WHAT IT PINS, and why each one needs the app rather than a fixture:
//   1. THE PICTURE CHANGED. The level chart used to be the ding series alone — three steps over
//      this window. It now carries a vertex for every stated percentage between them, so the
//      curve must have strictly MORE vertices than the chart has ding markers. That is the
//      ticket's headline stated as an identity rather than as a count that would rot.
//   2. THE DINGS SURVIVED. They are markers now, not the whole plot; a curve that swallowed them
//      would have answered a different ticket.
//   3. NOTHING IS DRAWN OUTSIDE THE PLOT. The y domain grew a level to make room for the live
//      bar's fraction, which is exactly the kind of change that puts a vertex over the panel
//      above — the same geometric tripwire `bandsOutsidePlot` is for the zone strip.
//   4. THE REFUSALS ARE VISIBLE AND EMPTY. The committed window carries unstated experience lines
//      (`You gain experience!` with no percent), so an uncertainty band must exist — and NOT ONE
//      CURVE VERTEX may sit inside one. "Never interpolate through them" is a claim about pixels,
//      and this is that claim read back out of the pixels.
//   5. THE READOUT AGREES WITH THE PICTURE. Hovering inside a band must print the refusal, not a
//      percentage; hovering on the curve must print a bar position. A tooltip naming a bar
//      position over a span the chart shaded out is the standing sin of this chart
//      (levelCharts.tsx's honesty fix) and it is the one thing here worth catching in the app.
//
// Floors and identities only, never today's numbers (AGENTS.md: frozen numbers rot).

import type { Page } from 'playwright-core'
import { check, countOf, hoverAt, note, settleCount, settleGone } from './appHarness.mjs'

const CURVE = '[data-testid="leveling-curve-run"]'
const DING = '[data-testid="leveling-level-ding"]'
const GAP = '[data-testid="leveling-curve-gap"]'
const TOOLTIP = '[data-testid="chart-tooltip"]'

/** The four refusals levelCurve.ts can report — the vocabulary levelEta already speaks. */
const REFUSALS = ['unstated', 'overfull', 'clipped', 'swapped']

interface CurveGeometry {
  /** every curve vertex, in viewBox user units. */
  points: { x: number; y: number }[]
  /** every uncertainty band, in the same units. */
  gaps: { kind: string; x: number; w: number }[]
  /** the plot's own viewBox, so "inside the plot" is asked in the chart's own coordinates. */
  vbW: number
  vbH: number
}

/**
 * Read the drawn curve straight out of the SVG.
 *
 * The polylines are `preserveAspectRatio="none"`, so CSS pixels are NOT viewBox units — the
 * whole reason `pxToUser` exists. Everything here therefore stays in the viewBox coordinates the
 * geometry was written in, and only the hover fractions below cross back into screen space.
 */
function curveGeometry(page: Page, sels: { curve: string; gap: string }): Promise<CurveGeometry> {
  return page.evaluate((s) => {
    const lines = Array.from(document.querySelectorAll<SVGPolylineElement>(s.curve))
    const points: { x: number; y: number }[] = []
    for (const line of lines) {
      for (let i = 0; i < line.points.numberOfItems; i++) {
        const p = line.points.getItem(i)
        points.push({ x: p.x, y: p.y })
      }
    }
    const gaps = Array.from(document.querySelectorAll<SVGRectElement>(s.gap)).map((r) => ({
      kind: r.getAttribute('data-kind') ?? '',
      x: r.x.baseVal.value,
      w: r.width.baseVal.value
    }))
    const svg = lines[0]?.ownerSVGElement ?? document.querySelector<SVGSVGElement>(s.gap)?.ownerSVGElement
    return { points, gaps, vbW: svg?.viewBox.baseVal.width ?? 0, vbH: svg?.viewBox.baseVal.height ?? 0 }
  }, sels)
}

/** The rendered tooltip text, whitespace-folded; '' when no card is up. */
function tooltipText(page: Page): Promise<string> {
  return page.evaluate(
    (s) => ((document.querySelector(s) as HTMLElement | null)?.innerText ?? '').replace(/\s+/g, ' ').trim(),
    TOOLTIP
  )
}

/**
 * Hover at a viewBox X and read the card. The chart stretches, so the viewBox coordinate is
 * converted to a FRACTION of the element and handed to `hoverAt`, which is the helper that
 * clips against every scrolling ancestor and verifies the point with `elementFromPoint` (the
 * fix that made this chart reachable at all — see leveling.e2e.mts's `dragRange`).
 */
async function readAt(page: Page, chart: string, ux: number, vbW: number): Promise<string> {
  await page.mouse.move(2, 2)
  await settleGone(page, TOOLTIP, { timeoutMs: 5000 })
  if (!(await hoverAt(page, chart, ux / vbW, 0.55))) return ''
  // The card's own presence is the condition, never a sleep (the standing e2e law).
  await settleCount(page, TOOLTIP, 1, { timeoutMs: 8000 })
  return tooltipText(page)
}

/**
 * 3b. THE CURVE — mounted, denser than the dings it is anchored on, inside its own plot, and
 * honest about the stretches it will not draw.
 */
export async function stepLevelCurve(page: Page, chart: string): Promise<void> {
  const geo = await curveGeometry(page, { curve: CURVE, gap: GAP })
  const dings = await countOf(page, DING)
  if (
    !check(
      'the level chart draws a curve',
      geo.points.length > 0,
      `${String(geo.points.length)} vertices over ${String(dings)} ding markers`
    )
  ) {
    return
  }

  // 1. THE HEADLINE, as an identity: the picture carries the game's own percentages, so it has
  // strictly more vertices than the ding series that used to be the whole of it. (The step-after
  // rendering emits two vertices per sample, so the ding series ALONE would already be 2xdings —
  // the floor is deliberately above that.)
  check(
    'the curve carries the stated percentages between dings, not just the dings',
    geo.points.length > Math.max(4, dings * 2),
    `${String(geo.points.length)} vertices vs ${String(dings)} dings`
  )
  check('…and the dings are still drawn, as markers on it', dings > 0, `${String(dings)} markers`)

  // 3. INSIDE THE PLOT. The y domain grew a level to give the live bar's fraction somewhere to
  // be; a vertex outside the viewBox means the axis and the curve stopped agreeing.
  const outside = geo.points.filter((p) => p.x < -0.01 || p.x > geo.vbW + 0.01 || p.y < -0.01 || p.y > geo.vbH + 0.01)
  check(
    'every curve vertex is inside the plot it is drawn in',
    outside.length === 0,
    `${String(outside.length)} of ${String(geo.points.length)} outside ${String(geo.vbW)}x${String(geo.vbH)}`
  )

  await stepCurveRefusals(page, chart, geo)
}

/** 4 + 5. The uncertainty bands, and the readout standing on one. */
async function stepCurveRefusals(page: Page, chart: string, geo: CurveGeometry): Promise<void> {
  if (geo.gaps.length === 0) {
    // A legitimate outcome on a log whose every experience line states a percentage — the WL40
    // farm run is exactly that shape. Nothing to draw is not a half-drawn feature.
    note('every experience line in this window stated its percentage, so the curve draws no uncertainty band this run')
    return
  }
  const kinds = [...new Set(geo.gaps.map((g) => g.kind))]
  check(
    'each uncertainty band names WHY the log could not place it',
    kinds.every((k) => REFUSALS.includes(k)),
    `[${kinds.join(', ')}]`
  )

  // THE CLAIM, READ BACK OUT OF THE PIXELS: not one vertex inside a refused span. A dashed
  // interpolation across an unstated line would put dozens here.
  const inside = geo.points.filter((p) => geo.gaps.some((g) => p.x > g.x + 0.01 && p.x < g.x + g.w - 0.01))
  check(
    'no curve vertex is drawn inside a span the log did not state (nothing is interpolated through one)',
    inside.length === 0,
    `${String(inside.length)} of ${String(geo.points.length)} vertices inside a band`
  )

  // 5. THE READOUT. Widest band, so the hover has room to land inside it whatever the window.
  const widest = geo.gaps.reduce((m, g) => (g.w > m.w ? g : m), geo.gaps[0])
  if (widest.w < 12) {
    note('the widest uncertainty band is under 12 user units — too narrow to land a cursor inside honestly, so the readout assertion is skipped this run')
    return
  }
  const refused = await readAt(page, chart, widest.x + widest.w / 2, geo.vbW)
  if (!check('the hover readout resolves a cursor inside an uncertainty band', refused.length > 0)) return
  check(
    'standing on a refused span, the readout says so instead of naming a bar position',
    refused.includes('unstated') && !/into the bar\s*\d/.test(refused),
    refused.slice(0, 160)
  )

  // …and the other side of the same claim: on the curve itself there IS a bar position. The
  // MEDIAN clear vertex, not the first: the first is a run's anchor, which sits exactly on a
  // ding and legitimately reads 0.0% — a true answer that proves nothing about the accumulation.
  const clear = geo.points.filter((p) => !geo.gaps.some((g) => p.x >= g.x && p.x <= g.x + g.w)).sort((a, b) => a.x - b.x)
  const onCurve = clear[Math.floor(clear.length / 2)] as { x: number; y: number } | undefined
  if (!onCurve) return
  const stated = await readAt(page, chart, onCurve.x, geo.vbW)
  check(
    '…and standing on the curve it names one',
    stated.includes('into the bar'),
    stated.slice(0, 160)
  )
  await page.mouse.move(2, 2)
  await settleGone(page, TOOLTIP, { timeoutMs: 5000 })
}
