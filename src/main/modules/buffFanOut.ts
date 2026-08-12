// THE QUICK BUFF FAN-OUT — the one action that makes EQ Legends enumerate, by name and in a
// single instant, the people your buffs reach. docs/plans/group-model.md §1; user report
// 01KZEWFNSEHJN33W1BA797F806 (JOS-85, "doesn't seem to be picking my group members sometimes").
//
// WHY THIS EXISTS. The roster is built from lines EQ prints ONCE, at join time. A group that
// formed before the app opened — or before the tailed file rolled — leaves none of them to
// replay, and the only recovery rung the model had was `<Name> tells the group, '…'`, which
// needs somebody to TALK. A quiet group in an instance never does, so the reporter's
// 12,376-line session carried ZERO group events and his two group-mates were dropped at the
// engine's admission gate: 1,544 damage events / 174,922 points for one of them, 612 / 84,277
// for the other, invisible under Group AND under Everyone (nothing was ever recorded to show).
//
// WHAT IS MEASURED, and it is a measurement about `Quick Buff` and NOT about spell target
// types. Owner's log, 900,562 lines (eqlog_Primitive, through Aug 1):
//
//   * 83 casts print two or more `You healed <X> … by <Spell>.` lines in the SAME second for
//     the SAME spell. ALL 83 fall within 15 s of a `You activate Quick Buff.` line — there is
//     not one exception. So the fan-out is not "this spell happens to be group-target": it is
//     one ability re-applying a saved buff set across everyone it reaches, at once.
//   * The wiki DB is NO HELP here and would have lied: it calls `Skin Like Nature`,
//     `Symbol of Pinzarn` and `Superior Healing` "Single Friendly (or Self)", while the
//     reporter's log shows two of them landing on three entities inside one second. The LOG is
//     the authority (the message-overlay precedent); the DB is a hint about a different server.
//   * Burst sizes: 76 casts reach 2 names, 6 reach 3, 1 reaches 4.
//
// WHAT A FAN-OUT PROVES, EXACTLY: these entities received your buff in one instant. That is a
// statement about RECIPIENTS, not about membership — a burst also lands on your own pet, and
// two of the owner's 67 bursts reached a player he was demonstrably NOT grouped with (a buff
// handed out while standing in town). Turning recipients into members therefore needs a second
// fact, and the roster module owns that half: the party-experience gate + the never-a-member
// set. This file answers ONE question and no more — "which names did one cast of yours reach
// in one instant".
//
// EXCLUDED: heal-over-time TICKS (`… healed <X> over time for …`). A HoT tick is
// cast-DETACHED by construction (the same property the proc detector's DoT gate exists for),
// so two unrelated single-target HoTs on two people can tick in the same second and look
// exactly like one cast reaching both. No such collision occurs in the owner's log — every one
// of the 83 is a direct landing — so excluding ticks costs nothing and closes the only
// realistic way this could name a stranger.
//
// This module is PURE: no Electron, no `node:`, no DOM, and it keeps at most one second of
// state.

import type { HealEvent } from '../../shared/logEvents'

/** Canonical key for one spell name — the fan-out is per CAST, and two casts of two different
 *  spells in the same second are two casts (a Quick Buff burst is several of them). */
function spellKey(spell: string): string {
  return spell.toLowerCase()
}

/**
 * The rolling one-cast bucket. Deliberately keyed on the log's SECOND rather than on a
 * tolerance window: every line of a burst carries the identical timestamp (EQ logs to the
 * second and the whole burst resolves in one game tick), so a wider window could only merge
 * casts the game kept apart.
 */
interface Bucket {
  ts: number
  spell: string
  /** Display names in arrival order, deduped by canonical key. */
  names: Map<string, string>
  /** True once the bucket has been reported — later arrivals in the same cast report only
   *  themselves, so a 4-name burst does not re-announce the first two three times. */
  announced: boolean
}

/**
 * Folds `heal` events and answers, per event, "did this line just prove a fan-out, and which
 * names does it add". Stateful across at most one second.
 */
export class BuffFanOut {
  private bucket: Bucket | null = null

  reset(): void {
    this.bucket = null
  }

  /**
   * Feed one heal event. Returns the DISPLAY NAMES this line newly proves were reached by one
   * cast of yours, or `null` when the line proves nothing yet.
   *
   * The second distinct target is what makes a cast a fan-out, so that line reports BOTH names
   * — the first one has been sitting in the bucket unproven until now. Every further distinct
   * target in the same cast reports just itself.
   */
  onHeal(ev: HealEvent): readonly string[] | null {
    if (ev.overTime === true) return null
    const spell = ev.spell
    if (spell === undefined || ev.healer === undefined) return null
    // Only YOUR OWN casts. Another player's group buff enumerates THEIR group, and `<X> healed
    // <Y>` lines are printed for everyone in earshot.
    if (ev.healer.toLowerCase() !== 'you') return null
    const key = spellKey(spell)
    let b = this.bucket
    if (b?.ts !== ev.ts || b.spell !== key) {
      b = { ts: ev.ts, spell: key, names: new Map(), announced: false }
      this.bucket = b
    }
    const nameKey = ev.target.toLowerCase()
    if (b.names.has(nameKey)) return null
    b.names.set(nameKey, ev.target)
    if (b.names.size < 2) return null
    if (b.announced) return [ev.target]
    b.announced = true
    return [...b.names.values()]
  }
}
