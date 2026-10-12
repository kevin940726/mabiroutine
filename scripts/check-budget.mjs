#!/usr/bin/env node
/**
 * Device request budget gate (public/sw-budget.js). Runs the REAL worker script
 * in a `node:vm` realm with a fake `self`, `caches`, `fetch` and clients, and
 * asserts the guard's contract:
 *
 *   1. below the tiers it never calls `respondWith` (zero interference)
 *   2. each tier trips where it says it does, and a trip is sticky
 *   3. past the budget the four covered classes are answered locally (image,
 *      /api/, navigation, script/style) and everything else fails open
 *   4. cross-origin requests are never touched
 *   5. a trip is reported to the clients and the counters answer a state query
 *
 * Usage: pnpm test:budget (also inside the pnpm check gate).
 *
 * Why a vm gate instead of only a browser test: this file sits in front of every
 * request the app makes, so its failure modes (never intercepting, always
 * intercepting, breaking a Workbox route) must be provable offline, in the same
 * spirit as the other entry gates. The browser-level proof that the real
 * generated worker still routes and renders is separate: see
 * docs/operations.md § The device request budget.
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

let bad = 0;
const ok = (msg) => console.log(`ok: ${msg}`);
const fail = (msg) => {
  bad += 1;
  console.log(`FAIL: ${msg}`);
};
const eq = (actual, expected, msg) =>
  actual === expected ? ok(msg) : fail(`${msg} — got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);

const SOURCE = fs.readFileSync("public/sw-budget.js", "utf8");

/** A realm with the worker script loaded, a fake clock and observable stubs. */
function loadRealm(opts = {}) {
  const clock = { t: 1_700_000_000_000 };
  const fetchCalls = [];
  const messages = [];
  const globalCache = new Map(opts.global ?? []);
  const pagesCache = new Map(opts.pages ?? []);
  const contexts = { serviceWorker: {} };

  class HostDate extends Date {
    static now() {
      return clock.t;
    }
  }

  const asResponse = (body, init) => new host.Response(body, init);
  const host = {};
  const cacheStub = (map) => ({
    match: (req) => {
      const body = map.get(typeof req === "string" ? req : req.url);
      return Promise.resolve(body === undefined ? undefined : asResponse(body, { status: 200 }));
    },
  });
  host.caches = Object.assign(
    {
      match: (req) => cacheStub(globalCache).match(req),
      open: (name) =>
        Promise.resolve(name === "pages" ? cacheStub(pagesCache) : { match: () => Promise.resolve(undefined) }),
    },
    opts.caches ?? {}
  );
  host.fetch = (req) => {
    fetchCalls.push(typeof req === "string" ? req : req.url);
    return Promise.resolve(asResponse("from-network", { status: 200 }));
  };
  host.Response = Response;
  host.URL = URL;
  host.atob = atob;
  host.Uint8Array = Uint8Array;
  host.Promise = Promise;
  host.Date = HostDate;
  host.location = { origin: "https://app.test" };
  host.clients = {
    matchAll: () => Promise.resolve([{ postMessage: (m) => messages.push(m) }]),
  };
  const listeners = {};
  host.self = {
    addEventListener: (type, fn) => {
      (listeners[type] ??= []).push(fn);
    },
    location: host.location,
    clients: host.clients,
  };
  host.self.self = host.self;
  host.addEventListener = host.self.addEventListener;

  const context = vm.createContext(host);
  vm.runInContext(SOURCE, context, { filename: "public/sw-budget.js" });

  const handler = (listeners.fetch ?? [])[0];
  if (!handler) throw new Error("sw-budget.js registered no fetch listener");

  return {
    clock,
    fetchCalls,
    messages,
    contexts,
    listeners,
    /** Fire a fetch event; returns { responded, response? } (response resolved lazily). */
    async fire({ url, destination = "", mode = "", method = "GET" }) {
      const request = { url, destination, mode, method };
      let promise;
      const event = {
        request,
        respondWith: (p) => {
          promise = p;
        },
        ports: [],
        source: { postMessage: (m) => messages.push(m) },
      };
      handler(event);
      if (!promise) return { responded: false };
      return { responded: true, response: await promise };
    },
    /** Drive the worker's message channel (config / state). */
    send(data, port) {
      const handler = (listeners.message ?? [])[0];
      if (!handler) throw new Error("sw-budget.js registered no message listener");
      handler({ data, ports: port ?? [], source: { postMessage: (m) => messages.push(m) } });
    },
  };
}

