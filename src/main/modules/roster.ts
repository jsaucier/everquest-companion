// roster module — WHO YOU ARE GROUPED WITH. docs/plans/group-model.md §1.
//
// An EqModule beside combo/buffs, folding the `group` events parseGroup.ts emits into one small
// membership record per name. It is registered BEFORE the combat engine subscribes to the bus
// (pipeline.ts), so within a single bus delivery the engine already sees an advanced roster for
// the same event — which is what lets a `<Name> has joined the group.` line and the very next
// damage line by that name behave correctly in one pass, in replay and live alike.
//
// THE ROSTER NEVER TOUCHES THE PARSER (design doc §0). This module reads events; it writes
// nothing back onto the bus and it cannot change how a line is parsed. What it can do is widen
// the engine's ADMISSION gate and narrow the meter's VIEW — see shared/roster.ts for the two
// sets and why `admitted` is deliberately wider than `members`.
//
// WHAT CLEARS IT, and what deliberately does not:
//
//   epoch      CLEARS EVERYTHING, including user edits — a character rebirth means the group
//              belonged to somebody else (same contract as every character-scoped module).
//   selfLeave  `You have been removed from the group.` clears the roster, the admission set and
//              any user edit written during that group. This is EQ's disband/leave line and it
//              is the one signal that says the group itself is over; a user's hand-added member
//              from a group that ended is not a fact about the next one.
//   offlineGap does NOT clear. EQ drops groups silently on camp, so the post-login roster is
//              marked STALE (rendered dimmed) until a signal lands — but a stale member still
//              passes the allowlist, because hiding a real member is the worse error and is
//              literally the bug this feature exists to fix.
//   zone       does NOT clear. A group survives zoning; the game says nothing when it doesn't.
//
// USER EDITS are the ladder's top rung and are PERSISTED per character (store.ts
// `ProgressState.rosterEdits`), time-keyed for the same reason combo corrections are: the log
// replays on every launch and rebuilds everything else, so the edit is the one piece of state
// the log can never tell us again. They are PULLED through a provider rather than pushed, so
// this module never has to know which character is active (the ComboModule precedent).
//
// ── THE SECOND RECOVERY PATH (JOS-85, report 01KZEWFNSEHJN33W1BA797F806) ────────────────────
//
// `confirmed` was the only rung that could rebuild a group whose join lines predate the log
// window, and it needs somebody to TALK. The reporter's 12,376-line session had ZERO group
// events of any kind, so his roster stayed empty and the engine's admission gate dropped
// 1,544 damage events (174,922 points) from one group-mate and 612 (84,277) from the other —
// missing under Group and, because nothing was ever RECORDED, missing under Everyone too.
//
// The rung this module adds is a CONJUNCTION of two facts the log states outright, and neither
// half is sufficient alone:
//
//   1. WHO your buffs reached — one Quick Buff burst enumerating names in a single instant
//      (buffFanOut.ts, where the 83-cast measurement lives). This proves RECIPIENTS.
//   2. THAT you are in a group — `You gain party experience!`, which the game prints only for
//      grouped experience. This proves a GROUP EXISTS, and names nobody.
//
// Measured on the owner's 900,562-line log against the join lines as ground truth: the fan-out
// alone names three other players, of whom one (Dranix) is inside a join-proven group window on
// all 11 of his appearances and two (a townside buff hand-out) are not. Requiring a party-exp
// line EARLIER IN THE SESSION removes exactly those two and keeps the member — 2 admissions, 2
// correct, 0 false positives, and the result is the same at every backward window from 2
// minutes to 6 hours, so the separation is real rather than tuned. The gate is therefore STICKY
// rather than windowed: the fact is "the log has already told me I am grouped", and what ends
// it is the same set of things that ends a group (epoch, self-leave, an offline gap).
//
// THE GATE IS BACKWARD-ONLY, on purpose. A player buffs up BEFORE the first pull, so a forward
// window would recover more members — and would also admit the one unproven name in the
// measurement. A fact in hand beats a prediction; the burst that misses the gate is simply not
// evidence yet, and the next burst (they are frequent) lands inside it.
//
// NEVER-A-MEMBER. A burst also lands on YOUR OWN PETS, and a pet in the roster would put a
// friendly on the Group meter as a person and — worse — make `engageHostile` refuse a charmed
// mob for the rest of its life, after the charm breaks and it is a hostile again. So the
// weakest rung is refused for: the tailed character (a burst names you the way the log names
// you), every mob you have CHARMED, and every summoned pet that has CLAIMED itself with the
// `… Master.'` tell. The pet refusals are RETROACTIVE for this rung only — the claim tell can
// arrive after you buffed up, and a pet is not a member no matter which line came first —
// while `joined` / `stated` / `user` are never touched by it.

