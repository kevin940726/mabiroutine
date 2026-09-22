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

export function getDb(): Db {
  if (cached) return cached;
  const url = resolveUrl();
  const db: Db = url.startsWith("file:") ? openLocalDb(url) : openRemoteDb(url, process.env.TURSO_AUTH_TOKEN);
  cached = db;
  return cached;
}
