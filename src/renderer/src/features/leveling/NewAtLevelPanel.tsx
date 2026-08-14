// "New at this level" — what a level gave (or will give) THIS loadout
// (docs/plans/levelup-whats-new.md §0, §2). The panel the level-up toast links to.
//
// IT IS BROWSABLE, NOT JUST HISTORICAL. The stepper defaults to the character's current level —
// the question you have the instant you ding — but stepping it answers "what do I get at 30?"
// without waiting for 30. Same data, same join, no second code path.
//
// THE COMBO IS JOINED AT READ (law 10) and never guessed at (law 1). Chips are FILLED for the
// classes the module has actually resolved and OUTLINED for candidates of a slot it has only
// narrowed; when any slot is unresolved the header says `~ambiguous` and the lists are honestly
// an upper bound — the classes you might be running, not the ones you are.
//
// A LOADOUT WITH NO SPELLS IS NOT AN ERROR. BER, MNK and WAR have zero Template:Spellpage spells
// (measured, wave O1): their spells list is empty at every level and says so in words, while the
// skills list carries everything they actually gain.
//
// AND THE WAY OUT IS ON SCREEN WHETHER OR NOT THE LOADOUT IS KNOWN (JOS-192, trigger report
// 01KZP6SDZJK6BPEWA4Z0MF5ANG). This panel pointed at the fix ONLY in its loadout-UNKNOWN state —
// so a reporter looking at three classes they had stopped playing was shown the wrong answer
// confidently and offered nothing. It now wears the same PROVENANCE chip the Profiles panel and
// the character header use, and that chip's `inferred` tooltip names the two moves that correct
// it. `inferred` is a claim about evidence, and a surface that never says so is asking to be
// believed.
//
// THE POINTER IS A TOOLTIP AND NOT A LINE, and it stays one for the reason it was CHOSEN rather
// than the reason it was forced. The forcing is gone: this panel used to be the last child of a
// `height: 100%` stack whose middle child was the scroller, so every pixel it took came out of the
// charts — one caption line here once pushed the timeslice control under the panel above it at the
// app's minimum width, and leveling.e2e.mts hit-tests exactly that. Since JOS-289 the page scrolls
// and the height budget is not zero. The tooltip stays anyway: this is a chip's provenance, which
// is what the tooltip diet is FOR.
//
// AND THE LISTS BELOW ARE AS TALL AS THEY NEED TO BE (JOS-289). `UnlockList` was a 120px windowed
// porthole — the surface the owner named as cramped — and is now plain rows at their honest
// height, with the full `SpellTooltip` card behind every spell name.
//
// A TOAST'S DEEP LINK NOW LANDS ON THIS PANEL RATHER THAN NEAR IT (JOS-330). The two consequences
// of the layout above met here: the page is one tall scroller and this panel is the BOTTOM of the
// left column, so a link that mounted the tab and set the level left the reader at the top of a
// screen of charts with the answer a screen and a half below the fold. `useFocusLanding` (its own
// file, and its header carries the reasoning) scrolls this Paper fully into the app's one scroller
// and pulses its edge for two seconds on arrival — on EVERY link, including a repeat of the same
// level, and on no plain tab switch at all.

import { type JSX, useState } from 'react'
import { Box, IconButton, Paper, Stack, Typography, Chip } from '@mui/material'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import { comboClassSet, unlocksAtLevel } from '@shared/levelUnlocks'
import { Tooltip } from '../../lib/Tooltip'
import { ProvenanceChip } from '../profiles/ClassComboChips'
import { useComboSnap } from '../profiles/ClassComboData'
import { UnlockList } from './UnlockList'
import { LANDING_PULSE_SX, useFocusLanding } from './useFocusLanding'
import { useCurrentComboClasses, useLevelUnlocks } from './useLevelUnlocks'

/** The band the stepper walks. 1..63 is what the DB states; the ceiling leaves room to grow. */
const LEVEL_MIN = 1
const LEVEL_MAX = 65

const clampLevel = (n: number): number => Math.min(LEVEL_MAX, Math.max(LEVEL_MIN, Math.round(n)))

/** −/+ around the level, with the character's own level as the default and the reset. */
function LevelStepper({
  level,
  onChange
}: {
  level: number
  onChange: (n: number) => void
}): JSX.Element {
  return (
    <Stack direction="row" spacing={0.25} alignItems="center">
      <IconButton
        size="small"
        aria-label="previous level"
        data-testid="new-at-level-prev"
        disabled={level <= LEVEL_MIN}
        onClick={() => onChange(clampLevel(level - 1))}
      >
        <ChevronLeftIcon fontSize="small" />
      </IconButton>
      <Typography variant="subtitle2" data-testid="new-at-level-value" sx={{ minWidth: 64, textAlign: 'center' }}>
        Level {level}
      </Typography>
      <IconButton
        size="small"
        aria-label="next level"
        data-testid="new-at-level-next"
        disabled={level >= LEVEL_MAX}
        onClick={() => onChange(clampLevel(level + 1))}
      >
        <ChevronRightIcon fontSize="small" />
      </IconButton>
    </Stack>
  )
}

