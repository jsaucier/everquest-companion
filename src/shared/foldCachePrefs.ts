// foldCachePrefs.ts — the startup checkpoint's SHARED vocabulary (JOS-208).
//
// The resolution RULE stays in main (`src/main/foldCache/flag.ts`), because it reads the store and
// the environment and neither belongs on this side of the boundary. What lives here is only what
// both sides have to name: the shape the IPC channels carry, and the vocabulary of reasons a
// launch can give for its answer. The renderer cannot import from `src/main` (the tsconfig
// boundary is deliberate), and a second copy of these names in the preload would be a second
// definition to keep in step.

/** How the launch reached its answer — logged once at attach, and shown when it surprises. */
export type FoldCacheDecision = 'env-on' | 'env-off' | 'pref-on' | 'default-off'

/**
 * WHAT THE SWITCH SAYS AND WHAT THE LAUNCH DID, as two separate facts.
 *
 * They agree in every ordinary case. They differ when `EQ_FOLD_CACHE` is set — the dev escape
 * hatch, which overrides the preference in BOTH directions (a kill switch a preference can
 * override is not a kill switch) — and a surface that carried only `stored` would then show a
 * switch that is quietly wrong about what this launch is doing.
 */
export interface FoldCacheState {
  /** The stored preference. False when nobody has ever set it: the shipped default is off. */
  stored: boolean
  /** What THIS launch resolved, environment override included. */
  active: boolean
  why: FoldCacheDecision
}

/** True when the environment is overriding the preference, in either direction. */
export function foldCacheOverridden(state: FoldCacheState): boolean {
  return state.why === 'env-on' || state.why === 'env-off'
}
