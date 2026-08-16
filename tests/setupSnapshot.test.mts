// ============================================================================
// setupSnapshot.test.mts — JOS-364: the producer's arithmetic, and the two lost-child counters.
// ============================================================================
//
// WHAT THIS SUITE IS FOR. `setupSnapshot` sat in the contract for three waves with a rollup, a
// TELEMETRY.md section and no producer — so every number below is arriving in the fleet for the
// first time, and there is no historical data to notice a mistake against. That is the case where
// a mapping test earns its keep: a `gpu_compositing` string folded to the wrong word, or an
// `eqclient.ini` read backwards, produces a chart that is confidently wrong and looks exactly
// like a chart that is right.
//
// It drives the two PURE halves — `src/main/telemetry/setupFacts.ts` and
// `src/main/childProcessGone.ts` — which is why it runs with no Electron in the process. Both
// modules were split from their Electron-importing callers for exactly this reason.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildSetupSnapshot,
  eqWindowModeOf,
  gpuCompositingOf,
  gpuVendorOf,
  type SetupFacts
} from '../src/main/telemetry/setupFacts'
import {
  noteChildProcessGone,
  watchChildProcessGone,
  type ChildProcessGoneEmitter
} from '../src/main/childProcessGone'
import { peekHealth, resetHealth } from '../src/main/telemetry/health'
import { validateTelemetryEvent } from '../src/shared/telemetryValidate'
import {
  CPU_COUNT_EDGES,
  DISPLAY_COUNT_EDGES,
  PRIMARY_SCALE_EDGES,
  TOTAL_MEM_GB_EDGES
} from '../src/shared/telemetry'

/** The install half, with nothing interesting in it: every machine-class assertion below varies
 *  ONE field against this, so a failure names the field it is about. */
const BASE: SetupFacts = {
  charCount: 1,
  logBytes: 5_000_000,
  alertCount: 12,
  overlaysEnabled: ['fight'],
  cursorRing: true,
  autoHide: false,
  voiceEngine: 'kokoro',
  soundPackCount: 2,
  updateChannel: 'main'
}

test('THE GPU VENDOR MAP: three ids, an other, and an honest unknown', () => {
  assert.equal(gpuVendorOf(0x10de), 'nvidia')
  assert.equal(gpuVendorOf(0x1002), 'amd')
  assert.equal(gpuVendorOf(0x8086), 'intel')
  // Chromium answers with a STRING on some platforms and a number on others, and both spellings
  // have to land on the same word — otherwise a whole platform's NVIDIA machines are filed under
  // `other`, which is a wrong answer that looks exactly like a right one in a bar chart.
  assert.equal(gpuVendorOf('0x10de'), 'nvidia')
  assert.equal(gpuVendorOf('10de'), 'nvidia')
  // A vendor that answered, and is nobody we named.
  assert.equal(gpuVendorOf(0x1414), 'other')
  // Nothing answered. NOT `other`: "we could not ask" and "we asked and it was somebody else" are
  // different facts, and the timeout arm of the producer produces the first one.
  assert.equal(gpuVendorOf(undefined), 'unknown')
  assert.equal(gpuVendorOf(''), 'unknown')
  assert.equal(gpuVendorOf('nvidia'), 'unknown')
  assert.equal(gpuVendorOf(0), 'unknown')
})

test('THE COMPOSITING MAP: Chromium’s open vocabulary folded to three states plus unknown', () => {
  assert.equal(gpuCompositingOf('enabled'), 'hardware')
  // Software compositing is the reading the whole ticket cares about: this machine draws every
  // overlay show on the CPU, and that is a different app from the one beside it.
  assert.equal(gpuCompositingOf('disabled_software'), 'software')
  assert.equal(gpuCompositingOf('enabled_readback'), 'software')
  assert.equal(gpuCompositingOf('unavailable_software'), 'off')
  assert.equal(gpuCompositingOf('unavailable_off'), 'off')
  assert.equal(gpuCompositingOf('disabled_off'), 'off')
  assert.equal(gpuCompositingOf('disabled_off_ok'), 'off')
  // A member a Chromium bump invents is `unknown`, not the nearest neighbour guessed at. This is
  // the property that lets us forward a status whose vocabulary we do not control.
  assert.equal(gpuCompositingOf('something_new_in_chromium_46'), 'unknown')
  assert.equal(gpuCompositingOf(undefined), 'unknown')
  assert.equal(gpuCompositingOf(42), 'unknown')
})

