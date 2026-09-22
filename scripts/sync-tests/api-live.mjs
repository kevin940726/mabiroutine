// Live-API checks: concurrency, upgrade paths, failure modes, cache headers.
// Base: local `pnpm dev:api` by default, preview deployment via
// SYNC_TEST_BASE (previews run the dev key prefix — never prod).
// Needs Turso credentials (process env, else .env.local's
// TURSO_DATABASE_URL/TOKEN) for direct store inspection on deployed bases;
// local dev servers inspect the throwaway file DB directly and need none.
// SKIP (exit 0, loud) when the server or credentials are absent, so
// `pnpm check` stays green offline — the hermetic suites carry the gate.
import fs from "node:fs";
import { storeForBase } from "./backend.mjs";

const BASE = `${(process.env.SYNC_TEST_BASE || "http://localhost:52608").replace(/\/+$/, "")}/api/session`;
// Protected previews need a Vercel automation bypass secret (SYNC_TEST_BYPASS).
const BYPASS = process.env.SYNC_TEST_BYPASS;
const AUTH = BYPASS ? { "x-vercel-protection-bypass": BYPASS } : {};

function loadEnv() {
  const out = { ...process.env };
  try {
    const raw = fs.readFileSync(".env.local", "utf8");
    for (const line of raw.split("\n")) {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
      if (m) out[m[1]] ??= m[2].trim().replace(/^"|"$/g, "");
    }
  } catch {
    // no .env.local — env only
  }
  return out;
}

const env = loadEnv();
process.env.TURSO_DATABASE_URL ??= env.TURSO_DATABASE_URL;
process.env.TURSO_AUTH_TOKEN ??= env.TURSO_AUTH_TOKEN;

