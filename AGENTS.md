# AGENTS.md — EQ Legends Companion

Distilled operating manual. Per-task history lives in `git log` and Linear;
this file holds only repeatable rules and load-bearing design. Long-form war
stories were MOVED verbatim to `docs/agents-archive.md` (JOS-252) — a cut
that proves load-bearing is reversible in one paste — and
`tests/agentsDoc.test.mts` enforces a 20k-word ceiling here. Distillation
protocol: done carefully by the integrator, never delegated to a worker,
never mechanical truncation, archive before cutting.

## What this is

Electron (electron-vite) + TS + React + MUI desktop app that tails the
**EverQuest Legends** log in real time. Surfaces: an Overview landing tab
(default view — DPS w/ inline drill, live curve, current mob, zone, leveling
rate + next-level ETA, class loadout, recent drops/kills), Plane of Sky quest
tracking, loot, inventory reconcile, leveling/AA analytics, a Maps tab
(Brewall/default rendering, POI search, label declutter, floor slicing,
typed-/loc marker), class-combo inference with user corrections, proc
analytics (PPM + state attribution), raid targets, buffs simulation, alerts
with sounds + rank-upgrade intelligence, a Details-style DPS meter with
drill-down/timeline (drilled by default, pet nested), floating overlay
meters, an EXALTATIONS tab (the Exaltation/BiS planner — labelled Exaltations
since JOS-42; the `planner` view id, route, store keys and `planner-*`
testids are unchanged — docs/plans/exaltation-planner.md), celebration toasts
(docs/plans/celebration-toasts.md), and a TIMERS tab + overlay (JOS-194 —
law 13 below). Committed knowledge DBs: mobs (7.9k), items (11.2k incl.
dropsfrom + eraTag), spells (1.9k), classes, zones (era-annotated), wiki
respawn floors (507 rows, 394 readable). First stable release v0.2.0
(2026-08-03); per-release history lives in `shared/releaseNotes.ts` and the
archive. Layout: `src/main` (Node), `src/preload`, `src/renderer`,
`src/shared`, `tests/`, `scripts/`.

- Repo: `C:\Users\jmoye\everquest-companion` (public: github.com/jmoyers/everquest-companion).
- Game log: `C:\Users\Public\Daybreak Game Company\Installed Games\EverQuest
  Legends\Logs\eqlog_<Char>_<server>.txt` — but the path is auto-discovered +
  Settings-overridable now; NEVER hardcode, route through
  `config.ts effectiveEqRoot()/eqLogsDir()`.
- Active dev character: `Primitive@freeport`. The log is LIVE and growing.

## Operating model (how work happens here — this works, keep it)

- **Roles: Fable plans, Opus does — and that includes SUBAGENT dispatch
  (user rule, 2026-08-03).** The main session (Fable) is the integrator /
  designer / thinker: it diagnoses, designs, writes precise briefs,
  dispatches parallel Opus executor agents with DISJOINT file ownership,
  reviews their reports, runs the verification gauntlet, and commits per
  wave. Design/planning work is Fable's own job, never delegated to Opus
  planning agents; Opus subagents get concrete implementation briefs only
  (read-only research subagents are fine). Executors do the work and report
  honestly — including when the brief is WRONG: an executor overturning the
  integrator's assumption with evidence is a feature, not insubordination
  (it has corrected real briefing errors — docs/agents-archive.md).
- **Work ships in WAVES.** 1–5 agents in parallel, then integrate → verify
  (typecheck + lint + full unit suite + e2e when main/renderer changed) →
  commit with a detailed message. Big projects (the lint campaign) are
  partitioned into disjoint waves with per-wave regression gates and run
  until done. The user gets a short "In flight / Settled" readout whenever
  a turn ends with agents still running.
