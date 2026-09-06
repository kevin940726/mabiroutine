// Two-tab sync-poison harness. Each fake tab gets its own vm realm running
// the REAL bundled flat.ts (per-tab module state + storage globals); the two
// browser tabs share one localStorage object (the browser bucket), the phone
// gets its own. Run with a bundle path + label:
//   node run.cjs <flat-old.cjs|flat-new.cjs> <label>
const fs = require("node:fs");
const vm = require("node:vm");

const [bundlePath, label] = process.argv.slice(2);
const flatSrc = fs.readFileSync(bundlePath, "utf8");

function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
  };
}

// One realm = one tab (own module state). Browser tabs share localStorage.
const sharedLS = memStorage();
function spawnTab(ls, ss) {
  const sandbox = {
    module: { exports: {} },
    console,
    localStorage: ls,
    sessionStorage: ss,
  };
  sandbox.exports = sandbox.module.exports;
  vm.createContext(sandbox);
  vm.runInContext(`${flatSrc}\n;this.__flat = this.module.exports;`, sandbox);
  return sandbox.__flat;
}

const SID = "test-session";
const FILTERS = { priority: "all", town: "all", skill: "all", onlyPinned: false };
const mem = (values, daily, weekly) => ({
  version: 12,
  characters: [{ id: "c1", name: "A", taskValues: { ...values }, hiddenTaskIds: [] }],
  activeCharId: "c1",
  accountValues: {},
  hiddenAccountTaskIds: [],
  barterPins: [],
  customTasks: [],
  lastDailyReset: daily,
  lastWeeklyReset: weekly,
  prefs: { hideCompleted: false },
  globalTaskOrder: undefined,
  barterFilters: { ...FILTERS },
});

// Faithful-enough server: per-field LWW, tombstones retained.
let server = {};
const serverApply = (changes) => {
  server = { ...server, ...changes };
};
const serverGet = () => ({ ...server });

const tabA = spawnTab(sharedLS, memStorage());
const tabB = spawnTab(sharedLS, memStorage());
const phone = spawnTab(memStorage(), memStorage());
const log = [];

// 1. Tab A boots Monday (d1 checked), pushes full map.
{
  const m = mem({ d1: true }, "2026-09-01", "2026-W0901");
  const flat = tabA.flattenSnapshot(m);
  serverApply(tabA.diffFlat(tabA.loadBase(SID), flat));
  tabA.saveBase(SID, flat);
  log.push(`1 server keys: ${Object.keys(server).sort().join(",")}`);
}
// 2. Fresh tab B opens in the same browser (seeds base on new code).
{
  const base = tabB.loadBase(SID);
  log.push(`2 tabB base has d1: ${"v:c1:d1" in base}`);
}
// 3. Phone's Tuesday: d1 + d2 checked, Tue markers; pushes its diff.
{
  const m = mem({ d1: true, d2: true }, "2026-09-02", "2026-W0901");
  phone.saveBase(SID, tabA.flattenSnapshot(mem({ d1: true }, "2026-09-01", "2026-W0901")));
  const changes = phone.diffFlat(phone.loadBase(SID), phone.flattenSnapshot(m));
  serverApply(changes);
  phone.saveBase(SID, { ...phone.loadBase(SID), ...changes });
  log.push(`3 phone pushed d2: ${changes["v:c1:d2"] === true}, server d2: ${JSON.stringify(server["v:c1:d2"])}`);
}
// 4. Tab B pulls: converges (advances ITS base view).
let pushB;
{
  const m = mem({ d1: true }, "2026-09-01", "2026-W0901");
  pushB = tabB.diffFlat(tabB.loadBase(SID), tabB.flattenSnapshot(m));
  serverApply(pushB);
  const remote = serverGet();
  const merged = tabB.unflattenMerge(remote, m, 12);
  tabB.saveBase(SID, remote);
  log.push(`4 tabB push keys: ${Object.keys(pushB).join(",") || "(none)"}, tabB d2: ${JSON.stringify(merged.characters[0]?.taskValues?.["d2"] ?? null)}`);
}
// 5. STALE tab A wakes: focus pull pushes FIRST.
let changesA;
{
  const m = mem({ d1: true }, "2026-09-01", "2026-W0901");
  changesA = tabA.diffFlat(tabA.loadBase(SID), tabA.flattenSnapshot(m));
  serverApply(changesA);
  tabA.saveBase(SID, { ...tabA.loadBase(SID), ...changesA });
  const tomb = Object.entries(changesA)
    .filter(([, v]) => v === null)
    .map(([k]) => k);
  log.push(`5 tabA push tombstones: ${tomb.join(",") || "(none)"}`);
}
// 6. Tab A pulls after.
let memA2d2 = null;
{
  const m = mem({ d1: true }, "2026-09-01", "2026-W0901");
  const merged = tabA.unflattenMerge(serverGet(), m, 12);
  memA2d2 = merged.characters[0]?.taskValues?.["d2"] ?? null;
}

