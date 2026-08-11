// IPC: the startup-checkpoint switch (JOS-208 phase 2 — owner addition).
//
// The flag was env-only and store-readable from phase 1; this is the half that puts it in front
// of a person. Two channels, both trivial, and one honest complication worth the code:
//
// THE ANSWER IS TWO FACTS, NOT ONE. What the preference SAYS and what this launch is DOING can
// legitimately differ, because `EQ_FOLD_CACHE` overrides the preference in both directions (the
// kill-switch rule in foldCache/flag.ts). A surface that showed only the stored boolean would say
// "on" to a developer whose shell has it switched off, which is the kind of small lie that costs
// an hour. So the reply carries the stored value, what the launch resolved, and WHY — and the
// caption says so when they disagree.
//
// FLIPPING IT CHANGES NOTHING THIS SESSION, deliberately. `foldCacheEnabled()` resolves once per
// launch and the restore happens at character attach, long before Preferences can be opened, so
// there is no sampler to start and no timer to stop — the graphics prefs' shape exactly. Anything
// that pretended otherwise would have to unwind a fold that is already built.
//
// VALIDATED AT THE HANDLER (the `sounds:getData` rule): a non-boolean is not a guess, it leaves
// the preference exactly as it was.

import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import type { FoldCacheState } from '../../shared/foldCachePrefs'
import { resolveFoldCacheFlag } from '../foldCache/flag'
import { getFoldCacheEnabled, setFoldCacheEnabled } from '../storeFoldCache'

/** The current state, resolved through the SAME rule the launch used. */
export function foldCacheState(): FoldCacheState {
  const stored = getFoldCacheEnabled() === true
  const { enabled, why } = resolveFoldCacheFlag({ pref: stored, env: process.env.EQ_FOLD_CACHE })
  return { stored, active: enabled, why }
}

export function registerFoldCacheIpc(): void {
  ipcMain.handle(IPC.foldCacheGet, () => foldCacheState())
  ipcMain.handle(IPC.foldCacheSet, (_e, enabled: unknown) => {
    if (typeof enabled === 'boolean') setFoldCacheEnabled(enabled)
    return foldCacheState()
  })
}
