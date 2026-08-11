// ============================================================================
// semantics.ts — THE SEMANTICS AXIS: one number, policed by goldens (JOS-208, design revision).
// ============================================================================
//
// The encoding axis (schema.ts) is mechanized because a stored SHAPE is data and a hash can be
// derived from it. The other axis cannot be: when a fold's MEANING changes — a gap rule tightened,
// a kill newly counted, a zone line newly clearing something — the shape is untouched and every
// existing checkpoint now holds numbers this build would never have produced. Nothing in the
// source can tell that apart from a refactor.
//
// So it is a MANUAL constant. And a manual constant is a constant somebody will forget, which is
// why it does not stand alone: `tests/foldGoldens.test.mts` folds the fixture corpus and
// FINGERPRINTS every checkpointed module’s published snapshots. The committed goldens
// (`tests/goldens/foldFingerprints.json`) are the tripwire.
//
//     fold output changed, FOLD_SEMANTICS unchanged  → RED, naming the module and the fixture.
//         Fix: bump the number and re-record the goldens IN THE SAME COMMIT.
//     fold output changed, FOLD_SEMANTICS bumped     → green. This is a correct change, stated.
//     output unchanged, FOLD_SEMANTICS bumped        → allowed, but FLAGGED as overzealous, and
//         the goldens file must carry a `reason` for that version. An unnecessary bump costs the
//         whole fleet one cold start — cheap, and honest about being cheap — but an unexplained
//         one is a habit, and the habit is what makes the number meaningless.
//
// THE CORPUS IS THE HONESTY BOUNDARY, and it is stated rather than implied: a semantic change
// visible only on log shapes no fixture contains will not be caught here. That is what shadow mode
// (phase 3) is the fleet backstop for, and it is why the standing rule is WHEN IN DOUBT, BUMP —
// the cost of a bump nobody needed is one cold start, and the cost of a bump nobody made is a
// silently wrong world model.

/**
 * THE FOLD'S SEMANTIC VERSION. Bump this in the SAME COMMIT as any change to what the fold
 * COMPUTES from a given event stream.
 *
 * What counts (the fold laws now in AGENTS.md, in short): the parser's event stream, any module's
 * `onEvent`, the derived-event producers (epoch, offline-gap, buffExpired), the reducers, the
 * committed data that feeds any of them (spells.json, respawns.json, the message-overlay baseline,
 * the spell corrections), and the bus delivery order.
 *
 * What does not: anything under `src/renderer/**` or `src/preload/**`, anything that only reads a
 * snapshot, and any refactor that leaves every fixture's fingerprint unchanged — which is precisely
 * what the goldens are there to let you verify rather than assert.
 *
 *   1 — JOS-208. The first checkpointed fold.
 *   2 — JOS-208 phase 2. The observed-message overlay's `updatedAt` is now the newest LOG instant
 *       the miner has seen, not `new Date()`. It was a wall-clock read inside a published fold
 *       snapshot, and the differential harness caught it at the first split point of every fixture
 *       the moment `buffs` joined the matrix: two arms folding identical bytes disagreed on a
 *       field that describes neither of them. What the fold COMPUTES from a given event stream
 *       therefore changed, so the number moves — the shape did not, which is exactly the case this
 *       axis exists for.
 *   3 — JOS-208 integration. Not a fold change: the HARNESS canonicalized the character ref's
 *       `logPath` to `fixtures://<basename>` because the absolute path is an environment fact that
 *       differed per checkout — the phase-2 goldens were recorded in a worktree and went red on
 *       the main clone for `character` on every fixture. The fingerprints move once to their
 *       first checkout-independent values; the tripwire cannot tell a harness-input fix from a
 *       fold change, and the rule is the rule: the number moves with the goldens, in one commit.
 */
export const FOLD_SEMANTICS = 3
