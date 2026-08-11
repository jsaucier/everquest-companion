// storeFoldCache.ts — the persisted CHECKPOINT SWITCH, main-process side (JOS-208).
//
// The settings-accessor half of the fold cache's feature flag, split out of `store.ts` for the
// reason `storeRespawn.ts` gives: that file is AT the repo's 400-code-line factoring ceiling and
// the house answer is a split, not a widened threshold.
//
// NO SCHEMA BUMP. The key is additive and optional, and an absent one reads as the shipped default
// — OFF, because the rollout says off until the owner has run it by hand and the fleet's
// divergence count has stayed at zero. So a store written by an older build loads here unchanged,
// and one written here still opens in a build that predates the feature. The `respawn` /
// `lastSeenNotesVersion` precedent, stated in storeShape.ts.

import { settingsStore } from './store'

/** The stored preference, or undefined when nobody has ever set it. Never throws. */
export function getFoldCacheEnabled(): boolean | undefined {
  const raw: unknown = settingsStore.get('foldCache')
  if (typeof raw !== 'object' || raw === null) return undefined
  const v: unknown = (raw as { enabled?: unknown }).enabled
  return typeof v === 'boolean' ? v : undefined
}

/** Store the preference; returns what was stored. Validated here — the renderer may supply it. */
export function setFoldCacheEnabled(next: unknown): boolean {
  const clean = next === true
  settingsStore.set('foldCache', { enabled: clean })
  return clean
}
