// Driver selection for the sync backend. `file:` URLs use the local node:sqlite
// driver; anything else (libsql://, https://) uses the remote Turso driver.
// Selection is by URL scheme so deployed envs point at Turso with no code
// change.
//
// Resolution order: DATABASE_URL, TURSO_DATABASE_URL, then a local file. The
// local default keeps `pnpm dev:api` cloud-free when no remote env is present
// (vercel dev does not forward custom .env.local keys to functions, so no env
// is the norm locally).

import type { Db } from "./types.js";
import { openLocalDb } from "./local.js";
import { openRemoteDb } from "./remote.js";
import { redisConfigured, redisSource, withFallback } from "./fallback.js";

let cached: Db | null = null;

// Resolution:
//   1. DATABASE_URL (explicit override — tests, scripts)
//   2. deployed (VERCEL_ENV production/preview) + TURSO_DATABASE_URL -> remote
//   3. otherwise a local file DB
// Rule 3 is why local `vercel dev` never touches a deployed database even when
// TURSO_DATABASE_URL is present in .env.local (pulled for the --remote test
// scripts): development is always the throwaway file.
function resolveUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const deployed = process.env.VERCEL_ENV === "production" || process.env.VERCEL_ENV === "preview";
  const turso = process.env.TURSO_DATABASE_URL;
  if (deployed && turso) return turso;
  return "file:./dev.db";
}

// Temporary cutover switch (docs/sql-migration.md P4): read sessions that only
// exist in the old Redis store into SQL on first access. Default off.
function fallbackEnabled(): boolean {
  const v = process.env.SYNC_MIGRATION_FALLBACK;
  return !!v && v !== "0" && v !== "false";
}

export function getDb(): Db {
  if (cached) return cached;
  const url = resolveUrl();
  let db: Db = url.startsWith("file:") ? openLocalDb(url) : openRemoteDb(url, process.env.TURSO_AUTH_TOKEN);
  if (fallbackEnabled()) {
    if (redisConfigured()) {
      db = withFallback(db, redisSource(process.env.SYNC_KEY_PREFIX ?? "mabiroutine:"));
    } else {
      console.warn("SYNC_MIGRATION_FALLBACK set but no Redis credentials present; fallback disabled");
    }
  }
  cached = db;
  return cached;
}
