// Temporary read-through migration fallback (docs/sql-migration.md P4,
// decision 7). While `SYNC_MIGRATION_FALLBACK` is on, a session that is only
// in the pre-SQL store is lifted into SQL on first read and served normally.
// Deletes are mirrored back to the source so a removed session cannot
// resurrect. Remove this whole file once the fallback window (7 days) closes.
//
// The source is an interface so the behavior is testable without a live Redis.

import type { Redis } from "@upstash/redis";
import type { Db, SessionImport } from "./types.js";

const TTL_MS = 180 * 24 * 3600 * 1000;

export type MigrationSource = {
  /** Returns a record ready to import, or null when the id is absent. */
  read(id: string): Promise<SessionImport | null>;
  /** Mirror a delete so the old store cannot resurrect the session. */
  remove(id: string): Promise<void>;
};

export function withFallback(db: Db, source: MigrationSource): Db {
  const ensure = async (id: string): Promise<void> => {
    const rec = await source.read(id);
    // Never resurrect a session the source itself has expired.
    if (rec && rec.expiresAt > Date.now()) await db.importSession(rec);
  };
  return {
    async probe(id, now) {
      const p = await db.probe(id, now);
      if (p) return p;
      await ensure(id);
      return db.probe(id, now);
    },
    async readHash(id, now) {
      const h = await db.readHash(id, now);
      if (h) return h;
      await ensure(id);
      return db.readHash(id, now);
    },
    async readLegacy(id, now) {
      const l = await db.readLegacy(id, now);
      if (l != null) return l;
      await ensure(id);
      return db.readLegacy(id, now);
    },
    create: (id, fields, metaRaw, updatedAt, expiresAt) => db.create(id, fields, metaRaw, updatedAt, expiresAt),
    apply: (id, upserts, deletes, metaRaw, now, maxFields, legacyBase) =>
      db.apply(id, upserts, deletes, metaRaw, now, maxFields, legacyBase),
    async delete(id) {
      await db.delete(id);
      await source.remove(id);
    },
    touch: (id, expiresAt) => db.touch(id, expiresAt),
    importSession: (rec) => db.importSession(rec),
    // Push subscriptions bypass the migration source entirely (no Redis-era
    // equivalent): straight delegation.
    upsertPushSub: (sub) => db.upsertPushSub(sub),
    deletePushSub: (endpoint) => db.deletePushSub(endpoint),
    listPushSubs: (lane) => db.listPushSubs(lane),
  };
}

function decodeUpdatedAt(raw: string): number {
  try {
    const m = JSON.parse(raw.slice(2)) as { updatedAt?: unknown };
    return typeof m.updatedAt === "number" ? m.updatedAt : Date.now();
  } catch {
    return Date.now();
  }
}

function decodeSeq(raw: string): number {
  try {
    const m = JSON.parse(raw.slice(2)) as { seq?: unknown };
    return typeof m.seq === "number" ? m.seq : 0;
  } catch {
    return 0;
  }
}

// True when the Upstash REST credentials the Redis client needs are present.
export function redisConfigured(): boolean {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  return !!url && !!token;
}

// Redis-backed source in the old layout: a `${ns}session:${id}:h` hash or a
// bare `${ns}session:${id}` v1/v2 record. The client is created lazily so the
// default (flag-off) bundle never pulls it in.
export function redisSource(ns: string): MigrationSource {
  let clientP: Promise<Redis> | null = null;
  const client = async (): Promise<Redis> => {
    if (!clientP) clientP = import("@upstash/redis").then(({ Redis }) => Redis.fromEnv());
    return clientP;
  };
  return {
    async read(id: string): Promise<SessionImport | null> {
      const redis = await client();
      const hkey = `${ns}session:${id}:h`;
      const h = await redis.hgetall<Record<string, unknown>>(hkey);
      if (h && typeof h["~meta"] === "string") {
        const ttl = await redis.ttl(hkey);
        const fields: Record<string, string> = {};
        for (const [k, v] of Object.entries(h)) {
          if (k === "~meta") continue;
          fields[k] = typeof v === "string" ? v : JSON.stringify(v);
        }
        const metaRaw = h["~meta"];
        return {
          id,
          updatedAt: decodeUpdatedAt(metaRaw),
          seq: decodeSeq(metaRaw),
          expiresAt: ttl > 0 ? Date.now() + ttl * 1000 : Date.now() + TTL_MS,
          metaRaw,
          legacyRaw: null,
          fields,
        };
      }
      const bkey = `${ns}session:${id}`;
      const rec = await redis.get<unknown>(bkey);
      if (rec == null) return null;
      const raw = typeof rec === "string" ? rec : JSON.stringify(rec);
      let updatedAt = Date.now();
      if (typeof rec === "object" && rec !== null && "updatedAt" in rec) {
        const u = (rec as { updatedAt?: unknown }).updatedAt;
        if (typeof u === "number") updatedAt = u;
      }
      return { id, updatedAt, seq: 0, expiresAt: Date.now() + TTL_MS, metaRaw: null, legacyRaw: raw, fields: {} };
    },
    async remove(id: string): Promise<void> {
      const redis = await client();
      await redis.del(`${ns}session:${id}:h`);
      await redis.del(`${ns}session:${id}`);
    },
  };
}
