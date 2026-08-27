//! `src/main/modules/outputFiles.ts` — when the player last exported each `/outputfile` dump.
//!
//! NEWEST WINS, AND ONLY THE NEWEST IS KEPT. The log holds every export the character ever made;
//! the only one that can be a baseline is the one that wrote the file now on disk.
//!
//! EPOCH IS DELIBERATELY NOT HANDLED. A dump written by the wiped beta character is not cleared:
//! the file on disk outlives the epoch too, and this module reports when that file was written,
//! not whose it was. (It is the one module in this cluster with no `epoch` branch — which is why
//! the absence is stated here rather than left to look like an omission.)
//!
//! `flushDelta` ALWAYS RETURNS NULL over there: nothing in the renderer subscribes, main reads it
//! directly through `writtenAt()`. The trait's default `None` is that, unchanged.

use crate::event::Event;
use crate::jsfn::base_name;
use crate::jsmap::JsMap;
use crate::EqModule;
use eqlog::jsstr::js_trim;
use serde_json::{json, Value};

#[derive(Default)]
pub struct OutputFilesModule {
    written: JsMap<i64>,
    seq: i64,
    /// THE ANNOUNCE CURSOR (JOS-509) — see [`crate::announce`].
    ///
    /// THIS MODULE IS MIRRORED IN MAIN (`serveMirrors.ts MIRRORED_MODULES`), which is why the
    /// seq-valued cursor is not a style choice: that mirror stores the SNAPSHOT's seq and drops any
    /// cursor at or below it, so a counter here would have frozen the mirror on its first refresh
    /// and every synchronous reader of it would have gone permanently stale. See `crate::announce`.
    announce: crate::announce::Announce,
}

impl OutputFilesModule {
    pub fn new() -> Self {
        Self::default()
    }
}

/// `fileKey` — the last path segment, trimmed and lowercased. EQ writes dumps into the install
/// root and prints the bare name, so the join is on that segment, case-insensitively.
fn file_key(path_or_name: &str) -> String {
    js_trim(base_name(path_or_name)).to_lowercase()
}

impl EqModule for OutputFilesModule {
    fn id(&self) -> &'static str {
        "outputFiles"
    }

    fn reset(&mut self) {
        self.written.clear();
        self.seq = 0;
        self.announce.reset();
    }

    fn on_event(&mut self, ev: &Event, _live: bool) {
        self.seq = ev.seq();
        if ev.kind() != "outputFile" {
            return;
        }
        let key = file_key(ev.str("file").unwrap_or_default());
        let ts = ev.ts();
        match self.written.get(&key) {
            // A dump whose stamp is not NEWER than the one held changes nothing — the same refusal
            // the map already makes, now also the announce's.
            Some(&prev) if ts <= prev => {}
            _ => {
                self.written.insert(key, ts);
                self.announce.changed(self.seq);
            }
        }
    }

    /// THE DIRTY BIT (JOS-487, made honest by JOS-509) — a dump this module had not already
    /// recorded at that instant or later. See the `announce` field and `crate::announce`.
    fn published_seq(&self) -> Option<i64> {
        Some(self.announce.cursor())
    }

    fn snapshot(&self) -> Value {
        json!({ "seq": self.seq, "state": self.written })
    }
}
