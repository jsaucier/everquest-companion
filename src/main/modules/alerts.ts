// alerts module — the first real proof of the EqModule extension contract.
//
// It evaluates 'event' and 'raw' alert triggers against LIVE LogEvents only (the
// registry never flushes during replay, but we ALSO gate here so a future direct
// caller can't accidentally fire on historical events), respecting each alert's
// enabled flag and cooldown. Each fire is accumulated and pushed as the standard
// `module:delta` payload `{ fired: FiredAlert[] }`; the renderer's always-mounted
// player turns those into actual audio.
//
// 'app'-type triggers (e.g. bossDefeat) are evaluated RENDERER-side (they depend
// on derived boss state that lives in the renderer), so this module stores/serves
// their defs via snapshot() but never fires them itself.
//
// COMPOSITE triggers (Task #47): a trigger may be `{type:'any'|'all', conditions:[…]}` over
// the primitive event/raw/app shapes. 'any' fires when ANY condition matches a single event
// (OR); 'all' fires only when EVERY condition matches THE SAME event (AND — same-event only,
// no cross-event windows). Cooldown is per ALERT, not per condition — and, since the owner's
// 2026-08-04 slow incident, per alert-and-TARGET when the def asks for it (`cooldownScope`,
// see `cooldownKey` below). It also matches the DERIVED
// `buffExpired` event the buffs module synthesizes (a resolved, unambiguous "wears off you /
// your pet" signal) — see shared/logEvents.ts BuffExpiredEvent + log/bus.ts emitDerived.
//
// Alert defs are owned by the store; the module holds a live copy that main keeps
// in sync (setDefs) whenever the user saves/deletes an alert.
//
// CAPTURE GROUPS (JOS-103). A trigger's regexes may declare NAMED groups, and what they capture
// rides out on `FiredAlert.captures` so a spoken alert can say it ("Puma on Fail"). THIS FILE IS
// ONE OF THE TWO ENFORCEMENT POINTS — read the threat model in shared/alertCaptures.ts before
// touching `fieldMatches`, `capturesFrom` or `conditionMatches`. The short form of what is
// enforced HERE, and it is control 3 of that model: a capture may only come from the text the
// def's OWN condition just tested, on an event this alert already subscribed to — a `raw`
// condition captures from `ev.raw`, a `where` matcher captures from that one field's value.
// There is no path to another event, another alert, or app state, and there are no ambient
// tokens. Every value leaves through `harvestCaptures`, which sanitizes it and caps both its
// length and the number of groups; nothing downstream is trusted to do that for us.

import type { EqModule } from './types'
import { idKey } from '../log/parseCommon'
import { S, validate, type FoldSchema } from '../foldCache/schema'
import type { FoldCheckpointable } from '../foldCache/serialize'
import { harvestCaptures } from '../../shared/alertCaptures'
import type { LogEvent } from '../../shared/logEvents'
import type {
  AlertDef,
  AlertFireRecord,
  AlertsDelta,
  AlertsSnap,
  AlertTrigger,
  AlertTriggerPrimitive,
  FiredAlert,
  PoisonSlowRecency
} from '../../shared/types'

const DEFAULT_COOLDOWN_MS = 2000
/** Max fires kept per alert in the recent-fires ring buffer (Task #22). */
const HISTORY_CAP = 20
/**
 * Max distinct spell DISPLAY names kept in the rank recency map. A character's own cast
 * vocabulary is well under 300 in the reference log; the cap is a bound, not a policy, and
 * it evicts the least-recently-cast name so the map always describes what you use NOW.
 */
const SPELL_CAST_CAP = 400
/**
 * Max distinct cooldown clocks kept at once, across every alert (Task: per-target cooldowns).
 *
 * An alert-level clock is ONE entry per alert, so this cap exists entirely for the
 * `cooldownScope:'target'` alerts, which mint an entry per mob: a marathon session slays
 * thousands, and an unbounded map would keep a row for every corpse of the day.
 *
 * Eviction is least-recently-FIRED (the map is re-inserted on write, so its iteration order is
 * oldest-first — the same trick `spellLastCast` uses). That ordering is what makes the bound
 * safe rather than merely small: the entry discarded is the one whose cooldown is the closest
 * to having expired anyway, so the worst case of an eviction is one extra alert on a mob
 * nobody has hit in hundreds of fires — never a suppressed one.
 */
const COOLDOWN_KEY_CAP = 500

