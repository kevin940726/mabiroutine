// Sync engine integration scenarios (rev-3 bucketed keys + provenance).
// Real store, real flat/session/reset functions, modeled server, stubbed
// storage. Complements tabs.cjs (vm-realm tabs) and prop-reset.ts.
//
// Core property: RESETS NEVER TOMBSTONE. Values carry cycle provenance
// (taskBuckets); local resets prune stale buckets in memory only; the wire
// never deletes cycle keys; stale devices cannot destroy peer progress.
import { useAppStore, migratePersisted, seedMissingDefaultPins, DEFAULT_MUST_PINS, DEVICE_LOCAL_STATE_KEYS } from "@/store/useAppStore";
import {
  flattenSnapshot,
  diffFlat,
  guardOrderKeys,
  loadBase,
  saveBase,
  unflattenMerge,
  creationState,
  isCycleKey,
  type FlatMap,
} from "@/sync/flat";
import {
  loadSession,
  saveSession,
  clearSession,
  loadLastSessionId,
  buildSnapshot,
  applySnapshot,
  setPullHook,
  syncAndResets,
  adoptState,
} from "@/sync/session";
import { currentDailyBucket, getTaipeiWeekKey } from "@/lib/reset";
import { GC_DAYS } from "@/lib/cycle";
import { planRound } from "@/sync/round";
import { loadShopNpcs, shopDeals } from "@/lib/shops";
import { healClaimedReminderLanes, setServerPushOn } from "@/lib/serverPush";
import { PURPLE_HOLE_ID } from "@/lib/purpleHole";

// A real shops.json pin id, so the adoption test proves the second namespace
// survives sync rather than assuming it. Recomputed from the catalog so it
// tracks the data instead of going stale in a fixture.
const SHOP_PIN = shopDeals(loadShopNpcs()).find((d) => !d.barterId && d.limitText !== null)?.pinId ?? "";

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
// tower = daily counter, abyss = weekly counter, guild-challenges =
// account-weekly.
const DAILY_CHECK = "parttime";
const DAILY_COUNT = "tower";
const WEEKLY = "abyss";
const ACC_WEEKLY = "guild-challenges";

