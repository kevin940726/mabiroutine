// Sync engine integration scenarios (rev-3 bucketed keys + provenance).
// Real store, real flat/session/reset functions, modeled server, stubbed
// storage. Complements tabs.cjs (vm-realm tabs) and prop-reset.ts.
//
// Core property: RESETS NEVER TOMBSTONE. Values carry cycle provenance
// (taskBuckets); local resets prune stale buckets in memory only; the wire
// never deletes cycle keys; stale devices cannot destroy peer progress.
import { useAppStore } from "@/store/useAppStore";
import {
  flattenSnapshot,
  diffFlat,
  loadBase,
  saveBase,
  unflattenMerge,
  isCycleKey,
  type FlatMap,
} from "@/sync/flat";
import {
  loadSession,
  saveSession,
  buildSnapshot,
  applySnapshot,
  setPullHook,
  syncAndResets,
  adoptState,
} from "@/sync/session";
import { currentDailyBucket, getTaipeiWeekKey } from "@/lib/reset";

class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v));
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
}

const FILTERS = { priority: "all", town: "all", skill: "all", onlyPinned: false };
// Real ids (kind lookup must resolve): parttime = daily check,
// tower = daily counter, weekly-challenge = weekly, guild-challenges =
// account-weekly.
const DAILY_CHECK = "parttime";
const DAILY_COUNT = "tower";
const WEEKLY = "weekly-challenge";
const ACC_WEEKLY = "guild-challenges";

const TODAY = currentDailyBucket(new Date());
const YESTERDAY = currentDailyBucket(new Date(Date.now() - 24 * 3600 * 1000));
const OLD = currentDailyBucket(new Date(Date.now() - 100 * 24 * 3600 * 1000));
const THIS_WEEK = getTaipeiWeekKey(new Date());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Snap = any;
function snap(
  values: Record<string, number | boolean>,
  buckets: Record<string, string>,
  daily: string | null,
  weekly: string | null
): Snap {
  return {
    version: 13,
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
    taskBuckets: { ...buckets },
  };
}

let failures = 0;
function ok(name: string, cond: boolean, extra?: unknown): void {
  if (!cond) {
    failures += 1;
    console.log(`FAIL: ${name}`, extra === undefined ? "" : JSON.stringify(extra).slice(0, 400));
  } else {
    console.log(`ok: ${name}`);
  }
}

function isolate(): void {
  const ls = new MemStorage();
  const ss = new MemStorage();
  Object.defineProperty(globalThis, "localStorage", { value: ls, configurable: true, writable: true });
  Object.defineProperty(globalThis, "sessionStorage", { value: ss, configurable: true, writable: true });
}

function seedStore(s: Snap): void {
  useAppStore.setState(JSON.parse(JSON.stringify(s)));
}

function nullsOf(pushes: FlatMap[]): string[] {
  return pushes.flatMap((p) => Object.entries(p).filter(([, v]) => v === null).map(([k]) => k));
}

// Faithful pull-round port of SyncButton.pullNow (incl. GC), minus UI refs.
// NOTE: keep in sync with pullNow by inspection — divergence risk documented.
function makeEngine(server: { flat: FlatMap }, pushes: FlatMap[]) {
  return async function fakePull(): Promise<void> {
    const session = loadSession();
    if (!session) return;
    const flat = flattenSnapshot(buildSnapshot());
    const base = loadBase(session.id);
    const changes = diffFlat(base, flat);
    if (process.env.DBG) console.log("DBG-PULL", JSON.stringify({ baseKeys: Object.keys(base), changeKeys: Object.keys(changes) }));
    if (Object.keys(changes).length) {
      pushes.push({ ...changes });
      server.flat = { ...server.flat, ...changes };
      saveBase(session.id, { ...base, ...changes });
    }
    const before = JSON.stringify(flattenSnapshot(buildSnapshot()));
    const remote = { ...server.flat };
    if (JSON.stringify(flattenSnapshot(buildSnapshot())) !== before) return;
    const serverView = { ...remote, ...changes };
    const merged = unflattenMerge(serverView, buildSnapshot(), useAppStore.getState().version);
    if (!applySnapshot(merged)) throw new Error("applySnapshot failed");
    // GC port: tombstone expired cycle keys, drop from the view.
    const expired: string[] = [];
    for (const k of Object.keys(serverView)) {
      const p = /^(v:[^:]+:.+|acc:.+)@(\d{4}-\d{2}-\d{2}|\d{4}-W\d{4})$/.exec(k);
      if (!p) continue;
      const ms = p[2].includes("W")
        ? Date.UTC(Number(p[2].slice(0, 4)), Number(p[2].slice(6, 8)) - 1, Number(p[2].slice(8, 10)), -8)
        : Date.UTC(Number(p[2].slice(0, 4)), Number(p[2].slice(5, 7)) - 1, Number(p[2].slice(8, 10)), -8);
      if (ms < Date.now() - 60 * 24 * 3600 * 1000) expired.push(k);
    }
    if (expired.length) {
      pushes.push(Object.fromEntries(expired.map((k) => [k, null])));
      for (const k of expired) delete server.flat[k];
      for (const k of expired) delete serverView[k];
    }
    saveBase(session.id, serverView);
    if (process.env.DBG) console.log("DBG-SAVED", JSON.stringify(Object.keys(serverView)));
  };
}