/**
 * A compiled matcher value: the predicate, plus the RegExp it compiled to when the spec was
 * written in `/regex/` form.
 *
 * The regex is kept BESIDE the predicate rather than behind it because a named capture group is
 * only readable from the RegExp itself (`exec().groups`) — see `fieldMatches`. Nothing else about
 * matching changed: `test` is the same predicate it always was, and a literal spec has no `re` at
 * all, so it can capture nothing.
 */
interface CompiledMatch {
  test: (fieldValue: string) => boolean
  re?: RegExp
}

/**
 * Compile a matcher value into a predicate. A value wrapped in slashes (`/.../`)
 * is a case-insensitive regex; anything else is a case-insensitive exact match on
 * the stringified field. Invalid regex falls back to literal equality so a bad
 * def degrades gracefully instead of throwing in the hot path.
 */
function compileFieldMatch(spec: string): CompiledMatch {
  if (spec.length >= 2 && spec.startsWith('/') && spec.endsWith('/')) {
    const body = spec.slice(1, -1)
    try {
      // No 'g' flag, so `exec`/`test` are stateless and this compiled object is safe to reuse
      // across every event without a `lastIndex` reset (the trap `hasWireControls` documents).
      const re = new RegExp(body, 'i')
      return { test: (v) => re.test(v), re }
    } catch {
      // fall through to literal
    }
  }
  const lower = spec.toLowerCase()
  return { test: (v) => v.toLowerCase() === lower }
}

/**
 * Stringify ONE event field for matching. A `where` key names an arbitrary field of an
 * arbitrary LogEvent, so the value is nearly always a string/number/boolean — but a few fields
 * hold arrays (`damage.modifiers`, the buff-landing `candidates` lists, one of which is an
 * array of OBJECTS).
 *
 * This reproduces JS's own `String()` coercion rather than improving on it, because the coerced
 * text is exactly what every existing alert def is matched against: an array joins its elements
 * with ',' (a nullish element contributing ''), and an object element renders as the literal
 * '[object Object]'. That last one IS what a def matching on the object-shaped `candidates` list
 * sees today — making it nicer would silently change which alerts fire. The final fallback also
 * absorbs bigint/symbol/function, which no LogEvent field holds.
 */
function fieldText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value == null) return '' // only reachable as an array ELEMENT — join() renders nullish as ''
  if (Array.isArray(value)) return (value as unknown[]).map(fieldText).join(',')
  return '[object Object]'
}

/**
 * THE SPELL NAMES ONE EVENT CAN HONESTLY ANSWER TO (JOS-84) — `ev.spell` plus every name in the
 * event's `candidates` list, or an empty array when the event carries no candidates.
 *
 * WHY THIS EXISTS. `buffApply.spell` / `buffWearOff.spell` are documented as a BEST-EFFORT PICK:
 * EQ's landing and wears-off sentences are shared across a whole spell family (`<mob> slows
 * down.` is Forlorn Deeds / Languid Pace / Rejuvenation / Shiftless Deeds / Tepid Deeds; `<mob>
 * looks frail.` is Disempower / Incapacitate / Listless Power), so the parser cannot name the
 * spell from the line and puts the FIRST DB candidate in `spell` while `candidates` carries the
 * truth. The suggestion wizard authored `where:{spell:'<your spell>'}` against that first pick,
 * which is a coin flip the user always loses: an enchanter's Shiftless Deeds alert was compared
 * to the string "Forlorn Deeds" and could never fire. MEASURED against the reporter's own log
 * lines — that is the whole of JOS-84.
 *
 * So a `where.spell` matcher tests the WHOLE SET. It is the same reading shared/alertGroups.ts
 * already argues for the on-you slow ("both sentences are shared by a whole slow family and name
 * no spell, so this alert reports that a slow expired, never which one"), applied to the mob side
 * as well: when the game prints one sentence for five spells, an alert on any one of them is an
 * alert on the family, and firing is the honest answer. The alternative — silence — is the bug.
 *
 * SCOPE. Only the `spell` key widens, and only when the event actually carries `candidates`.
 * `where:{candidates:…}` is untouched (it still sees `fieldText`'s '[object Object]' join, which
 * is what today's defs are matched against), families with no candidate list (castBegin, resist,
 * buffFade, the derived buffExpired) are byte-for-byte unchanged, and an event that carries
 * candidates but no `spell` field at all (poisonProc names its `strike`) still fails the
 * pre-existing "field is absent ⇒ no match" test before this is ever consulted.
 */
function spellCandidateNames(ev: LogEvent): string[] {
  const cands = (ev as unknown as Record<string, unknown>).candidates
  if (!Array.isArray(cands)) return []
  const out: string[] = []
  for (const c of cands as unknown[]) {
    if (typeof c === 'string') out.push(c)
    else if (typeof c === 'object' && c !== null) {
      const name = (c as { name?: unknown }).name
      if (typeof name === 'string') out.push(name)
    }
  }
  return out
}

