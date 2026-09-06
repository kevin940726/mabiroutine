// Property test: checkResets() key-collection exactness on the REAL store.
// For randomized states, asserts:
//  (a) reported dailyKeys/weeklyKeys == EXACTLY the flat keys removed
//      (flatten before minus flatten after) — the load-bearing property for
//      catch-up suppression: no leaked tombstones, no missed ones.
//  (b) every removed value's task kind belongs to the fired scope.
//  (c) fired markers stamp the current bucket; silent runs touch nothing.
//  (d) immediate second call is a no-op (idempotent).
//  (e) all non-removed values byte-identical.
// Markers are ancient-or-today (no clock mocking needed).
import { useAppStore } from "@/store/useAppStore";
import { flattenSnapshot } from "@/sync/flat";
import { currentDailyBucket, getTaipeiWeekKey } from "@/lib/reset";
import trackerJson from "@/data/tracker.json";
import barterJson from "@/data/barter.json";

type Task = { id: string; kind: string; section: string; source?: string };
const BUILTINS = trackerJson as Task[];
const BARTER_IDS = new Set((barterJson as { id: string }[]).map((b) => b.id));

// Seeded PRNG for reproducibility.
let seed = 0x9e3779b9;
function rnd(n: number): number {
  seed = (seed + 0x6d2b79f5) | 0;
  const t0 = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  const t1 = (t0 + Math.imul(t0 ^ (t0 >>> 7), 61 | t0)) ^ t0;
  return ((t1 ^ (t1 >>> 14)) >>> 0) % n;
}
function pick<T>(arr: T[]): T {
  return arr[rnd(arr.length)];
}

const DAILY_BUILTINS = BUILTINS.filter((t) => t.kind === "daily");
const WEEKLY_BUILTINS = BUILTINS.filter((t) => t.kind === "weekly");
const ACC_DAILY = BUILTINS.filter((t) => t.kind === "account-daily");
const ACC_WEEKLY = BUILTINS.filter((t) => t.kind === "account-weekly");
const CUSTOM_KINDS = ["daily", "weekly", "account-daily", "account-weekly"];

function randomState(ancient: boolean): Record<string, unknown> {
  const nChars = 1 + rnd(3);
  const chars = [];
  const customs = [];
  const nCustoms = rnd(4);
  for (let i = 0; i < nCustoms; i++) {
    customs.push({
      id: `cu${i}x`,
      name: `custom ${i}`,
      kind: CUSTOM_KINDS[rnd(CUSTOM_KINDS.length)],
      section: "custom",
      type: "check",
      order: (i + 1) * 10,
    });
  }
  const allDailyIds = [
    ...DAILY_BUILTINS.map((t) => t.id),
    ...customs.filter((t) => t.kind === "daily").map((t) => t.id),
  ];
  const allWeeklyIds = [
    ...WEEKLY_BUILTINS.map((t) => t.id),
    ...customs.filter((t) => t.kind === "weekly").map((t) => t.id),
  ];
  const allAccDaily = [
    ...ACC_DAILY.map((t) => t.id),
    ...customs.filter((t) => t.kind === "account-daily").map((t) => t.id),
  ];
  const allAccWeekly = [
    ...ACC_WEEKLY.map((t) => t.id),
    ...customs.filter((t) => t.kind === "account-weekly").map((t) => t.id),
  ];
  const barterIds = [...BARTER_IDS];
  for (let i = 0; i < nChars; i++) {
    const tv: Record<string, number | boolean> = {};
    for (const id of [...allDailyIds, ...allWeeklyIds]) if (rnd(2)) tv[id] = rnd(2) ? true : 1 + rnd(5);
    for (let b = 0; b < 3; b++) if (rnd(2)) tv[pick(barterIds)] = true;
    chars.push({ id: `c${i}`, name: `C${i}`, taskValues: tv, hiddenTaskIds: [] });
  }
  const accountValues: Record<string, number | boolean> = {};
  for (const id of [...allAccDaily, ...allAccWeekly]) if (rnd(2)) accountValues[id] = true;
  const today = currentDailyBucket(new Date());
  const week = getTaipeiWeekKey(new Date());
  return {
    version: 12,
    characters: chars,
    activeCharId: "c0",
    accountValues,
    hiddenAccountTaskIds: [],
    barterPins: barterIds.slice(0, rnd(6)),
    customTasks: customs,
    lastDailyReset: ancient ? "2000-01-01" : today,
    lastWeeklyReset: ancient ? "2000-W0101" : week,
    prefs: { hideCompleted: false },
    globalTaskOrder: undefined,
    barterFilters: { priority: "all", town: "all", skill: "all", onlyPinned: false },
  };
}

