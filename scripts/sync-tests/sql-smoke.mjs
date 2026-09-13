// Server-side suite for the SQL sync backend (docs/sql-migration.md).
// Bundles the real api/session.ts handler, drives it with request/response
// shims, and asserts protocol parity plus the SQL-specific rules (cycle-key
// null deletes, persistent null tombstones, one-row probe, legacy upgrade).
//
//   node scripts/sync-tests/sql-smoke.mjs            # local file DB (hermetic)
//   node scripts/sync-tests/sql-smoke.mjs --remote   # real Turso (.env.local)
//
// The hermetic run is wired into `pnpm test:sync`; --remote is a manual check
// against a provisioned database.
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const remote = process.argv.includes("--remote");

function loadEnvLocal() {
  const out = {};
  try {
    for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
      if (m) out[m[1]] = m[2].trim().replace(/^"|"$/g, "");
    }
  } catch {
    /* no .env.local */
  }
  return out;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mabi-sql-"));
const localPath = path.join(tmp, "smoke.db");
let dbUrl;
if (remote) {
  const env = loadEnvLocal();
  if (!env.TURSO_DATABASE_URL || !env.TURSO_AUTH_TOKEN) {
    console.log("SKIP: --remote needs TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in .env.local");
    process.exit(0);
  }
  dbUrl = env.TURSO_DATABASE_URL;
  process.env.TURSO_DATABASE_URL = env.TURSO_DATABASE_URL;
  process.env.TURSO_AUTH_TOKEN = env.TURSO_AUTH_TOKEN;
} else {
  dbUrl = `file:${localPath}`;
}
process.env.DATABASE_URL = dbUrl;
process.env.SYNC_KEY_PREFIX = "mabiroutine:dev:"; // roomy test limits