/** One compiled `where` entry: the event field it names and the matcher it compiled to. */
interface CompiledField extends CompiledMatch {
  key: string
}

/**
 * A CONDITION THAT MATCHED, plus whatever its named groups captured (JOS-103).
 *
 * An object rather than a boolean because "matched" and "matched, and here is what it named" are
 * one answer: recomputing the captures afterwards would mean running the pattern a second time
 * and hoping the second run agreed with the first. `captures` is absent for the overwhelming
 * majority of conditions, which declare no named group at all.
 */
interface ConditionHit {
  captures?: Record<string, string>
}

/** Merge a hit's captures into an accumulator, first writer wins. Undefined stays undefined. */
function mergeCaptures(
  into: Record<string, string> | undefined,
  from: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (!from) return into
  if (!into) return { ...from }
  for (const [k, v] of Object.entries(from)) if (!(k in into)) into[k] = v
  return into
}

/**
 * Whether ONE compiled `where` field accepts `ev`, and what it captured.
 *
 * An ABSENT field is still an immediate no-match, exactly as before — that is what keeps a
 * `where:{spell:…}` written against a family with no `spell` field (poisonProc names its
 * `strike`) from being admitted through the candidate list below.
 *
 * CAPTURES COME FROM THE TEXT THIS MATCHER ACTUALLY TESTED, and from nowhere else — control 3 of
 * the threat model in shared/alertCaptures.ts. For a `/regex/`-form matcher that means the
 * stringified value of the ONE field this `where` entry names, on the ONE event kind the trigger
 * subscribed to. A literal matcher has no RegExp and therefore captures nothing.
 *
 * The JOS-84 spell widening captures from the CANDIDATE NAME that satisfied the matcher, for the
 * same reason `matchedSpellName` reports that name rather than the event's best-effort pick: the
 * text the pattern matched is the text it named.
 */
function fieldMatches(ev: LogEvent, f: CompiledField): ConditionHit | null {
  const raw = (ev as unknown as Record<string, unknown>)[f.key]
  if (raw == null) return null
  const text = fieldText(raw)
  if (f.test(text)) return capturesFrom(f, text)
  // Only the `spell` key widens, and only when the event carries candidates (JOS-84).
  if (f.key !== 'spell') return null
  const hit = spellCandidateNames(ev).find((n) => f.test(n))
  return hit === undefined ? null : capturesFrom(f, hit)
}

/** Run a matcher's own RegExp over the text it just accepted, and bound what it named. */
function capturesFrom(f: CompiledMatch, text: string): ConditionHit {
  if (!f.re) return {}
  const m = f.re.exec(text)
  const captures = harvestCaptures(m?.groups)
  return captures ? { captures } : {}
}

/** A single PRIMITIVE condition prepared for fast evaluation (regex compiled once). */
interface CompiledCondition {
  event?: { kind: string; fields: CompiledField[] }
  raw?: RegExp
  // 'app' primitives compile to neither event nor raw → they never match main-side.
}

/** What a matching trigger yields: the text to record, plus anything its pattern named. */
interface AlertMatch {
  text: string
  captures?: Record<string, string>
}

/**
 * A compiled alert. A primitive trigger compiles to a single condition (`composite:'single'`);
 * a composite compiles to its type ('any'/'all') + the list of compiled conditions (Task #47).
 */
interface CompiledAlert {
  def: AlertDef
  composite: 'single' | 'any' | 'all'
  conditions: CompiledCondition[]
}

/** Compile one PRIMITIVE trigger into a matcher condition. */
function compileCondition(t: AlertTriggerPrimitive): CompiledCondition {
  if (t.type === 'event') {
    const fields: CompiledField[] = Object.entries(t.where ?? {}).map(([key, spec]) => ({
      key,
      ...compileFieldMatch(spec)
    }))
    return { event: { kind: t.kind, fields } }
  }
  if (t.type === 'raw') {
    let re: RegExp
    try {
      re = new RegExp(t.regex, 'i')
    } catch {
      // A bad regex should never match (and never throw); use a pattern that can't.
      re = /$.^/
    }
    return { raw: re }
  }
  // 'app' triggers are renderer-evaluated; compile to an empty condition (never matches here).
  return {}
}

