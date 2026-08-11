/**
 * ============================================================================
 * foldCheckpointHarness.mts — THE PROOF STACK'S FIRST RUNG (JOS-208).
 * ============================================================================
 *
 * The owner's law for this feature: a checkpoint is only allowed to exist if a differential test
 * shows that
 *
 *     restore(checkpoint(fold(prefix))) + fold(tail)   ==   fold(prefix + tail)
 *
 * for every fixture log, at a matrix of split points, with deep-equal PUBLISHED SNAPSHOTS on both
 * sides. This file is the machinery; `foldCheckpointDifferential.test.mts` is the matrix, and
 * `foldGoldens.test.mts` reuses the same world builder for the semantics tripwire.
 *
 * WHAT MAKES THE TWO ARMS COMPARABLE, stated because a differential test that quietly folds two
 * different programs proves nothing:
 *
 *   * ONE WORLD BUILDER. Both arms go through `buildFoldWorld`, which is `tests/bench/foldArm.mts`'s
 *     `buildWorld` — the same `createModules` list in the same order, the same bus, the same combat
 *     engine, the same epoch and offline-gap detectors subscribed last. A module added to the app
 *     appears in both arms without anyone editing this file.
 *   * THE SAME BYTES, THROUGH THE REAL SCANNER. Neither arm hand-splits the log: both call the
 *     production `scanLog`, the cold one over [0, EOF) and the warm one over [0, B) then [B, EOF).
 *     That is what makes `startOffset` the thing under test rather than a thing the test emulates.
 *   * THE SAME STORE-DERIVED INPUTS. The respawn watch list is chosen once per fixture and handed
 *     to BOTH arms identically — which is exactly what production does (pipeline.ts injects it at
 *     construction). It is deliberately non-empty: with no watches the module publishes no rows at
 *     all, and a differential test over an empty list would prove nothing about the hardest state
 *     in the module set.
 *   * THE SAME CLOCK. `respawn` orders its published rows against a wall clock, so both arms are
 *     ticked with ONE pinned value before snapshotting. That is not a fudge: it is the go-live
 *     sweep (`registry.tick(Date.now())`, session.ts) with the clock held still, and holding it
 *     still is the only way to compare two runs that happen at two different instants.
 *
 * SPLITS ARE ALWAYS SNAPPED TO A LINE BOUNDARY, and that is a statement about what B means rather
 * than a weakening of "an arbitrary byte position". Every offset this app can ever produce — a
 * scan's `endOffset`, the tailer's `checkpointOffset()` — is the end of a COMPLETE line, because a
 * partial line has been folded by nobody. A split inside a line would drop that line from the warm
 * arm and keep it in the cold one, which is a difference in the INPUT, not in the fold.
 */
import { readFileSync } from 'node:fs'
import { CombatEngine } from '../src/main/combat/engine'
import { EpochDetector, LAUNCH_MS } from '../src/main/log/epochDetector'
import { LogBus, type LogEventListener } from '../src/main/log/bus'
import { ModuleRegistry } from '../src/main/modules/registry'
import { parseLine } from '../src/main/log/parser'
import { SESSION_GAP_MS } from '../src/main/modules/buffsShapes'
import { SessionDetector } from '../src/main/log/sessionDetector'
import { createModules } from '../src/main/modules/wiring'
import { installCharacterName } from '../src/main/log/rulesets'
import { MobLootIndex } from '../src/main/mobLookupParse'
import { scanLog } from '../src/main/log/scanHistory'
import { unchunkedSlicer } from '../src/main/log/replaySlicer'
import { decodeCache, encodeCache, type CacheHeader } from '../src/main/foldCache/format'
import { identityFrom, type ReadRange } from '../src/main/foldCache/identity'
import { FOLD_SEMANTICS } from '../src/main/foldCache/semantics'
import {
  isCheckpointable,
  moduleShapeHash,
  CHECKPOINTED_MODULE_IDS,
  type FoldUnit
} from '../src/main/foldCache/serialize'
import baselineJson from '../src/main/data/messageOverlay.baseline.json'
import { normalizeRespawnPrefs, type RespawnPrefs } from '../src/shared/respawn'
import type { MessageOverlay } from '../src/shared/types'
import type { EqModule } from '../src/main/modules/types'

const BASELINE = baselineJson as unknown as MessageOverlay

