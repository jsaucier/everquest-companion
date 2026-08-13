// GearAreaTabs — the header that turns four views into one place (JOS-324).
//
// WHAT IT IS. The gear area is four views (appViews.ts `GEAR_AREA_VIEWS`) behind ONE nav row, and
// this bar is how you move between them. It is drawn above the mounted view — outside the content
// area's scroll box, so it stays put while a long table scrolls under it — and only while the
// current view is one of the four.
//
// WHY IT IS NOT A ROUTER. Every tab click calls the app's own `selectView`, the same function the
// nav drawer's rows call. That is deliberate and it is the whole reason this collapse cost no
// semantics: the Back stack treats a tab click as MANUAL navigation and drops the parked trail
// (navOrigin.ts), the outgoing view unmounts on its `viewKey` exactly as it always did, and a deep
// link into any of the four still lands with the bar already reading the right tab. A bespoke
// in-area router would have had to re-earn all three.
//
// WHY CHARACTER IS PUSHED RIGHT. Gear, Exaltations and Wish list are three phrasings of "what do I
// want"; the Character sheet is "what am I wearing", which is the answer rather than the question.
// The gap says so without a divider or a second bar. (It was also the last tab to graduate —
// UNRELEASED until JOS-327 — and sitting off the end of the run of three meant its arrival
// disturbed nothing.)
//
// The bar renders even on a machine with no character logs, where the content underneath is the
// fresh-machine empty state. That matches the nav drawer, which likewise draws every row on such a
// machine: navigation chrome that vanishes with the data would strand a reader on whichever
// surface they happened to open.

import type { JSX } from 'react'
import { Tab, Tabs } from '@mui/material'
import { GEAR_AREA_VIEWS, VIEW_LABELS, type View } from '../appViews'

/** The one tab that is not a shopping question, and is therefore held to the right-hand edge. */
const LAST_TAB: View = 'character'

/**
 * The in-area tab bar. `data-testid="tab-<view>"` is the stable handle the e2e clicks, mirroring
 * the nav drawer's `nav-<view>`; the bar itself is `gear-area-tabs`, so a spec can ask whether the
 * area is mounted at all before making a claim about which tabs it offers.
 */
export default function GearAreaTabs({
  view,
  onSelect
}: {
  view: View
  onSelect: (v: View) => void
}): JSX.Element {
  return (
    <Tabs
      data-testid="gear-area-tabs"
      value={view}
      onChange={(_e, v: View) => onSelect(v)}
      variant="standard"
      sx={{
        minHeight: 40,
        px: 2,
        borderBottom: 1,
        borderColor: 'divider',
        flexShrink: 0,
        '& .MuiTab-root': { minHeight: 40, py: 0, textTransform: 'none' }
      }}
    >
      {GEAR_AREA_VIEWS.map((v) => (
        <Tab
          key={v}
          value={v}
          label={VIEW_LABELS[v]}
          data-testid={`tab-${v}`}
          // `marginLeft: auto` on a MUI Tab works because the tab strip is a plain flex row — no
          // spacer element, which would otherwise be a focusable hole in the keyboard order.
          sx={v === LAST_TAB ? { ml: 'auto' } : undefined}
        />
      ))}
    </Tabs>
  )
}