// ---- spell context on the firing payload (docs/plans/voice-alerts.md §1) ----
//
// A spoken alert can say the spell that set it off ("Mesmerization", "Swift"), which means the
// FIRING has to carry it: the renderer receives `FiredAlert`, and before this it carried only
// the alert id, the timestamp and the matched raw line. Re-deriving the spell renderer-side
// would mean a second parser for lines main has already parsed.
//
// WHICH FIELD NAMES THE SPELL, PER KIND — measured against shared/logEvents.ts, not assumed.
// Most of the families spell it `spell`; three do not, and the exceptions are the whole reason
// this is a table instead of a property read:
//   * poisonProc  → `strike`  (the Strike's own name; a proc has no cast line at all)
//   * poisonCoat  → `poison`  (and it is the literal string 'unknown' for the generic
//                              third-person coat line, which is filtered below — 'unknown' is
//                              a stated absence, not a spell name)
//   * damage      → `skill`, but ONLY for dtype 'spell' | 'dot' (verified in log/parseCombat.ts:
//                   the typed-nuke and DoT shapes put the spell name there). For 'melee' it is
//                   a melee skill and for 'ds' it is the damage-shield element — neither is a
//                   spell, so neither is claimed. Handled separately, below.
//
// FAMILIES THAT CARRY NO SPELL, and therefore fall back to the alert's name when a spell speech
// mode fires on them: zone, loot, offer, trade, level, expGain, aaGain, aaSpend, aaActivate (an
// AA name is not a spell), death, playerDeath, mitigation, miss, charm, uncharm, petClaim,
// spellEmote (the emote text names no spell — that ambiguity is the point of the family),
// illusionFade (27-way ambiguous by design), poisonDry, stanceChange, invocationChange, selfWho,
// skillUp, itemActivate, itemMerge, itemMergeFailed, consider, epoch, sessionStart, campStart,
// campAbort, offlineGap, unknown — plus EVERY 'raw' trigger that matched a spell-less line and
// every renderer-evaluated 'app' signal (bossDefeat / questComplete, which arrive via appFired
// and never see a LogEvent at all).
//
// `cc` and `heal` declare `spell?` — present on some shapes only (a CC application names no
// spell; its worn-off keep-alive does). An absent field is simply an absent spell.

/** Event kind → the field on that event whose value is the triggering spell's DISPLAY name. */
const SPELL_FIELD_BY_KIND: Partial<Record<LogEvent['kind'], string>> = {
  castBegin: 'spell',
  castFizzle: 'spell',
  castInterrupted: 'spell',
  resist: 'spell',
  cc: 'spell',
  heal: 'spell',
  buffApply: 'spell',
  buffFade: 'spell',
  buffWearOff: 'spell',
  buffExpired: 'spell',
  poisonProc: 'strike',
  poisonCoat: 'poison'
}

/**
 * The spell that set this event off, DISPLAY form with the rank suffix INTACT — or undefined
 * when the family names none. Rank-stripping belongs to the speech resolver
 * (shared/speechText.ts), never to the producer: a consumer that wants "Mesmerization III"
 * must still be able to see the III.
 *
 * The one dynamic read mirrors `conditionMatches`'s own field access (the `where` matcher has
 * always indexed events by an arbitrary key), so this introduces no new escape hatch.
 */
function firingSpell(ev: LogEvent): string | undefined {
  if (ev.kind === 'damage') {
    return ev.dtype === 'spell' || ev.dtype === 'dot' ? ev.skill.trim() || undefined : undefined
  }
  const field = SPELL_FIELD_BY_KIND[ev.kind]
  if (field === undefined) return undefined
  const value = (ev as unknown as Record<string, unknown>)[field]
  if (typeof value !== 'string') return undefined
  const name = value.trim()
  // 'unknown' is what a poisonCoat says when the line deliberately hides which poison it was.
  return name && name !== 'unknown' ? name : undefined
}

/**
 * The spell name to SPEAK for this firing — `base` (the event's own best-effort pick) unless the
 * alert matched a different candidate (JOS-84).
 *
 * The companion to `spellCandidateNames`: once a Shiftless Deeds alert is allowed to fire on a
 * line whose `spell` field says "Forlorn Deeds", announcing "Forlorn Deeds" would be a second
 * wrong answer wearing the first one's clothes. So the name reported is the one that actually
 * satisfied the alert's OWN `spell` matcher. A def whose matcher already accepts the base pick
 * keeps it (nothing changes for the unambiguous case, which is every family without candidates),
 * and a regex-shaped matcher resolves to the first candidate it accepts — the honest answer when
 * one sentence is five spells, since the log itself does not say which.
 *
 * Runs once per FIRE, never per compiled alert per event: firings are rare, matching is not.
 */
