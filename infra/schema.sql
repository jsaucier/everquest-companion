-- =============================================================================
-- infra/schema.sql â€” the Aurora DSQL schema for the feedback store.
-- =============================================================================
--
-- APPLIED BY:  npx tsx scripts/triage-feedback.mts migrate --profile <p>
--
-- NOT by Terraform. DSQL DDL needs an IAM-signed postgres connection, which
-- Terraform cannot make; see the header of infra/dsql.tf. The migrate command
-- connects as `admin`, splits this file into statements, and runs each one in
-- its OWN transaction (DSQL law: one DDL statement per transaction, and DDL and
-- DML may not share a transaction).
--
-- IDEMPOTENT. Re-running is a no-op: tables use IF NOT EXISTS, and the runner
-- treats "already exists" (42P07 / 42710 / 42P06) as success and says so.
--
-- STATEMENT SPLITTING is line-based: a statement ends at the first line whose
-- last character is `;`. Therefore NO STRING LITERAL IN THIS FILE MAY END A LINE
-- WITH A SEMICOLON. Nothing here does; keep it that way (there is no PL/pgSQL to
-- dollar-quote â€” DSQL does not support it).
--
-- `${LAMBDA_ROLE_ARN}` is substituted by the migrate command from
-- `terraform output -raw lambda_role_arn`. It contains the account id, which is
-- why it is a placeholder in a public repo and not a literal.
--
-- ---------------------------------------------------------------------------
-- SHAPE NOTES (why the columns look like this)
-- ---------------------------------------------------------------------------
--  * TIMES ARE epoch-MILLISECOND `bigint`, not timestamptz. The whole contract
--    (`receivedAt`, `clientTs`, `triagedAt`, `expiresAt`) is `number` in
--    src/shared/feedback.ts and in the triage CLI. Storing the same number keeps
--    ONE representation end to end; a timestamptz would add a conversion at
--    every boundary for no query we run. Both readers set node-postgres's int8
--    parser to Number â€” epoch ms is exact well past year 10000.
--  * `env_json` / `log_json` are TEXT holding JSON, not jsonb. Nothing ever
--    queries INTO them (the CLI parses them in JS), jsonb cannot be indexed in
--    DSQL anyway, and DSQL's jsonb support is two months old. The three env
--    fields that ARE queried or displayed in every list â€” channel, app_version,
--    platform â€” are promoted to real columns; env_json stays authoritative for
--    `show`.
--  * PRIMARY KEYS ARE THE UNIQUENESS RULES. `report_idempotency` is keyed on
--    (install_id, client_report_id), so idempotency is enforced by the key
--    itself rather than by a secondary unique index that would be built
--    asynchronously (and therefore unenforced for a window). Same for the quota
--    and dedupe counters.
--  * NO FOREIGN KEYS â€” DSQL has none. Every relationship here is by id and is
--    already enforced by the handler, which is the only writer of report rows.
--  * `report_id` is a ULID (server-minted). It stays the primary key so a report
--    is addressable by exactly the id the user is shown, and `received_at`
--    carries the timeline for every range query.
--  * NO `title`, NO `contact`. Both were retired from the wire contract first (the
--    description is the whole draft) and then from storage: nothing writes them,
--    nothing reads them, and a stack migrated from this file never has them.
--    A CLUSTER MIGRATED BEFORE THAT CHANGE STILL HAS THE TWO COLUMNS, and this
--    file cannot remove them: Aurora DSQL's documented ALTER TABLE grammar has no
--    `DROP [COLUMN]` action (it has DROP DEFAULT / DROP NOT NULL / DROP EXPRESSION
--    / DROP IDENTITY / DROP CONSTRAINT, and conspicuously not that one) —
--    https://docs.aws.amazon.com/aurora-dsql/latest/userguide/alter-table-syntax-support.html
--    Writing the drop here anyway would fail the whole `migrate` run on syntax.
--    The runbook in infra/README.md carries the one-off statement that DESTROYS
--    the legacy values, and the physical drop stays open against DSQL.

-- ---- tables -----------------------------------------------------------------