test('THE eqclient.ini PARSE: TRUE, FALSE, missing, garbage — and nothing else from the file', () => {
  // The game writes `WindowedMode=TRUE`; a quarter-century of hand edits produces the rest.
  assert.equal(eqWindowModeOf('[Defaults]\r\nWindowedMode=TRUE\r\nWidth=2560\r\n'), 'windowed')
  assert.equal(eqWindowModeOf('WindowedMode=FALSE'), 'fullscreen')
  assert.equal(eqWindowModeOf('  windowedmode  =  true  \n'), 'windowed')
  // Missing key, empty file, no file at all — all the same honest answer.
  assert.equal(eqWindowModeOf('[Defaults]\nWidth=2560\n'), 'unknown')
  // THE OTHER SPELLING (JOS-374). The live EverQuest Legends client writes no `WindowedMode` key
  // at all — it writes `Fullscreen=1|0`. Reading only the first spelling left the field dark for
  // every player on the current client.
  assert.equal(eqWindowModeOf('Fullscreen=1'), 'fullscreen')
  assert.equal(eqWindowModeOf('Fullscreen=0'), 'windowed')
  // The owner's actual file, in miniature: CRLF, no `WindowedMode=`, and the `Fullscreen*` and
  // `WindowedMode*Offset` neighbours that must not be mistaken for either key.
  const legends = [
    '[Defaults]',
    'WindowedModeXOffset=100',
    'WindowedModeYOffset=64',
    'WindowedWidth=2560',
    'WindowedHeight=1440',
    'FullscreenBitsPerPixel=32',
    'FullscreenRefreshRate=144',
    'Fullscreen=1'
  ].join('\r\n')
  assert.equal(eqWindowModeOf(legends), 'fullscreen')
  // The offsets are a window POSITION, not a mode: alone they answer `unknown`, never `windowed`.
  assert.equal(eqWindowModeOf('WindowedModeXOffset=100\nWindowedModeYOffset=64\n'), 'unknown')
  // Both spellings, disagreeing: a client that writes the explicit mode key is telling us the
  // mode, so `WindowedMode` wins and `Fullscreen=` is only ever the fallback reading.
  assert.equal(eqWindowModeOf('WindowedMode=TRUE\r\nFullscreen=1\r\n'), 'windowed')
  assert.equal(eqWindowModeOf(''), 'unknown')
  assert.equal(eqWindowModeOf(null), 'unknown')
  assert.equal(eqWindowModeOf(undefined), 'unknown')
  // Garbage is `unknown` and NOT a guess: a wrong answer here would misattribute exactly the
  // stalls this field exists to explain.
  assert.equal(eqWindowModeOf('WindowedMode=YES'), 'unknown')
  assert.equal(eqWindowModeOf('WindowedMode='), 'unknown')
  // THE PRIVACY PROPERTY, measured: the rest of the file cannot reach the answer, whatever is in
  // it. `eqclient.ini` holds resolutions, device names and UI skins; this returns one of three
  // words and retains none of it.
  const fat = ['UISkin=Cyrus', 'SoundDevice=Realtek Digital Output', 'WindowedMode=TRUE'].join('\n')
  assert.equal(eqWindowModeOf(fat), 'windowed')
})

