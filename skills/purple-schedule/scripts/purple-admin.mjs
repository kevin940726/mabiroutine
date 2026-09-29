#!/usr/bin/env node
// purple-admin — thin CLI over the worker's /admin API for purple-hole
// schedule corrections. See ../SKILL.md for the workflow and guardrails.
//
// Auth: MABI_ADMIN_SECRET (the worker's ADMIN_SECRET), sent as a bearer token.
// Never commit it, never print it, never pass it as an argument. Optional
// MABI_WORKER_URL overrides the default worker base.
//
//   state                             read-only: verified + candidates + overrides
//   predict [n]                       read-only: next n spawns (from /purple-schedule)
//   no-shift <start Taipei>           tombstone a window (maintenance did NOT pause)
//   shift-amount <start> <end Taipei> override a window's end (pause differs)
//   anchor <spawn Taipei>             re-anchor to an observed spawn, then resume auto
//   promote                           accept all watcher candidates
//   auto <true|false>                 lock / resume auto-apply
//
// Taipei times are "YYYY-MM-DD HH:mm" (UTC+8, no DST); ISO-8601 also accepted.

const BASE = (process.env.MABI_WORKER_URL ?? "https://mabiroutine-worker.kaihao.workers.dev").replace(/\/+$/, "");
const SECRET = process.env.MABI_ADMIN_SECRET ?? process.env.ADMIN_SECRET ?? "";

const die = (m) => {
  console.error(`error: ${m}`);
  process.exit(1);
};
const fmt = (ms) => new Date(ms + 8 * 3600e3).toISOString().replace("T", " ").slice(0, 16) + " Taipei";

function taipeiToMs(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(s).trim());
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 8, +m[5], +(m[6] ?? 0));
  const t = Date.parse(s);
  if (Number.isFinite(t)) return t;
  return die(`cannot parse time "${s}" — use "YYYY-MM-DD HH:mm" (Taipei) or ISO-8601`);
}