/** The character every fixture in this repo was cut from. */
export const HARNESS_CHARACTER = { name: 'Primitive', server: 'freeport', logPath: '' }

/**
 * THE PINNED CLOCK. A fixed instant, well past every fixture's last line, used as the go-live
 * sweep's `now` in both arms. A constant rather than `Date.now()` so a run today and a run in a
 * year compare the same two things — and so the golden fingerprints are reproducible.
 */
export const PINNED_NOW_MS = Date.UTC(2027, 0, 1)

export interface FoldWorld {
  bus: LogBus
  registry: ModuleRegistry
  combat: CombatEngine
  modules: EqModule[]
  /**
   * EVERYTHING THE CONTAINER CARRIES — the checkpointable modules plus the two derived-event
   * producers, in `attach.ts`'s order. Not the same list as `compared`: the detectors publish
   * nothing and are compared by their EFFECT on the modules, which is exactly how their absence
   * was caught.
   */
  units: FoldUnit[]
  /** The modules whose published snapshots the differential compares. */
  compared: FoldUnit[]
  /** The registry's OWN list of module ids, for the completeness assertion. */
  registeredIds: string[]
}

/**
 * Build the fold's consumers exactly as the app builds them — `tests/bench/foldArm.mts`'s
 * `buildWorld`, with the registry handed back so snapshots can be read and the checkpoint seam
 * reached.
 */
export function buildFoldWorld(logPath: string, respawnPrefs?: RespawnPrefs): FoldWorld {
  const bus = new LogBus()
  const modules = createModules({
    overlays: [BASELINE],
    ownLoot: new MobLootIndex(),
    ...(respawnPrefs ? { respawnPrefs } : {}),
    emitDerived: (ev, live) => {
      bus.emitDerived(ev, live)
    }
  })
  const registry = new ModuleRegistry({ emitDelta: () => undefined })
  for (const mod of modules.ordered) registry.register(mod)
  registry.reset()
  // The ref's logPath is CANONICALIZED to the fixture's basename: the real absolute path differs
  // per checkout (a worktree vs the main clone recorded different golden fingerprints for
  // `character` on every fixture — caught 2026-08-11, the phase-2 merge), and the path is an
  // environment fact the fold never computed from bytes. The basename keeps fixtures distinct.
  modules.character.setCharacter({
    ...HARNESS_CHARACTER,
    logPath: `fixtures://${logPath.split(/[\\/]/).pop()}`
  })
  installCharacterName(HARNESS_CHARACTER.name)
  registry.attach(bus)

  const combat = new CombatEngine()
  combat.setRoster(modules.roster)
  combat.reset()
  combat.setPlayerName(HARNESS_CHARACTER.name)
  const epoch = new EpochDetector()
  const sessions = new SessionDetector()
  const ingest: LogEventListener = (ev, live) => {
    combat.ingestEvent(ev, live)
  }
  const observeEpoch: LogEventListener = (ev, live) => {
    if (ev.kind === 'epoch') return
    const epochEv = epoch.observe(ev)
    if (epochEv) bus.emitDerived(epochEv, live)
  }
  const observeSession: LogEventListener = (ev, live) => {
    if (ev.kind === 'offlineGap') return
    const gap = sessions.observe(ev)
    if (gap) bus.emitDerived(gap, live)
  }
  bus.subscribe(ingest)
  bus.subscribe(observeEpoch)
  bus.subscribe(observeSession)

  // The SAME composition `attach.ts` uses in the app: registry modules first, then the producers.
  const units = [...modules.ordered, epoch, sessions].filter(isCheckpointable)
  const compared = units.filter((m) => CHECKPOINTED_MODULE_IDS.includes(m.id))
  return {
    bus,
    registry,
    combat,
    modules: modules.ordered,
    units,
    compared,
    registeredIds: modules.ordered.map((m) => m.id)
  }
}

/** Which bytes to fold, and from which seq. Absent `to` means "to EOF" — the ordinary case. */
export interface FoldRangeArgs {
  from: number
  to?: number
  seq: number
}

/** Fold `[from, to)` of the log into a world, continuing from `seq`. Returns the reached seq. */
export async function foldRange(
  world: FoldWorld,
  logPath: string,
  range: FoldRangeArgs
): Promise<{ seq: number; endOffset: number }> {
  const res = await scanLog(logPath, world.bus, range.seq, {
    slicer: unchunkedSlicer(),
    startOffset: range.from,
    ...(range.to === undefined ? {} : { endOffset: range.to })
  })
  return { seq: res.seq, endOffset: res.endOffset }
}

