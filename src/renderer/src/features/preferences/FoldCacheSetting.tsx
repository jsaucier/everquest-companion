// FoldCacheSetting — Preferences → Performance (JOS-208, owner addition).
//
// One switch over the startup checkpoint: remember what the log said last time, so the next
// launch reads only the new lines instead of the whole file again.
//
// IT BELONGS UNDER PERFORMANCE, beside the startup breakdown, because that is the readout it
// changes — someone who has just read "Log history replayed: 6.2 s" is standing exactly where
// this setting means something.
//
// STATE, NEVER PROCESS (the repo's UI law): the caption says what happens on the next launch and
// what the app does if anything looks wrong. It does not mention checkpoints, byte offsets,
// container digests or identity blocks — the user asked for a faster start, not for a description
// of how the fold is memoized.
//
// IT TAKES EFFECT NEXT LAUNCH, and the copy says so plainly rather than letting someone flip it
// and wonder why nothing happened. The GraphicsSetting precedent: a setting that cannot apply now
// says when it will, and offers no button that pretends otherwise.
//
// THE ENVIRONMENT CAN DISAGREE WITH THE SWITCH. `EQ_FOLD_CACHE` overrides the preference in both
// directions for one launch (the dev escape hatch), so the reply carries what this launch is
// ACTUALLY doing beside what the switch says. When they differ the caption leads with that — a
// switch reading "on" while the launch ran without it is the kind of small lie that costs an hour.
//
// ONE BORDER: PreferencesView already wraps each item in an outlined Paper, so this renders bare
// Stacks.

import { type JSX, useCallback, useEffect, useState } from 'react'
import { FormControlLabel, Stack, Switch, Typography } from '@mui/material'
import { foldCacheOverridden, type FoldCacheState } from '@shared/foldCachePrefs'

/** The shipped default, and what the card shows for the instant before main answers. */
const UNSET: FoldCacheState = { stored: false, active: false, why: 'default-off' }

/** Hydrated once from main and written back on change — the PerfSetting pattern exactly. The
 *  reply is authoritative (it is what was actually stored, resolved the way the launch resolves
 *  it); the local set is optimistic so the toggle never lags an IPC round trip. */
function useFoldCache(): [FoldCacheState, (enabled: boolean) => void] {
  const [state, setState] = useState<FoldCacheState>(UNSET)

  useEffect(() => {
    let alive = true
    void window.eq.getFoldCache().then((stored) => {
      if (alive) setState(stored)
    })
    return () => {
      alive = false
    }
  }, [])

  const setEnabled = useCallback((enabled: boolean) => {
    setState((cur) => ({ ...cur, stored: enabled }))
    void window.eq.setFoldCache(enabled).then(setState)
  }, [])

  return [state, setEnabled]
}

/** What the caption says, in one place so the three cases cannot drift apart. */
function caption(state: FoldCacheState): string {
  if (foldCacheOverridden(state)) {
    return state.active
      ? 'This launch started from a saved reading because EQ_FOLD_CACHE is set in your environment, whatever this switch says. Clear it to let the switch decide.'
      : 'This launch read the whole log because EQ_FOLD_CACHE is switched off in your environment, whatever this switch says. Clear it to let the switch decide.'
  }
  return state.stored
    ? 'From the next launch, the app picks up where it left off and reads only what your log has gained since. If anything about the file looks different - it moved, it was replaced, it shrank - it quietly reads the whole thing again.'
    : 'Off. Every launch reads your whole log from the beginning. Turning this on can save several seconds on a long log; the app still re-reads everything whenever it has any doubt.'
}

export function FoldCacheSetting(): JSX.Element {
  const [state, setEnabled] = useFoldCache()
  return (
    <Stack spacing={0.5} data-testid="pref-fold-cache">
      <FormControlLabel
        control={
          <Switch
            size="small"
            data-testid="pref-fold-cache-enabled"
            checked={state.stored}
            onChange={(e) => setEnabled(e.target.checked)}
          />
        }
        label={<Typography variant="body2">Start faster by remembering your log</Typography>}
      />
      <Typography variant="caption" color="text.secondary" data-testid="pref-fold-cache-caption">
        {caption(state)}
      </Typography>
    </Stack>
  )
}
