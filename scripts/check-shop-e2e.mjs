#!/usr/bin/env node
/**
 * Shop surface E2E: the real app in real Edge, for the paths the unit gates
 * cannot reach. Bundles nothing; it drives the built/dev app over CDP.
 *
 * WHY THIS EXISTS. The unit gates cover shop DATA (check-shops), the migrations
 * (check-migrations), the drag rules and the item-icon paths. None of them
 * exercise the app in a browser, so a whole class of regression is invisible
 * before a release: the grid rendering the wrong column count, and a real v19
 * save failing to migrate on load.
 *
 * The two cases, both chosen because they shipped in this release:
 *
 *   S1  a v19 save (the current PRODUCTION shape) migrates to v20 in the
 *       browser: it loads, the retired `barterFilters` key is gone, and
 *       `prefs.pinnedCollapsed` is backfilled open. check-migrations proves
 *       migratePersisted does this to a plain object; this proves the real
 *       rehydration path does it through zustand's persist config, which is a
 *       different code path (`merge` + the version gate).
 *
 *   S2  the shop grid renders 4 columns at a desktop width, and the count is
 *       driven by the GRID's container rather than the window. Measured as
 *       "how many tiles share the first row's top offset" against the computed
 *       grid-template, in a real layout engine.
 *
 * Needs the app reachable (default `pnpm dev` on :5173) and Edge. SKIPs loudly
 * without either, so it is safe in the `pnpm check` gate.
 *
 * Usage: node scripts/check-shop-e2e.mjs
 *   APP_URL=http://localhost:5173 node scripts/check-shop-e2e.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const APP = (process.env.APP_URL || "http://localhost:5173").replace(/\/+$/, "/");
const DEBUG_PORT = 9391;
const EDGE_CANDIDATES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

class Skip extends Error {}
const skip = (why) => {
  console.log(`SKIP: shop-e2e ${why}`);
  throw new Skip();
};
let failures = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "ok" : "FAIL"}: ${name}${cond ? "" : ` — ${extra}`}`);
  if (!cond) failures += 1;
};

// Prereq checks live INSIDE the try/catch below: `skip` throws, and a throw at
// module top level would exit non-zero with a stack trace instead of a clean
// skip. (browser-e2e.mjs has the same shape because its checks sit in main().)
const edge = EDGE_CANDIDATES.find((p) => fs.existsSync(p));
const checkPrereqs = async () => {
  if (!edge) skip("(Edge not found)");
  try {
    const code = await fetch(APP, { method: "HEAD" }).then((r) => r.status);
    if (code !== 200) skip(`(app at ${APP} answered ${code})`);
  } catch {
    skip(`(needs the app at ${APP} — run \`pnpm dev\`)`);
  }
  // NOTE: this only checks reachability, NOT that the app is THIS checkout. If a
  // sibling worktree's dev server is on the default :5173, the browser assertions
  // measure that code instead (S2 fails with "3 columns", which reads like a real
  // regression). Run with an explicit port from this worktree:
  //   pnpm dev --port 5188 && APP_URL=http://localhost:5188 pnpm test:shop-e2e
};

// A v19 save with the retired barterFilters key, a pinned fold, and real pins,
// so the migration, the backfill, AND the pinned sections are all exercised.
// The pins matter: a save with an empty barterPins renders no 已釘選 section, and
// S3 would then be testing the absence of a control rather than the fold.
const V19_SAVE = JSON.stringify({
  state: {
    version: 19,
    characters: [
      { id: "e2e-char", name: "E2E", taskValues: { parttime: true, tower: 3 }, hiddenTaskIds: [] },
    ],
    activeCharId: "e2e-char",
    accountValues: {},
    barterPins: ["dun-st6", "dun-st7", "tir-f3"],
    customTasks: [],
    prefs: { hideCompleted: true },
    barterFilters: { q: "皮革", priority: ["must"] },
    taskBuckets: {},
  },
  version: 19,
});

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "mabiroutine-shop-e2e-"));
const proc = spawn(edge, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--disable-extensions",
  "--window-size=1440,900",
  `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profile}`,
  "about:blank",
], { stdio: "ignore" });

const cleanup = () => {
  try { proc.kill(); } catch { /* gone */ }
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* locked */ }
};
process.on("exit", cleanup);