const img = (path) => ({ url: `https://app.test${path}`, destination: "image" });

// --- 1. below the tiers: pure counter ----------------------------------------
{
  const r = loadRealm();
  for (let i = 0; i < 120; i++) await r.fire(img(`/items/i${i}.webp`));
  eq(r.fetchCalls.length, 0, "below the burst tier nothing is intercepted");
  eq(r.messages.length, 0, "below the burst tier no trip is reported");
}

// --- 2. burst tier trips, is sticky, and answers images locally --------------
{
  const r = loadRealm({ global: [["https://app.test/items/known.webp", "cached-art"]] });
  for (let i = 0; i < 400; i++) await r.fire(img(`/items/seed${i}.webp`));
  eq(r.fetchCalls.length, 0, "400 requests in a minute are all allowed through");
  const crossing = await r.fire(img("/items/seedX.webp"));
  eq(crossing.responded, true, "the request that crosses the tier is the first answered locally");
  const hit = await r.fire(img("/items/seedY.webp"));
  eq(hit.responded, true, "past the tier the next image is answered locally");
  eq(r.fetchCalls.length, 0, "no image ever reached the network");
  const bytes = new Uint8Array(await hit.response.arrayBuffer());
  eq(hit.response.headers.get("content-type"), "image/png", "the local image is a declared PNG");
  eq(hit.response.headers.get("cache-control"), "no-store", "the transparent pixel is never cached");
  eq(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b),
    true,
    "…whose bytes are a real PNG signature"
  );
  eq(hit.response.status, 200, "the pixel is a 200 so `img` does not fire an error handler");
  const cached = await r.fire(img("/items/known.webp"));
  eq(await cached.response.text(), "cached-art", "a cached image is served from the cache instead of the pixel");
  eq(r.messages.filter((m) => m.type === "mabi-budget-trip").length >= 1, true, "the trip was reported to clients");
}

// --- 3. sticky past the tier: a request after the burst window is still blocked
{
  const r = loadRealm();
  for (let i = 0; i < 401; i++) await r.fire(img(`/items/seed${i}.webp`));
  const insideCooldown = await r.fire(img("/items/next.webp"));
  eq(insideCooldown.responded, true, "a trip is sticky inside the cooldown");
  r.clock.t += 6 * 60 * 1000; // past cooldown, windows also expired
  const after = await r.fire(img("/items/later.webp"));
  eq(after.responded, false, "after the cooldown with quiet windows, requests flow again");
}

// --- 4. /api/ answers 429 (a state the app already renders) -----------------
{
  const r = loadRealm();
  for (let i = 0; i < 401; i++) await r.fire(img(`/items/seed${i}.webp`));
  const res = await r.fire({ url: "https://app.test/api/session?id=abc&meta=1" });
  eq(res.responded, true, "an /api/ request past the budget is answered locally");
  eq(res.response.status, 429, "…with 429, the sync layer's existing rate-limit path");
  eq(res.response.headers.get("retry-after"), "60", "…and a Retry-After");
  eq(r.fetchCalls.length, 0, "no API request reached the network");
}

// --- 5. navigations: cached shell, else fail open ---------------------------
{
  const r = loadRealm({ pages: [["https://app.test/", "cached-shell"]] });
  for (let i = 0; i < 401; i++) await r.fire(img(`/items/seed${i}.webp`));
  const cached = await r.fire({ url: "https://app.test/", mode: "navigate" });
  eq(await cached.response.text(), "cached-shell", "a navigation past the budget is served from the pages cache");
  await r.fire({ url: "https://app.test/deep/link", mode: "navigate" });
  eq(r.fetchCalls.includes("https://app.test/deep/link"), true, "an uncached navigation still fails open to the network");
}

// --- 6. scripts/styles: cache when possible, else the network ---------------
{
  const r = loadRealm({ global: [["https://app.test/assets/app.js", "cached-js"]] });
  for (let i = 0; i < 401; i++) await r.fire(img(`/items/seed${i}.webp`));
  const cached = await r.fire({ url: "https://app.test/assets/app.js", destination: "script" });
  eq(await cached.response.text(), "cached-js", "a cached script is served from the cache");
  await r.fire({ url: "https://app.test/assets/new.js", destination: "script" });
  eq(r.fetchCalls.includes("https://app.test/assets/new.js"), true, "an uncached script fails open");
}

