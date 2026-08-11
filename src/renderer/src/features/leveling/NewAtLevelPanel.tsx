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
// THE POINTER IS A TOOLTIP AND NOT A LINE, AND THAT IS MEASURED RATHER THAN TASTE. This panel is
// the LAST child of a `height: 100%` stack whose middle child is the scroller, so every pixel it
// takes comes out of the charts. At the app's own minimum width one caption line here pushed the
// two-column band far enough that the timeslice control was drawn under the panel above it —
// `tests/e2e/leveling.e2e.mts` hit-tests exactly that and went red. The budget is zero.

import { type JSX, useEffect, useRef, useState } from 'react'
import { Box, IconButton, Paper, Stack, Typography, Chip } from '@mui/material'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import { comboClassSet, unlocksAtLevel } from '@shared/levelUnlocks'
import { Tooltip } from '../../lib/Tooltip'
import { ProvenanceChip } from '../profiles/ClassComboChips'
import { useComboSnap } from '../profiles/ClassComboData'
import { UnlockList } from './UnlockList'
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

  // The deep link (appRouting `openLeveling`). Keyed on the NONCE, and consumed the moment it is
  // applied, so returning to this tab later does not re-jump to a level the user has stepped off.
  // It SCROLLS ITSELF INTO VIEW too: the panel lives under the charts, and a toast click that
  // landed you on the tab without showing you the thing you clicked for would be a broken link.
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (focusLevel === null) return
    setPicked(clampLevel(focusLevel))
    ref.current?.scrollIntoView({ block: 'nearest' })
    onFocusConsumed()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce])

  const unlocks = unlocksAtLevel(data, combo, level)
  const classes = comboClassSet(combo)
  const resolved = new Set<string>(combo.resolved)
  const known = classes.length > 0

  return (
    <Paper variant="outlined" ref={ref} sx={{ p: 1.5, flex: '0 0 auto' }} data-testid="new-at-level">
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