function kindOf(id: string, customs: Task[]): string | null {
  const b = BUILTINS.find((t) => t.id === id);
  if (b) return b.kind;
  const c = customs.find((t) => t.id === id);
  if (c) return c.kind;
  if (BARTER_IDS.has(id)) return "daily"; // barter rows reset with daily
  return null; // pins of removed ids etc.
}

let failures = 0;
function fail(msg: string, extra?: unknown): void {
  failures += 1;
  console.log(`FAIL: ${msg}`, extra === undefined ? "" : JSON.stringify(extra).slice(0, 300));
}

const N = 300;
for (let it = 0; it < N; it++) {
  const ancient = rnd(2) === 0;
  const before = randomState(ancient);
  useAppStore.setState(JSON.parse(JSON.stringify(before)));
  const st0 = useAppStore.getState();
  const flatBefore = flattenSnapshot(st0) as Record<string, unknown>;
  const r = st0.checkResets();
  const after = useAppStore.getState();
  const flatAfter = flattenSnapshot(after) as Record<string, unknown>;

  const removed = Object.keys(flatBefore).filter((k) => !(k in flatAfter));
  // Collection is catalog-wide (includes valueless ids — harmless no-ops
  // for scrubbing); exactness is required only on valued keys.
  const beforeKeys = new Set(Object.keys(flatBefore));
  const reportedValued = [...r.dailyKeys, ...r.weeklyKeys].filter((k) => beforeKeys.has(k)).sort();
  // (a) exactness on valued keys
  const rs = [...removed].sort();
  if (JSON.stringify(rs) !== JSON.stringify(reportedValued)) {
    fail(`iter ${it}: reported keys != removed keys`, { removed: rs, reported: reportedValued });
  }
  // (b) kind scope
  const customs = ((before.customTasks ?? []) as Task[]);
  for (const k of removed) {
    const m = /^(v:[^:]+:|acc:)(.+)$/.exec(k);
    if (!m) {
      fail(`iter ${it}: removed non-value key`, { k });
      continue;
    }
    const kind = kindOf(m[2], customs);
    const inDaily = r.dailyKeys.includes(k);
    const inWeekly = r.weeklyKeys.includes(k);
    if (kind === "daily" || kind === "account-daily" || kind === null) {
      if (!inDaily || inWeekly) fail(`iter ${it}: daily-ish key mis-scoped`, { k, kind });
    } else if (kind === "weekly" || kind === "account-weekly") {
      if (!inWeekly || inDaily) fail(`iter ${it}: weekly-ish key mis-scoped`, { k, kind });
    }
  }
  // (c) markers
  const today = currentDailyBucket(new Date());
  const week = getTaipeiWeekKey(new Date());
  if (ancient) {
    if (!r.daily || after.lastDailyReset !== today) fail(`iter ${it}: daily marker`, { d: r.daily, m: after.lastDailyReset });
    if (!r.weekly || after.lastWeeklyReset !== week) fail(`iter ${it}: weekly marker`, { w: r.weekly, m: after.lastWeeklyReset });
  } else {
    if (r.daily || r.weekly) fail(`iter ${it}: spurious reset on fresh markers`, r);
    if (after.lastDailyReset !== today || after.lastWeeklyReset !== week) fail(`iter ${it}: marker moved`, null);
  }
  // (e) survivors byte-identical (markers excluded: they legitimately
  // advance on reset and are asserted in (c))
  for (const k of Object.keys(flatAfter)) {
    if (k === "meta:resetDaily" || k === "meta:resetWeekly") continue;
    if (JSON.stringify(flatAfter[k]) !== JSON.stringify(flatBefore[k])) {
      fail(`iter ${it}: survivor mutated`, { k });
    }
  }
  // (d) idempotent second call
  const r2 = useAppStore.getState().checkResets();
  if (r2.daily || r2.weekly || r2.dailyKeys.length || r2.weeklyKeys.length) {
    fail(`iter ${it}: second call not noop`, r2);
  }
}

console.log(failures === 0 ? `ALL ${N} ITERATIONS PASSED` : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