function matchedSpellName(c: CompiledAlert, ev: LogEvent, base: string | undefined): string | undefined {
  if (base === undefined) return undefined
  const names = spellCandidateNames(ev)
  if (names.length === 0) return base
  for (const cond of c.conditions) {
    if (cond.event?.kind !== ev.kind) continue
    const f = cond.event.fields.find((x) => x.key === 'spell')
    if (!f || f.test(base)) continue
    const hit = names.find((n) => f.test(n))
    if (hit !== undefined) return hit
  }
  return base
}

/**
 * The cooldown clock this firing belongs to (AlertDef.cooldownScope).
 *
 * 'alert' (and absent, which means the same thing) → the alert's own id: one clock, exactly as
 * every alert behaved before per-target scope existed.
 *
 * 'target' → `<id>\0<idKey(target)>`, so the first match on a mob always fires and only re-lands
 * on THAT mob are rate-limited. `target` is read dynamically because it is a field of some
 * LogEvent shapes and not others — the same arbitrary-field access `where` matchers have always
 * done. A family that names no target (or names an empty one) has nothing to scope by and
 * DEGRADES to the alert-level clock rather than minting a bogus one: that is a quieter alert,
 * never a missing cooldown, and it never throws in the hot path.
 *
 * `idKey` is the repo-wide canonicalization (world-model law 2: names are dirty — damage lines
 * capitalize the article, lifecycle lines lowercase it), so "King Tranix" and "king tranix" are
 * one mob and cannot hold two clocks between them.
 */
function cooldownKey(def: AlertDef, ev: LogEvent): string {
  if (def.cooldownScope !== 'target') return def.id
  const target = (ev as unknown as Record<string, unknown>).target
  if (typeof target !== 'string') return def.id
  const key = idKey(target)
  return key ? `${def.id}\u0000${key}` : def.id
}

function compileAlert(def: AlertDef): CompiledAlert {
  const t: AlertTrigger = def.trigger
  if ('conditions' in t) {
    return { def, composite: t.type, conditions: t.conditions.map(compileCondition) }
  }
  return { def, composite: 'single', conditions: [compileCondition(t)] }
}

/**
 * THE CHECKPOINT DECLARATION (JOS-208 phase 2). This module folds two things on REPLAY and
 * everything else only when live, and the split is exactly what is stored:
 *
 *   IN — `spellLastCast` (rank-preserving cast recency) and `poisonSlowSeen`. Both are recorded
 *        for replayed events on purpose (their own field docs say why: the suggestion surface and
 *        the offer strip must be right at HYDRATION, not one proc later), so a cold replay of a
 *        prefix produces them and a checkpoint must too. `spellLastCast` is an entries ARRAY
 *        because its Map order is the LRU the SPELL_CAST_CAP eviction walks — a record would
 *        throw away the eviction order and start evicting the wrong names.
 *
 *   OUT — `compiled` (the user's alert DEFS, store-owned and re-injected by `setDefs` on every
 *        save), `lastFire` and `history` (a fire is a LIVE event; a replay never makes a sound,
 *        so a cold replay produces neither), and the two pending delta maps.
 */
const ALERTS_FOLD_SCHEMA: FoldSchema = S.obj({
  spellLastCast: S.arr(S.tuple(S.str, S.num)),
  poisonSlowSeen: S.opt(S.obj({ lastAt: S.num, count: S.num, lastTarget: S.str })),
  seq: S.num
})

/** The alerts module's complete event-derived state — the defs and the fire log excluded. */
export interface AlertsFoldState {
  spellLastCast: [string, number][]
  poisonSlowSeen?: PoisonSlowRecency
  seq: number
}