// E1: local reset (bucket rollover) never tombstones. The device's own
// yesterday values prune from memory; their wire keys stay server-side.
{
  isolate();
  const SID = "e1-reset";
  const server = { flat: {} as FlatMap };
  const pushes: FlatMap[] = [];
  setPullHook(makeEngine(server, pushes));
  // Memory: yesterday's values with yesterday provenance.
  seedStore(
    snap({ [DAILY_CHECK]: true, [DAILY_COUNT]: 5 }, { [DAILY_CHECK]: YESTERDAY, [DAILY_COUNT]: YESTERDAY }, YESTERDAY, THIS_WEEK)
  );
  saveSession({ id: SID, updatedAt: 1 });
  saveBase(SID, flattenSnapshot(buildSnapshot()));
  server.flat = flattenSnapshot(buildSnapshot());
  await syncAndResets(); // pull (no peer) + prune (yesterday buckets expire)
  await syncAndResets(); // push round: expiries must be silent
  ok("E1 reset pushes no tombstones", nullsOf(pushes).length === 0, nullsOf(pushes));
  ok("E1 memory pruned", Object.keys(useAppStore.getState().characters[0]?.taskValues ?? {}).length === 0);
  const staleKeys = Object.keys(server.flat).filter((k) => k.includes(`@${YESTERDAY}`));
  ok("E1 old-bucket keys still server-side", staleKeys.length === 2, staleKeys);
  ok("E1 marker stamped", useAppStore.getState().lastDailyReset === TODAY);
}

// E2: adoption filters by tag — only current-bucket values materialize,
// provenance recorded, memory keys stay plain.
{
  isolate();
  const SID = "e2-filter";
  const server = { flat: {} as FlatMap };
  const pushes: FlatMap[] = [];
  setPullHook(makeEngine(server, pushes));
  seedStore(snap({}, {}, TODAY, THIS_WEEK));
  saveSession({ id: SID, updatedAt: 1 });
  saveBase(SID, flattenSnapshot(buildSnapshot()));
  server.flat = {
    [`v:c1:${DAILY_CHECK}@${OLD}`]: true, // expired bucket
    [`v:c1:${DAILY_CHECK}@${TODAY}`]: true, // current
    [`v:c1:${WEEKLY}@${THIS_WEEK}`]: 3, // current week
    [`acc:${ACC_WEEKLY}@${THIS_WEEK}`]: true, // current account-weekly
    "pin:some-barter": true, // persistent
    "char:c1:name": "A",
    "meta:active": "c1",
  };
  await syncAndResets();
  const st = useAppStore.getState();
  const tv = st.characters[0]?.taskValues as Record<string, unknown>;
  ok("E2 adopts current daily", tv?.[DAILY_CHECK] === true, tv);
  ok("E2 adopts current weekly", tv?.[WEEKLY] === 3, tv);
  ok("E2 adopts current account-weekly", st.accountValues[ACC_WEEKLY] === true, st.accountValues);
  ok("E2 provenance recorded", st.taskBuckets[DAILY_CHECK] === TODAY && st.taskBuckets[WEEKLY] === THIS_WEEK, st.taskBuckets);
  ok("E2 expired bucket filtered", !(`${OLD}` in st.taskBuckets) && tv[DAILY_CHECK] === true);
  ok("E2 adopts persistent pin", st.barterPins.includes("some-barter"));
}