/**
 * THE PUBLISHED SNAPSHOTS of every compared module, after the go-live sweep — the exact objects the
 * renderer hydrates from (`module:getSnapshot`), which is what the owner's law compares.
 *
 * The tick is the sweep: it is what session.ts runs once before the first publish, and it is what
 * evicts whatever real time invalidated while the app was closed. Running it here means the warm
 * arm is compared at the same point in the lifecycle the user would see it at.
 */
export function publishedSnapshots(world: FoldWorld, nowMs = PINNED_NOW_MS): Record<string, unknown> {
  world.registry.tick(nowMs)
  return snapshotsWithoutSweep(world)
}

/**
 * The published snapshots WITHOUT the go-live sweep — for the one test that is about the ORDERING
 * itself (`foldCheckpointDifferential.test.mts`, "the go-live sweep runs before the first
 * publish"). Nothing else should reach for this: a snapshot taken before the sweep is precisely
 * the stale-bar frame the sweep exists to prevent anyone from ever seeing.
 */
export function snapshotsWithoutSweep(world: FoldWorld): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const m of world.compared) out[m.id] = world.registry.snapshot(m.id)
  return out
}

// ------------------------------------------------------------------------ split points

/** Byte offsets just past every `\n` in the file, ascending — every legal value of B. */
export function lineBoundaries(bytes: Buffer): number[] {
  const out: number[] = []
  for (let i = 0; i < bytes.length; i++) if (bytes[i] === 0x0a) out.push(i + 1)
  return out
}

/** The smallest line boundary at or after `byte` — how a fuzzed byte becomes a legal split. */
export function snapToLine(boundaries: number[], byte: number): number {
  for (const b of boundaries) if (b >= byte) return b
  return boundaries[boundaries.length - 1] ?? 0
}

/** A seeded RNG (mulberry32) so a fuzzed matrix is reproducible and a failure can be re-run. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface SplitPoint {
  /** What kind of moment this is, for the test name — the matrix's whole readability. */
  label: string
  offset: number
}

/**
 * THE MATRIX OF SPLIT POINTS for one fixture: the design's full adversarial list, made concrete
 * (phase 2 widened it from five kinds to eight, and every addition is aimed at a unit that joined
 * the container in phase 2).
 *
 *   session edges  — the line after a `Welcome to EverQuest Legends!` (a login) and the line before
 *                    it (inside the hole that precedes it), because the offline-gap detector holds
 *                    a question open across exactly that boundary.
 *   zone lines     — immediately after `You have entered`, which is where the respawn module's
 *                    zone stay begins and where a gap stops qualifying.
 *   mid-fight      — immediately after a damage line, i.e. inside an encounter the combat engine
 *                    has open and inside a stay the respawn module is measuring.
 *   mid-hold       — after a mez/charm line, the state the buff/CC ledgers carry across.
 *   MID-CAST       — immediately after `You begin casting`, i.e. BETWEEN a cast line and the
 *                    landing it owns. It is the split the cast-anchored attribution gate is most
 *                    exposed to: lose the anchor and the landing in the tail is refused as a
 *                    stranger's, so the row never appears and the learner never sees the cycle.
 *   IN-HOLE        — inside a 30-minute event-time hole that no login has yet explained, which is
 *                    the one state `SessionFrame` carries an open question through. Found by
 *                    walking the parsed timestamps rather than by matching text, because a hole is
 *                    an ABSENCE and has no line of its own.
 *   EPOCH-ADJACENT — the lines immediately before and after the launch anchor, where the epoch
 *                    detector fires once and half the fold is cleared mid-stream. Phase 1's
 *                    measured divergence lived here; these two points are the regression pin.
 *   deciles        — 10% … 90% of the lines, so no fixture is only ever split at an interesting
 *                    line (the uninteresting ones are where an off-by-one hides).
 *   fuzzed         — seeded random bytes, snapped to a line. Six per fixture rather than four now
 *                    that seventeen modules are compared instead of two.
 */
