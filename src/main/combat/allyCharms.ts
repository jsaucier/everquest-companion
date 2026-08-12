// THE ALLY-CHARM MODEL (JOS-250) — whose pet is that, when it is not yours?
//
// ─────────────────────────────────────────────────────────────────────────────
// THE QUESTION, AND WHY THE ANSWER USED TO BE "NOBODY'S"
//
// `<mob> has been charmed.` names no caster (charmModel.ts's header has the whole argument), so
// Task #65 bound it only when it resolved one of the OWNER's own casts and dropped every other
// one on the floor. That was right, and it is still right for YOUR rows — but it also meant a
// group-mate's enchanter contributed literally nothing to the meter, which is the reddit report
// this ticket answers ("i have no idea what these enchanters in my groups are doing").
//
// The line that closes the gap has been parsed since JOS-140 and was never ingested by combat:
//
//     <Name> begins casting <charm spell>.        (otherCastBegin)
//
// MEASURED, owner's whole log, 1,608,483 lines, 2026-08-12 (re-derived through the SHIPPED roster
// and the SHIPPED arm window, not a re-implementation): 456 charm broadcasts — 441 resolve one of
// the owner's own casts, 15 resolve a NAMED third party's, 0 resolve nothing, 0 resolve both. A
// perfect split, with no heuristic in it.
//
// ─────────────────────────────────────────────────────────────────────────────
// BINDING — two paths, both of which NAME BOTH ENDS
//
//   1. CAST + BROADCAST JOIN. A charm-family cast by a PLAYER-SHAPED name arms a window of that
//      spell's own cast time plus the same slack `CharmModel` uses for your casts; a caster-less
//      broadcast landing inside exactly ONE armed window binds that mob to that caster.
//   2. LEADER SAY. `<PetName> says, 'My leader is <Player>.'` (the `allyPetLeader` event) binds
//      outright — it is the only line in the game that names both the pet and its owner, and it
//      covers a stranger's SUMMONED pet as well, which no charm broadcast can.
//
// THE CASTER GATE IS THE WHOLE DEFENCE OF PATH 1. Mobs cast charm songs at you — the log holds
// `A fire giant warrior begins singing Solon's Bewitching Bravura.` — so a rule that read the
// SHAPE of the line without the shape of the NAME would file a fire giant as a charmer.
// shared/playerShape.ts is that gate; a rostered group-mate always qualifies regardless.
//
// ─────────────────────────────────────────────────────────────────────────────
// UNBINDING — four ends, every one of them a line the log actually prints
//
//   SOFT-HOSTILE PROOF   the bound pet SWINGS AT A FRIENDLY (you, your pet, a rostered member,
//                        its own charmer, any charmer of a live ally pet, any other live ally
//                        pet). A charmed mob does not attack its charmer's side, so this is the
//                        break, at that instant. It is the investigation's own earliest-proof
//                        metric — and it is TIGHT rather than lossy precisely because a broken
//                        pet stops fighting mobs, so the blind window before it contains almost
//                        no mob-vs-mob damage to get wrong.
//   PET DEATH            the ordinary death line for the bound name.
//   RE-CHARM             a new broadcast/cast-join for the same mob — by the same charmer it
//                        RESTATES (the hold is re-based), by a different one it REBINDS.
//   HOLD EXPIRY          the charm's own listed duration plus slack. A charm cannot outlive its
//                        spell, so nothing needs to be observed for this end to be certain.
//
// A SWING COUNTS, LANDED OR NOT, and that is measured rather than generous. In the Scooba episode
// (Tue Aug 04 16:59) `A Knight of Innoruuk tries to punch Scooba, but misses!` is two seconds
// after the broadcast and its first LANDED punch is twenty-eight seconds after it. The intent is
// what proves the break; refusing the miss would have credited a stranger twenty-six seconds of a
// pet that had already turned on him.
//
// NOTHING IS RETRO-UNCREDITED. Damage booked before the proof stays booked — the pet really was
// charmed then, and reaching backwards would mean a meter that changes numbers it has already
// shown. This is the same "binds forward, not backward" rule the pet-claim tell follows (JOS-49).
//
// ─────────────────────────────────────────────────────────────────────────────
// REFUSALS — the four shapes where the honest answer is nothing at all
//
//   SAME-NAMED TWIN      while a second instance of the pet's name is acting unbound, the name's
//                        mob-vs-mob lines cannot be told apart. The canonical fixture is the rock
//                        golem episode (Thu Jul 30 18:27): the very first line after the
//                        broadcast is `A rock golem pierces a rock golem for 102 points`, and the
//                        window continues that way. Detected off the log rather than guessed —
//                        an attacker whose name equals its target's name IS the ambiguity.
//   MULTI-CASTER TIE     two different charmers armed over one broadcast with nothing to separate
//                        them. Measured exactly once in the whole log: Paladrial and Satya both
//                        casting Cajoling Whispers III at `a lava duct crawler`, Fri Jul 31
//                        21:13:14. Refuse; a coin flip credited to a named person is worse than
//                        silence.
//   BARD CHARM           `Solon's Bewitching Bravura` prints `Someone 's eyes glaze over.`, not
//                        the charm broadcast, so it can never be the cast a broadcast resolved
//                        (charmModel.isCharmBroadcastSpell). JOS-200's standing cost; not
//                        relitigated.
//   NON-PLAYER CASTER    the caster gate above.
//
// ─────────────────────────────────────────────────────────────────────────────
// PURE + CLOCK-INJECTED, exactly like `CharmModel`: no Date.now(), no engine state, no I/O. Every
// method takes the log timestamp it is reasoning at, so a replay and a live tail behave
// identically (tests/foldDeterminism.test.mts's property).