// --- 7. everything else fails open, and cross-origin is never touched -------
{
  const r = loadRealm();
  for (let i = 0; i < 401; i++) await r.fire(img(`/items/seed${i}.webp`));
  const font = await r.fire({ url: "https://app.test/fonts/x.woff2", destination: "font" });
  eq(font.responded, false, "an uncovered request class is never intercepted");
  const other = await r.fire({ url: "https://analytics.example/collect", destination: "image" });
  eq(other.responded, false, "a cross-origin request is never intercepted");
}

// --- 8. the state query answers with live counters --------------------------
{
  const r = loadRealm();
  for (let i = 0; i < 5; i++) await r.fire(img(`/items/i${i}.webp`));
  const sent = [];
  r.send({ type: "mabi-budget-state" }, [{ postMessage: (m) => sent.push(m) }]);
  const state = sent[0];
  eq(state.type, "mabi-budget-state", "the state reply is typed");
  eq(state.attempts, 5, "…and counts every attempt");
  eq(state.over, false, "…and reports the budget as intact");
  eq(typeof state.config.burst, "number", "…and exposes the tiers for calibration");
}

// --- 9. the test override only moves the tiers ------------------------------
{
  const r = loadRealm();
  r.send({ type: "mabi-budget-config", config: { burst: { max: 3 }, reset: true } });
  for (let i = 0; i < 4; i++) await r.fire(img(`/items/i${i}.webp`));
  const res = await r.fire(img("/items/i9.webp"));
  eq(res.responded, true, "a lowered burst tier applies from the next request");
}

// --- 10. the wiring that ARMS the guard is present --------------------------
// The guard is disarmed, silently and completely, by removing it from
// `importScripts` (or by moving to a generated worker that registers routes
// before it). The vm realm above would still pass in that world, so the wiring
// itself is asserted here.
{
  const config = fs.readFileSync("vite.config.ts", "utf8");
  const listMatch = config.match(/importScripts:\s*\[([^\]]*)\]/);
  eq(fs.existsSync("public/sw-budget.js"), true, "public/sw-budget.js exists");
  eq(
    !!listMatch && listMatch[1].includes("'/sw-budget.js'"),
    true,
    "vite.config.ts imports the guard into the generated worker"
  );
}

// --- 11. in a built worker, the guard loads before the routes ---------------
{
  const built = "dist/sw.js";
  if (!fs.existsSync(built)) {
    console.log("skip: dist/sw.js not built yet (budget gate runs before build in pnpm check)");
  } else {
    const text = fs.readFileSync(built, "utf8");
    const guard = text.indexOf("sw-budget.js");
    const firstRoute = text.indexOf("registerRoute(");
    eq(guard > -1, true, "the built worker imports sw-budget.js");
    eq(guard > -1 && firstRoute > -1 && guard < firstRoute, true, "…before the first registerRoute call, so its listener is first");
  }
}

// --- 12. every app fetch is either funnelled or sanctioned ------------------
// Three sites may call fetch() under src/, each for a stated reason
// (docs/operations.md §7): the sync session API (counted per kind), the counted
// net funnel, and the purple feed — which cannot use the funnel because its
// module is shared with the Cloudflare Worker and must stay free of ALIASED
// runtime imports (a relative import resolves in wrangler, `@/...` does not).
// Comment lines are skipped so prose about the rule does not trip it.
const SANCTIONED = [
  "src/sync/api.ts",
  "src/lib/net.ts",
  "src/lib/purpleHole.ts",
];
const walkDir = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walkDir(p) : [p];
  });
const bareFetches = [];
for (const file of walkDir("src").filter((f) => /\.(tsx?|jsx?)$/.test(f))) {
  if (SANCTIONED.includes(file.replaceAll("\\", "/"))) continue;
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split("\n");
  for (const m of text.matchAll(/\bfetch\s*\(/g)) {
    const lineNo = text.slice(0, m.index).split("\n").length;
    const line = lines[lineNo - 1].trim();
    if (line.startsWith("//") || line.startsWith("*") || line.startsWith("/*")) continue;
    bareFetches.push(`${file}:${lineNo}`);
  }
}
if (bareFetches.length) {
  bareFetches.forEach((p) =>
    fail(
      `${p} calls fetch() outside the sanctioned request sites (${SANCTIONED.join(", ")}) — route it through netFetch, ` +
        `or add it there with a reason and to docs/operations.md §7`
    )
  );
} else {
  ok(`every fetch() under src/ is a sanctioned request site (${SANCTIONED.length})`);
}

console.log(bad === 0 ? "device request budget: all pass" : `device request budget: ${bad} FAILED`);
process.exit(bad === 0 ? 0 : 1);
