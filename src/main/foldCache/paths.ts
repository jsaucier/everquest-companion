// paths.ts — WHERE A CHECKPOINT LIVES (JOS-208).
//
// One binary file per character, under this channel's `userData` — so the dev app, the installed
// app and an e2e launch each keep their own (channel.ts owns that split, and an e2e launch's
// userData is a temp dir, which means the suite can never touch the owner's cache while he plays).
//
// A DIRECTORY OF ITS OWN, `<userData>/foldCache/`, rather than files strewn beside the settings
// JSON. Two reasons, both operational: "delete this folder to force a cold start" is a support
// answer somebody can follow without knowing a filename, and nothing that walks `userData` looking
// for JSON can mistake a V8 blob for a settings file.
//
// THE FILENAME IS THE CHARACTER ID and nothing else — `characterId()` is already the app's
// per-character store key (`name_server`, lowercased), so the cache is keyed the way every other
// per-character fact is. The sanitizing rule lives in `name.ts`, Electron-free, because it is a
// rule and rules get tests; this file is only the join.

import { join } from 'node:path'
import { USER_DATA } from '../channel'
import { cacheStem, FOLD_CACHE_EXT } from './name'

const DIR_NAME = 'foldCache'

/** The cache directory for this channel. */
export function foldCacheDir(): string {
  return join(USER_DATA, DIR_NAME)
}

/**
 * The container path for one character. The directory is created by the WRITER
 * (`writeCheckpointSync`) rather than here: a read of a path in a directory that does not exist is
 * an ENOENT, which is already "no cache, cold start", so nothing needs to exist before a read.
 */
export function foldCachePath(characterId: string): string {
  return join(foldCacheDir(), `${cacheStem(characterId)}${FOLD_CACHE_EXT}`)
}