- **THE BOARD IS IN LINEAR, AND THE OWNER STEERS IT (owner, 2026-08-05).**
  Canonical project management is the kanban in the owner's PERSONAL Linear
  workspace (Josh's Maker Space, team JOS — never the work workspace).
  `scripts/linear.mts` is the CLI (auth: `.triage/linear.env`, gitignored).
  The full loop is the `linear-board` skill (.claude/skills/linear-board) —
  the short form: SYNC fresh before every pick (the owner reorders,
  reprioritizes and cancels between reads; a Canceled ticket is a STOP order
  even mid-flight), the ticket IS the brief (`linear.mts show JOS-N`; bodies
  are self-contained build briefs), states are Todo → In Progress → Done
  only (no Backlog), tickets are END-TO-END improvements titled
  `Module / What the user gets`, and In Progress/Done moves carry
  wave-and-commit comments. Only owner-accepted work becomes a ticket.
- **BRANCH INTEGRATION RULES (owner, 2026-08-05 — one merge behavior, not a
  juggle).** Every worker commits on its OWN worktree branch, never on main.
  Before reporting done, the worker makes the branch MERGE-READY: full checks
  green at its tip (typecheck + lint + full unit suite + the e2e specs it
  touched), no stray diagnostics/junctions/tsbuildinfo noise in the tree, and
  — if main has moved under it — rebased onto current main (or explicitly
  reports the conflict it cannot resolve). The integrator then ALWAYS
  integrates by MERGING the worker branch (`git merge --no-ff`), one branch
  at a time, re-verifying on merged main before push, then deletes branch +
  worktree. Cherry-picking is reserved for salvage (a dead agent's WIP), not
  routine integration. Conflicts the merge surfaces are resolved by the
  integrator when small, bounced back to the worker when semantic. The
  destination is a PR model (workers push branches, review happens on the
  PR); these rules are that model minus the forge.
- **Planner/integrator diagnoses against the REAL log first** (grep/sed, or a
  throwaway `scripts/_*.mts` replay via `npx tsx` — delete after). Executors
  get verified findings, not hypotheses. Never write to the game log.
- **Golden-window tests are the law** (`npm test`, node:test + tsx). Any
  "world model looks wrong" report becomes a fixture FIRST: extract the real
  log span (`tests/fixtures/*.log` via `tests/extract-*.mjs`), hand-read it,
  write the expected state, fix until green. Priming fixtures warm learned
  state (classifier/overlay) the way a full replay would.
- **FLAKES ARE TRACKED AND FIXED, regardless of who wrote the test** (owner
  rule, 2026-08-11). A test that fails under load/live conditions and passes
  on re-run is not noise to shrug at — it is either a fragile spec or a real
  race, and both are work. The ledger lives HERE; every observed flake gets a
  row (spec · signature · occurrences · disposition), integrators append on
  sighting, and a flake at 3+ occurrences must have a fix ticket or chip —
  "green on re-run" is a report line, never a resolution. Known rows:
  - `sky-filters.e2e` · expanded-quest step vs live-log viewKey remount ·
    6 sightings (2026-08-10/11 x3, 2026-08-12 six-spec sweep during JOS-253,
    2026-08-12 six-spec sky sweep during JOS-268, 2026-08-13 v0.26.0 release
    sweep — green standalone immediately after, every time;
    multi-spec-sweep only) · documented in-file
    by the JOS-206 worker;
    needs the same order-hardening the spec's own comment describes; fix
    dispatched in JOS-279 (2026-08-13 wave).
  - `combat-dashboard.e2e` · narrow-window resize never lands, settleStable
    settles on stale geometry · 5 sightings (2026-08-10/11/12 full-sweep; 4th
    in the JOS-229 sweep; 5th 2026-08-12 STANDALONE on the JOS-240 merge
    verification — the full-sweep-only pattern is broken, green on immediate
    rerun) · fix shape diagnosed (wait for bounds to differ before settling);
    ticket JOS-232 filed — now firing standalone, priority raised.
  - `window-bounds.e2e` · close-time bounds write never lands under sweep
    load ("closing the window writes down where it was left — (none)",
    cascades into both relaunch-bounds checks) · 1 sighting (2026-08-12,
    40-spec sweep during JOS-260 verification; green standalone immediately
    after and in the following full sweep) · load-sensitive
    persistence-on-close, unrelated to the change under test; report line.
  - `presenceWorker.test` first-tick dedup · watches the REAL machine; fails
    while EverQuest runs with a player at the keyboard · 3 sightings
    (2026-08-10 ×2, 2026-08-12 JOS-239 worker mid-session, green on final
    run) · needs hermetics without weakening the once-then-heartbeat pin;
    chip filed — satisfies the 3+ rule via the chip.
  - `perf.e2e` heartbeat boundary · "a replay shorter than one heartbeat states
    NO drift figures" fails when the replay lands JUST under the beat and a tick
    still gets counted (118 vs 125 ms twice, 123 vs 125 once) · 5 sightings
    (2026-08-11 phase-4 worker, 2026-08-12 JOS-230 worker, 2026-08-12 JOS-238
    worker, 2026-08-12 v0.23.0 release sweep at 115 vs 125 ms, 2026-08-13
    v0.25.0 release sweep — full-sweep only, green standalone every time; the
    prior row said 3 while listing four events, count corrected) · diagnosis sharpened by the
    JOS-229 worker: the sub-beat replay precondition holds on essentially every
    run of this machine, so the failure is the always-on stutter probe recording
    a tick inside the window — a tick-phase coin flip, not load · chip filed
    (fix the phase race or gate the assertion on probe phase), per this rule.
- **Fixtures are COMMITTED and SCRUBBED.** `tests/fixtures/*.log` is tracked
  (a `!tests/fixtures/*.log` negation under the blanket `*.log`), so CI's
  `npm test` runs the FULL suite. The repo is PUBLIC, so every extractor
  MUST route through the shared scrub `tests/fixture-scrub.mjs`
  (`scrubKeep`) — never re-implement a drop list, never hand-copy a raw log
  span into `fixtures/`. Scrub = DROP the line; NEVER rewrite it with a
  placeholder (a rewritten line still parses into a fake event and would
  pollute the golden expectation). It drops third-party chat/social: all
  quoted speech (mob speech included — nothing parses it), `/who` output,
  group join/leave/invite/leader lines, and social emotes. It KEEPS combat,
  casts, buff landings/wear-offs, loot, turn-ins, zone lines, level-ups, AA,
  charm/pet lines and system messages.
  **CARVE-OUT: the pet-claim tell** `<Name> told you, '… Master.'` IS a tell
  but is spoken by an NPC pet and is the strongest binding signal for a
  summoned pet (law below), so it is kept verbatim — dropping it silently
  unbinds every pet in every combat fixture.
  **CARVE-OUT: the six pet-voiced SAYS** (JOS-47) — the six exact sentences
  in `shared/logScrub.ts PET_SAY_LINES`, matched as EXACT SENTENCES, never as
  a `/Master/` pattern (the enumerating sweep found six kinds of mob flavor a
  loose pattern would leak). Same argument as the tell: an NPC's words under
  an NPC's name. They prove the speaker is somebody's pet — NOT that it is
  YOURS (JOS-49 deleted the offer that paired them with a shared target). The
  carve-out STAYS: every combat fixture is already cut through it and the six
  still parse into `petSay`. Full argument: docs/agents-archive.md.
  **CARVE-OUT: the `/pet who leader` answer** (JOS-52) — `<Name> says, 'My
  leader is <anyone>.'`, EXACT shape, never a `/leader/` pattern. It was
  SELF-GATED until **JOS-270** (owner ruling 2026-08-13): it is the first
  pet-voiced line carrying a PLAYER's name inside the quote, so it borrowed
  the self-`/who` row's argument. THE GATE IS GONE — the line is kept whatever
  name it carries, on the 2026-08-05 group-membership reasoning (a structural
  fact about the fight, and both names already appear uncensored in every
  combat line of the same slice). The gate's measured cost was that the LIVE
  app binds a group-mate's pet off this line while no feedback slice could
  ever CONTAIN one, which made report 01KZVYMCAD72XFC36D73D8J2E8
  structurally un-triageable. NO COMMITTED FIXTURE MOVED (one occurrence in
  1.4M lines, in `extract-pet-claim`'s p2 window, and it names Primitive).
  The user's OWN `/who` row (Primitive) is likewise exempt — it is the only
  line stating the class loadout. Bystanders' NAMES survive in mechanical
  lines (kill credit, fizzle/interrupt, third-person buff-landing emotes):
  load-bearing, and they carry no one's words. Full argument:
  docs/agents-archive.md.
  **A REPORTER'S SLICE NEVER BECOMES A FIXTURE** (.gitignore `.triage/`: those
  slices are a user's own game log and never enter git). When a defect exists
  only in someone else's log, the window stays the OWNER's real bytes and the
  ONE sentence his log lacks is INJECTED as a parsed event in the test —
  quoted verbatim from the slice, cited by report id, with the mob's name
  swapped. petClaimWindows (the `… Master.'` tell) set the precedent;
  mobLifetapPlayer (JOS-48) is the case that needed it. Never hand-author a
  shape no real log has printed, and say in the header which line is injected.
- **Headless app test** (`npm run test:e2e`, playwright-core `_electron`):
  drives the REAL app end-to-end and asserts what the user SEES — use it for
  anything a fixture replay can't see (layout, mount/empty states,
  hydration). `EQ_E2E=1` (src/main/e2e.ts) is the whole test mode: no window
  ever shown, the single-instance lock skipped, userData in a temp dir before
  electron-store loads — invisible while the user plays. Builds into
  `out-e2e/` (ABSOLUTE `--outDir`; a relative one buries the renderer) so it
  never races the dev watcher; DOM + screenshot land in
  `tests/e2e/artifacts/` on failure.
- **THE E2E INPUT IS A COMMITTED FIXTURE, AND THE HARNESS PLAYS THE LIVE HALF**
  (JOS-29, wave E2 — docs/plans/e2e-parallel.md). `tests/e2e/logFixture.mts`
  stages a throwaway EQ install per launch and hands it over with
  `EQ_INSTALL_DIR` — the product knows nothing about it. Cut fixtures with
  `npm run fixtures:e2e` (through the shared scrub, like every extractor).
  Because the harness OWNS the copy it can PLAY: `appendAt()` writes
  EQ-stamped lines into the tailed file and they travel the real path
  (chokidar → Tailer → parser → engine → IPC → render);
  `tests/e2e/gameplay.mts` scripts a pull whose damage this repo STATES, so
  assertions are EXACT (`outTotal === 442`). Map PACKS stay a game install
  (junctioned in). Frozen numbers still rot for anything the fixture does not
  fix.
- **WAIT FOR THE CONDITION, NEVER FOR THE CLOCK** (wave E3).
  `tests/e2e/settle.mts` is the vocabulary: `settle(read, ok)`,
  `settleCount`, `settleGone`, and `settleStable` — which is how an ABSENCE
  is asserted. Two raw sleeps survive in the whole suite and both are
  instruments rather than bets. Two measured traps: `requestAnimationFrame`
  can be throttled to nothing in a never-composited window (`nextFrames`
  races a timer), and `hoverAt` must clip against every CLIPPING ANCESTOR
  and verify with `elementFromPoint` — that was the leveling red, for weeks.
- **Frozen numbers rot**: the live log grows, so full-log assertions must be
  identities (`earned == allocated + unspent`), monotonic floors, or
  anchor-independent invariants — never `== <today's count>`.
  **AND A RATIO ROTS TOO, IF ITS DENOMINATOR IS THE OWNER'S PLAY** (JOS-234):
  the kill/exp join's `joined / credited kills > 0.9` went deterministically
  red when the character hit the level cap — a grey kill prints no experience
  line to join. Before freezing a rate, ask which side the code controls and
  CONDITION the denominator on the code's own precondition; then say it again
  over the most RECENT slice, or old rows dilute a fresh regression.
  tests/progressionKillJoin.test.mts carries the worked example; full story:
  docs/agents-archive.md.
- **Regression gates**: model refactors prove untouched dimensions
  byte-identical (taxonomy added categories; total damage stayed exact).
  Run baseline before changing, diff after.
- **Concurrent agents**: disjoint file ownership; re-read shared files
  (index.ts, ipc.ts, types.ts, preload, App.tsx) immediately before each
  surgical edit. errors.log noise from mid-edit HMR is normal — judge by
  final typecheck/tests and check timestamps before blaming current code.
- **PATH-SCOPED COMMITS (integrator law, learned the hard way 2026-08-03).**
  While waves overlap, the integrator stages EXPLICIT file lists from the
  finished agent's report — never `git add <dir>` and never
  `git add tests/fixtures` (broad adds swept in-flight files three times in
  one day). After any commit touching shared hot files, sanity-check that
  HEAD is self-consistent; a follow-up commit says "completes <sha>" when it
  repairs one of these.
- **Mid-flight course changes go BY MESSAGE to the owning agent** — never by
  dispatching a second agent into owned files, and never by the integrator
  editing them. An agent that stops "to wait" for its own e2e run is
  STOPPED — a message resumes it; don't ping-pong twice, finish its
  integration yourself from `git status` + its interim report. Stories:
  docs/agents-archive.md.
- **Wave choreography, distilled 2026-08-05 (25-wave session):**
  - A file carrying TWO waves' hunks lands with the LATER wave's commit +
    a "completes <sha>" note (App.tsx with toasts+deep-links;
    windowControls with fightSelection+levelUp). Never `git add -p` a
    shared hot file into halves.
  - `git status --porcelain | grep '^[MADR] '` BEFORE every commit — the
    index is shared and a sibling's staged deletion WILL ride your commit
    (6db8790 swept one; its wave's later commit completed it).
  - **e2e runs PARALLEL and from a worktree** (wave E1,
    docs/plans/e2e-parallel.md). The isolation unit is ONE LAUNCH — a
    `mkdtempSync` userData dir per `launchApp()`, artifacts under
    `artifacts/<runId>/<spec>/` — so the old single-flight law is retired.
    The runner discovers `*.e2e.mts`, takes a name filter
    (`npm run test:e2e -- leveling`), caps each spec at 5 min, writes
    `artifacts/<runId>/summary.json`; `--serial` remains for debugging.
    `node_modules` is resolved, not joined, so a worktree with no install
    runs the suite. Measured runs (13/13 twice at ~150 s; serial was
    ~28 min) + the `hoverAt` fix: docs/agents-archive.md.
  - **The awaiting-sample law generalizes**: no file format, log
    annotation, or era claim ships from imagination — outputs kinds refuse
    typed until a real fixture graduates them; Double Bow Shot waits for a
    bow log; era waited for zones. "Structurally covered" ≠ verified —
    say which.
- **Feedback triage loop** (proven 2026-08-05, three same-day turnarounds):
  report → integrator diagnoses against the REAL log/slice FIRST (the brief's
  diagnosis was WRONG twice; the executor's evidence overruled it; a slice
  may prove more than the prose) → wave → stamp `triaged` with an honest note
  via `triage-feedback set`. Stories: docs/agents-archive.md.
- **Product lens (owner, 2026-08-05): deepen existing surfaces by
  default; net-new surface area gets the suspicion test — fits the
  real-time companion vision? achievable live from the log? or
  performative? (Faction tracking parked by exactly this test; the
  outputs ENGINE shipped surface-free instead.)
- **During parallel waves, red is ambient; final reports are the truth.**
  Executors report other agents' failures SEPARATELY from their own. eslint's
  cache lies after cross-agent deletes (errors past a file's length mean
  `rm -rf node_modules/.cache/eslint`, not code); a throwaway
  `scripts/_*.mts` left behind breaks `typecheck:node` for everyone — delete
  before reporting.
- **Plans go stale while agents fly.** Line ranges, counts and tables in a
  design doc describe planning time — executors re-derive them fresh and
  treat every measured claim as re-checkable (~20 briefing errors overturned
  by executor measurement, zero wrongly). Reward the overturn, then encode
  what it taught.
- **KEEP THE TREE BUILDABLE (user rule, 2026-08-03): the dev app must not
  stay down.** Transient seconds-long HMR breakage is fine; MINUTES is not.
  Concretely: create any file you import (even an empty stub) BEFORE writing
  the import — a scrape/codegen that produces a data file the code needs gets
  a stub first and overwrites it when done (this exact miss took the app down
  for the length of a mob-page crawl); sequence multi-file changes so
  `npm run dev` keeps compiling between edits; if you must break main's build,
  fix it in your very next edit, not at wave end.
- Commits: integrator commits per wave, detailed messages,
  `Co-Authored-By: Claude`. Keep `npm run dev` (watch) running — main edits
  auto-relaunch, renderer edits HMR.

- A native .node binding resolves its DLL imports from ITS OWN directory before
  System32 (measured via process.report sharedObjects, JOS-274) - app-local CRT
  placement goes beside the binding, never on PATH (PATH loses to System32 and
  mixes runtime generations).

## Toolchain gotchas

- Node/git/gh NOT on PATH in fresh shells: prepend `C:\Program Files\nodejs`,
  `C:\Program Files\git\bin`, `C:\Program Files\GitHub CLI`.
- NO RAW CONTROL BYTES IN SOURCE FILES — spell escapes out (`\u0000`, not a
  literal NUL). A NUL as a "collision-proof key separator" is a fine idea and
  has now been written as a raw byte twice (JOS-133, JOS-150); git classifies
  the file as binary, diffs/blame/grep go dark, and the integrator has to
  respell it. Same runtime value either way, so there is no reason to ever
  emit the byte.
- Backticked EQ names (`Innoruuk\`s Chosen`) break inline `node -e` — use
  temp script files.
- Errors harness: main+renderer errors append to `<userData>/errors.log` AND
  dev stdout, grep `[everquest-companion:error]` (source tags:
  `main:uncaughtException`, `renderer:ErrorBoundary`, …). `<userData>` is
  PER CHANNEL (below) — a dev-app error is in
  `%APPDATA%\everquest-companion-dev\errors.log`, the installed app's in
  `%APPDATA%\everquest-companion\errors.log`. Info logs use the
  `[everquest-companion]` prefix. ErrorBoundary prevents blank windows. Check
  it first when anything's weird.
- `npm run typecheck` (node+web) before done. Data JSONs (spells, overlay
  baseline) are ES-imported so electron-vite INLINES them — a path-relative
  readFile would miss in `out/main/`.
- TS: discriminated unions with union-typed tags need a single-guard
  narrowing (`if (ev.t !== 'dmg') return`); `@shared/*` value imports need
  the renderer `resolve.alias` in electron.vite.config.ts. Node-tested
  pure modules use RELATIVE value imports (type-only may keep the alias) —
  the mobSearch.ts precedent, now repo-wide.
- Vite 5 inlines JSON as PRETTY-PRINTED object literals unless
  `json: { stringify: true }` — measured 1.56× bundle bloat on items.json
  before the flag. Keep it set for the main bundle.
- Blink scrollbars: setting the STANDARD props (`scrollbar-width`/
  `scrollbar-color`) switches to native Fluent bars and SILENTLY IGNORES
  every `::-webkit-scrollbar-*` rule — the two are mutually exclusive.
  The themed inset scrollbar lives in theme.ts + overlay.html (values
  must move together; the overlay is MUI-free and can't import tokens).
- `flexWrap` converts content overflow into HEIGHT — a "compact bar"
  contract means `nowrap` + one shrinkable/ellipsizing group for
  world-supplied text (tooltips keep the facts); controls never shrink.
- Chromium `navigator.clipboard` needs a permission this app denies
  wholesale — clipboard writes route over IPC to main's clipboard API.
- **A dynamic `import()` is BUNDLED, not externalized** — "it's a devDep so
  production can't load it" is FALSE by default: the triage tab's first
  build shipped 917 kB of working AWS SDK into `out/main` with only a
  boolean guarding it. Dev-only main-process code must ALSO be listed in
  `externalizeDepsPlugin({ include })` so the emitted chunk carries bare
  unresolvable `require`s. Measure the built output; never trust the
  dependency graph's intuition.
- **Never reference a vite `define` bare**, and **anchor a dev-only flag on
  `import.meta.env.DEV`, not on the `define`.** Defines exist only from
  dev-server START, so a bare identifier under a stale server is a
  `ReferenceError` that blanks the whole app (it did, 2026-08-04) — and
  feature-hidden is still a SILENT wrong answer (the Triage tab vanished with
  nothing to grep). ONE guarded reader per flag:
  `import.meta.env.DEV && (typeof __X__ === 'undefined' || __X__)` — absent
  define means STALE SERVER, degrade upward — and log the resolved value once
  at boot. Config changes (defines, entries, externals) require the OWNER to
  restart `npm run dev`; say so in the report. Full story:
  docs/agents-archive.md.
- **OWNER tooling needs `EQ_OWNER_TOOLS=1`; plain DEV is not enough** (JOS-72).
  Tier 1 (dev restart, `UNRELEASED`, boot diagnostics) stays on plain
  `import.meta.env.DEV`; tier 2 (the Triage tab + every `triage:*` handler,
  which read the owner's DSQL/S3/CloudWatch) additionally requires the env
  var at BOTH ends — main refuses to register the IPC
  (`src/main/ownerTools.ts`) and the renderer hides the nav row (devFlags.ts,
  fed by `window.eq.ownerTools`). It exists because `app.isPackaged` is FALSE
  in a self-compiled build of this public repo. Tier 2 degrades **CLOSED** —
  the opposite of tier 1's degrade-upward; policy in
  `src/shared/ownerTools.ts`. The owner sets it in the SHELL
  (`setx EQ_OWNER_TOOLS 1`; electron-vite has no `.env` → `process.env`
  path). Never commit it, never put an AWS profile name in the gate. Full
  story: docs/agents-archive.md.
- MediaWiki: anonymous `eilimit` caps at 500; >50 pageids per revisions
  batch returns HTTP 200 with ZERO pages and no warning — BATCH=50 is
  measured, not tunable.
- **`setTimeout(n)` IN THE MAIN PROCESS DOES NOT LAST n ms** (MEASURED
  2026-08-06): Windows runs a 15.6 ms timer quantum, so a sleep ends at the
  next TICK EDGE after the time requested and a work/rest cycle SNAPS TO THE
  GRID — no fixed argument buys an arbitrary duty. Anything pacing itself
  with a timer must MEASURE what it got and bookkeep the difference
  (`replaySlicer.ts`'s debt ledger is the pattern), never trust the nominal
  argument; `setImmediate` is not a pause at all. Measurements:
  docs/agents-archive.md.
- **`setFocusable` IS NOT AN ATTRIBUTE WRITE ON WINDOWS — IT MOVES THE
  FOREGROUND WINDOW** (JOS-199). `setFocusable(false)` DEACTIVATES the
  window, and Chromium's deactivate `SetForegroundWindow`s the first visible
  window below it — under an always-on-top overlay, that is EverQuest. The
  call is not idempotent and must never be "re-asserted": focusability is a
  WINDOW STYLE (WS_EX_NOACTIVATE) and survives hide/show, so set it in the
  CONSTRUCTOR (`focusable:`) and afterwards only when `isFocusable()`
  disagrees. `tests/overlayFocusPolicy.test.mts` pins the one call site.
  Full story: docs/agents-archive.md.

## Linting (ESLint 9 flat config + the ratchet)

`npm run lint` gates CI in BOTH build.yml jobs, right after typecheck. Full
rationale lives in the header of `eslint.config.mjs` — read it before touching a
threshold. The short version:

- **Two layers.** Correctness: typescript-eslint `strictTypeChecked` +
  `stylisticTypeChecked`, type-aware through TS's project service (which resolves
  every file through the same two tsconfigs `npm run typecheck` builds — lint and
  typecheck can never see different file sets), plus react-hooks for the
  renderer. Factoring: `complexity 12`, `max-depth 3`, `max-lines 400`,
  `max-lines-per-function 100`, `max-params 4` (line counts skip blanks AND
  comments — this repo comments heavily on purpose; the metric is code mass).
- **Those five numbers were MEASURED, not guessed.** `npm run lint:measure`
  re-runs ESLint with the rules pinned to `max: 0` and prints the
  distribution + a threshold sweep; each threshold sits between p95 and p99
  of the real tree. Never change one without re-running it — including
  `max-depth 3`, which the data chose over the obvious 4.
- **THE RATCHET ONLY SHRINKS.** `eslint.ratchet.mjs` is a GENERATED per-file
  rule-off block listing exactly today's violations, so lint is green with zero
  source changes. It is a debt register, not a permission slip. A wave DELETES the
  entries it fixed and re-runs `npm run lint` to prove the deletion was earned.
  **Adding an entry is the integrator's call, never an executor's**, and
  regenerating wholesale (`npm run lint:ratchet`) to make a red build green
  silently widens it and defeats the whole design. `EQ_LINT_NO_RATCHET=1 npx
  eslint .` shows the true state.
- **Refactor-wave law.** `lint-worklist.md` (generated beside the ratchet)
  partitions the inventory into five disjoint waves so agents run in
  parallel on non-overlapping files. Every wave is **BEHAVIOR-PRESERVING
  ONLY**: no fixes, no "while I was in here". Full `npm run typecheck` +
  `npm test` after each wave; the engine waves additionally need the
  byte-identical regression gate (law 8's tripwire). Keep the tree buildable
  throughout. Wave map: docs/agents-archive.md.
## Architecture

```
scan (live:false) + Tailer (live:true, byte-offset handoff — LOSSLESS seam)
   └► parseEvent (ONE pass, seq-numbered) ─► LogBus
        ├► derived events: bus.emitDerived queues, drains AFTER the primary
        │  event (no re-entrancy). Producers: buffs (buffExpired), epoch.
        ├► ModuleRegistry ─► EqModule { id, reset(), onEvent(ev, live),
        │    onTick?(now), snapshot()→{seq,state}, flushDelta()→delta|null }
        │  Live deltas push `module:delta` (throttled); replay is silent.
        │  A 1s wall-clock tick drives time-based logic while the log idles.
        │  A REPLAY IS A BRACKETED STATE (JOS-60), not just a per-event flag:
        │  `registry.beginReplay()/endReplay()` around the scan, every push
        │  path gated by it, and endReplay DISCARDS what the fold accumulated
        │  (modules append to `pending` whatever `live` says — the push is the
        │  registry's call). The heartbeat stops for the duration too.
        │  Modules incl. `progression` (columnar exp/kill/zone analytics,
        │  capped w/ windowStart honesty, recent-kills ring) and `combo`
        │  (registered FIRST; evidence → candidate-set slots → fuzzy
        │  intervals; corrections TIME-keyed in the store, v3 migration).
        └► CombatEngine (pull-snapshot variant: `combat:snapshot` IPC +
           throttled `combat:activity` nudge; per-encounter event ring for
           the timeline; cached finalized summaries; capped payloads;
           session state timeline + proc detection/PPM/attribution —
           procDetect/procWindows/procViews, all law-8 additive)
Maps: src/main/maps (pack discovery/per-layer cross-pack merge/LRU/search,
Electron-free w/ injected roots) over shared/maps types + shared/zones
(THE zone-knowledge table); renderer features/maps (canvas geometry, DOM
labels w/ collision declutter, floor slicing). Pure fns + goldens all over.
  **`mapFromLoc` IS THE ONE `/loc`→map SEAM** (`mapX=-ew, mapY=-ns`, y grows
  SOUTH — JOS-65). Wiki mob pins and the user's typed-/loc marker (JOS-98,
  `eq.maps.loc`, per zone) both go through it and then through `project`;
  a second copy of those negations is the bug this repo already shipped once.
Renderer: useModule(id, applyDelta) — hydrate, seq-dedupe deltas, re-hydrate
on `log:character`. Overlay = second renderer entry (overlay.html) with a
minimal `eqOverlay` bridge (transparent alwaysOnTop, click-through pin).
```

- **A WINDOW THAT FOLDS A MODULE NEEDS BOTH HALVES OF THE TRANSPORT — THE DELTAS
  AND THE REBUILD** (JOS-172). `module:delta` is an INCREMENT and a
  historical fold emits none (`endReplay()` DISCARDS — JOS-60's rule, and it
  stays), so "hydrate once, then ride deltas" is only complete if something
  says *ask again*. An overlay already open at launch hydrated mid-fold and
  then rode increments describing none of it. `sendWorldRebuilt`
  (pipeline.ts) is the ONE answer to "who is told the world was rebuilt" —
  the main window and `MODULE_READING_OVERLAYS`; every `IPC.onCharacter` send
  goes through it. The fix is the DELIVERY, never the discard. **And
  re-hydration is a SECOND reason a row can vanish**: anything watching a row
  set for removals is told which kind of change it sees (`timerDrops` takes a
  `rebuilt` flag and says nothing across a re-fold). Measuring this in e2e
  needs a SLOW fold — `tests/e2e/buffRestartSteps.mts` pads the log with 400k
  real lines and CHECKS the fold was still running. Full story:
  docs/agents-archive.md.
- **A MODULE WITH A SECOND INPUT MUST REPORT ITS OWN REVISION AS `seq`, NOT
  THE LAST EVENT'S** (JOS-87). `useModule` dedupes on `seq`, so "last
  LogEvent seq folded in" only works when state moves ONLY on events; the
  combo module's user correction advanced no seq, so an idle-log correction
  was dropped as a duplicate — forever, on an idle log. Fix: a private
  counter bumped by anything that can change state (`ComboModule.markStale`,
  reported by BOTH `snapshot()` and `flushDelta()`), plus the PUSH half —
  out-of-band writes call `registry.flushNow()` (ipc/combo.ts `republish()`).
  A unit test cannot see either half; `tests/e2e/loadout-override.e2e.mts` is
  what caught it. Full story: docs/agents-archive.md.
- **Character epochs**: character-scoped state (leveling/AA, loot, kills,
  turnins, buffs live-state) resets at the epoch boundary — anchored at
  OFFICIAL LAUNCH 2026-07-28 (`epochDetector.ts`; the user's beta character
  shared this log file pre-launch). Do NOT use level regression (loadout
  swaps legitimately change level). Game-knowledge (mined durations,
  message overlay) persists across epochs.
- **A LOGOUT PAUSES YOUR CHARACTER, NOT THE WORLD — SO BUFFS FREEZE AND
  DEBUFFS DO NOT** (JOS-134, owner's design 2026-08-09). EQ resumes a
  beneficial buff's REMAINING duration at login
  (`BuffInstances.onOfflinePause`; the S5 fixture proves it to the second); a
  debuff you left on a mob is a timer in the WORLD and is never shifted
  (`modules/buffTimers.ts` takes an EXPLICIT no-op on `offlineGap`). **The
  boundary is evidence, not a timeout — AND SINCE JOS-262 THERE IS NO TIMEOUT
  LEFT ANYWHERE IN IT.** Every login prints a reconnect preamble, whose LENGTH
  is a client-side duration; while the anchor was a 30s window and the hole's
  answer a 30s timer, a slow-loading machine got no pause at all (measured:
  31s of preamble = no `offlineGap` emitted; the heartbeat wiping the previous
  session's buffs seconds before the `Welcome`). Both constants are gone. ONE
  shared predicate decides both halves: `sessionDetector.ts inWorldEvidence` —
  a line that could ONLY have been printed for THIS character. It anchors
  `fromTs`, and `modules/buffsSession.ts` rules a hole unexplained only when
  such a line arrives with no intervening login. **"Typed" is NOT the test and
  the log says so**: other players' combat lands in the preamble (two `death`
  events 2s before the Aug 07 Welcome), so a stranger's kill proves the CLIENT
  is connected and nothing about you. The priced cost: `fromTs` stays a LOWER
  bound, so a gap never under-states an absence and runs long by the trailing
  run of lines that name nobody — 24s across an ordinary camp (the countdown
  ticks are `unknown`), 56 min in the worst AFK park measured over 45 logins.
  **And the learner refuses BOTH halves of a cycle that spans an absence**
  (`spannedGap`) — both err LONG, the direction law 5's recency-weighted MAX
  is most sensitive to. Censor, never correct. Zoning is not a logout; death
  still clears (JOS-88). Full story: docs/agents-archive.md.
- **Spell DB**: `src/main/data/spells.json` (~1.9k spells from eqlwiki
  `Template:Spellpage`: durations, cast/wear-off messages, illusion flag,
  Beneficial/Detrimental) + `messageOverlay.baseline.json` + per-user
  learned overlay (overlay wins over wiki), injected via rulesets
  `ParserConfig`. Learned counts are filed PER SOURCE and a re-fold replaces
  its own bucket — JOS-231's law in the checkpoint tombstone below; read it
  before touching the miner's seed or `<userData>/message-overlay.json`.
  **AND SINCE JOS-251 IT CARRIES WHAT A SPELL DOES** — `SpellEntry.effects`
  is the wiki's numbered effect list VERBATIM, and
  `src/main/data/spellEffectClass.ts` is the separable OVERLAY that reads
  them; rules anchor at the HEAD of the effect sentence (a name stem matched
  substrings of NAMES — `charm` found `Naki's Charm of Pernicity`). The
  derived charm roster IS `ParserConfig.charmSpell` now (`CHARM_STEMS` the
  fallback); `ccSpell` is still stems ON PURPOSE — the derived hold roster
  disagrees on 19 spells incl. `Ensnare`, reconciling is an owner ruling,
  and the derivation's answer is pinned in
  `tests/spellEffectClass.test.mts` waiting for it. Full detail:
  docs/agents-archive.md.
  **THE SCRAPE IS REVISION-KEYED AND BATCHED**
  (`scripts/sources/cache/spells/index.json` records the revid per cached
  page); a re-run with an unchanged spell list is a byte-identical no-op.
  Re-scraping is cheap — but it is a DATA CHANGE, not a refresh (the JOS-251
  run also picked up 160 wiki edits, one of them wrong). Diff it, do not
  skim it.
- **Alerts**: declarative JSON `AlertDef` in electron-store; triggers =
  primitives (event kind + `where` match, raw regex, app signal) or
  composites `{any|all}` (same-event semantics only). Module evaluates
  live-only with cooldowns; renderer plays sounds. Sound packs live in
  `resources/soundpacks` + userData; the ONE shipped default (Alan Rickman,
  `src/main/data/defaultPacks.ts`) is gitignored audio and SELF-PROVISIONS
  at startup from its pinned registry tag — seeded + suggested alert defs
  reference its derived soundIds. App signals (bossDefeat, questComplete)
  fire from single always-mounted detectors.
  **PRESENCE IS NOT PRECEDENCE: THE DEFAULT PACK IS A PREFERENCE, AND A DELETION IS A
  STATEMENT** (JOS-273, owner ruling 2026-08-13 — verbatim: *if someone deletes alan
  rickman, they should be able to set a default and it should persist*). The shipped
  pack used to be HARDCODED as the pack every picker pre-selected and every authored
  alert pointed at, and startup provisioning re-installed it whenever it was missing
  with no memory of a deletion — so deleting it held until the next launch, which
  users experienced as "it re-enables itself with every update". Three parts, all in
  `src/shared/soundPacks.ts` (the pure core) + `storeSoundPacks.ts` (accessors):
  (1) the PREFERENCE `soundPacks.defaultPackId`, honoured by the picker pre-selection
  (`SoundPicker.fallbackPack`, `alertForm` hydration, the row's `AudioPicker`), the
  suggestion builder (every template/rank/illusion chip, the ready-made sets, the
  observed slow offer) and the SEEDS (`alertSeeds.ts`); set from the pack browser's
  star, beside the Uninstall the reporter was already reaching for. (2) the TOMBSTONE
  `soundPacks.removedPackIds` — uninstalling a SHIPPED pack records it,
  `packsToProvision` skips it, installing it again clears it; additive is not the same
  as unconditional. (3) RESOLUTION, not silence: a ref whose pack (or sound) is gone
  resolves through the preference keeping its CESP category (`resolveSoundRef` — the
  live, pack-agnostic form of `migrateAlertSoundRef`'s intent mapping), and where
  nothing can answer the alert ROW says so (`soundNotice`). `getSoundDataIn` used to
  answer null for every pack but the reserved one; that rule was true right up until
  deleting the shipped pack became a supported thing to do. FRESH INSTALLS ARE
  UNCHANGED end to end — absent preference ⇒ every one of those is the identity
  function, and the additive optional key needs no schema bump. The renderer's
  `DEFAULT_PACK_ID` mirror (suggestions.ts) STAYS and keeps its mirror-sync law: it is
  a compile-time fact about what the app SHIPS, and the preference arrives beside it
  as runtime state. Pinned by tests/defaultPackPreference.test.mts +
  tests/e2e/default-sound-pack.e2e.mts (two launches over one userData dir).
  **A `where.spell` MATCHER TESTS THE WHOLE CANDIDATE LIST, NEVER THE FIRST PICK**
  (JOS-84). EQ prints ONE landing/wears-off sentence per spell FAMILY, so
  `buffApply.spell` / `buffWearOff.spell` are a best-effort first candidate
  while `candidates` carries the truth; the wizard's `lands` template pinned
  the first pick and could never fire. `spellCandidateNames` widens the
  `spell` key (only that key, only when the event carries candidates) and
  `matchedSpellName` reports the one that satisfied the def. When one
  sentence is five spells, the alert is an alert on the FAMILY — which is
  also what keeps it alive across the level-up that replaces the spell. Full
  story: docs/agents-archive.md.
  **A LITERAL `where.spell` MATCHER IS RANK-BLIND — ALL RANKS, FULL STOP**
  (JOS-259, owner ruling 2026-08-12; domain law, verbatim: once you upgrade a
  spell it never downgrades, even on a loadout swap). Only SOME of a spell's
  lines carry the roman numeral — `castBegin`/`resist` keep it, the wear-off
  family prints the bare name — so whole-string equality let one def satisfy
  half its own spell's lines: a wizard's resisted alert for Elemental
  Maelstrom went silent on the day they unlocked rank II while their fade
  alert kept working. A literal spec now compiles with `spellLineKey(spec)`
  beside it and `accepts` (main/modules/alerts.ts) compares the folded keys
  when the exact compare misses — a pure WIDENING, so a def pinned to a rank
  still fires on it. Untouched, on purpose: `/regex/` specs (user intent, not
  a spelling), every non-`spell` key, and `damage.skill` (a spell name for
  dtype spell/dot and a melee verb otherwise — an owner call of its own). NO
  upgrade-offer compensation: `detectRankUpgrades` still only sees suffixed
  defs, and that is now a convenience rather than the thing between a user
  and a sound. Pinned in tests/rankBlindSpellAlerts.test.mts.
  **AND THE LAW HAS NO CARVE-OUTS LEFT: RANKS DECIDE NOTHING IN THE ALERT SYSTEM**
  (JOS-276, owner ruling 2026-08-13 — verbatim: *we should not use spell ranks for
  anything in the alert system - it should be compatible with any rank*). The
  damage lane folds via `foldsRank`/`foldReaches` gated on `dtype 'spell'|'dot'`
  (melee skills are table constants, `ds` is free text — the gate sits on the
  dtype, never the measurement); the app-authored slow rosters and the wizard
  rank-chip dedupe folded too. Rank-SENSITIVE survivors are justified in place
  (`spellLastCast`, `detectRankUpgrades`, `matcherAccepts`); cooldown and
  early-warning identities are rank-blind by construction. Pins: the D-series in
  tests/rankBlindSpellAlerts.test.mts. Full sweep story: docs/agents-archive.md.
  **CAPTURE GROUPS SPEAK THE LOG, AND THE THREAT MODEL IS IN THE CODE** (JOS-103,
  `src/shared/alertCaptures.ts` — read its header before touching any of
  this). Alert defs are SHAREABLE, so a capture is a channel with a third
  party at each end. Five controls, each enforced at BOTH ends (main
  harvests, the resolver re-checks): shared sanitizers; `MAX_CAPTURE_CHARS`
  48; a value may come ONLY from the text the def's own condition just
  tested — **there are no ambient tokens**; named-only declarations, never
  GINA's positional `{S1}`; ONE left-to-right pass with a FUNCTION replacer.
  Unknown tokens render LITERALLY. Honest limits are stated in the file (a
  loose `raw` pattern can still MATCH a chat line — which is why
  `subjectCapturePattern` anchors `^\[[^\]]*\] `, never a bare `\] `). Full
  threat analysis: docs/agents-archive.md.
  **A TEMPLATE FLAG IS A CLAIM THE ALERT CAN FIRE, AND THREE OF THEM WERE LYING**
  (JOS-103). `suggestionTemplates` is now an exhaustive table over the DB's
  33 observed `spellType`s — a spell with no template is DROPPED from the
  catalog (Spirit of the Puma was invisible). `lands` is not offered where no
  `buffApply` can ever be emitted; `wearsOff` is an `any` composite over
  `buffExpired` + `buffWearOff` (a buff somebody else cast never becomes an
  active instance). Puma's landing line has NO typed event at all, so its
  shipped capture suggestion is a `raw` trigger — the only thing that exists
  for that family. **AND `suggestions.ts` IS NODE-TESTED NOW** (imports
  relative, repo law): `tests/suggestedAlertsFire.test.mts` drives a real
  suggested def through the real parser into the real module. Full story:
  docs/agents-archive.md.
  **A MEZ HAS NO `buffExpired`, SO IT GETS THE EVENT IT ACTUALLY HAS** (JOS-161).
  `wearsOff` rests on the derived `buffExpired`, which only an AUTHORITATIVE
  wear-off message synthesizes; a hold on a mob has none — its wear-off is
  claimed by `classifyWornOff` and becomes `cc {refresh:true}`. The `breaks`
  template is `{cc, where:{spell, refresh:'true'}}`, gated on the parser's
  own `ccSpell` roster (exported from rulesets.ts for exactly this reader).
  Same honest limit as the group: "it ended", never "it ended early". Full
  story: docs/agents-archive.md.

- **THE CORRECTIONS OVERLAY CAN RENAME, AND A NAME IS A JOIN KEY** (JOS-161,
  `src/main/data/spellCorrectionsList.ts` — the evidence bar and the five
  drift classes live in that header; `spellCorrections.ts` is the mechanism).
  The fifth drift class is the name itself (`Solon's Bravura` on the wiki,
  `Solon's Bewitching Bravura` in every line the game prints), and the name
  is a join key everywhere. TWO RULES: a name correction writes EVERY row of
  that name, and it reports `unknownSpells` rather than `stale` when it rots;
  the audit test fails on either list. **And every index keyed by spell name
  must read the CORRECTED entries** — `spellClasses.ts` and
  `levelUnlocks.ts` do; a raw-`spells.json` importer that looks up BY NAME is
  a silent miss waiting to happen. Full story: docs/agents-archive.md.

### Electron trust boundary (do not weaken)

- ONE `WEB_PREFERENCES()` in `src/main/windows.ts` (module-private, beside the only
  code that creates a BrowserWindow) builds the webPreferences for EVERY window
  (main + all five overlays) — never inline a second opinion. contextIsolation
  on; nodeIntegration (+InWorker/+InSubFrames), webviewTag,
  allowRunningInsecureContent, experimentalFeatures, enableBlinkFeatures,
  navigateOnDragDrop, spellcheck all off; webSecurity on. Stated explicitly even
  where they match Electron's default — the default is someone else's decision.
- `sandbox:false` is a PACKAGING blocker, not a choice: both preloads
  `require()` a shared rollup chunk, and a sandboxed preload's `require`
  resolves only `electron` + a tiny polyfill set (MEASURED: flipping it
  kills e2e with `module not found` and no `window.eq`). Nothing in the
  preloads needs Node, so `sandbox:true` (and `app.enableSandbox()`)
  unlocks the moment electron.vite.config.ts emits each preload as ONE
  self-contained file.
- Navigation/window-open/webview policy is installed ONCE from
  `app.on('web-contents-created')` (hardenWebContents), never per window: a
  window added later must not be able to miss it. `will-navigate` allows only the
  bundled renderer dir (or, in dev, the electron-vite server's ORIGIN — the
  server's own URL, so 5173/5174 both work); `setWindowOpenHandler` is
  deny-always and hands ONLY an allowlisted https URL to `shell.openExternal`.
  **That allowlist is the boundary, not a formality**: link URLs are built from
  WIKI PAGE TITLES (`shared/wiki.ts`), and an unvalidated openExternal would let
  one ask the OS to run `file:///…exe`. Widen `EXTERNAL_LINK_ALLOWLIST`
  (security.ts) deliberately or not at all, **and an entry is a HOST PLUS AN
  OPTIONAL PATH SCOPE — write the narrowest one that serves the link** (owner
  ruling, JOS-263). It has been widened ONCE, for `github.com` (JOS-254, the
  What's new panel's link to the releases page), and that entry is
  REPO-SCOPED: only `https://github.com/jmoyers/everquest-companion/…` opens,
  never github.com's root or anyone else's repo. The three wiki entries stay
  host-wide because a wiki link's PATH is the page title this app cannot
  predict; github.com is not one site the way a wiki is. The justification is
  written where it lives: the URL is a constant in the renderer bundle rather
  than scraped text, and that repo is where every build of this app comes from.
  The path prefix is matched SEGMENT-AWARE (`…-companion-evil` is not inside
  `…-companion`) against the WHATWG-normalized pathname, so `..` — and its
  `%2e%2e` spelling — is already resolved away before the check.
  All permissions are denied wholesale
  (this app needs none); pure policy lives in `src/main/security.ts` and is
  pinned by `tests/security.test.mts` (no Electron, never skips).
- Renderer-supplied strings that reach `join()` are validated AT THE IPC
  HANDLER (`sounds:getData`'s packId → `isSafePackId`), not trusted because
  today's only caller is the app's own UI.

## World-model laws (hard-won; do not relearn these)

1. **Messages over inference.** Applications, targets, expiry come from
   explicit chat lines (cast-on-you/other, wears-off, "Your illusion
   fades.", "slows down.", resists). Estimates are display-only countdowns.
   Anything inferred is LABELED inferred — never silently guess.
2. **Names are dirty; canonicalize at boundaries, display raw.**
   Case-insensitive keys (`idKey`) everywhere (lifecycle lines lowercase
   articles; damage lines capitalize). Strip spell rank suffixes (casts say
   `Swift Like the Wind I`, fades are rank-less) and item ` +N` variants at
   COUNTING boundaries only. Strip leading a/an/the for boss matching.
   OUR OWN labels are dirty too: `WorldModel.label()` appends a
   spawn-generation ` (N)` suffix ("the 14th capturer this session") that
   rides `currentTarget` into lookups — `mobKey` strips it; it is display
   flavor, never identity. The suffix appears in NO log line.
3. **Shared messages are the norm.** 123 wears-off families ("Your speed
   returns to normal." = 9 hastes), generic illusion landings ("You feel
   different."). Parser carries candidate lists; the MODEL resolves against
   the active set / session cast history.
4. **Entities, not names; disposition, not identity.** Buffs are
   (spell, entity) instances; "pet" is NOT a data-model class (self renders
   first, others second — presentation only). Charm break keeps the entity
   + buffs (re-charm same name w/o death/zone = same entity). Single-pet
   invariant: new claim/charm retires the prior pet — enforced in TWO models
   with different reach, measured, not an oversight (JOS-54):
   `modules/buffs.ts` retires across BOTH kinds at the buff-entity level; the
   combat `WorldModel` retires only BY KIND (`claim()` retires the prior
   SUMMONED pet — the successor's claim is the only evidence a recast prints;
   `charm()` retires nothing there; the crossover is an unobserved shape and
   gets no invented rule — awaiting-sample law). Retirement is not deletion:
   the old pet keeps every point already attributed (rows key by instanceId)
   and only stops being yours for FUTURE admission, so the engine's
   `petNames` index follows the world model out
   (`EngineState.syncPetNames`). **AND THE CLAIM IS WHAT TRIGGERS IT, NOT THE
   SUMMON** (JOS-188): an upgraded pet is a new NAME; three lines produce the
   claim (tell / leader say / your own pet-only buff landing), all through
   one `bindPetClaim`, on purpose. Zoning: self + summoned pet keep buffs;
   charmed pets/hostiles are left behind (censor). Deaths retire.
   **Unobservable fades censor, never pollute stats.** Own-cast gating: never
   track buffs we didn't cast (10s cast window or a Quick Buff burst).
   **A HEALER OF YOURS IS NOT NECESSARILY A PLAYER (JOS-48).** Your own
   lifetap's recourse prints as `<mob> healed you …`, and filing that mob as
   a KNOWN PLAYER deleted every pet swing at it. The refusal is
   `EngineState.everStruck` — **a name YOU have landed damage on is a mob**,
   the third absolute guard beside `everPet` and `everCharmed`, and it is
   BEHAVIOURAL (the mobs catalog is never consulted, so it holds for a
   proper-named guard the catalog never heard of). The wider rule ("anything
   ever ENGAGED as a hostile") is MEASURED WRONG — a mind-controlled healer
   hits YOU first; being hit is something that HAPPENS to you, hitting is
   something you DO, and only the second names a mob. One direction only: the
   refusal never RETIRES a filing the heal got in ahead of. Measurements:
   docs/agents-archive.md.
5. **Aggregates lie; derive from identities.** AA earned = net allocation
   (latest purchase per ability+rank, cost-0 auto-grants excluded) +
   unspent (last authoritative "You now have" − later spends); sum-of-gains
   double-counts respec refunds. Durations: DB authoritative, else
   recency-weighted MAX (median biases low via censored samples).
6. **Say what the log cannot say** (documented non-distinguishables — never
   invent): main/off-hand; double/triple attack (SILENT extra swings —
   zero annotations in 1.35M lines; the rounds model (combat/rounds.ts,
   wave X 118f0c2) infers by (source, verb, TARGET, second) with
   cross-target fan-out collapse, per-event ONLY on reuse-timer verbs,
   aggregate-rate-with-inferred-chip on dual-wieldable weapon verbs, and
   the player's own Rampage swings are unannotated = outgoing rampage
   unknowable); ground pickups (NO line exists — the loot family is the
   only item-acquisition line); self-buff fades (only wears-off emotes);
   mob HP. Fight NAMING (Task #54): a LIVE fight is named after the CURRENT
   target (most recent outgoing target — the mob in front of you); on FINALIZE
   it switches to the LARGEST target ("most damage absorbed", a labeled proxy).
   Both keep the '+N' others suffix. `encounterName(e, live)`.
7. **Encounters close on evidence**: all engaged instances dead (+~5s
   linger); live CC (mez lines) holds fights open indefinitely; ~60s idle
   fallback for fled mobs. DPS = damage/(lastHit−firstHit); active-time
   DPS is the secondary stat. A zone change FINALIZES the live zone aggregate
   into a capped HISTORY (Task #54; last 20 sessions — frozen agg + timing +
   memoized summary, NO per-event rings, ~0.6MB full-log) instead of discarding
   it, so a past zone's overall meter stays selectable; the snapshot exposes
   `zoneSessions` (live first, id 'zone'; finalized 'zs<n>') and buildSelected
   accepts a session id. Selector rows (main + overlay) carry disambiguation
   timing: start clock (formatDate) · coarse live-updating age · duration.
8. **Miss/resist are first-class, damage-free** (Task #51 v2): a miss
   (avoided melee swing) and a resist (fully-resisted spell) attach to the
   fresh encounter + zone aggregate with the SAME attribution as damage
   (you/pet/incoming; hostile-mob-vs-mob resists dropped) but carry NO
   amount — so every damage total stays byte-identical (the tripwire, per
   source: `Σ category.total == source.total`). They enter the timeline
   ring as hollow/red ticks (miss -> "Melee" lane; resist -> the spell's own
   lane, so an always-resisted mez shows a 0-hit / N-resist lane). Rates:
   melee hit% = hits/(hits+misses) [hits counts ALL landed incl. spells —
   the per-category melee row isolates pure melee]; resist% =
   resists/(spell+dot casts + resists), surfaced at source / category /
   per-spell rows. A miss/resist NEVER opens or extends an encounter (only
   damage/CC does), so instants before the first hit go to the zone
   aggregate only. Ring cap 5k→8k (misses ~2× the density; sole marathon
   fight peaks 5259 instants — fits with zero drop-oldest; ≤60 rings
   retained, <1MB). Timeline zoom/pan is renderer-side view-window state
   (wheel = cursor-anchored zoom, shift-wheel/drag = pan, Fit = reset,
   starts fit); windowed by visible time range so the SVG stays cheap.
9. **One time base per chart.** A curve's vertices, markers, axis and hover
   inverse all read ONE `{t0, t1, bucketMs}`; samples anchor at bucket
   centres; live windows advance in whole buckets. Mixing an index-fraction
   vertex mapping with a time-fraction marker mapping stretched markers a
   full bucket at the right edge, and a wall-clock window length made them
   swim against a still curve every tick (fixed 5a9dbc2). Canvas is never
   the answer to arithmetic disagreement. Chart interaction seam: hover
   binds pointermove/pointerleave ONLY and bails when `ev.buttons !== 0`;
   drag interactions own pointerdown/up/cancel; a `suppressed` prop ties
   them without shared state.
10. **Revisable intervals JOIN AT READ; nothing stamps their ids.** Combo
   intervals (fuzzy, retroactively re-labeled by a later /who or a user
   correction) are queried by timestamp (`comboAt`/`groupByCombo`); an id
   stamped onto a boss kill goes stale with no reconciliation path.
   Persisted corrections key on TIME; interval ids are recompute-unstable
   and never leave the renderer.
11. **Exclusivity gates are RATE-AWARE.** "Never fired without X" requires
   the inactive exposure to PREDICT evidence (>= 3 expected firings at the
   lane's own active rate), never a flat swing floor — 289 swings deny
   Instrument of Nife what 225 earn Spellblade, and that asymmetry is the
   point. Direct observation beats the model (a lane that DID fire inactive
   is never "under-sampled"). States active for the same firings declare
   co-exclusivity — two rows never silently claim one body of evidence.
12. **Cross-source name RENAMES are knowledge, never fuzzy.** The log, the
   mob catalog and the map stems disagree by NAME (The Ruins of Old
   Paineel = The Hole), not spelling. `shared/zones.ts` is the ONE
   hand-authored, evidence-verified artifact (short names, aliases,
   `catalogZonesFor`); closest-match would conflate genuinely distinct
   zones, and an anti-fuzzy tripwire pins two near-name rosters disjoint.
   A new gap gets a VERIFIED row, never a matcher.
13. **A DEATH→DEATH GAP IS AN UPPER BOUND, NOT A MEASUREMENT** (JOS-194,
   `shared/respawn.ts`). Respawn clocks start on the death MESSAGE, numbered
   from your own kills; the wiki is a bad primary source (394 readable
   respawns across 7,872 pages), so the ladder is: your typed number, then
   your kills, then the wiki as a DEFAULT before you have kills and a FLOOR
   under them once you do. Every observed gap is `respawn + your delay`, so
   the SMALLEST gap converges downward; it prints as `≤` with the sample
   count, and a clock at zero says **due**, never "spawned" (laws 1, 6). Two
   evidence rules keep the bound honest: a gap counts only when both deaths
   fall inside ONE stated stay in the zone (a zone line ends the stay even
   when it names the same zone), and two deaths of one name inside 60 s are
   two mobs in one pull (the shortest catalog respawn is 78 s). The committed
   floor keeps each page's VERBATIM text beside the parsed seconds
   (`--reparse` re-derives with NO network).
   **TRACKING IS OPT-IN PER MOB, AND THE DISPLAY IS ZONE-SCOPED** (owner):
   EQ names are massively DUPLICATED, so a clock nobody asked for is a clock
   about a mob the app cannot identify. Recently-killed is the discovery
   surface; a clock exists only on Watch or a typed number; surfaces show
   only the zone you are in, filtered by the module's OWN zone-stay state
   (the empty zone is its own BUCKET; `due` never widens the filter). The
   zone is part of what the screen shows, so the module bumps `rev` on a
   zone line (JOS-87's rule, re-learned) — watch list, zone line, sighting
   and confirmation all bump it.
   **AND A CLOCK MUST YIELD TO THE LOG NAMING THE MOB** (owner): a row
   carries `seenTs` — the last instant a TYPED event named that mob while
   the fold stood in that zone — and a newer `seenTs` reads **UP**, sorting
   above every countdown; the UP state ages out (`RESPAWN_LINGER_MS`), never
   the row. Coverage is off EVENTS, never a raw-text scan; a corpse is
   deliberately NOT a sighting, or every kill would flip its own row up.
   **AND A SIGHTING NEVER AUTO-ADJUSTS THE SCHEDULE** — it proves the mob is
   UP, not when it spawned; re-basing is the explicit `Start clock here`
   affordance (`respawn:confirmSighting`, `basis:'sighting'`, base
   `max(death, confirmation)`), session state, never persisted.
   **AND UNWATCH LIVES ON THE MOB, WHEREVER YOU MEET IT** (owner): every
   surface naming a watched mob carries its own way out, all landing on ONE
   channel, `respawn:unwatch`, which takes the canonical mob KEY, removes
   the NAME, and throws away nothing else — watching again restores the
   identical clock (pinned on the WRITE: `tests/respawnUnwatch.test.mts`).
   Rounds 7-9, distilled: the tab is Timers; the duration + source label are
   ONE bordered unit whose edit icon opens `RespawnEditDialog.tsx`
   (whitelist grammar `parseRespawnDuration`; `respawnOverridden` = the
   ladder saying `source === 'custom'`); the OVERLAY carries no editing;
   **a watched row NEVER vanishes while watched** (round 8 — the expiry
   sweep is gone; stale rows read "due long ago"; what ages out is the SEEN
   state; unwatch is the only way a row leaves); the mob hover card is
   IN-APP ONLY. Full rounds history: docs/agents-archive.md.

## The fold checkpoint, and why there isn't one (JOS-208, removed by JOS-230)

For two days the app could restore its world model from a binary checkpoint
and replay only the log's tail (~5,000 lines of machinery). It worked; the
owner removed it anyway: the cold-read stall it targeted did not survive its
own instrumentation (fleet p95 time-to-first-MB 10-25 ms — the real cost is
fold CPU under the slicer's fixed duty), it shipped OFF behind a gate whose
denominator could never move, and it taxed every fold change with
schema/goldens/census ceremony. WHAT SURVIVED, because it is the app's and
not the feature's: `tests/foldDeterminism.test.mts` (**a historical replay
reads no wall clock**), the engine's `st.hydrating` gate
(`tests/combatReplayClock.test.mts`), and
`MessageOverlayMiner.lastObservedTs` (a published snapshot's `updatedAt` is
the LOG's clock). Both product fixes were found by folding the same bytes
twice and diffing — reach for that again, harness or no harness. If a
startup-cost ticket comes back: measure first, and read
`git log 5038f6f0..1c3e584f`. Full post-mortem: docs/agents-archive.md.

**A FOLD MUST NEVER BE SEEDED WITH WHAT IT IS ABOUT TO RE-DERIVE, AND THE ONLY
HONEST WAY TO KNOW IS TO FILE EVERY COUNT UNDER ITS SOURCE** (JOS-231). The
message overlay re-mines the whole log every launch; seeding it from its own
persisted served view double-counted every cold launch (22 → 44 → 88,
measured — verdicts drifting toward "how many times the app has started").
`MessageOverlayMiner` keeps ONE BUCKET PER SOURCE (`BASELINE_SOURCE` for the
committed baseline), `beginSource(key)` DISCARDS a bucket before its log is
folded again, `build()` sums the buckets — a re-fold REPLACES its source's
contribution; idempotence is structural. The persisted file is v2, a
REGISTER with no verdicts (a stored verdict is a second opinion waiting to
disagree with the derived one); v1 files are ignored, retiring the inflation
in the field. The fix deliberately KEEPS the persisted seed (a bucket for a
character you are not folding is knowledge nothing can re-derive, and
`effectiveSpellDb` derives parser corrections from the seed BEFORE the fold)
and does not dedupe by log position.
`tests/messageOverlayIdempotence.test.mts` pins it all, with a tripwire that
re-creates the old shape and watches the counts double.

## Log-format quick reference (all validated against the real log)

The committed fixture tests (`tests/fixtures/*.log` + their suites) are the
AUTHORITY for line shapes; the rows kept here are the non-obvious laws, and
the full per-lane evidence lives in docs/agents-archive.md.

- Melee verbs CONJUGATE — match first person ("You slash") AND third
  ("slashes"); missing `smite`/`cleave` once hid 22% of all damage. Paren
  modifiers are COMPOUND: `(Riposte Slay Undead)`.
- **A VERB THAT NAMES A CLASS SKILL GETS ITS OWN LANE; A WEAPON VERB DOES
  NOT** (JOS-77, JOS-81). `meleeSkill()` (log/parseCombat.ts) splits
  Backstab, Bash, Kick, Frenzy, Flurry, Cleave (WAR) and Smite (PAL);
  slash/pierce/crush/hit/slice/claw/gore are what a weapon in a hand prints
  and share the generic "Melee" row (the Rounds panel splits those BY VERB).
  The table is HAND-AUTHORED against `data/classes.json`'s skill→class map —
  never a matcher over spelling. The proofs differ per lane; know them
  before adding one:
  - Cleave (JOS-77): an ABSENCE — the owner slashes 71,104 times, cleaves
    ZERO, receives 20,334 incoming cleaves; a verb that never prints for a
    player who lacks the skill is gated on the skill.
  - Smite (JOS-81): THE SKILL-UP STREAM — a weapon verb never ticks under
    its own name (`better at Slash!` does not exist) while `Smite` ticks
    beside Kick/Bash/Backstab. **THE SKILL LANE AND THE SPELL LANE SHARE A
    STEM AND MUST NEVER MERGE** — a spell literally named `Smite` exists;
    `tests/combatSmiteLane.test.mts` pins the collision on real bytes.
  - Ranged (JOS-92): **a weapon verb fired from a different SLOT than the
    hands is not the hand lane** — `shoot` ticks under `Archery`. THE
    DISCRIMINATOR IS THE VERB AND NOTHING ELSE (a stance- or class-keyed
    split would mis-assign a stance-switcher's fight); no thrown lane is
    invented beside it (awaiting-sample law); the self arm is INJECTED in
    `tests/combatRangedLane.test.mts` — the owner has never fired a bow.
  - Strike (JOS-163): the GENERIC VERB every monk special prints as — not a
    class skill, not a slot — so an unnamed strike earns a row called
    **`Strike`**, the verb, never a name from the chain. The bug was the
    PRE-STATE FLOOR (the `You will now use <X> …` line prints once, at
    level-up, so a log that begins after it read "Melee" forever): the verb
    earns the ROW, the state line earns the NAME, and **no lane is ever
    seeded from the chain's first entry** (specialAttacks.ts's stated law).
  Law 8 held byte-identical across all four changes; full counts, fixtures
  and hand tallies: docs/agents-archive.md.
- **A HEAL THE LOG ANNOUNCES BUT NEVER VALUES GETS A LANE THAT CARRIES A COUNT
  AND NO NUMBER** (JOS-86 — the monk's Mend). `You mend your wounds and heal
  some damage.` is the whole sentence: no amount, no target, no third-person
  twin (whole-log partition: 876 of 1,178 `mend` lines are that sentence, the
  rest skill-ups and chat). THE FIX IS A KIND, NOT A FLAG: `healUnstated`,
  with **no amount field at all** and a third `HealClassification`
  `'unstated'` — a `heal` with `amount: 0` would be a lie with a long tail.
  It enters NO sum and rides its own `HealSourceView.unstatedCount` so the
  crit and overheal rates beside it keep their VALUED denominator; every
  string that would render that 0 prints the reason there isn't one. FIRST
  PERSON ONLY, no invented arms (awaiting-sample law). Law 8 gate: every
  fixture diff was an ADDITION. Full story: docs/agents-archive.md.
- **SPECIAL ATTACKS PRINT NO VERB OF THEIR OWN.** Dragon Punch, Eagle Strike
  and Tiger Claw ALL land as `You strike …`; Round Kick and Flying Kick as
  `You kick …`. The game names the live one exactly once, in two
  first-person-only shapes (`You will now use <X> while auto attacking.` — a
  GRANT, also how a lane RESETS — and `… instead of <Y> …`, an in-lane
  upgrade), so the lane label is STATE, not parsing:
  `combat/specialAttacks.ts` tracks the live special per VERB lane and ingest
  renames the skill. **`Slam instead of Bash` is REFUSED**: Slam never prints
  `slam` and `better at Slam!` does not exist — a documented
  non-distinguishable (law 6), not a guess. SKILL-UPS ARE NOT AN INPUT
  anywhere here (Tiger Claw keeps ticking after it was replaced). Full
  evidence: docs/agents-archive.md.
- Zone: `You have entered X.` — REJECT pseudo-zones ("an area where
  levitation…"). **The zone name is the ONLY thing that ever states a
  difficulty**, so `zoneTier()` decides what every kill's difficulty was,
  and it answers FOUR kinds of thing, not one number in five (JOS-166): a
  trailing `(Awakened|Adaptive|Fused|Refined)` = **d1–d4**; a `- Solo` /
  `- Group N` suffix with no adjective = **d0, the base INSTANCE with a real
  weekly lockout**; a bare zone name = **open world** (`TIER_OPEN_WORLD`, no
  lockout); empty or unknown adjective = **unknown** (`TIER_UNKNOWN`). The
  name is stripped of all three markers; all four are kill-record keys
  (`src/shared/kills.ts`), and only the five difficulties can green a weekly
  ladder rung. Pre-JOS-166 history: docs/agents-archive.md.
- Loot family (sole item-into-inventory lines): dashed
  `--You have looted X from Y's corpse.--`; currency (`…stored it in your
  currency`, NO period); sold (`…sold it for <money|free>.`). Dragon
  Hoard / depot / combine variants exist and are NOT yet parsed.
- AA: gains `…gained N ability point(s)! You now have M` (M = UNSPENT);
  spends in TWO formats (quoted rank-1 / `improved X <rank>`); cost-0 =
  auto-grants; respecs re-log purchases; no refund line exists. The quoted
  form is ALWAYS rank 1 and the improved form NEVER logs below rank 2, so a
  spend line states one rung of a per-ability LADDER — `shared/aaLedger.ts`
  regroups them. Two families that look like AA are NOT parsed, both
  deliberately: the `completed achievement` line restates a milestone the
  gain lines already carry (double-count risk), and `You activate X.` cannot
  distinguish an AA from a disc or a poison — a buffs/combat signal, never an
  AA-usage stat. Sweep: docs/agents-archive.md.
- Class SKILL grants share the AA verb: `You have gained the ability to use
  <Skill>.` (44×, Double Attack / Sneak / Riposte…) has NO cost clause and
  is not an AA purchase. `AA_ABILITY_RE` requires ` at a cost of`, which is
  the whole reason those lines never mint a spend.
- Resists (`resist` event, Task #51 v2): THREE shapes — `<target> resisted
  your <Spell>!` (caster=you), `<target> resisted <caster>'s <Spell>!`
  (caster=name; test YOUR form FIRST — 712 spell names contain `'s`, e.g.
  Denon's), `You resist[ed] <mob>'s <Spell>!` (incoming). Spell keeps rank
  suffix for display, rank-normalized (spellCanonKey) for keys. Full-log
  sweep: 5747 (you 1749 / pet 390-by-name but ~2019 once charmed mobs
  resolve / other-mob 1695 dropped / incoming 1913). Misses: `tries to … but
  misses!` family (miss/dodge/parry/riposte/block/absorb).
- Stances: two mutually exclusive groups — 9 stances (`You assume a/an X
  stance.` — the article conjugates: "an offensive stance") and 9
  invocations (`You begin reciting the X invocation`);
  "begin to change your …" lines are flavor, not state.
- Quick Buff AA: `You activate Quick Buff.` → burst of landing emotes, NO
  cast lines. Permanent Illusion AA (ownership learned from its purchase
  line): illusion self-buffs permanent; ONE illusion per entity;
  `Your illusion fades.` is the shared remover.
  **THE BURST IS ALSO THE ONLY LINE THAT ENUMERATES YOUR GROUP BY NAME**
  (JOS-85): two or more `You healed <X> … by <Spell>.` lines in the SAME
  second — a fact about the ABILITY, not spell target types. It proves
  RECIPIENTS, not membership (bursts hit your own pets and, twice, a
  non-group-mate), so the roster admits a name only in conjunction with
  `You gain party experience!` earlier in the session (measured 2/2 correct,
  0 false positives). Weakest provenance rung (`buffed`); self / charmed /
  claimed-pet names refused. src/main/modules/buffFanOut.ts,
  docs/plans/group-model.md §1 G4; measurements: docs/agents-archive.md.
- Summoned pets have random proper names; they persist across zones (charmed
  pets do not). THREE binding signals, all through one `bindPetClaim`
  (ingest.ts), on purpose — a separate path would be a third retirement seam
  for some model to forget (law 4 is a scar from exactly that):
  - The owner-only tell `<Name> told you, '… Master.'` — **THE TELL ONLY
    FIRES WHEN THE PET IS ORDERED** (JOS-47); a pet engaging on its own
    aggro emits nothing private at all. **THE TELL IS THE WHOLE STORY, AND
    THE BLIND SPOT IS ACCEPTED** (owner, JOS-49): the ask-the-user offer and
    the pet-say nomination rung are DELETED — the answer to "the meter
    doesn't show my pet" is to order it once; an unordered pet is a
    documented, accepted non-distinguishable (law 6). **A TELL BINDS
    FORWARD, NOT BACKWARD** — nothing reaches back over damage already filed
    as nobody's; losing the deleted claim's retroactive path is the real
    cost of the cut.
  - The `/pet who leader` answer `<Name> says, 'My leader is <You>.'`
    (JOS-52) — EXACT sentence, never a `/leader/` pattern (the six-says
    rule). **THE LEADER'S NAME IS THE WHOLE GUARD** (compared to
    `ParserConfig.characterName`, session-injected) because the say is
    BROADCAST and forgeable — stated, costed, accepted. It parses to the
    SAME canonical `petClaim` event as the tell (`via: 'tell' | 'leader'`),
    so succession/idempotence/promotion are shared code.
  - **YOUR OWN PET-ONLY BUFF NAMES IT WITHOUT ASKING** (JOS-188): an own
    cast of a `targetType: Pet` spell (charmModel.ts `PET_TARGET_SPELLS`)
    ARMS the charm model and the named `buffApply` landing binds the pet.
    **THE MESSAGE IS NOT THE GATE, THE ARMED OWN CAST IS** — the landing's
    candidates must contain the spell being cast, and the arm is CONSUMED on
    a hit (a Quick Buff burst can never bind off one cast). This fixes the
    UPGRADED pet: a new name means succession triggers on the successor's
    claim, and an unordered successor had none.
  **AND THE APP NOW SAYS SO, ONCE, AND THEN STOPS** (JOS-258, owner ruling
  2026-08-12 — option (a), explicitly NOT a reopening of JOS-49). The blind
  spot is still accepted; what changed is that the meter no longer stays
  silent about it. `combat/petNudge.ts` arms on the player's own pet-summon
  cast (`spellEffectClass.ts`'s derived `summonPet` class — 104 effect rows
  against the 83 `spellType: Pet` files, the gap being the magician's
  Vocarates and the necro's three differently-spelled pets; `Call Pet` is
  excluded, it moves a pet rather than making one) and the overlay meter
  draws ONE sentence on its content background: *Pet summoned - order it
  once or type /pet who leader so the meter can see it.* **STALENESS AND
  REPETITION ARE THE FAILURE MODES, so the whole feature is a timeout**:
  a 10s GRACE (the p2 fixture measures the summon→tell fast path at SIX
  seconds — a nudge drawn and yanked teaches nobody anything), a 45s SHOW,
  and a 5m QUIET after one is ignored. ONE SLOT, so chain-summoning cannot
  stack nudges; cleared by any `bindPetClaim` (all three routes, one seam),
  by a fizzle/interrupt, or by its own clock — swept from the event stream
  AND from `snapshot(now)`, the `sweepCharm` pattern. Armed only when
  `hydrating` is false. **IT COACHES, IT NEVER ADOPTS** — the unbound pet's
  damage is still dropped at routing while the sentence is up, and
  `tests/petSummonNudge.test.mts` asserts exactly that beside the timings.
  The renderer holds NO dismiss state: the snapshot's `petNudge` is absent
  in every state but the one, which is what makes "no persistent banner"
  structural rather than a promise.
  A pet-claim tell from a name EVER seen charmed re-arms the charmed set,
  never the permanent one (`everCharmed`). STILL NOT CLOSED, named: a pet
  its owner neither buffs nor orders stays invisible (order it once), and
  `modules/buffs.ts`'s entity-level succession still waits for the tell —
  closing that needs a derived-event seam feeding both models, never a
  second arm in buffs.ts. Goldens: `p2-pet-arc-bound.log`,
  `p3-pet-upgraded-buff-bound.log`, petBuffBind/petClaimWindows tests. Full
  measurements: docs/agents-archive.md.
- Exp: `You gain (party )?experience!( (N.NN%))?` — the percent is an
  INCREMENT of the current level bar (sums to ~100 between dings);
  unstated ⇒ at the cap, modeled `pct: undefined` never 0. The exp line
  PRECEDES its kill line, same second (4,887/4,909) — joins consume the
  pending exp line at the next credited kill, never search forward.
- Self `/who` row (keyed on the tailed character's name via
  `ParserConfig.characterName`, never a constant) states the loadout;
  skill-ups `You have become better at <Skill>! (n)`; Wiki skill names ≠
  client skill names (`1 Hand Slashing` vs `1H Slashing`) — classes.json
  carries the alias table measured from the log.
- **`Your <item> shimmers briefly.` / `feels alive with power.` IS A WORN
  FOCUS TALKING, NOT AN ITEM CASTING** (JOS-79, measured whole-log — this
  entry previously said the opposite and it was wrong). All five items that
  print it are focus items; the combo rule that dropped a `castBegin` within
  2.5 s of one was discarding 44.2% of own casts and EVERY wizard observation
  in the log. The rule is gone; the event stays (it keeps 7,921 lines out of
  `unknown`) and says nothing about class in either direction. A
  self-announcing clicky needs its own observed sample before any rule acts
  on one. Measurements: docs/agents-archive.md.
- Feign death has NO failure line (1.14M lines: only the success emote).
  An alert cannot fire on the absence of a line — the group ships hidden.
- **A TELL'S TENSE SAYS WHETHER A PERSON SENT IT** (JOS-69, measured
  whole-log): present tense (`tells you`) is a player, past tense (`told
  you`) is the game — that is the whole discriminator, and CAPITALIZATION IS
  NOT ONE (a charmed pet reads `A gorgon told you, …`). There is NO parsed
  tell event and no golden can carry one (the scrub drops all quoted
  speech), hence the `tells` alert group is a RAW trigger
  (`\] .+ tells you, '`) and its unit test constructs the sentence.
  Measurements: docs/agents-archive.md.
- **SLOWS ARE A ROSTER, NOT A NAME** (JOS-69). A slow wearing off a mob is
  the ordinary named-target `buffFade`, so the SPELL is the matcher and it
  has to be the whole family — a slow is the spell you replace as you level.
  spells.json enumerates it by landing emote (`Someone slows down.` = the
  enchanter ladder, `Someone yawns.` = the shaman one; NPC-only members
  excluded). The ON-YOU side is two shared messages that resolve to all-slow
  candidate lists, so the alert reports the family, never which one. Its
  tripwire is one word away: `Your speed returns to normal.` is NINE HASTES
  (law 3).
  **AND THE ROSTER HAS TWO SIDES NOW, BECAUSE ONE MEMBER CANNOT SAFELY BE ON BOTH**
  (JOS-233, owner ruling 2026-08-12): the bard binding pair (Largo's
  Melodic/Assonant Binding) joined the MOB side only — `The strands fade
  away.` is shared VERBATIM with a beneficial buff, and a `where.spell`
  matcher tests the whole candidate list (JOS-84), so one shared roster would
  announce a slow every time that buff lapsed; anchoring cannot fix identical
  sentences, only the split roster can. The wider binding line is EXPLICITLY
  UNRULED and stays silent; the table is in tests/charmCcRoster.test.mts.
  Full story: docs/agents-archive.md.
- **CHARM AND MEZ ARE ROSTERS TOO — AND THE SPELL DB IS THE ORACLE** (JOS-84).
  `Your <spell> spell has worn off of <mob>.` is ONE sentence for three
  facts; `rulesets.ts` matches the spell NAME: `charmSpell` ⇒ `uncharm`,
  `ccSpell` ⇒ `cc {refresh:true}`, neither ⇒ an ordinary `buffFade`. The
  rosters are enumerable from spells.json's landing-message families, and
  `tests/charmCcRoster.test.mts` RE-DERIVES both families every run — a
  future scrape that adds a member fails the suite instead of going mute.
  **A MESSAGE FAMILY IS NOT AN EFFECT FAMILY — THE ORACLE HAS BEEN WRONG IN
  BOTH DIRECTIONS**: Solon's Bewitching Bravura read as a mez off its shared
  landing family and is really the bard's level-39 CHARM (JOS-200); both
  Largo's binding songs left `ccSpell` entirely (JOS-225) — movement debuffs
  whose wear-off was firing "Mez / root broke" at a bard, settled by the log
  (the target trades melee blows through the song; `awakened` accompanies 0
  of 81 Largo's wear-offs against 67-86% for every genuine mez). Both
  reversals live as EVIDENCE-CARRYING TABLES in tests/charmCcRoster.test.mts
  (`FAMILY_EXCEPTIONS`, `NOT_A_HOLD`) precisely so the next scrape cannot
  sweep them back in; adding a row is a claim about what the game DOES,
  backed by log lines — never a way to quiet a noisy alert.
  **AND "NOT A HOLD" IS NOT "NOT AN ALERT"** (JOS-233): the SLOW group's
  mob-side roster claims both Largo's by name, and `NOT_A_HOLD` carries a
  `fires` column so a row states which group it ends up in and cannot drift
  silently between the two. Full story: docs/agents-archive.md.
- **THE CALM LINE IS A ROSTER TOO — AND ROUTING OBEYS RULING 8 (JOS-213).**
  Calm spells are Beneficial, so their timer landed in the player's BUFF
  overlay — while the thing they watch is a mob-state timer. The fix is a
  SECOND, orthogonal fact about the SPELL (`ActiveBuff.calmsTarget`,
  `spellCalmsTarget`, derived from the three landing families and re-derived
  by an oracle every run, exactly like `ccSpell`); `cls` does NOT change.
  **THE CUT THAT FAILED IS THE LESSON**: routing on "the TARGET is a mob"
  reruns the error JOS-136/JOS-140 ruling 8 outlawed
  (`disposition: 'hostile'` means only "not you and not a pet I am currently
  holding") — two committed goldens rejected it on the spot. Nature — and now
  surface — comes from the spell, never from the shape of the target.
  Fixtures `w64`/`w65` (`npm run fixtures:calm`), pinned in
  `tests/calmLineTimers.test.mts`; a pacified mob CAN be killed and takes the
  ordinary decrement-one death censor, never JOS-228's mez refusal. Full
  story: docs/agents-archive.md.
- **THE FRIEND SYSTEM ANNOUNCES NOTHING** (JOS-69): only the `/friends`
  roster print and the `<name> is now your friend.` confirmation exist — no
  login line, no logout line — so "a friend came online" is knowable only by
  polling, and the group ships hidden beside feign-death and pet-death.
  Sweep: docs/agents-archive.md.
- Motes (the Item Upgrade System's currency) arrive ONLY inside ordinary loot
  lines, which already parse to `loot { item, source }`; every one the items
  catalog knows is `Mote of <tier> Potential` (10 tiers, 7 seen: Infinitesimal
  220, Minor 31, Lesser 16, Major 8, Potential 7, Greater 2, Superior 1). Nothing
  anywhere RANKS the tiers, so a per-tier loot filter would be an invented fact.
- `LogEvent.raw` INCLUDES the `[timestamp] ` prefix: a `^`-anchored raw
  alert regex silently never matches — anchor on `\] ` (tripwire test).
- WorldModel labels append a spawn-generation ` (N)` suffix that appears
  in NO log line (law 2) — `mobKey` strips it.

## Data sources

- **Scraper etiquette (LAW)**: every scraping script must run at a
  respectful rate limit (delay between requests), honor backoffs
  (429/5xx → exponential retry, obey Retry-After), and be re-runnable +
  idempotent (cache hits skip the network; partial runs resume, never
  duplicate output). Applies to scripts/scrape-*, itemLookup, and any
  future fetcher.

- eqlwiki.com MediaWiki API (helper: `scripts/sources/eqlegends.ts`).
  Scrapers (output committed): `scrape:posky` (quest-item cells: iterate
  `<li>` items — `<br>`-splitting once dropped trailing unhinted items),
  `scrape:bosses` (curated list incl. efreeti spawn-chain "Other:" bosses),
  `scrape:spells`, `gen:message-overlay`, `gen:icon`.
- Item knowledge: `itemLookup.ts` — local-first (posky) → wiki
  `{{Itempage}}` (`statsblock` flags / `relatedquests` / `notes`), userData
  cache with negative caching, live-loot background prefetch.
- **THE WIKI ART SHIPS IN THE BOX, AND THE FETCH IS THE FALLBACK** (JOS-198,
  `src/main/bundledImages.ts` + `resources/wiki-images/`): every distinct
  item iconId + all 29 boss portraits (780 files, 3.75 MB), COMMITTED — a
  build-time fetch would make `npm run dist` depend on two volunteer wikis'
  uptime. `npm run fetch:images` regenerates them + `manifest.json` (upstream
  URL, byte length, sha256 per file). Files are named by the cache's OWN
  `cacheFileName()`, so the bundle and `<userData>/image-cache` are ONE
  namespace that cannot drift; `bundledImageRoots` probes the dir's three
  addresses (dev/e2e, `app.asar`, `app.asar.unpacked`) in order.
  electron-builder names `resources/wiki-images/**` EXPLICITLY, never
  `resources/**` (gitignored soundpacks sit beside it). A source build
  without images is a SUPPORTED state that falls back to the runtime cache.
  `tests/bundledImages.test.mts` holds the manifest against both data files
  and re-hashes all 780; the e2e proof is `bosses-week.e2e.mts` on a cold
  userData with no network. CREDIT IS PART OF THE FEATURE: Preferences →
  Thanks, README and the 0.19.0 note name both wikis. Full story:
  docs/agents-archive.md.
- **Downloaded images are cached PERMANENTLY** (`src/main/imageCache.ts`): no
  image the app fetches may ever be fetched twice — and since JOS-198 a
  normal install fetches NONE. Item icons serve from `eqimg://item/<id>` (a
  `protocol.handle` on the DEFAULT session — one handler covers every
  window); a miss is ONE polite fetch (shared UA, in-flight dedupe), written
  ATOMICALLY and only if the bytes sniff as an image. NEGATIVES ARE NEVER
  CACHED **ON DISK** — but a refusal IS remembered IN MEMORY for the
  session, and only when the HOST SPOKE; a NETWORK failure is DELIBERATELY
  NOT remembered (a just-woken laptop must not be locked out of every icon).
  On disk: no TTL, no eviction — wiki file ids are immutable. A second
  route, `eqimg://url/<encoded>`, covers absolute URLs (the boss portraits;
  wrapping happens at render via `cachedImageUrl()`); its boundary is a
  STRICT host allowlist — exact `new URL().hostname` equality, https only;
  never substring/endsWith (`wiki.project1999.com.evil.com` must fail).
  Entry name = `url-<sha256[0:24]>.<sniffed ext>` (the URL lies about
  extensions). **`img-src` does NOT list `https:`** (exactly
  `'self' data: eqimg:`): that is what makes "every downloaded image is
  cached" structurally true — widening the CSP is never the fix; wrap the
  URL through the `url` route. Full story: docs/agents-archive.md.
- Sound packs: og-packs registry (peonping.github.io/registry) —
  browse/install ~350 packs in-app. The single shipped default
  (`alan-rickman`, pinned tag) is GITIGNORED audio, self-provisioned via the
  same installPack path (additive, retried with backoff). The synthesized
  `default` chime pack is DELETED; alerts pointing at any retired pack are
  rewritten onto the analogous alan-rickman line by a ONE-TIME,
  version-stamped store migration (`migrateAlertSounds`), so an upgrading
  user's alerts never go silently mute. Every picker pre-selects
  alan-rickman (`fallbackPack`), never `packs[0]`.
- **BRING YOUR OWN SOUND (JOS-68): `my-sounds` is a RESERVED pack with its own
  ROOT.** The user's imports live in `<userData>/my-sounds/` (the ordinary
  pack shape), NOT under `soundpacks/` — the sibling root makes a registry
  collision UNREPRESENTABLE rather than unlikely (`packDir()` resolves the
  reserved id FIRST, `installPack` refuses the name). **The file is COPIED,
  and the id BECOMES the filename** (`userSoundId()`: lowercase slug, capped,
  de-duped), so a moved original can never mute an alert and no byte of
  user-supplied path text reaches `join()`. The picker is
  `dialog.showOpenDialog` in MAIN — no absolute path crosses IPC in either
  direction; serving goes through the same `sounds:getData` + `isSafePackId`
  door as every pack, never a second one. **A missing custom sound is NOT
  silence** (falls back to the shipped default's line). Removal WARNS by
  naming the alerts that play it and leaves their defs ALONE. Identity /
  formats / the 25 MB cap: `shared/userSounds.ts`; the file work takes its
  ROOT as an argument (tests/userSounds.test.mts drives real copies in a
  temp dir). Full story: docs/agents-archive.md.

## UI conventions

- **NO EM DASHES IN USER-FACING COPY (owner, 2026-08-08 — JOS-106).** Every
  string a player can read uses a NORMAL dash with spaces (` - `), never
  U+2014 (—) or U+2013 (–) — renderer strings, overlay text, tooltips,
  preferences captions, empty states, alert/group copy, and
  `shared/releaseNotes.ts` (historical entries render in the What's-new
  panel, so they are copy too, not an archive). Where a dash reads badly,
  RESTRUCTURE instead of substituting. The GLYPH AS A DATA PLACEHOLDER is
  held to the same rule (`-`, or a short label — `UNSTATED_AMOUNT`). This is
  about COPY, not the tree: code comments and this file's prose keep their em
  dashes. `tests/copyNoEmDash.test.mts` is the guard; its header states
  exactly what it covers, and its two technical exclusions are listed in the
  test.
- **SAY WHAT THE LOG DID, NOT WHAT WE DID TO THE NUMBER (JOS-106).** A label
  describing our own bookkeeping reads as a defect to the person holding it —
  Mend's by-design `unvalued` tag was filed as a BUG inside a day. It is now
  `no amount`: one plain phrase, single-sourced from `UNSTATED_AMOUNT`
  (healRows.ts) so the panel/overlay/hover cannot drift, said ONCE per row;
  the long form stays in the hover title, never a caption.
- **State, never process**: no methodology captions, no script references,
  no how-it-works panels. Chips convey state (db/observed, permanent,
  inferred, casting…, ~ambiguous).
- **TOOLTIP AND CAVEAT DIET (owner, 2026-08-05).** The UI does the talking;
  player experience fills the rest. Tooltips are for enabling an action or
  naming a control — one clause, no caveats, never on an input the user types
  into. Do not footnote where a number came from or how it might be wrong;
  when stated-vs-inferred genuinely matters, one word ('est.', the existing
  chips) beats a sentence. TEACHING is welcome when it is collaborative —
  a dismissible explainer that helps someone use a feature successfully (the
  planner's exaltation card is the model) — never defensive source-caveating.
  When in doubt: delete the tooltip and let the label earn its keep.
- **BACK MEANS WHERE YOU CAME FROM, and there is ONE mechanism for it**
  (JOS-43). Every cross-view link funnels through the `useAppRouting`
  openers, so the navigation-origin STACK lives at that seam (`navOrigin.ts`
  + `useNavSeam`). An ANCHORED link parks the tab it leaves; a BARE opener,
  MANUAL navigation, or a NATIVE drill clears. NEVER add a per-view
  `cameFrom` prop: five of those are five opinions about what Back means. A
  back affordance NAMES ITS DESTINATION. Session-lifetime only.
  **AND THE MOUSE'S BACK BUTTON PRESSES THE AFFORDANCE THAT IS ON SCREEN**
  (JOS-201): `backTargets.ts` — the innermost REGISTERED affordance wins,
  `nav.back()` is the fallback slot, and each drill registers *the same
  expression its own button runs* (`useBackTarget`). The input is a
  BrowserWindow `app-command` listener on the MAIN window only, gated on
  focus — no globalShortcut, no mouse hook, nothing while EverQuest is
  foreground; `browser-forward` is deliberately unhandled. (Chromium handles
  the physical X-button in the browser process — a DOM listener would not
  work.) Full story: docs/agents-archive.md.
- **A VIEW UNMOUNTS ON EVERY TAB SWITCH, so `useState` in one is a promise you
  cannot keep** (JOS-90, JOS-97, JOS-116 — the same bug three times).
  Anything the user set on purpose goes in a renderer pref (`eq.<feature>.*`
  in localStorage, the `useCombatPrefs` idiom) or above the switch boundary.
  Two traps, both paid for: **an effect cannot tell a click from a mount** —
  the reset belongs on the CHANGE HANDLER; and a stored value must DEGRADE
  rather than error (JOS-105). Prove it with a spec that actually navigates
  and asserts the view was GONE first (sky-filters is the template); a unit
  test of the read passes while the feature stays broken.
- Search: input echoes instantly; filter on `useDeferredValue`; lowercase
  `searchKey` computed once per data change; long fixed-height lists
  windowed via `lib/useWindowedRows`, variable-height cap+paginate. These
  surfaces are RENDER-bound (<1ms compute) — no workers/DBs.
- Formatting: rates `21.7k dps` / `2.3M dps` (word 'dps' after number, k/M
  scaling); totals keep k/M with NO unit word. ONE source: `lib/formatRate`
  (`formatRate`/`formatNum`) — every meter/overlay/drill-down/tooltip uses it,
  NO `/s` anywhere (Task #54 sweep). Dates/times through `lib/formatDate`
  (user-local; never UTC or epoch-day math). Tier chips via `lib/tierChip`
  (dark fg on tier bg, WCAG AA).
- **A growing list lives in a FIXED-height scroll box.** The combat log was
  `flex: 0 0 auto` + `minHeight`, so it sized to its 150-line content, couldn't
  shrink, and squeezed the whole dashboard to 0px (the tab read as "just a
  scrolling combat log"; the app's content area is `overflow:auto`, so
  `height:100%` clamps nothing). Any append-only panel gets an explicit height +
  its own `overflow:auto`; the panel that must survive gets `flexGrow:1` +
  `minHeight:0`. Verified by the headless e2e harness, which measures it.
- **Hydration is a state, and the UI must show it.** During the startup replay
  every snapshot describes the PAST (an hours-old fight is `current`).
  `CombatSnapshot.hydrating` (engine: true until `setLive()`) gates a quiet
  "Reading log…" placeholder in CombatView + the overlay meter — never a
  churning fake-live meter. Task #56.
- **Fight vs Overall is an explicit SCOPE, never an automatic switch.** A
  `Fight | Overall` toggle (sibling of Dashboard/Timeline, Outgoing/Incoming;
  persisted `eq.combat.scope`) drives one filter — `scopeOptions()` in
  dashboardData.ts, shared by the main view AND every overlay kind, so a fight
  meter can never show zone data. Fight scope keeps the LAST fight on screen
  between pulls (auto-swapping to the zone aggregate was rejected: it moved the
  ground under you mid-session) but LABELS it honestly — head row reads
  "Current fight (live)" only while a pull is open, else "Last fight — <name>",
  and a locked overlay (no selector) tags its header `· LAST`. The head row's
  VALUE stays the `__live__` sentinel so it re-resolves each tick. No fights at
  all ⇒ quiet empty state, never borrowed zone data. `liveFallback` is GONE.
- Celebrations (confetti/sound) fire EXACTLY ONCE PER LIVE TRANSITION;
  hydration seeds a silent baseline; manual actions never celebrate.
  **THE SILENT BASELINE ONLY HOLDS IF A SWITCH DELIVERS A SNAPSHOT AND NEVER
  A DELTA** (JOS-60): one pre-`log:character` delta carrying the incoming
  character's history is read as news and celebrates all of it — never fix
  this class of bug with a wall-clock suppression window; the cause is a
  delta that should not exist, and the cure is not sending it. "Once per
  transition", never "once ever": a REPEAT boss kill is a transition (owner:
  "every time is worth celebrating"); rate limiting belongs to the alert's
  own cooldown. And EVERY kill means every kill CREDITED TO YOU (owner): the
  credit test is the log's own exp line joined to the slain line
  (`KillTierRun.credited`, `KILL_EXP_JOIN_MS`) — a group-mate's blow counts
  (party exp is exp), a passer-by's does not; `bossKills` still counts every
  defeat, credit gates celebration alone. Full story: docs/agents-archive.md.

- **TWO TEXT SIZES, AND THEY ARE DIFFERENT MECHANISMS ON PURPOSE (JOS-123).**
  The MAIN window scales with an Electron ZOOM FACTOR (`shared/uiScale.ts`:
  the five-stop ladder + a normalizer that SNAPS to it; persisted top-level
  `uiScale`, absent reads as 1 so an upgrade resizes nobody; applied at
  window CONSTRUCTION, and the IPC setter zooms the live window in the same
  call it stores). The OVERLAYS keep their own per-kind `textScale`, a CSS
  `zoom` on the CONTENT PANE only (chrome unscaled, overlayScale.tsx) — an
  overlay's header/footer must keep laying out against the real window
  width — and the two must not be merged: the main window is never given a
  `textScale`, no overlay window a `zoomFactor`. `tests/uiScale.test.mts`
  pins both halves; `text-size.e2e.mts` proves it over two real launches.
  The accessors live in `src/main/uiScale.ts` because store.ts is AT the
  400-line ceiling — a door for moving reads out, never a licence to skip a
  normalizer.

- **A COLOUR A USER PICKS IS A VALUE THAT REACHES A STYLE PROPERTY (JOS-125).**
  `normalizeRingColor` accepts `#rgb` / `#rrggbb` AND NOTHING ELSE — the
  value ends up in `element.style.borderColor`, so `red`, `rgb()`, `var(--x)`
  and anything carrying a `;` are refused (costs nothing:
  `<input type="color">` cannot produce them; buys: a store file can never
  write a CSS declaration). ONE function turns the hex into the drawn colour
  (`ringStrokeColor`), read by all three drawings and pinned by
  `tests/cursorRingColor.test.mts` so they cannot drift. The alpha and
  shadows are NOT settings — a player asking for a colour is not asking for
  less contrast. Default white exactly, so an upgrade recolours nobody.

## Shipping

- CI (`.github/workflows/build.yml`) runs `npm test` — the FULL
  golden-window suite (fixtures are committed; only full-log tests skip
  there). **Publish on tags ONLY** (reworked 2026-08-03; the per-push
  prerelease spam is gone): push to main → typecheck/test/build, installer
  as CI artifact, nothing published; tag `v*` → the one publish path, with
  the version STAMPED FROM THE TAG in CI (package.json never carries it).
  Release process: `git tag vX.Y.Z && git push origin vX.Y.Z`.
- **A TAG MAY NOT SHIP WITHOUT RELEASE NOTES** (JOS-73).
  `src/shared/releaseNotes.ts` is committed source read by the What's-new
  panel, so a missing entry is not a crash, it is SILENCE. The tag job runs
  `scripts/check-release-notes.mjs`, which refuses a tag with no entry
  (same shape check as `tests/releaseNotes.test.mts`). Write the entry
  BEFORE tagging. **WHO WRITES IT: THE INTEGRATOR, AT RELEASE CUT (owner
  rule 2026-08-10).** Notes are a release-driven activity; worker branches
  never touch `releaseNotes.ts` — the integrator drafts the whole entry from
  the release's merged tickets when the tag is cut. Full story:
  docs/agents-archive.md.
- **RELEASE CADENCE: tag only when the user asks, or at a clearly STABLE
  point** — features verified end-to-end, the gauntlet green, no waves in
  flight. Commits land on main continuously; a tag is a deliberate act,
  never an automatic one and never mid-wave. When in doubt, don't tag —
  the next stable point is never far.
- **main.yml BRIDGE (do not remove)**: every install to date polls the
  'main' channel feed, and a stable release natively writes only latest.yml,
  so the tag job uploads a copy as main.yml on the same release — old
  main-channel installs step up to stables instead of stalling forever.
  Azure Trusted Signing wiring is inert until 6 `AZURE_*` repo secrets
  exist (account `jmoyers-eqtools`, deliberately not renamed).
- **`npm ci` DOES NOT INSTALL ELECTRON'S BINARY ANY MORE.** `.npmrc` sets
  `ignore-scripts=true` (no dependency's install hook executes — the npm
  compromise vector), so after any `npm ci` / `npm install` you MUST run
  `npm run deps:electron` or dev/dist fails. Electron is the ONE package
  needing its hook; both CI jobs run it as an explicit step. Explicit
  `npm run <x>` is unaffected; only lifecycle hooks are.
- **build.yml is TWO JOBS and that is a security boundary**: `build` (non-tag
  refs, `contents: read`) and `release` (tag refs, `contents: write`). Token
  permissions are per-job and static, so one job covering both paths had to
  hold write on every push to main. Keep the two preludes in sync; never
  merge them back into one job. All `uses:` are pinned to commit SHAs (a
  `@v4` tag is mutable) — re-resolve with
  `gh api repos/<o>/<a>/git/ref/tags/<t> --jq .object.sha` when bumping.
  Tagged releases also publish `SHA256SUMS.txt` alongside the installer.
- **Unsigned build ⇒ the GitHub account IS the trust root.** electron-updater
  verifies the sha512 from the feed (so a tampered *download* fails), but with
  no Authenticode publisher it cannot verify *who* built the release. Anyone
  who can publish a release here can ship a silent, per-user, no-UAC update to
  every install. Azure signing closes this (`verifyUpdateCodeSignature` turns
  on for signed Windows builds); until then, tag/release access is the control.
  See `SECURITY.md`, which states this plainly to users.
### Installer architecture

- Build chain: `npm run dist` = `electron-vite build` → electron-builder
  NSIS (`electron-builder.yml`). **Per-user install is load-bearing**:
  `oneClick:true, perMachine:false` installs to `%LOCALAPPDATA%\Programs`
  with NO UAC ever — which is what lets electron-updater silently
  self-install and relaunch (the Discord model). Never flip perMachine.
- **Windows 10+ gate** (`customInit` in `build/installer.nsh`, JOS-32):
  `${IfNot} ${AtLeastWin10}` → one-sentence MessageBox + `Quit` (Electron
  dropped Win7/8 at v23). `customInit`, NOT `preInit` — preInit would also
  gate the uninstaller-writing pass and the uninstaller itself. **The version
  lie is the trap**: `GetVersionEx` reports 6.2 to an unmanifested process,
  and only NSIS 3's default `ManifestSupportedOS` lets the truth through —
  VERIFIED by compiling a probe; re-run it if electron-builder ever sets
  ManifestSupportedOS. `/SD IDOK` so a `/S` run refuses without blocking.
  Full story: docs/agents-archive.md.
- **Add/Remove Programs**: the entry lives at
  `HKCU\...\CurrentVersion\Uninstall\<UUIDv5(appId)>` — keyed by GUID, so
  grep by DisplayName. app-builder-lib writes it unconditionally but puts
  InstallLocation only in `HKCU\Software\<guid>`, so `customInstall` in
  `build/installer.nsh` mirrors it. That file is included at the TOP of the
  generated .nsi, BEFORE multiUser.nsh defines `UNINSTALL_REGISTRY_KEY` —
  spell the path from `UNINSTALL_APP_KEY` (a `-D` define, always present);
  the not-yet-defined one compiles fine and dies instantly with 0xC0000005.
  Full story: docs/agents-archive.md.
- **An installed app with files but NO uninstall entry is a RACE, not a build
  bug.** The uninstaller does `RMDir /r $INSTDIR` first and `DeleteRegKey` LAST,
  and an NSIS uninstaller launched without `_?=` relaunches itself from %TEMP%
  and the process you waited on exits IMMEDIATELY. So tier-1's
  `Uninstall*.exe /S` + an immediate reinstall lets the detached tail delete the
  keys the reinstall just wrote. Never reinstall after an uninstall without
  POLLING for the install dir and the uninstall key to disappear.
- **Uninstall asks before discarding user data.** `deleteAppDataOnUninstall`
  stays `false`; the ONLY deletion path is `customUnInstall` in
  `build/installer.nsh`, which prompts "Keep your settings and history?"
  (Yes = default = keep) and only on No does `RMDir /r "$APPDATA\everquest-companion"`.
  A `/S` uninstall NEVER prompts and ALWAYS preserves — that is the contract the
  sandbox harness and every scripted uninstall rely on. It must never widen to
  `%APPDATA%\eq-tools` (the pre-rename backup the one-time seed reads) or
  `%APPDATA%\everquest-companion-dev` (the running dev app). Gotcha: `${Silent}`
  is USELESS for that test — oneClick's `un.onInit` calls `SetSilent silent`
  after its own confirm dialog, so the section always sees silent; detect the real
  `/S` from `${GetParameters}`/`${GetOptions}` instead.
- Exe branding: `signAndEditExecutable:true` needs the winCodeSign cache —
  run `scripts/seed-wincodesign.ps1` once per machine. Icon via `gen:icon`.
- Publish: `publish: github jmoyers/everquest-companion`; installer +
  `.blockmap` + `latest*.yml` feeds under `release/<version>/`. Unsigned for
  now (SmartScreen "More info → Run anyway" in README); Azure signing turns
  on via repo secrets only — CI args are already conditional.
- Auto-update: electron-updater in `src/main/updater.ts` — channel from
  store; check at +10s then 30min; toast → quitAndInstall; dev-guarded on
  `app.isPackaged` EXCEPT channel IPC (settings UI needs it in dev).
- First-run self-sufficiency: the default sound pack self-provisions from
  its pinned registry tag; spell DB/overlay baseline inlined in the main
  bundle; EQ dir resolves via env → registry → drive-sweep with the
  Settings-gear override; zero logs anywhere → quiet empty state, never an
  error. Full detail: docs/agents-archive.md.
- **DISCOVERY SPAWNS NOTHING, AND THAT IS AN AV DECISION AS MUCH AS A SPEED ONE
  (JOS-184).** `src/main/log/discovery.ts` used to shell out (eight `reg.exe`
  queries + `wmic`); both reads now go in-process through `native-reg`
  (~150 ms of blocked main thread → ~6 ms, and no "unsigned exe sweeps the
  uninstall registry seconds after install" heuristic signature). Two
  invariants pinned by `tests/eqDiscovery.test.mts`: `eqInstallPathValue`
  reproduces the OLD command's contract exactly (a DATA match, verified
  against real reg.exe behaviour, not the docs), and `fixedDrives` reads
  `HKLM\SYSTEM\MountedDevices` (mapped NETWORK drives are never there — the
  property that keeps the offline-share hang fixed; removable local volumes
  are a harmless superset). `native-reg` over registry-js because it ships
  its N-API prebuild INSIDE the tarball (`.npmrc`'s `ignore-scripts=true` is
  load-bearing); it is `require`d LAZILY and its failure swallowed — a bad
  `.node` must cost one of three discovery paths, not the launch. Full
  story: docs/agents-archive.md.

### Product identity + channel isolation (Task #58)

- ONE name everywhere: `everquest-companion` (package name, appId, installer,
  install dir, store file, log prefixes, scraper UAs); the DISPLAY name
  stays "EQ Legends Companion". `eq-tools` survives ONLY as the
  legacy-migration source. NSIS install dir + updater cache derive from
  package.json `name`, NOT productName. Full inventory:
  docs/agents-archive.md.
- Channels are decided in `src/main/channel.ts`, the FIRST import of
  index.ts (it must run before electron-store is constructed at module
  scope). Nothing else in the tree hardcodes a userData path — soundpacks,
  errors.log, item/registry caches and the learned overlay all resolve
  through `app.getPath('userData')`, so redirecting the root redirects
  everything:

  | channel | when             | userData                                   |
  | ------- | ---------------- | ------------------------------------------ |
  | prod    | `app.isPackaged` | `%APPDATA%\everquest-companion`            |
  | dev     | not packaged     | `%APPDATA%\everquest-companion-dev`        |
  | e2e     | `EQ_E2E=1`       | temp dir (`EQ_E2E_USER_DATA` or `mkdtemp`) |

- Separate dirs ⇒ separate single-instance locks (Chromium keys
  ProcessSingleton off the user-data dir), so the installed app and the dev
  app genuinely run at the same time — verified with two Electron processes
  that both won `requestSingleInstanceLock()` on different dirs and where
  the second lost on a shared dir. Never "fix" a second instance quitting by
  weakening the lock; check the channel first.
- ONE-TIME SEED (prod + dev, never e2e): if the channel's dir does not exist
  and `%APPDATA%\eq-tools` does, an allowlist is COPIED and a
  `migrated-from.json` stamp written; Chromium caches / lockfile / errors.log
  deliberately skipped; the old dir is never modified — it's the backup.
  Guard is "target dir absent" so it can't run twice; failures log and
  startup continues. **UPDATE CONTINUITY BREAK (conscious)**: the rename
  means per-user NSIS sees a NEW app — an old `eq-tools` install never
  chain-updates; the user uninstalls once and state carries via the seed
  (documented in README). Allowlist + detail: docs/agents-archive.md.

### Settings migrations (persisted store schema)

- **LAW: any commit that changes a persisted shape ships a migration in the
  SAME commit.** Bump `CURRENT_SCHEMA_VERSION` in
  `src/main/storeMigrations.ts`, append a step to `MIGRATIONS`, add a fixture.
  That rule is the whole reason "an upgrade is clean, going back indefinitely"
  can be true: a store written by ANY past build must load in today's build,
  and auto-update means users jump many versions at once. `MIGRATIONS` is
  APPEND-ONLY — never renumber, edit a shipped step, or delete one.
- An explicit integer `schemaVersion` INSIDE the file, not app semver: CI
  stamps versions from tags and dev runs unstamped, so electron-store's
  semver-keyed `migrations` fire in surprising orders across channels. Absent
  ⇒ 1 (every pre-framework store), and the chain runs 1→2→…→CURRENT.
- Runs ONCE at startup from store.ts module scope, BEFORE `new Store()`, so no
  reader ever sees a pre-migration shape — and after channel.ts's one-time
  `eq-tools` seed (store.ts imports channel.ts first). Ad-hoc fixups in read
  paths are the anti-pattern it replaces: the flat `overlay` →
  `overlays.fight` fold moved out of `getOverlayConfig()` into migration 1→2.
  (`alertSoundMigration` predates the framework and keeps its own stamp — its
  "respect a user who re-points an alert" semantics aren't schema-shaped.)
- Migration 1→2 is REAL work, not a dormant no-op: it also recovers the
  top-level `progress` blob that commit 41831cc orphaned when it re-keyed
  progress by character (salvaged under the reserved id
  `legacy:pre-character` only when no real character exists — never guess an
  owner) and drops the dead `liveLoot` map.
- **Startup never dies here.** Unreadable ⇒ untouched, unstamped. Unparseable
  ⇒ QUARANTINED to `<name>.corrupt.json` and start fresh (conf leaves
  `clearInvalidConfig` false, so one truncated write otherwise throws on every
  read forever). A step that throws ⇒ keep what succeeded, stamp the last
  version that fully landed, retry next launch. Before the first write the
  original bytes are copied to `<name>.v<from>.backup.json`, once per source
  version (a later run never overwrites the pristine copy).
- **Downgrade (file newer than the build)**: log, back up, and leave the file
  ALONE — no down-migration, no reset, no stamping backwards. The old build
  runs best-effort, which is safe because every reader defaults on a missing
  key and electron-store rewrites the whole parsed object, so future keys
  survive round-trips. Verified by `tests/storeMigrations.test.mts`, which
  drives the pure runner + the file half with authored fixtures of the real
  historical shapes (no Electron, never skips).

### Installer testing strategy (three tiers)

1. **Local self-test** (any dev machine, no elevation): Setup exe `/S` →
   assert files/shortcut/branding; launch (the installed app has its OWN
   userData + lock, so it opens BESIDE a running dev app — that's the PASS);
   `Uninstall*.exe /S` → assert cleanup, appData preserved. Cheap smoke for
   every dist build.
   maps `release/` read-only + a results folder; LogonCommand silently
   installs, verifies files/shortcut/**Add-Remove-Programs registration**/
   process-start, AND asserts the fresh-machine experience (no EQ installed →
   app still boots to the zero-logs empty state), uninstalls, asserts files
   AND the uninstall key are gone, then writes PASS/FAIL to the mapped results
   dir. 19 checks; `arp-*` names each ARP field individually so a failure says
   exactly what was missing.
   **Invoke via `scripts/sandbox/run-installer-test.ps1`** (never the raw
   .wsb): it force-closes a stale VM (only ONE sandbox instance is allowed
   machine-wide), refuses to boot without a CURRENT Setup exe, parks the VM
   window off the primary monitor without stealing focus (the user games on
   the primary — keep it clear), force-kills the client when the results
   land, and exits 0/1. Harness invariants: ASCII-only (the guest's PS 5.1
   reads a BOM-less .ps1 as ANSI), always writes a verdict from a `finally`,
   and POLLS after uninstall instead of trusting `Start-Process -Wait`.
   Requires the `Containers-DisposableClientVM` feature (if
   `WindowsSandbox.exe` is missing while DISM says Enabled, disable +
   re-enable elevated and reboot). Full detail: docs/agents-archive.md.
3. **Docker servercore** (`scripts/docker/`) — headless file-level fallback:
   silent install + file/ARP-registry verification only; throws on first
   failure. Use when Sandbox isn't available.

Always test the CURRENT `npm run dist` output, not a stale release/ exe — a
clean-machine pass on an old build proves nothing about today's first-run
provisioning.

### Post-release feedback smoke test (`npm run smoke:release`)

ON-DEMAND ONLY — not in CI, not in `npm test`, not in `test:e2e`. Run once
after a release publishes: a sandbox DOWNLOADS the published installer
(verified against the release's `SHA256SUMS.txt`), plants a mocked EQ log,
launches the installed app with `EQ_SMOKE_FEEDBACK=<nonce>`, and
`src/main/smokeFeedback.ts` files ONE real bug report through the ordinary
`submitFeedback` path (every normal layer, NO endpoint override, refused
under `EQ_E2E`). The host half reads the LIVE backlog (`triage/store.ts`,
profile `eqc`) and asserts the row, the slice upgrading to `present`, and —
the point — that the slice CONTAINS the run's nonce and does NOT contain
`CHAT_MARKER`: the scrub proof, measured on the bytes that made the round
trip. A pass cleans up; a failure leaves evidence; a `closed` answer is its
OWN verdict (kill switch on, plumbing proven). Reuses the tier-2 lifecycle
via `scripts/sandbox/sandbox-lifecycle.ps1`.
- Overlay: Electron suffices for windowed/borderless EQ; exclusive
  fullscreen cannot be overlaid by anything (native-helper escape hatch:
  feed it the same snapshot IPC). ONE overlay.html bundle, kind read from
  `?kind=`; each kind has its own persisted config (`store overlays.<kind>`)
  and can run simultaneously; all overlay IPC channels take the kind as
  first arg (`onOverlayState` payload is `{kind, open}`). Interactive mode
  adds a dense selector + a mini drill-down; locked mode stays fully
  click-through but RENDERS the persisted drill read-only
  (`overlays.<kind>.drill` — config IS the drill state, no renderer mirror;
  stale ids render level 1 without clearing). EIGHT kinds: fight/overall
  (damage), heal-fight/heal-overall, events, buffs + debuffs (JOS-89, split
  by JOS-119 — below), and toast (celebration cards —
  docs/plans/celebration-toasts.md; queue reducer in overlay/toastQueue.ts,
  producers in App.tsx, payloads resolved in main/toast.ts). The toast is
  the ONE kind that defaults OPEN (owner, 2026-08-05; schema v9 corrects
  stores written at the old default) and has NO SOUND of its own — the
  seeded boss/quest ALERTS speak on the same events.
- **SCROLLING AND CLICK-THROUGH CANNOT BOTH BE TRUE OF THE SAME PIXEL (JOS-138).**
  Pinned is `setIgnoreMouseEvents(true, {forward:true})`, and `forward`
  forwards mouse MOVES and nothing else — a wheel notch goes to the game.
  The owner's disposition ("we should allow scroll") is paid for in pixels:
  the **SCROLL GRIP** (`SCROLL_GRIP_W`, overlay/overlayScale.tsx) is a 22px
  strip over the drawn scrollbar; while LOCKED *and* the rows genuinely
  overflow, a forwarded move inside it raises the named-reason sensor
  (`capture('scroll', …)`) and the window takes the mouse for exactly the
  time the pointer spends there — the wheel AND dragging the bar, because
  the grip hands the real scrollbar real events instead of re-implementing
  scrolling. NO new IPC, NO new mouse hook; the rest of the body stays
  genuinely click-through (asserted in `tests/e2e/overlayScrollSteps.mts`).
  Honest limits, stated: entry from outside the right border can miss the
  strip, and Windows' hover-scroll setting is what carries the notch. The
  event log and buffs/debuffs windows need no grip — they hold capture over
  their WHOLE window while hovered, the same trade at the other extreme.
  Full story: docs/agents-archive.md.
- **THE OVERLAY FLOOR IS ONE RECTANGLE, AND IT IS MEASURED (JOS-278).**
  `OVERLAY_MIN_SIZE` in `overlayLayout.ts` (140x90) is the minimum for EVERY
  kind — never per-kind (the busiest chrome is what the number must survive),
  and it exists so a window can never be dragged tiny and lost. **Do not change
  this number from a constant — change it from a measurement**
  (tests/e2e/overlayMinSizeSteps.mts is the instrument). Full measurement
  story: docs/agents-archive.md.
- **THE BUFF/TIMER OVERLAY'S BAR IS A CLAIM, AND ITS ABSENCE IS THE HONEST HALF**
  (JOS-89, docs/plans/buff-timer-overlay.md). ONE law decides every row: **a
  duration `spells.json` STATES becomes a receding countdown; a duration
  nobody states becomes ELAPSED time counting UP; there is no third case.**
  A bar is a promise about when something ends, so an unknown-duration row
  has NO BAR and a `+` before its time; the mined `observed` estimate is NOT
  a stated duration (`durationSource === 'db'` is the whole discriminator).
  The mez was invisible because of CASCADE ORDER (`classifyCcApply` above
  `classifyDbBuff`); the parser now carries the DB candidate list on the
  application shape and `modules/buffTimers.ts` owns per-target holds keyed
  by mob. Everything else reads off `BuffsSnap.active` — a second fold is
  the two-models scar law 4 is made of; candidates narrow by YOUR OWN CAST
  HISTORY (law 3), and a broadcast with no own cast opens NO hold. A KNOWN
  GAP, deliberately not fixed here: a CC-roster wear-off never reaches
  `onBuffFade`, so the overlay corrects it in its own projection
  (`endedByCc`) — fixing `recordFade` would mint duration samples and move
  mined statistics suite-wide. Selectors are scope-filtered custom
  `OverlaySelect` (the overlay bundle stays MUI-free by law); PERSISTED
  bounds always win. Full story: docs/agents-archive.md.
- **A HIDDEN WINDOW CANNOT PAINT, SO `hide()` IS NEVER HOW YOU CLEAR ONE
  (JOS-120).** A hidden `BrowserWindow` produces no frames and `show()`
  re-presents its last composited surface — an IPC "clear" sent after
  `hide()` is recorded and never drawn (MEASURED: the pending rAF fired 1 ms
  after `showInactive()`, one frame too late). Two rules: **(a) Clear BEFORE
  you hide** (`suspendCursorStream`); **(b) better, do not hide for a state
  you will leave in a few hundred ms** — `ringDisposition` (replayGate.ts)
  splits `idle` (the game no longer owns the screen ⇒ really come off it)
  from `parked` (empty the halo and LEAVE THE WINDOW VISIBLE). The second
  half of the same bug was a CADENCE RATIO: `cursorVisible` gated an 8 ms
  consumer but was read on the 150 ms watcher tick, so the child's loop is
  SPLIT (`GetCursorInfo` every ~16 ms tick, the expensive foreground block
  every tenth). **Whenever a poll GATES a faster consumer, the number that
  matters is the ratio, not either period**
  (`unguardedSamplesPerHiddenCursor`). `tests/cursorRingClick.test.mts`
  models all four clocks and reproduces the twitch on the old path first, so
  the fixed assertion means something. Full story: docs/agents-archive.md.
- **…AND THE LOOP THAT DROVE ALL OF IT NO LONGER SPAWNS ANYTHING (JOS-182).**
  The presence watcher was a hidden `powershell.exe` with runtime `Add-Type`
  — an infostealer signature to a behavioural AV engine, and it never ran at
  all on 578 installs' machines (`spawn ENOENT`, fail-open, nobody could
  tell). It is now a **worker thread** calling user32/kernel32/psapi through
  **koffi**. Three rules, all general:
  - **A NATIVE DEPENDENCY HERE MUST SHIP PREBUILT N-API BINARIES IN ITS NPM
    TARBALL** (`.npmrc` ignores install scripts, `npmRebuild` is false); a
    CI-only compile exists only where nobody can debug it. Pin koffi
    **2.x** — 3.x downloads prebuilds in its install hook.
  - **NEVER `worker.terminate()` A THREAD THAT CALLS NATIVE CODE** —
    MEASURED: terminating inside a koffi call aborts the whole process, no
    catch anywhere. Ask it to stop over the port; a `'message'` handler runs
    only BETWEEN ticks. This would have been a rare, unattributable crash at
    quit, which every session reaches.
  - **MOVING WORK OFF A PROCESS IS NOT THE SAME AS MOVING IT ONTO MAIN** —
    the running scan is 8.4 ms and main is busy; the child's one virtue was
    being somewhere else. Keep that, drop the process. (Same argument as
    `speechWorker`; both are separate rollup inputs because
    `new Worker(path)` loads a FILE.)
  Full story: docs/agents-archive.md.
- **…AND IT IS TWO WINDOWS, OVER ONE MODEL (JOS-119).** The one 'buffs' kind
  became 'buffs' + 'debuffs' — two configs, two windows, two toggles. **THE
  SPLIT IS A FILTER, NOT A FORK**: `buildTimerRows` still folds the models
  exactly once and `shared/buffTimers.ts timerRowSurface` routes each row by
  its own `kind` (`group` is deliberately NOT the discriminator — a Symbol
  on your pet is `group:'target'` and still a BUFF). ONE component
  (`BuffsOverlay.tsx` + a `kind` prop; a copy would be the defect). NO
  MIGRATION by design: `overlays.buffs` keeps its key so bounds carry over;
  `overlays.debuffs` reads the default and arrives OFF. The seventh meter
  slot broke the fixed first-open size, so the uniform size is a FUNCTION OF
  THE DISPLAY (a fixed shrink ladder — largest rung whose grid seats every
  kind; 1080p+ untouched). Two measured e2e gotchas: a programmatic
  `setBounds` from MAIN does not raise `moved`/`resized` (a persistence spec
  must write through `overlay:setConfig`), and `overlayWindow()` matched
  `?kind=` by SUBSTRING (`kind=debuffs` contains `kind=buffs`) — it parses
  the query now. Full story: docs/agents-archive.md.
- **GRAPHICS COMPATIBILITY IS TWO SWITCHES, AND NEITHER IS INSTANT (JOS-40).**
  `shared/graphicsPrefs.ts` (store `graphics`, both default 'auto' — a
  compatibility mode shipped ON is a downgrade for every machine that never
  needed one; `auto` resolves OFF where nothing is detected). (a) SAFE MODE:
  `app.disableHardwareAcceleration()` from index.ts MODULE SCOPE (Electron
  accepts it only before `ready` — hence "next launch", and moving it into
  `whenReady` would silently do nothing); `EQ_DISABLE_GPU=1` forces it for
  one launch and outranks everything. (b) OPAQUE OVERLAYS:
  `transparent:false` on `OPAQUE_OVERLAY_BG` (the pages' own RGB minus the
  alpha, never a second palette); transparency is fixed at construction ⇒
  applies on the next overlay OPEN; the TOAST is shown only while it has a
  card (driven off `overlay:setIgnoreMouse`, never a second timer); the
  cursor ring is NEVER opaque. Neither switch joins the shared settings
  profile — they describe one machine's driver. Proven end-to-end in
  `tests/e2e/overlay-sync.e2e.mts`. Full story: docs/agents-archive.md.
- **…AND UNDER WINE THE APP TAKES THAT PATH BY ITSELF (JOS-31).** The
  switches are THREE-STATE (`'auto' | 'on' | 'off'`, store v11) and
  `shared/wineDetect.ts` decides what `auto` means. **PRECEDENCE, one
  function, three rungs**: `EQ_DISABLE_GPU` > an explicit user choice >
  detection > off; `resolveGraphics` is the ONLY place that folds them, read
  by all three consumers so a window cannot be built one way and labelled
  another. **DETECTION IS CONSERVATIVE OR IT IS NOTHING** — a false positive
  costs EVERY Windows user their GPU. Two signals, either sufficient, both
  impossible on real Windows: Wine's own tools in `system32` (exact
  filenames, never a `wine*` pattern), and the env vars Wine's own ntdll
  injects into every hosted process (WINEHOMEDIR et al — NOT `WINEPREFIX`,
  which is launcher-set and a false positive we may not have). Gated on
  `platform === 'win32'`. Safe mode under Wine is WineHQ bug 48618, not a
  guess. The 10→11 migration reads a stored `false` as 'auto' and `true` as
  'on'. **NOTHING HERE WAS VERIFIED UNDER WINE** — the tests pin the
  NEGATIVE exhaustively and the reporter is the verification path. Rejected
  signals and why: docs/agents-archive.md.

## Cloud (feedback backend + future web) — state as of 2026-08-04

- **AWS**: dedicated sub-account `eqcompanion` **001634075447** (org
  management = `jmoyers` 383185690517), region **us-east-1**. CLI: profile
  `eqc` assumes `OrganizationAccountAccessRole` via source profile
  `windows-desktop-eqc` (owner-managed key). Terraform + AWS CLI installed
  via winget. Full detail: docs/agents-archive.md.
- **Terraform**: root `infra/`, state in s3 bucket
  `eqcompanion-tf-state-dae027bf` (versioned, BPA) + lock table
  `eqcompanion-tf-lock`. Deploys run from this machine with
  `AWS_PROFILE=eqc`; CI only fmt/validate/bundle. **Standing authorization
  (owner, 2026-08-05): NON-DESTRUCTIVE applies and migrations — additive
  DDL, copy-first backfills with count verification, Lambda updates — may
  be run by the agent directly. Anything that drops, overwrites, or loses
  data (including "empty" shells until counts are VERIFIED) still gets
  explicit owner approval first.** The 30-resource stack applied 2026-08-04.
- **Store is Aurora DSQL** (owner: "I hate dynamodb"), not DynamoDB:
  schema in `infra/schema.sql`, applied by `triage-feedback migrate`
  (never yet run against a live cluster — it stops on and prints a bad
  statement). Ingest connects as a DB role holding **INSERT ON report and
  nothing else**; IAM tokens, zero passwords. DSQL laws: no FKs/triggers/
  PLpgSQL, fixed Repeatable Read + OCC (retry only SQLSTATE 40001),
  3,000-row txn cap (bounds every sweep), one DDL per txn,
  `CREATE INDEX ASYNC`, jsonb young + unindexable (we use text).
- **F2: DEPLOYED AND LIVE (2026-08-04).** Live-verified: submit 201 + ULID,
  idempotent replay 200 same id, oversize 413; kill switch OPEN; the three
  constants filled in net.ts (api pcy0z3xjp9… · bucket
  eqcompanion-logs-6c58f5cc · us-east-1). Two DSQL live findings encoded:
  grants on the system-owned `public` schema are unsupported (table-level
  grants suffice), and `statement_timeout` cannot be SET (client-side
  query_timeout only; db.ts fixed). Remaining negatives + the SNS
  confirmation: docs/agents-archive.md.
- **ANALYTICS COHORT SPLIT — LIVE (2026-08-05, waves R+S, run under the
  standing authorization).** Owner vs user cohort lives IN the counter
  tables' primary keys; the migration ran COPY-FIRST per owner ruling
  (staging tables, row-count AND sum(n) verification, swap via DSQL's
  documented `RENAME TO`; nothing dropped until its verified copy existed).
  Runbook preserved in infra/README.md "THE COHORT MIGRATION". Owner
  installs marked; **a ROTATED analyticsId arrives unmarked — re-run
  `analytics owner-add`**.
- **ANALYTICS OPERATIONS (how usage questions get answered):**
  - Daily/adoption truth: `triage-feedback analytics digest --days N
    --profile eqc` (user cohort by default; `--cohort all` prints both,
    NEVER summed). Series history STARTS 2026-08-04 — there is no earlier
    data and never will be.
  - Live concurrency: CloudWatch `EQCompanion/Telemetry` `Heartbeats`,
    `Channel=prod`, **Sum over 600s** ≈ concurrent sessions (channel-split,
    not cohort-split — EMF dimension identity would orphan every widget).
    **THE PERIOD IS THE CLIENT'S HEARTBEAT CADENCE, NOT A CHOICE** (JOS-269
    took it 5 min → 10 min, so 300s was right until 2026-08-12 and halves the
    answer now). `liveSessions.ts BUCKET_MS` is the same number and the two
    move together or the readout silently lies.
  - Install truth is `analytics_install`; GitHub `download_count` is NOT
    installs (the auto-updater dominates it). DAU can slightly exceed
    installs across UTC day boundaries — artifact, not phantom users.
  - The kill switch is cached in warm Lambdas for 60s — a 503 right after
    `analytics open` is the cache, not a failure.
  - **THE PULSE'S LIVE HALF IS A CLOUDWATCH READ, NOT A COUNTER** (JOS-39):
    `liveSessions.ts` reads `Heartbeats` directly, merged at the two
    presentation edges — never inside `buildAnalytics`, which stays pure.
    The average age is labelled `est.`, can only under-claim, and is NULL —
    never 0 — when nobody is alive.
  - **`upgrades` IS DERIVED SERVER-SIDE**, from the stored `app_version`
    read BEFORE the install UPSERT; once per version change; downgrades
    count; disjoint from `newInstalls`.
  - Pre-marking counter rows carry no id and stay in the user cohort
    forever — read old days with that in mind.
- **Local dev story**: `scripts/dev-feedback-server.mts` (wave in flight
  at write time) — same contract, same shared validator, failure knobs;
  the app reaches it via `EQ_FEEDBACK_URL`, honored ONLY behind
  `!app.isPackaged` (the lawful exception to the no-override rule —
  packaged builds must prove the env var does nothing).
- **Usage analytics**: opt-OUT (owner decision over the integrator's opt-in
  recommendation) but NOTHING transmits before the first-run notice renders;
  allowlist schema; separate rotatable analyticsId; payload viewer +
  TELEMETRY.md (plan: docs/plans/usage-analytics.md). A1/A2/A3 are ALL LIVE:
  a second Lambda (`eqcompanion-telemetry-ingest`) behind `POST
  /v1/telemetry`, aggregating on arrival into the three tables — NO
  raw-event store — plus EMF metrics, a dashboard, `analytics
  digest|wipe|open|close`, and the Triage → Analytics tab. **The endpoint is
  LIT**: `TELEMETRY_API_URL` is a compiled-in constant;
  tests/telemetryNet.test.mts pins the exact URL, the single fetch site, and
  the consent gates (nothing before the notice; opt-out destroys buffer +
  id). Full detail: docs/agents-archive.md.
  **THE CADENCE IS A COST DIAL, THE CONTENT IS NOT (JOS-269, owner ruling
  2026-08-12).** `FLUSH_INTERVAL_MS` 5 min and `HEARTBEAT_INTERVAL_MS` 10 min
  (flush.ts) — was 60 s / 5 min, and the plan's T5 still says the old numbers
  because plans are historical intent. Every event is a counter delta that
  sums server-side, so batching harder loses NOTHING; every flush is one
  request through API Gateway + Lambda + DSQL, which is the whole bill. What it
  does cost is stated where it happens: a KILLED session's duration is only
  known to its last heartbeat, so the tail of that histogram coarsens from
  5 min to 10. **THREE NUMBERS ARE DERIVED FROM THESE AND MUST MOVE WITH
  THEM**: `liveSessions.ts BUCKET_MS` (= the heartbeat, or Live now halves),
  the "sessions in the last 10 min" tile note, and the sandbox smoke's
  `$telemetryDwellSec` (must exceed ONE flush tick — nothing leaves the machine
  except on one; `stopTelemetry` writes the ring, it does not POST). Changing
  WHAT is collected is a different decision and remains owner law.
  **THE ADDITIVE-FIELD RULE (JOS-39, and it is a deploy-skew law).** The app
  auto-updates itself; the ingest Lambda is deployed by hand — so a shipped
  client is regularly talking to an OLDER copy of the shared contract. A NEW
  EVENT KIND is fatal under that skew: the shared validator fails the whole
  batch, the endpoint answers 400, and `telemetryPermanentRefusal` (net.ts)
  classes 400 as "these bytes will never be accepted" and DROPS the batch — so
  the client throws away every counter it is carrying, on every flush, until
  the deploy lands. A NEW OPTIONAL FIELD on an existing kind is free: the
  validators CONSTRUCT their result field by field, so an older server simply
  does not copy it across and accepts the batch. Add measurements as fields
  (`linesParsed` rides on `sessionHeartbeat`/`sessionEnd`), and the client half
  is then safe to ship BEFORE the additive apply.
  **USER/OWNER SPLIT (2026-08-05, owner-directed, LIVE).** Every counter row
  carries a `cohort` ('user'|'owner'), IN the PRIMARY KEY of
  `usage_daily`/`usage_funnel_daily` and a nullable column on
  `analytics_install`. Dev builds tag themselves SERVER-SIDE from
  `env.channel` (no client change, no TELEMETRY.md change); the installed
  copy is marked by hand with `analytics owner-add <analyticsId>`. Every
  read defaults to the user cohort; `--cohort all` renders both SIDE BY SIDE
  and nothing ever sums them. Rows aggregated before a marking keep their
  cohort and the digest says so.
## Known open items

- **TOOLCHAIN WAVE — LANDED** (verified 2026-08-06, JOS-63): electron
  43.2.0, vite 7.3.6, electron-vite 5.0.0 are what the tree runs. Still open
  from the same flag: the installer ships ~150MB of other-platform onnx
  binaries (trim via asarUnpack filters; koffi's excluded other-platform
  prebuilds are the worked example beside it). The .npmrc / npmRebuild
  comments were rewritten by JOS-182 and state the prebuilt-N-API rule.
  History: docs/agents-archive.md.

- **Feedback loop**: planned in `docs/plans/feedback-triage.md`; F1/F2 have
  since SHIPPED (see Cloud above) — the plan is historical intent now.
- Azure signing: waiting on Microsoft identity validation → cert profile +
  app registration + repo secrets.
- Windows Sandbox: WORKING (last run 2026-08-03, PASS, gating v0.2.0) —
  `run-installer-test.ps1` is the standard pre-ship clean-machine gate.
- Design docs for shipped 2026-08-03 features live in `docs/plans/` —
  historical intent; the code + this file are the current truth.
- Startup could be TAIL-FIRST (attach the live tail, backfill history
  backwards): needs order-independent folding in every module — a real
  architecture change, not yet attempted; the `hydrating` flag keeps today's
  ~6s replay honest meanwhile.
- Not yet parsed: Dragon Hoard / tradeskill depot / combine loot lines.
  Group-member combat tracking: future scope.
- **Open chips (2026-08-05, each with a full brief in its chip):** the combo
  swap-back blind spot — the hardest inference fix in the repo, do not rush
  it; **PARTLY CLOSED by JOS-79** (`reinstatedDrops`; a swap between capped
  classes still dings for nothing and remains evidence-only); the e2e
  per-checkout lockfile; copyText still serializing the melee-rounds footer
  the Rounds panel replaced. Full briefs: docs/agents-archive.md.
- **Awaiting real samples** (the outputs registry refuses them typed until
  a committed fixture graduates each): /outputfile guild, raid, spellbook,
  factions, achievements, alternateadv — one in-game `/outputfile <kind>`
  from anyone provides it. Same law for the **Double Bow Shot annotation**,
  still unobserved after JOS-92's whole-log sweep: `(Critical)` is the only
  annotation any of the nine `shoots` lines carries, and the file's one
  `bow shot` hit is a player bragging in General chat. The rest of that note
  is now SUPERSEDED — archery does appear, just never the owner's: 9 landed
  and 8 avoided bow lines from other players, all third-person, and the Ranged
  lane (above) is built on them. `You shoot` remains ZERO, so the FIRST-PERSON
  arm is the shape still awaiting a sample.
- Releases this arc: v0.4.0-v0.6.0 shipped sandbox-gated + smoke-verified;
  per-release detail in `shared/releaseNotes.ts` and docs/agents-archive.md.
