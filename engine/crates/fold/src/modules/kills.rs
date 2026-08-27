//! `src/main/modules/kills.ts` plus the pure core it reuses from `src/main/log/reducers.ts`
//! (`isCountedKill`, `recordKill`) and `src/shared/kills.ts` (`killTotals`).
//!
//! THE FOUR SCALARS ARE DERIVED, NEVER INCREMENTED. `tiers` is the record; `kill_totals` folds it
//! after every write. That is what keeps `bestTier` and `lastTs` from describing two different
//! kills — the misattribution the per-tier shape replaced (shared/kills.ts's header carries it).
//!
//! THE CREDIT JOIN, with `progression.ts`'s exact semantics: an experience line claims BACKWARD
//! inside `KILL_EXP_JOIN_MS`, a claim CONSUMES the line so it can never credit two kills, and
//! EVERY death line consumes — including the ones this module does not count. An unclaimed older
//! line is replaced rather than kept, because handing a stale line to a later kill would be a
//! fabricated attribution.
//!
//! THE TIER IS THE ZONE YOU WERE STANDING IN, and `zoneTier` answers with four kinds of thing
//! (JOS-166). `zone.unwrap_or("")` is a REAL ANSWER rather than a fallback: a kill folded before
//! the first `You have entered` states nothing about where it happened and is not permitted to
//! claim d0 — `zone_tier("")` is `TIER_UNKNOWN` for exactly that.
//!
//! …AND A BARE ZONE NAME IS NOT ALWAYS THE OPEN WORLD (JOS-521, owner ruling 2026-08-26). Two
//! players reported full d0 raid clears — Plane of Hate nameds, whole Plane of Sky clears — that
//! never greened the weekly ladder while their d1+ clears did. The reason is that a
//! base-difficulty RAID or personal instance prints a BARE zone line: `You have entered The Plane
//! of Sky.`, the same sentence the open world prints, so every kill in the instance keyed
//! `TIER_OPEN_WORLD` and an open-world kill fills no rung by design (no instance, no lockout).
//! The evidence slice settles that the model was simply wrong about where the player stood: a
//! creating-instance notice 30 s before the entry, nine exp-credited raid bosses after it, and a
//! later `You cannot leave this Personal instance while in combat.`
//!
//! SO THIS MODULE REMEMBERS THE NOTICE, AND THE MEMORY LIVES HERE RATHER THAN IN `zone_tier`.
//! `zone_tier` is a pure fold of a NAME with other readers and its answers must not change; what
//! the notice adds is not a new reading of the name but a second fact about the character's
//! history, which is exactly the kind of thing a fold holds. Four properties keep it honest:
//!
//!   • IT IS EVIDENCE, NOT PROXIMITY. A `zone` line is what says where you are standing; the
//!     notice only says an instance of that zone exists. The second bare re-entry in the slice
//!     arrives 46 minutes later with NO fresh notice — the instance already existed — and it
//!     still stamps d0, because the memory is what carries, not the gap.
//!   • IT OVERRIDES ONE ANSWER AND ONE ONLY. `TIER_OPEN_WORLD` becomes 0. The adjective branch
//!     (d1-d4) and the suffixed d0 already state an instance and are untouched, and
//!     `TIER_UNKNOWN` stays unknown: a notice does not tell you where you are standing, so a kill
//!     with no zone line behind it still claims nothing (world-model law 1).
//!   • IT EXPIRES. A notice older than seven days is not evidence about tonight; the check is at
//!     USE, so nothing has to sweep, and a fresh notice refreshes the entry.
//!   • IT IS CHARACTER-SCOPED. The epoch clears it exactly as it clears the KillMap.
//!
//! No `KillInfo` key changes meaning, so `KILLS_SHAPE_VERSION` stays where it is: kills land on
//! the right tier key from now on, and the full-log refold at the next launch reclassifies the
//! history that landed on the wrong one.

use crate::event::Event;
use crate::jsfn::{starts_with_you_word, zone_id_key, zone_tier, TIER_OPEN_WORLD, TIER_UNKNOWN};
use crate::jsmap::JsMap;
use crate::EqModule;
use eqlog::names::id_key;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;

/// `shared/kills.ts KILLS_SHAPE_VERSION`.
const KILLS_SHAPE_VERSION: i64 = 5;

/// `shared/kills.ts KILL_EXP_JOIN_MS` — how far back a kill line may reach for the exp line that
/// credits it. Measured at 0–1 s; 2.5 s is slack over the observed spread, not a hunt.
const KILL_EXP_JOIN_MS: i64 = 2500;