test('the memory fold ROUNDS, so a 16 GB machine is a 16 GB machine', () => {
  // `os.totalmem()` reports what the OS can address — 15.9 GiB on a box with 16 GB installed,
  // after firmware and an integrated GPU take their share. Truncating would file every one of
  // them under the 12-15 bucket and report a fleet of machines nobody sells.
  const ev = buildSetupSnapshot({ ...BASE, totalMemBytes: 17_055_000_000 })
  assert.equal(ev.totalMemBucket, 4, `edges ${TOTAL_MEM_GB_EDGES.join(',')} ⇒ the 16 GB bucket`)
  assert.equal(buildSetupSnapshot({ ...BASE, totalMemBytes: 8_400_000_000 }).totalMemBucket, 2)
  assert.equal(buildSetupSnapshot({ ...BASE, totalMemBytes: 137_000_000_000 }).totalMemBucket, 7)
})

test('every machine-class field is OMITTED when the machine did not answer', () => {
  // THE OPTIONAL-MEANS-NOT-MEASURED PROPERTY. Bucket 0 is a REAL bucket here (fewer than two
  // cores, no display at all), so defaulting an unmeasured field to it would invent a population
  // of impossible machines — which is the failure this whole shape exists to prevent.
  const ev = buildSetupSnapshot(BASE)
  for (const field of [
    'cpuCountBucket',
    'totalMemBucket',
    'gpuVendor',
    'gpuCompositing',
    'safeMode',
    'displayCountBucket',
    'primaryScaleBucket',
    'eqWindowMode'
  ] as const) {
    assert.equal(ev[field], undefined, `${field} was invented from nothing`)
    assert.ok(!(field in ev), `${field} is present as an explicit undefined`)
  }
  // …and the required half is still complete, so a machine that answers nothing still reports.
  assert.ok(validateTelemetryEvent(ev).ok)
})

test('a fully answered machine folds to buckets and enums, and the validator accepts it', () => {
  const ev = buildSetupSnapshot({
    ...BASE,
    cpuCount: 8,
    totalMemBytes: 34_000_000_000,
    gpuVendorId: 0x10de,
    gpuCompositingStatus: 'enabled',
    safeMode: false,
    displayCount: 2,
    primaryScaleFactor: 1.5,
    eqClientIni: 'WindowedMode=FALSE'
  })
  assert.equal(ev.cpuCountBucket, 4, `edges ${CPU_COUNT_EDGES.join(',')} ⇒ 8 lands at index 4`)
  assert.equal(ev.totalMemBucket, 6, '34 GB of silicon is 31.7 GiB usable ⇒ the 32 GB bucket')
  assert.equal(ev.gpuVendor, 'nvidia')
  assert.equal(ev.gpuCompositing, 'hardware')
  assert.equal(ev.safeMode, false)
  assert.equal(ev.displayCountBucket, 2, `edges ${DISPLAY_COUNT_EDGES.join(',')} ⇒ two monitors`)
  assert.equal(ev.primaryScaleBucket, 3, `edges ${PRIMARY_SCALE_EDGES.join(',')} ⇒ 150%`)
  assert.equal(ev.eqWindowMode, 'fullscreen')
  // The round trip is what matters: the producer's value is exactly what the wire accepts, so
  // nothing it builds can be refused by the validator it will meet in main and in the Lambda.
  const v = validateTelemetryEvent(ev)
  assert.ok(v.ok)
  assert.deepEqual(v.value, ev)
})

test('overlaysEnabled is a deduped SET, and the counts are clamped to the wire’s ceiling', () => {
  const ev = buildSetupSnapshot({
    ...BASE,
    overlaysEnabled: ['fight', 'fight', 'events'],
    soundPackCount: -3
  })
  assert.deepEqual(ev.overlaysEnabled, ['fight', 'events'])
  assert.equal(ev.soundPackCount, 0, 'a negative count is a bug upstream, never a wire value')
  assert.ok(validateTelemetryEvent(ev).ok)
})

