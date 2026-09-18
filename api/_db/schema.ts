// Schema migrations for the SQL sync backend. Turso Cloud makes
// `PRAGMA user_version` read-only, so the applied version is tracked in a
// table instead (docs/sql-migration.md). Each migrations entry is one version;
// its array index + 1 is that version. Migrations must be additive and
// idempotent (CREATE ... IF NOT EXISTS) so an existing database that predates
// this table converges on first open.

export const VERSION_TABLE =
  "CREATE TABLE IF NOT EXISTS _schema_version (version INTEGER NOT NULL)";

export const MIGRATIONS: string[][] = [
  // v1 — base layout: one probe row per session, one row per flat key.
  [
    `CREATE TABLE IF NOT EXISTS sessions (
      id          TEXT PRIMARY KEY,
      updated_at  INTEGER NOT NULL,
      seq         INTEGER NOT NULL DEFAULT 0,
      expires_at  INTEGER NOT NULL,
      field_count INTEGER NOT NULL DEFAULT 0,
      meta        TEXT,
      legacy      TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS kv (
      session_id TEXT NOT NULL,
      key        TEXT NOT NULL,
      value      TEXT NOT NULL,
      PRIMARY KEY (session_id, key)
    )`,
  ],
  // v2 — push subscriptions (server-push fanout). One row per
  // (endpoint, lane) since v4 (v2 keyed endpoint alone — harmless while
  // every row was hourly); re-subscribing upserts the same row, so repeats
  // never grow the table.
  // `lane` scopes a row to a cadence ("hourly" / "purple"); dead endpoints
  // are pruned by the fanout on 404/410, and bell-off deletes the row.
  [
    `CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint     TEXT PRIMARY KEY,
      p256dh       TEXT NOT NULL,
      auth         TEXT NOT NULL,
      platform     TEXT NOT NULL DEFAULT '',
      lane         TEXT NOT NULL DEFAULT 'hourly',
      created_at   INTEGER NOT NULL,
      last_sent_at INTEGER
    )`,
  ],
  // v3 — session linkage for named cards (D1a). `link_session` is the
  // device's sync session id (nullable — unlinked subs get the generic
  // copy); `roster_json` is a [{cid, name}] snapshot for ordering + fallback
  // names, refreshed by the client on boot while subscribed.
  // Idempotency note: ALTER has no IF NOT EXISTS (verified) — a crash
  // between these two statements would break retry. The remote driver
  // batches each version atomically (safe); local dev is a throwaway file
  // (recover with rm dev.db). Accepted, not abstracted.
  [
    `ALTER TABLE push_subscriptions ADD COLUMN link_session TEXT`,
    `ALTER TABLE push_subscriptions ADD COLUMN roster_json TEXT`,
  ],
  // v4 — composite key (endpoint, lane). A second lane on the same device
  // shares the browser endpoint, so an endpoint-only PK let one lane's
  // upsert steal the other's row (and an endpoint-only DELETE cleared both).
  // SQLite can't add a PK by ALTER: rebuild + copy + swap. The remote driver
  // batches each version atomically (safe); the local driver runs statements
  // one-by-one with no transaction, so a crash between DROP and RENAME
  // breaks retry ("no such table" on every boot until rm dev.db) — same
  // accepted class as the v3 note (local dev is a throwaway file).
  [
    `CREATE TABLE IF NOT EXISTS push_subscriptions_new (
      endpoint     TEXT NOT NULL,
      p256dh       TEXT NOT NULL,
      auth         TEXT NOT NULL,
      platform     TEXT NOT NULL DEFAULT '',
      lane         TEXT NOT NULL DEFAULT 'hourly',
      created_at   INTEGER NOT NULL,
      last_sent_at INTEGER,
      link_session TEXT,
      roster_json  TEXT,
      PRIMARY KEY (endpoint, lane)
    )`,
    `INSERT OR IGNORE INTO push_subscriptions_new
       (endpoint, p256dh, auth, platform, lane, created_at, last_sent_at, link_session, roster_json)
       SELECT endpoint, p256dh, auth, platform, lane, created_at, last_sent_at, link_session, roster_json
       FROM push_subscriptions`,
    `DROP TABLE IF EXISTS push_subscriptions`,
    `ALTER TABLE push_subscriptions_new RENAME TO push_subscriptions`,
  ],
];
