// Real-browser sync E2E (E1–E2). Drives MS Edge over CDP — zero npm deps
// (Node global WebSocket + fetch). Two isolated browser contexts = two
// devices (separate storage); a second tab in one context = same-browser tab.
//
//  E1 propagation: tap 兼職 (parttime) on device A → server holds it →
//     device B boots linked and shows it checked (full real stack: UI tap,
//     debounced push, mount pull, merge, render).
//  E2 focus convergence: a second tab focuses later — server value intact,
//     tab shows checked (no phantom tombstone on wake-pull).
//
// Needs `pnpm dev:api` on :52608 + Edge. SKIP (exit 0, loud) otherwise.
// Throwaway session, deleted afterwards. Budget ~2 min.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const APP = "http://127.0.0.1:52608/";
const API = "http://127.0.0.1:52608/api/session";
const DEBUG_PORT = 9333;
const EDGE_CANDIDATES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

const skip = (why) => {
  console.log(`SKIP: browser-e2e ${why}`);
  process.exit(0);
};
let failures = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "ok" : "FAIL"}: ${name}${extra && cond ? "" : ` ${extra}`}`);
  if (!cond) failures += 1;
};

// --- prereqs ---
const edge = EDGE_CANDIDATES.find((p) => fs.existsSync(p));
if (!edge) skip("(Edge not found)");
try {
  const code = await fetch(APP, { method: "HEAD" }).then((r) => r.status);
  if (code !== 200) skip(`(dev server :52608 answered ${code})`);
} catch {
  skip("(needs `pnpm dev:api` on :52608)");
}

// --- throwaway session ---
const created = await fetch(API, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ state: {} }),
}).then((r) => r.json());
const SID = created.id;
if (!SID) {
  console.log("FAIL: could not create session", JSON.stringify(created));
  process.exit(1);
}
const apiGet = () => fetch(`${API}?id=${SID}`).then((r) => r.json());

// --- Edge + CDP ---
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "mabiroutine-e2e-"));
const proc = spawn(edge, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--disable-extensions",
  `--window-size=390,844`,
  `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profile}`,
  "about:blank",
], { stdio: "ignore" });

const cleanup = async () => {
  try { await fetch(API, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: SID }) }); } catch { /* gone */ }
  try { proc.kill(); } catch { /* gone */ }
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* locked */ }
};
process.on("exit", () => { try { proc.kill(); } catch { /* x */ } });

let ws;
try {
  // wait for debugger
  let version = null;
  for (let i = 0; i < 100; i++) {
    try {
      version = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`).then((r) => r.json());
      break;
    } catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  if (!version) throw new Error("debugger never came up");

  ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });

  let seq = 0;
  const pending = new Map();
  const loadWaiters = new Map(); // sessionId -> resolve
  ws.onmessage = (ev) => {
    const m = JSON.parse(String(ev.data));
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) rej(new Error(JSON.stringify(m.error)));
      else res(m.result);
    } else if (m.method === "Page.loadEventFired" && loadWaiters.has(m.sessionId)) {
      loadWaiters.get(m.sessionId)();
      loadWaiters.delete(m.sessionId);
    }
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((res, rej) => {
      const id = ++seq;
      pending.set(id, { res, rej });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  const evaluate = async (sessionId, expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw new Error(`page eval threw: ${expression.slice(0, 120)} ${JSON.stringify(r.exceptionDetails).slice(0, 200)}`);
    return r.result?.value;
  };
  const waitLoad = (sessionId, ms = 20000) =>
    new Promise((res, rej) => {
      const t = setTimeout(() => { loadWaiters.delete(sessionId); rej(new Error("load timeout")); }, ms);
      loadWaiters.set(sessionId, () => { clearTimeout(t); res(); });
    });
  const waitFor = async (sessionId, expr, ms = 25000, step = 500) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await evaluate(sessionId, expr);
      if (v) return v;
      if (Date.now() > end) throw new Error(`waitFor timeout: ${expr.slice(0, 120)}`);
      await new Promise((r) => setTimeout(r, step));
    }
  };
  const newTab = async (contextId) => {
    const { targetId } = await send("Target.createTarget", { url: "about:blank", ...(contextId ? { browserContextId: contextId } : {}) });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    await send("Page.enable", {}, sessionId);
    await send("Runtime.enable", {}, sessionId);
    return { targetId, sessionId };
  };
  const gotoApp = async (sessionId) => {
    const w = waitLoad(sessionId);
    await send("Page.navigate", { url: APP }, sessionId);
    await w;
  };
  const linkSession = (sid) =>
    `localStorage.setItem('mabiroutine:session', JSON.stringify({id:'${sid}',updatedAt:0}))`;
  const CHECK_SEL = `[data-task-id="parttime"] [role="checkbox"]`;
  // (parenthesized: ?? binds looser than ===/!==)
  const checkedOf = (sel) => `((document.querySelector('${sel}')||{}).getAttribute?.('aria-checked') ?? null)`;
  const charIdOf = `JSON.parse(localStorage.getItem('mabiroutine:v2')).state.characters[0].id`;

  // --- E1: device A taps, device B boots and shows it ---
  const ctxA = (await send("Target.createBrowserContext", {})).browserContextId;
  const ctxB = (await send("Target.createBrowserContext", {})).browserContextId;
  const tabA = await newTab(ctxA);
  await gotoApp(tabA.sessionId);
  await evaluate(tabA.sessionId, linkSession(SID));
  await gotoApp(tabA.sessionId); // reload linked: boot pull + reset settle
  await waitFor(tabA.sessionId, `!!document.querySelector('${CHECK_SEL}')`);
  await new Promise((r) => setTimeout(r, 5000)); // boot reset + marker push settle
  const before = await evaluate(tabA.sessionId, checkedOf(CHECK_SEL));
  await evaluate(tabA.sessionId, `document.querySelector('${CHECK_SEL}').click()`);
  await waitFor(tabA.sessionId, `${checkedOf(CHECK_SEL)}!==${JSON.stringify(before)}`);
  const cidA = await evaluate(tabA.sessionId, charIdOf);
  let serverVal = null;
  for (let i = 0; i < 14; i++) { // debounced push (3s) + margin
    const g = await apiGet();
    if (g.state?.[`v:${cidA}:parttime`] === true) { serverVal = true; break; }
    await new Promise((r) => setTimeout(r, 1000));
  }
  ok("E1 tap reached server", serverVal === true, `v:${cidA}:parttime`);

  const tabB = await newTab(ctxB);
  await gotoApp(tabB.sessionId);
  await evaluate(tabB.sessionId, linkSession(SID));
  await gotoApp(tabB.sessionId); // mount pull adopts
  await waitFor(tabB.sessionId, `!!document.querySelector('${CHECK_SEL}')`);
  // A fresh device keeps its own empty character active (its meta:active push
  // wins by arrival) — the adopted check lives on the adopted character tab.
  // 1) merge correctness: some character in B's persist holds the check…
  const holder = await waitFor(tabB.sessionId, `
    (() => { try {
      const p = JSON.parse(localStorage.getItem('mabiroutine:v2'));
      const hit = p.state.characters.find(c => c.taskValues && c.taskValues.parttime === true);
      return hit ? hit.id : false;
    } catch (e) { return false; } })()`, 20000);
  ok("E1 device B merged the check", typeof holder === "string", String(holder));
  // 2) render: activate that character, reload, checkbox reads checked.
  await evaluate(tabB.sessionId, `
    (() => { const p = JSON.parse(localStorage.getItem('mabiroutine:v2'));
      p.state.activeCharId = '${holder}';
      localStorage.setItem('mabiroutine:v2', JSON.stringify(p)); })()`);
  await gotoApp(tabB.sessionId);
  await waitFor(tabB.sessionId, `!!document.querySelector('${CHECK_SEL}')`);
  let shownB;
  try {
    shownB = await waitFor(tabB.sessionId, `${checkedOf(CHECK_SEL)}==='true'`, 20000);
  } catch {
    shownB = `TIMEOUT attr=${await evaluate(tabB.sessionId, checkedOf(CHECK_SEL))}`;
  }
  ok("E1 device B shows checked", shownB === true, String(shownB));

  // --- E2: second tab in A wakes later — value intact everywhere ---
  const tabA2 = await newTab(ctxA);
  await gotoApp(tabA2.sessionId);
  await waitFor(tabA2.sessionId, `!!document.querySelector('${CHECK_SEL}')`);
  const shownA2 = await waitFor(tabA2.sessionId, `${checkedOf(CHECK_SEL)}==='true'`);
  ok("E2 second tab shows checked", shownA2 === "true" || shownA2 === true, String(shownA2));
  // focus original tab (wake-pull) and confirm the server value survives it
  await send("Page.bringToFront", {}, tabA.sessionId).catch(() => ({}));
  await new Promise((r) => setTimeout(r, 8000)); // focus pull + push cycle
  const g2 = await apiGet();
  ok("E2 server value survives wake-pull", g2.state?.[`v:${cidA}:parttime`] === true, JSON.stringify(g2.state?.[`v:${cidA}:parttime`]));
} catch (e) {
  console.log(`FAIL: browser-e2e harness: ${e.message}`);
  failures += 1;
} finally {
  try { ws?.close(); } catch { /* x */ }
  await cleanup();
}

console.log(failures === 0 ? "BROWSER E2E PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
