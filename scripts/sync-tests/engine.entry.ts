// Sync engine integration scenarios (T3–T6). Real store, real flat/session/
// reset functions, modeled server, stubbed storage. Complements tabs.cjs
// (T1 stale-tab, T2 cap — vm-realm tabs) and prop-reset.ts (randomized
// checkResets exactness).
//
// T3  late-wake suppression: peer already in bucket → local wipe scrubs base
//     (no tombstones), peer values re-adopted. THE retention-critical path.
// T3b early reset: first into bucket → full reset + tombstones (intended).
// T4  chain: early device's tombstones adopted; peer's later reset suppresses.
// T5  adopt/import stamp current bucket (no wipe on next tick).
// T6  resetAll propagation (documents current nuke-propagation behavior).
import { useAppStore } from "@/store/useAppStore";
import {
  flattenSnapshot,
  diffFlat,
  loadBase,
  saveBase,
  unflattenMerge,
  type FlatMap,
} from "@/sync/flat";
import {
  loadSession,
  saveSession,
  buildSnapshot,
  applySnapshot,
  loadSeen,
  saveSeen,
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
// Date-relative buckets: tests must pass any day. YESTERDAY = bucket 24h ago
// (a full bucket behind, so daily fires); THIS_WEEK kept equal everywhere
// except weekly-specific scenarios (so weekly stays silent).
const TODAY = currentDailyBucket(new Date());
const YESTERDAY = currentDailyBucket(new Date(Date.now() - 24 * 3600 * 1000));
const THIS_WEEK = getTaipeiWeekKey(new Date());
const LAST_WEEK = getTaipeiWeekKey(new Date(Date.now() - 7 * 24 * 3600 * 1000));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Snap = any;
function snap(values: Record<string, number | boolean>, daily: string | null, weekly: string | null): Snap {
  return {
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

// Per-test isolation: fresh storage buckets + unique session id. Store state
// is set explicitly per test (singleton); module memBase is keyed by session
// id, so unique SIDs keep tab-bases apart.
function isolate(): void {
  const ls = new MemStorage();
  const ss = new MemStorage();
  Object.defineProperty(globalThis, "localStorage", { value: ls, configurable: true, writable: true });
  Object.defineProperty(globalThis, "sessionStorage", { value: ss, configurable: true, writable: true });
}

function seedStore(s: Snap): void {
  useAppStore.setState(JSON.parse(JSON.stringify(s)));
}

// Faithful pull-round port of SyncButton.pullNow minus UI refs (linked/busy/
// throttle live in the component; harness drives one round at a time).
// NOTE: keep in sync with pullNow by inspection — divergence risk documented.
function makeEngine(server: { flat: FlatMap }, pushes: FlatMap[]) {
  return async function fakePull(): Promise<void> {
    const session = loadSession();
    if (!session) return;
    const flat = flattenSnapshot(buildSnapshot());
    const base = loadBase(session.id);
    const changes = diffFlat(base, flat);
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
    saveBase(session.id, serverView);
    const marker = (v: unknown): string => (typeof v === "string" ? v : "");
    saveSeen(session.id, { daily: marker(serverView["meta:resetDaily"]), weekly: marker(serverView["meta:resetWeekly"]) });
  };
}

// Real daily task ids (reset-scoped — synthetic ids would pass trivially
// because checkResets never deletes them): parttime = daily check,
// tower = daily counter.
const CHECK = "parttime";
const COUNT = "tower";

// T3: late wake. Peer already reset into TODAY (server holds fresh täps).
{
  isolate();
  const SID = "t3-late";
  const server = { flat: {} as FlatMap };
  const pushes: FlatMap[] = [];
  setPullHook(makeEngine(server, pushes));
  // Tab state: yesterday vintage, CHECK done.
  seedStore(snap({ [CHECK]: true }, YESTERDAY, THIS_WEEK));
  saveSession({ id: SID, updatedAt: 1 });
  saveBase(SID, flattenSnapshot(buildSnapshot()));
  // Server: peer's today (CHECK + peer-only COUNT + today markers).
  server.flat = flattenSnapshot(snap({ [CHECK]: true, [COUNT]: 5 }, TODAY, THIS_WEEK));
  await syncAndResets();
  const nulled = pushes.flatMap((p) => Object.entries(p).filter(([, v]) => v === null).map(([k]) => k));
  ok("T3 no tombstone for peer values", !nulled.some((k) => k === `v:c1:${CHECK}` || k === `v:c1:${COUNT}`), nulled);
  const st = useAppStore.getState();
  const tv = st.characters[0]?.taskValues as Record<string, unknown>;
  ok("T3 adopted peer values", tv?.[CHECK] === true && tv?.[COUNT] === 5, tv);
  ok("T3 marker advanced", st.lastDailyReset === TODAY, st.lastDailyReset);
  ok("T3 seen saved", loadSeen(SID).daily === TODAY, loadSeen(SID));
  const pushes2 = pushes.length;
  await syncAndResets();
  ok("T3 second run quiet", pushes.length === pushes2, pushes.slice(pushes2));
}

// T3b: early reset. Nobody ahead: full reset + tombstones must flow.
// Markers ride the push after the stamp, so two rounds: stamp, then flush.
{
  isolate();
  const SID = "t3b-early";
  const server = { flat: {} as FlatMap };
  const pushes: FlatMap[] = [];
  setPullHook(makeEngine(server, pushes));
  seedStore(snap({ [CHECK]: true }, YESTERDAY, THIS_WEEK));
  saveSession({ id: SID, updatedAt: 1 });
  saveBase(SID, flattenSnapshot(buildSnapshot()));
  server.flat = flattenSnapshot(snap({ [CHECK]: true }, YESTERDAY, THIS_WEEK)); // peer still yesterday
  await syncAndResets();
  ok("T3b local wiped+stamped", useAppStore.getState().lastDailyReset === TODAY);
  await syncAndResets();
  ok("T3b tombstones stale value", pushes.some((p) => p[`v:c1:${CHECK}`] === null), pushes);
  ok("T3b marker pushed", pushes.some((p) => p["meta:resetDaily"] === TODAY));
}

// T4: chain. Early device tombstones; peer's later reset suppresses.
{
  isolate();
  const SID = "t4-chain";
  const server = { flat: {} as FlatMap };
  const pushes: FlatMap[] = [];
  setPullHook(makeEngine(server, pushes));
  // Early device: yesterday state, resets first.
  seedStore(snap({ [CHECK]: true }, YESTERDAY, THIS_WEEK));
  saveSession({ id: SID, updatedAt: 1 });
  saveBase(SID, flattenSnapshot(buildSnapshot()));
  server.flat = flattenSnapshot(snap({ [CHECK]: true }, YESTERDAY, THIS_WEEK));
  await syncAndResets(); // full: tombstones CHECK, stamps TODAY
  await syncAndResets(); // flush the stamp + tombstone
  // Early device taps COUNT (today progress) and pushes.
  useAppStore.setState({
    characters: [{ id: "c1", name: "A", taskValues: { [COUNT]: 5 }, hiddenTaskIds: [] }],
  });
  await syncAndResets();
  ok("T4 count pushed", pushes.some((p) => p[`v:c1:${COUNT}`] === 5));
  // Peer wakes late with yesterday memory (CHECK done, never reset).
  const peerMem = snap({ [CHECK]: true }, YESTERDAY, THIS_WEEK);
  seedStore(peerMem);
  // Peer's tab base is yesterday-vintage (its own tab, seeded from shared seed).
  saveBase(SID, flattenSnapshot(snap({ [CHECK]: true }, YESTERDAY, THIS_WEEK)));
  const nPushes = pushes.length;
  await syncAndResets();
  const peerPushes = pushes.slice(nPushes);
  ok("T4 peer sends no count tombstone", !peerPushes.some((p) => p[`v:c1:${COUNT}`] === null), peerPushes);
  ok("T4 server keeps count", server.flat[`v:c1:${COUNT}`] === 5);
  const st = useAppStore.getState();
  const tv4 = st.characters[0]?.taskValues as Record<string, unknown>;
  ok("T4 peer adopted count", tv4?.[COUNT] === 5, tv4);
  ok("T4 peer adopted legit reset (check gone)", tv4?.[CHECK] === undefined, tv4);
}

// T5: adopt + import stamp current bucket (arrivals never wipe next tick).
{
  isolate();
  const today = currentDailyBucket(new Date());
  const week = getTaipeiWeekKey(new Date());
  seedStore(snap({}, null, null));
  ok("T5 adopt ok", adoptState({ state: flattenSnapshot(snap({ d1: true }, YESTERDAY, THIS_WEEK)) }));
  const st = useAppStore.getState();
  ok("T5 adopt stamps daily", st.lastDailyReset === today, st.lastDailyReset);
  ok("T5 adopt stamps weekly", st.lastWeeklyReset === week, st.lastWeeklyReset);
  ok("T5 adopt keeps values", (st.characters[0]?.taskValues as Record<string, unknown>)?.["d1"] === true);
  const r = st.checkResets();
  ok("T5 no reset after adopt", !r.daily && !r.weekly, r);

  const ancient = JSON.stringify(snap({ parttime: true }, "2000-01-01", "2000-W0101"));
  (useAppStore.getState() as { importJson: (j: string) => void }).importJson(ancient);
  const st2 = useAppStore.getState();
  ok("T5 import stamps daily", st2.lastDailyReset === today, st2.lastDailyReset);
  ok("T5 import keeps values", (st2.characters[0]?.taskValues as Record<string, unknown>)?.["parttime"] === true);
  const r2 = st2.checkResets();
  ok("T5 no reset after import", !r2.daily && !r2.weekly, r2);
}

// T6: resetAll propagates as a nuke (documents CURRENT behavior).
// OPEN PRODUCT QUESTION: should a local nuke silently adopt everywhere?
// This test locks the behavior so any change is deliberate.
{
  isolate();
  const SID = "t6-nuke";
  const server = { flat: {} as FlatMap };
  const pushes: FlatMap[] = [];
  setPullHook(makeEngine(server, pushes));
  seedStore(snap({ d1: true, d2: true }, TODAY, THIS_WEEK));
  saveSession({ id: SID, updatedAt: 1 });
  saveBase(SID, flattenSnapshot(buildSnapshot()));
  server.flat = flattenSnapshot(buildSnapshot());
  (useAppStore.getState() as { resetAll: () => void }).resetAll();
  await syncAndResets();
  ok("T6 nuke tombstones old values", pushes.some((p) => p["v:c1:d1"] === null && p["v:c1:d2"] === null), pushes);
  // Peer pulls: adopts the nuke (loses its characters).
  const peerMerged = unflattenMerge({ ...server.flat }, snap({ d1: true }, TODAY, THIS_WEEK), 12);
  ok(
    "T6 peer adopts nuke",
    peerMerged.characters.length === 1 && Object.keys(peerMerged.characters[0]?.taskValues ?? {}).length === 0,
    peerMerged.characters
  );
}

setPullHook(null);

// T7: seen is monotonic — a stale read must not regress it, and the next
// late reset must still suppress. Regression test for the acc:null
// full-reset tombstones: without the max() in saveSeen, the stale save
// below rewinds seen and the reset below emits peer tombstones.
{
  isolate();
  const SID = "t7-seenmono";
  saveSession({ id: SID, updatedAt: 1 });
  saveSeen(SID, { daily: TODAY, weekly: THIS_WEEK }); // prior fresh pull
  saveSeen(SID, { daily: YESTERDAY, weekly: LAST_WEEK }); // lagged replica
  const held = loadSeen(SID);
  ok("T7 seen holds daily", held.daily === TODAY, held);
  ok("T7 seen holds weekly", held.weekly === THIS_WEEK, held);

  const server = { flat: {} as FlatMap };
  const pushes: FlatMap[] = [];
  setPullHook(makeEngine(server, pushes));
  seedStore(snap({ [CHECK]: true }, YESTERDAY, THIS_WEEK));
  saveSession({ id: SID, updatedAt: 1 });
  saveBase(SID, flattenSnapshot(buildSnapshot()));
  server.flat = flattenSnapshot(snap({ [CHECK]: true, [COUNT]: 5 }, TODAY, THIS_WEEK));
  await syncAndResets();
  const nulled = pushes.flatMap((p) => Object.entries(p).filter(([, v]) => v === null).map(([k]) => k));
  ok("T7 late reset still suppresses", !nulled.some((k) => k === `v:c1:${COUNT}`), nulled);
  setPullHook(null);
}

console.log(failures === 0 ? "ALL ENGINE SCENARIOS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
