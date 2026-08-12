// components/OutputFileLine.tsx — ONE LINE THAT SAYS WHERE A SURFACE'S DATA CAME FROM AND HOW TO
// REFRESH IT (JOS-42 refinement 5).
//
// THE PROBLEM IT SOLVES. Several surfaces in this app are fed by a file the PLAYER writes with an
// `/outputfile <kind>` command — the Exaltations tab's worn hosts today, and whatever JOS-44's
// export-command work adopts next. Those surfaces have a failure mode that looks exactly like
// success: the data renders, it is simply OLD, because the dump is a snapshot from whenever the
// command was last typed. Nothing on screen said so. A player who swapped gear an hour ago saw
// last week's loadout presented with total confidence.
//
// SO THE LINE STATES THREE THINGS AND STOPS: the command to type, ONE clause of why it is worth
// typing, and how old the file is. That last one is the whole point — it is read from the file's
// own mtime, so it is WHEN THE PLAYER DUMPED, never when the app read it.
//
// IT IS NOT A CAVEAT, and the tooltip-and-caveat diet is why it looks like this. It does not
// apologise for the data, footnote where a number came from, or explain how the parser works; it
// is a control surface for an action the player takes in game, with the freshness as ambient
// state (the `formatAge` idiom the update chip established). One row, `nowrap`, the why-clause the
// only group allowed to ellipsize.
//
// SHARED BY CONSTRUCTION rather than by refactor-later: it takes the command and the clause as
// props and knows nothing about inventories, so a second `/outputfile` surface adopts it by
// importing it (JOS-44's sequencing note — whichever of us landed second was to use the other's).
//
// AND THE FOURTH THING (JOS-185): HOW to type it. This is not a retreat from the caveat diet — it
// is the same argument that put the command here in the first place. `/outputfile inventory` is
// CONDITIONAL: the Dragon's Hoard is exported only while its window is open, the tradeskill depot
// only if it has been loaded, and both third-party EQ Legends trackers tell their users to stand
// at a banker with the Bank up. A dump typed anywhere else is not an error, does not look like
// one, and quietly omits whole storages — which is a player's Sky weapons going missing from a
// file that parsed perfectly. So the steps are part of the CONTROL SURFACE for the action, in the
// same row as the action, and they are COLLAPSED by default: nothing about the line changes for
// somebody who is not asking, and one click gets the answer without leaving the tab.
//
// A surface with no steps to give renders exactly what it rendered before — the toggle only
// exists when `steps` is non-empty, so the three-things-and-stop contract is intact everywhere it
// was already true.

// AND THE FIFTH (JOS-253): WHEN THIS APP LAST READ IT. The four things above are all about the
// FILE — what to type, why, how to type it, how old it is — and the owner's 2026-08-12 ruling is
// that a surface fed by a dump owes the player one more fact, which is whether the thing on screen
// is that file. The two are the same number on a healthy load and diverge exactly when something
// went wrong, so the second slot costs nothing to read and is the only thing that can say "the
// game rewrote this and we are still showing you the old one". It is OPTIONAL: a surface with no
// load instant to offer renders precisely what it rendered before.

import { type JSX, useEffect, useState } from 'react'
import { Box, Button, Collapse, Paper, Stack, Typography } from '@mui/material'
import { formatDateTime } from '../lib/formatDate'
import {
  outputAgeLabel,
  outputIsStale,
  outputLoadedLabel,
  outputUpdatedMillis
} from '../lib/outputFreshness'

/** How often the age re-renders. Coarse, matching `formatAge`'s own resolution (UpdateChip). */
const AGE_TICK_MS = 60_000

/** A child's testid, or none when the line was given none. Module-level so the component stays
 *  within the measured complexity ceiling rather than carrying four copies of this ternary. */
const sub = (testId: string | undefined, part: string): string | undefined =>
  testId === undefined ? undefined : `${testId}-${part}`

/** The exact clock time behind a coarse label, or nothing when there is no instant to state. */
const clock = (at: number | undefined): string | undefined =>
  at === undefined ? undefined : formatDateTime(at)

/**
 * ONE TIME SLOT on the right-hand end: coarse words, the exact clock on hover.
 *
 * The two slots (the file's age, and — since JOS-253 — when we read it) are the SAME rendering
 * with different words and a different colour, so they are one component. That is also what keeps
 * the layout above readable: it reads as a row of groups rather than as two near-identical
 * fifteen-line blocks that a reader has to diff by eye.
 */
function Stamp({
  label,
  at,
  warn = false,
  testId
}: {
  label: string
  at: number | undefined
  warn?: boolean
  testId: string | undefined
}): JSX.Element {
  return (
    <Typography
      variant="caption"
      color={warn ? 'warning.main' : 'text.disabled'}
      title={clock(at)}
      data-testid={testId}
      sx={{ flexShrink: 0 }}
    >
      {label}
    </Typography>
  )
}