import {
  DEFAULT_CHARM_DURATION_MS,
  DURATION_SLACK_MS,
  armWindowMs,
  isCharmBroadcastSpell,
  provisionalWindowMs
} from './charmModel'
import { isPlayerShapedName } from '../../shared/playerShape'
import { spellCanonKey } from '../log/parseCommon'

/** One live third-party charm bind. */
export interface AllyBind {
  /** Canonical key of the bound pet. */
  nameKey: string
  /** The pet's display name as the CHARM BROADCAST spelled it (lowercase article, world-model
   *  law 2) — never the sentence-cased spelling a damage line happens to carry. */
  display: string
  charmerKey: string
  charmer: string
  boundTs: number
  /** The charm's own listed duration + slack, past which the bind is over whatever else is true. */
  holdUntil: number
  /**
   * A second instance of this NAME has acted unbound, so the name's mob-vs-mob lines are
   * unattributable. Sticky for the life of the bind: the twin does not announce its departure
   * either, so "it got better" is not a thing this log can say.
   */
  ambiguous: boolean
  /** Which line bound it — the debug line reads it, and the test asserts on it. */
  via: 'cast' | 'leader'
}

/** What a caster-less `<mob> has been charmed.` broadcast means for a THIRD PARTY. */
export type AllyVerdict =
  /** Bound (or re-bound / restated) to a named charmer. */
  | { kind: 'bind'; bind: AllyBind }
  /** Evidence exists but is unusable, and the reason is worth printing. */
  | { kind: 'refuse'; reason: string }
  /** No third-party cast is armed at all — this model has nothing to say about the line. */
  | { kind: 'none' }

/** A bind whose hold has run out, for the caller's processing line. */
export interface AllyExpiry {
  nameKey: string
  display: string
  charmer: string
}

/** One `<Name> begins casting <Spell>.` line, as the ally model asks about it. An args object
 *  rather than five positionals: the caller has already canonicalized the name and already asked
 *  the engine's behavioural guards, and neither answer should be positional. */
export interface AllyCastLine {
  /** The caster's raw display name, exactly as the line spelled it (world-model law 2). */
  caster: string
  /** Canonical key for the same name. */
  casterKey: string
  spell: string
  ts: number
  /** `EngineState.allyCasterAllowed` — the behavioural half of the caster gate. */
  allowed: boolean
}

/** One `<PetName> says, 'My leader is <Player>.'` line about somebody else. */
export interface AllyLeaderLine {
  petKey: string
  /** The pet's display name, as the say spelled it. */
  pet: string
  owner: string
  ownerKey: string
  ts: number
}

