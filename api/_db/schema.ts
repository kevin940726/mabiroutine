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
  // v2 — push subscriptions (server-push fanout). One row per endpoint;
  // re-subscribing upserts the same row, so repeats never grow the table.
  // `lane` scopes a row to a cadence (today only "hourly"); dead endpoints
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
];
