// Storage adapter for the live sync suites. The same operations run against
// the Redis hash layout or the SQL backend, chosen after probing the running
// server (create a session, then see whether a Redis hash appeared).
//
// Redis values are @upstash/redis-serialized JSON; SQL stores the same tagged
// strings the server writes. Only the inspection/seeding seams differ — every
// behavioral assertion stays API-driven.

const DEV = "mabiroutine:dev:session:";

function redisStore(redis) {
  return {
    name: "redis",
    async readMeta(id) {
      const h = await redis.hgetall(`${DEV}${id}:h`);
      return h && typeof h["~meta"] === "string" ? h : null;
    },
    async kvValue(id, key) {
      const h = await redis.hgetall(`${DEV}${id}:h`);
      return h ? (h[key] ?? null) : null;
    },
    async readLegacy(id) {
      return (await redis.get(`${DEV}${id}`)) ?? null;
    },
    async ttl(id) {
      return await redis.ttl(`${DEV}${id}:h`);
    },
    async seedLegacy(id, rec) {
      await redis.set(`${DEV}${id}`, rec);
    },
  };
}

function sqlStore() {
  let clientP = null;
  async function client() {
    if (!clientP) {
      clientP = (async () => {
        const { createClient } = await import("@libsql/client/web");
        const raw = process.env.TURSO_DATABASE_URL ?? "";
        const url = raw.startsWith("libsql://") ? `https://${raw.slice("libsql://".length)}` : raw;
        return createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
      })();
    }
    return clientP;
  }
  return {
    name: "sql",
    async readMeta(id) {
      const c = await client();
      const rs = await c.execute({ sql: "SELECT meta, legacy FROM sessions WHERE id = ?", args: [id] });
      const r = rs.rows[0];
      if (!r || r.meta == null) return null;
      return { "~meta": String(r.meta), legacy: r.legacy != null };
    },
    async kvValue(id, key) {
      const c = await client();
      const rs = await c.execute({ sql: "SELECT value FROM kv WHERE session_id = ? AND key = ?", args: [id, key] });
      return rs.rows[0] ? String(rs.rows[0].value) : null;
    },
    async readLegacy(id) {
      const c = await client();
      const rs = await c.execute({ sql: "SELECT legacy FROM sessions WHERE id = ?", args: [id] });
      const r = rs.rows[0];
      return r && r.legacy != null ? String(r.legacy) : null;
    },
    async ttl(id) {
      const c = await client();
      const rs = await c.execute({ sql: "SELECT expires_at FROM sessions WHERE id = ?", args: [id] });
      const r = rs.rows[0];
      return r ? Math.round((Number(r.expires_at) - Date.now()) / 1000) : -1;
    },
    async seedLegacy(id, rec) {
      const c = await client();
      await c.execute({
        sql: "INSERT INTO sessions (id, updated_at, seq, expires_at, field_count, meta, legacy) VALUES (?, ?, 0, ?, 0, NULL, ?)",
        args: [id, 1, Date.now() + 1e12, JSON.stringify(rec)],
      });
    },
  };
}

// Returns the store matching the running server. `redis` may be null when no
// Upstash credentials are configured (SQL-only setup).
export async function detectStore(redis, id) {
  if (redis) {
    const h = await redis.hgetall(`${DEV}${id}:h`);
    if (h && typeof h["~meta"] === "string") return redisStore(redis);
  }
  return sqlStore();
}