interface AllyArm {
  charmerKey: string
  charmer: string
  spellKey: string
  ts: number
  until: number
}

export class AllyCharms {
  /**
   * Third-party charm casts in flight, newest last. A MAP KEYED BY CASTER, not the single slot
   * `CharmModel` uses: you cast one spell at a time, but a zone can hold three enchanters, and
   * collapsing them would silently make every one of their broadcasts look like the last caster's.
   */
  private arms = new Map<string, AllyArm>()
  /** nameKey → the live bind. */
  private binds = new Map<string, AllyBind>()
  /**
   * Player-shaped names seen CASTING (`<Name> begins casting …`, any spell) plus every charmer
   * this model has bound for. THE FRIENDLY SET FOR SOFT-HOSTILE PROOF AND NOTHING ELSE — it is
   * never consulted for attribution, never merged into `EngineState.knownPlayers`, and cannot
   * move a point of YOUR damage (see state.ts notePlayer for why that separation is not optional).
   *
   * Why casting at all: it is the one third-person line in this log whose subject is doing
   * something a player does deliberately, and shared/playerShape.ts refuses the article-named
   * mobs that also cast. Its job is to stop a stranger's DPS being inflated with the damage their
   * ex-pet is doing TO THEIR OWN GROUP — measured all over this corpus (Bodegas, Wemby, Sind,
   * Selmak, Gordon, Phatez are each beaten on by a charm pet that had just broken).
   */
  private friendlies = new Set<string>()

  reset(): void {
    this.arms.clear()
    this.binds.clear()
    this.friendlies.clear()
  }

  /**
   * `<Name> begins casting <Spell>.` — remember a player-shaped caster, and arm the join when the
   * spell is one that could have printed the charm broadcast.
   *
   * `admitted` is the caller's answer to "is this a rostered group-mate" (they always qualify as a
   * caster, whatever their name looks like); `allowed` is the caller's behavioural refusal — a
   * name you have landed damage on, or that has ever been charmed, or that is or was your pet, is
   * a MOB and can never be a charmer (state.ts's three absolute guards, borrowed rather than
   * re-derived).
   */
  noteCast(c: AllyCastLine): void {
    if (!c.allowed) return
    if (!isPlayerShapedName(c.caster)) return
    this.friendlies.add(c.casterKey)
    if (!isCharmBroadcastSpell(c.spell)) return
    this.arms.set(c.casterKey, {
      charmerKey: c.casterKey,
      charmer: c.caster,
      spellKey: spellCanonKey(c.spell),
      ts: c.ts,
      until: c.ts + armWindowMs(c.spell)
    })
  }

  /** A rostered group-mate is a friendly whatever their name looks like. */
  noteFriendly(nameKey: string): void {
    this.friendlies.add(nameKey)
  }

  /**
   * `<mob> has been charmed.` that the OWNER's model already declined. Returns what the third-party
   * evidence says. Consumes the winning arm, for `charmBroadcast`'s reason: every charm spell in
   * the DB is single-target, so one cast explains exactly one broadcast.
   */
  broadcast(nameKey: string, display: string, ts: number): AllyVerdict {
    this.pruneArms(ts)
    const live = [...this.arms.values()].filter((a) => ts >= a.ts && ts <= a.until)
    if (live.length === 0) return { kind: 'none' }
    const casters = new Set(live.map((a) => a.charmerKey))
    if (casters.size > 1) {
      // Consume them all: a tie says none of these casts is explained by anything else either, and
      // leaving them armed would hand the NEXT broadcast to a cast that has already been spent.
      for (const a of live) this.arms.delete(a.charmerKey)
      this.binds.delete(nameKey)
      return { kind: 'refuse', reason: `${casters.size} casters armed - cannot tell whose charm this is` }
    }
    const arm = live[live.length - 1]
    this.arms.delete(arm.charmerKey)
    const prev = this.binds.get(nameKey)
    const bind: AllyBind = {
      nameKey,
      display,
      charmerKey: arm.charmerKey,
      charmer: arm.charmer,
      boundTs: prev?.charmerKey === arm.charmerKey ? prev.boundTs : ts,
      holdUntil: ts + provisionalWindowMs(arm.spellKey),
      // A RE-CHARM BY THE SAME CHARMER DOES NOT CLEAR AMBIGUITY. The twin that made the name
      // unreadable is still standing there; only its own death or a zone line ends it, and neither
      // prints anything this model could read as "you may resume".
      ambiguous: prev?.charmerKey === arm.charmerKey ? prev.ambiguous : false,
      via: 'cast'
    }
    this.binds.set(nameKey, bind)
    this.friendlies.add(arm.charmerKey)
    return { kind: 'bind', bind }
  }

