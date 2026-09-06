// Property test: checkResets() local prune on the REAL store (rev 3).
// Resets are memory-only bucket expiry — for randomized states, asserts:
//  (a) every removed value's provenance bucket was stale (or provenance was
//      absent-with-stale-expected — never a current-bucket value);
//  (b) every survivor's provenance is current;
//  (c) fired markers stamp the current bucket; silent runs touch nothing;
//  (d) immediate second call is a no-op (idempotent);
//  (e) all non-removed values byte-identical; non-value fields untouched.
import { useAppStore } from "@/store/useAppStore";
import { currentDailyBucket, getTaipeiWeekKey } from "@/lib/reset";
import { cycleBucketFor } from "@/lib/cycle";
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

function randomState(stale: boolean): Record<string, unknown> {
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
  const allIds = [
    ...DAILY_BUILTINS.map((t) => t.id),
    ...WEEKLY_BUILTINS.map((t) => t.id),
    ...customs.map((t) => t.id),
  ];
  const barterIds = [...BARTER_IDS];
  const buckets: Record<string, string> = {};
  const today = currentDailyBucket(new Date());
  const week = getTaipeiWeekKey(new Date());
  const yesterday = currentDailyBucket(new Date(Date.now() - 24 * 3600 * 1000));
  for (let i = 0; i < nChars; i++) {
    const tv: Record<string, number | boolean> = {};
    for (const id of allIds) {
      if (rnd(2)) {
        tv[id] = rnd(2) ? true : 1 + rnd(5);
        // stale provenance on ~half the values (weekly kinds get week tags)
        const kind = BUILTINS.find((t) => t.id === id)?.kind ?? customs.find((t) => t.id === id)!.kind;
        buckets[id] = stale && rnd(2) ? yesterday : kind === "weekly" || kind === "account-weekly" ? week : today;
      }
    }
    for (let b = 0; b < 3; b++) {
      if (rnd(2)) {
        const bid = pick(barterIds);
        tv[bid] = true;
        buckets[bid] = stale && rnd(2) ? yesterday : today;
      }
    }
    chars.push({ id: `c${i}`, name: `C${i}`, taskValues: tv, hiddenTaskIds: [] });
  }
  const accountValues: Record<string, number | boolean> = {};
  for (const id of [...ACC_DAILY.map((t) => t.id), ...ACC_WEEKLY.map((t) => t.id)]) {
    if (rnd(2)) {
      accountValues[id] = true;
      buckets[id] = stale && rnd(2) ? yesterday : week;
    }
  }
  return {
    version: 13,
    characters: chars,
    activeCharId: "c0",
    accountValues,
    hiddenAccountTaskIds: [],
    barterPins: barterIds.slice(0, rnd(6)),
    customTasks: customs,
    lastDailyReset: stale ? "2000-01-01" : today,
    lastWeeklyReset: stale ? "2000-W0101" : week,
    prefs: { hideCompleted: false },
    globalTaskOrder: undefined,
    barterFilters: { priority: "all", town: "all", skill: "all", onlyPinned: false },
    taskBuckets: buckets,
  };
}

let failures = 0;
function fail(msg: string, extra?: unknown): void {
  failures += 1;
  console.log(`FAIL: ${msg}`, extra === undefined ? "" : JSON.stringify(extra).slice(0, 300));
}

const N = 300;
for (let it = 0; it < N; it++) {
  const stale = rnd(2) === 0;
  const before = randomState(stale);
  useAppStore.setState(JSON.parse(JSON.stringify(before)));
  const st0 = useAppStore.getState();
  const customs = st0.customTasks as Task[];
  const now = new Date();
  st0.checkResets();
  const after = useAppStore.getState();

  // (a) removed values had stale provenance; (b) survivors current
  const b0 = (before.characters as { id: string; taskValues: Record<string, unknown> }[]) ?? [];
  for (let ci = 0; ci < b0.length; ci++) {
    for (const [tid, v] of Object.entries(b0[ci].taskValues)) {
      const kept = after.characters[ci]?.taskValues?.[tid] !== undefined;
      const expected = cycleBucketFor(tid, customs, now);
      const was = (before.taskBuckets as Record<string, string>)[tid];
      if (kept && was !== expected) fail(`iter ${it}: stale value kept`, { tid, was, expected });
      if (!kept && was === expected) fail(`iter ${it}: current value pruned`, { tid, was, expected });
      if (kept && JSON.stringify(after.characters[ci].taskValues[tid]) !== JSON.stringify(v)) {
        fail(`iter ${it}: survivor mutated`, { tid });
      }
    }
  }
  for (const [tid, v] of Object.entries(before.accountValues as Record<string, unknown>)) {
    const kept = after.accountValues[tid] !== undefined;
    const expected = cycleBucketFor(tid, customs, now);
    const was = (before.taskBuckets as Record<string, string>)[tid];
    if (kept && was !== expected) fail(`iter ${it}: stale acc kept`, { tid, was, expected });
    if (!kept && was === expected) fail(`iter ${it}: current acc pruned`, { tid, was, expected });
    if (kept && after.accountValues[tid] !== v) fail(`iter ${it}: acc survivor mutated`, { tid });
  }
  // orphan bucket entries pruned
  for (const tid of Object.keys(after.taskBuckets)) {
    const hasValue =
      after.characters.some((c: { taskValues: Record<string, unknown> }) => tid in c.taskValues) ||
      tid in after.accountValues;
    if (!hasValue) fail(`iter ${it}: orphan bucket entry`, { tid });
  }
  // (c) markers stamp current bucket on stale runs
  const today = currentDailyBucket(new Date());
  const week = getTaipeiWeekKey(new Date());
  if (stale) {
    if (after.lastDailyReset !== today) fail(`iter ${it}: daily marker`, after.lastDailyReset);
    if (after.lastWeeklyReset !== week) fail(`iter ${it}: weekly marker`, after.lastWeeklyReset);
  }
  // (e) non-value fields untouched
  if (JSON.stringify(after.barterPins) !== JSON.stringify(before.barterPins)) fail(`iter ${it}: pins moved`);
  if (JSON.stringify(after.customTasks) !== JSON.stringify(before.customTasks)) fail(`iter ${it}: customs moved`);
  // (d) idempotent second call
  const snap2 = JSON.stringify([
    after.characters.map((c: { taskValues: object }) => c.taskValues),
    after.accountValues,
    after.taskBuckets,
  ]);
  useAppStore.getState().checkResets();
  const st2 = useAppStore.getState();
  const snap3 = JSON.stringify([
    st2.characters.map((c: { taskValues: object }) => c.taskValues),
    st2.accountValues,
    st2.taskBuckets,
  ]);
  if (snap2 !== snap3) fail(`iter ${it}: second call not noop`);
}

console.log(failures === 0 ? `ALL ${N} ITERATIONS PASSED` : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
