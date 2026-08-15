// AlertPlayer — an always-mounted (App-level) component that turns fired alerts
// into sound AND SPEECH, and the `fireAppSignal` entry point for renderer-side app triggers.
//
// SPEECH (docs/plans/voice-alerts.md §3, wave 2) rides the SAME firing paths, decided by ONE
// pure function — `speechPlan` in lib/speech.ts — rather than by a branch at each call site:
//   audio:'sound'  (or absent) → unchanged: the pack sound, as it always was.
//   audio:'speech'            → the utterance INSTEAD of the sound.
// A def still storing the retired 'both' (JOS-362) resolves to one of those two inside
// `speechPlan` — see `resolveAlertAudio` — so this path plays ONE channel per firing, always.
// The alerts module's master MUTE and its volumes govern both halves: mute silences speech
// too, and the utterance is spoken at VoicePrefs.volume × this alert's effective volume. The
// engine itself (which tier, which voice, and the fact that the e2e channel never utters)
// lives entirely behind `speak()` — this file never touches speechSynthesis.
//
// Two firing paths converge here:
//   1. module:delta 'alerts' — the main-side AlertsModule fired an event/raw
//      trigger on a LIVE log event. We look up the def, respect mute, and play at
//      globalVolume × alert.volume. (Cooldown/enabled were already enforced in the
//      module; we don't re-check here.)
//   2. fireAppSignal('bossDefeat') — a renderer-only signal (main can't evaluate
//      it because it depends on derived boss state). App calls this exactly where
//      boss confetti fires. We match it against every enabled 'app' alert with the
//      matching signal, applying the SAME cooldown the module would.
//
// The player keeps a live copy of defs + prefs (hydrated on mount, refreshed on
// window focus and after any save via the shared store below) so both paths have
// what they need without prop-drilling.

import { useEffect } from 'react'
import type {
  AlertDef,
  AlertPrefs,
  AlertsDelta,
  AppSignal,
  FiredAlert,
  ModuleDelta
} from '@shared/types'
import { playSound } from './soundCache'
import { currentVoicePrefs, loadVoicePrefs, speak, speechPlan } from '../../lib/speech'
import { audioIdentity, coalesceAudio, type AudioWindow } from './audioThrottle'
import { previewDef } from './preview'

// ---- shared, module-level alert state (so fireAppSignal works outside React) ----

let defs: AlertDef[] = []
let prefs: AlertPrefs = { globalVolume: 0.7, muted: false }
const appCooldown = new Map<string, number>()
const DEFAULT_COOLDOWN_MS = 2000
/**
 * The audio channel's current occupancy — when it was last opened, and everything already heard
 * inside that window (audioThrottle.ts). One cell for the whole app on purpose: coalescing is
 * CROSS-alert — three different alerts landing together is the case it exists for — so a per-def
 * cell would gate nothing that `cooldownMs` doesn't already gate. What makes it per-def-SAFE is
 * that the window folds by what would be HEARD (JOS-347), not by which def said it.
 */
let audioWindow: AudioWindow | null = null

const subscribers = new Set<() => void>()
/** Subscribe to defs/prefs changes (AlertsView re-reads after it saves). */
export function onAlertStoreChange(cb: () => void): () => void {
  subscribers.add(cb)
  return () => subscribers.delete(cb)
}
function notify(): void {
  for (const cb of subscribers) cb()
}

/** Re-fetch defs + prefs (including the voice prefs) from main into the shared player state. */
export async function refreshAlertStore(): Promise<void> {
  const [d, p] = await Promise.all([
    window.eq.listAlerts(),
    window.eq.getAlertPrefs(),
    // Hydrates lib/speech's own cache — the engine seam owns that copy, not this module.
    loadVoicePrefs()
  ])
  defs = d
  prefs = p
  notify()
}

export function currentPrefs(): AlertPrefs {
  return prefs
}
export function currentDefs(): AlertDef[] {
  return defs
}

/** Effective volume for an alert: globalVolume × (alert.volume ?? 1), clamped. */
function effectiveVolume(def: AlertDef): number {
  const v = (def.volume ?? 1) * prefs.globalVolume
  return Math.max(0, Math.min(1, v))
}

