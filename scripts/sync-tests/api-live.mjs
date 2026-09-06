// Live-API checks: concurrency, upgrade paths, failure modes, cache headers.
// Runs against `pnpm dev:api` (:52608, dev key prefix — never prod).
// Needs Upstash REST credentials (process env, else .env.local's
// KV_REST_API_URL/TOKEN — same source vercel dev uses).
// SKIP (exit 0, loud) when the server or credentials are absent, so
// `pnpm check` stays green offline — the hermetic suites carry the gate.
import fs from "node:fs";
import { Redis } from "@upstash/redis";

const BASE = "http://127.0.0.1:52608/api/session";

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
if (!env.UPSTASH_REDIS_REST_URL && env.KV_REST_API_URL) {
  env.UPSTASH_REDIS_REST_URL = env.KV_REST_API_URL;
  env.UPSTASH_REDIS_REST_TOKEN = env.KV_REST_API_TOKEN;
}

let reachable = false;
try {
  const r = await fetch(BASE, { method: "PUT" });
  reachable = r.status === 405; // server alive (405 = routed, wrong method)
} catch {
  reachable = false;
}
// process.exit() while undici sockets are open crashes Node on Windows
// (UV_HANDLE_CLOSING assert) — set exitCode and let the loop drain instead.
async function main() {
if (!reachable) {
  console.log("SKIP: api-live needs `pnpm dev:api` on :52608 (not running)");
  process.exitCode = 0;
  return;
}
if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
  console.log("SKIP: api-live needs Upstash REST credentials (env or .env.local)");
  process.exitCode = 0;
  return;
}
process.env.UPSTASH_REDIS_REST_URL = env.UPSTASH_REDIS_REST_URL;
process.env.UPSTASH_REDIS_REST_TOKEN = env.UPSTASH_REDIS_REST_TOKEN;
const redis = Redis.fromEnv();
const DEV = "mabiroutine:dev:session:";

let failures = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "ok" : "FAIL"}: ${name}${extra && cond ? "" : ` ${extra}`}`);
  if (!cond) failures += 1;
};
const post = (body) =>
  fetch(BASE, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }));
const patch = (body) =>
  fetch(BASE, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }));
const get = (id) => fetch(`${BASE}?id=${id}`).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})), headers: r.headers }));
const del = (id) =>
  fetch(BASE, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) }).then(async (r) => r.status);
const uuid = () => globalThis.crypto.randomUUID();
const created = [];

// 1. create + hash layout on disk
// 429 here is environmental (10/hr/IP create budget spent by earlier runs),
// not a product failure — SKIP loudly, retry within the hour.
{
  const r = await post({ state: { t: 1 } });
  if (r.status === 429) {
    console.log("SKIP: api-live create budget spent (10/hr/IP) — retry later");
    process.exitCode = 0;
    return;
  }
  ok("create 200", r.status === 200, r.status);
  const id = r.json.id;
  created.push(id);
  ok("create id shape", /^[0-9a-f-]{36}$/.test(id ?? ""));
  const h = await redis.hgetall(`${DEV}${id}:h`);
  ok("hash has meta+field", !!h && typeof h["~meta"] === "string" && h["~meta"].startsWith("j:") && h.t === "j:1", JSON.stringify(h)?.slice(0, 120));
}
// 2. 25 parallel disjoint PATCHes — all must survive (atomicity)
{
  const id = created[0];
  const res = await Promise.all(Array.from({ length: 25 }, (_, i) => patch({ id, changes: { [`k${i}`]: i } })));
  ok("25 parallel patch all 200", res.every((r) => r.status === 200), JSON.stringify(res.map((r) => r.status)));
  const g = await get(id);
  const st = g.json.state ?? {};
  ok("all 25 keys present", Array.from({ length: 25 }, (_, i) => st[`k${i}`] === i).every(Boolean));
  ok("earlier key intact", st.t === 1);
}
// 3. 10 parallel same-key PATCHes — exactly one wins, no error
{
  const id = created[0];
  const res = await Promise.all(Array.from({ length: 10 }, (_, i) => patch({ id, changes: { race: i } })));
  ok("same-key parallel all 200", res.every((r) => r.status === 200));
  const g = await get(id);
  const v = g.json.state?.race;
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
  const big = await patch({ id, changes: { big: "x".repeat(210 * 1024) } });
  ok("oversize 413", big.status === 413, big.status);
  const badm = await fetch(BASE, { method: "PUT" }).then((r) => r.status);
  ok("bad method 405", badm === 405, badm);
}
// 5. legacy v2-string upgrade
{
  const id = uuid();
  await redis.set(`${DEV}${id}`, { v: 2, updatedAt: 1, writerId: "t", seq: 1, keys: { old: { seq: 1, v: 1 } } });
  created.push(id);
  const g0 = await get(id);
  ok("v2 string served", g0.status === 200 && g0.json.state?.old === 1, JSON.stringify(g0.json)?.slice(0, 120));
  const p = await patch({ id, changes: { fresh: 2 } });
  ok("upgrade patch 200", p.status === 200, p.status);
  const g1 = await get(id);
  ok("upgraded union", g1.json.state?.old === 1 && g1.json.state?.fresh === 2, JSON.stringify(g1.json.state));
  const bare = await redis.get(`${DEV}${id}`);
  ok("bare string removed", bare === null, JSON.stringify(bare)?.slice(0, 80));
}
// 6. legacy v1 blob: served as marker, full push upgrades (blob discarded)
{
  const id = uuid();
  await redis.set(`${DEV}${id}`, { v: 1, updatedAt: 1, state: { characters: [] } });
  created.push(id);
  const g0 = await get(id);
  ok("v1 legacy marker", g0.status === 200 && g0.json.legacy !== undefined, JSON.stringify(g0.json)?.slice(0, 120));
  const p = await patch({ id, changes: { full: 1 } });
  ok("v1 upgrade patch 200", p.status === 200, p.status);
  const g1 = await get(id);
  ok("v1 upgraded to flat", g1.json.state?.full === 1 && g1.json.legacy === undefined, JSON.stringify(g1.json.state));
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