-- The kill switch and the live quota (Â§9.6). One row, id 'FEEDBACK'.
-- Seeded below with accepting = false: a freshly migrated stack is CLOSED until
-- the operator runs `triage-feedback closed off`, which is the safe default for
-- an endpoint that has never been smoke-tested.
-- The two `telemetry_*`/`max_events_*` columns are NULLABLE on purpose: they were
-- added to a live table (the ALTERs further down are what a pre-existing cluster
-- runs), and NULL has to be a legal value there. Both readers treat NULL as
-- CLOSED / "use the env fallback", so an un-migrated column can only fail safe.
CREATE TABLE IF NOT EXISTS feedback_config (
  id                        text    NOT NULL,
  accepting                 boolean NOT NULL,
  closed_message            text    NOT NULL,
  max_per_install_per_day   integer NOT NULL,
  telemetry_accepting       boolean,
  max_events_per_id_per_day integer,
  PRIMARY KEY (id)
);

-- Per-install block list. Absent row = not blocked.
CREATE TABLE IF NOT EXISTS install_profile (
  install_id     text    NOT NULL,
  blocked        boolean NOT NULL,
  blocked_reason text,
  blocked_at     bigint,
  PRIMARY KEY (install_id)
);

-- The backlog. Written once by ingest (INSERT only â€” the ingest role holds no
-- SELECT/UPDATE/DELETE here), amended thereafter only by the triage path.
CREATE TABLE IF NOT EXISTS report (
  report_id   text   NOT NULL,
  install_id  text   NOT NULL,
  report_type text   NOT NULL,
  description text   NOT NULL,
  channel     text   NOT NULL,
  app_version text   NOT NULL,
  platform    text   NOT NULL,
  env_json    text   NOT NULL,
  log_json    text,
  log_key     text,
  -- The SECOND attachment (JOS-296): the `/outputfile inventory` dump, stored exactly the way
  -- the slice is — the client's declared metadata as TEXT holding JSON, and the S3 key computed
  -- at insert time so triage can find (and HeadObject, and delete) the object without guessing.
  -- Two columns rather than a widened `log_json`: the two attachments have different metadata,
  -- different keys and independent lifetimes, and `forget` deletes them one at a time.
  inventory_json text,
  inventory_key  text,
  client_ts   bigint NOT NULL,
  received_at bigint NOT NULL,
  spam_score  integer NOT NULL,
  status      text   NOT NULL,
  severity    text,
  cluster_id  text,
  dupe_of     text,
  disposition text,
  issue_url   text,
  triaged_at  bigint,
  redacted_at bigint,
  PRIMARY KEY (report_id)
);

-- Daily per-install quota counter. `expires_at` is swept by the handler; there
-- is no TTL in DSQL.
CREATE TABLE IF NOT EXISTS install_quota (
  install_id text    NOT NULL,
  quota_day  text    NOT NULL,
  n          integer NOT NULL,
  bytes      bigint  NOT NULL,
  expires_at bigint  NOT NULL,
  PRIMARY KEY (install_id, quota_day)
);

-- Idempotency across offline retries (Â§6.4). The PRIMARY KEY *is* the guarantee.
CREATE TABLE IF NOT EXISTS report_idempotency (
  install_id       text   NOT NULL,
  client_report_id text   NOT NULL,
  report_id        text   NOT NULL,
  expires_at       bigint NOT NULL,
  PRIMARY KEY (install_id, client_report_id)
);

-- Copy-paste-flood probe (Â§9.5): same description text, same day, different
-- install. A spam SIGNAL only â€” it never blocks anything.
CREATE TABLE IF NOT EXISTS dedupe_probe (
  hash          text    NOT NULL,
  probe_day     text    NOT NULL,
  first_install text    NOT NULL,
  n             integer NOT NULL,
  expires_at    bigint  NOT NULL,
  PRIMARY KEY (hash, probe_day)
);