export function splitPoints(bytes: Buffer, seed: number, fuzzCount = 6): SplitPoint[] {
  const boundaries = lineBoundaries(bytes)
  if (boundaries.length < 8) return []
  const text = bytes.toString('utf8')
  const out: SplitPoint[] = []
  const seen = new Set<number>()
  const add = (label: string, offset: number): void => {
    if (offset <= 0 || offset >= bytes.length) return
    if (seen.has(offset)) return
    seen.add(offset)
    out.push({ label, offset })
  }

  for (const frac of [0.1, 0.25, 0.5, 0.75, 0.9]) {
    add(`decile-${Math.round(frac * 100)}`, boundaries[Math.floor(boundaries.length * frac)] ?? 0)
  }
  // At most two of each interesting kind: the point is coverage of the SHAPE, and a fixture with
  // 400 zone lines would otherwise dominate the matrix with one question asked 400 times.
  const scan: MatchScan = { text, boundaries, add, cap: 2 }
  addMatches(scan, /Welcome to EverQuest/g, 'session-edge')
  addMatches(scan, /You have entered/g, 'zone-line')
  addMatches(scan, /points of damage/g, 'mid-fight')
  addMatches(scan, /(mesmerized|charmed|Your .* spell has worn off)/g, 'mid-hold')
  addMatches(scan, /You begin (?:casting|singing)/g, 'mid-cast')
  addTimeSplits(text, boundaries, add)

  const rng = seededRng(seed)
  for (let i = 0; i < fuzzCount; i++) {
    add(`fuzz-${seed}-${i}`, snapToLine(boundaries, Math.floor(rng() * bytes.length)))
  }
  return out.sort((a, b) => a.offset - b.offset)
}

/**
 * The two split kinds that cannot be found by matching a line, because neither of them IS a line.
 *
 *   IN-HOLE — a hole is an absence between two stamps. We parse the log's own timestamps, find the
 *             largest event-time gaps, and split just AFTER the last line before one: the fold is
 *             then carrying an open, unexplained question across the checkpoint, which is exactly
 *             the state `SessionFrame` exists to hold and the buffs model rules on later.
 *   EPOCH-ADJACENT — the launch anchor is a wall-clock instant, not a phrase, so the boundary is
 *             found by comparing each line's stamp against `LAUNCH_MS` and splitting on both sides
 *             of the crossing.
 */
function addTimeSplits(
  text: string,
  boundaries: number[],
  add: (label: string, offset: number) => void
): void {
  const lines = parsedLineStamps(text)
  if (lines.length < 4) return
  // EPOCH-ADJACENT: the crossing of the launch anchor, from both sides.
  for (let i = 1; i < lines.length; i++) {
    if (lines[i - 1].ts < LAUNCH_MS && lines[i].ts >= LAUNCH_MS) {
      add('epoch-before', snapToLine(boundaries, lines[i - 1].byte))
      add('epoch-after', snapToLine(boundaries, lines[i].byte))
      break
    }
  }
  // IN-HOLE: the two largest event-time gaps that clear the model's own 30-minute boundary.
  const gaps: { at: number; span: number }[] = []
  for (let i = 1; i < lines.length; i++) {
    const span = lines[i].ts - lines[i - 1].ts
    if (span >= SESSION_GAP_MS) gaps.push({ at: lines[i - 1].byte, span })
  }
  gaps.sort((a, b) => b.span - a.span)
  gaps.slice(0, 2).forEach((g, i) => add(`in-hole-${i}`, snapToLine(boundaries, g.at)))
}

/**
 * Every line's parsed timestamp and the byte offset just past it, through the PRODUCTION line
 * parser. Unstamped lines are skipped — they carry no instant and cannot bound a hole.
 */
function parsedLineStamps(text: string): { ts: number; byte: number }[] {
  const out: { ts: number; byte: number }[] = []
  let byte = 0
  for (const line of text.split('\n')) {
    byte += Buffer.byteLength(line, 'utf8') + 1
    const parsed = parseLine(line.endsWith('\r') ? line.slice(0, -1) : line)
    if (parsed) out.push({ ts: parsed.ts, byte })
  }
  return out
}

interface MatchScan {
  text: string
  boundaries: number[]
  /** At most this many of each kind — the point is coverage of the SHAPE, not of one fixture. */
  cap: number
  add: (label: string, offset: number) => void
}

