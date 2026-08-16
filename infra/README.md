# infra/ — feedback + telemetry ingest stack (Terraform)

The cloud half of the in-app feedback loop and of usage analytics: one HTTP API with
**two routes**, **two Lambdas**, one **Aurora DSQL** cluster, one S3 bucket, and the guard
rails that make **publicly writable** endpoints safe to leave running. Design + rationale live
in `docs/plans/feedback-triage.md` (§7–§10) and `docs/plans/usage-analytics.md`; this file is
the runbook.

> **TWO FUNCTIONS, ON PURPOSE.** `POST /v1/telemetry` is its own Lambda with its own IAM role
> and its own **database** role, not a second route on the submit handler. Everything that
> makes either endpoint safe is per-identity — an IAM policy with one or two statements, and a
> GRANT list that is the real answer to "what can a compromised public endpoint do". One
> function serving both would hold the union: `INSERT ON report` plus an S3 presign permission
> for the counter path, and UPSERT on the counters for the feedback path. The cost of the split
> is one more zip and one more log group.

- **IaC: Terraform (HCL)** — owner decision, 2026-08-03. Not CDK.
- **Store: Aurora DSQL** (serverless Postgres) — owner decision. The plan and the
  first cut of this stack used DynamoDB; §3.2's single-table design existed only
  because DynamoDB cannot filter without an index, so in SQL the five item kinds
  are five tables, the two GSIs are two indexes, and `--since 7d` is a `WHERE`.
- **Region: us-east-1**, in a **dedicated AWS sub-account** (AWS Organizations).
- **CI validates. CI never plans and never applies.** There are no cloud
  credentials and no OIDC deploy role in a public repo; deploying is a manual act
  from the dev machine. See `.github/workflows/infra.yml`.

## What gets created

| File | Resources |
| --- | --- |
| `versions.tf` | provider pins (aws `~> 6.0` — `aws_dsql_cluster` needs it) + the `backend "s3"` block + default tags |
| `variables.tf` | region, name prefix, alarm email, triage principal, every spend knob (both routes) |
| `api.tf` | HTTP API `eqcompanion-api`, `$default` stage, `POST /v1/feedback` + `POST /v1/telemetry`, stage + per-route throttles, access logging |
| `lambda.tf` | `eqcompanion-feedback-submit` and `eqcompanion-telemetry-ingest` (both Node 22, arm64, 256 MB, 10 s), their log groups at 14-day retention |
| `dsql.tf` | the Aurora DSQL cluster (deletion protection + `prevent_destroy`) and the endpoint/ingest-role locals |
| `schema.sql` | the tables, indexes, config seed and the two ingest **database roles** — applied by the CLI, not by Terraform (see step 2.5) |
| `s3.tf` | `eqcompanion-logs-<random hex>` + all four Block-Public-Access flags + SSE-S3 + versioning off + 90-day lifecycle + `prevent_destroy` |
| `iam.tf` | the two ingest roles (`dsql:DbConnect` only; telemetry has no S3 at all) and `EqCompanionFeedbackTriageRole` (`dsql:DbConnectAdmin`) |
| `alarms.tf` | `EqCompanionOpsAlerts` SNS topic + email sub + 8 alarms + a $10 monthly budget |
| `dashboard.tf` | `eqcompanion-telemetry` CloudWatch dashboard, fed by the ingest handler's EMF documents |
| `outputs.tf` | `api_url`, `telemetry_api_url`, `cluster_endpoint`, `bucket_name`, `triage_role_arn`, both `*_role_arn`s, log group names |
| `build.mjs` | esbuild bundles of `lambda/submit.ts` and `lambda/telemetry.ts` → **deterministic** `dist/submit.zip` + `dist/telemetry.zip` |

Each handler imports its validator from `src/shared/` — `validateSubmit` from
`feedback.ts`, `validateTelemetryBatch` from `telemetryValidate.ts` — so the server runs the
same validator as the client. `build.mjs` is what makes those imports survive into a Lambda
zip, and CI runs it on every change to either side so the two cannot drift apart silently.

The telemetry handler additionally imports `src/shared/telemetryRollup.ts`, which is the ONE
definition of what a batch becomes: the metric names it writes are the metric names the triage
Analytics tab and `triage-feedback analytics digest` read back. Since JOS-372 it also imports
`src/shared/telemetryPerfCube.ts` on the same terms — the closed vocabulary of the one cross-tab
(`perf_daily`), spelled once and imported by the handler and by both readouts.

## There is no database password

Aurora DSQL authenticates with a short-lived IAM token that `@aws-sdk/dsql-signer`
derives **locally** (SigV4 over the cluster hostname — no network call) from
whatever credentials the caller already holds. Nothing is stored in Secrets
Manager or SSM, nothing rotates, and there is no credential to leak.

Two identities, and the difference matters:

| Who | IAM action | Database role | Can do |
| --- | --- | --- | --- |
| the submit Lambda | `dsql:DbConnect` | `feedback_ingest` | `INSERT` on `report`; read config/profile; read+write+delete the three counter tables |
| the telemetry Lambda | `dsql:DbConnect` | `telemetry_ingest` | read `feedback_config`; UPSERT `usage_daily`, `usage_funnel_daily`, `analytics_install`. **No privilege at all on `report`, no `install_profile`, no DELETE anywhere.** |
| the triage CLI | `dsql:DbConnectAdmin` | `admin` | everything — it applies the schema and it is the deletion path for `forget`/`wipe`/`analytics wipe` |

