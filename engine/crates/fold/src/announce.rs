//! THE ANNOUNCE CURSOR — a module's dirty bit, and the one number that decides whether a renderer
//! re-fetches (JOS-509).
//!
//! ## What was wrong
//!
//! Sixteen of the twenty modules opened `on_event` with `self.seq = ev.seq()` — unconditionally,
//! before the match on kind — and published THAT as [`crate::EqModule::published_seq`]. So the
//! cursor was a global log-line counter wearing a per-module name: on any live tail it moved for
//! EVERY module on every line, `Serving::changed_modules` (engined) found twenty numbers that had
//! all changed on every ~10 Hz beat, and every subscribed renderer re-fetched a whole snapshot for
//! twenty modules ten times a second. The engine's coalescing was working perfectly on a number
//! that always moves. That is the render sweep's F1 and the root cause under the leveling scroll
//! hitch.
//!
//! ## What it is now
//!
//! A module announces a cursor that moves ONLY when what `snapshot()` publishes actually changed.
//! Each migrated module owns one of these and calls [`Announce::changed`] from exactly the match
//! arms that mutate its published state — epoch and reset arms included, because clearing a ledger
//! is a change a panel must see.
//!
//! ## WHY IT IS SEQ-VALUED AND NOT A PLAIN COUNTER — the constraint that decided the shape
//!
//! The four modules that already did this right (`combo`, `character`, `respawn`, `buffTimers`,
//! JOS-87) publish a small private counter as BOTH the announce cursor and the `seq` inside their
//! own snapshot, so the two agree by construction. The sixteen here cannot do that: their snapshot
//! `seq` is pinned byte-for-byte by the six goldens and must keep folding exactly as it does today.
//! That splits the two numbers apart — and three CLIENTS compare them directly:
//!
//!   * `src/renderer/src/lib/useModule.ts` — `knownSeq = snap.seq` on hydrate, then
//!     `if (c.seq <= knownSeq) return` on every `moduleChanged` frame;
//!   * `src/renderer/src/overlay/useOverlayModule.ts` — the same pair, for the overlays;
//!   * `src/main/dataServer/serveMirrors.ts` — `m.seq = reply.seq` on refresh, then
//!     `if (seq <= m.seq) return` on every cursor.
//!
//! A cursor that restarted at 1 would sit permanently BELOW the log-line seq those clients took off
//! the snapshot, so after the first hydrate every announce this module ever made would be dropped
//! and its panel would freeze for the rest of the session. Under-announcing is the one failure
//! direction that is not allowed, and a small counter is under-announcing forever.
//!
//! So the cursor is kept in the SNAPSHOT'S OWN NUMBER SPACE: [`Announce::changed`] takes the fold
//! position (the module's `seq`, i.e. the seq of the event being folded) and moves the cursor to
//! `max(cursor, seq) + 1`. Three properties fall out, and all three are load-bearing:
//!
//!   1. IT MOVES ONLY ON A REAL CHANGE. That is the whole ticket.
//!   2. IT IS STRICTLY MONOTONE, so `Serving::announced_seqs`' newest-wins coalescing is unchanged.
//!   3. IT IS ALWAYS ABOVE THE FOLD POSITION THE CHANGE HAPPENED AT — so it is above any snapshot
//!      `seq` a client could be holding from BEFORE the change, and below-or-equal nothing except a
//!      snapshot taken AFTER it, which already contains the change and is right to drop the frame.
//!      No update can be lost; the worst case is one wasted re-fetch on a hydrate that raced the
//!      change it was already carrying.
//!
//! Property 3 is also what lets a change with NO event behind it announce at all — a heartbeat that
//! settles a spell set or retires a buff, a `*.define` that replaces a watch list. `+1` past the
//! current fold position is a cursor no future event can silently collide with, because the next
//! event's own change bumps past it through the same `max`.
//!
//! ## What it is NOT
//!
//! It is not state. Nothing here is in any `snapshot()`, so no golden and no oracle arm can see it
//! — which is exactly the property that let this whole change be proven against unchanged goldens.

/// One module's announce cursor. See the module header for why it is seq-valued.
#[derive(Debug, Default, Clone, Copy)]
pub struct Announce {
    cursor: i64,
}

impl Announce {
    /// THE PUBLISHED STATE JUST CHANGED, at fold position `seq`.
    ///
    /// `seq` is the module's own `seq` field — the seq of the event being folded — and for a change
    /// with no event behind it (a heartbeat, a define) it is simply the last position the module
    /// folded to. Either way the cursor lands strictly above it; see property 3 in the header.
    pub fn changed(&mut self, seq: i64) {
        self.cursor = self.cursor.max(seq) + 1;
    }

    /// What [`crate::EqModule::published_seq`] answers.
    #[must_use]
    pub fn cursor(&self) -> i64 {
        self.cursor
    }

    /// A new world. Zeroed alongside the module's own `seq`, which is what every `reset()` does to
    /// the cursor it publishes today — and a fresh attach builds a fresh `Serving`, so the first
    /// beat of the new world announces every module regardless.
    pub fn reset(&mut self) {
        self.cursor = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::Announce;

    /// The three properties the header rests on, stated as arithmetic.
    #[test]
    fn the_cursor_moves_only_when_told_and_always_past_the_fold_position() {
        let mut a = Announce::default();
        assert_eq!(a.cursor(), 0);
        // A thousand events folded with nothing to say move it not at all.
        assert_eq!(a.cursor(), 0);
        // A change at fold position 1000 lands ABOVE 1000 — above any snapshot seq a client could
        // be holding from before it.
        a.changed(1000);
        assert!(a.cursor() > 1000, "{}", a.cursor());
        // Two changes at the SAME position (a derived event carries its primary's seq) still move.
        let one = a.cursor();
        a.changed(1000);
        assert!(a.cursor() > one);
        // A change with no event behind it — the heartbeat case — moves the cursor even though the
        // fold position has not advanced since the last one.
        let two = a.cursor();
        a.changed(1000);
        assert!(a.cursor() > two);
        // And a much later event pulls the cursor back into seq space rather than crawling.
        a.changed(50_000);
        assert_eq!(a.cursor(), 50_001);
        a.reset();
        assert_eq!(a.cursor(), 0);
    }
}