export interface OutputFileLineProps {
  /** the command as the player must type it, verbatim — e.g. `/outputfile inventory` */
  command: string
  /** ONE clause saying why it is worth typing. No caveats, no methodology. */
  why: string
  /**
   * The dump file's mtime, ISO. Absent means no file exists yet, and the line then says so in
   * words — "not yet run" — rather than claiming an age. "Never" is not a timestamp, and the
   * silence it replaced read as "no age worth mentioning" on a surface whose data does not exist
   * at all (JOS-44: the never-run state is a state, not an omission).
   */
  updatedAt?: string
  /**
   * How to type the command so it captures everything, one short imperative per step. The
   * registry owns them (`OutputKindDef.steps`); an empty list renders no toggle at all.
   */
  steps?: readonly string[]
  /**
   * Epoch ms this app last READ the dump (`InventorySource.readAt`) — a TRI-STATE, because
   * "we have never loaded it" and "this surface does not load it" are different claims and only
   * one of them belongs on screen:
   *   a number   — read at that instant.
   *   `null`     — this surface reads the dump and has NOT loaded one. Renders "not loaded yet",
   *                which is the state the JOS-253 reporter was in and could not see.
   *   `undefined`— this surface does not load the file (the default). The slot is not rendered.
   */
  loadedAt?: number | null
  testId?: string
}

export default function OutputFileLine({
  command,
  why,
  updatedAt,
  steps = [],
  loadedAt,
  testId
}: OutputFileLineProps): JSX.Element {
  const [now, setNow] = useState(() => Date.now())
  const [showSteps, setShowSteps] = useState(false)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), AGE_TICK_MS)
    return () => {
      clearInterval(t)
    }
  }, [])

  // THREE STATES, one slot on the right — never run / fresh / stale. The rule (and why "stale" is
  // not a separate rendering) lives with the words, in lib/outputFreshness.ts.
  const at = outputUpdatedMillis(updatedAt)
  const age = outputAgeLabel(at, now)
  // The second slot (JOS-253). `read` is undefined for both "never loaded" and "not our subject";
  // `loadedAt !== undefined` is what separates them, and it is a prop check rather than a value
  // check on purpose (see the prop's doc).
  const read = loadedAt ?? undefined
  const stale = outputIsStale(at, read)
  return (
    <Paper variant="outlined" data-testid={testId} sx={{ px: 1.25, py: 0.75, mb: 1 }}>
      <Stack direction="row" spacing={1} alignItems="baseline" sx={{ flexWrap: 'nowrap', minWidth: 0 }}>
        <Typography
          variant="body2"
          sx={{ fontFamily: 'monospace', fontWeight: 700, flexShrink: 0 }}
          data-testid={sub(testId, 'command')}
        >
          {command}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap sx={{ minWidth: 0, flexShrink: 1 }}>
          {why}
        </Typography>
        <Box sx={{ flexGrow: 1, minWidth: 8 }} />
        {/* The steps toggle sits BEFORE the age and never shrinks: it is a control, and the
            why-clause remains the one group allowed to give up room (the compact-bar contract). */}
        {steps.length > 0 && (
          <Button
            size="small"
            variant="text"
            onClick={() => setShowSteps((v) => !v)}
            data-testid={sub(testId, 'steps-toggle')}
            sx={{ flexShrink: 0, minWidth: 0, px: 0.75, py: 0 }}
          >
            {showSteps ? 'Hide steps' : 'How'}
          </Button>
        )}
        {/* The exact clock time is one hover away; the ambient text stays coarse (formatDate's
            own contract). This is the ONE place a tooltip is warranted here — it states the
            precise value of the number beside it, which is what makes the coarse one safe. */}
        <Stamp label={age} at={at} testId={sub(testId, 'age')} />
        {/* WHEN WE READ IT, in the same idiom as the slot beside it: coarse text, exact time on
            hover. It goes WARNING-coloured only when the file is provably newer than our copy —
            that is a fact about two instants we hold, not a staleness threshold this app invented
            (outputFreshness.ts draws that line). Everywhere else it is the same disabled grey as
            its neighbour, because on a healthy load the two say the same thing and a permanently
            highlighted number stops meaning anything. */}
        {loadedAt !== undefined && (
          <>
            {/* The separator is its OWN node and carries no testid: it is punctuation between two
                slots, and a reader of the load slot — a spec, a screen reader — should get the
                sentence rather than the sentence plus a dot. */}
            <Typography variant="caption" color="text.disabled" sx={{ flexShrink: 0 }}>
              ·
            </Typography>
            <Stamp
              label={outputLoadedLabel(read, now)}
              at={read}
              warn={stale}
              testId={sub(testId, 'loaded')}
            />
          </>
        )}
      </Stack>
      {/* Numbered because the ORDER is the content: opening the hoard after typing the command
          captures nothing, which is the whole failure this is here to prevent. */}
      <Collapse in={showSteps} unmountOnExit>
        <Box
          component="ol"
          data-testid={sub(testId, 'steps')}
          sx={{ m: 0, mt: 0.75, pl: 2.5 }}
        >
          {steps.map((s) => (
            <Typography key={s} component="li" variant="caption" color="text.secondary">
              {s}
            </Typography>
          ))}
        </Box>
      </Collapse>
    </Paper>
  )
}