test('an install with no log and no characters still produces a LEGAL event', () => {
  // The fresh-install shape, and it must not be a hole in the data: bucket 0 is the honest floor
  // of both ladders, and `charCountBucket` 0 is what distinguishes it from a small log.
  const ev = buildSetupSnapshot({ ...BASE, charCount: 0, logBytes: 0, alertCount: 0 })
  assert.equal(ev.charCountBucket, 0)
  assert.equal(ev.logSizeBucket, 0)
  assert.equal(ev.alertCountBucket, 0)
  assert.ok(validateTelemetryEvent(ev).ok)
})

// ---------------------------------------------------------------- the lost children

/** The smallest thing that is an `app` to `watchChildProcessGone` — which is the point of taking
 *  an emitter rather than importing `electron`. */
function fakeApp(): ChildProcessGoneEmitter & { fire(details: unknown): void } {
  let listener: ((e: unknown, details: unknown) => void) | undefined
  return {
    on(_event, cb) {
      listener = cb
      return this
    },
    fire(details) {
      listener?.(null, details)
    }
  }
}

test('a GPU process loss is COUNTED and files exactly one exemplar', () => {
  resetHealth()
  const seen: { reason: string; exitCode: number }[] = []
  const app = fakeApp()
  watchChildProcessGone(app, (info) => seen.push(info))
  app.fire({ type: 'GPU', reason: 'crashed', exitCode: 5 })
  assert.equal(peekHealth().gpuProcessGone, 1)
  // The exemplar carries the two things a count cannot: WHY it died and with what code. Both are
  // closed-vocabulary or numeric — there is no shape here that could carry a path or a name.
  assert.deepEqual(seen, [{ reason: 'crashed', exitCode: 5 }])
  app.fire({ type: 'GPU', reason: 'oom', exitCode: 9 })
  assert.equal(peekHealth().gpuProcessGone, 2)
  assert.equal(seen.length, 2)
  resetHealth()
})

test('a UTILITY loss is counted and files NOTHING — it is not an error', () => {
  resetHealth()
  const seen: unknown[] = []
  const app = fakeApp()
  watchChildProcessGone(app, (info) => seen.push(info))
  app.fire({ type: 'Utility', reason: 'crashed', exitCode: 1, serviceName: 'audio.mojom.AudioService' })
  assert.equal(peekHealth().utilityProcessGone, 1)
  assert.equal(peekHealth().gpuProcessGone, 0)
  assert.deepEqual(seen, [], 'a helper that comes and goes by design does not file an error')
  resetHealth()
})

test('A CLEAN EXIT IS NOT A LOSS — otherwise every ordinary quit reports one', () => {
  // The one judgement in that module, pinned: Chromium tears its children down on the way out,
  // and a counter that included that would report a GPU loss on every session this app has run.
  resetHealth()
  const seen: unknown[] = []
  const app = fakeApp()
  watchChildProcessGone(app, (info) => seen.push(info))
  app.fire({ type: 'GPU', reason: 'clean-exit', exitCode: 0 })
  app.fire({ type: 'Utility', reason: 'clean-exit', exitCode: 0 })
  assert.equal(peekHealth().gpuProcessGone, 0)
  assert.equal(peekHealth().utilityProcessGone, 0)
  assert.deepEqual(seen, [])
  resetHealth()
})

test('an unrecognised payload is ignored rather than counted under a guess', () => {
  resetHealth()
  noteChildProcessGone({})
  noteChildProcessGone({ type: 'Zygote', reason: 'crashed' })
  noteChildProcessGone({ type: 'Pepper Plugin', reason: 'killed', exitCode: 1 })
  assert.equal(peekHealth().gpuProcessGone, 0)
  assert.equal(peekHealth().utilityProcessGone, 0)
  // …and a GPU loss with no reason at all still counts, with the reason it can honestly give.
  const seen: { reason: string; exitCode: number }[] = []
  noteChildProcessGone({ type: 'GPU' }, (info) => seen.push(info))
  assert.equal(peekHealth().gpuProcessGone, 1)
  assert.deepEqual(seen, [{ reason: 'unknown', exitCode: -1 }])
  resetHealth()
})