export class AlertsModule implements EqModule<AlertsSnap, AlertsDelta>, FoldCheckpointable<AlertsFoldState> {
  readonly id = 'alerts'
  private compiled: CompiledAlert[] = []
  private seq = 0
  /**
   * COOLDOWN CLOCK → last fire timestamp (ms).
   *
   * The key is `def.id` for an ordinary (alert-scoped) alert and `def.id\0<targetKey>` for a
   * `cooldownScope:'target'` one — see `cooldownKey`. One map holds both because the two are
   * never confusable: a NUL can appear in no alert id and in no mob name, so an alert-level
   * row can never collide with one of its own per-target rows. Bounded by COOLDOWN_KEY_CAP,
   * least-recently-fired first.
   */
  private lastFire = new Map<string, number>()
  /** fires accumulated since the last flush. */
  private pending: FiredAlert[] = []
  /**
   * Per-alert ring buffer of recent fires (last HISTORY_CAP, newest last). The
   * single source of truth for the renderer's "recent fires" panel — fed by both
   * main-side event/raw fires (onEvent) and renderer-routed app fires (appFired).
   * Persists across character switches so history isn't lost on a reload.
   */
  private history = new Map<string, AlertFireRecord[]>()
  /**
   * RANK-PRESERVING cast recency: spell DISPLAY name (suffix intact — "Mesmerization III") →
   * the newest ts you were seen to begin casting it.
   *
   * WHY IT LIVES HERE. The buffs model's own `lastSeen` map is keyed by `spellCanonKey`, which
   * STRIPS the rank — so it cannot answer "which rank am I actually using", the question the
   * suggestions surface and the upgrade offers are built on. `castBegin` is the literal
   * definition of "most recently cast" and is the ONE event family that keeps the rank
   * (fizzle / interrupt / wears-off lines all drop it). Recording it here costs one map write
   * per cast and adds no IPC: the alerts snapshot already flows to the renderer via useModule.
   *
   * Recorded for REPLAY events too (unlike firing, which is live-only) so the map is complete
   * the moment the renderer hydrates.
   */
  private spellLastCast = new Map<string, number>()
  /** Names whose recency advanced since the last flush (delta payload). */
  private castPending = new Map<string, number>()
  /**
   * ROGUE SLOW POISON RECENCY (docs/plans/poison-slow-alerts.md §1.3) — the observation the
   * "alert when a mob gets slowed?" offer is made from. Recorded on REPLAY as well as live,
   * exactly like `spellLastCast` above and for the same reason: the offer must be right at
   * hydration, not one proc later. Null until a slow has actually been seen — an offer is
   * never made from an assumption about what class you are playing beside.
   */
  private poisonSlowSeen: PoisonSlowRecency | null = null
  /** true when `poisonSlowSeen` advanced since the last flush (delta payload). */
  private poisonSlowDirty = false

  /** Replace the live alert set (called by main after load + every save/delete). */
  setDefs(defs: AlertDef[]): void {
    this.compiled = defs.map(compileAlert)
  }

  /** The defs currently loaded (for snapshot()). */
  private defs(): AlertDef[] {
    return this.compiled.map((c) => c.def)
  }

  reset(): void {
    // Defs persist across character switches (they're user prefs, not log state);
    // only the per-character firing bookkeeping resets. The cast-recency map IS character
    // state (a different character casts different ranks), so it resets with it — the
    // replay that follows repopulates it.
    this.seq = 0
    this.lastFire = new Map()
    this.pending = []
    this.spellLastCast = new Map()
    this.castPending = new Map()
    this.poisonSlowSeen = null
    this.poisonSlowDirty = false
  }

  /**
   * Record a rank-preserving cast. Runs for replay events as well as live ones — the map
   * describes the character, not the session, and the renderer must see it at hydration.
   */
  private noteCast(ev: LogEvent): void {
    if (ev.kind !== 'castBegin') return
    const name = ev.spell.trim()
    if (!name) return
    const prev = this.spellLastCast.get(name)
    if (prev !== undefined && prev >= ev.ts) return
    // Re-insert so Map iteration order stays least-recent-first for the eviction below.
    this.spellLastCast.delete(name)
    this.spellLastCast.set(name, ev.ts)
    this.castPending.set(name, ev.ts)
    if (this.spellLastCast.size > SPELL_CAST_CAP) {
      const oldest = this.spellLastCast.keys().next()
      if (!oldest.done) this.spellLastCast.delete(oldest.value)
    }
  }

  /**
   * Record a rogue slow landing. Like `noteCast`, this runs for REPLAY events too — the
   * record describes the character's fights, not the current session, and the offer strip
   * must be correct at hydration.
   *
   * `effect` is the unambiguous half of a poison proc: the two shared emotes are shared
   * between strikes that agree on their effect (shared/poisons.ts), so 'slow' is exactly
   * Weakening Strike's landing and nothing else.
   */
  private notePoisonSlow(ev: LogEvent): void {
    if (ev.kind !== 'poisonProc' || ev.effect !== 'slow') return
    const prev = this.poisonSlowSeen
    this.poisonSlowSeen = {
      lastAt: Math.max(prev?.lastAt ?? 0, ev.ts),
      count: (prev?.count ?? 0) + 1,
      lastTarget: ev.ts >= (prev?.lastAt ?? 0) ? ev.target : (prev?.lastTarget ?? ev.target)
    }
    this.poisonSlowDirty = true
  }