let reachable = false;
try {
  const r = await fetch(BASE, { method: "PUT", headers: AUTH });
  reachable = r.status === 405; // server alive (405 = routed, wrong method)
} catch {
  reachable = false;
}
// process.exit() while undici sockets are open crashes Node on Windows
// (UV_HANDLE_CLOSING assert) — set exitCode and let the loop drain instead.
async function main() {
if (!reachable) {
  console.log(`SKIP: api-live needs the app reachable at ${BASE.replace(/\/api\/session$/, "")} (local: \`pnpm dev:api\`)`);
  process.exitCode = 0;
  return;
}
const isLocal = /^(https?:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?\//.test(BASE);
const hasTurso = !!(env.TURSO_DATABASE_URL && env.TURSO_AUTH_TOKEN);
if (!isLocal && !hasTurso) {
  console.log("SKIP: api-live needs Turso credentials (env or .env.local) for non-local bases");
  process.exitCode = 0;
  return;
}

let failures = 0;
let store = null;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "ok" : "FAIL"}: ${name}${extra && cond ? "" : ` ${extra}`}`);
  if (!cond) failures += 1;
};
const post = (body) =>
  fetch(BASE, { method: "POST", headers: { "content-type": "application/json", ...AUTH }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }));
const patch = (body) =>
  fetch(BASE, { method: "PATCH", headers: { "content-type": "application/json", ...AUTH }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }));
const get = (id) => fetch(`${BASE}?id=${id}`, { headers: AUTH }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})), headers: r.headers }));
const meta = (id) => fetch(`${BASE}?id=${id}&meta=1`, { headers: AUTH }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }));
const del = (id) =>
  fetch(BASE, { method: "DELETE", headers: { "content-type": "application/json", ...AUTH }, body: JSON.stringify({ id }) }).then(async (r) => r.status);
const uuid = () => globalThis.crypto.randomUUID();
const created = [];

// 1. create + storage layout (SQL backend)
 // 429 here is environmental (10/hr/IP create budget spent by earlier runs),
// not a product failure — SKIP loudly, retry within the hour.
{
  const r = await post({ state: { "pin:t": true } });
  if (r.status === 429) {
    console.log("SKIP: api-live create budget spent (10/hr/IP) — retry later");
    process.exitCode = 0;
    return;
  }
  ok("create 200", r.status === 200, r.status);
  const id = r.json.id;
  created.push(id);
  ok("create id shape", /^[0-9a-f-]{36}$/.test(id ?? ""));
  store = await storeForBase(BASE);
  const rec = await store.readMeta(id);
  ok(`session persisted (${store.name})`, !!rec, JSON.stringify(rec)?.slice(0, 120));
  ok("field persisted", (await store.kvValue(id, "pin:t")) === "j:true");
  const ttl = await store.ttl(id);
  ok("ttl set (session expiry)", typeof ttl === "number" && ttl > 0, `ttl=${ttl}`);
}
// 2. 25 parallel disjoint PATCHes — all must survive (atomicity)
{
  const id = created[0];
  const res = await Promise.all(Array.from({ length: 25 }, (_, i) => patch({ id, changes: { [`pin:k${i}`]: true } })));
  ok("25 parallel patch all 200", res.every((r) => r.status === 200), JSON.stringify(res.map((r) => r.status)));
  const g = await get(id);
  const st = g.json.state ?? {};
  ok("all 25 keys present", Array.from({ length: 25 }, (_, i) => st[`pin:k${i}`] === true).every(Boolean));
  ok("earlier key intact", st["pin:t"] === true);
}
// 3. 10 parallel same-key PATCHes — exactly one wins, no error
{
  const id = created[0];
  const res = await Promise.all(Array.from({ length: 10 }, (_, i) => patch({ id, changes: { "pin:race": i } })));
  ok("same-key parallel all 200", res.every((r) => r.status === 200));
  const g = await get(id);
  const v = g.json.state?.["pin:race"];
  ok("same-key LWW single value", Number.isInteger(v) && v >= 0 && v < 10, `race=${v}`);
}
// 4. cache headers + failure paths
{
  const id = created[0];
  const g = await get(id);
  ok("GET no-store", (g.headers.get("cache-control") ?? "").includes("no-store"), g.headers.get("cache-control"));
  const bad = await get("00000000-0000-4000-8000-000000000000");
  ok("unknown id 404", bad.status === 404, bad.status);
  const rsv = await patch({ id, changes: { "~meta": 1 } });
  ok("reserved key 400", rsv.status === 400, rsv.status);
  const badPrefix = await patch({ id, changes: { "evil:1": 1 } });
  ok("unknown prefix 400", badPrefix.status === 400, badPrefix.status);
  const proto = await patch({ id, changes: JSON.parse('{"__proto__":1}') });
  ok("proto key 400", proto.status === 400, proto.status);
  const arr = await patch({ id, changes: { "pin:x": [1] } });
  ok("array value 400", arr.status === 400, arr.status);
  const longStr = await patch({ id, changes: { "char:c1:name": "x".repeat(501) } });
  ok("oversize string 400", longStr.status === 400, longStr.status);
  const huge = {};
  for (let i = 0; i < 30; i += 1) huge[`custom:b${i}`] = { id: `b${i}`, name: "n", pad: "y".repeat(7000) };
  const big = await patch({ id, changes: huge });
  ok("oversize 413", big.status === 413, big.status);
  const badm = await fetch(BASE, { method: "PUT", headers: AUTH }).then((r) => r.status);
  ok("bad method 405", badm === 405, badm);
  const m = await meta(id);
  ok("meta returns updatedAt only", m.status === 200 && typeof m.json.updatedAt === "number" && m.json.state === undefined && m.json.legacy === undefined, JSON.stringify(m.json)?.slice(0, 80));
  const tch = await fetch(`${BASE}?id=${id}&touch=1`, { headers: AUTH }).then((r) => r.status);
  ok("touch param 200", tch === 200, tch);
}
// 5. legacy v2-string upgrade
{
  const id = uuid();
  await store.seedLegacy(id, { v: 2, updatedAt: 1, writerId: "t", seq: 1, keys: { old: { seq: 1, v: 1 } } });
  created.push(id);
  const g0 = await get(id);
  ok("v2 string served", g0.status === 200 && g0.json.state?.old === 1, JSON.stringify(g0.json)?.slice(0, 120));
  const p = await patch({ id, changes: { "pin:fresh": true } });
  ok("upgrade patch 200", p.status === 200, p.status);
  const g1 = await get(id);
  ok("upgraded union", g1.json.state?.old === 1 && g1.json.state?.["pin:fresh"] === true, JSON.stringify(g1.json.state));
  const bare = await store.readLegacy(id);
  ok("legacy record removed", bare === null, JSON.stringify(bare)?.slice(0, 80));
}
// 6. legacy v1 blob: served as marker, full push upgrades (blob discarded)
{
  const id = uuid();
  await store.seedLegacy(id, { v: 1, updatedAt: 1, state: { characters: [] } });
  created.push(id);
  const g0 = await get(id);
  ok("v1 legacy marker", g0.status === 200 && g0.json.legacy !== undefined, JSON.stringify(g0.json)?.slice(0, 120));
  const m0 = await meta(id);
  ok("v1 meta legacy flag", m0.status === 200 && m0.json.legacy === true && typeof m0.json.updatedAt === "number", JSON.stringify(m0.json)?.slice(0, 120));
  const p = await patch({ id, changes: { "pin:full": true } });
  ok("v1 upgrade patch 200", p.status === 200, p.status);
  const g1 = await get(id);
  ok("v1 upgraded to flat", g1.json.state?.["pin:full"] === true && g1.json.legacy === undefined, JSON.stringify(g1.json.state));
}
// 7. delete + post-delete 404; cleanup
{
  for (const id of created) await del(id);
  const g = await get(created[0]);
  ok("deleted reads 404", g.status === 404, g.status);
}

console.log(failures === 0 ? "ALL API CHECKS PASSED" : `${failures} FAILURES`);
process.exitCode = failures === 0 ? 0 : 1;
}

await main();