-- ---- usage analytics (docs/plans/usage-analytics.md T6 + Â§4) ----------------
--
-- THREE TABLES, AND NO RAW EVENT STORE. The ingest handler AGGREGATES ON ARRIVAL:
-- a batch becomes counter UPSERTs and is then forgotten. There is no per-user
-- event trail here to subpoena, leak or have to delete, and the only per-id row
-- that exists at all is `analytics_install` (which `analytics wipe --id` drops).
--
-- WHY THESE SHAPES:
--  * `usage_daily` is ONE narrow table for every counter. `metric` names the
--    counter and `dim` carries its closed-enum dimension (a view id, a feature
--    id, a version, a bucket INDEX), '-' where the metric has none. The names
--    are enumerated in src/shared/telemetryRollup.ts, which both the handler and
--    the triage readout import â€” postgres sees text, the code sees an enum.
--  * `usage_funnel_daily` is separate because its key is genuinely five columns
--    wide and folding it into `dim` would make every funnel query a string parse.
--  * `analytics_install` carries the day-grained per-id facts that a counter can
--    never answer (WAU/MAU, retention cohorts, days-to-adopt) plus the per-id
--    DAILY EVENT CAP, kept here rather than in a fourth table so that the whole
--    per-id footprint stays exactly one row.
--
-- All four `n`/count columns are bigint: they are sums of client-reported counts
-- and durations, and a busy day of `viewDwellMs` is comfortably past 2^31.
--
-- ---------------------------------------------------------------------------
-- `cohort` — 'user' or 'owner', AND IT IS PART OF THE KEY
-- ---------------------------------------------------------------------------
-- The author runs this app too (a dev build all day, the installed copy in the
-- evening), and their own use is signal about the BUILD but noise in every number
-- about the USER BASE. So the counters are keyed per cohort and every read path
-- defaults to 'user'. The rationale in full — including why nothing ever SUMS the
-- two — is in src/shared/telemetryRollup.ts, which both writers import.
--
-- IT IS IN THE PRIMARY KEY, NOT BESIDE IT, and that is not a preference: the
-- ingest path's `ON CONFLICT (day, cohort, metric, dim) DO UPDATE` needs those four
-- columns to BE the uniqueness rule, and a non-key column would let one day's
-- user and owner rows collide into one counter.
--
-- WHICH MEANS THERE IS NO `ALTER` FOR THESE TWO TABLES, AND CANNOT BE. Aurora
-- DSQL's ALTER TABLE grammar can add a column; it cannot change a PRIMARY KEY
-- (the key is the table's distribution, not an index you can rebuild).
--
-- ON A FRESH CLUSTER the CREATE TABLE below IS the whole migration. ON A CLUSTER
-- THAT ALREADY HAS THE PRE-COHORT SHAPE — which the live one does; the v0.4.0
-- smoke test answered `column "cohort" does not exist` — `IF NOT EXISTS` reports
-- `exists` and silently keeps the old columns. `migrate` output is the check.
--
-- THE RECOVERY IS A COPY, NOT A DROP (owner, 2026-08-05: "we shouldn't drop
-- anything"). Those counters have been accumulating behind a lit client since
-- 2026-08-04 and may hold REAL USERS' rows, not just the owner's testing. So the
-- path is: create cohort-keyed STAGING tables (whose CREATE text is taken from
-- THIS file, so the shapes cannot drift), copy every row into them with the
-- cohort derived from what `analytics_install` states, verify old-vs-new counts
-- and sums, and only then drop the copied-from original and
-- `ALTER TABLE … RENAME TO` the staging table into its place — a form Aurora DSQL
-- documents as supported, which is why no table name outside that transition ever
-- changes. `triage-feedback analytics backfill-cohort|backfill-verify|
-- backfill-swap` (scripts/analyticsBackfill.mts); the ordered commands are the
-- runbook at the top of infra/README.md. NOTHING in this file drops anything.

CREATE TABLE IF NOT EXISTS usage_daily (
  day    text   NOT NULL,
  cohort text   NOT NULL,
  metric text   NOT NULL,
  dim    text   NOT NULL,
  n      bigint NOT NULL,
  PRIMARY KEY (day, cohort, metric, dim)
);

CREATE TABLE IF NOT EXISTS usage_funnel_daily (
  day         text   NOT NULL,
  cohort      text   NOT NULL,
  funnel      text   NOT NULL,
  step        text   NOT NULL,
  outcome     text   NOT NULL,
  app_version text   NOT NULL,
  n           bigint NOT NULL,
  PRIMARY KEY (day, cohort, funnel, step, outcome, app_version)
);

-- ONE ROW PER analyticsId, and that is the entire per-id footprint of this
-- feature. `quota_day`/`quota_n` are the daily event cap's counter: they live on
-- this row so the guarded UPSERT that maintains the row IS the cap check, in one
-- statement with no read-modify-write window (the same argument install_quota
-- makes for feedback, written out in infra/lambda/telemetry.ts).
--
-- `cohort` IS NULLABLE HERE, unlike in the two counter tables, for the same reason
-- the `telemetry_*` config columns are: it is the one cohort column that CAN be
-- added to a pre-existing table (it is not in the key), so the `ALTER` further
-- down is real and a row written before it ran has NULL. Every reader normalizes
-- NULL to 'user' (`cohortOf` in src/shared/telemetryRollup.ts), which is the
-- fail-safe direction — an install nobody has marked is a user.
CREATE TABLE IF NOT EXISTS analytics_install (
  analytics_id   text   NOT NULL,
  first_seen_day text   NOT NULL,
  last_seen_day  text   NOT NULL,
  days_seen      integer NOT NULL,
  app_version    text   NOT NULL,
  channel        text   NOT NULL,
  cohort         text,
  quota_day      text   NOT NULL,
  quota_n        bigint NOT NULL,
  PRIMARY KEY (analytics_id)
);

-- ---- error reports (JOS-100) -------------------------------------------------
--
-- ADDITIVE, AND `usage_daily` IS UNTOUCHED. The counters keep answering "how many
-- errors did this build report"; this table answers "WHICH ones", which a counter
-- cannot, because the answer needs an example and `usage_daily` has no column an
-- example could live in.
--
-- ONE ROW PER (day, cohort, version, fingerprint), AND IT IS THE UNIQUENESS RULE:
-- the ingest path's `ON CONFLICT (day, cohort, version, fingerprint) DO UPDATE`
-- needs those four columns to BE the key. `cohort` is in the key for exactly the
-- reason it is in `usage_daily`'s (the long note above that table) — the author
-- runs this app too, and a merged total is the number the split exists to stop
-- reporting. `version` is in the key rather than in `dim` because THIS table has
-- room for a real column and the question is per-release: "did the build I just
-- shipped introduce this".
--
-- THIS TABLE IS BORN WITH ITS KEY. There is no `ALTER` path to a primary key in
-- Aurora DSQL, so a cluster that gets the CREATE below gets the final shape; a
-- future re-shape would need the copy-first staging runbook in infra/README.md,
-- exactly as the cohort migration did.
--
-- `exemplar` IS TEXT HOLDING JSON, NOT jsonb — and this file's own SHAPE NOTES are
-- why (env_json / log_json made the same call): nothing ever queries INTO it (both
-- readers parse it in JS), DSQL cannot index jsonb, and its jsonb support is young.
-- The JOS-100 brief asked for jsonb; the conventions this file states are older
-- than the brief and they win. Switching later is an ADD-a-column migration, which
-- is the one shape DSQL does support.
--
-- WHAT IS IN AN EXEMPLAR, so a reader of this file does not have to trust a comment
-- in another one: a validated `errorReport` event and nothing else — an error name,
-- a machine-readable code, a REDACTED message (the ingest Lambda re-runs the
-- redactor and refuses anything that changes under it), stack frames whose files
-- are all `out/…` bundle paths, and a list of parser event KINDS. No log line, no
-- chat, no character name, no filesystem path, no analyticsId. FIRST WINS: the
-- UPSERT writes the exemplar only when the row has none, so a hundred installs
-- hitting one bug store one example and add to one count.
CREATE TABLE IF NOT EXISTS error_report (
  day         text   NOT NULL,
  cohort      text   NOT NULL,
  version     text   NOT NULL,
  fingerprint text   NOT NULL,
  count       bigint NOT NULL,
  exemplar    text,
  PRIMARY KEY (day, cohort, version, fingerprint)
);

-- The kill switch and the cap for the TELEMETRY route, added to the existing
-- config row rather than a second table: one row is where an operator already
-- looks, and `triage-feedback` already reads and writes it.
--
-- ADDED, NEVER DROPPED. Aurora DSQL's ALTER TABLE grammar has no DROP COLUMN
-- (infra/README.md carries the worked example), so a column here is forever â€” it
-- is two, both nullable, and the handler reads them field by field with a typed
-- fallback so a NULL can only ever mean CLOSED. On a cluster created from this
-- file the CREATE TABLE above already has them and these two statements report
-- `exists` (42701 duplicate_column, which the migrate runner treats as success,
-- same as 42P07 for a table).
ALTER TABLE feedback_config ADD COLUMN telemetry_accepting boolean;

ALTER TABLE feedback_config ADD COLUMN max_events_per_id_per_day integer;

-- The install row's cohort, added the same way and for the same reasons: nullable,
-- never dropped, and a NULL reads as 'user' at every reader. It is the ONE cohort
-- column that an ALTER can add, because it is not part of a primary key — the two
-- counter tables carry theirs IN the key and therefore had to be born with it (the
-- long note above `usage_daily` says what to do if a cluster already has the old
-- shape). On a cluster created from today's file the CREATE TABLE already has the
-- column and this reports `exists` (42701 duplicate_column).
ALTER TABLE analytics_install ADD COLUMN cohort text;

-- The inventory attachment's two columns on a LIVE cluster (JOS-296). Same shape of migration as
-- the three above, and the same reasoning: DSQL's ALTER TABLE grammar can ADD a column and has no
-- DROP, so these are forever and both are NULLABLE — which is also what makes them additive. A
-- report written before this ran has NULL in both, and every reader spells that "no dump", which
-- is exactly what it was.
--
-- THESE MUST LAND BEFORE THE HANDLER THAT NAMES THEM. `REPORT_SQL` in infra/lambda/submit.ts
-- lists `inventory_json, inventory_key` unconditionally, and naming a column that does not exist
-- 42703s EVERY SUBMIT — the same trap the retired `title`/`contact` columns document above. So
-- the order is: `migrate` first, `terraform apply` (the new bundle) second, client release third.
-- infra/README.md carries the runbook.
-- On a cluster created from today's file the CREATE TABLE already has them and these report
-- `exists` (42701 duplicate_column).
ALTER TABLE report ADD COLUMN inventory_json text;

ALTER TABLE report ADD COLUMN inventory_key text;

-- ---- indexes ----------------------------------------------------------------
--
-- `CREATE INDEX ASYNC` is mandatory in DSQL (DDL cannot lock in a distributed
-- system). It returns a job id immediately and builds in the background; the
-- migrate command prints the id. Deliberately NO `IF NOT EXISTS` â€” it is not
-- part of the ASYNC grammar everywhere, and the runner already treats
-- "already exists" as success, which is the check that matters.
--
-- Columns are ASC: PostgreSQL scans an index backwards for `ORDER BY ... DESC`,
-- so a DESC index would buy nothing and adds a syntax bet.
--
-- These two replace gsi1 (byChannel) and gsi2 (byStatus). There is deliberately
-- NO index on install_id: `wipe --install` is a once-a-year deletion request and
-- the CLI warns that it is an unindexed scan â€” the same trade the plan made when
-- it refused a third GSI. There is likewise no index on `expires_at`: the sweep
-- is bounded and time-gated, and indexing it would tax every submit to speed up
-- a janitor.

CREATE INDEX ASYNC report_by_channel ON report (channel, received_at);

CREATE INDEX ASYNC report_by_status ON report (status, received_at);

-- The ONE analytics index. Every `usage_*` read is a `day >= :floor` range over
-- the PRIMARY KEY's leading column, so those two tables need nothing extra â€” but
-- WAU/MAU and the retention cohorts count `analytics_install` rows by
-- `last_seen_day`, which is not the key, and that read grows with the install
-- base rather than with the window.
CREATE INDEX ASYNC analytics_install_by_last_seen ON analytics_install (last_seen_day);

-- ---- seed -------------------------------------------------------------------
-- DML, so it is its own transaction (DSQL forbids mixing it with DDL).

INSERT INTO feedback_config (id, accepting, closed_message, max_per_install_per_day)
VALUES ('FEEDBACK', false, 'Feedback is not open yet. Please try again later.', 10)
ON CONFLICT (id) DO NOTHING;

-- TELEMETRY IS SEEDED CLOSED, exactly like feedback was: a route that has never
-- been smoke tested accepts nothing. `triage-feedback analytics open` (or one
-- UPDATE) is the deliberate act that turns it on.
--
-- Guarded on IS NULL so it is idempotent AND so it can never re-close a switch an
-- operator has already opened â€” re-running `migrate` after a schema change must
-- not be a stealth outage.
UPDATE feedback_config
   SET telemetry_accepting = false
 WHERE id = 'FEEDBACK' AND telemetry_accepting IS NULL;

UPDATE feedback_config
   SET max_events_per_id_per_day = 20000
 WHERE id = 'FEEDBACK' AND max_events_per_id_per_day IS NULL;

-- ---- the ingest database role ----------------------------------------------
--
-- THE INGEST PATH CAN CREATE AND COUNT. IT CANNOT READ THE BACKLOG OR DELETE A
-- REPORT. That property was IAM-shaped under DynamoDB (no Query, no Scan, no
-- DeleteItem); with one SQL endpoint it has to be shaped by GRANTs instead, so
-- the Lambda logs in as this role and never as `admin`. Note what is absent
-- below: any privilege at all on `report` other than INSERT.
--
-- DELETE on the three counter tables is what makes the retention sweep real.

CREATE ROLE feedback_ingest WITH LOGIN;

AWS IAM GRANT feedback_ingest TO '${LAMBDA_ROLE_ARN}';

-- DSQL: schema-level grants on system-owned 'public' are unsupported ('feature not
-- supported on system entity', live 2026-08-04); table-level grants below suffice.
GRANT SELECT ON feedback_config TO feedback_ingest;

GRANT SELECT ON install_profile TO feedback_ingest;

GRANT INSERT ON report TO feedback_ingest;

GRANT SELECT, INSERT, DELETE ON report_idempotency TO feedback_ingest;

GRANT SELECT, INSERT, UPDATE, DELETE ON install_quota TO feedback_ingest;

GRANT SELECT, INSERT, UPDATE, DELETE ON dedupe_probe TO feedback_ingest;

-- ---- the TELEMETRY ingest database role -------------------------------------
--
-- A SECOND ROLE FOR A SECOND FUNCTION, and the reason is the same one that made
-- `feedback_ingest` narrow: what a public write endpoint may do is the GRANT list
-- below, not a promise in a handler. This role can count usage and it can touch
-- its own install row. It cannot read the feedback backlog, cannot see
-- install_profile, cannot write `report`, and holds no DELETE anywhere â€” a full
-- compromise of the telemetry Lambda can inflate counters and nothing else.
--
-- SELECT is granted alongside INSERT/UPDATE on the three tables because an
-- `ON CONFLICT DO UPDATE ... WHERE` reads the existing row to evaluate the guard,
-- and `RETURNING` reads it back. There is no DELETE: aggregates are anonymous and
-- are kept; the one deletion path (`analytics wipe --id`) runs as `admin`.

CREATE ROLE telemetry_ingest WITH LOGIN;

AWS IAM GRANT telemetry_ingest TO '${TELEMETRY_LAMBDA_ROLE_ARN}';

GRANT SELECT ON feedback_config TO telemetry_ingest;

GRANT SELECT, INSERT, UPDATE ON usage_daily TO telemetry_ingest;

GRANT SELECT, INSERT, UPDATE ON usage_funnel_daily TO telemetry_ingest;

GRANT SELECT, INSERT, UPDATE ON analytics_install TO telemetry_ingest;

-- The error store (JOS-100). SELECT rides along with INSERT/UPDATE for the same
-- reason it does on the three tables above: `ON CONFLICT DO UPDATE` reads the
-- existing row to evaluate `COALESCE(error_report.exemplar, EXCLUDED.exemplar)`.
-- Still NO DELETE — a compromised telemetry Lambda can add rows to this table and
-- can neither read the feedback backlog nor destroy an error history.
GRANT SELECT, INSERT, UPDATE ON error_report TO telemetry_ingest;