/** The loadout the lists were computed over, as chips — the panel's whole provenance line. */
function ComboChips({
  classes,
  resolved,
  ambiguous
}: {
  classes: string[]
  resolved: ReadonlySet<string>
  ambiguous: boolean
}): JSX.Element {
  return (
    <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap>
      {classes.map((c) => (
        <Chip
          key={c}
          size="small"
          label={c}
          data-testid="new-at-level-combo-chip"
          color="secondary"
          variant={resolved.has(c) ? 'filled' : 'outlined'}
          sx={{ height: 18, fontSize: 10 }}
        />
      ))}
      {ambiguous && (
        <Tooltip title="Covers every class your loadout could still be.">
          <Chip
            size="small"
            label="~ambiguous"
            data-testid="new-at-level-ambiguous"
            variant="outlined"
            sx={{ height: 18, fontSize: 10 }}
          />
        </Tooltip>
      )}
    </Stack>
  )
}

export interface NewAtLevelPanelProps {
  /** the character's CURRENT level (latest reported, never max) — the stepper's default */
  currentLevel: number | null
  /** a level-up toast's deep link asked for this level, or null */
  focusLevel: number | null
  /** bumps per link, so asking for the same level twice arrives twice (the nonce contract) */
  focusNonce: number
  onFocusConsumed: () => void
}

export function NewAtLevelPanel({
  currentLevel,
  focusLevel,
  focusNonce,
  onFocusConsumed
}: NewAtLevelPanelProps): JSX.Element {
  const data = useLevelUnlocks()
  const combo = useCurrentComboClasses()
  // The same OPEN interval `useCurrentComboClasses` reduces to strings — kept whole here for the
  // one thing the strings drop: where the loadout came from.
  const current = useComboSnap().current
  // null = "follow the character" — so the panel keeps tracking dings until the user steps it.
  const [picked, setPicked] = useState<number | null>(null)
  const level = clampLevel(picked ?? currentLevel ?? LEVEL_MIN)

  // THE DEEP LINK (appRouting `openLeveling`), and the whole arrival lives in `useFocusLanding`.
  // Keyed on the NONCE and consumed the moment it is applied, so returning to this tab later does
  // not re-jump to a level the user has stepped off — and so the same level asked for twice
  // arrives twice. The hook adds the two halves JOS-330 was about: it SCROLLS the panel into the
  // app's one scroller (this panel is the bottom of the left column since JOS-300, so a link that
  // only switched tabs left the reader looking at charts) and LIGHTS it briefly on arrival. Read
  // that file for why the scroll rides React's commits rather than `requestAnimationFrame`.
  const landing = useFocusLanding(focusLevel !== null, focusNonce, () => {
    if (focusLevel !== null) setPicked(clampLevel(focusLevel))
    onFocusConsumed()
  })

  const unlocks = unlocksAtLevel(data, combo, level)
  const classes = comboClassSet(combo)
  const resolved = new Set<string>(combo.resolved)
  const known = classes.length > 0

  return (
    // `position: relative` is the pulse's anchor and nothing else; `data-highlighted` states the
    // landing in the DOM so a spec can assert the CUE rather than a colour (tests/e2e/toast.e2e).
    // It is always present, "false" included, because "this panel is not lit" is also a claim.
    <Paper
      variant="outlined"
      ref={landing.ref}
      sx={{ p: 1.5, flex: '0 0 auto', position: 'relative' }}
      data-testid="new-at-level"
      data-highlighted={landing.seq === null ? 'false' : 'true'}
    >
      {/* THE ARRIVAL PULSE, keyed on the nonce so a repeat link restarts it (see useFocusLanding).
          A sibling of the content rather than a style on the Paper, and inert to the pointer. */}
      {landing.seq !== null && <Box key={landing.seq} aria-hidden sx={LANDING_PULSE_SX} />}
      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 0.75 }}>
        <Typography variant="subtitle2">New at this level</Typography>
        <LevelStepper level={level} onChange={(n) => setPicked(n)} />
        {picked !== null && currentLevel !== null && picked !== currentLevel && (
          <Chip
            size="small"
            label={`back to ${String(currentLevel)}`}
            variant="outlined"
            onClick={() => setPicked(null)}
            sx={{ height: 18, fontSize: 10 }}
          />
        )}
        <Box sx={{ flexGrow: 1 }} />
        <ComboChips classes={classes} resolved={resolved} ambiguous={combo.ambiguous} />
        {known && current && <ProvenanceChip interval={current} />}
      </Stack>

      {known ? (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <UnlockList
            title="Spells"
            rows={unlocks.spells}
            resolved={resolved}
            empty={`no new spells at level ${String(level)} for this loadout`}
          />
          <UnlockList
            title="Skills, disciplines & innates"
            rows={unlocks.skills}
            resolved={resolved}
            empty={`no new skills at level ${String(level)} for this loadout`}
          />
        </Stack>
      ) : (
        <Typography variant="caption" color="text.secondary" data-testid="new-at-level-unknown">
          Your class loadout isn&apos;t known yet - a <code>/who</code> on yourself, or a correction on the
          Profile tab, and this fills in.
        </Typography>
      )}

    </Paper>
  )
}