const out = path.resolve("node_modules/.cache/sql-session.bundle.mjs");
await build({
  entryPoints: [path.resolve("api/session.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outfile: out,
  logLevel: "error",
});
const handler = (await import(pathToFileURL(out).href)).default;

// --- inspector: raw storage access for assertions/seeding -------------------
const norm = (u) => (u.startsWith("libsql://") ? `https://${u.slice("libsql://".length)}` : u);
let inspector;
if (remote) {
  const { createClient } = await import("@libsql/client/web");
  const client = createClient({ url: norm(dbUrl), authToken: process.env.TURSO_AUTH_TOKEN });
  inspector = {
    async sessionsRow(id) {
      const rs = await client.execute({
        sql: "SELECT meta, legacy, expires_at, field_count FROM sessions WHERE id = ?",
        args: [id],
      });
      const r = rs.rows[0];
      return r ? { meta: r.meta, legacy: r.legacy, expires_at: Number(r.expires_at), field_count: Number(r.field_count) } : null;
    },
    async kvValue(id, key) {
      const rs = await client.execute({ sql: "SELECT value FROM kv WHERE session_id = ? AND key = ?", args: [id, key] });
      return rs.rows[0] ? String(rs.rows[0].value) : null;
    },
    async seedLegacy(id, rec) {
      await client.execute({
        sql: "INSERT INTO sessions (id, updated_at, seq, expires_at, field_count, meta, legacy) VALUES (?, ?, 0, ?, 0, NULL, ?)",
        args: [id, 1, Date.now() + 1e12, JSON.stringify(rec)],
      });
    },
    async seedExpired(id) {
      const meta = `j:${JSON.stringify({ v: 2, updatedAt: 1, writerId: "t", seq: 1 })}`;
      await client.execute({
        sql: "INSERT INTO sessions (id, updated_at, seq, expires_at, field_count, meta, legacy) VALUES (?, 1, 1, ?, 1, ?, NULL)",
        args: [id, Date.now() - 1000, meta],
      });
      await client.execute({ sql: "INSERT INTO kv (session_id, key, value) VALUES (?, ?, ?)", args: [id, "pin:exp", "j:true"] });
    },
  };
} else {
  const db = new DatabaseSync(localPath);
  db.exec("PRAGMA busy_timeout = 3000");
  inspector = {
    async sessionsRow(id) {
      return db.prepare("SELECT meta, legacy, expires_at, field_count FROM sessions WHERE id = ?").get(id) ?? null;
    },
    async kvValue(id, key) {
      const r = db.prepare("SELECT value FROM kv WHERE session_id = ? AND key = ?").get(id, key);
      return r ? r.value : null;
    },
    async seedLegacy(id, rec) {
      db.prepare(
        "INSERT INTO sessions (id, updated_at, seq, expires_at, field_count, meta, legacy) VALUES (?, ?, 0, ?, 0, NULL, ?)"
      ).run(id, 1, Date.now() + 1e12, JSON.stringify(rec));
    },
    async seedExpired(id) {
      const meta = `j:${JSON.stringify({ v: 2, updatedAt: 1, writerId: "t", seq: 1 })}`;
      db.prepare(
        "INSERT INTO sessions (id, updated_at, seq, expires_at, field_count, meta, legacy) VALUES (?, 1, 1, ?, 1, ?, NULL)"
      ).run(id, Date.now() - 1000, meta);
      db.prepare("INSERT INTO kv (session_id, key, value) VALUES (?, ?, ?)").run(id, "pin:exp", "j:true");
    },
  };
}

// --- request/response shims -------------------------------------------------
function mkRes() {
  return {
    statusCode: 0,
    body: undefined,
    headers: {},
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(o) {
      this.body = o;
      return this;
    },
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    },
  };
}
async function call({ method = "GET", query = {}, body, ip = "1.2.3.4" }) {
  const req = { method, query, body, headers: { "x-real-ip": ip } };
  const res = mkRes();
  await handler(req, res);
  return res;
}
const POST = (b) => call({ method: "POST", body: b });
const PATCH = (b) => call({ method: "PATCH", body: b });
const GET = (id, q = {}) => call({ query: { id, ...q } });
const META = (id) => call({ query: { id, meta: "1" } });
const DEL = (id) => call({ method: "DELETE", body: { id } });
const uuid = () => crypto.randomUUID();

let failures = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "ok" : "FAIL"}: ${name}${cond ? "" : ` ${extra}`}`);
  if (!cond) failures += 1;
};
const created = [];

console.log(`=== sql smoke (${remote ? "remote turso" : "local file"}) ===`);
try {
  // 1. create + storage layout
  let primary;
  {
    const r = await POST({ state: { "pin:t": true } });
    ok("create 200", r.statusCode === 200, r.statusCode);
    primary = r.body.id;
    created.push(primary);
    ok("create id shape", /^[0-9a-f-]{36}$/.test(primary ?? ""));
    const row = await inspector.sessionsRow(primary);
    ok("sessions row created", !!row && String(row.meta).startsWith("j:") && row.legacy === null, JSON.stringify(row));
    ok("ttl set", (row?.expires_at ?? 0) > Date.now());
    ok("kv row tagged", (await inspector.kvValue(primary, "pin:t")) === "j:true");
  }
  const id = primary;

  // 2. 25 parallel disjoint patches (atomicity)
  {
    const res = await Promise.all(Array.from({ length: 25 }, (_, i) => PATCH({ id, changes: { [`pin:k${i}`]: true } })));
    ok("25 parallel patch all 200", res.every((r) => r.statusCode === 200), JSON.stringify(res.map((r) => r.statusCode)));
    const st = (await GET(id)).body.state ?? {};
    ok("all 25 keys present", Array.from({ length: 25 }, (_, i) => st[`pin:k${i}`] === true).every(Boolean));
    ok("earlier key intact", st["pin:t"] === true);
  }

  // 3. same-key race
  {
    const res = await Promise.all(Array.from({ length: 10 }, (_, i) => PATCH({ id, changes: { "pin:race": i } })));
    ok("same-key parallel all 200", res.every((r) => r.statusCode === 200));
    const v = (await GET(id)).body.state?.["pin:race"];
    ok("same-key LWW single value", Number.isInteger(v) && v >= 0 && v < 10, `race=${v}`);
  }

  // 4. cycle null = DELETE; persistent null = retained tombstone
  {
    const ck = "v:c1:parttime@2020-01-01";
    await PATCH({ id, changes: { [ck]: true } });
    ok("cycle value stored", (await inspector.kvValue(id, ck)) === "j:true");
    await PATCH({ id, changes: { [ck]: null } });
    ok("cycle null deleted row", (await inspector.kvValue(id, ck)) === null);
    await PATCH({ id, changes: { "pin:x": true } });
    await PATCH({ id, changes: { "pin:x": null } });
    ok("persistent null tombstone retained", (await inspector.kvValue(id, "pin:x")) === "j:null");
    ok("tombstone decodes to explicit null", (await GET(id)).body.state?.["pin:x"] === null);
  }

  // 5. failure paths
  {
    ok("reserved key 400", (await PATCH({ id, changes: { "~meta": 1 } })).statusCode === 400);
    ok("unknown prefix 400", (await PATCH({ id, changes: { "evil:1": 1 } })).statusCode === 400);
    ok("proto key 400", (await PATCH({ id, changes: JSON.parse('{"__proto__":1}') })).statusCode === 400);
    ok("array value 400", (await PATCH({ id, changes: { "pin:x": [1] } })).statusCode === 400);
    ok("oversize string 400", (await PATCH({ id, changes: { "char:c1:name": "x".repeat(501) } })).statusCode === 400);
    ok("bad method 405", (await call({ method: "PUT" })).statusCode === 405);
    ok("unknown id 404", (await GET("00000000-0000-4000-8000-000000000000")).statusCode === 404);
    ok("malformed id 404", (await GET("nope")).statusCode === 404);
  }
  // field cap (growth only)
  {
    const capId = (await POST({ state: Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`pin:a${i}`, true])) })).body.id;
    created.push(capId);
    const more = Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`pin:b${i}`, true]));
    ok("cap 4000 ok", (await PATCH({ id: capId, changes: more })).statusCode === 200);
    const over = Object.fromEntries(Array.from({ length: 1500 }, (_, i) => [`pin:c${i}`, true]));
    ok("cap 5500 -> 413", (await PATCH({ id: capId, changes: over })).statusCode === 413);
  }

  // 6. probe + touch
  {
    const g = await GET(id);
    ok("GET no-store", (g.headers["cache-control"] ?? "").includes("no-store"), g.headers["cache-control"]);
    const m = await META(id);
    ok("meta updatedAt only", m.statusCode === 200 && typeof m.body.updatedAt === "number" && m.body.state === undefined && m.body.legacy === undefined, JSON.stringify(m.body).slice(0, 80));
    const before = (await inspector.sessionsRow(id)).expires_at;
    const t = await GET(id, { touch: "1" });
    const after = (await inspector.sessionsRow(id)).expires_at;
    ok("touch param 200 + renews", t.statusCode === 200 && after >= before, `${before} -> ${after}`);
  }

  // 6b. lazy TTL: an expired read is a 404 and reclaims the row
  {
    const eid = uuid();
    created.push(eid);
    await inspector.seedExpired(eid);
    ok("expired read 404", (await GET(eid)).statusCode === 404);
    ok("expired row reclaimed", (await inspector.sessionsRow(eid)) === null);
  }

  // 7. legacy v2 upgrade
  {
    const lid = uuid();
    created.push(lid);
    await inspector.seedLegacy(lid, { v: 2, updatedAt: 1, writerId: "t", seq: 1, keys: { old: { seq: 1, v: 1 } } });
    const g0 = await GET(lid);
    ok("v2 string served", g0.statusCode === 200 && g0.body.state?.old === 1, JSON.stringify(g0.body).slice(0, 120));
    ok("v2 meta flags legacy", (await META(lid)).body.legacy === true);
    ok("upgrade patch 200", (await PATCH({ id: lid, changes: { "pin:fresh": true } })).statusCode === 200);
    const g1 = await GET(lid);
    ok("upgraded union", g1.body.state?.old === 1 && g1.body.state?.["pin:fresh"] === true, JSON.stringify(g1.body.state));
    ok("legacy column cleared", (await inspector.sessionsRow(lid))?.legacy === null);
  }

  // 8. legacy v1 blob
  {
    const vid = uuid();
    created.push(vid);
    await inspector.seedLegacy(vid, { v: 1, updatedAt: 1, state: { characters: [] } });
    const g0 = await GET(vid);
    ok("v1 legacy marker", g0.statusCode === 200 && g0.body.legacy !== undefined, JSON.stringify(g0.body).slice(0, 120));
    const m0 = await META(vid);
    ok("v1 meta legacy flag", m0.statusCode === 200 && m0.body.legacy === true && typeof m0.body.updatedAt === "number");
    ok("v1 upgrade patch 200", (await PATCH({ id: vid, changes: { "pin:full": true } })).statusCode === 200);
    const g1 = await GET(vid);
    ok("v1 upgraded to flat", g1.body.state?.["pin:full"] === true && g1.body.legacy === undefined);
  }

  // 9. delete + idempotency
  {
    ok("delete 200", (await DEL(id)).statusCode === 200);
    ok("post-delete 404", (await GET(id)).statusCode === 404);
    ok("delete idempotent 200", (await DEL(id)).statusCode === 200);
  }
} finally {
  // cleanup every created session (remote DBs are shared, so always delete)
  for (const cid of created) await DEL(cid).catch(() => {});
}

console.log(failures === 0 ? "\nALL SQL SMOKE CHECKS PASSED" : `\n${failures} FAILURES`);
process.exitCode = failures === 0 ? 0 : 1;
