// One-time export of Upstash Redis sync sessions into the SQL backend
// (docs/sql-migration.md, P4). Read-only against Redis; the SQL side is only
// touched with --apply. Run it right before cutover, then keep the lazy
// read-through fallback for 7 days.
//
//   node scripts/migrate-upstash-to-sql.mjs                       # dry-run, prod prefix
//   node scripts/migrate-upstash-to-sql.mjs --prefix mabiroutine:dev:
//   node scripts/migrate-upstash-to-sql.mjs --apply --db file:./dev.db
//   node scripts/migrate-upstash-to-sql.mjs --apply               # -> TURSO_DATABASE_URL
//
// Credentials: UPSTASH_REDIS_REST_URL/TOKEN (or KV_REST_API_URL/TOKEN) and
// TURSO_DATABASE_URL/TURSO_AUTH_TOKEN, from the environment or .env.local.
//
// Run BEFORE cutover, while prod still writes Redis. It is one-shot: a later
// --apply against a database that already has newer writes would revert those
// sessions to the older Redis snapshot.
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { Redis } from "@upstash/redis";

// Mirrors api/_db/schema.ts v1 (kept inline so the script runs standalone on
// plain Node without a TS loader).
const MIGRATIONS = [
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

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const argValue = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const dbArg = argValue("--db");
const prefixArg = argValue("--prefix");
const TTL_MS = 180 * 24 * 3600 * 1000;

function loadEnv() {
  const out = { ...process.env };
  try {
    for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
      if (m) out[m[1]] ??= m[2].trim().replace(/^"|"$/g, "");
    }
  } catch {
    /* env only */
  }
  return out;
}

const env = loadEnv();
const prefix = prefixArg || "mabiroutine:";
const sessionPrefix = `${prefix}session:`;
const target = dbArg || env.TURSO_DATABASE_URL || "file:./migration-target.db";

const redisUrl = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
const redisToken = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
if (!redisUrl || !redisToken) {
  console.error("missing Upstash REST credentials");
  process.exit(1);
}
process.env.UPSTASH_REDIS_REST_URL = redisUrl;
process.env.UPSTASH_REDIS_REST_TOKEN = redisToken;
const redis = Redis.fromEnv();

// --- target adapter (file: via node:sqlite, else libSQL over HTTP) ----------
let targetDb;
if (target.startsWith("file:")) {
  const db = new DatabaseSync(target.slice("file:".length));
  for (const stmts of MIGRATIONS) for (const sql of stmts) db.exec(sql);
  targetDb = {
    name: `sqlite ${target}`,
    async exec(sql, params = []) {
      db.prepare(sql).run(...params);
    },
  };
} else {
  const { createClient } = await import("@libsql/client/web");
  const url = target.startsWith("libsql://") ? `https://${target.slice("libsql://".length)}` : target;
  const client = createClient({ url, authToken: env.TURSO_AUTH_TOKEN });
  for (const stmts of MIGRATIONS) for (const sql of stmts) await client.execute(sql);
  targetDb = {
    name: `libsql ${url.replace(/\?.*$/, "")}`,
    async exec(sql, params = []) {
      await client.execute({ sql, args: params });
    },
  };
}

const SESSION_UPSERT =
  "INSERT INTO sessions (id, updated_at, seq, expires_at, field_count, meta, legacy) VALUES (?, ?, ?, ?, ?, ?, ?) " +
  "ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at, seq=excluded.seq, expires_at=excluded.expires_at, field_count=excluded.field_count, meta=excluded.meta, legacy=excluded.legacy";
const KV_UPSERT =
  "INSERT INTO kv (session_id, key, value) VALUES (?, ?, ?) ON CONFLICT(session_id, key) DO UPDATE SET value = excluded.value";

function decodeMeta(raw) {
  if (typeof raw !== "string" || !raw.startsWith("j:")) return null;
  try {
    const m = JSON.parse(raw.slice(2));
    return m && typeof m === "object" ? m : null;
  } catch {
    return null;
  }
}

function expiresAtFromTtl(ttl) {
  return ttl > 0 ? Date.now() + ttl * 1000 : Date.now() + TTL_MS;
}

// --- scan -------------------------------------------------------------------
// Collect first: a session can have BOTH a `:h` hash and an orphaned bare
// record (a past upgrade whose `del(bareKey)` failed). Importing the bare blob
// last would overwrite the newer hash, so bare keys whose hash exists are
// skipped. `:upgrading` lock keys are not sessions.
const keys = [];
let cursor = "0";
do {
  const res = await redis.scan(cursor, { match: `${sessionPrefix}*`, count: 200 });
  cursor = String(res[0]);
  keys.push(...res[1]);
} while (cursor !== "0");
const hashIds = new Set(keys.filter((k) => k.endsWith(":h")).map((k) => k.slice(sessionPrefix.length, -2)));

let hashes = 0;
let legacies = 0;
let kvRows = 0;
const skipped = [];
for (const key of keys) {
  if (key.endsWith(":upgrading")) continue;
  const ttl = await redis.ttl(key);
  if (ttl === -2) continue; // vanished between scan and read
  if (key.endsWith(":h")) {
    const id = key.slice(sessionPrefix.length, -2);
    const h = await redis.hgetall(key);
    if (!h || typeof h["~meta"] !== "string") {
      skipped.push(key);
      continue;
    }
    const meta = decodeMeta(h["~meta"]);
    const fields = Object.entries(h).filter(([k]) => k !== "~meta");
    hashes += 1;
    kvRows += fields.length;
    if (apply) {
      await targetDb.exec(SESSION_UPSERT, [
        id,
        meta?.updatedAt ?? Date.now(),
        meta?.seq ?? fields.length,
        expiresAtFromTtl(ttl),
        fields.length,
        h["~meta"],
        null,
      ]);
      for (const [k, v] of fields) await targetDb.exec(KV_UPSERT, [id, k, typeof v === "string" ? v : JSON.stringify(v)]);
    }
  } else {
    const id = key.slice(sessionPrefix.length);
    if (hashIds.has(id)) {
      skipped.push(key); // orphaned bare record; the hash wins
      continue;
    }
    const rec = await redis.get(key);
    if (rec == null) {
      skipped.push(key);
      continue;
    }
    legacies += 1;
    if (apply) {
      const raw = typeof rec === "string" ? rec : JSON.stringify(rec);
      const updatedAt = typeof rec === "object" && rec !== null && "updatedAt" in rec ? Number(rec.updatedAt) : Date.now();
      await targetDb.exec(SESSION_UPSERT, [id, updatedAt, 0, expiresAtFromTtl(ttl), 0, null, raw]);
    }
  }
}

console.log(`namespace   ${prefix}`);
console.log(`target      ${targetDb.name}`);
console.log(`mode        ${apply ? "APPLY" : "DRY-RUN (no writes)"}`);
console.log(`sessions    hashes=${hashes} legacy=${legacies}`);
console.log(`kv rows     ${kvRows}`);
if (skipped.length) console.log(`skipped     ${skipped.length} (unreadable) e.g. ${skipped.slice(0, 3).join(", ")}`);
if (!apply) console.log("\nre-run with --apply to write.");