/// How long a remembered creating-instance notice keeps answering for its zone (JOS-521).
///
/// Seven days is the weekly lockout period, which is the longest span over which the answer could
/// still matter: a notice older than the reset it belongs to cannot be the reason tonight's bare
/// entry is an instance. It is a bound on a memory, not a measurement of anything the game states
/// — the game states nothing about when an instance dies — so it is deliberately generous in the
/// direction that costs least: an expired notice returns the kill to the open world, which takes
/// nothing off the week and is what the record said before this existed.
const INSTANCE_NOTICE_TTL_MS: i64 = 7 * 24 * 60 * 60 * 1000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KillTierRun {
    count: i64,
    first_ts: i64,
    last_ts: i64,
    credited: i64,
    last_credited_ts: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KillInfo {
    count: i64,
    best_tier: i64,
    first_ts: i64,
    last_ts: i64,
    credited: i64,
    display: String,
    tiers: JsMap<KillTierRun>,
}

#[derive(Default)]
pub struct KillsModule {
    kills: JsMap<KillInfo>,
    zone: Option<String>,
    seq: i64,
    /// The experience line the next kill line may claim — the timestamp is all this module needs.
    pending_exp_ts: Option<i64>,
    /// THE INSTANCE MEMORY (JOS-521) — `zoneIdKey` of a zone that has been seen to have an
    /// instance created, against the timestamp of the most recent such notice.
    ///
    /// A plain `HashMap` rather than a [`JsMap`]: nothing publishes it, so no iteration order of
    /// it is observable, and the ordered map is only ever the right choice where a `values()` walk
    /// reaches a snapshot.
    instances: HashMap<String, i64>,
    /// THE ANNOUNCE CURSOR (JOS-509) — see [`crate::announce`].
    ///
    /// FOUR ARMS MUTATE STATE NOBODY CAN READ. `zone` is the tier label the NEXT kill will be
    /// filed under, `instanceCreate` records that the zone it names has an instance, `expGain`
    /// parks a timestamp the next death may claim, and a death that is not a COUNTED kill consumes
    /// that timestamp and records nothing. Only the recorded kill and the rebirth change the
    /// KillMap, which is the whole of `snapshot()`.
    announce: crate::announce::Announce,
}

impl KillsModule {
    pub fn new() -> Self {
        Self::default()
    }

    /// The experience line this kill line claims, if any. Claiming CONSUMES it.
    fn take_exp(&mut self, ts: i64) -> bool {
        match self.pending_exp_ts.take() {
            Some(at) => ts >= at && ts - at <= KILL_EXP_JOIN_MS,
            None => false,
        }
    }

    /// Is there a live creating-instance notice for this zone at `ts`? (JOS-521.)
    ///
    /// Reading rather than consuming, which is the difference between this and [`Self::take_exp`]
    /// beside it: an experience line credits exactly one kill, while one instance holds a whole
    /// evening's clear. The window is the same SHAPE as the credit join's — at or after the
    /// evidence, within its span — so a notice can never reach a kill that happened before it.
    fn inside_a_remembered_instance(&self, zone: &str, ts: i64) -> bool {
        match self.instances.get(&zone_id_key(zone)) {
            Some(&at) => ts >= at && ts - at <= INSTANCE_NOTICE_TTL_MS,
            None => false,
        }
    }
}

/// `shared/kills.ts killTotals` — the five scalars, folded from the per-tier runs.
///
/// `bestTier` seeds at the FLOOR of the key ordering, not at 0: a record whose only runs are
/// open-world has no difficulty to report, and seeding 0 would have it claim a base-instance clear
/// it never made. Iteration order cannot move any of these (a max, a min, two sums).
fn kill_totals(tiers: &JsMap<KillTierRun>) -> (i64, i64, i64, i64, i64) {
    let mut count = 0;
    let mut best_tier = TIER_UNKNOWN;
    let mut first_ts = 0;
    let mut last_ts = 0;
    let mut credited = 0;
    for (key, run) in tiers.iter() {
        if run.count <= 0 {
            continue;
        }
        count += run.count;
        best_tier = best_tier.max(key.parse::<i64>().unwrap_or(0));
        first_ts = if first_ts != 0 {
            first_ts.min(run.first_ts)
        } else {
            run.first_ts
        };
        last_ts = last_ts.max(run.last_ts);
        credited += run.credited;
    }
    (count, best_tier, first_ts, last_ts, credited)
}

/// `main/log/reducers.ts recordKill`, in place.
fn record_kill(
    kills: &mut JsMap<KillInfo>,
    key: &str,
    display: &str,
    tier: i64,
    ts: i64,
    credited: bool,
) {
    if !kills.contains_key(key) {
        kills.insert(
            key.to_string(),
            KillInfo {
                count: 0,
                best_tier: 0,
                first_ts: 0,
                last_ts: 0,
                credited: 0,
                display: display.to_string(),
                tiers: JsMap::new(),
            },
        );
    }
    let k = kills.get_mut(key).expect("just inserted");
    let tier_key = tier.to_string();
    if !k.tiers.contains_key(&tier_key) {
        k.tiers.insert(
            tier_key.clone(),
            KillTierRun {
                count: 0,
                first_ts: ts,
                last_ts: ts,
                credited: 0,
                last_credited_ts: 0,
            },
        );
    }
    let run = k.tiers.get_mut(&tier_key).expect("just inserted");
    run.count += 1;
    run.first_ts = run.first_ts.min(ts);
    run.last_ts = run.last_ts.max(ts);
    if credited {
        run.credited += 1;
        // A max, not an assignment: a replay is chronological, but a fold must not depend on it.
        run.last_credited_ts = run.last_credited_ts.max(ts);
    }
    let (count, best_tier, first_ts, last_ts, cred) = kill_totals(&k.tiers);
    k.count = count;
    k.best_tier = best_tier;
    k.first_ts = first_ts;
    k.last_ts = last_ts;
    k.credited = cred;
}

impl EqModule for KillsModule {
    fn id(&self) -> &'static str {
        "kills"
    }

    fn reset(&mut self) {
        self.kills.clear();
        self.zone = None;
        self.seq = 0;
        self.pending_exp_ts = None;
        self.instances.clear();
        self.announce.reset();
    }

    fn on_event(&mut self, ev: &Event, _live: bool) {
        self.seq = ev.seq();
        match ev.kind() {
            "epoch" => {
                // Character rebirth (Task #49): the KillMap belongs to the dead beta character.
                // …and so do the instances it stood in (JOS-521): the notices name a player, and
                // the one they named is gone.
                self.kills.clear();
                self.pending_exp_ts = None;
                self.instances.clear();
                self.announce.changed(self.seq);
                return;
            }
            "zone" => {
                self.zone = ev.str("zone").map(str::to_string);
                return;
            }
            "instanceCreate" => {
                if let Some(zone) = ev.str("zone") {
                    // A MAX, not an assignment, for the same reason the credit stamp is one: a
                    // replay is chronological, but a fold must not depend on it. A newer notice
                    // refreshes the entry; an older one arriving late cannot un-refresh it.
                    let at = self.instances.entry(zone_id_key(zone)).or_insert(ev.ts());
                    *at = (*at).max(ev.ts());
                }
                return;
            }
            "expGain" => {
                self.pending_exp_ts = Some(ev.ts());
                return;
            }
            "death" => {}
            _ => return,
        }
        // Consumed BEFORE the counted filter, exactly as progression.ts does it: the line belongs
        // to the kill it precedes whoever landed the blow, and letting a dropped `slain by You`
        // twin leave it pending would hand your experience to the next mob that dies near you.
        let credited = self.take_exp(ev.ts());
        if !is_counted_kill(ev) {
            return;
        }
        let zone = self.zone.as_deref().unwrap_or("");
        let mut tier = zone_tier(zone).1;
        // THE NARROW OVERRIDE (JOS-521) — a bare zone name is the open world unless this character
        // has been told an instance of it exists. Only that one answer moves: d1-d4 and the
        // suffixed d0 already state an instance, and TIER_UNKNOWN is the absence of a zone line,
        // which no notice can supply.
        if tier == TIER_OPEN_WORLD && self.inside_a_remembered_instance(zone, ev.ts()) {
            tier = 0;
        }
        // Key by the canonical lowercase name so the two casings EQ emits for the same mob fold
        // into one entry; keep the raw name for display.
        let name = ev.str("name").unwrap_or_default();
        record_kill(
            &mut self.kills,
            &id_key(name),
            name,
            tier,
            ev.ts(),
            credited,
        );
        self.announce.changed(self.seq);
    }

    /// THE DIRTY BIT (JOS-487, made honest by JOS-509) — a COUNTED kill, or a rebirth. See the
    /// `announce` field and `crate::announce`.
    fn published_seq(&self) -> Option<i64> {
        Some(self.announce.cursor())
    }

    fn snapshot(&self) -> Value {
        json!({
            "seq": self.seq,
            "state": { "v": KILLS_SHAPE_VERSION, "mobs": self.kills }
        })
    }
}

/// `main/log/reducers.ts isCountedKill` — self-slain always counts; slain-by counts only when the
/// killer isn't you.
fn is_counted_kill(ev: &Event) -> bool {
    if ev.bool("bySelf") {
        return true;
    }
    match ev.str("killer") {
        // `ev.killer &&` — an EMPTY killer string is falsy in the TS and does not disqualify.
        Some(killer) if !killer.is_empty() => !starts_with_you_word(killer),
        _ => true,
    }
}