async function main() {
  await checkPrereqs();
  let version = null;
  for (let i = 0; i < 100; i++) {
    try { version = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`).then((r) => r.json()); break; }
    catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  if (!version) throw new Error("debugger never came up");

  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(String(ev.data));
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) rej(new Error(JSON.stringify(m.error))); else res(m.result);
    }
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((res, rej) => {
      const id = ++seq;
      pending.set(id, { res, rej });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Runtime.enable", {}, sessionId);
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
  const ev = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw new Error(`page eval threw: ${JSON.stringify(r.exceptionDetails).slice(0, 300)}`);
    return r.result?.value;
  };
  const waitFor = async (expr, ms = 20000, step = 400) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await ev(expr);
      if (v) return v;
      if (Date.now() > end) throw new Error(`waitFor timeout: ${expr.slice(0, 120)}`);
      await new Promise((r) => setTimeout(r, step));
    }
  };

  // Seed the v19 save BEFORE the app boots, so the first load is a real
  // migration rather than an empty-save boot followed by a write.
  await send("Page.navigate", { url: APP }, sessionId);
  await waitFor(`!!document.querySelector('#root')`);
  await ev(`localStorage.setItem('mabiroutine:v2', ${JSON.stringify(V19_SAVE)})`);
  await send("Page.navigate", { url: APP }, sessionId);
  await waitFor(`!!document.querySelector('#root')`);
  await new Promise((r) => setTimeout(r, 1500)); // let rehydration + the first write settle

  // --- S1: the v19 save migrated in the real rehydration path ---
  {
    const m = await ev(`(() => {
      try {
        const raw = JSON.parse(localStorage.getItem('mabiroutine:v2'));
        return {
          version: raw.version,
          hasFilters: raw.state ? ('barterFilters' in raw.state) : null,
          hideCompleted: raw.state?.prefs?.hideCompleted,
          collapsed: raw.state?.prefs?.pinnedCollapsed,
          charId: raw.state?.characters?.[0]?.id,
          parttime: raw.state?.characters?.[0]?.taskValues?.parttime,
          tower: raw.state?.characters?.[0]?.taskValues?.tower,
        };
      } catch (e) { return { error: String(e) }; }
    })()`);
    ok("S1 persisted version is v20 after loading a v19 save", m.version === 20, JSON.stringify(m));
    ok("S1 retired barterFilters is gone from the persisted state", m.hasFilters === false, JSON.stringify(m));
    ok("S1 prefs.pinnedCollapsed backfilled (both sections open)", m.collapsed && m.collapsed.daily === false && m.collapsed.weekly === false, JSON.stringify(m));
    ok("S1 existing hideCompleted survived the migration", m.hideCompleted === true, JSON.stringify(m));
    ok("S1 user progress survived (parttime true, tower 3)", m.parttime === true && m.tower === 3, JSON.stringify(m));
  }

  // --- S1b: a save that ALREADY carries a fold keeps it ---
  // The v20 step is a backfill, not a reset: it must not stomp a value it exists
  // only to fill in. Checked separately from S1 because a pure v19 save cannot
  // tell "backfilled to false" apart from "overwritten with false" — both read
  // false. This seeds a fold and asserts it survives.
  {
    const withFold = JSON.parse(V19_SAVE);
    withFold.state.prefs.pinnedCollapsed = { daily: true, weekly: false };
    await ev(`localStorage.setItem('mabiroutine:v2', ${JSON.stringify(JSON.stringify(withFold))})`);
    await send("Page.navigate", { url: APP }, sessionId);
    await waitFor(`!!document.querySelector('#root')`);
    await new Promise((r) => setTimeout(r, 1500));
    const m = await ev(`(() => {
      try {
        const raw = JSON.parse(localStorage.getItem('mabiroutine:v2'));
        return { version: raw.version, collapsed: raw.state?.prefs?.pinnedCollapsed ?? null };
      } catch (e) { return { error: String(e) }; }
    })()`);
    ok(
      "S1b an existing pinnedCollapsed fold is preserved, not reset",
      m.collapsed && m.collapsed.daily === true && m.collapsed.weekly === false,
      JSON.stringify(m)
    );
  }

  // --- S2: the shop grid, in a real layout engine ---
  {
    // Open the shop tab. The tab is a button with role=tab.
    const opened = await ev(`(() => {
      const tabs = [...document.querySelectorAll('[role="tab"]')];
      const shop = tabs.find((t) => (t.textContent || '').includes('商店'));
      if (!shop) return false;
      shop.click();
      return true;
    })()`);
    ok("S2 the 商店 / 以物易物 tab exists", opened === true);
    await waitFor(`document.querySelectorAll('[data-shop-tile]').length > 0`);
    await new Promise((r) => setTimeout(r, 800));

    const grid = await ev(`(() => {
      const tiles = [...document.querySelectorAll('[data-shop-tile]')];
      if (!tiles.length) return { tiles: 0 };
      const gridEl = tiles[0].parentElement;
      const tmpl = getComputedStyle(gridEl).gridTemplateColumns || '';
      const tracks = (tmpl.match(/repeat\\((\\d+)/) || [])[1] || tmpl.split(' ').filter(Boolean).length;
      // column count measured from LAYOUT, not from the template string: how
      // many tiles share the first row's top offset. This is what a reader sees.
      const tops = tiles.map((t) => Math.round(t.getBoundingClientRect().top));
      const first = tops[0];
      const inFirstRow = tops.filter((t) => t === first).length;
      return {
        tiles: tiles.length,
        tracks: Number(tracks),
        inFirstRow,
        gridWidth: Math.round(gridEl.getBoundingClientRect().width),
        viewport: window.innerWidth,
        tileWidth: Math.round(tiles[0].getBoundingClientRect().width),
      };
    })()`);
    ok("S2 tiles rendered", grid.tiles > 0, JSON.stringify(grid));
    ok("S2 grid template declares 4 columns at 1440px", grid.tracks === 4, JSON.stringify(grid));
    ok("S2 layout actually places 4 tiles on the first row", grid.inFirstRow === 4, JSON.stringify(grid));
    // The container is narrower than the viewport: this is the whole reason the
    // grid keys off its container. Guards against a future revert to viewport
    // breakpoints, which would make these two equal.
    ok("S2 the grid is narrower than the viewport (container-driven)", grid.gridWidth < grid.viewport, JSON.stringify(grid));

    // THE DISCRIMINATING CASE. At a window between 1024 and 1280px the two
    // rules disagree, which is the only reason this test can tell them apart:
    //   - container rule: the grid is capped at 864px, past its 840px threshold,
    //     so FOUR columns whatever the window does.
    //   - viewport rule (lg 1024 / xl 1280): THREE columns, because the window
    //     has not reached the 4-column breakpoint.
    // So a 1100px window that shows 3 columns is a viewport rule that came back.
    await send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    await new Promise((r) => setTimeout(r, 700));
    const mid = await ev(`(() => {
      const tiles = [...document.querySelectorAll('[data-shop-tile]')];
      if (!tiles.length) return { tiles: 0 };
      const tops = tiles.map((t) => Math.round(t.getBoundingClientRect().top));
      const inFirstRow = tops.filter((t) => t === tops[0]).length;
      const gridEl = tiles[0].parentElement;
      return {
        inFirstRow,
        gridWidth: Math.round(gridEl.getBoundingClientRect().width),
        viewport: window.innerWidth,
      };
    })()`);
    ok(
      "S2 a 1100px window still shows 4 columns (container rule, not the 1280px viewport rule)",
      mid.inFirstRow === 4,
      `${JSON.stringify(mid)} — 3 here means the grid reverted to viewport breakpoints`
    );
    await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    await new Promise((r) => setTimeout(r, 700));
  }

  // --- S3: clicking a pinned-section fold persists across a reload ---
  {
    // The pinned-section header buttons carry `aria-expanded` and read
    // "... 已釘選 N/N 收合". Addressed by that attribute and the 已釘選 label,
    // NOT by `closest('section')` — these headers are not section-wrapped.
    // The first such control is the daily lane, whose seeded pins make it the
    // one that always renders.
    const sel = `[...document.querySelectorAll('button[aria-expanded]')]
      .find((x) => (x.textContent || '').includes('已釘選'))`;

    const before = await ev(`(() => { const b = ${sel}; return b ? b.getAttribute('aria-expanded') : null; })()`);
    ok("S3 a pinned-section fold control exists with aria-expanded", before === "true" || before === "false", String(before));

    if (before !== null) {
      await ev(`(() => { const b = ${sel}; if (b) b.click(); })()`);
      await new Promise((r) => setTimeout(r, 1000));
      const after = await ev(`(() => { const b = ${sel}; return b ? b.getAttribute('aria-expanded') : null; })()`);
      ok("S3 clicking the control flips aria-expanded", after !== before, `before=${before} after=${after}`);

      // The reload assertion below is the behaviour that matters, and it is also
      // the only reliable one here: zustand's persist writes on a throttle AND
      // the sync merge rebuilds `prefs` from the synced key space, so reading
      // the raw blob key races the writer and can read the pre-click value.
      // Assert the OBSERVABLE state after a fresh load instead.
      await send("Page.navigate", { url: APP }, sessionId);
      await waitFor(`!!document.querySelector('#root')`);
      await new Promise((r) => setTimeout(r, 1500));
      const afterLoad = await ev(`(() => { const b = ${sel}; return b ? b.getAttribute('aria-expanded') : null; })()`);
      ok(
        "S3 the section is still folded after a reload",
        afterLoad === after,
        `reloaded aria-expanded=${afterLoad}, expected ${after}`
      );
    }
  }

  ws.close();
}

let skipped = false;
try {
  await main();
} catch (e) {
  if (e instanceof Skip) {
    skipped = true;
  } else {
    console.log(`FAIL: shop-e2e harness: ${e.message}`);
    failures += 1;
  }
} finally {
  cleanup();
}

if (skipped) {
  console.log("SHOP E2E SKIPPED");
} else {
  console.log(failures === 0 ? "SHOP E2E PASSED" : `${failures} FAILURES`);
}
process.exit(failures === 0 ? 0 : 1);
