// flag.ts — IS THE CHECKPOINT ON? (JOS-208)
//
// OFF BY DEFAULT, and it stays off until the owner has run it by hand and the fleet's divergence
// count has stayed at zero (the rollout half of the design). Everything below is the resolution
// rule, kept pure and Electron-free so it can be tested without a store: the caller supplies the
// stored preference and the environment, and this decides.
//
// TWO WAYS TO TURN IT ON, and they are not redundant:
//
//   * the STORED PREFERENCE is the user-facing one — the switch a Preferences row will set in a
//     later phase, and what the owner flips to run it for real across relaunches.
//   * `EQ_FOLD_CACHE` is the SESSION one. The e2e restart-compare (phase 3) has to launch the same
//     build twice with the flag in two different states, and a test that had to write the user's
//     settings file to do it would be a test that can corrupt the user's settings file. Same
//     argument as `EQ_E2E` and `EQ_INSTALL_DIR`, which is why it reads like them.
//
// THE ENV VAR WINS, in BOTH directions: `EQ_FOLD_CACHE=0` turns it off for one launch even when the
// preference says on. A kill switch that a preference can override is not a kill switch.

// The DECISION vocabulary is shared with the renderer (Preferences shows it when the environment
// is overriding the preference), so it lives in `shared/foldCachePrefs.ts`; the RULE below stays
// here, where the store and the environment are.
import type { FoldCacheDecision } from '../../shared/foldCachePrefs'

export type { FoldCacheDecision }

export interface FoldCacheFlagInput {
  /** The stored preference, or undefined when the key has never been written. */
  pref?: boolean
  /** `process.env.EQ_FOLD_CACHE`, verbatim. */
  env?: string | undefined
}

/** The one resolution rule. */
export function resolveFoldCacheFlag(input: FoldCacheFlagInput): { enabled: boolean; why: FoldCacheDecision } {
  const env = input.env?.trim().toLowerCase()
  if (env === '1' || env === 'true' || env === 'on') return { enabled: true, why: 'env-on' }
  if (env === '0' || env === 'false' || env === 'off') return { enabled: false, why: 'env-off' }
  if (input.pref === true) return { enabled: true, why: 'pref-on' }
  return { enabled: false, why: 'default-off' }
}