import type { EqModule } from './types'
import { idKey } from '../log/parser'
import { BuffFanOut } from './buffFanOut'
import type { GroupEvent, HealEvent, LogEvent } from '../../shared/logEvents'
import type { RosterEdit } from '../../shared/types'
import {
  outranks,
  type RosterMember,
  type RosterSnap,
  type RosterSource,
  type RosterView
} from '../../shared/roster'

/** Which provenance rung each membership-bearing `change` writes. */
const CHANGE_SOURCE: Partial<Record<GroupEvent['change'], RosterSource>> = {
  join: 'joined',
  leader: 'stated',
  confirm: 'confirmed'
}

export class RosterModule implements EqModule<RosterSnap, RosterSnap> {
  readonly id = 'roster'

  /** The log-derived roster, keyed canonically. Insertion order is join order, which is the
   *  order the popover lists them in. */
  private log = new Map<string, RosterMember>()
  /** Every key admitted since the last epoch/self-leave — see RosterView.admitted for why this
   *  is wider than the roster and why a user REMOVE must never shrink it. */
  private admittedKeys = new Map<string, string>()
  /** Any group signal at all this epoch — the "no roster yet" vs "solo" distinction. */
  private seen = false
  private lastSignalTs = 0
  private seq = 0
  private dirty = false
  /** Serialized last-pushed state, so a delta only goes out when something actually moved. */
  private pushed = ''

  /** The Quick Buff burst detector — WHO one cast of yours reached (buffFanOut.ts). */
  private readonly fanOut = new BuffFanOut()
  /**
   * THE PARTY-EXPERIENCE GATE: the log has said `You gain party experience!` since the last
   * epoch / self-leave / offline gap, so a group demonstrably exists right now. Sticky rather
   * than windowed — see the header for the measurement that settled it. It gates the `buffed`
   * rung and nothing else; it never puts a name on the roster and never sets `seen`, because a
   * fact that names nobody must not flip the Group scope out of its show-everyone fallback.
   */
  private partyExp = false
  /** Canonical keys the weakest rung refuses: the tailed character, charmed mobs, claimed pets. */
  private readonly neverMember = new Set<string>()
  /** The tailed character's own key — installed by session.ts, absent until it is. */
  private selfKey = ''

  private editsProvider: (() => readonly RosterEdit[]) | null = null
  private edits: RosterEdit[] = []
  /** ts of the last epoch boundary — user edits older than it describe a dead character. */
  private epochTs = 0
  /** ts of the last `You have been removed from the group.` — edits at/older than it described
   *  a group that has since ended. */
  private leftTs = 0

  reset(): void {
    this.log.clear()
    this.admittedKeys.clear()
    this.seen = false
    this.lastSignalTs = 0
    this.seq = 0
    this.pushed = ''
    this.leftTs = 0
    this.partyExp = false
    this.fanOut.reset()
    // The never-a-member set is NOT cleared with the roster: it is knowledge about which names
    // are pets, and a pet does not stop being one because the character was reborn. `selfKey`
    // outlives it for the same reason — session.ts re-installs it on every character (re)tail.
    this.touch()
  }

  /**
   * The TAILED CHARACTER's name — installed once per character load (session.ts `resetWorldFor`,
   * beside `installCharacterName` and `combat.setPlayerName`). A Quick Buff burst names YOU the
   * way the log names you (`You healed <YourName> for …`), so without this the weakest rung
   * would put the player on their own group roster.
   */
  setSelfName(name: string | undefined): void {
    this.selfKey = name === undefined ? '' : idKey(name)
  }

  /**
   * Where persisted user edits come from — installed once at IPC registration as
   * `() => getRosterEdits(activeCharId())`. A PULL, not a push: `reset()` runs on every
   * character (re)load and the next read simply asks again for the new character's list.
   */
  setEditsProvider(provider: () => readonly RosterEdit[]): void {
    this.editsProvider = provider
    this.touch()
  }

  /** Install edits directly. TEST SEAM — production installs a provider. */
  setEdits(edits: readonly RosterEdit[]): void {
    this.editsProvider = null
    this.edits = [...edits]
    this.touch()
  }

  /** Call after writing an edit: the provider's answer changed. */
  invalidate(): void {
    this.touch()
  }

  /** Something moved: the renderer needs a delta AND the hot-path cache is stale. The ONE
   *  writer of both flags, so they can never disagree. */
  private touch(): void {
    this.dirty = true
    this.rev++
  }