§8.5's promise — *the ingest path can create and count; it cannot read the corpus
or destroy anything* — used to be enforced by omitting `dynamodb:Query`/`Scan`/
`DeleteItem` from a policy. DSQL has one IAM action for data access, so the
property moved down a layer: the Lambda may only log in **as a named database
role**, and that role's `GRANT` list (bottom of `schema.sql`) is where the promise
now lives. Granting the Lambda `dsql:DbConnectAdmin` would hand a public write
endpoint superuser on the whole backlog. Never do it.

## One-time: the sub-account and the state backend

Already done for this product — recorded here so it can be redone or audited:

1. Create a dedicated account in AWS Organizations for the product.
2. Create a local profile that assumes an admin role in it. This repo commits
   **no profile name and no account id**; the examples below use `<profile>`.
3. Hand-create the state backend in that account, in **us-east-1** (a backend
   cannot bootstrap itself):
   - S3 bucket `eqcompanion-tf-state-dae027bf` — versioning **on**, Block Public
     Access all four flags, SSE-S3.
   - DynamoDB table `eqcompanion-tf-lock`, on-demand, partition key `LockID` (S).

Those names are hardcoded in the `backend "s3"` block in `versions.tf`. They are
physical names, not secrets: no account id appears anywhere in git.

> The lock table is the **last DynamoDB dependency in the tree** and it is
> Terraform's, not the product's. Terraform now deprecates `dynamodb_table` in
> favour of S3-native locking (`use_lockfile = true`), which would retire it —
> but that raises the required Terraform version and `.github/workflows/infra.yml`
> pins the CI toolchain, so it is a deliberate follow-up, not a drive-by.

## Deploy

```bash
export AWS_PROFILE=<profile>
cd infra

node build.mjs                     # BOTH zips FIRST — plan hashes them
terraform init                     # first run downloads providers + reads the backend
terraform plan  -var triage_principal_arn=arn:aws:iam::<acct>:user/<you>
terraform apply -var triage_principal_arn=arn:aws:iam::<acct>:user/<you>
```

`node build.mjs` now emits **two** bundles — `dist/submit.zip` and `dist/telemetry.zip` — and
both are hashed by the plan. A plan run without a build deploys nothing useful for either
function.

`alarm_email` defaults to `jmoyers+eqc@gmail.com`; override with
`-var alarm_email=...`. **Confirm the SNS subscription email after the first
apply** — until you click it, every alarm and budget alert goes nowhere.

Commit `.terraform.lock.hcl` (the provider checksum lock). Never commit
`*.tfstate`, `*.tfvars`, `tfplan` or `dist/`; `.gitignore` covers them.

After a successful apply:

1. `terraform output api_url` → paste into `FEEDBACK_API_URL` in
   `src/main/feedback/net.ts` and commit. It contains the API id, not the account
   id, and has to be in the client anyway.

2. **Step 2.5 — apply the schema. The stack does not work without this.**

   ```bash
   npx tsx scripts/triage-feedback.mts migrate --profile <profile>
   ```

   `terraform apply` creates an **empty** cluster: there is no `aws_dsql_*`
   resource that runs DDL, and DSQL's IAM-token auth means Terraform would have to
   mint a token and speak the postgres wire protocol to do it. So the schema is a
   reviewable SQL file (`infra/schema.sql`) applied by a reviewable command.

   `migrate` connects as `admin`, splits the file, and runs **one statement per
   transaction** (a DSQL law: a transaction may carry only one DDL statement and
   may not mix DDL with DML). It is idempotent — anything already present is
   reported as `exists`, not an error — so re-run it after any schema change and
   after any apply that replaced the cluster.

   Indexes are created with `CREATE INDEX ASYNC` (DDL cannot lock in a distributed
   database) and finish in the background; `migrate` says so when it is done.

3. The endpoint is seeded **closed**, on purpose. Open it once you have smoke
   tested: `npx tsx scripts/triage-feedback.mts closed off --profile <profile>`.

## THE COHORT MIGRATION — EXACTLY WHAT TO RUN, IN ORDER

**This is the live cluster's current pending work, and it is a COPY, not a drop.** The telemetry
stack itself is deployed and the client is lit; what the cluster does not have is the `cohort`
key on the two counter tables (the v0.4.0 smoke answered `column "cohort" does not exist`, which
is the tell). Those counters have been accumulating behind a lit client since **2026-08-04**, so
they may hold **real users' rows and not only the owner's testing** — the earlier version of this
runbook said `DROP TABLE usage_daily` and re-migrate, and that was written when these tables were
believed never to have been created. It is wrong now. **We don't drop anything.**

**Every step below is safe to stop at.** Nothing is destructive until step 5, step 5 refuses
unless step 4 passed, and every command is idempotent and re-runnable.

`<profile>` is the deploy profile (`eqc`); `<acct>` is the account id (never committed). Run
everything from the repo root unless it says `cd infra`.

