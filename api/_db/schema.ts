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
];
