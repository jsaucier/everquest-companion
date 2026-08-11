// name.ts — a character id, as a filename (JOS-208).
//
// ELECTRON-FREE ON PURPOSE, and split from `paths.ts` for exactly that: this is the rule, and a
// rule is a thing to unit-test. `paths.ts` reaches `channel.ts` for `userData`, which reaches
// Electron's `app`, which cannot be imported outside it — so a naming rule living there would be a
// rule with no test. The `security.ts` precedent: pure policy lives where it can be pinned.

/** The cache container's extension. Its own constant so `paths.ts` and any support answer agree. */
export const FOLD_CACHE_EXT = '.eqfold'

/**
 * A safe file stem for a character id.
 *
 * `characterId()` already produces `name_server` lowercased, so in practice this changes nothing —
 * which is the point at which a validator is usually skipped. It is here because the input is a
 * PATH SEGMENT built from an EQ character name, EQ names are world-supplied, and "today's only
 * caller happens to be safe" is not a property of the filesystem. Everything outside
 * `[a-z0-9_-]` becomes `_`: that cannot traverse, cannot name a Windows device, cannot escape the
 * directory, and cannot be empty. (The renderer-supplied `packId` rule, applied one directory over.)
 */
export function cacheStem(characterId: string): string {
  const clean = characterId
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .slice(0, 64)
  return clean.length > 0 ? clean : 'unknown'
}