const TODAY = currentDailyBucket(new Date());
const YESTERDAY = currentDailyBucket(new Date(Date.now() - 24 * 3600 * 1000));
const OLD = currentDailyBucket(new Date(Date.now() - 100 * 24 * 3600 * 1000));
const MID = currentDailyBucket(new Date(Date.now() - 10 * 24 * 3600 * 1000));
const THIS_WEEK = getTaipeiWeekKey(new Date());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Snap = any;
function snap(
  values: Record<string, number | boolean>,
  buckets: Record<string, string>,
  daily: string | null,
  weekly: string | null
): Snap {
  // Current store version: applySnapshot feeds every pull through
  // migratePersisted. Migration never seeds pins (the v15 upgrade seed that
  // did was removed 2026-10-06: it volunteered pins blind and resurrected
  // peer unpins — seeding is pull-aware now, see E14), so no step here can
  // phantom-push pins and trip the quietness assertions. Production pulls
  // always carry the current version after first load, so the harness seeds
  // it too — migration coverage lives in fixtures (A–O).
  return {
    version: 15,
    characters: [{ id: "c1", name: "A", taskValues: { ...values }, hiddenTaskIds: [] }],
    activeCharId: "c1",
    accountValues: {},
    hiddenAccountTaskIds: [],
    barterPins: [],
    // Explicit empties, not undefined: seedStore JSON-round-trips, and an
    // undefined field drops out of the parsed object, so zustand's top-level
    // merge would keep the PREVIOUS test block's value (a leaked row/pin order
    // made an artifact-band fixture look authored).
    barterCustomOrder: null,
    customTasks: [],
    lastDailyReset: daily,
    lastWeeklyReset: weekly,
    prefs: { hideCompleted: false },
    globalTaskOrder: {},
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

// Faithful round port of SyncButton runPull (incl. planRound + GC), minus UI
// refs. The decision core (planRound) is the real module; this port only wires
// the stubbed I/O. NOTE: keep in sync with runPull by inspection — divergence
// risk documented. The async interleavings runPull guards against (mid-flight
// edits, the freshness probe, push/round serialization) cannot occur
// synchronously here, so the port runs the guard, plan, and push in one pass.
function makeEngine(server: { flat: FlatMap }, pushes: FlatMap[]) {
  // Order-withhold mirror (SyncButton pulledSessionRef + omit-strip): order
  // keys are stripped from pushes until this engine's first pull completes,
  // and whenever flatten omits one, so no device volunteers canon blind or
  // tombstones it via the null path. The real helper is shared, not copied.
  let pulled = false;
  return async function fakePull(): Promise<void> {
    const session = loadSession();
    if (!session) return;
    const base = loadBase(session.id);
    const flat = flattenSnapshot(buildSnapshot());
    const changes = diffFlat(base, flat);
    guardOrderKeys(changes, flat, pulled);
    if (process.env.DBG) console.log("DBG-PULL", JSON.stringify({ baseKeys: Object.keys(base), changeKeys: Object.keys(changes) }));
    const before = JSON.stringify(flattenSnapshot(buildSnapshot()));
    const remote = { ...server.flat };
    const plan = planRound(base, changes, remote);
    if (process.env.DBG && plan.dropped.length) console.log("DBG-DROPPED", JSON.stringify(plan.dropped));
    if (Object.keys(plan.push).length) {
      pushes.push({ ...plan.push });
      server.flat = { ...server.flat, ...plan.push };
      saveBase(session.id, { ...base, ...plan.push });
    }
    if (JSON.stringify(flattenSnapshot(buildSnapshot())) !== before) return;
    const serverView = plan.view;
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
      if (ms < Date.now() - GC_DAYS * 24 * 3600 * 1000) expired.push(k);
    }
    if (expired.length) {
      pushes.push(Object.fromEntries(expired.map((k) => [k, null])));
      for (const k of expired) delete server.flat[k];
      for (const k of expired) delete serverView[k];
    }
    saveBase(session.id, serverView);
    // runPull mirror: pull-aware default seeding runs after a successful
    // merge (keep in sync with SyncButton by inspection).
    seedMissingDefaultPins(serverView);
    pulled = true;
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
    "pin:tir-f3": true, // persistent (real barter id — v14 prunes dangling pins)
    [`pin:${SHOP_PIN}`]: true, // a shops.json pin: second id namespace, same key
    "pin:shop::nobody::nothing": true, // right shape, no live row
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
  ok("E2 adopts persistent pin", st.barterPins.includes("tir-f3"));
  ok("E2 adopts a shops.json pin", st.barterPins.includes(SHOP_PIN), st.barterPins);
  // Adoption is namespace-agnostic on purpose: the protocol unions every pin:
  // key into barterPins and cannot know which rows are alive, because the
  // catalog is not in a peer's payload. Dropping dangling ids is the migrate
  // steps' job, and that they do it for shop:: ids is proven by fixture T in
  // migration-check. A dead pin adopted here is inert meanwhile — the tracker
  // resolves it to nothing — which is how a dead barter pin has always behaved.
  ok("E2 protocol adopts any pin: key", st.barterPins.includes("shop::nobody::nothing"), st.barterPins);
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
  // Converged pins on both sides: this scenario proves clears converge, not
  // seeding (E14 owns that) — without them the pull-aware seeder would
  // correctly treat the absent keys as novelty and the quietness assertion
  // below would trip on the seed push.
  seeded.barterPins = ["pin-a", ...DEFAULT_MUST_PINS];
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
  const e5chars = useAppStore.getState().characters;
  ok("E5 pull converges to the single fresh char (no ghosts)", e5chars.length === 1, e5chars.map((c) => c.id));
}

// E6: GC tombstones only cycle keys past the retention window (GC_DAYS = 8).
// The 10-day MID key pins the boundary: it must be collected now but would
// have survived the old 60-day window, so reverting GC_DAYS fails this.
{
  isolate();
  const SID = "e6-gc";
  const server = { flat: {} as FlatMap };
  const pushes: FlatMap[] = [];
  setPullHook(makeEngine(server, pushes));
  // Converged default pins on both sides (see E4): this scenario proves GC
  // silence, not seeding — the crafted server must carry the pins or the
  // pull-aware seeder correctly treats their absence as novelty.
  const s6 = snap({}, {}, TODAY, THIS_WEEK);
  s6.barterPins = [...DEFAULT_MUST_PINS];
  seedStore(s6);
  saveSession({ id: SID, updatedAt: 1 });
  // No explicit base seed: round 1 pushes the device's own persistent keys
  // while the crafted server carries the expired keys to GC.
  server.flat = {
    [`v:c1:${DAILY_CHECK}@${OLD}`]: true, // 100d old → GC
    [`v:c1:${DAILY_COUNT}@${MID}`]: true, // 10d old → GC (> GC_DAYS)
    [`v:c1:${DAILY_CHECK}@${TODAY}`]: true, // current → keep
    "char:c1:name": "A",
    "meta:active": "c1",
    ...Object.fromEntries(DEFAULT_MUST_PINS.map((id) => [`pin:${id}`, true])),
  };
  await syncAndResets();
  const ns = nullsOf(pushes);
  ok("E6 GC tombstones old bucket", ns.includes(`v:c1:${DAILY_CHECK}@${OLD}`), ns);
  ok("E6 GC tombstones mid-age bucket", ns.includes(`v:c1:${DAILY_COUNT}@${MID}`), ns);
  ok("E6 GC keeps current bucket", !ns.includes(`v:c1:${DAILY_CHECK}@${TODAY}`), ns);
  ok("E6 GC removed from server", server.flat[`v:c1:${DAILY_CHECK}@${OLD}`] === undefined);
  ok("E6 GC removed mid-age from server", server.flat[`v:c1:${DAILY_COUNT}@${MID}`] === undefined);
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
  // Converged default pins (see E4): this scenario proves clears stay
  // cleared, not seeding.
  const s9 = snap({ [DAILY_CHECK]: true, [DAILY_COUNT]: 5 }, { [DAILY_CHECK]: TODAY, [DAILY_COUNT]: TODAY }, TODAY, THIS_WEEK);
  s9.barterPins = [...DEFAULT_MUST_PINS];
  seedStore(s9);
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

// E11: editing a custom task's kind (day ↔ week) re-stamps provenance —
// the stored check must survive, not read as stale and prune away.
{
  isolate();
  const SID = "e11-kind";
  const server = { flat: {} as FlatMap };
  const pushes: FlatMap[] = [];
  setPullHook(makeEngine(server, pushes));
  const seeded = snap({ cx1: true }, { cx1: TODAY }, TODAY, THIS_WEEK);
  seeded.customTasks = [{ id: "cx1", name: "X", kind: "daily", section: "custom", type: "check", order: 10 }];
  seedStore(seeded);
  saveSession({ id: SID, updatedAt: 1 });
  saveBase(SID, flattenSnapshot(buildSnapshot()));
  server.flat = flattenSnapshot(buildSnapshot());
  (useAppStore.getState() as { updateCustomTask: (id: string, patch: unknown) => void }).updateCustomTask("cx1", { kind: "weekly" });
  await syncAndResets();
  const st = useAppStore.getState();
  ok("E11 kind change keeps the check", (st.characters[0]?.taskValues as Record<string, unknown>)?.cx1 === true, st.characters[0]?.taskValues);
  ok("E11 provenance re-stamped to week bucket", st.taskBuckets.cx1 === THIS_WEEK, st.taskBuckets);
}

// E10: removing a character must not resurrect via pull — the
// name tombstones (persistent) but the v: keys linger till GC, and the
// merge must not rebuild the character from orphan value keys.
{
  isolate();
  const SID = "e10-rmchar";
  const server = { flat: {} as FlatMap };
  const pushes: FlatMap[] = [];
  setPullHook(makeEngine(server, pushes));
  seedStore({
    ...snap({ [DAILY_CHECK]: true }, { [DAILY_CHECK]: TODAY }, TODAY, THIS_WEEK),
    characters: [
      { id: "c1", name: "A", taskValues: { [DAILY_CHECK]: true }, hiddenTaskIds: [] },
      { id: "c2", name: "B", taskValues: { [DAILY_CHECK]: true }, hiddenTaskIds: [] },
    ],
  });
  saveSession({ id: SID, updatedAt: 1 });
  saveBase(SID, flattenSnapshot(buildSnapshot()));
  server.flat = flattenSnapshot(buildSnapshot());
  (useAppStore.getState() as { removeCharacter: (id: string) => void }).removeCharacter("c2");
  await syncAndResets();
  await syncAndResets();
  const ids = useAppStore.getState().characters.map((c) => c.id);
  ok("E10 removed character stays removed", !ids.includes("c2"), ids);
}

// E12: character tab order syncs (meta:charorder, last-writer-wins, then
// sticks — biased toward the human-made order). The reported bug: linked
// devices split permanently — creator keeps creation order, the adopter laid
// out id-sorted — with no way to realign. Two guards: pushes withhold the
// key until the first pull (nobody contests canon blind), and id-sorted
// orders are neither volunteered nor tombstoned (generated layouts can't
// overwrite — or delete — chosen ones). Whoever's volunteered order reaches the server is adopted, never
// contested; the pair then goes quiet (no ping-pong). Fresh adopts land in
// the pushed layout. Absent/malformed keys fall back (pre-upgrade peers,
// stale-tombstoned key).
{
  const server = { flat: {} as FlatMap };
  const SID = "e12-charorder";
  const CREATOR_ORDER = ["z3k9q2m", "a1b2c3d", "m7x4p8q"]; // creation order, deliberately unsorted
  const ARTIFACT_ORDER = ["a1b2c3d", "m7x4p8q", "z3k9q2m"]; // id-sorted, as fresh adopt used to lay out
  const chars = (ids: string[]) => ids.map((id) => ({ id, name: `N-${id}`, taskValues: {}, hiddenTaskIds: [] }));
  const orderOf = () => useAppStore.getState().characters.map((c) => c.id);
  // --- device A (creator): no base yet; round 1 withholds the order (no
  // blind volunteer), round 2 establishes canon ---
  isolate();
  const pushesA: FlatMap[] = [];
  setPullHook(makeEngine(server, pushesA));
  seedStore({ ...snap({}, {}, TODAY, THIS_WEEK), characters: chars(CREATOR_ORDER), activeCharId: CREATOR_ORDER[0] });
  saveSession({ id: SID, updatedAt: 1 });
  await syncAndResets();
  ok(
    "E12 first round withholds order (no blind volunteer)",
    !pushesA.some((p) => "meta:charorder" in p) && !("meta:charorder" in server.flat),
    pushesA.map((p) => Object.keys(p))
  );
  await syncAndResets();
  ok(
    "E12 creator pushes its tab order",
    pushesA.some((p) => p["meta:charorder"] === CREATOR_ORDER.join(",")),
    pushesA.map((p) => Object.keys(p))
  );
  ok("E12 server holds creator order", server.flat["meta:charorder"] === CREATOR_ORDER.join(","));
  // --- device B: established, same ids in artifact order — adopts, no contest ---
  isolate();
  const pushesB: FlatMap[] = [];
  setPullHook(makeEngine(server, pushesB));
  seedStore({ ...snap({}, {}, TODAY, THIS_WEEK), characters: chars(ARTIFACT_ORDER), activeCharId: ARTIFACT_ORDER[0] });
  saveSession({ id: SID, updatedAt: 2 });
  saveBase(SID, flattenSnapshot(buildSnapshot()));
  await syncAndResets();
  ok("E12 divergent peer adopts canon order", JSON.stringify(orderOf()) === JSON.stringify(CREATOR_ORDER), orderOf());
  await syncAndResets();
  const nB = pushesB.length;
  await syncAndResets();
  ok("E12 pair quiet after converge (no ping-pong)", pushesB.length === nB, pushesB.slice(nB));
  // --- device A again: still canon, still quiet ---
  isolate();
  const pushesA2: FlatMap[] = [];
  setPullHook(makeEngine(server, pushesA2));
  seedStore({ ...snap({}, {}, TODAY, THIS_WEEK), characters: chars(CREATOR_ORDER), activeCharId: CREATOR_ORDER[0] });
  saveSession({ id: SID, updatedAt: 3 });
  saveBase(SID, flattenSnapshot(buildSnapshot()));
  await syncAndResets();
  await syncAndResets();
  ok("E12 writer keeps canon order", JSON.stringify(orderOf()) === JSON.stringify(CREATOR_ORDER), orderOf());
  ok("E12 writer quiet (canon already server-side)", pushesA2.length === 0, pushesA2);
  // --- device C: pristine adopt lands in the pushed layout, not id-sorted ---
  isolate();
  seedStore(snap({}, {}, TODAY, THIS_WEEK));
  ok("E12 fresh adopt ok", adoptState({ state: { ...server.flat } }));
  ok("E12 fresh adopt takes pushed order", JSON.stringify(orderOf()) === JSON.stringify(CREATOR_ORDER), orderOf());
  // --- absent key (pre-upgrade session): local order stands, device writes it ---
  isolate();
  const pushesD: FlatMap[] = [];
  const noKeyServer = { flat: {} as FlatMap };
  setPullHook(makeEngine(noKeyServer, pushesD));
  seedStore({ ...snap({}, {}, TODAY, THIS_WEEK), characters: chars(CREATOR_ORDER), activeCharId: CREATOR_ORDER[0] });
  saveSession({ id: SID, updatedAt: 4 });
  saveBase(SID, {});
  noKeyServer.flat = { "char:z3k9q2m:name": "N-z3k9q2m", "char:a1b2c3d:name": "N-a1b2c3d", "char:m7x4p8q:name": "N-m7x4p8q" };
  await syncAndResets();
  ok("E12 absent key keeps local order", JSON.stringify(orderOf()) === JSON.stringify(CREATOR_ORDER), orderOf());
  ok("E12 absent key withheld first round", !("meta:charorder" in noKeyServer.flat));
  await syncAndResets();
  ok("E12 absent key gets written (establishes canon)", noKeyServer.flat["meta:charorder"] === CREATOR_ORDER.join(","));
  // --- malformed keys: ignored, local order stands ---
  const local = { ...snap({}, {}, TODAY, THIS_WEEK), characters: chars(CREATOR_ORDER), activeCharId: CREATOR_ORDER[0] };
  const localArtifact = { ...local, characters: chars(ARTIFACT_ORDER), activeCharId: ARTIFACT_ORDER[0] };
  const noKeyFlat = flattenSnapshot(local) as FlatMap;
  delete noKeyFlat["meta:charorder"];
  const m0 = unflattenMerge(noKeyFlat, localArtifact, 15);
  ok(
    "E12 absent key falls back to local order",
    JSON.stringify(m0.characters.map((c) => c.id)) === JSON.stringify(ARTIFACT_ORDER),
    m0.characters.map((c) => c.id)
  );
  for (const [label, bad] of [["empty segment", "a1,,b2"], ["dupe", "a1,a1"], ["non-string", 42], ["empty", ""]] as const) {
    const m = unflattenMerge({ ...flattenSnapshot(local), "meta:charorder": bad }, local, 15);
    ok(
      `E12 malformed order ignored (${label})`,
      JSON.stringify(m.characters.map((c) => c.id)) === JSON.stringify(CREATOR_ORDER),
      m.characters.map((c) => c.id)
    );
  }
  // --- per-device prefs survive a merge ---------------------------------------
  // pinnedCollapsed is a per-device fold and is absent from the sync key space
  // (view state, not order). Merge must carry the LOCAL value through instead of
  // rebuilding prefs from the flat map (which dropped it on every pull, masked
  // only by normalizePersisted's backfill). hideCompleted IS synced, so it must
  // still come from the server view.
  {
    const localPrefs = { ...local, prefs: { ...local.prefs, pinnedCollapsed: { daily: true, weekly: true } } };
    const serverFlat = { ...flattenSnapshot(local), "pref:hideCompleted": true } as FlatMap;
    const m = unflattenMerge(serverFlat, localPrefs, 15);
    ok(
      "E13 merge keeps local pinnedCollapsed",
      m.prefs?.pinnedCollapsed?.daily === true && m.prefs?.pinnedCollapsed?.weekly === true,
      m.prefs?.pinnedCollapsed
    );
    ok("E13 merge still takes synced hideCompleted", m.prefs?.hideCompleted === true, m.prefs?.hideCompleted);
  }
  // --- artifact deferral: a stale-base artifact device full-pushes without
  // ever volunteering its generated order, then adopts canon on the pull ---
  isolate();
  const pushesR: FlatMap[] = [];
  setPullHook(makeEngine(server, pushesR));
  seedStore({ ...snap({}, {}, TODAY, THIS_WEEK), characters: chars(ARTIFACT_ORDER), activeCharId: ARTIFACT_ORDER[0] });
  saveSession({ id: SID, updatedAt: 5 });
  saveBase(SID, {});
  await syncAndResets();
  await syncAndResets();
  ok("E12 stale artifact adopts canon", JSON.stringify(orderOf()) === JSON.stringify(CREATOR_ORDER), orderOf());
  ok(
    "E12 artifact order never volunteered",
    !pushesR.some((p) => p["meta:charorder"] === ARTIFACT_ORDER.join(",")),
    pushesR.map((p) => p["meta:charorder"])
  );
  // --- established device going sorted (removal leaves an id-sorted
  // remainder) never tombstones canon: the key is stripped whenever flatten
  // omits it, not just pre-first-pull. Needs two rounds — round 1 still
  // withholds, round 2 is where the null would escape. ---
  isolate();
  const pushesN: FlatMap[] = [];
  setPullHook(makeEngine(server, pushesN));
  seedStore({ ...snap({}, {}, TODAY, THIS_WEEK), characters: chars(CREATOR_ORDER), activeCharId: CREATOR_ORDER[0] });
  saveSession({ id: SID, updatedAt: 7 });
  saveBase(SID, flattenSnapshot(buildSnapshot()));
  (useAppStore.getState() as { removeCharacter: (id: string) => void }).removeCharacter("z3k9q2m");
  await syncAndResets();
  await syncAndResets();
  ok(
    "E12 sorted remainder never nulls canon",
    !pushesN.some((p) => "meta:charorder" in p),
    pushesN.map((p) => Object.keys(p))
  );
  ok("E12 canon survives the removal", server.flat["meta:charorder"] === CREATOR_ORDER.join(","));
  ok("E12 the removal itself propagates", server.flat["char:z3k9q2m:name"] === null);
  ok(
    "E12 remainder order stands",
    JSON.stringify(orderOf()) === JSON.stringify(["a1b2c3d", "m7x4p8q"]),
    orderOf()
  );
  // --- volunteer-vs-volunteer (unit level: the round port can't push without
  // pulling, so a true simultaneous race is modeled as Y's blind full push
  // landing over X canon): last arrival takes the key, the loser adopts on
  // its next merge, and the adopted order diffs silent (quiet after) ---
  const RIVAL_ORDER = ["m7x4p8q", "z3k9q2m", "a1b2c3d"]; // unsorted, distinct from canon
  const rivalLocal = { ...snap({}, {}, TODAY, THIS_WEEK), characters: chars(RIVAL_ORDER), activeCharId: RIVAL_ORDER[0] };
  const canonServer = flattenSnapshot(local) as FlatMap;
  const afterRace = { ...canonServer, ...diffFlat({}, flattenSnapshot(rivalLocal)) };
  ok("E12 race: last arrival takes the key", afterRace["meta:charorder"] === RIVAL_ORDER.join(","));
  const xAfter = unflattenMerge(afterRace, local, 15);
  const xOrder = xAfter.characters.map((c) => c.id);
  ok("E12 race: loser adopts winner", JSON.stringify(xOrder) === JSON.stringify(RIVAL_ORDER), xOrder);
  ok(
    "E12 race: quiet after converge",
    diffFlat(afterRace, flattenSnapshot({ ...local, characters: xAfter.characters } as Snap))["meta:charorder"] === undefined
  );
}

// E14: an outdated device must not resurrect a peer's unpin (reported
// 2026-10-06: desktop unpins seumas-finest-bandage, a pre-refresh mobile
// upgrades on open, the v15 migrate seed re-adds it, the next push flips the
// server tombstone back to true and the desktop row comes back). Upgrades
// never seed; new defaults are added pull-aware only for keys the server
// never saw (absent, not tombstoned). Genuine novelty still seeds, and
// regenerates carry tombstones so a fresh session never reads an unpin as
// "never decided".
{
  const SID = "e14-seed";
  const SEED = "seumas-finest-bandage"; // runtime default (defaultPins.json ∩ curated option ids)
  const server = { flat: {} as FlatMap };
  // --- part 1: the reported resurrection ---
  // Peer unpinned: server holds the tombstone. Straggler save predates the
  // row (v14, pin absent everywhere — never saw it, never unpinned it).
  server.flat = { "char:c1:name": "A", "meta:active": "c1", [`pin:${SEED}`]: null };
  isolate();
  const pushes: FlatMap[] = [];
  setPullHook(makeEngine(server, pushes));
  const upgraded = migratePersisted(
    {
      version: 14,
      characters: [{ id: "c1", name: "A", taskValues: {}, hiddenTaskIds: [] }],
      activeCharId: "c1",
      barterPins: ["tir-f3"],
    },
    14
  ) as Snap;
  ok("E14 upgrade does not seed pins", !upgraded.barterPins.includes(SEED), upgraded.barterPins);
  seedStore(upgraded);
  saveSession({ id: SID, updatedAt: 1 });
  saveBase(SID, flattenSnapshot(buildSnapshot())); // base never saw the key either
  await syncAndResets();
  await syncAndResets();
  ok(
    "E14 straggler never volunteers the unpin",
    !pushes.some((p) => p[`pin:${SEED}`] === true),
    pushes.map((p) => Object.keys(p))
  );
  ok("E14 tombstone survives the straggler", server.flat[`pin:${SEED}`] === null, server.flat[`pin:${SEED}`]);
  ok("E14 straggler stays unpinned", !useAppStore.getState().barterPins.includes(SEED), useAppStore.getState().barterPins);
  // --- part 2: genuine novelty still seeds ---
  // Same straggler, but the household never saw the row either (key absent):
  // the pull-aware seeder adds it locally and it propagates on next flush.
  delete server.flat[`pin:${SEED}`];
  await syncAndResets();
  ok("E14 absent key seeds locally", useAppStore.getState().barterPins.includes(SEED), useAppStore.getState().barterPins);
  await syncAndResets();
  ok("E14 seeded pin propagates", server.flat[`pin:${SEED}`] === true, server.flat[`pin:${SEED}`]);
  // --- part 3: regenerate carries tombstones ---
  // A fresh POST is a bare flat map; without the carried tombstones the new
  // session would read the unpin as "never decided" and part 2 would re-add it.
  saveBase("old-session", { [`pin:${SEED}`]: null, "pin:tir-f3": true });
  const created = creationState({ "pin:tir-f3": true }, "old-session");
  ok("E14 creation carries the tombstone", created[`pin:${SEED}`] === null && created["pin:tir-f3"] === true, created);
  ok(
    "E14 creation without history is bare",
    JSON.stringify(creationState({ "pin:tir-f3": true }, null)) === JSON.stringify({ "pin:tir-f3": true })
  );
  // --- part 4: first links carry the previous binding's tombstones ---
  // Dropping a link stashes its id for creationState; (re)linking clears the
  // stash. (Unpins made while never linked leave no record anywhere and still
  // seed back once — residual, documented in docs/sync.md.)
  saveSession({ id: "old-session", updatedAt: 1 });
  clearSession();
  ok("E14 dropped binding is stashed", loadLastSessionId() === "old-session", loadLastSessionId());
  const recreated = creationState({ "pin:tir-f3": true }, loadLastSessionId());
  ok("E14 first link carries stashed tombstones", recreated[`pin:${SEED}`] === null, recreated);
  saveSession({ id: SID, updatedAt: 2 });
  ok("E14 re-link clears the stash", loadLastSessionId() === null, loadLastSessionId());
}

// E15: device-local fields survive every apply path. Reported 2026-10-07: a
// routine pull reset the reminder lanes (normalizePersisted backfilled the
// absent keys to []), so the pulling device's bells silently went off and only
// the peer still fired — "the hourly notification only fires on one device per
// sync". The classification check below is the never-again guard: a new store
// field must be declared synced or device-local, or this fails.
{
  isolate();
  const SID = "e15-local";
  const server = { flat: {} as FlatMap };
  const pushes: FlatMap[] = [];
  setPullHook(makeEngine(server, pushes));
  seedStore(snap({}, {}, TODAY, THIS_WEEK));
  saveSession({ id: SID, updatedAt: 1 });
  saveBase(SID, flattenSnapshot(buildSnapshot()));
  // Peer edited: the server carries a newer value, so the round adopts remote.
  server.flat = flattenSnapshot(
    snap({ [DAILY_CHECK]: true }, { [DAILY_CHECK]: TODAY }, TODAY, THIS_WEEK)
  );
  useAppStore.setState({ hourlyReminders: ["barrier"], purpleHoleReminders: ["purple-hole"] });
  await syncAndResets();
  const st = useAppStore.getState();
  ok(
    "E15 pull adopts the remote value",
    st.characters[0]?.taskValues?.[DAILY_CHECK] === true,
    st.characters[0]?.taskValues
  );
  ok(
    "E15 pull keeps hourlyReminders",
    JSON.stringify(st.hourlyReminders) === JSON.stringify(["barrier"]),
    st.hourlyReminders
  );
  ok(
    "E15 pull keeps purpleHoleReminders",
    JSON.stringify(st.purpleHoleReminders) === JSON.stringify(["purple-hole"]),
    st.purpleHoleReminders
  );

  // Classification guard: every field a migrated store materializes must be
  // either synced (ride the snapshot) or declared device-local. A new field
  // that is neither fails here, forcing a deliberate choice instead of a
  // silent reset on the next pull.
  const snapshotKeys = new Set(Object.keys(buildSnapshot()));
  const local = new Set<string>(DEVICE_LOCAL_STATE_KEYS);
  ok(
    "E15 device-local keys are absent from the sync snapshot",
    DEVICE_LOCAL_STATE_KEYS.every((k) => !snapshotKeys.has(k)),
    [...DEVICE_LOCAL_STATE_KEYS]
  );
  const unclassified = Object.keys(migratePersisted({}, 0)).filter(
    (k) => !snapshotKeys.has(k) && !local.has(k)
  );
  ok("E15 every AppState field is synced or device-local", unclassified.length === 0, unclassified);

  // A backup import that explicitly carries a lane must still honor it, while
  // an absent lane is preserved from this device (not reset to []).
  useAppStore.getState().importJson(
    JSON.stringify({ ...snap({}, {}, TODAY, THIS_WEEK), hourlyReminders: ["barrier", "tower"] })
  );
  const imported = useAppStore.getState();
  ok(
    "E15 import honors an explicit reminder lane",
    JSON.stringify(imported.hourlyReminders) === JSON.stringify(["barrier", "tower"]),
    imported.hourlyReminders
  );
  ok(
    "E15 import preserves an absent reminder lane",
    JSON.stringify(imported.purpleHoleReminders) === JSON.stringify(["purple-hole"]),
    imported.purpleHoleReminders
  );
}

// E16: the bell heals a claimed lane whose local reminder was wiped, without
// resurrecting anything the user unsubscribed. Scenario (reported 2026-10-07):
// a sync pull left `mabiroutine:push-subs` claiming `hourly:barrier` while
// `hourlyReminders` was empty — the bell showed on but the page timer was
// dead. healClaimedReminderLanes re-arms exactly that pair.
{
  isolate();
  seedStore(snap({}, {}, TODAY, THIS_WEEK));
  useAppStore.setState({ hourlyReminders: [], purpleHoleReminders: [] });
  setServerPushOn("barrier", "https://push.example/barrier", "hourly");
  setServerPushOn(PURPLE_HOLE_ID, "https://push.example/purple", "purple");
  healClaimedReminderLanes();
  const st = useAppStore.getState();
  ok("E16 heals the claimed hourly lane", st.hourlyReminders.includes("barrier"), st.hourlyReminders);
  ok(
    "E16 heals the claimed purple lane",
    st.purpleHoleReminders.includes(PURPLE_HOLE_ID),
    st.purpleHoleReminders
  );

  // Legitimate off (unsubscribe clears the claim with the lane): nothing to do.
  // A local-only lane armed by the SW-less fallback (no claim) is left alone.
  isolate();
  seedStore(snap({}, {}, TODAY, THIS_WEEK));
  useAppStore.setState({ hourlyReminders: [], purpleHoleReminders: [] });
  healClaimedReminderLanes();
  ok(
    "E16 no claim → nothing armed",
    useAppStore.getState().hourlyReminders.length === 0,
    useAppStore.getState().hourlyReminders
  );
  useAppStore.setState({ hourlyReminders: ["barrier"] });
  healClaimedReminderLanes();
  ok(
    "E16 local-only lane left alone",
    useAppStore.getState().hourlyReminders.length === 1,
    useAppStore.getState().hourlyReminders
  );

  // A claim on a row that is no longer eligible is not resurrected.
  isolate();
  seedStore(snap({}, {}, TODAY, THIS_WEEK));
  useAppStore.setState({ hourlyReminders: [] });
  setServerPushOn("gone-row", "https://push.example/gone", "hourly");
  healClaimedReminderLanes();
  ok(
    "E16 dead claim not resurrected",
    !useAppStore.getState().hourlyReminders.includes("gone-row"),
    useAppStore.getState().hourlyReminders
  );

  // Idempotent (StrictMode double-invoke / repeated loads): re-running never
  // toggles an armed lane off.
  setServerPushOn("barrier", "https://push.example/barrier", "hourly");
  healClaimedReminderLanes();
  healClaimedReminderLanes();
  const healed = useAppStore.getState().hourlyReminders;
  ok("E16 heal is idempotent", healed.filter((x) => x === "barrier").length === 1, healed);
}

// E17: contested keys go to the remote (2026-10-09, reported: a day-old iOS
// PWA replayed its weekly counter and a pin over the desktop's newer ones).
// The device's edits never reached the server (base predates them); the peer
// cleared the weekly and unpinned since. The base arbitrates: remote wins.
{
  isolate();
  const SID = "e17-contested";
  const server = { flat: {} as FlatMap };
  const pushes: FlatMap[] = [];
  setPullHook(makeEngine(server, pushes));
  const seeded = snap({ [WEEKLY]: 5 }, { [WEEKLY]: THIS_WEEK }, YESTERDAY, THIS_WEEK);
  seeded.barterPins = ["pin-x"];
  seedStore(seeded);
  saveSession({ id: SID, updatedAt: 1 });
  // Base predates the local edits: they were never pushed.
  saveBase(SID, flattenSnapshot(snap({}, {}, YESTERDAY, THIS_WEEK)));
  // Peer since: cleared the weekly, unpinned.
  server.flat = {
    ...flattenSnapshot(snap({ [WEEKLY]: 0 }, { [WEEKLY]: THIS_WEEK }, TODAY, THIS_WEEK)),
    "pin:pin-x": null,
  };
  await syncAndResets();
  ok("E17 no contested push", pushes.length === 0, pushes);
  ok("E17 peer weekly survives", server.flat[`v:c1:${WEEKLY}@${THIS_WEEK}`] === 0, server.flat[`v:c1:${WEEKLY}@${THIS_WEEK}`]);
  ok("E17 peer unpin survives", server.flat["pin:pin-x"] === null, server.flat["pin:pin-x"]);
  const tv17 = useAppStore.getState().characters[0]?.taskValues as Record<string, unknown>;
  ok("E17 device adopts peer", tv17?.[WEEKLY] === 0 && !useAppStore.getState().barterPins.includes("pin-x"), { tv: tv17, pins: useAppStore.getState().barterPins });
  const n17 = pushes.length;
  await syncAndResets();
  const later17 = pushes.slice(n17);
  ok(
    "E17 later rounds never push the contested keys",
    later17.every((p) => !Object.keys(p).some((k) => k.includes(WEEKLY)) && p["pin:pin-x"] !== true),
    later17
  );
}

// E18: a genuinely fresh local edit still wins — the remote has not moved for
// that key since the base, so it is uncontested.
{
  isolate();
  const SID = "e18-fresh";
  const server = { flat: {} as FlatMap };
  const pushes: FlatMap[] = [];
  setPullHook(makeEngine(server, pushes));
  const seeded = snap({}, {}, TODAY, THIS_WEEK);
  seeded.barterPins = [...DEFAULT_MUST_PINS];
  seedStore(seeded);
  saveSession({ id: SID, updatedAt: 1 });
  saveBase(SID, flattenSnapshot(buildSnapshot()));
  server.flat = { ...flattenSnapshot(buildSnapshot()) };
  useAppStore.getState().toggleCheck(DAILY_CHECK, false);
  await syncAndResets();
  ok("E18 fresh edit pushed", pushes.some((p) => p[`v:c1:${DAILY_CHECK}@${TODAY}`] === true), pushes);
  ok("E18 server has the edit", server.flat[`v:c1:${DAILY_CHECK}@${TODAY}`] === true, server.flat[`v:c1:${DAILY_CHECK}@${TODAY}`]);
  ok("E18 device keeps the edit", (useAppStore.getState().characters[0]?.taskValues as Record<string, unknown>)?.[DAILY_CHECK] === true);
}

// E19: an empty base (fresh-tab / full-push world) must not replay local
// values over what the server already holds — the old full push re-pinned a
// peer's deliberate unpin; the base-arbitrated plan respects the tombstone
// while still pushing keys only this device knows.
{
  isolate();
  const SID = "e19-emptybase";
  const server = { flat: {} as FlatMap };
  const pushes: FlatMap[] = [];
  setPullHook(makeEngine(server, pushes));
  const seeded = snap({}, {}, TODAY, THIS_WEEK);
  seeded.barterPins = ["pin-x", "pin-keep"];
  seedStore(seeded);
  saveSession({ id: SID, updatedAt: 1 });
  saveBase(SID, {});
  server.flat = { "pin:pin-x": null, "char:c1:name": "A", "meta:active": "c1" };
  await syncAndResets();
  ok("E19 tombstone respected", server.flat["pin:pin-x"] === null, server.flat["pin:pin-x"]);
  ok("E19 local-only key still pushed", server.flat["pin:pin-keep"] === true, server.flat["pin:pin-keep"]);
  ok("E19 no pin-x re-push", pushes.every((p) => p["pin:pin-x"] !== true), pushes);
}

// E20: a value with no provenance reads as the current bucket (flatten's
// fallback) — the plan must still drop it against a remote that changed the
// key, so a laundered stale value can never overwrite newer peer progress.
{
  isolate();
  const SID = "e20-laundered";
  const server = { flat: {} as FlatMap };
  const pushes: FlatMap[] = [];
  setPullHook(makeEngine(server, pushes));
  const seeded = snap({ [DAILY_CHECK]: true }, { [DAILY_CHECK]: YESTERDAY }, YESTERDAY, THIS_WEEK);
  delete (seeded.taskBuckets as Record<string, string>)[DAILY_CHECK];
  seedStore(seeded);
  saveSession({ id: SID, updatedAt: 1 });
  saveBase(SID, {});
  server.flat = {
    ...flattenSnapshot(snap({ [DAILY_CHECK]: false }, { [DAILY_CHECK]: TODAY }, TODAY, THIS_WEEK)),
  };
  await syncAndResets();
  ok("E20 laundered stale does not overwrite", server.flat[`v:c1:${DAILY_CHECK}@${TODAY}`] === false, server.flat[`v:c1:${DAILY_CHECK}@${TODAY}`]);
  ok("E20 device adopts the remote", (useAppStore.getState().characters[0]?.taskValues as Record<string, unknown>)?.[DAILY_CHECK] === false);
}

// E21: top-level row order syncs (meta:taskorder, decision 4c). Built-in and
// custom rows keep one layout across linked devices, seeded from creation
// order. The map is a union: the remote wins per id, local-only entries keep
// propagating, and the adopter's generated id-sorted custom band is never
// volunteered. Built-in overrides ride the same map, so a drag that moves a
// data row lands too. Seeded at the current store version: migrations are
// covered by fixtures A-O and the v17 step would otherwise reset barter order
// mid-scenario.
{
  const SID = "e21-roworder";
  const server = { flat: {} as FlatMap };
  const STORE_VERSION = 21;
  const pack = (z9: number, a2: number, m5: number) => [
    { id: "cu-z9", name: "C-z9", kind: "daily", section: "custom", type: "check", order: z9 },
    { id: "cu-a2", name: "C-a2", kind: "daily", section: "custom", type: "check", order: a2 },
    { id: "cu-m5", name: "C-m5", kind: "daily", section: "custom", type: "check", order: m5 },
  ];
  const orderOf = () =>
    useAppStore.getState().customTasks.slice().sort((a, b) => a.order - b.order).map((t) => t.id);
  // --- device A (creator): customs in creation order, one built-in dragged up
  isolate();
  const pushesA: FlatMap[] = [];
  setPullHook(makeEngine(server, pushesA));
  seedStore({
    ...snap({}, {}, TODAY, THIS_WEEK),
    version: STORE_VERSION,
    customTasks: pack(230, 240, 250),
    globalTaskOrder: { [DAILY_COUNT]: 5 },
  });
  saveSession({ id: SID, updatedAt: 1 });
  await syncAndResets();
  ok(
    "E21 first round withholds row order",
    !pushesA.some((p) => "meta:taskorder" in p) && !("meta:taskorder" in server.flat),
    pushesA.map((p) => Object.keys(p))
  );
  await syncAndResets();
  const mapA = server.flat["meta:taskorder"] as Record<string, number> | undefined;
  ok(
    "E21 creator pushes its row order",
    !!mapA && mapA["cu-z9"] === 230 && mapA["cu-a2"] === 240 && mapA["cu-m5"] === 250 && mapA[DAILY_COUNT] === 5,
    mapA
  );
  // --- device B (adopter): the adopt fallback's exact layout (a2=10, m5=20,
  // z9=30 — id-sorted numbers, which is what the guard withholds)
  isolate();
  const pushesB: FlatMap[] = [];
  setPullHook(makeEngine(server, pushesB));
  seedStore({ ...snap({}, {}, TODAY, THIS_WEEK), version: STORE_VERSION, customTasks: pack(30, 10, 20) });
  saveSession({ id: SID, updatedAt: 2 });
  saveBase(SID, flattenSnapshot(buildSnapshot()));
  await syncAndResets();
  ok(
    "E21 adopter takes the creator custom order",
    JSON.stringify(orderOf()) === JSON.stringify(["cu-z9", "cu-a2", "cu-m5"]),
    orderOf()
  );
  ok("E21 adopter takes the builtin override", useAppStore.getState().globalTaskOrder?.[DAILY_COUNT] === 5);
  ok(
    "E21 generated band never volunteered",
    !pushesB.some((p) => "meta:taskorder" in p),
    pushesB.map((p) => p["meta:taskorder"])
  );
  const nB = pushesB.length;
  await syncAndResets();
  ok("E21 pair quiet after converge", pushesB.length === nB, pushesB.slice(nB));
  // --- device A again: still canon, still quiet
  isolate();
  const pushesA2: FlatMap[] = [];
  setPullHook(makeEngine(server, pushesA2));
  seedStore({
    ...snap({}, {}, TODAY, THIS_WEEK),
    version: STORE_VERSION,
    customTasks: pack(230, 240, 250),
    globalTaskOrder: { [DAILY_COUNT]: 5 },
  });
  saveSession({ id: SID, updatedAt: 3 });
  saveBase(SID, flattenSnapshot(buildSnapshot()));
  await syncAndResets();
  await syncAndResets();
  ok("E21 creator quiet on canon", pushesA2.length === 0, pushesA2);
  // --- fresh adopt lands in the pushed layout, built-in override included
  isolate();
  seedStore({ ...snap({}, {}, TODAY, THIS_WEEK), version: STORE_VERSION });
  ok("E21 fresh adopt ok", adoptState({ state: { ...server.flat } }));
  ok(
    "E21 fresh adopt takes pushed row order",
    JSON.stringify(orderOf()) === JSON.stringify(["cu-z9", "cu-a2", "cu-m5"]),
    orderOf()
  );
  ok("E21 fresh adopt takes builtin override", useAppStore.getState().globalTaskOrder?.[DAILY_COUNT] === 5);
  // --- unit level: absent, partial, malformed, tombstoned
  const local = {
    ...snap({}, {}, TODAY, THIS_WEEK),
    customTasks: pack(230, 240, 250),
    globalTaskOrder: { [DAILY_COUNT]: 5 },
  };
  const noKey = { ...flattenSnapshot(local) } as FlatMap;
  delete noKey["meta:taskorder"];
  const m0 = unflattenMerge(noKey, local, STORE_VERSION);
  ok(
    "E21 absent key keeps local order",
    JSON.stringify(m0.customTasks.map((t) => t.order)) === JSON.stringify([230, 240, 250]),
    m0.customTasks.map((t) => t.order)
  );
  const partial = { ...flattenSnapshot(local), "meta:taskorder": { [DAILY_COUNT]: 5 } } as FlatMap;
  const mPartial = unflattenMerge(partial, local, STORE_VERSION);
  ok(
    "E21 partial map keeps local-only customs",
    JSON.stringify(mPartial.customTasks.map((t) => t.order)) === JSON.stringify([230, 240, 250]),
    mPartial.customTasks.map((t) => t.order)
  );
  ok(
    "E21 partial map heals on the next emit",
    ((flattenSnapshot(mPartial as Snap)["meta:taskorder"] as Record<string, number>) ?? {})["cu-m5"] === 250
  );
  for (const [label, bad] of [
    ["array", [1, 2]],
    ["non-number", { "cu-z9": "x" }],
    ["empty key", { "": 1 }],
  ] as const) {
    const m = unflattenMerge({ ...flattenSnapshot(local), "meta:taskorder": bad } as FlatMap, local, STORE_VERSION);
    ok(
      `E21 malformed row order ignored (${label})`,
      JSON.stringify(m.customTasks.map((t) => t.order)) === JSON.stringify([230, 240, 250]),
      m.customTasks.map((t) => t.order)
    );
  }
  const tomb = { ...flattenSnapshot(local), "custom:cu-z9": null } as FlatMap;
  const mTomb = unflattenMerge(tomb, local, STORE_VERSION);
  ok(
    "E21 removed custom drops its order entry",
    !("cu-z9" in (mTomb.globalTaskOrder ?? {})) && mTomb.customTasks.every((t) => t.id !== "cu-z9"),
    mTomb.globalTaskOrder
  );
  // --- artifact deferral teeth: the exact adopt-fallback shape (id-sorted
  // numbers) must emit nothing, and a fresh session must never receive it.
  // The unit check is what fails if the guard is removed; the round below adds
  // the integration path (empty base, so an unguarded artifact WOULD push).
  const artifactLocal = { ...snap({}, {}, TODAY, THIS_WEEK), customTasks: pack(30, 10, 20) };
  const artifactFlat = flattenSnapshot(artifactLocal);
  ok("E21 artifact band emits no row order", !("meta:taskorder" in artifactFlat), artifactFlat["meta:taskorder"]);
  // --- per-id union teeth: a remote partial map must not wipe a local-only
  // builtin override (the custom fallback alone would hide a missing union).
  const withOverride = { ...local, globalTaskOrder: { [DAILY_COUNT]: 5, "deep-dungeon": 7 } };
  const partialNoOverride = { ...flattenSnapshot(local), "meta:taskorder": { [DAILY_COUNT]: 5 } } as FlatMap;
  const mUnion = unflattenMerge(partialNoOverride, withOverride, STORE_VERSION);
  ok(
    "E21 local-only override survives a partial map",
    mUnion.globalTaskOrder?.["deep-dungeon"] === 7,
    mUnion.globalTaskOrder
  );
  isolate();
  const pushesG: FlatMap[] = [];
  const freshServer = { flat: {} as FlatMap };
  setPullHook(makeEngine(freshServer, pushesG));
  seedStore({ ...snap({}, {}, TODAY, THIS_WEEK), version: STORE_VERSION, customTasks: pack(30, 10, 20) });
  saveSession({ id: SID, updatedAt: 6 });
  saveBase(SID, {});
  await syncAndResets();
  await syncAndResets();
  ok(
    "E21 artifact band never volunteered",
    !pushesG.some((p) => "meta:taskorder" in p) && !("meta:taskorder" in freshServer.flat),
    pushesG.map((p) => p["meta:taskorder"])
  );
}

// E22: pinned band order syncs (meta:pinorder, decision 4d). One flat array
// drives the merchant bands, the children inside them, and the daily/weekly
// split, so one rank map syncs the whole 已釘選 layout. Absent = canonical
// (nothing to say); a remote map wins for the ids it names, and pins this
// device knows but the map does not follow it in local array order.
{
  const SID = "e22-pinorder";
  const server = { flat: {} as FlatMap };
  const STORE_VERSION = 21;
  const P1 = DEFAULT_MUST_PINS[0] ?? "";
  const P2 = DEFAULT_MUST_PINS[1] ?? "";
  const P3 = SHOP_PIN;
  const AUTHORED = [P3, P1, P2];
  const pinsOf = () => useAppStore.getState().barterCustomOrder ?? [];
  // --- device A (creator): one drag authored the full pinned list
  isolate();
  const pushesA: FlatMap[] = [];
  setPullHook(makeEngine(server, pushesA));
  seedStore({
    ...snap({}, {}, TODAY, THIS_WEEK),
    version: STORE_VERSION,
    barterPins: [...AUTHORED],
    barterCustomOrder: [...AUTHORED],
  });
  saveSession({ id: SID, updatedAt: 1 });
  await syncAndResets();
  ok(
    "E22 first round withholds pin order",
    !pushesA.some((p) => "meta:pinorder" in p) && !("meta:pinorder" in server.flat),
    pushesA.map((p) => Object.keys(p))
  );
  await syncAndResets();
  const mapA = server.flat["meta:pinorder"] as Record<string, number> | undefined;
  ok("E22 creator pushes its pin order", !!mapA && mapA[P3] === 10 && mapA[P1] === 20 && mapA[P2] === 30, mapA);
  // --- device B (adopter): same pins, canonical (null) order
  isolate();
  const pushesB: FlatMap[] = [];
  setPullHook(makeEngine(server, pushesB));
  seedStore({ ...snap({}, {}, TODAY, THIS_WEEK), version: STORE_VERSION, barterPins: [P1, P2, P3] });
  saveSession({ id: SID, updatedAt: 2 });
  saveBase(SID, flattenSnapshot(buildSnapshot()));
  await syncAndResets();
  ok(
    "E22 adopter takes the canon pin order",
    JSON.stringify(pinsOf().filter((id) => AUTHORED.includes(id))) === JSON.stringify(AUTHORED),
    pinsOf()
  );
  ok(
    "E22 untouched device volunteers no pin order",
    !pushesB.some((p) => "meta:pinorder" in p),
    pushesB.map((p) => p["meta:pinorder"])
  );
  const nB = pushesB.length;
  await syncAndResets();
  ok("E22 pair quiet after converge", pushesB.length === nB, pushesB.slice(nB));
  // --- unit level
  const local = { ...snap({}, {}, TODAY, THIS_WEEK), barterPins: [P1, P2, P3], barterCustomOrder: [...AUTHORED] };
  const canon = { ...flattenSnapshot(local) } as FlatMap;
  const canonical = { ...snap({}, {}, TODAY, THIS_WEEK), barterPins: [P1, P2] };
  ok("E22 canonical (null) emits no pin order", !("meta:pinorder" in flattenSnapshot(canonical)));
  const adopter = {
    ...snap({}, {}, TODAY, THIS_WEEK),
    barterPins: [P1, P2, P3, "pin-d"],
    barterCustomOrder: [P1, P2, P3, "pin-d"],
  };
  // A real round pushes local keys before merging, so the local-only pin is
  // already on the server; model that with its pin key.
  const merged = unflattenMerge({ ...canon, "pin:pin-d": true } as FlatMap, adopter, STORE_VERSION);
  ok(
    "E22 canon wins and local-only pin appends",
    JSON.stringify(merged.barterCustomOrder) === JSON.stringify([P3, P1, P2, "pin-d"]),
    merged.barterCustomOrder
  );
  const noKey = { ...flattenSnapshot(adopter) } as FlatMap;
  delete noKey["meta:pinorder"];
  const m0 = unflattenMerge(noKey, adopter, STORE_VERSION);
  ok(
    "E22 absent key keeps local pin order",
    JSON.stringify(m0.barterCustomOrder) === JSON.stringify([P1, P2, P3, "pin-d"]),
    m0.barterCustomOrder
  );
  const unpinned = { ...canon, [`pin:${P3}`]: null } as FlatMap;
  const mu = unflattenMerge(unpinned, local, STORE_VERSION);
  ok("E22 unpinned pin drops from the canon", !(mu.barterCustomOrder ?? []).includes(P3), mu.barterCustomOrder);
  for (const [label, bad] of [
    ["array", [1]],
    ["non-number", { [P1]: "x" }],
  ] as const) {
    const m = unflattenMerge({ ...canon, "meta:pinorder": bad } as FlatMap, local, STORE_VERSION);
    ok(
      `E22 malformed pin order ignored (${label})`,
      JSON.stringify(m.barterCustomOrder) === JSON.stringify(AUTHORED),
      m.barterCustomOrder
    );
  }
  // --- fresh adopt lands in the pushed pin layout
  isolate();
  seedStore({ ...snap({}, {}, TODAY, THIS_WEEK), version: STORE_VERSION });
  ok("E22 fresh adopt ok", adoptState({ state: { ...canon } }));
  ok(
    "E22 fresh adopt takes the pushed pin order",
    JSON.stringify(pinsOf().filter((id) => AUTHORED.includes(id))) === JSON.stringify(AUTHORED),
    pinsOf()
  );
}

setPullHook(null);
console.log(failures === 0 ? "ALL ENGINE SCENARIOS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);