```bash
export AWS_PROFILE=<profile>
```

### 0. Look before you touch

```bash
npx tsx scripts/triage-feedback.mts closed --profile <profile>
npx tsx scripts/triage-feedback.mts analytics backfill-verify --profile <profile>
```

`closed` prints both kill switches. `backfill-verify` names the cluster's state in one line per
table — on a cluster that still has the pre-cohort shape it says `no staging table — run
backfill-cohort`, and on one that is already migrated it says `already swapped`. If it says the
latter for both tables, the migration is already done; skip to step 6.

### 1. Freeze the writers (no deploy, one statement)

```bash
npx tsx scripts/triage-feedback.mts analytics close --profile <profile>
```

The copy in step 3 is a **snapshot**: a batch landing between the page that read past it and the
swap would be missed. `backfill-cohort` **refuses to run** while the switch is open, so this is
not optional.

Nothing is lost by closing. The client treats `503` as *"not now"* and keeps its buffer
(`src/main/telemetry/net.ts`), so a close measured in minutes costs nothing. The buffer is a
500-event ring (`TELEMETRY_BUFFER_CAP`) that drops its oldest, so a close measured in **days**
would start costing a busy install its oldest events. Do the whole sequence in one sitting.

### 2. Additive schema only

```bash
npx tsx scripts/triage-feedback.mts migrate --refresh --profile <profile>
```

`--refresh` because `.triage/stack.json` may predate `telemetry_lambda_role_arn`; `migrate`
stops and says so rather than sending an unsubstituted `${...}` to the cluster.

This adds `analytics_install.cohort` (the one cohort column an `ALTER` can add — it is not in a
key) and creates the `telemetry_ingest` role and its grants if they are not there. **The two
counter tables will report `exists`** — that is `CREATE TABLE IF NOT EXISTS` meeting the old
shape, and it is exactly why the next step exists. Nothing here drops or rewrites anything.

### 3. Copy every row into the new shape

```bash
npx tsx scripts/triage-feedback.mts analytics backfill-cohort --profile <profile>
```

One command, and it prints what it did per table. What it actually does:

* Creates `usage_daily_v2` and `usage_funnel_daily_v2` — **the cohort-keyed shape, with the
  `CREATE TABLE` text taken out of `infra/schema.sql` itself** so the staging table cannot drift
  from the table the app reads. (A schema whose PRIMARY KEY no longer carries `cohort` is refused
  outright.)
* `GRANT SELECT, INSERT, UPDATE` on both to `telemetry_ingest`. Privileges attach to the object
  rather than to the name, so these survive the rename in step 6 — which is what stops the new
  Lambda's first batch from being a permission denied.
* Fills `analytics_install.cohort` from what each row already **states** (`channel = 'dev'`, or a
  hand mark from `owner-add`).
* Copies **every** counter row, in pages of 500 (DSQL caps a transaction at 3,000 modified rows),
  through the store's bounded, jittered `40001` retry, with `ON CONFLICT … DO UPDATE SET n =
  EXCLUDED.n` — **assignment, not addition**, so re-running it converges instead of doubling.

**How the cohort is derived, and its one honest limit.** A counter row carries no id (that is the
entire point of aggregating on arrival), so the only truthful source is `analytics_install`:

* a day whose span is covered **only** by owner installs (dev-channel, or hand-marked) is
  `owner` — nobody else can have produced those rows, which is a derivation, not a guess;
* a day that **any user-cohort install could have contributed to** is `user`. There is nothing in
  the row to split on, so the alternative would be inventing a number;
* a day no surviving install row covers is `user` — the same fail-safe every reader of a NULL
  cohort takes.

So on days where the owner and a real user were both present, the owner's own use stays folded
into the user cohort **forever**. That is the honest limit of pre-split aggregates, and it is
precisely why the split had to become part of the KEY going forward. Everything from the swap
onward is exact.

### 4. Read the proof

```bash
npx tsx scripts/triage-feedback.mts analytics backfill-verify --profile <profile>
```

Prints, per table, the **row count and the sum of `n`** on both sides. The old → new mapping is
one-to-one (the new key adds `cohort`, which is a function of `day`, to a key that was already
unique), so a correct copy matches **exactly** on both numbers. A row count alone cannot see a
mangled counter, which is why it prints both.

If anything says `MISMATCH`: nothing has been dropped. Re-run step 3 (it is idempotent) and
verify again.

### 5. Swap — the only destructive step, and it re-checks first

```bash
npx tsx scripts/triage-feedback.mts analytics backfill-swap --profile <profile>
```

It **re-runs the verification itself** (a swap that trusted a check somebody ran an hour ago is a
swap that trusts a stale fact) and **refuses on any mismatch, having touched nothing**. On
success, per table and one DDL per transaction:

```sql
DROP TABLE usage_daily;                        -- now redundant: its rows are in the copy
ALTER TABLE usage_daily_v2 RENAME TO usage_daily;
```

`ALTER TABLE … RENAME TO` is **documented supported syntax in Aurora DSQL** ("There is no effect
on the stored data" — the same page this file already cites for the absence of `DROP COLUMN`:
<https://docs.aws.amazon.com/aurora-dsql/latest/userguide/alter-table-syntax-support.html>). That
is why the final table names never change and no reader, constant or Lambda statement has to be
re-pointed anywhere.

**If it dies between the two statements**, the data is intact under `usage_daily_v2` and every
reader answers `42P01` — which the CLI and the Analytics tab both render as the named "this
cluster is not migrated" state, not as a crash. Re-run the same command; it finishes the rename.

### 6. Put the cohort-aware Lambda live

```bash
cd infra
node build.mjs                     # BOTH zips FIRST — the plan hashes them
terraform plan  -var triage_principal_arn=arn:aws:iam::<acct>:user/<you>
terraform apply -var triage_principal_arn=arn:aws:iam::<acct>:user/<you>
cd ..
npx tsx scripts/triage-feedback.mts migrate --refresh --profile <profile>
```

The apply is what replaces the telemetry bundle with the one whose `INSERT` names `cohort`. The
`migrate` after it is confirmatory — it re-asserts the grants (idempotent) and will report
everything as `exists`.

**Order matters, and it is the same rule this file states for removing a column, in the other
direction: schema first, then the bundle that writes it.** Deploying the new bundle before the
swap would have every batch fail `42703`; doing it after is why the switch stays closed until
step 7.

### 7. Re-open, and prove it end to end

```bash
npx tsx scripts/triage-feedback.mts analytics open --profile <profile>

