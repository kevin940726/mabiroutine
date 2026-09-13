// Migration read-through fallback (docs/sql-migration.md P4): a session that
// only exists in the old store is lifted into SQL on first read, deletes are
// mirrored, and expired source records are not resurrected. Real local driver
// + a fake MigrationSource, so this runs offline.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openLocalDb } from "../../api/_db/local.js";
import { redisSource, withFallback, type MigrationSource } from "../../api/_db/fallback.js";
import type { SessionImport } from "../../api/_db/types.js";

let failures = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  console.log(`${cond ? "ok" : "FAIL"}: ${name}${cond ? "" : ` ${extra}`}`);
  if (!cond) failures += 1;
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mabi-fb-"));
const db = openLocalDb(`file:${path.join(tmp, "fb.db")}`);

const records = new Map<string, SessionImport>();
const reads: string[] = [];
const removed: string[] = [];
const source: MigrationSource = {
  async read(id) {
    reads.push(id);
    return records.get(id) ?? null;
  },
  async remove(id) {
    removed.push(id);
    records.delete(id);
  },
};
const wrapped = withFallback(db, source);

const now = Date.now();
const HID = "11111111-1111-4111-8111-111111111111";
const LID = "22222222-2222-4222-8222-222222222222";
const metaRaw = `j:${JSON.stringify({ v: 2, updatedAt: 1234, writerId: "t", seq: 2 })}`;
records.set(HID, {
  id: HID,
  updatedAt: 1234,
  seq: 2,
  expiresAt: now + 86400000,
  metaRaw,
  legacyRaw: null,
  fields: { "pin:t": "j:true", "char:c1:name": 'j:"A"' },
});
records.set(LID, {
  id: LID,
  updatedAt: 55,
  seq: 0,
  expiresAt: now + 86400000,
  metaRaw: null,
  legacyRaw: JSON.stringify({ v: 2, updatedAt: 55, keys: { old: { seq: 1, v: 1 } } }),
  fields: {},
});

ok("absent probe is null", (await wrapped.probe("33333333-3333-4333-8333-333333333333", now)) === null);

const p = await wrapped.probe(HID, now);
ok("hash lifted on probe", !!p && p.hasHash && !p.hasLegacy);
const h = await wrapped.readHash(HID, now);
ok("hash fields served", h?.fields["pin:t"] === "j:true" && h?.meta === metaRaw, JSON.stringify(h)?.slice(0, 120));

const p2 = await wrapped.probe(LID, now);
ok("legacy lifted on probe", !!p2 && p2.hasLegacy && !p2.hasHash);
ok("legacy raw served", ((await wrapped.readLegacy(LID, now)) ?? "").includes('"old"'));

const readsBefore = reads.length;
await wrapped.probe(HID, now);
await wrapped.readHash(HID, now);
ok("no re-read once imported", reads.length === readsBefore, `reads=${reads.length}`);

await wrapped.delete(HID);
ok("delete mirrored to source", removed.includes(HID) && !records.has(HID));
ok("post-delete probe null", (await wrapped.probe(HID, now)) === null);

const EID = "44444444-4444-4444-8444-444444444444";
records.set(EID, { id: EID, updatedAt: 1, seq: 0, expiresAt: now - 1000, metaRaw, legacyRaw: null, fields: {} });
ok("expired source not resurrected", (await wrapped.probe(EID, now)) === null);

console.log(failures === 0 ? "ALL FALLBACK CHECKS PASSED" : `${failures} FAILURES`);

// Opt-in: exercise redisSource against real Redis. Needs Upstash credentials
// in .env.local (or the environment); skipped otherwise.
if (process.argv.includes("--redis")) {
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  try {
    for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
      if (m) env[m[1]] ??= m[2].trim().replace(/^"|"$/g, "");
    }
  } catch {
    /* env only */
  }
  const hasRedis = (env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL) && (env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN);
  if (!hasRedis) {
    console.log("SKIP: fallback --redis needs Upstash credentials");
  } else {
    process.env.UPSTASH_REDIS_REST_URL = env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL;
    process.env.UPSTASH_REDIS_REST_TOKEN = env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN;
    const ns = env.SYNC_KEY_PREFIX || "mabiroutine:";
    const { Redis } = await import("@upstash/redis");
    const redis = Redis.fromEnv();
    const rid = "55555555-5555-4555-8555-555555555555";
    const hkey = `${ns}session:${rid}:h`;
    await redis.hset(hkey, { "~meta": metaRaw, "pin:redis": "j:true" });
    await redis.expire(hkey, 3600);
    const db2 = openLocalDb(`file:${path.join(tmp, "redis.db")}`);
    const wrapped2 = withFallback(db2, redisSource(ns));
    const rp = await wrapped2.probe(rid, now);
    ok("redis: hash lifted", !!rp && rp.hasHash);
    ok("redis: field lifted", (await wrapped2.readHash(rid, now))?.fields["pin:redis"] === "j:true");
    await wrapped2.delete(rid);
    ok("redis: delete mirrored", (await redis.exists(hkey)) === 0 && (await redis.exists(`${ns}session:${rid}`)) === 0);
  }
}

process.exitCode = failures === 0 ? 0 : 1;
