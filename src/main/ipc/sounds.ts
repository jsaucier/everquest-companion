// IPC: installed sound packs (local) and the og-packs registry (remote browse/preview/install).

import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import { logError } from '../errorLog'
import {
  fetchPackSounds,
  fetchPreviewSound,
  fetchRegistry,
  findRegistryPack,
  installPack,
  uninstallPack
} from '../packRegistry'
import { isSafePackId } from '../security'
import { getSoundData, listPacks } from '../sounds'
import {
  clearPackRemoved,
  getDefaultSoundPackId,
  getSoundPackPrefs,
  recordPackRemoved,
  setDefaultSoundPack
} from '../storeSoundPacks'
import { importUserSounds, listImportedSounds, removeUserSound } from '../userSounds'
import { getMainWindow, sendToMain } from '../windows'
import type { PackInstallProgress } from '../../shared/types'

export function registerSoundsIpc(): void {
  ipcMain.handle(IPC.listSoundPacks, () => listPacks())
  // packId names a DIRECTORY under the soundpack roots, so it is validated at the IPC
  // boundary (security.ts isSafePackId) rather than trusted because today's only caller
  // passes a listed pack's id. soundId is a KEY into that pack's manifest (never a path),
  // and sounds.ts already refuses a manifest entry that escapes the pack dir.
  // The reserved `my-sounds` pack (JOS-68) comes through this SAME door: it is a directory
  // name like any other, it satisfies isSafePackId, and sounds.ts resolves it to its own
  // root. There is deliberately no second serving path for the user's own audio.
  // The USER'S DEFAULT PACK is what a ref resolves through when its own pack is gone (JOS-273),
  // and it is read HERE rather than inside sounds.ts because that module is loaded by node:test
  // and the store is not. One read per fetch is a store hit on a cached object, not a file read.
  ipcMain.handle(IPC.getSoundData, (_e, packId: string, soundId: string) =>
    isSafePackId(packId) ? getSoundData(packId, soundId, getDefaultSoundPackId()) : null
  )

  // ---- the default-pack preference (JOS-273) ----
  // The id is validated at the boundary with the SAME predicate a served pack id is (it names a
  // directory under the soundpack roots the moment anything resolves through it), and `null` is a
  // real value meaning "use whatever the app ships".
  ipcMain.handle(IPC.getSoundPackPrefs, () => getSoundPackPrefs())
  ipcMain.handle(IPC.setDefaultSoundPack, (_e, packId: string | null) =>
    setDefaultSoundPack(isSafePackId(packId) ? packId : null)
  )

  // ---- the user's own sounds (JOS-68) ----
  // The picker runs in MAIN (userSounds.ts), so no filesystem path is ever handed to — or
  // accepted from — the renderer. `removeUserSound` takes a manifest key; an unknown one
  // removes nothing, and the key never reaches a join() (the file deleted is the manifest's
  // own entry, re-checked with isInsideDir).
  ipcMain.handle(IPC.listUserSounds, () => listImportedSounds())
  ipcMain.handle(IPC.importUserSounds, () => importUserSounds(getMainWindow()))
  ipcMain.handle(IPC.removeUserSound, (_e, soundId: string) =>
    removeUserSound(typeof soundId === 'string' ? soundId : '')
  )

  // ---- sound-pack registry (openpeon.com integration, Task #29) ----
  ipcMain.handle(IPC.packsRegistry, (_e, force?: boolean) => fetchRegistry(force ?? false))
  ipcMain.handle(IPC.packsInstall, async (_e, name: string) => {
    const reg = await fetchRegistry(false)
    const pack = reg.packs.find((p) => p.name === name)
    if (!pack) return { ok: false as const, error: `pack '${name}' not in registry` }
    const emit = (p: PackInstallProgress): void => {
      sendToMain(IPC.onPackProgress, p)
    }
    try {
      await installPack(pack, emit)
      // INSTALLING IS HOW A DELETION IS TAKEN BACK (JOS-273). Clearing the stone here rather than
      // in installPack keeps the pure installer pure, and covers the only path that matters: the
      // registry browser, which is where the ruling says the user asks for the pack again.
      clearPackRemoved(name)
      return { ok: true as const }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logError('main:packRegistry', { message: `install '${name}' failed`, err })
      emit({ name, phase: 'error', message })
      return { ok: false as const, error: message }
    }
  })
  ipcMain.handle(IPC.packsUninstall, (_e, name: string) => {
    const ok = uninstallPack(name)
    // A SUCCESSFUL removal of a SHIPPED pack is the statement provisioning has to remember
    // (storeSoundPacks.ts decides which ids qualify). A failed one is not a statement about
    // anything, so nothing is written on that path.
    if (ok) recordPackRemoved(name)
    return ok ? { ok: true as const } : { ok: false as const, error: 'pack not found or not removable' }
  })
  // Preview a registry pack BEFORE install (Task #31): list its sounds / stream one.
  ipcMain.handle(IPC.packsPreviewList, async (_e, name: string) => {
    const pack = await findRegistryPack(name)
    if (!pack) return { sounds: [], error: `pack '${name}' not in registry` }
    return fetchPackSounds(pack)
  })
  ipcMain.handle(IPC.packsPreviewSound, async (_e, name: string, file: string) => {
    const pack = await findRegistryPack(name)
    if (!pack) return null
    return fetchPreviewSound(pack, file)
  })
}