// E3: legacy untagged value keys are inert — never adopted, never tombstoned.
{
  isolate();
  const SID = "e3-legacy";
  const server = { flat: {} as FlatMap };
  const pushes: FlatMap[] = [];
  setPullHook(makeEngine(server, pushes));
  seedStore(snap({}, {}, TODAY, THIS_WEEK));
  saveSession({ id: SID, updatedAt: 1 });
  saveBase(SID, flattenSnapshot(buildSnapshot()));
  server.flat = {
    "v:c1:parttime": true, // rev-2 untagged garbage
    "char:c1:name": "A",
    "meta:active": "c1",
  };
  await syncAndResets();
  ok("E3 untagged not adopted", useAppStore.getState().characters[0]?.taskValues?.[DAILY_CHECK] === undefined);
  ok("E3 untagged not tombstoned", !nullsOf(pushes).some((k) => k.startsWith("v:c1:")), nullsOf(pushes));
}

// E4: user clears propagate as explicit values and CONVERGE. Uncheck pushes
// false, counter-zero pushes 0 (presence is the propagation bit — absence
// means "reset pruned" and stays silent, which is why deletes resurrect).
// A peer adopts the clears (no resurrection) and the pair goes quiet.
// Unpinning (persistent) still tombstones exactly once with no echo.
{
  const server = { flat: {} as FlatMap };
  const SID = "e4-uncheck";
  const keyCheck = `v:c1:${DAILY_CHECK}@${TODAY}`;
  const keyCount = `v:c1:${DAILY_COUNT}@${TODAY}`;
  // --- device A: checked state, synced, then the user clears ---
  isolate();
  const pushesA: FlatMap[] = [];
  setPullHook(makeEngine(server, pushesA));
  const seeded = snap({ [DAILY_CHECK]: true, [DAILY_COUNT]: 5 }, { [DAILY_CHECK]: TODAY, [DAILY_COUNT]: TODAY }, TODAY, THIS_WEEK);
  seeded.barterPins = ["pin-a"];
  seedStore(seeded);
  saveSession({ id: SID, updatedAt: 1 });
  saveBase(SID, flattenSnapshot(buildSnapshot()));
  server.flat = flattenSnapshot(buildSnapshot());
  useAppStore.getState().toggleCheck(DAILY_CHECK, false);
  useAppStore.getState().setCounter(DAILY_COUNT, 0, false);
  useAppStore.getState().toggleBarterPin("pin-a");
  await syncAndResets();
  ok("E4 uncheck pushes explicit false", pushesA.some((p) => p[keyCheck] === false), pushesA);
  ok("E4 counter-zero pushes explicit 0", pushesA.some((p) => p[keyCount] === 0), pushesA);
  ok("E4 cycle clear sends no tombstone", !nullsOf(pushesA).some((k) => isCycleKey(k)), nullsOf(pushesA));
  ok("E4 unpin tombstoned once", nullsOf(pushesA).filter((k) => k === "pin:pin-a").length === 1, nullsOf(pushesA));
  ok("E4 server holds the clears", server.flat[keyCheck] === false && server.flat[keyCount] === 0, server.flat);
  const nA = pushesA.length;
  await syncAndResets();
  await syncAndResets();
  ok("E4 A quiet after push (no echo)", pushesA.length === nA && nullsOf(pushesA).length === 1, pushesA.slice(nA));
  // --- device B: empty, joins later — adopts the clears, nothing resurrects ---
  isolate();
  const pushesB: FlatMap[] = [];
  setPullHook(makeEngine(server, pushesB));
  seedStore(snap({}, {}, TODAY, THIS_WEEK));
  saveSession({ id: SID, updatedAt: 2 });
  await syncAndResets();
  const btv = useAppStore.getState().characters[0]?.taskValues as Record<string, unknown>;
  ok("E4 peer adopts false (stays unchecked)", btv?.[DAILY_CHECK] === false, btv);
  ok("E4 peer adopts zero", btv?.[DAILY_COUNT] === 0, btv);
  ok("E4 peer provenance stamped", useAppStore.getState().taskBuckets[DAILY_CHECK] === TODAY, useAppStore.getState().taskBuckets);
  const nB = pushesB.length;
  await syncAndResets();
  ok("E4 peer quiet after adopt (no ping-pong)", pushesB.length === nB, pushesB.slice(nB));
}