  onEvent(ev: LogEvent): void {
    this.seq = ev.seq
    if (ev.kind === 'epoch') {
      // Character rebirth: this group belonged to the wiped character. Everything goes,
      // including the persisted edits — `applyEdits` drops any older than the boundary.
      this.reset()
      this.epochTs = ev.ts
      return
    }
    if (ev.kind === 'offlineGap') {
      // The world stopped being observable. Nothing SAID the group broke — EQ never does — so
      // every member is marked stale rather than removed, and stays in the allowlist.
      for (const m of this.log.values()) if (m.lastConfirmedTs <= ev.fromTs) m.stale = true
      // The party-experience gate DOES end here, and that asymmetry is deliberate: a stale
      // member is a name the log already gave us, while the gate is a licence to believe a
      // FUTURE burst. EQ drops groups silently on camp, so the licence expires with the session
      // and the next `You gain party experience!` renews it.
      this.partyExp = false
      this.fanOut.reset()
      this.touch()
      return
    }
    if (ev.kind === 'expGain') {
      // `You gain party experience!` — the game's own statement that you are in a group right
      // now. It names nobody, so it opens the gate and touches nothing else.
      if (ev.party) this.partyExp = true
      return
    }
    if (ev.kind === 'charm' || ev.kind === 'uncharm') {
      this.refusePet(ev.mob)
      return
    }
    if (ev.kind === 'petClaim') {
      this.refusePet(ev.name)
      return
    }
    if (ev.kind === 'heal') {
      this.foldHeal(ev)
      return
    }
    if (ev.kind !== 'group') return
    this.foldGroup(ev)
  }

  /**
   * A name the log has shown to be a PET — charmed, un-charmed (the same entity, one line
   * later) or self-claimed with the `… Master.'` tell. It can never hold the weakest rung, and
   * the refusal reaches BACKWARD into a roster the burst got in ahead of: the claim tell
   * routinely lands after you have finished buffing, and a pet is not a member whichever line
   * came first. A `joined` / `stated` / `user` member is left alone — that is a statement the
   * game or the user made outright, and this rule is not entitled to overrule it.
   */
  private refusePet(name: string): void {
    const key = idKey(name)
    if (this.neverMember.has(key)) return
    this.neverMember.add(key)
    const cur = this.log.get(key)
    if (cur?.source === 'buffed') {
      this.log.delete(key)
      this.admittedKeys.delete(key)
    }
    this.touch()
  }

  /**
   * One `heal` line through the Quick Buff detector. A fan-out proves the named entities all
   * received ONE cast of yours in one instant; the party-experience gate proves a group exists
   * to receive it. Both, or nothing.
   */
  private foldHeal(ev: HealEvent): void {
    const reached = this.fanOut.onHeal(ev)
    if (!reached || !this.partyExp) return
    for (const name of reached) {
      const key = idKey(name)
      if (key === this.selfKey || key === 'you' || this.neverMember.has(key)) continue
      // A burst is a membership SIGNAL in its own right, so it sets `seen` — unlike the
      // party-exp line, this one comes with names, and a roster with names in it is exactly
      // what `seen` is for.
      this.seen = true
      this.lastSignalTs = Math.max(this.lastSignalTs, ev.ts)
      this.add(key, name, 'buffed', ev.ts)
      this.touch()
    }
  }

  private foldGroup(ev: GroupEvent): void {
    this.touch()
    // An INVITE is not a membership fact — it may be (and in this log usually is) declined. It
    // still proves a group is in play, so it counts as a signal: with an invite on the board,
    // "no roster yet" is the honest chip rather than a silent Everyone.
    this.seen = true
    this.lastSignalTs = Math.max(this.lastSignalTs, ev.ts)
    if (ev.change === 'invite' || ev.change === 'selfJoin') return
    if (ev.change === 'selfLeave') {
      this.log.clear()
      this.admittedKeys.clear()
      this.leftTs = ev.ts
      // The group itself is over, so the licence to read a future burst as membership is too.
      // The next `You gain party experience!` is what says a new one exists.
      this.partyExp = false
      this.fanOut.reset()
      return
    }
    if (ev.name === undefined) return
    const key = idKey(ev.name)
    if (ev.change === 'leave') {
      this.log.delete(key)
      // NOT removed from `admittedKeys`: their recorded damage stays real and the Everyone
      // scope must keep showing it. Only a self-leave or an epoch resets admission.
      return
    }
    const source = CHANGE_SOURCE[ev.change]
    if (!source) return
    this.add(key, ev.name, source, ev.ts)
  }