/**
 * Fire ONE alert's audio now — sound, speech, or both — respecting the master mute. Used by
 * both firing paths and by the list's Test button.
 *
 * `firing` carries the matched event's SPELL CONTEXT (rank intact, see FiredAlert.spell) so the
 * `spellName`/`spellFirstWord` modes have something to say; omitted for a Test or an app signal,
 * where `speechTextFor` falls back to the alert's own name rather than inventing one.
 *
 * CROSS-ALERT COALESCING is applied here and only here, AFTER the sound/speech plan and only
 * when something would actually have been audible: a muted app (or a plan that resolved to
 * nothing) must not consume the window and silence the next alert for 1.5s. The firing itself
 * is already recorded upstream — this drops noise, never history. The global "always play"
 * preference (JOS-222) rides the SAME call: it is an argument to the pure decision, read off the
 * prefs copy this module already keeps live, so nothing here branches on it.
 */
export function playAlertNow(def: AlertDef, firing?: Pick<FiredAlert, 'spell'>): void {
  const voice = currentVoicePrefs()
  const plan = speechPlan(def, firing ?? null, prefs.muted)
  if (!plan.sound && !plan.speak) return
  // The plan is resolved FIRST because the throttle folds by what would be heard, not by which
  // def is speaking: two alerts pointed at one sound with nothing to say are one audio alert,
  // and two alerts with different voice lines are two things to hear (JOS-347).
  const gate = coalesceAudio(def, Date.now(), audioWindow, {
    allAlwaysPlay: prefs.alwaysPlayAll === true,
    heard: audioIdentity(def, plan)
  })
  audioWindow = gate.window
  if (!gate.play) return
  const gain = effectiveVolume(def)
  // One channel or the other, never both (JOS-362): a plan carries a sound or an utterance. WHICH
  // VOICE says it is `voice` — the live prefs copy, read at firing time — and nothing off the def:
  // a stored `speech.voiceId` is ignored, so changing the preference changes every alert at once.
  if (plan.speak) {
    void speak(plan.speak, voice, { gain })
    return
  }
  void playSound(def.sound.packId, def.sound.soundId, gain)
}

/**
 * The row's ▶ — audition ONE alert exactly as a real firing of it would sound.
 *
 * It lives here, in the firing path's own file, rather than in the view that renders the button:
 * "preview == firing" is a property of this module, and a view that rebuilt the def itself is how
 * the two drift apart. `previewDef` (preview.ts) is the pure half — the two forced fields and
 * nothing else — so what this does is pinned by tests/alertPreview.test.mts rather than by prose.
 */
export function previewAlertNow(def: AlertDef): void {
  playAlertNow(previewDef(def))
}

/**
 * Fire a renderer-side app signal (e.g. 'bossDefeat'). Plays every enabled 'app'
 * alert whose trigger.signal matches, honoring each alert's cooldown so a
 * double-invocation in the same tick can't double-play. `context` (e.g. the boss
 * name) is reported to main via appFired so the module's recent-fires history —
 * the single source of truth — records the signal with meaningful matched text.
 */
export function fireAppSignal(signal: AppSignal, context = ''): void {
  const now = Date.now()
  for (const def of defs) {
    if (!def.enabled) continue
    if (def.trigger.type !== 'app' || def.trigger.signal !== signal) continue
    const cd = def.cooldownMs ?? DEFAULT_COOLDOWN_MS
    const last = appCooldown.get(def.id)
    if (last !== undefined && now - last < cd) continue
    appCooldown.set(def.id, now)
    playAlertNow(def)
    // Route the fire through main so history stays the single source of truth.
    window.eq.appFired(def.id, context)
  }
}

/** The mounted component: hydrates the store + plays main-fired alert deltas. */
export default function AlertPlayer(): null {
  useEffect(() => {
    void refreshAlertStore()
    // Refresh on focus so prefs edited elsewhere (or seeded on first run) apply.
    const onFocus = (): void => void refreshAlertStore()
    window.addEventListener('focus', onFocus)

    const offDelta = window.eq.onModuleDelta<AlertsDelta>((d: ModuleDelta<AlertsDelta>) => {
      if (d.moduleId !== 'alerts') return
      for (const fire of d.delta.fired) {
        const def = defs.find((a) => a.id === fire.alertId)
        // The firing is passed through: it is where the spell context lives (W1), and the
        // speech modes are the only thing that reads it.
        if (def) playAlertNow(def, fire)
      }
    })
    // CELEBRATION TOASTS make no sound (owner, 2026-08-05). This player briefly owned a second
    // subscription — `toast:sound` — because the overlay bundle has no audio stack. It is gone:
    // the boss-kill and quest-complete ALERTS already speak on those exact events, from this
    // same player, with their own cooldowns. A card is a thing you see.
    return () => {
      window.removeEventListener('focus', onFocus)
      offDelta()
    }
  }, [])

  return null
}