// E5: resetAll propagates persistent keys as a nuke (locked behavior);
// cycle values expire silently.
{
  isolate();
  const SID = "e5-nuke";
  const server = { flat: {} as FlatMap };
  const pushes: FlatMap[] = [];
  setPullHook(makeEngine(server, pushes));
  const seeded = snap({ [DAILY_CHECK]: true }, { [DAILY_CHECK]: TODAY }, TODAY, THIS_WEEK);
  seeded.barterPins = ["pin-a"];
  seeded.customTasks = [{ id: "cu1", name: "C", kind: "daily", section: "custom", type: "check", order: 10 }];
  seedStore(seeded);
  saveSession({ id: SID, updatedAt: 1 });
  saveBase(SID, flattenSnapshot(buildSnapshot()));
  server.flat = flattenSnapshot(buildSnapshot());
  (useAppStore.getState() as { resetAll: () => void }).resetAll();
  await syncAndResets();
  const ns = nullsOf(pushes);
  ok("E5 custom tombstoned", ns.includes("custom:cu1"), ns);
  ok("E5 pin tombstoned", ns.includes("pin:pin-a"), ns);
  ok("E5 old char name tombstoned", ns.some((k) => /^char:[^:]+:name$/.test(k) && k !== `char:${useAppStore.getState().characters[0]?.id}:name`), ns);
  ok("E5 cycle values not tombstoned", !ns.some((k) => isCycleKey(k)), ns);
}

// E6: GC tombstones only cycle keys past the retention window (60d).
{
  isolate();
  const SID = "e6-gc";
  const server = { flat: {} as FlatMap };
  const pushes: FlatMap[] = [];
  setPullHook(makeEngine(server, pushes));
  seedStore(snap({}, {}, TODAY, THIS_WEEK));
  saveSession({ id: SID, updatedAt: 1 });
  // No explicit base seed: round 1 pushes the device's own persistent keys
  // while the crafted server carries the expired key to GC.
  server.flat = {
    [`v:c1:${DAILY_CHECK}@${OLD}`]: true, // 100d old → GC
    [`v:c1:${DAILY_CHECK}@${TODAY}`]: true, // current → keep
    "char:c1:name": "A",
    "meta:active": "c1",
  };
  await syncAndResets();
  const ns = nullsOf(pushes);
  ok("E6 GC tombstones old bucket", ns.includes(`v:c1:${DAILY_CHECK}@${OLD}`), ns);
  ok("E6 GC keeps current bucket", !ns.includes(`v:c1:${DAILY_CHECK}@${TODAY}`), ns);
  ok("E6 GC removed from server", server.flat[`v:c1:${DAILY_CHECK}@${OLD}`] === undefined);
  ok("E6 current value survives", useAppStore.getState().characters[0]?.taskValues?.[DAILY_CHECK] === true);
  if (process.env.DBG) console.log("DBG-E6-mid", JSON.stringify(pushes.map((p) => Object.keys(p))));
  const n = pushes.length;
  await syncAndResets();
  ok("E6 GC sends once", pushes.length === n, pushes.slice(n));
}

// E7: adopt/import stamp current markers (defensive; provenance makes it
// non-load-bearing). Imported values keep their tags via normalize.
{
  isolate();
  seedStore(snap({}, {}, null, null));
  ok("E7 adopt ok", adoptState({ state: flattenSnapshot(snap({ [DAILY_CHECK]: true }, { [DAILY_CHECK]: TODAY }, TODAY, THIS_WEEK)) }));
  const st = useAppStore.getState();
  ok("E7 adopt stamps daily", st.lastDailyReset === TODAY, st.lastDailyReset);
  ok("E7 adopt keeps values", st.characters[0]?.taskValues?.[DAILY_CHECK] === true);

  const ancient = JSON.stringify(
    snap({ [DAILY_CHECK]: true }, { [DAILY_CHECK]: TODAY }, "2000-01-01", "2000-W0101")
  );
  (useAppStore.getState() as { importJson: (j: string) => void }).importJson(ancient);
  const st2 = useAppStore.getState();
  ok("E7 import stamps daily", st2.lastDailyReset === TODAY, st2.lastDailyReset);
  ok("E7 import keeps values", st2.characters[0]?.taskValues?.[DAILY_CHECK] === true);
}

