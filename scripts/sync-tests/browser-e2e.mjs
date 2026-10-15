// Real-browser sync E2E (E1–E3). Drives Playwright's pinned Chromium — `pnpm
// install` does not fetch the binary, so run once:
//
//   pnpm exec playwright install chromium
//
// Two isolated browser contexts = two devices (separate storage); a second tab
// in one context = same-browser tab.
//
//  E1 propagation: tap 兼職 (parttime) on device A → server holds it →
//     device B boots linked and shows it checked (full real stack: UI tap,
//     debounced push, mount pull, merge, render).
//  E2 focus convergence: a second tab focuses later — server value intact,
//     tab shows checked (no phantom tombstone on wake-pull).
//  E3 contested key: a device boots with an unsynced local counter whose base
//     predates the peer's newer server value — the round drops the leftover,
//     adopts the server value, and never pushes the stale one.
//
// Needs an app + API base: local `pnpm dev:api` by default, or a preview
// deployment via SYNC_TEST_BASE. Protected previews need a Vercel automation
// bypass in SYNC_TEST_BYPASS: API calls carry it as a header, and the page is
// loaded with the bypass query + `x-vercel-set-bypass-cookie=true` so the app's
// own in-page fetches are authorized too. Preview shares the production Turso
// database (docs/sql-migration.md). Needs the Playwright Chromium. SKIP
// (exit 0, loud) otherwise.
// Throwaway session, deleted afterwards. Budget ~2 min.
import { chromium } from "playwright";

const BASE = (process.env.SYNC_TEST_BASE || "http://localhost:52608").replace(/\/+$/, "");
const APP = `${BASE}/`;
const API = `${BASE}/api/session`;
const BYPASS = process.env.SYNC_TEST_BYPASS;
const AUTH = BYPASS ? { "x-vercel-protection-bypass": BYPASS } : {};
const APP_URL = BYPASS
  ? `${APP}?x-vercel-protection-bypass=${encodeURIComponent(BYPASS)}&x-vercel-set-bypass-cookie=true`
  : APP;
// The one browser window the old CDP harness sized for every context.
const VIEWPORT = { width: 390, height: 844 };

class Skip extends Error {}
const skip = (why) => {
  console.log(`SKIP: browser-e2e ${why}`);
  throw new Skip();
};
let failures = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "ok" : "FAIL"}: ${name}${extra && cond ? "" : ` ${extra}`}`);
  if (!cond) failures += 1;
};

// process.exit() while undici sockets are open crashes Node on Windows
// (UV_HANDLE_CLOSING assert) — set exitCode and let the loop drain instead.
async function main() {
try {

// --- prereqs: app reachable, then the pinned Chromium present ---
let code;
try {
  code = await fetch(APP, { method: "HEAD", headers: AUTH }).then((r) => r.status);
} catch {
  skip(`(needs the app reachable at ${BASE} — local: \`pnpm dev:api\`)`);
}
if (code !== 200) skip(`(test base ${BASE} answered ${code})`);

// `pnpm install` does not fetch the browser (the package has no postinstall),
// so on a fresh clone this is the loud, actionable skip rather than a crash.
let browser;
try {
  browser = await chromium.launch({ headless: true });
} catch (e) {
  if (/Executable doesn't exist|playwright install/i.test(String(e?.message))) {
    skip("(Playwright Chromium not installed — run `pnpm exec playwright install chromium`)");
  }
  throw e;
}

// --- throwaway session ---
let SID;
const cleanup = async () => {
  if (SID) {
    try { await fetch(API, { method: "DELETE", headers: { "content-type": "application/json", ...AUTH }, body: JSON.stringify({ id: SID }) }); } catch { /* gone */ }
  }
  try { await browser.close(); } catch { /* gone */ }
};