curl -si -X POST "$(cd infra && terraform output -raw telemetry_api_url)" \
  -H 'content-type: application/json' \
  -d '{"v":1,"env":{"analyticsId":"3f2504e0-4f89-41d3-9a0c-0305e82c3301","appVersion":"0.4.0","channel":"dev","platform":"win32","tzOffsetBucket":0},"events":[{"ts":1,"ev":{"t":"sessionHeartbeat","uptimeMs":1000}}]}'
# expect: HTTP/2 202  {"ok":true,"accepted":1}

npx tsx scripts/triage-feedback.mts analytics digest --cohort all --profile <profile>
```

The `202` proves the route, the function, the DSQL connection, the config read and a cohort-keyed
UPSERT all work. `--cohort all` prints the two digests side by side — the legacy rows are in
there, under the cohort the backfill derived, and nothing sums them.

### 8. Mark your own installed copy

```bash
npx tsx scripts/triage-feedback.mts analytics owner-add <analyticsId> --profile <profile>
npx tsx scripts/triage-feedback.mts analytics owner-ls --profile <profile>
```

Your DEV builds tag themselves from `env.channel` and need nothing. The installed copy has no
server-side signal at all, by design — a prod payload from the author is deliberately
indistinguishable from anyone else's — so read its id out of the app itself, **Preferences →
Usage analytics → "Anonymous id"**, and mark it once. A rotated id is a NEW id and arrives
unmarked: run `owner-ls` after a rotation and re-add.

**The client is LIT (2026-08-04).** `TELEMETRY_API_URL` in `src/main/telemetry/net.ts` names
the live `/v1/telemetry` route, and `tests/telemetryNet.test.mts` pins the exact URL, the one
fetch site, and the consent gates. The owner-approved lighting commit rewrote `SECURITY.md`,
added the README paragraph, and regenerated `TELEMETRY.md`, exactly as the dark-build pins were
designed to force. Data flows once `analytics open` flips `telemetry_accepting` AND clients run
a build carrying the constant (v0.3.2+).

### First time on a FRESH cluster (no counter tables at all)

There is nothing to copy, so the migration above does not apply: `migrate` creates the two
tables in their cohort-keyed shape, `terraform apply` puts both bundles live, and `analytics
open` starts collection. `backfill-verify` says `neither table exists — this cluster needs
migrate, not a backfill`, which is the check that tells the two situations apart.


### Day-2 for the telemetry route

| Situation | Command |
| --- | --- |
| Stop collecting NOW | `triage-feedback analytics close` (one statement; **no deploy**) |
| Start collecting | `triage-feedback analytics open` |
| Tighten the per-id daily event cap | `UPDATE feedback_config SET max_events_per_id_per_day = N` — deploy-free |
| A deletion request for an analyticsId | `triage-feedback analytics wipe --id <analyticsId>` |
| The numbers, as text | `triage-feedback analytics digest [--days N] [--json]` — **user cohort by default** |
| …including your own use | `triage-feedback analytics digest --cohort all` (two digests, never summed) |
| The numbers, in the app | Triage → Analytics (dev builds only); "Include mine (split)" adds the owner readout |
| Mark / unmark your installed copy | `analytics owner-add <analyticsId>` / `owner-rm <analyticsId>` / `owner-ls` |
| "Is anyone using it right now" | the `eqcompanion-telemetry` CloudWatch dashboard |
| Read the handler's logs | `aws logs tail "$(terraform output -raw telemetry_log_group)" --follow` |

`analytics wipe --id` deletes the `analytics_install` row, which is the id's entire footprint.
The counters it contributed to are anonymous sums — `usage_daily` holds "37 map opens on
2026-08-04" with no id in the table — so there is nothing in them to attribute, and subtracting
a guess would corrupt a true number to satisfy a request the data does not contain.

### The user/owner split — whose use is in the numbers

The owner runs this app more than anyone, so their own use is signal about the *build* and
noise in every number about the *user base*. Every counter row therefore carries a
`cohort` ('user' or 'owner'), and **every read path defaults to `user`**. Nothing anywhere sums
the two: `--cohort all` prints two digests, and the tab renders two readouts.

Two mechanisms, because the two cases are genuinely different:

* **Dev builds tag themselves, server-side, with no client change.** `env.channel` has been in
  the telemetry envelope since the contract was written (`TELEMETRY.md` documents it), so the
  ingest handler derives the cohort from a field it already receives. Nothing new is
  transmitted for this feature.
* **The installed copy is marked by hand, once, by `analyticsId`.** A prod payload from the
  author is deliberately indistinguishable from anyone else's — that is what the id is for — so
  there is nothing to infer and any guess would mislabel a real user. `analytics owner-add`.

**FROM-MARKING-ONWARD.** Counters are anonymous sums with no id in them, so rows already
aggregated under `user` cannot be re-attributed when you mark an install, and are left alone.
The digest states this in its header on every render. **A rotated `analyticsId` is a new id and
arrives unmarked** — run `owner-ls` after a rotation and re-add.

**If a cluster already has the pre-cohort counter tables — and the live one does.** `cohort` is
part of the PRIMARY KEY of `usage_daily` and `usage_funnel_daily` (the `ON CONFLICT` target needs
it to be), and DSQL's `ALTER TABLE` cannot change a primary key — so unlike
`analytics_install.cohort`, there is no in-place migration for those two, and
`CREATE TABLE IF NOT EXISTS` silently reports `exists` against the old shape.

**The recovery is a COPY. Nothing is dropped until a verified copy exists** — the ordered
commands are the runbook at the top of this file (`analytics backfill-cohort` →
`backfill-verify` → `backfill-swap`). An earlier version of this paragraph said to
`DROP TABLE usage_daily` and re-migrate; that was written when these tables were believed never
to have been created, and it is wrong: they have been counting behind a lit client since
2026-08-04 and may hold real users' rows.

What the copy can and cannot recover: a row carries no id, so a **day** is labelled from what
`analytics_install` states about who could have reported it — owner only if no user-cohort
install's span covers that day, `user` otherwise. Days the owner shared with a real user stay
folded into `user`. That is the honest limit, and it is the reason the split is a KEY from the
swap onward rather than a filter applied at read time.

## PENDING: the perf cube (JOS-372) — two steps, in this order, and NO client step

`usage_daily` carries one dimension per row, so it can count stalls and can never say whether
they cluster on exclusive-fullscreen installs, on small boxes, or while an overlay is locked.
`perf_daily` is the one cube that can: five closed dims wide, one row per session report that
carried a live stall reading, and **still no raw event store**. The reasoning and the cardinality
budget are written where the table is, in `infra/schema.sql`.

**Schema-first**, exactly as the inventory columns were, and for the same reason: `INSTALL_SQL`
in `infra/lambda/telemetry.ts` names `machine_class, window_mode` unconditionally, and naming a
column that does not exist is `42703` on **every batch**, instantly, with the endpoint open.

1. **Schema.** `npx tsx scripts/triage-feedback.mts migrate --profile <profile>` — it applies, all
   idempotent (`exists` on a cluster that already has them):

   ```sql
   CREATE TABLE IF NOT EXISTS perf_daily (
     day           text   NOT NULL,
     cohort        text   NOT NULL,
     window_mode   text   NOT NULL,
     machine_class text   NOT NULL,
     locked        text   NOT NULL,
     stall_bucket  text   NOT NULL,
     tail_bucket   text   NOT NULL,
     n             bigint NOT NULL,
     PRIMARY KEY (day, cohort, window_mode, machine_class, locked, stall_bucket, tail_bucket)
   );
   ALTER TABLE analytics_install ADD COLUMN machine_class text;
   ALTER TABLE analytics_install ADD COLUMN window_mode text;
   GRANT SELECT, INSERT, UPDATE ON perf_daily TO telemetry_ingest;
   ```

   `SELECT` rides along with `INSERT`/`UPDATE` because `ON CONFLICT DO UPDATE SET n = perf_daily.n
   + EXCLUDED.n` reads the existing row to evaluate the sum. **No `DELETE`**, like every other
   telemetry grant. The TRIAGE reader needs no grant at all — it connects as `admin`.

   The primary key is **seven columns**. That is one more than `usage_funnel_daily`'s six, so it is
   the one statement here worth watching the `migrate` output for; the runner prints the failing
   statement rather than half-applying anything.

2. **Infra.** `node infra/build.mjs` (THE DEPLOY LAW — the plan hashes the zips), then
   `terraform plan` / `terraform apply`. Only `source_code_hash` moves: no new resource, no new
   permission, no Terraform change of any kind. The bundle is the telemetry Lambda, which then
   starts writing the cube and the two install columns.

**There is no client step, and there cannot be one to wait for.** Nothing new crosses the wire:
both dims are derived **server-side** from `setupSnapshot` fields that shipped with JOS-364, and
the stall/tail/state riders shipped with JOS-367. A client that predates either simply produces
`unknown` dims, which is a real class in the cube rather than a missing value.

**NO BACKFILL IS POSSIBLE.** The pipeline keeps no raw events (plan T6), so yesterday's heartbeats
do not exist in any form that could be re-folded. The table starts on the day step 2 lands, and
both readouts (Triage → Analytics → "Stalls by", and `analytics digest`) say "no rows in this
window" rather than printing zeros.

**Reading it:** `triage-feedback analytics digest` prints the three cross-tabs under the LIVE
SESSIONS section — user cohort by default, `--cohort all` for both side by side, and as everywhere
else nothing is ever summed across cohorts *or* across the three cuts (they are the same reports
sliced three ways).

## PENDING: the inventory attachment (JOS-296) — three steps, in this order

A bug report can now carry a **second** attachment beside the log slice: the player's
`/outputfile inventory` dump, gzipped, on its own presign, under its own `inventory/` prefix.
The client half is on `main`; **nothing below has been applied yet.**

Adding a column is the **schema-first** order (the section below explains why removing one is
the reverse), and the client is a third step behind both:

1. **Schema.** `npx tsx scripts/triage-feedback.mts migrate --profile <profile>` — applies
   `ALTER TABLE report ADD COLUMN inventory_json text` and `… inventory_key text`. Idempotent;
   a cluster that already has them reports `exists` (42701).
   *Why first:* the new handler's `INSERT` names both columns unconditionally, and naming a
   column that does not exist is `42703` on **every** submit, instantly, with the endpoint open.

2. **Infra.** `node infra/build.mjs` (THE DEPLOY LAW — the plan hashes the zips, so a plan run
   without a build deploys nothing), then `terraform plan` / `terraform apply`. Three things
   change beside the bundle, and each is additive:
   - `iam.tf` — the ingest role may now presign `inventory/*` as well as `logs/*`, and the
     triage role may Get/Delete/List it. Presigning is bounded by what the signer itself may
     `PutObject`, so this list *is* the set of paths a client can be granted.
   - `s3.tf` — a **second** lifecycle rule, `expire-inventory-dumps`, on the same window. The
     existing rule filters on `logs/` and would never have touched the new prefix, so without
     this the dumps would live forever.
   - `lambda.tf` — untouched; only `source_code_hash` moves.

3. **Client.** Only then does a release carrying the new field go out. A client that declares an
   `inventory` attachment to a server without the columns gets a 500 on every report; one that
   declares it to a server without the presign permission uploads nothing and says it did.
   The reverse order is safe in the other direction: the new server accepts an old client
   unchanged, because `inventory` is an **additive optional** field and
   `FEEDBACK_API_VERSION` deliberately stays `1` (a bump is a hard gate — see the constant's
   note in `src/shared/feedback.ts`).

Smoke it with the local stack first (`npm run dev:stack`), which mints the same two presigns and
enforces the same policy: `tests/devFeedbackServer.test.mts` covers both legs.

## Removing a column: the ordering, and what DSQL will not do

**THE BUNDLE GOES FIRST, THEN THE SCHEMA.** A running Lambda that still names a
column in its `INSERT` starts failing with `42703 undefined_column` the instant
that column disappears — every submit, immediately, with the endpoint open. So:

1. `npm run build` in `infra/`, `terraform apply` — the new bundle is live and its
   `INSERT` no longer names the column.
2. *Then* change the live schema.

Reversing the two turns a cleanup into an outage. Adding a column is the opposite
order (schema first, then the bundle that writes it), for the same reason.

**`title` and `contact` are the worked example, and step 2 is blocked.** Both left
the wire contract, then `schema.sql`, then every reader — so a stack migrated from
today's `schema.sql` never has them. A cluster migrated *before* that still does,
and **Aurora DSQL cannot drop a column**: its documented `ALTER TABLE` grammar has
no `DROP [COLUMN]` action at all (it has `DROP DEFAULT`, `DROP NOT NULL`,
`DROP EXPRESSION`, `DROP IDENTITY` and `DROP CONSTRAINT` — and not that one). See
<https://docs.aws.amazon.com/aurora-dsql/latest/userguide/alter-table-syntax-support.html>.
Putting the statement in `schema.sql` anyway would fail the whole `migrate` run on
a syntax error, so it is not there.

What *is* available is destroying the values, which is the point of the exercise:

```sql
UPDATE report SET title = NULL, contact = NULL
 WHERE title IS NOT NULL OR contact IS NOT NULL;
```

Run it once, as `admin`, against a cluster that predates the change — never as part
of `migrate`, because on a cluster built from today's `schema.sql` those column
names do not resolve. It is idempotent (the `WHERE` makes a re-run touch nothing)
and it is bounded by DSQL's **3,000-modified-rows-per-transaction** cap: if the
backlog is ever larger than that, run it in `report_id`-keyed batches. Afterwards
the columns are empty shells — no reader anywhere names them — and the physical
drop stays open until DSQL grows the grammar for it.

## Validate without touching the cloud

Exactly what CI runs. No credentials, no state, no lock:

```bash
cd infra
terraform fmt -check -recursive
terraform init -backend=false
terraform validate
node build.mjs
```

Note what this does **not** cover: `schema.sql` is never executed by CI (there is
no cluster to execute it against), so a SQL typo surfaces at `migrate` time. That
is the same trade as every migration in every repo, and `migrate` stops on the
offending statement and prints it.

## What a client sends is never trusted — where each rule lives

Sanitization used to be entirely **client-side**: `src/shared/logScrub.ts` and the
bounds in `src/shared/feedback.ts` both run in the app before a byte leaves the
machine, and the server trusted that an honest client had run them. A hostile or
buggy client is not obliged to. The rules below close that at every boundary we
actually control; each is enforced in code, and the code says so at the site.

| Boundary | Rule | Where |
| --- | --- | --- |
| Raw HTTP body, both routes | a **NUL byte anywhere** is refused *before* `JSON.parse` — step 1.5, right after the size check | `lambda/submit.ts`, `lambda/telemetry.ts`, `hasNulByte` in `src/shared/sanitizeText.ts` |
| `draft.description` (multi-line prose) | control characters are **STRIPPED**: whole ANSI/VT escape sequences, C0 minus TAB/LF, DEL, C1, and the zero-width/BiDi/BOM class. CRLF and CR normalize to LF. Then trim, then the length bound | `validateDraft` in `src/shared/feedback.ts` |
| `env.*` free-form strings (`platform`, `osRelease`, `arch`, `electron`, `chrome`, `node`) | **any** control or invisible character is **REJECTED** `400 invalid_payload`, naming the field. These are `os.release()` and `process.versions.*`; none can legitimately hold one | `validateEnv` in `src/shared/feedback.ts` |
| `appVersion`, `installId`, `clientReportId`, `log.sha256` | already regex-pinned to closed character sets, and JS `$` matches only end-of-input — no extra rule, deliberately | `src/shared/feedback.ts` |
| Every telemetry field | the schema has **no free-text slot at all**: every string is enum- or regex-bound, and the validators *construct* the value field by field rather than sanitizing it | `src/shared/telemetryValidate.ts`, pinned by `tests/wireSanitize.test.mts` + `tests/telemetryContract.test.mts` |
| The uploaded log slice | the presign policy pins the **key, size and content-type — it cannot pin the content**. So a downloaded slice is **re-scrubbed on read** with the app's own shared scrubber, and each line is sanitized, before it touches the owner's disk. The delta is reported: the CLI prints it, the triage tab shows a warning chip. **The S3 object is left untouched — it is the evidence** | `downloadSlice` in `src/main/triage/store.ts`, `rescrubSlice` in `src/main/triage/rows.ts` |
| Anything printed at the owner | every client-supplied string is stripped of ANSI escapes and control characters before it reaches the terminal or the triage tab — a report must not be able to retitle the operator's window, clear their screen, or write their clipboard via OSC 52 | `sanitizeOneLine`/`sanitizeMultiline` in `src/shared/sanitizeText.ts`, applied in `store.ts` (CLI) and `rows.ts` (tab) |

**Strip vs reject is not an inconsistency.** Removing a control character is
*normalization*, the same act as the `trim` the validators have always done —
nobody types a NUL into a bug report, so nothing the user wrote is shortened, and
REJECT-NEVER-TRUNCATE (which is a law about **length**) is untouched. A single-line
runtime string is different: there is no benign reading of an ESC in `os.release()`,
so the honest answer is a 400 rather than a quiet repair.

**The re-scrub delta is a signal, not noise.** An honest client already ran the
identical module, so its delta is **zero**. A non-zero one means the object in the
bucket holds third-party chat our client would have removed — evidence that the
upload did not come from our client. `triage-feedback show <id>` prints it; the
triage tab shows it above the slice.

## Day-2 operations

| Situation | Command |
| --- | --- |
| Active flood — stop everything now | `triage-feedback closed on --message "..."` (one statement; **no deploy**) |
| One install spamming | `triage-feedback block <installId> --reason "..."` |
| Tighten the daily quota | `UPDATE feedback_config SET max_per_install_per_day = N` — deploy-free |
| Deletion request | `triage-feedback forget <reportId>` (the slice) / `wipe --install <id>` (everything) |
| Schema change | edit `schema.sql`, then `triage-feedback migrate` |
| Read the handler's logs | `aws logs tail "$(terraform output -raw lambda_log_group)" --follow` |
| Who hit us | `aws logs tail "$(terraform output -raw api_access_log_group)"` (source IPs, 14-day retention, incident-only) |

The kill switch and the quota live in the database precisely so that answering
abuse never requires a release. The app fetches no configuration at any point —
the kill switch rides in the submit response.

## Retention, and the one thing DSQL does not do

| Data | Retention | Mechanism |
| --- | --- | --- |
| Report row | indefinite — it *is* the backlog | none |
| `usage_daily` / `usage_funnel_daily` | indefinite | none — they are anonymous daily sums with no id in them, and the whole point of the aggregates-on-arrival design (plan T6) is that there is no per-user trail to expire |
| `analytics_install` | indefinite; deleted on request | `triage-feedback analytics wipe --id`. One row per analyticsId, and the only per-id row this feature has |
| Log object | 90 days | **S3 lifecycle — unchanged**; `triage-feedback forget <id>` deletes one on request |
| Quota counters (3 d), idempotency keys (7 d), dedupe probes (2 d) | lazy | swept by the ingest handler |
| Lambda / API access logs | 14 days | CloudWatch retention |

**DynamoDB had TTL. DSQL has nothing.** So the three counter tables are swept by
the ingest path itself (`infra/lambda/db.ts`), immediately after a submit clears
the quota gate: at most once per 10 minutes per warm container, at most 200 rows
per table per pass, and every failure logged and swallowed. The bound is not
politeness — DSQL caps a transaction at 3,000 modified rows, so an unbounded
`DELETE` would eventually *fail* rather than merely be slow.

The consequence, stated plainly: expired rows go away **as traffic flows**, not on
a clock. If ingest goes idle they linger. That costs a few kilobytes and leaks
nothing (an installId is an anonymous token, §9.3), and the alternative — an
EventBridge rule plus a second Lambda to delete six rows a week — is more moving
parts than the problem deserves.

## Teardown

`terraform destroy` **will fail**, twice over and on purpose: the bucket and the
cluster both carry `lifecycle { prevent_destroy = true }`, and the cluster also
has service-side `deletion_protection_enabled`. A teardown cannot take
user-submitted evidence and the whole backlog with it. Undoing both is the
deliberate act that makes a real teardown possible. Do it in a commit, not in a
panic.

## Cost shape

DSQL bills request-based DPU plus storage — nothing to provision, nothing to
autoscale, no capacity setting that turns a flood into a bill (the same property
`PAY_PER_REQUEST` bought before). The free tier is 100k DPU and 1 GB/month, which
is orders of magnitude past this product's volume. Around it: a 2 rps route
throttle, reserved concurrency 5, a 2 MB S3-enforced upload cap, 90-day object
expiry and 14-day log retention. An attacker saturating the route throttle for a
full month is roughly 5.2 M requests — about $5 of API Gateway plus bounded
Lambda/DSQL, under the $10 budget and alarmed within five minutes.

## Gotchas

- **Build before you plan.** `source_code_hash` reads `dist/submit.zip` and
  `dist/telemetry.zip`. Both are guarded by `fileexists()` so `terraform validate` works on a
  clean checkout, but a plan without a build deploys nothing useful.
- **A NEW OUTPUT MEANS A STALE `.triage/stack.json`.** The cache is read back without
  re-validating (it is a cache, not a contract), so a stack.json written before
  `telemetry_lambda_role_arn` existed simply has no value for it. `migrate` catches that on the
  SUBSTITUTED text — an unresolved `${...}` stops the run and says `--refresh` — because an
  `AWS IAM GRANT … TO '${…}'` reaching the cluster literally would map the role to nothing and
  fail much later, much more confusingly.
- **`ALTER TABLE … ADD COLUMN` is how the config row grew, and it is not spelled
  `IF NOT EXISTS`.** DSQL's supported ALTER grammar is a documented subset and that clause is
  not in it, so a self-guarding statement would risk failing the whole run on syntax. Instead
  the migrate runner treats `42701 duplicate_column` as "already there", exactly as it already
  treats `42P07` for a table. Adding a column is therefore idempotent; **removing** one is
  still impossible (see the section above).
- **The zip is byte-deterministic** (fixed 1980 timestamps). Rebuilding without a
  source change produces the same hash and therefore no redeploy. Do not "fix"
  that by stamping the current time.
- **`pg` is bundled pure-JS.** `build.mjs` replaces `pg-native` and
  `cloudflare:sockets` with a stub that throws if anything ever evaluates it.
  Nothing does; do not "fix" it by installing `pg-native`.
- **`bigint` comes back as a string.** Both readers set node-postgres's int8 type
  parser to `Number` once, at module scope. Every bigint in this schema is an
  epoch-millisecond or a byte count, so the conversion is exact — but a new
  `bigint` column that is a real 64-bit integer would need its own handling.
- **Retry is part of the contract.** DSQL takes no locks; a write that raced is
  aborted at commit with SQLSTATE `40001`. Every write in the handler and the CLI
  goes through a bounded, jittered retry. Code that talks to this database
  directly must do the same.
- **Alarm dimensions are not interchangeable.** DSQL's usage (DPU) metrics key on
  `ResourceId`; its observability metrics key on `ClusterId`. The wrong one gives
  an alarm that sits in `INSUFFICIENT_DATA` forever and never fires.
- **The stage is `$default`, not `v1`.** A named stage prefixes every path, so
  stage `v1` + route `/v1/feedback` would resolve at `/v1/v1/feedback`. The
  version lives in the path; `api.tf` explains it at length. `/v1/telemetry` rides the same
  stage, for the same reason.
- **EMF is a LOG LINE, not an API call.** The telemetry dashboard is fed by JSON documents the
  handler writes to stdout (`infra/lambda/emf.ts`); CloudWatch extracts the metrics from the log
  group. So a metric that never appears has a typo in `_aws`, not a permission problem — a
  malformed document is silently just a log line. Never put an analyticsId in a dimension: a
  dimension value mints a billed metric and would rebuild, in the metrics store, exactly the
  per-user trail the storage design refuses to keep.
- **`.triage/stack.json` is a cache.** After an apply that renames anything, run
  the triage CLI once with `--refresh` (or delete the file).