// E8: the production report — peer checks at 09:00; stale device first opens
// at 15:00 with yesterday provenance: no tombstones, peer values intact, own
// stale values pruned and NEVER resurrected.
{
  isolate();
  const SID = "e8-evening";
  const server = { flat: {} as FlatMap };
  const pushes: FlatMap[] = [];
  setPullHook(makeEngine(server, pushes));
  seedStore(
    snap({ [DAILY_CHECK]: true }, { [DAILY_CHECK]: YESTERDAY }, YESTERDAY, THIS_WEEK)
  );
  saveSession({ id: SID, updatedAt: 1 });
  saveBase(SID, flattenSnapshot(buildSnapshot()));
  // Peer checked today at 09:00 (current bucket).
  server.flat = {
    ...flattenSnapshot(
      snap({ [DAILY_CHECK]: true, [DAILY_COUNT]: 5 }, { [DAILY_CHECK]: TODAY, [DAILY_COUNT]: TODAY }, TODAY, THIS_WEEK)
    ),
    "char:c1:name": "A",
    "meta:active": "c1",
  };
  await syncAndResets(); // pull adopts peer, prune drops own stale
  await syncAndResets(); // push round
  ok("E8 no tombstones from stale device", nullsOf(pushes).length === 0, nullsOf(pushes));
  ok("E8 peer values intact server-side", server.flat[`v:c1:${DAILY_COUNT}@${TODAY}`] === 5);
  const tv = useAppStore.getState().characters[0]?.taskValues as Record<string, unknown>;
  ok("E8 peer values adopted", tv?.[DAILY_CHECK] === true && tv?.[DAILY_COUNT] === 5, tv);
  ok("E8 own stale provenance gone", useAppStore.getState().taskBuckets[DAILY_CHECK] === TODAY, useAppStore.getState().taskBuckets);
  const n = pushes.length;
  await syncAndResets();
  await syncAndResets();
  ok("E8 steady state quiet", pushes.length === n, pushes.slice(n));
}

// E9: clearSection zeroes in place (false/0 by stored type) and propagates —
// a cleared section must not resurrect on the next pull like deletes did.
{
  isolate();
  const SID = "e9-clear";
  const server = { flat: {} as FlatMap };
  const pushes: FlatMap[] = [];
  setPullHook(makeEngine(server, pushes));
  seedStore(
    snap({ [DAILY_CHECK]: true, [DAILY_COUNT]: 5 }, { [DAILY_CHECK]: TODAY, [DAILY_COUNT]: TODAY }, TODAY, THIS_WEEK)
  );
  saveSession({ id: SID, updatedAt: 1 });
  saveBase(SID, flattenSnapshot(buildSnapshot()));
  server.flat = flattenSnapshot(buildSnapshot());
  (useAppStore.getState() as { clearSection: (s: "daily" | "weekly" | "account") => void }).clearSection("daily");
  const mem = useAppStore.getState().characters[0]?.taskValues as Record<string, unknown>;
  ok("E9 clear zeroes in place", mem?.[DAILY_CHECK] === false && mem?.[DAILY_COUNT] === 0, mem);
  await syncAndResets();
  ok(
    "E9 clear pushes false + 0",
    pushes.some((p) => p[`v:c1:${DAILY_CHECK}@${TODAY}`] === false) &&
      pushes.some((p) => p[`v:c1:${DAILY_COUNT}@${TODAY}`] === 0),
    pushes
  );
  ok("E9 clear sends no tombstone", !nullsOf(pushes).some((k) => isCycleKey(k)), nullsOf(pushes));
  const m = pushes.length;
  await syncAndResets();
  await syncAndResets();
  ok("E9 cleared state stays cleared", pushes.length === m, pushes.slice(m));
  const mem2 = useAppStore.getState().characters[0]?.taskValues as Record<string, unknown>;
  ok("E9 no resurrection after pull", mem2?.[DAILY_CHECK] === false && mem2?.[DAILY_COUNT] === 0, mem2);
}

setPullHook(null);
console.log(failures === 0 ? "ALL ENGINE SCENARIOS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