  onEvent(ev: LogEvent, live: boolean): void {
    this.seq = ev.seq
    this.noteCast(ev)
    this.notePoisonSlow(ev)
    // Fire on LIVE events only — replay must never make a sound.
    if (!live) return
    // The event's own best-effort spell is resolved once per firing (fires are rare), not once
    // per compiled alert; `matchedSpellName` then refines it PER ALERT for the shared-message
    // families, where which name is right depends on which alert matched (JOS-84).
    let base: string | undefined
    let spellResolved = false
    for (const c of this.compiled) {
      if (!c.def.enabled) continue
      const match = this.matches(c, ev)
      if (match == null) continue
      const key = cooldownKey(c.def, ev)
      if (this.onCooldown(key, c.def, ev.ts)) continue
      this.noteFire(key, ev.ts)
      if (!spellResolved) {
        base = firingSpell(ev)
        spellResolved = true
      }
      const spell = matchedSpellName(c, ev, base)
      const fired: FiredAlert = { alertId: c.def.id, ts: ev.ts, matchedText: match.text }
      // Omitted rather than set to undefined: the delta is JSON over IPC, and an absent key
      // is the honest encoding of "this family names no spell".
      if (spell !== undefined) fired.spell = spell
      // Likewise absent when the trigger declared no named group — which is nearly every alert,
      // so the delta stays byte-identical for them. The values are already sanitized and capped
      // (shared/alertCaptures.ts `harvestCaptures`); nothing downstream re-derives them.
      if (match.captures) fired.captures = match.captures
      this.pending.push(fired)
      this.record(c.def.id, ev.ts, match.text)
    }
  }

  /**
   * Record a renderer-evaluated 'app' fire (e.g. bossDefeat) into the history so
   * the module stays the single source of truth for recent fires. `context` is the
   * signal's matched text (e.g. the boss name). The renderer already applied the
   * cooldown before calling this; we just append to the ring. Returns the updated
   * history for that alert so main can push it back if desired.
   */
  appFired(alertId: string, context: string, ts: number = Date.now()): void {
    // Only record for a known 'app' alert id (ignore stale/unknown ids).
    const known = this.compiled.some((c) => c.def.id === alertId)
    if (!known) return
    this.record(alertId, ts, context)
    // Also queue a delta so the renderer's history updates over the same module
    // transport as event/raw fires. Bump seq so useModule doesn't reject it as a
    // dupe (app fires arrive off the bus, so there's no fresh LogEvent seq); a
    // trailing flushNow() by main pushes it. matchedText = the signal context.
    this.seq += 1
    this.pending.push({ alertId, ts, matchedText: context })
  }

  /** Append a fire to an alert's ring buffer, capping at HISTORY_CAP (newest last). */
  private record(alertId: string, ts: number, matchedText: string): void {
    const arr = this.history.get(alertId) ?? []
    arr.push({ ts, matchedText })
    if (arr.length > HISTORY_CAP) arr.splice(0, arr.length - HISTORY_CAP)
    this.history.set(alertId, arr)
  }

  /** The recent-fires ring as a plain object for the snapshot. */
  private historyObj(): Record<string, AlertFireRecord[]> {
    const out: Record<string, AlertFireRecord[]> = {}
    for (const [id, arr] of this.history) out[id] = arr.slice()
    return out
  }

  /** Whether the clock `key` is still within alert `def`'s cooldown window at `ts`. */
  private onCooldown(key: string, def: AlertDef, ts: number): boolean {
    const cd = def.cooldownMs ?? DEFAULT_COOLDOWN_MS
    const last = this.lastFire.get(key)
    return last !== undefined && ts - last < cd
  }

  /**
   * Stamp a fire on clock `key`, keeping the map bounded and its iteration order
   * least-recently-fired first (delete-then-set re-inserts at the tail).
   */
  private noteFire(key: string, ts: number): void {
    this.lastFire.delete(key)
    this.lastFire.set(key, ts)
    if (this.lastFire.size > COOLDOWN_KEY_CAP) {
      const oldest = this.lastFire.keys().next()
      if (!oldest.done) this.lastFire.delete(oldest.value)
    }
  }