  /**
   * `<PetName> says, 'My leader is <Player>.'` — the strongest ally bind there is, and the only
   * one that reaches a stranger's SUMMONED pet. It carries no spell, so the hold is the default
   * charm duration; a summoned pet has no charm clock at all, which is why the ceiling here is a
   * bound rather than a measurement (the 16-minute figure every charm but two is listed at, plus
   * the same slack the owner's own provisional binds get).
   */
  bindByLeader(l: AllyLeaderLine): AllyBind {
    const prev = this.binds.get(l.petKey)
    const same = prev?.charmerKey === l.ownerKey
    const bind: AllyBind = {
      nameKey: l.petKey,
      display: l.pet,
      charmerKey: l.ownerKey,
      charmer: l.owner,
      boundTs: same && prev ? prev.boundTs : l.ts,
      holdUntil: l.ts + DEFAULT_CHARM_DURATION_MS + DURATION_SLACK_MS,
      ambiguous: same && prev ? prev.ambiguous : false,
      via: 'leader'
    }
    this.binds.set(l.petKey, bind)
    this.friendlies.add(l.ownerKey)
    return bind
  }

  /** The live bind for a name, or undefined. */
  bindOf(nameKey: string): AllyBind | undefined {
    return this.binds.get(nameKey)
  }

  /** The bind a line may be CREDITED to: live and unambiguous. */
  creditable(nameKey: string): AllyBind | undefined {
    const b = this.binds.get(nameKey)
    return b && !b.ambiguous ? b : undefined
  }

  /** True when `nameKey` is on the friendly side of an ally charm — a caster we have seen, or a
   *  charmer we have bound for. Never an attribution test; see `friendlies`. */
  isFriendly(nameKey: string): boolean {
    return this.friendlies.has(nameKey)
  }

  /** True while any bind is live (lets the caller skip the per-line work entirely). */
  get idle(): boolean {
    return this.binds.size === 0
  }

  /** THE TWIN REFUSAL. Sticky — see `AllyBind.ambiguous`. */
  markAmbiguous(nameKey: string): boolean {
    const b = this.binds.get(nameKey)
    if (!b || b.ambiguous) return false
    b.ambiguous = true
    return true
  }

  /** Drop a bind (soft-hostile proof, death, your own charm taking the same mob, a pet claim). */
  release(nameKey: string): AllyBind | undefined {
    const b = this.binds.get(nameKey)
    if (b) this.binds.delete(nameKey)
    return b
  }

  /** Charm cannot survive a zone, and neither can an arm or a sighting. The friendly set is kept:
   *  it is about PEOPLE, and a person does not stop being one because you walked through a door. */
  zone(): void {
    this.arms.clear()
    this.binds.clear()
  }

  /** Binds whose hold has run out as of `now`. Removing them is this call's side effect. */
  sweep(now: number): AllyExpiry[] {
    const out: AllyExpiry[] = []
    for (const [nameKey, b] of this.binds) {
      if (b.holdUntil > now) continue
      out.push({ nameKey, display: b.display, charmer: b.charmer })
    }
    for (const e of out) this.binds.delete(e.nameKey)
    return out
  }

  /** Display names of the live ally pets, newest last — for the debug surface and the tests. */
  boundNames(): string[] {
    return [...this.binds.values()].map((b) => b.display)
  }

  private pruneArms(now: number): void {
    for (const [k, a] of this.arms) if (a.until < now) this.arms.delete(k)
  }
}