  /** Add or re-assert one member. Provenance only ever moves UP the ladder. */
  private add(key: string, name: string, source: RosterSource, ts: number): void {
    this.admittedKeys.set(key, name)
    const cur = this.log.get(key)
    if (!cur) {
      this.log.set(key, { key, name, source, sinceTs: ts, lastConfirmedTs: ts, stale: false })
      return
    }
    cur.lastConfirmedTs = Math.max(cur.lastConfirmedTs, ts)
    // Any fresh signal ends staleness: the group demonstrably still exists.
    cur.stale = false
    if (outranks(source, cur.source)) cur.source = source
    // The log's own spelling wins on a re-assert — a name typed lowercase into an invite is not
    // how the game spells it in the join line (world-model law 2: display raw, key canonical).
    if (name !== key) cur.name = name
  }

  /** The persisted edits that still apply: written after the last epoch AND after the last
   *  self-leave. Everything older described a character or a group that is gone. */
  private liveEdits(): RosterEdit[] {
    if (this.editsProvider) this.edits = [...this.editsProvider()]
    return this.edits.filter((e) => e.setAt >= this.epochTs && e.setAt > this.leftTs)
  }

  /**
   * THE EFFECTIVE ROSTER = the log's roster, plus your adds, minus your removes.
   *
   * User edits are a LAYER over the log rather than a mutation of it, which is what makes them
   * stick in the way the user means: the next `<Name> has joined the group.` cannot undo a
   * remove, and the next `<Name> has left the group.` cannot undo an add. Undoing an edit is
   * the user's own job (the popover's remove/add are inverses), and that is the only thing that
   * should be able to.
   */
  private effective(): RosterMember[] {
    const out = new Map(this.log)
    for (const e of this.liveEdits()) {
      if (e.action === 'remove') out.delete(e.key)
      else if (!out.has(e.key)) {
        out.set(e.key, {
          key: e.key, name: e.name, source: 'user', sinceTs: e.setAt, lastConfirmedTs: e.setAt, stale: false
        })
      } else {
        // Already there from the log: the user's add is a stronger statement about the same
        // person, so the row keeps its real join time and gains the top provenance rung.
        const m = out.get(e.key)
        if (m) out.set(e.key, { ...m, source: 'user' })
      }
    }
    return [...out.values()]
  }

  snapshot(): { seq: number; state: RosterSnap } {
    const state = this.snap()
    this.pushed = JSON.stringify(state)
    this.dirty = false
    return { seq: this.seq, state }
  }

  flushDelta(): { seq: number; delta: RosterSnap } | null {
    if (!this.dirty) return null
    const state = this.snap()
    const json = JSON.stringify(state)
    this.dirty = false
    if (json === this.pushed) return null
    this.pushed = json
    // The whole state IS the delta. A group is at most five other players, so diffing it would
    // cost more code than it saves bytes, and the renderer's apply is then a plain replace.
    return { seq: this.seq, delta: state }
  }

  /**
   * THE HOT-PATH CACHE. `view()` is read once per damage line — 580,742 of them in the real log
   * — while the roster itself changes 58 times in that whole log. So both derived shapes are
   * built once per REVISION and handed out unchanged until something moves.
   *
   * The revision is bumped by every mutation AND by the edits provider answering differently,
   * which is the only way a user edit (made between two log lines, with no event to fold) can
   * invalidate it. `invalidate()` bumps it directly from the IPC write path.
   */
  private rev = 0
  private cache: { rev: number; snap: RosterSnap; view: RosterView } | null = null

  private derived(): { snap: RosterSnap; view: RosterView } {
    if (this.cache?.rev === this.rev) return this.cache
    const members = this.effective()
    const admitted = new Map(this.admittedKeys)
    for (const e of this.liveEdits()) if (e.action === 'add') admitted.set(e.key, e.name)
    const built = {
      rev: this.rev,
      snap: { members, seen: this.seen, lastSignalTs: this.lastSignalTs },
      view: {
        members: new Set(members.map((m) => m.key)),
        admitted: new Set(admitted.keys()),
        nameOf: (key: string): string | undefined => admitted.get(key)
      }
    }
    this.cache = built
    return built
  }

  /** The serializable roster — what the combat snapshot carries to both renderer bundles. */
  snap(): RosterSnap {
    return this.derived().snap
  }

  /**
   * The engine's live view (shared/roster.ts RosterView). `admitted` deliberately includes user
   * adds — an add is a statement that this person is with you, and the whole point of it is that
   * their damage starts being booked.
   */
  view(): RosterView {
    return this.derived().view
  }
}