async function admin(path, init) {
  if (!SECRET) die("MABI_ADMIN_SECRET is not set (export the admin secret; never commit or print it)");
  try {
    const res = await fetch(BASE + path, {
      ...init,
      headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" },
    });
    const text = await res.text();
    if (res.status === 401) die(`${path} -> 401 (wrong or missing admin secret)`);
    if (!res.ok) die(`${path} -> ${res.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  } catch (e) {
    // die() exits rather than throwing, so this only catches fetch/parse faults.
    return die(`${path} -> ${e instanceof Error ? e.message : String(e)}`);
  }
}
const getState = () => admin("/admin/api/state");
async function getSchedule() {
  try {
    const res = await fetch(`${BASE}/purple-schedule`, { cache: "no-store" });
    if (!res.ok) die(`/purple-schedule -> ${res.status}`);
    return await res.json();
  } catch (e) {
    return die(`/purple-schedule -> ${e instanceof Error ? e.message : String(e)}`);
  }
}

function showState(st) {
  const at = st.verified?.updatedAt ? new Date(st.verified.updatedAt).toISOString() : "(never)";
  console.log(`verified  updatedAt ${at}  auto=${st.verified?.auto}`);
  console.log(`  anchor  ${fmt(st.verified.anchorMs)}`);
  for (const w of st.verified?.windows ?? []) console.log(`  window  ${fmt(w.startMs)} -> ${fmt(w.endMs)}`);
  const cands = st.candidates?.windows ?? [];
  console.log(`candidates (${cands.length}):`);
  for (const w of cands) console.log(`  ${fmt(w.startMs)} -> ${fmt(w.endMs)}`);
  console.log("overrides:");
  for (const o of st.overrides?.overrides ?? []) console.log(`  window  ${fmt(o.startMs)} -> ${fmt(o.endMs)}`);
  for (const t of st.overrides?.tombstones ?? []) console.log(`  ignore  ${fmt(t.startMs)} -> ${fmt(t.endMs)}`);
}

// The worker only re-resolves on an override save when auto is true, so on a
// locked doc a no-shift/shift-amount is stored but not applied. Call this out
// instead of letting a caller report success on a no-op.
function warnIfLocked(st) {
  if (st.verified?.auto === false) {
    console.log("NOTE: the doc is LOCKED (auto=false): the change is stored but NOT applied until you resume (`auto true`).");
  }
}

function findByStart(st, startMs) {
  const all = [...(st.candidates?.windows ?? []), ...(st.verified?.windows ?? [])];
  return (
    all.find((w) => w.startMs === startMs) ??
    (st.overrides?.overrides ?? []).find((o) => o.startMs === startMs) ??
    null
  );
}
const candHint = (st) => (st.candidates?.windows ?? []).map((w) => fmt(w.startMs)).join(", ") || "(none)";

async function predict(n) {
  try {
    const doc = await getSchedule();
    const mod = await import(new URL("../../../src/lib/purpleHole.ts", import.meta.url).href);
    mod.setPurpleTimetable(doc.anchorMs, doc.windows);
    const now = Date.now();
    const first = mod.firstIndexAfter(now, doc.windows, doc.anchorMs);
    for (let k = first - 1; k < first - 1 + n; k++) {
      const t = mod.nthOccurrence(k, doc.windows, doc.anchorMs);
      console.log(`${k === first ? "next->" : "      "} ${fmt(t)}${t <= now ? "  (past)" : ""}`);
    }
  } catch (e) {
    console.error(`(predict unavailable: ${e.message})`);
  }
}

// Full replacement: the caller read the current lists and rewrote them, so this
// is a read-modify-write (a concurrent /admin save between the read and here
// would be clobbered; single maintainer, so accepted).
const saveOverrides = (overrides, tombstones) =>
  admin("/admin/api/overrides", { method: "POST", body: JSON.stringify({ overrides, tombstones }) });

const USAGE = `purple-admin <command>
  state
  predict [n]
  no-shift <start Taipei>
  shift-amount <start Taipei> <effective-end Taipei>
  anchor <observed-spawn Taipei>
  promote
  auto <true|false>`;

const [cmd, ...args] = process.argv.slice(2);

if (!cmd || cmd === "-h" || cmd === "--help") {
  console.log(USAGE);
  process.exit(0);
}

if (cmd === "state") {
  showState(await getState());
} else if (cmd === "predict") {
  await predict(Math.max(1, Number(args[0] ?? 4) || 4));
} else if (cmd === "no-shift") {
  if (!args[0]) die("usage: no-shift <candidate-start Taipei>");
  const startMs = taipeiToMs(args[0]);
  const st = await getState();
  const win = findByStart(st, startMs);
  if (!win) die(`no window or override starts at ${fmt(startMs)}; candidates: ${candHint(st)}`);
  // Drop any override at that start too: resolveWindows appends overrides even
  // when the matching candidate is tombstoned, so a leftover override would
  // keep shifting the legs.
  const overrides = (st.overrides?.overrides ?? []).filter((o) => o.startMs !== startMs);
  const tombstones = (st.overrides?.tombstones ?? []).filter((t) => t.startMs !== startMs);
  tombstones.push({ startMs: win.startMs, endMs: win.endMs });
  await saveOverrides(overrides, tombstones);
  const after = await getState();
  showState(after);
  warnIfLocked(after);
  await predict(4);
} else if (cmd === "shift-amount") {
  if (!args[1]) die("usage: shift-amount <candidate-start Taipei> <effective-end Taipei>");
  const startMs = taipeiToMs(args[0]);
  const endMs = taipeiToMs(args[1]);
  if (!(startMs < endMs)) die("effective end must be after the start");
  const st = await getState();
  if (!findByStart(st, startMs)) die(`no window starts at ${fmt(startMs)}; candidates: ${candHint(st)}`);
  const overrides = (st.overrides?.overrides ?? [])
    .filter((o) => o.startMs !== startMs)
    .concat([{ startMs, endMs }]);
  const tombstones = (st.overrides?.tombstones ?? []).filter((t) => t.startMs !== startMs);
  await saveOverrides(overrides, tombstones);
  const after = await getState();
  showState(after);
  warnIfLocked(after);
  await predict(4);
} else if (cmd === "anchor") {
  if (!args[0]) die("usage: anchor <observed-spawn Taipei>");
  const anchorMs = taipeiToMs(args[0]);
  const st = await getState();
  const wasLocked = st.verified?.auto === false;
  await admin("/admin/api/publish", {
    method: "POST",
    body: JSON.stringify({ anchorMs, windows: st.verified?.windows ?? [] }),
  });
  // publish always locks auto. An unlocked doc is resumed so the watcher keeps
  // windows current; a doc that was ALREADY locked stays locked, or resuming
  // would rebuild windows from candidates and drop hand-published ones.
  if (wasLocked) {
    console.log("NOTE: the doc was LOCKED; anchor saved with auto left locked so hand-published windows are preserved. Resume from /admin when ready.");
  } else {
    await admin("/admin/api/auto", { method: "POST", body: JSON.stringify({ auto: true }) });
  }
  showState(await getState());
  await predict(4);
} else if (cmd === "promote") {
  console.log(JSON.stringify(await admin("/admin/api/promote", { method: "POST" })));
  showState(await getState());
} else if (cmd === "auto") {
  const v = args[0];
  if (v !== "true" && v !== "false") die("usage: auto <true|false>");
  console.log(JSON.stringify(await admin("/admin/api/auto", { method: "POST", body: JSON.stringify({ auto: v === "true" }) })));
  showState(await getState());
} else {
  die(`unknown command "${cmd}" (see --help)`);
}