  /**
   * Returns the matched text if the alert's trigger matches `ev`, else null.
   *
   * Composite semantics (Task #47) — evaluated against the SINGLE incoming event:
   *   'any'    → fires when at least ONE condition matches (OR).
   *   'all'    → fires only when EVERY condition matches THE SAME event (AND).
   *   'single' → the one primitive condition (backward-compatible, unchanged).
   * Cross-event correlation is deliberately out of scope; an 'all' over conditions that can
   * never co-occur on one event (e.g. two different `kind`s) simply never fires.
   */
  private matches(c: CompiledAlert, ev: LogEvent): AlertMatch | null {
    if (c.composite === 'all') {
      // Every condition must match this one event. An empty condition list can't be satisfied
      // meaningfully — treat it as no-match to avoid a firehose.
      if (c.conditions.length === 0) return null
      // 'all' means EVERY condition matched this one event, so every one of them is "the
      // condition that matched" and all their captures are in scope. First writer wins on a
      // name collision, which is source order — the same rule the whole file reads by.
      let captures: Record<string, string> | undefined
      for (const cond of c.conditions) {
        const hit = this.conditionMatches(cond, ev)
        if (!hit) return null
        captures = mergeCaptures(captures, hit.captures)
      }
      return { text: ev.raw, ...(captures ? { captures } : {}) }
    }
    // 'any' and 'single': fire on the first matching condition, and take ITS captures. A
    // later condition that would also have matched is never evaluated, so it can never
    // contribute a value the firing did not actually match on.
    for (const cond of c.conditions) {
      const hit = this.conditionMatches(cond, ev)
      if (hit) return { text: ev.raw, ...(hit.captures ? { captures: hit.captures } : {}) }
    }
    return null
  }

  /** Whether ONE primitive condition matches `ev`, and what its named groups captured. */
  private conditionMatches(cond: CompiledCondition, ev: LogEvent): ConditionHit | null {
    if (cond.event) {
      if (ev.kind !== cond.event.kind) return null
      let captures: Record<string, string> | undefined
      for (const f of cond.event.fields) {
        const hit = fieldMatches(ev, f)
        if (!hit) return null
        captures = mergeCaptures(captures, hit.captures)
      }
      return captures ? { captures } : {}
    }
    if (cond.raw) {
      // A raw condition captures from `ev.raw` — the exact line it just tested, and the only
      // text it ever sees. `cond.raw` carries no 'g' flag, so `exec` is stateless.
      const m = cond.raw.exec(ev.raw)
      if (!m) return null
      const captures = harvestCaptures(m.groups)
      return captures ? { captures } : {}
    }
    // 'app' conditions never match main-side.
    return null
  }

  snapshot(): { seq: number; state: AlertsSnap } {
    const state: AlertsSnap = {
      defs: this.defs(),
      history: this.historyObj(),
      spellLastCast: Object.fromEntries(this.spellLastCast)
    }
    // Omitted rather than null: the snapshot is JSON over IPC and an absent key is the honest
    // encoding of "no slow has ever been observed for this character".
    if (this.poisonSlowSeen) state.poisonSlowSeen = { ...this.poisonSlowSeen }
    return { seq: this.seq, state }
  }

  flushDelta(): { seq: number; delta: AlertsDelta } | null {
    // A flush is warranted by a fire, a cast-recency advance OR a slow landing — the upgrade
    // offers recompute off the second and the poison-slow offer off the third, and neither
    // may wait for an unrelated alert to fire.
    const slow = this.poisonSlowDirty ? this.poisonSlowSeen : null
    if (this.pending.length === 0 && this.castPending.size === 0 && !slow) return null
    const fired = this.pending
    this.pending = []
    const cast = [...this.castPending].map(([spell, ts]) => ({ spell, ts }))
    this.castPending = new Map()
    this.poisonSlowDirty = false
    const delta: AlertsDelta = { fired }
    if (cast.length > 0) delta.cast = cast
    if (slow) delta.poisonSlow = { ...slow }
    return { seq: this.seq, delta }
  }

  // ---- the checkpoint seam (JOS-208) ---------------------------------------------------------

  readonly foldSchema = ALERTS_FOLD_SCHEMA

  serializeFold(): AlertsFoldState {
    return {
      spellLastCast: [...this.spellLastCast],
      ...(this.poisonSlowSeen === null ? {} : { poisonSlowSeen: { ...this.poisonSlowSeen } }),
      seq: this.seq
    }
  }

  deserializeFold(state: unknown): boolean {
    if (!validate(ALERTS_FOLD_SCHEMA, state).ok) return false
    const s = state as AlertsFoldState
    // Walked forwards, so the Map's iteration order — which IS the eviction order — comes back
    // exactly as it went in.
    this.spellLastCast = new Map(s.spellLastCast)
    this.poisonSlowSeen = s.poisonSlowSeen ?? null
    this.seq = s.seq
    this.castPending = new Map()
    this.pending = []
    this.poisonSlowDirty = false
    return true
  }
}