console.log(
  JSON.stringify(
    {
      label,
      tabATombstonedD2: changesA["v:c1:d2"] === null,
      serverD2: server["v:c1:d2"] ?? null,
      tabASeesD2: memA2d2,
      tabBPushKeys: Object.keys(pushB),
      guilty: changesA["v:c1:d2"] === null,
      log,
    },
    null,
    1
  )
);

// --- Scenario B: 7-character union vs the 6-cap slice ---------------------
// A merge that slices an overflow character must never tombstone its keys.
{
  const tab = spawnTab(memStorage(), memStorage());
  const chars = Array.from({ length: 7 }, (_, i) => ({
    id: `cx${i}`,
    name: `X${i}`,
    taskValues: { d1: true },
    hiddenTaskIds: [],
  }));
  const mem7 = {
    version: 12,
    characters: chars,
    activeCharId: "cx0",
    accountValues: {},
    hiddenAccountTaskIds: [],
    barterPins: [],
    customTasks: [],
    lastDailyReset: "2026-09-02",
    lastWeeklyReset: "2026-W0901",
    prefs: { hideCompleted: false },
    globalTaskOrder: undefined,
    barterFilters: { ...FILTERS },
  };
  const SID2 = "test-cap";
  let server2 = { ...tab.flattenSnapshot(mem7) };
  // Tab pulls: empty base → full push (harmless), merge slices to 6.
  const push0 = tab.diffFlat(tab.loadBase(SID2), tab.flattenSnapshot(mem7));
  server2 = { ...server2, ...push0 };
  const merged = tab.unflattenMerge({ ...server2 }, mem7, 12);
  tab.saveBase(SID2, { ...server2 });
  // What pullNow does next (new code): scrub overflow keys from the base.
  if (typeof tab.capOverflowKeys === "function") {
    const overflow = tab.capOverflowKeys(server2, merged.characters.map((c) => c.id));
    const base = tab.loadBase(SID2);
    for (const k of overflow) delete base[k];
    tab.saveBase(SID2, base);
  }
  // Tab's next push after the slice: must contain NO tombstones for cx6.
  const memSliced = { ...mem7, characters: merged.characters };
  const push1 = tab.diffFlat(tab.loadBase(SID2), tab.flattenSnapshot(memSliced));
  const victimTombstones = Object.entries(push1).filter(
    ([k, v]) => v === null && (k.startsWith("v:cx6:") || k.startsWith("char:cx6:"))
  );
  // Classifier unit checks (acc:-scope must never flag).
  const probe = { "v:cx6:d1": true, "hide:cx6:x": true, "char:cx6:name": "X", "hide:acc:y": true, "acc:z": true, "v:cx0:d1": true };
  const flagged = typeof tab.capOverflowKeys === "function" ? tab.capOverflowKeys(probe, ["cx0"]) : ["(n/a old tree)"];
  console.log(
    JSON.stringify({
      label: `${label}-cap`,
      mergedChars: merged.characters.length,
      victimTombstones: victimTombstones.map(([k]) => k),
      serverKeepsCx6: server2["v:cx6:d1"] === true,
      flagged,
      guilty: victimTombstones.length > 0,
    })
  );
}
