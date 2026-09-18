# SQL migration — Upstash Redis -> SQLite (Turso) — plan & ledger

Status: **live in production since 2026-09-14** (squash-merged as PR #1). The
7-day migration fallback window closes **2026-09-21**, after which
`api/_db/fallback.ts` and `@upstash/redis` are removed and Redis is
decommissioned. Owner: maintainer. Supersedes the Redis
storage layer in `api/session.ts` only; the client protocol (`docs/sync.md`) is
unchanged.

## Goal

Move the sync backend from Upstash Redis to a SQLite-compatible SQL store, with
a DB-agnostic data layer so the same code runs on SQLite (Turso or local file)
and, if ever needed, Postgres (Neon).

Motivation: Upstash free tier is 500K commands/mo. Current per-user cost is
~5K/mo normal, ~17K/mo always-open idle (docs/sync.md quota budget), so ~100
normal users or ~29 idle tabs. SQL metering is per row, not per command, and
Turso free is 500M row reads / 10M row writes / 5GB. The user-capacity gain is
**about 10x, writes-bound** (~100 -> ~1000 users), not the ~1000x the raw metric
ratio suggests. Latency is a non-issue: sync is a throttled background loop
(3s push debounce, 5min pull, 15min idle pause).

## Locked decisions

1. **Keep per-field LWW.** The server stores one row per flat key
   (`PK(session_id, key)`), not one blob per session. Whole-blob LWW
   reintroduces `docs/sync.md` finding #10 (concurrent PATCHes from two devices
   drop each other's keys). Correctness is non-negotiable.
2. **Keep the wire key verbatim, including `@bucket`.** `v:{cid}:{tid}@{bucket}`
   etc. are stored as-is. This preserves the rev-3 stale-device safety property
   (a stale device writes to its old bucket; no device reads it) with zero new
   server logic, and needs no client change. Bucket stripping was considered and
   rejected: it forces an ordered guard (`incoming.bucket >= stored.bucket`) or
   a stale device can clobber the current value.
3. **Live rows only, and GC must physically DELETE.** GC_DAYS drops 60 -> 8: the
   longest real lifetime is a weekly key (7 days) plus one day of grace. Old
   buckets are still inert at read time (`bucketize` current-bucket filter), so
   GC is a storage trim, not a correctness mechanism.
   The delete is load-bearing: today the client PATCHes expired cycle keys as
   `null` and Redis **retains** the tombstone (`api/session.ts:429`), so over a
   180-day session rows accumulate regardless of GC_DAYS and "live rows only"
   would be false. New rule for the SQL layer: **a `null` value for a cycle key
   (`v:`/`acc:` with an `@bucket`) is a DELETE; a `null` for any other key is a
   retained tombstone** (persistent tombstones stay, per `docs/sync.md` #3). It
   needs only the wire shape (`key.includes("@")` + prefix), no task semantics,
   and is invisible to readers (a missing row and a `null` tombstone are both
   non-adopted). The client already sends exactly these nulls
   (`src/sync/SyncButton.tsx:224-231`), so the protocol does not change.
4. **DB-agnostic data layer.** `api/session.ts` keeps HTTP shape, validation,
   limits, and prefixes; all storage goes through a narrow `Db` interface.
   SQLite driver first (`@libsql/client/web`), Postgres driver optional later.
   Note libSQL/SQLite is single-writer; Postgres has different write contention.
   Irrelevant at this write rate, but the drivers are not byte-identical under
   load.
5. **Local dev needs no cloud.** `pnpm dev:api` uses a local `file:` libSQL
   database. Turso Cloud is only for deployed environments.
6. **Rate limiting stays server-side and in-memory.** No WAF (over-engineering
   for an unauthenticated app with no abuse incentive), no Turso counter table
   (writes are the protected metric), no Redis (the quota being left). A small
   per-instance in-memory limiter in `api/session.ts` replaces the Redis `INCR`.
   Best-effort is fine: it is runaway-loop hygiene, not security, and Vercel's
   free DDoS mitigation covers volumetric attacks.
7. **Seamless migration: bulk export + short lazy fallback.** Existing session
   ids must keep working with zero user action, so do not ask anyone to re-link.
   Primary mechanism is a one-time export of every live session (hash and
   legacy blob) from Upstash into SQL, run right before cutover; every link
   stays valid. A lazy read-through fallback (on SQL miss, read Upstash, import,
   serve) is kept for **7 days** after cutover to close the deploy race, then
   removed. This is a migration-cutover window and has nothing to do with the
   app's visible daily/weekly cycles or GC_DAYS. The bulk export already carries
   every existing session, so the fallback only covers the race window.
   This is seamless and small effort, so the "just re-link" option is not needed.

## Rate limiter options

Turso has **no rate limiter**: only DB authn/authz (tokens, JWKS, fine-grained
permissions), Database Access Allow Rules (IP allowlist), and durability. So the
limiter has to come from the platform or the app.

| Option | Cost | Accuracy | Notes |
|---|---|---|---|
| Vercel WAF rate limit | 0 DB writes; mitigated traffic free | per-region edge, exact | Hobby: 1 rule, IP/JA4 key, fixed window 10s-10min, 1M included allowed requests. Pro: 40 rules. **Rejected: over-engineering for this app.** |
| **In-memory per-instance** | **0** | approximate | **Chosen.** `Map` sliding window in `api/session.ts`. Not shared across instances, resets on cold start. Deterrence only. |
| Turso counter table | 1 write/request | exact | Rejected: writes are the exact metric the migration is protecting (10M/mo). |
| Upstash Ratelimit / keep Redis | ~1 cmd/request | exact | Rejected: reintroduces the command-quota problem being left. |

**Decision**: in-memory only. The old Redis limit was runaway-loop hygiene, not
security, so a best-effort per-instance cap is enough; do not add a WAF rule, a
SQL counter, or keep Redis for it.

## Open questions

None. Resolved: rate limiter = in-memory only (decision 6); fallback window =
7 days (decision 7).

## Research (verified 2026-09-14)

### Turso locations & latency

- Turso Cloud current primary locations (Platform API `GET /v1/locations`) are
  **AWS only, 6 regions**: `aws-us-east-1`, `aws-us-east-2`, `aws-us-west-2`,
  `aws-eu-west-1`, `aws-ap-south-1` (Mumbai), `aws-ap-northeast-1` (Tokyo).
  There is **no Taiwan, Hong Kong, or Singapore primary**. The Fly locations on
  the status page are legacy. For Taiwan users the closest is **Tokyo**.
  Confirm with `turso db locations` (authoritative; the Platform API list may
  lag).
- Vercel function regions (`vercel.com/docs/regions`): `hnd1` = Tokyo
  (`ap-northeast-1`), `kix1` = Osaka, `icn1` = Seoul, `hkg1` = Hong Kong,
  `sin1` = Singapore. **Hobby plan = single region.**
- Vercel PoPs terminate TCP near the user and forward to the region over the
  private network at "single-digit millisecond" latency. So the real budget is
  (Taiwan -> nearest PoP -> `hnd1`) plus (`hnd1` -> Turso Tokyo). Co-locating
  the function and DB in Tokyo makes the second hop ~1-3ms. Picking `hkg1`
  (closer to users) would push the DB hop to ~40-50ms for no benefit on a
  background loop.
- **Decision: Turso primary `aws-ap-northeast-1` (Tokyo) + Vercel functions in
  `hnd1`.** Verified 2026-09-14: prod `GET /api/session` returns
  `X-Vercel-Id: hkg1::hnd1::...` (first = edge PoP Hong Kong, second = region
  the function executed in, per Vercel request-headers docs). Functions are
  **already** in `hnd1` (Tokyo): the project's Vercel setting pins it, so no
  `vercel.json` region change is needed. Only the DB has to be created in
  Tokyo to co-locate.

### Uptime (90-day windows, status pages)

- Turso: reported 100% for AWS Tokyo; AWS us-east-1 99.987%. One platform
  incident, **Aug 4 2026** ("Elevated errors of 502 on database queries",
  ~48min degraded, ~30 customers, root cause a multitenant server plus a
  routing-layer retry cascade). Fly Tokyo 99.969%.
- Upstash: Redis itself clean over 90d; only a Vector DNS blip in us-east-1
  (~20min) and a Console login issue.
- Read: Turso is a materially smaller operator and has had one real
  database-query incident in the window. The client is already failure-tolerant
  (offline-safe, local state stands, pull fails silent), so a backend blip
  degrades sync freshness, not data. Acceptable; track as a risk.

### Turso free tier & metering

- Free: **100 databases, 5GB storage, 500M rows read/mo, 10M rows written/mo,
  3GB syncs/mo, 1-day PITR.** Exceeding any single metric on Free returns a
  `BLOCKED` error (overages are a paid-plan feature), so a blown write budget
  blocks sync until the month rolls or the plan upgrades.
- Metering: a "row read" is a row scan (indexes matter), a "row written" is an
  insert or an update. An UPSERT / UPDATE reads *and* writes each modified row.
- Turso Cloud quirk: `PRAGMA user_version` and `application_id` are read-only;
  track schema migrations in a `_schema_version` table. `journal_mode` and
  `busy_timeout` are managed internally. `VACUUM` is currently disabled, so
  deleted rows do not shrink the file (irrelevant at this size, but do not rely
  on VACUUM to reclaim).
- Drivers: `@libsql/client/web` (HTTP, works in Vercel Node/Edge, ORM support)
  or `@tursodatabase/serverless` (fetch-only). Use `@libsql/client/web`.

## Quota estimate at 1000 users

Model (from `src/sync/flat.ts` and `docs/sync.md`): at GC_DAYS=8 a 3-char user
holds up to 8 daily buckets + 2 weekly buckets per task, **N ≈ 230 rows** (not
60): 3x5 daily x8 + 3x6 weekly x2 + 6 account-daily x8 + 3 account-weekly x2 +
persistent names/pins/customs/meta ~17.

Per pull: 1 probe row read (`sessions.updated_at`), plus a full GET of N rows
only when changed. Per push: `M` changed keys = `M` upsert reads + `M` writes
(the UPSERT reads the conflicting row), plus 1 read + 1 write on `sessions`,
plus the cap check. Pushes are 0 cost when clean (diff short-circuits).

**Cap check must not scan the row set.** The Redis path gets the existing field
set free from the same `HGETALL` (`api/session.ts:412-419`). Naively porting
that to `SELECT key FROM kv WHERE session_id = ?` is +N reads *per PATCH* and
dominates everything (~414K reads/user/mo heavy, ~8x the numbers below). Read
only the changed keys instead (`WHERE key IN (changes)`, M rows) and keep
`field_count` on `sessions`: reject when `field_count + fresh > 5000`, then set
`field_count = field_count + fresh` in the same batch.

| Profile / user | Reads/mo | Writes/mo |
|---|---|---|
| Light: 30 polls/day, 10 real pushes/day, 2 keys each | ~65K | ~0.9K |
| Heavy: 288 polls/day (idle tab), 60 real pushes/day, 3 keys each | ~121K | ~7.2K |

| Scenario (assumes 2 devices/user) | Reads vs 500M | Writes vs 10M | Storage vs 5GB |
|---|---|---|---|
| 1000 light users | 130M (26%) | 1.8M (18%) | ~60MB (~1%) |
| 1000 heavy users | 242M (48%) | 14.4M (144%, BLOCKED) | ~60MB (~1%) |

Takeaways:

- **Reads and storage are safe but not free.** 1000 heavy users on 2 devices
  each reach ~48% of reads, so there is ~2x headroom, not an order of magnitude.
  A bug that adds a per-PATCH full scan (above) would erase it.
- **Writes are the only real ceiling.** Free comfortably holds ~1000 users at
  light-to-moderate activity. Very heavy multi-device writers reach the 10M
  write cap; if that happens, either Turso Developer ($4.99/mo, 2.5B reads /
  25M writes) or shaving rows written per push.
- **The limiter must not touch `kv`.** Even the in-memory one is fine; any
  per-request SQL row write would add ~8.6K writes/mo per idle tab, most of a
  user's budget.

## Target architecture

### Schema (SQLite dialect; Postgres uses `BIGINT`/`TEXT` unchanged)

```sql
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,   -- session uuid, verbatim (no namespace prefix)
  updated_at  INTEGER NOT NULL,   -- ms epoch (matches Date.now()); ?meta=1 probe
  seq         INTEGER NOT NULL,   -- meta seq, monotonic per session
  expires_at  INTEGER NOT NULL,   -- ms epoch; 180d sliding TTL
  field_count INTEGER NOT NULL,   -- current kv rows; bounds MAX_HASH_FIELDS
  meta        TEXT NOT NULL,      -- tagged-JSON { v:2, updatedAt, writerId, seq }
  legacy      TEXT                -- non-null for un-upgraded v1/v2 JSON blobs
);

CREATE TABLE IF NOT EXISTS kv (
  session_id TEXT NOT NULL,
  key        TEXT NOT NULL,      -- flat sync key verbatim, incl. @bucket
  value      TEXT NOT NULL,      -- "j:" + JSON tagged value
  PRIMARY KEY (session_id, key)
);

CREATE TABLE IF NOT EXISTS _schema_version (version INTEGER NOT NULL);
```

`updated_at` and `expires_at` are **ms epoch** (Redis TTL was seconds; the
in-memory `Date.now()` ms is the reference here). `legacy` preserves the pre-hash
upgrade path exactly: GET serves it as `{ legacy, updatedAt }`, and the first
PATCH imports it into `kv` and nulls the column (parity with the Redis
`bareKey` -> `hashKey` upgrade). Because that import can now be one transaction,
the Redis NX-lock dance (`api/session.ts:444-503`) is unnecessary; keep the
observable behavior identical.

### Data layer (`api/_db/`)

- `types.ts`: `Db { createSession(id, changes), getMeta(id), getFlat(id),
  getLegacy(id), putFlat(id, changes, meta), deleteSession(id), touch(id) }`.
  `putFlat` implements the null-is-DELETE-for-cycle-keys rule (decision 3); no
  separate `deleteKeys` needed. No `sweepExpired` (TTL is lazy, see below).
- `sqlite.ts`: `@libsql/client/web` for `libsql://` / `file:`
- `postgres.ts`: `@neondatabase/serverless` (optional, later)
- `index.ts`: pick driver from env (`TURSO_DATABASE_URL` / `DATABASE_URL` /
  default local `file:`), translate `?` placeholders per dialect if a second
  driver lands.
- `api/session.ts` keeps: prefix list, `validSyncKey` / `validSyncValue` /
  `invalidMapReason`, `MAX_KEY_LEN` / `MAX_STR_LEN` / `MAX_VALUE_BYTES` /
  `MAX_KEYS_PER_REQUEST` / `MAX_HASH_FIELDS`, prototype-name rejection,
  `Cache-Control: no-store`, HTTP method shape, status codes. Only the storage
  calls change.

**PATCH is one atomic batch** (parity with the single `HSET`, `api/session.ts:429`).
It must write the `kv` rows *and* the `sessions` probe row together, or the
`?meta=1` probe can miss a change (or report one that never landed). On libSQL
HTTP that is one `client.batch([...], "write")`:

```sql
-- changed keys whose value is not null, plus fresh non-null inserts
INSERT INTO kv (session_id, key, value) VALUES (?, ?, ?)
ON CONFLICT(session_id, key) DO UPDATE SET value = excluded.value;

-- cycle keys set to null: real delete (decision 3)
DELETE FROM kv WHERE session_id = ? AND key IN (...cycle keys being nulled...);

-- probe + count + meta
UPDATE sessions
   SET updated_at = ?, seq = seq + 1, field_count = field_count + ?, meta = ?
 WHERE id = ?;
```

Persistent-key nulls stay as ordinary `INSERT ... ON CONFLICT` rows with value
`j:null` (retained tombstones). Creating a session is the same batch against an
empty session. The cap check reads `SELECT key FROM kv WHERE session_id = ? AND
key IN (changed)` (M rows) to count `fresh` before the batch.

### Environments

| Env | Database | Vercel region |
|---|---|---|
| local `pnpm dev:api` | `file:./dev.db` (node:sqlite) | dev1 |
| Preview | shared Turso database | `hnd1` |
| Production | shared Turso database | `hnd1` |

Driver selection keys on `VERCEL_ENV`: local/none -> file, production/preview
-> `TURSO_DATABASE_URL`, and `DATABASE_URL` overrides both (tests/scripts). So
local dev is a throwaway file even though `.env.local` carries the Turso
credentials for the `--remote` suites.

One Turso database is shared by Preview and Production on purpose: a solo
maintainer testing the branch, with no other users yet, judged per-env
databases as unneeded complexity. Accepted consequences: preview test rows and
quota spend land in the production database, and a schema mistake in preview
would hit production first. Mitigations: the export script can snapshot to a
file (`--apply --db file:...`), Turso free has 1-day PITR, the migration is
additive/idempotent, and the previous revision (Redis) plus untouched Redis
data remain a rollback for the 7-day window. Revisit a separate dev database
once there are real users.

## TODO ledger

### P0 — decisions (done)

- [x] Confirm per-field LWW is required (keep `PK(session_id, key)`).
- [x] Confirm wire key stays verbatim incl. `@bucket`.
- [x] Pick Turso free, Tokyo primary.
- [x] Confirm Vercel functions already run in `hnd1` (verified via `x-vercel-id`).
- [x] Seamless migration strategy: bulk export + short lazy fallback (decision 7).
- [x] Rate limiter approach chosen: in-memory only, no WAF (decision 6).
- [x] Fallback window: 7 days (decision 7).
- [x] GC null semantics fixed: cycle-key null = delete, other null = tombstone (decision 3).
- [x] N ≈ 230 (GC_DAYS=8 footprint) and cap-check read cost folded into the estimate.

### P1 — spike (done on `spike/sqlite-backend-p1`)

- [x] Turso DB provisioned + linked; `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`
      in the project env. Confirm the region is `aws-ap-northeast-1` with
      `turso db locations`.
- [x] `api/_db/types.ts` + `api/_db/local.ts` (node:sqlite, `file:`).
- [x] Port `api/session.ts` to `Db`: validation, limits, status codes, headers
      unchanged; PATCH one atomic unit; null-is-delete for cycle keys.
- [x] `pnpm dev:api` works end to end. Note: because the Turso env is forwarded
      to functions, local dev currently reaches the **remote dev DB**; the
      `file:./dev.db` fallback only applies when no remote env is set.
- [x] Server suite `scripts/sync-tests/sql-smoke.mjs`, wired into
      `pnpm test:sync` as `sql-backend` (hermetic, local file). A `--remote`
      mode runs the identical assertions against the real Turso DB.
- [x] Verified: `pnpm check` green; smoke green on local file **and** remote
      Turso (create/get/meta/patch/delete, 25-way atomicity, same-key LWW,
      cycle delete vs persistent tombstone, cap 413, legacy v1/v2 upgrade).
- [x] `api-live.mjs` is backend-agnostic via `scripts/sync-tests/backend.mjs`
      (auto-detects Redis vs SQL by probing the server, then inspects/seeds the
      matching store). Full `pnpm test:sync` against `dev:api` on the SQL
      backend: api-live and `browser-e2e.mjs` E1/E2 all pass.

### P2 — abstraction & schema (partly done)

- [x] Remote driver `api/_db/remote.ts` (`@libsql/client/web`): read-then-write
      with ONE `batch(..., "write")` covering the kv rows and the probe row;
      the legacy upgrade is claimed with a conditional `UPDATE ... WHERE legacy
      IS NOT NULL` instead of a lock.
- [x] `_schema_version` migration runner (`api/_db/schema.ts`); both drivers
      create the version table, seed 0, and apply pending migrations on first
      open (existing databases converge because migrations are IF NOT EXISTS).
- [x] `push_subscriptions` v4 (2026-09-18): composite `(endpoint, lane)` PK
      via rebuild migration — the endpoint-only PK let one lane's upsert steal
      the other's row. Rebuild (not ALTER) because SQLite can't add a PK;
      remote batches atomically, local crash between DROP/RENAME needs
      `rm dev.db`. Upserts/deletes/stamps are lane-scoped in both drivers,
      the API, and both fanouts.
- [ ] Optional `api/_db/postgres.ts` behind the same interface (or defer).
- [ ] Remove `@upstash/redis` once no code path uses it (api-live still needs
      it until ported).

### P3 — parity, GC, TTL, limits (done)

- [x] Bug-for-bug parity tests live in `scripts/sync-tests/sql-smoke.mjs`:
      legacy v1/v2 upgrade (column cleared), `~meta` forge 400,
      prefix/length/prototype rejection, 5000-field cap 413, `?meta=1`,
      `?touch=1`, DELETE idempotency, 404, 405, `Cache-Control: no-store`, and
      the GC null split (cycle key deleted, persistent tombstone retained).
- [x] GC_DAYS 60 -> 8 in `src/lib/cycle.ts`; `docs/sync.md` retention text
      updated; E6 reworked with a 10-day key that fails if the window widens.
- [x] 180-day sliding TTL: `expires_at` refreshed on `?touch=1` / `{touch:1}`;
      reads treat expired as 404 and the probe reclaims the session + its kv
      rows opportunistically (no cron).
- [x] In-memory per-instance limiter replaces the Redis `INCR`; adds 0 writes.

### P4 — data migration

- [x] Bulk export script `scripts/migrate-upstash-to-sql.mjs`: scans a Redis
      namespace (default `mabiroutine:`), copies every `:h` hash into
      `sessions` + `kv` and every bare v1/v2 blob into `sessions.legacy`,
      preserving `updated_at` / `seq` / remaining TTL (no-expiry keys get a
      fresh 180d). Dry-run by default, `--apply` writes, idempotent
      (`ON CONFLICT DO UPDATE`), targets `file:` (node:sqlite) or Turso.
      Verified against prod: dry-run and `--apply --db file:...` both report
      **5 hash + 7 legacy sessions, 1415 kv rows**; the file target then held
      12 sessions / 1415 rows. (The DB host confirms region
      `aws-ap-northeast-1`.)
- [x] Lazy read-through fallback `api/_db/fallback.ts`, switched by
      `SYNC_MIGRATION_FALLBACK` (default off; needs Redis credentials).
      `withFallback(db, source)` lifts a session into SQL on first miss via
      idempotent `INSERT OR IGNORE`, mirrors deletes back to the source, and
      refuses to resurrect a source record that is already expired.
      `redisSource` reads the old `${ns}session:{id}:h` hash or the bare
      v1/v2 record. Hermetic test `scripts/sync-tests/fallback.entry.ts`
      (wired into `pnpm test:sync`); its `--redis` mode was verified against
      real Redis (hash lifted, field lifted, delete mirrored).
- [x] Rollback path: revert the merge / redeploy the previous revision within
      the 7-day window; Redis data stays untouched so that works, but edits
      written to SQL after cutover are lost (see the Cutover runbook, step 7).

### P5 — deploy

- [x] Vercel functions already run in `hnd1` (verified 2026-09-14); no
      `vercel.json` region change required.
- [x] Turso database created; region confirmed `aws-ap-northeast-1` (Tokyo) from
      the DB hostname.
- [x] `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` set in the project
      (Production + Preview + Development). Still one shared DB across envs —
      see the open note below. `SYNC_KEY_PREFIX` no longer prefixes keys; it is
      only the roomy-limit signal now.
- [x] Local dev isolation: driver selection keys on `VERCEL_ENV`, so
      `pnpm dev:api` uses `file:./dev.db` regardless of the Turso env. Preview
      and Production intentionally share one Turso database (solo maintainer,
      no other users); see the Environments section for the accepted trade-offs.
- [x] Preview deploy green: full `pnpm test:sync` against the branch preview
      (`SYNC_TEST_BASE` + `SYNC_TEST_BYPASS`) passed — api-live on the SQL
      backend and `browser-e2e.mjs` E1/E2.

### P6 — observability, docs, release

- [x] Usage visibility: the Turso dashboard (Database → Usage) is the
      authoritative view of rows read/written against the free caps. No
      automated alert script: it would need a separate platform API token and a
      solo maintainer can just check the dashboard (Turso free has no threshold
      notifications). Revisit if the app becomes multi-user.
- [x] Client telemetry decision: `src/sync/stats.ts` keeps per-kind request
      counters; its Redis-era command-cost estimate is intentionally not
      retargeted to a guessed row model.
- [x] Docs: `docs/sync.md` (retention 8d + quota pointer), `docs/development.md`
      (SQL stack, suites, dev isolation) and `CHANGELOG.md`. READMEs unchanged
      (no user-facing behavior change).
- [x] `pnpm check` exit 0 (lint + shops + migrations + sync incl. the new
      sql-backend and fallback suites + build).

## Cutover runbook

Executed 2026-09-14 through step 5: snapshot + export applied, fallback flag set
on Production, merged, prod verified (`api-live` on SQL + Edge E1/E2). Step 6 is
due 2026-09-21.

Order matters. Production runs Redis until step 4, so steps 1-3 are additive and
safe to abort.

1. **Snapshot** (read-only + local, no prod impact):
   - `node scripts/migrate-upstash-to-sql.mjs` (dry-run) — expect the known
     prod counts (5 hash + 7 legacy, 1415 kv as of 2026-09-14).
   - `node scripts/migrate-upstash-to-sql.mjs --apply --db file:./snapshot.db`
     for a restorable copy.
2. **Export into Turso**: `node scripts/migrate-upstash-to-sql.mjs --apply`
   (writes `TURSO_DATABASE_URL` from `.env.local`). Idempotent; safe to re-run
   while Redis is still the source of truth.
3. **Turn on the fallback for Production**: set `SYNC_MIGRATION_FALLBACK=1`
   (Production scope) so the next prod deployment carries it. Check that
   Production still has `KV_REST_API_URL`/`KV_REST_API_TOKEN` (the fallback
   reads Redis) and that `SYNC_KEY_PREFIX` is unset there (the fallback must use
   the prod namespace `mabiroutine:`).
4. **Merge to `main`** (the merge commit is the cutover). Prod now reads/writes
   Turso; any session that appeared after the export is lifted on first access.
5. **Verify**: run `SYNC_TEST_BASE=https://mabiroutine.vercel.app pnpm test:sync`
   (prod is public, no bypass needed), then link a second device by hand and
   confirm a tap merges both ways. Watch Turso usage and `pnpm test:sync`'s
   `api-live` (`session persisted (sql)`).
6. **After 7 days, decommission the fallback**: unset
   `SYNC_MIGRATION_FALLBACK`, delete `api/_db/fallback.ts`, its `getDb()` wiring,
   `scripts/sync-tests/fallback.entry.ts`, and the Redis branch in
   `api-live.mjs`/`backend.mjs`; drop `@upstash/redis`. Then decommission the
   Redis database.
7. **Rollback** (only within the 7-day window): revert the merge / redeploy the
   previous revision. Prod talks Redis again with data untouched, but any edits
   written to SQL after step 4 are lost (the fallback only imports
   Redis→SQL, never back), so a rollback after real post-cutover use is lossy.

## Verification

- `pnpm check` (lint + shops + migrations + sync + build) before every push.
- Live sync suites must run for real (not skipped) on any sync-touching branch:
  `api-live.mjs`, `browser-e2e.mjs` (E1 tap->second device, E2 wake-pull).
- Sabotage check retained: removing the cycle-key exemption in `diffFlat` must
  still fail E1/E4/E5.
- Quota: measure real rows read/written via Turso `GET /v1/databases/{db}/usage`
  and `stats` after a day of use; compare against the estimate table.

## Risks

- **Turso free `BLOCKED` semantics.** Exceeding rows-written blocks sync with no
  overage on Free. Mitigation: telemetry + alert, upgrade to Developer on
  approach, keep client failure-tolerant.
- **Read headroom is only ~2x at 1000 heavy users** (48%). A per-PATCH full
  scan or an unindexed query would erase it. Mitigation: the cap-check rule
  above, and `EXPLAIN QUERY PLAN` the hot queries in P1.
- **Single-region Tokyo, smaller operator.** One query incident in 90d vs
  Upstash's clean Redis record. Mitigation: client already offline-safe; keep
  the Upstash code path reversible until the SQL path is proven.
- **`@libsql/client/web` fetch overhead** adds a network hop per query vs a
  local replica. Irrelevant at our poll rate; do not add embedded replicas
  (Vercel has no persistent filesystem).
- **Rate limiter regression** could silently eat the write budget. Guarded by
  the P3 checklist item.