function addMatches(scan: MatchScan, re: RegExp, label: string): void {
  const { text, boundaries, add, cap } = scan
  let taken = 0
  for (const m of text.matchAll(re)) {
    if (taken >= cap) return
    // `m.index` is a CHARACTER offset and B is a BYTE offset. Every EQ line this matches is ASCII,
    // but a fixture may hold a non-ASCII name earlier in the file, so convert rather than assume.
    const byte = Buffer.byteLength(text.slice(0, m.index), 'utf8')
    add(`${label}-${taken}`, snapToLine(boundaries, byte))
    taken++
  }
}

// ------------------------------------------------------------------ the checkpoint round trip

/**
 * Serialize every UNIT of `world` at `offset` into REAL CONTAINER BYTES.
 *
 * Through `encodeCache`, not through a hand-rolled object copy: the differential test is also the
 * format's round-trip test, and a warm arm that skipped the encoder would prove the fold correct
 * over a path no user takes.
 */
export function checkpointBytes(
  world: FoldWorld,
  logPath: string,
  at: { offset: number; seq: number; lastEventTs?: number }
): Buffer {
  const { offset, seq } = at
  const lastEventTs = at.lastEventTs ?? 0
  const bytes = readFileSync(logPath)
  const read: ReadRange = (off, len) => bytes.subarray(Math.max(0, off), Math.max(0, off) + len)
  const header: CacheHeader = {
    foldSemantics: FOLD_SEMANTICS,
    seq,
    writtenAtMs: 0,
    identity: identityFrom(read, { size: bytes.length, b: offset, characterKey: 'primitive@freeport', lastEventTs }),
    modules: world.units.map((m) => ({ id: m.id, shapeHash: moduleShapeHash(m) }))
  }
  const states = new Map<string, unknown>()
  for (const m of world.units) states.set(m.id, m.serializeFold())
  return encodeCache(header, states)
}

/** Restore a container's blobs into a world's UNITS. Returns the header's seq, or null on refusal. */
export function restoreInto(world: FoldWorld, container: Buffer): number | null {
  const decoded = decodeCache(container)
  if (!decoded.ok) return null
  for (const m of world.units) {
    if (!decoded.value.blobs.has(m.id)) return null
    if (!m.deserializeFold(decoded.value.blobs.get(m.id))) return null
  }
  return decoded.value.header.seq
}

// ------------------------------------------------------------------------ the fixture corpus

/**
 * THE CORPUS. Chosen for what each one CONTAINS rather than for size: the differential matrix is
 * only as honest as the log shapes it is run over, and that boundary is stated in semantics.ts as
 * well.
 */
export const FOLD_FIXTURES: readonly string[] = [
  // A full evening: fights, loot, zone changes, deaths — the ordinary case, at 233 KB the largest
  // committed log and the one the timing numbers are quoted from.
  'e2e-combat.log',
  // Group lifecycle: roster churn, other people's casts, buff fan-out.
  'g1-group-lifecycle.log',
  // A pet arc — claims, charms, retirement — i.e. the entity model's hardest hour.
  'p2-pet-arc-bound.log',
  // Levels + AA, and the `/who` rows the loadout inference anchors on.
  'e2e-leveling.log',
  // An OVERNIGHT CAMP: the offline gap, the buff-clock shift, and a hole a split can land inside.
  's1-session-overnight-camp.log',
  // The beta wipe — an EPOCH boundary, which clears half the fold mid-stream.
  'epoch-beta-wipe.log'
]

/**
 * THE RESPAWN WATCH LIST for a fixture, derived from the fixture itself.
 *
 * Store-derived state is never in a checkpoint, so both arms must be GIVEN the same list — and an
 * empty one (the shipped default) would leave `RespawnSnap.rows` empty in every arm and prove
 * nothing. So: fold once with no watches, take the mobs that actually died in this log, and hand
 * that list to both arms. Deterministic (the fold order is the file order), and it is exactly the
 * shape production has: a preference chosen outside the fold and injected into it.
 */
export async function watchesFor(logPath: string, max = 12): Promise<RespawnPrefs> {
  const world = buildFoldWorld(logPath)
  await foldRange(world, logPath, { from: 0, seq: 0 })
  const snap = world.registry.snapshot('respawn')?.state as { recent?: { key: string }[] } | undefined
  const keys = (snap?.recent ?? []).slice(0, max).map((r) => r.key)
  return normalizeRespawnPrefs({ watches: keys.map((key) => ({ key })) })
}
