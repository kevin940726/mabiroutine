// Storage adapter for the live sync suites. Inspects/seeds the SQL backend
// directly (Turso over HTTP, or the local file DB for dev servers) — every
// behavioral assertion stays API-driven.

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

// Local file store: local `pnpm dev:api` always writes the throwaway
// file: DB (api/_db/index.ts rule 3 — never Turso, even with creds present),
// so inspecting through TURSO_DATABASE_URL would read a different database
// entirely (proven 2026-09-15: every persistence assertion failed with null).
// Reads ./dev.db directly with node:sqlite. WAL readers never block writers.
function fileStore(dbPath = "./dev.db") {
  let dbP = null;
  async function db() {
    if (!dbP) {
      dbP = (async () => {
        const { DatabaseSync } = await import("node:sqlite");
        const d = new DatabaseSync(dbPath);
        d.exec("PRAGMA busy_timeout = 5000");
        return d;
      })();
    }
    return dbP;
  }
  return {
    name: "file",
    async readMeta(id) {
      const r = (await db()).prepare("SELECT meta, legacy FROM sessions WHERE id = ?").get(id);
      if (!r || r.meta == null) return null;
      return { "~meta": String(r.meta), legacy: r.legacy != null };
    },
    async kvValue(id, key) {
      const r = (await db()).prepare("SELECT value FROM kv WHERE session_id = ? AND key = ?").get(id, key);
      return r ? String(r.value) : null;
    },
    async readLegacy(id) {
      const r = (await db()).prepare("SELECT legacy FROM sessions WHERE id = ?").get(id);
      return r && r.legacy != null ? String(r.legacy) : null;
    },
    async ttl(id) {
      const r = (await db()).prepare("SELECT expires_at FROM sessions WHERE id = ?").get(id);
      return r ? Math.round((Number(r.expires_at) - Date.now()) / 1000) : -1;
    },
    async seedLegacy(id, rec) {
      (await db()).prepare(
        "INSERT INTO sessions (id, updated_at, seq, expires_at, field_count, meta, legacy) VALUES (?, ?, 0, ?, 0, NULL, ?)"
      ).run(id, 1, Date.now() + 1e12, JSON.stringify(rec));
    },
  };
}

// Store matching the suite base: local dev servers (localhost/127.0.0.1)
// write the throwaway file DB, so inspect it directly; previews/prod share
// one Turso database with the inspector.
export async function storeForBase(base) {
  if (/^(https?:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?\//.test(base)) return fileStore();
  return sqlStore();
}