let skipped = false;
try {
  const created = await fetch(API, {
    method: "POST",
    headers: { "content-type": "application/json", ...AUTH },
    body: JSON.stringify({ state: {} }),
  }).then((r) => r.json());
  SID = created.id;
  if (!SID) {
    if (created.error && /too many sessions/i.test(created.error)) {
      console.log("SKIP: browser-e2e create budget spent (10/hr/IP) — retry later");
      skipped = true;
      return;
    }
    console.log("FAIL: could not create session", JSON.stringify(created));
    failures += 1;
    return;
  }
  const apiGet = () => fetch(`${API}?id=${SID}`, { headers: AUTH }).then((r) => r.json());

  const settle = (ms) => new Promise((r) => setTimeout(r, ms));
  const evaluate = (page, expression) => page.evaluate(expression);
  const waitFor = async (page, expr, ms = 25000, step = 500) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await evaluate(page, expr);
      if (v) return v;
      if (Date.now() > end) throw new Error(`waitFor timeout: ${expr.slice(0, 120)}`);
      await settle(step);
    }
  };
  const newPage = (context) => context.newPage();
  const gotoApp = (page) => page.goto(APP_URL, { waitUntil: "load" });
  const linkSession = (sid) =>
    `localStorage.setItem('mabiroutine:session', JSON.stringify({id:'${sid}',updatedAt:0}))`;
  const CHECK_SEL = `[data-task-id="parttime"] [role="checkbox"]`;
  // (parenthesized: ?? binds looser than ===/!==)
  const checkedOf = (sel) => `((document.querySelector('${sel}')||{}).getAttribute?.('aria-checked') ?? null)`;
  const charIdOf = `JSON.parse(localStorage.getItem('mabiroutine:v2')).state.characters[0].id`;

  // --- E1: device A taps, device B boots and shows it ---
  const ctxA = await browser.newContext({ viewport: VIEWPORT });
  const ctxB = await browser.newContext({ viewport: VIEWPORT });
  const tabA = await newPage(ctxA);
  await gotoApp(tabA);
  await evaluate(tabA, linkSession(SID));
  await gotoApp(tabA); // reload linked: boot pull + reset settle
  await waitFor(tabA, `!!document.querySelector('${CHECK_SEL}')`);
  await settle(5000); // boot reset + marker push settle
  const before = await evaluate(tabA, checkedOf(CHECK_SEL));
  await evaluate(tabA, `document.querySelector('${CHECK_SEL}').click()`);
  await waitFor(tabA, `${checkedOf(CHECK_SEL)}!==${JSON.stringify(before)}`);
  const cidA = await evaluate(tabA, charIdOf);
  let serverVal = null;
  for (let i = 0; i < 14; i++) { // debounced push (3s) + margin
    const g = await apiGet();
    if (Object.entries(g.state ?? {}).some(([k, v]) => k.startsWith(`v:${cidA}:parttime@`) && v === true)) { serverVal = true; break; }
    await settle(1000);
  }
  ok("E1 tap reached server", serverVal === true, `v:${cidA}:parttime@*`);

  const tabB = await newPage(ctxB);
  await gotoApp(tabB);
  await evaluate(tabB, linkSession(SID));
  await gotoApp(tabB); // mount pull adopts
  await waitFor(tabB, `!!document.querySelector('${CHECK_SEL}')`);
  // A fresh device's own empty character differs from the peer's; the remote
  // `meta:active` now wins the contest (decision 16), so B usually lands on
  // the adopted tab already. The forced activation + reload below keeps the
  // render assertion deterministic either way.
  // 1) merge correctness: some character in B's persist holds the check…
  const holder = await waitFor(tabB, `
    (() => { try {
      const p = JSON.parse(localStorage.getItem('mabiroutine:v2'));
      const hit = p.state.characters.find(c => c.taskValues && c.taskValues.parttime === true);
      return hit ? hit.id : false;
    } catch (e) { return false; } })()`, 20000);
  ok("E1 device B merged the check", typeof holder === "string", String(holder));
  // 2) render: activate that character, reload, checkbox reads checked.
  await evaluate(tabB, `
    (() => { const p = JSON.parse(localStorage.getItem('mabiroutine:v2'));
      p.state.activeCharId = '${holder}';
      localStorage.setItem('mabiroutine:v2', JSON.stringify(p)); })()`);
  await gotoApp(tabB);
  await waitFor(tabB, `!!document.querySelector('${CHECK_SEL}')`);
  let shownB;
  try {
    shownB = await waitFor(tabB, `${checkedOf(CHECK_SEL)}==='true'`, 20000);
  } catch {
    shownB = `TIMEOUT attr=${await evaluate(tabB, checkedOf(CHECK_SEL))}`;
  }
  ok("E1 device B shows checked", shownB === true, String(shownB));

  // --- E2: second tab in A wakes later — value intact everywhere ---
  const tabA2 = await newPage(ctxA);
  await gotoApp(tabA2);
  await waitFor(tabA2, `!!document.querySelector('${CHECK_SEL}')`);
  const shownA2 = await waitFor(tabA2, `${checkedOf(CHECK_SEL)}==='true'`);
  ok("E2 second tab shows checked", shownA2 === "true" || shownA2 === true, String(shownA2));
  // focus original tab (wake-pull) and confirm the server value survives it
  await tabA.bringToFront().catch(() => ({}));
  await settle(8000); // focus pull + push cycle
  const g2 = await apiGet();
  ok("E2 server value survives wake-pull", Object.entries(g2.state ?? {}).some(([k, v]) => k.startsWith(`v:${cidA}:parttime@`) && v === true), "parttime@*");

  // --- E3: contested key — an unsynced leftover loses to the peer's value ---
  // Server tower = 3 (a peer's later edit). A device boots with base tower = 1
  // and a local tower = 9 that never pushed: both sides changed the key since
  // this device last synced, so the round drops the local 9 and adopts 3.
  {
    const bucket = Object.keys(g2.state ?? {}).find((k) => k.startsWith(`v:${cidA}:parttime@`))?.split("@")[1] ?? "";
    ok("E3 bucket resolved", bucket.length > 0, bucket);
    await fetch(API, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...AUTH },
      body: JSON.stringify({ id: SID, changes: { [`v:${cidA}:tower@${bucket}`]: 3 } }),
    });
    const ctxC = await browser.newContext({ viewport: VIEWPORT });
    // Document-start seeding: the crafted state and base land before the app's
    // own hydrated write, so nothing races over them.
    //
    // The protocol guard is not decorative: init scripts also run on the initial
    // about:blank, where localStorage is access-denied, so an unguarded write
    // raises a page error on every run (verified). Cheaper to skip than to
    // wrap the whole body in a catch that would also swallow a real failure on
    // the app origin.
    await ctxC.addInitScript(({ cid, sid, bucket }) => {
      if (!/^https?:$/.test(location.protocol)) return; // opaque origin: nothing to seed
      localStorage.setItem('mabiroutine:v2', JSON.stringify({
        state: {
          version: 22,
          characters: [{ id: cid, name: 'A', taskValues: { tower: 9 }, hiddenTaskIds: [] }],
          activeCharId: cid,
          accountValues: {},
          hiddenAccountTaskIds: [],
          barterPins: [],
          barterCustomOrder: null,
          customTasks: [],
          lastDailyReset: bucket,
          lastWeeklyReset: null,
          prefs: { hideCompleted: false, pinnedCollapsed: { daily: false, weekly: false } },
          globalTaskOrder: {},
          taskBuckets: { tower: bucket },
          hourlyReminders: [],
          purpleHoleReminders: []
        },
        version: 22
      }));
      localStorage.setItem('mabiroutine:flatbase', JSON.stringify({
        sessionId: sid,
        flat: {
          ['v:' + cid + ':tower@' + bucket]: 1,
          ['char:' + cid + ':name']: 'A',
          'meta:active': cid
        },
        ts: 0
      }));
      localStorage.setItem('mabiroutine:session', JSON.stringify({ id: sid, updatedAt: 0 }));
    }, { cid: cidA, sid: SID, bucket });
    const tabC = await newPage(ctxC);
    await gotoApp(tabC);
    await waitFor(tabC, `!!document.querySelector('[data-task-id="tower"]')`, 20000).catch(() => null);
    await settle(9000); // boot round + debounced flush settle
    const g3 = await apiGet();
    const serverTower = (g3.state ?? {})[`v:${cidA}:tower@${bucket}`];
    ok("E3 server keeps the peer value", serverTower === 3, `tower=${JSON.stringify(serverTower)}`);
    const localTower = await evaluate(
      tabC,
      `(() => { try { const p = JSON.parse(localStorage.getItem('mabiroutine:v2')); const c = p.state.characters.find(c => c.id === ${JSON.stringify(cidA)}); return c ? c.taskValues.tower : 'NO-CHAR'; } catch (e) { return 'ERR'; } })()`
    );
    ok("E3 device adopted the peer value", localTower === 3, `local tower=${JSON.stringify(localTower)}`);
    const journal = await evaluate(
      tabC,
      `(() => { try { return JSON.parse(window.__mabiSyncJournal()); } catch (e) { return null; } })()`
    );
    const droppedTower = Array.isArray(journal)
      ? journal.some((e) => Array.isArray(e.dropped) && e.dropped.some((d) => typeof d.key === "string" && d.key.includes(":tower@") && d.local === 9 && d.base === 1 && d.remote === 3))
      : false;
    const pushedTower = Array.isArray(journal)
      ? journal.some((e) => Array.isArray(e.pushed) && e.pushed.some((p) => typeof p.key === "string" && p.key.includes(":tower@")))
      : false;
    ok("E3 journal records the dropped contest", droppedTower, JSON.stringify(journal).slice(0, 300));
    ok("E3 journal never records a tower push", !pushedTower, JSON.stringify(journal).slice(0, 300));
  }
} catch (e) {
  console.log(`FAIL: browser-e2e harness: ${e.message}`);
  failures += 1;
} finally {
  await cleanup();
}

if (!skipped) {
  console.log(failures === 0 ? "BROWSER E2E PASSED" : `${failures} FAILURES`);
  process.exitCode = failures === 0 ? 0 : 1;
} else {
  console.log("BROWSER E2E SKIPPED");
}
} catch (e) {
  if (e instanceof Skip) {
    console.log("BROWSER E2E SKIPPED");
    process.exitCode = 0;
  } else throw e;
}
}

await main();
