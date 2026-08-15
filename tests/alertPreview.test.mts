// The alert row's ▶ — pinned at the pure seam that resolves what it does.
//
// THE BUG THIS FILE IS THE ANSWER TO. With a row's output set to "Voice (spoken)" and a
// speak-what chosen, pressing ▶ played the PACK SOUND: the retired global voice switch sat inside
// `speechPlan` and degraded every 'speech'/'both' def back to its sound while it was off, which it
// was by default. So the one control whose entire job is "let me hear the choice I just made" was
// the one control guaranteed not to reflect it — and nothing on screen said why.
//
// WHAT IS ASSERTED, AND WHY IT IS THIS: preview is not "a bit like" a firing, it IS one, with two
// fields forced (`previewDef`). Every test below is a form of that equality — per channel, muted
// and not, with speech configuration and without — because equality is the only property that
// cannot rot: a future change to what a firing does is inherited by preview or it fails here.
//
// No DOM, no Electron, no fixture — this file never skips.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AlertAudio, AlertDef } from '../src/shared/types'
import { speechPlan } from '../src/renderer/src/lib/speech'
import { previewDef, previewPlan } from '../src/renderer/src/features/alerts/preview'

function def(over: Partial<AlertDef> = {}): AlertDef {
  return {
    id: 'charm-break',
    name: 'Charm break',
    enabled: true,
    trigger: { type: 'event', kind: 'uncharm' },
    sound: { packId: 'alan-rickman', soundId: 'attention' },
    ...over
  }
}

const CHANNELS: (AlertAudio | undefined)[] = [undefined, 'sound', 'speech', 'both']

// ------------------------------------------------------------ the semantics, as shipped

test('▶ on a VOICE row SPEAKS — it does not play the pack sound (the bug)', () => {
  const plan = previewPlan(def({ audio: 'speech' }), false)
  assert.deepEqual(plan, { sound: false, speak: 'Charm break' })
})

test('▶ on a row still STORING the retired combined channel previews what it will play', () => {
  // JOS-362 retired "Sound + voice", and the resolution rule (`resolveAlertAudio`) is a READ: the
  // def keeps saying 'both' until it is next edited. ▶ has to preview the resolution, or the row
  // auditions a channel the firing will not use — the exact split-brain this file exists for.
  assert.deepEqual(
    previewPlan(def({ audio: 'both', speech: { mode: 'custom', phrase: 'Charm break' } }), false),
    { sound: false, speak: 'Charm break' },
    'a phrase ⇒ spoken, and nothing plays alongside it'
  )
  assert.deepEqual(previewPlan(def({ audio: 'both' }), false), { sound: true, speak: null })
})

test('▶ on a sound row is unchanged — the pack sound, as it always was', () => {
  for (const audio of [undefined, 'sound'] as const) {
    assert.deepEqual(
      previewPlan(def(audio ? { audio } : {}), false),
      { sound: true, speak: null },
      `audio:${String(audio)}`
    )
  }
})

test('▶ speaks the def’s configured phrase, not its name, when it has one', () => {
  const d = def({ audio: 'speech', speech: { mode: 'custom', phrase: 'run away' } })
  assert.equal(previewPlan(d, false).speak, 'run away')
})

test('a spell mode previews the alertName FALLBACK — a preview has no firing to name a spell', () => {
  const d = def({ name: 'Mez broke', audio: 'speech', speech: { mode: 'spellName' } })
  assert.equal(previewPlan(d, false).speak, 'Mez broke')
})

test('MUTE is not an exception: ▶ makes no noise while the app is muted', () => {
  for (const audio of CHANNELS) {
    assert.deepEqual(
      previewPlan(def(audio ? { audio } : {}), true),
      { sound: false, speak: null },
      `audio:${String(audio)} must be silent while muted`
    )
  }
})

// ------------------------------------------------------------ preview == firing

test('preview resolves to EXACTLY what a real firing of the same def resolves to', () => {
  for (const audio of CHANNELS) {
    for (const muted of [false, true]) {
      const d = def(audio ? { audio } : {})
      assert.deepEqual(
        previewPlan(d, muted),
        speechPlan(d, null, muted),
        `audio:${String(audio)} muted:${String(muted)}`
      )
    }
  }
})

test('…including every speech configuration, since preview changes none of them', () => {
  const configs: AlertDef['speech'][] = [
    undefined,
    { mode: 'alertName' },
    { mode: 'custom', phrase: 'incoming' },
    { mode: 'spellFirstWord', voiceId: 'urn:sapi:David?en-US' }
  ]
  for (const speech of configs) {
    for (const audio of ['speech', 'both'] as const) {
      const d = def({ audio, ...(speech ? { speech } : {}) })
      assert.deepEqual(previewPlan(d, false), speechPlan(d, null, false), JSON.stringify(speech))
    }
  }
})

// ------------------------------------------------------------ what preview DOES force

test('preview forces exactly two fields — enabled and alwaysPlay — and touches nothing else', () => {
  const original = def({
    audio: 'speech',
    enabled: false,
    volume: 0.3,
    cooldownMs: 5000,
    speech: { mode: 'custom', phrase: 'run away', voiceId: 'urn:sapi:Zira?en-US' }
  })
  const preview = previewDef(original)
  assert.equal(preview.enabled, true, 'a disabled alert must still be auditionable')
  assert.equal(preview.alwaysPlay, true, 'the cross-alert throttle must not swallow a button press')
  assert.deepEqual(
    { ...preview, enabled: original.enabled, alwaysPlay: original.alwaysPlay },
    { ...original, alwaysPlay: original.alwaysPlay },
    'every other field comes through untouched'
  )
})

test('preview never mutates the def the row is rendering', () => {
  const original = def({ audio: 'speech', enabled: false })
  const snapshot = JSON.stringify(original)
  previewPlan(original, false)
  assert.equal(JSON.stringify(original), snapshot)
})
