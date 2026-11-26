import { applyLinkRows, type LinkApplyInput } from "@/lib/link/apply";
import { emptyLinkDevice, linkKey, loadLinkDevice, saveLinkDevice } from "@/lib/link/device";
import { activeCid, planIdentities } from "@/lib/link/identity";
import { parseLinkMessage, type LinkRow } from "@/lib/link/protocol";
import { currentDailyBucket, currentWeekendBucket, getTaipeiWeekKey } from "@/lib/reset";
import { BLACK_HOLE } from "@/lib/link/tasks";
import { LinkClient, quietDelay } from "@/link/client";
import { shopDealsByPinId } from "@/lib/shops";
import type { Character } from "@/lib/types";
import { T, basicSnapshot, rows } from "./link-tests/fixtures";

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`ok: ${msg}`);
}

function chars(): Character[] {
  return [
    { id: "c1", name: "角色A", taskValues: {}, hiddenTaskIds: [] },
    { id: "c2", name: "角色B", taskValues: {}, hiddenTaskIds: [] },
  ];
}

function base(overrides: Partial<LinkApplyInput> = {}): LinkApplyInput {
  return {
    rows: [],
    characters: chars(),
    accountValues: {},
    taskBuckets: {},
    customTasks: [],
    barterPins: [],
    device: emptyLinkDevice(),
    nowSeconds: T,
    ...overrides,
  };
}

const parsed = parseLinkMessage(JSON.stringify(basicSnapshot));
assert(parsed?.message.type === "snapshot", "basic snapshot parses");
assert(parsed?.message.type === "snapshot" && parsed.message.rows.length === 7, "snapshot keeps seven rows");
assert(
  parseLinkMessage(JSON.stringify({ ...basicSnapshot, protocol: "wiretap/1" })) === null,
  "a foreign protocol is refused"
);
const withBadRow = {
  ...basicSnapshot,
  rows: [{ ...rows.daily, value: "x" }, rows.abyssA],
};
const badParsed = parseLinkMessage(JSON.stringify(withBadRow));
assert(badParsed?.badRows === 1 && badParsed.message.type === "snapshot" && badParsed.message.rows.length === 1, "one malformed row is counted, the rest survive");
const activeParsed = parseLinkMessage(
  JSON.stringify({ ...basicSnapshot, active: { gameId: 1001, at: T } })
);
assert(
  activeParsed?.message.type === "snapshot" && activeParsed.message.active?.gameId === 1001,
  "the active character is parsed"
);
assert(
  activeCid({ gameId: 1001, at: T }, { "1001": "c1" }, [{ id: "c1" }]) === "c1",
  "an active game character resolves to its local tab"
);
assert(
  activeCid({ gameId: 1002, at: T }, { "1001": "c1" }, [{ id: "c1" }]) === null,
  "an unmatched active character does not switch the tab"
);

const first = applyLinkRows(base({ rows: basicSnapshot.rows }));
const writeOf = (taskId: string, charId?: string) =>
  first.writes.find((w) => w.taskId === taskId && (charId === undefined || w.charId === charId));
assert(writeOf("daily-dungeon", "c1")?.value === true, "daily-dungeon writes a character check");
assert(writeOf("abyss", "c1")?.value === 2, "abyss applies to character A");
assert(writeOf("abyss", "c2")?.value === 1, "the same task applies to character B");
assert(writeOf("acc-shopfree")?.scope === "account", "acc-shopfree is account-scoped");
assert(writeOf("acc-shopfree")?.charId === undefined, "account writes carry no charId");
assert(writeOf("acc-gem")?.value === 10, "acc-gem applies to the account");
{
  const unmatched = applyLinkRows(
    base({
      characters: [{ id: "c9", name: "別的角色", taskValues: {}, hiddenTaskIds: [] }],
      rows: [{ ...rows.gem, character: { gameId: 9999, name: "沒對應的角色" } }],
    })
  );
  assert(
    unmatched.writes.length === 1 &&
      unmatched.writes[0].scope === "account" &&
      unmatched.unresolved.length === 0,
    "an account row applies without a character match: its character is provenance"
  );
}
assert(writeOf("weekly-goals-hunt", "c1")?.value === 4, "a weekly-goals child applies to its character");
assert(first.device.match["1001"] === "c1" && first.device.match["1002"] === "c2", "identity matches persist");
assert(first.unresolved.length === 0 && first.offers.length === 0, "the basic snapshot is fully resolved");

assert(writeOf("barrier", "c1")?.value === 4, "barrier 3 remaining stores 4 used");

const finishedParsed = parseLinkMessage(
  JSON.stringify({ ...basicSnapshot, rows: [{ ...rows.daily, finished: true }] })
);
assert(
  finishedParsed?.message.type === "snapshot" &&
    finishedParsed.message.rows[0]?.finished === true,
  "a finished row parses"
);
const finishedApplied = applyLinkRows(base({ rows: [{ ...rows.daily, finished: true }] }));
assert(
  finishedApplied.writes.length === 1 && finishedApplied.writes[0].finished === true,
  "finished crosses the apply boundary"
);
assert(
  first.writes.every((w) => w.finished !== true),
  "an older producer's row is not finished"
);

const once = applyLinkRows(base({ rows: [rows.daily] }));
const older = applyLinkRows(
  base({ device: once.device, rows: [{ ...rows.daily, at: rows.daily.at - 1, value: 0 }] })
);
assert(older.writes.length === 0 && older.older.length === 1, "an older at does not overwrite");

const previous = applyLinkRows(
  base({ rows: [{ ...rows.daily, at: rows.daily.at - 86400 }] })
);
assert(previous.writes.length === 0 && previous.oldCycle.length === 1, "a previous-day row is refused");

const dayBucket = writeOf("daily-dungeon", "c1")?.bucket;
const tomorrow = applyLinkRows(
  base({
    device: once.device,
    nowSeconds: T + 86400,
    rows: [{ ...rows.daily, at: T + 86400 }],
  })
);
assert(tomorrow.writes.length === 1 && tomorrow.writes[0].bucket !== dayBucket, "a new bucket applies");

const unknownTask = applyLinkRows(
  base({ rows: [{ ...rows.daily, task: "not-a-row" }] })
);
assert(unknownTask.writes.length === 0 && unknownTask.unresolved[0]?.reason === "unknown-task", "an unknown task is counted");
const unknownChar = applyLinkRows(
  base({ rows: [{ ...rows.daily, character: { gameId: 9, name: "沒有這個人" } }] })
);
assert(unknownChar.writes.length === 0 && unknownChar.unresolved[0]?.reason === "no-character", "an unmatched character is counted");

const tapKey = linkKey("character", "c1", "daily-dungeon", once.writes[0].bucket);
const tapDevice = { ...emptyLinkDevice(), localWrites: { [tapKey]: T } };

const guarded = applyLinkRows(
  base({ device: tapDevice, rows: [{ ...rows.daily, at: T - 1 }] })
);
assert(
  guarded.writes.length === 0 &&
    guarded.guarded[0]?.key === tapKey &&
    guarded.guarded[0]?.tapAt === T,
  "a row older than the local write is guarded"
);

const newer = applyLinkRows(
  base({ device: tapDevice, rows: [{ ...rows.daily, at: T + 1 }] })
);
assert(
  newer.writes.length === 1 && newer.device.localWrites[tapKey] === undefined,
  "a newer observation applies and clears the guard"
);

const repeat = applyLinkRows(
  base({
    device: {
      ...tapDevice,
      watermarks: { [tapKey]: { at: T - 5, value: true } },
    },
    rows: [{ ...rows.daily, at: T + 1, changed: false }],
  })
);
assert(
  repeat.writes.length === 0 && repeat.device.localWrites[tapKey] === T,
  "a same-value repeat keeps the local value"
);

const changedTrue = applyLinkRows(
  base({
    device: {
      ...tapDevice,
      watermarks: { [tapKey]: { at: T - 5, value: true } },
    },
    rows: [{ ...rows.daily, at: T + 1, changed: true }],
  })
);
assert(
  changedTrue.writes.length === 1 &&
    changedTrue.device.localWrites[tapKey] === undefined,
  "a changed row with the same value beats a repeat and clears the guard"
);

const finishedRepeat = applyLinkRows(
  base({
    device: {
      ...tapDevice,
      watermarks: { [tapKey]: { at: T - 5, value: true } },
    },
    rows: [{ ...rows.daily, at: T + 1, changed: false, finished: true }],
  })
);
assert(
  finishedRepeat.writes.length === 1 &&
    finishedRepeat.writes[0].finished === true,
  "a finished transition applies through a repeat"
);

const bh = applyLinkRows(
  base({
    rows: [rows.blackHole, rows.blackHoleToday, rows.blackHoleDaily],
    characters: chars(),
  })
);
const bank = bh.writes.find((w) => w.taskId === BLACK_HOLE && w.charId === "c1");
assert(bank?.value === 3, "black-hole 4 left (7-bank) stores bank 3");
assert(bh.writes.find((w) => w.taskId === "black-hole-daily")?.value === false, "the daily check still applies");
assert(
  bh.unresolved.length === 0 &&
    !bh.writes.some((w) => w.taskId === "black-hole-today"),
  "the black-hole aux row is ignored without a write or unresolved count"
);

if (!bank) throw new Error("black-hole bank write missing");
const bankKey = linkKey("character", "c1", BLACK_HOLE, bank.bucket);
const bankTap = { ...emptyLinkDevice(), localWrites: { [bankKey]: T } };
const bankGuarded = applyLinkRows(
  base({
    device: bankTap,
    rows: [rows.blackHole, rows.blackHoleToday, rows.blackHoleDaily],
    characters: chars(),
  })
);
assert(
  !bankGuarded.writes.some((w) => w.taskId === BLACK_HOLE) &&
    bankGuarded.guarded.some((g) => g.key === bankKey),
  "a bank guard blocks the composite at the same time"
);
const bankNewer = applyLinkRows(
  base({
    device: bankTap,
    nowSeconds: T + 10,
    rows: [
      { ...rows.blackHole, at: T + 1 },
      { ...rows.blackHoleToday, at: T + 1 },
      { ...rows.blackHoleDaily, at: T + 1 },
    ],
  })
);
assert(
  bankNewer.writes.some((w) => w.taskId === BLACK_HOLE),
  "a newer input recomputes the bank"
);

const goalRows = [
  { task: "weekly-goals", character: { gameId: 1001, name: "角色A" }, value: 4, kind: "count", at: T, op: 170966, confidence: "proven", changed: true },
  { task: "weekly-goals-deep-dungeon", character: { gameId: 1001, name: "角色A" }, value: 0, kind: "count", at: T, op: 170966, confidence: "proven", changed: true },
  { task: "weekly-goals-dungeon", character: { gameId: 1001, name: "角色A" }, value: 0, kind: "count", at: T, op: 170966, confidence: "proven", changed: true },
  { task: "weekly-goals-hunt", character: { gameId: 1001, name: "角色A" }, value: 0, kind: "count", at: T, op: 170966, confidence: "proven", changed: true },
] satisfies LinkRow[];
const goals = applyLinkRows(base({ rows: goalRows }));
const goalKeys = goals.writes.map((w) =>
  linkKey(w.scope, w.charId ?? null, w.taskId, w.bucket)
);
const goalTap = {
  ...emptyLinkDevice(),
  localWrites: Object.fromEntries(goalKeys.map((key) => [key, T])),
};
const turnIn = applyLinkRows(
  base({ device: goalTap, rows: goalRows.map((row) => ({ ...row, at: T + 1 })) })
);
assert(
  turnIn.writes.length === 4 &&
    goalKeys.every((key) => turnIn.device.localWrites[key] === undefined),
  "a newer turn-in batch applies and clears every guard"
);

if (!dayBucket) throw new Error("daily-dungeon write missing its bucket");
const barrierKey = linkKey("character", "c1", "barrier", dayBucket);
const barrierTap = { ...emptyLinkDevice(), localWrites: { [barrierKey]: T } };
const barrierNewer = applyLinkRows(
  base({ device: barrierTap, rows: [{ ...rows.barrier, at: T + 1 }] })
);
assert(
  barrierNewer.writes.length === 1 && barrierNewer.writes[0].taskId === "barrier",
  "a newer barrier observation applies"
);

const memory = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, String(value));
    },
    removeItem: (key: string) => {
      memory.delete(key);
    },
  },
});
const now = new Date();
const dailyNow = currentDailyBucket(now);
const weekNow = getTaipeiWeekKey(now);
const weekendNow = currentWeekendBucket(now);
const oldDaily = currentDailyBucket(new Date(now.getTime() - 2 * 86400 * 1000));
const oldWeek = getTaipeiWeekKey(new Date(now.getTime() - 8 * 86400 * 1000));
const oldWeekend = currentWeekendBucket(new Date(now.getTime() - 8 * 86400 * 1000));
saveLinkDevice({
  ...emptyLinkDevice(),
  localWrites: {
    [`c1:daily@${dailyNow}`]: T,
    [`c1:weekly@${weekNow}`]: T,
    [`c1:weekend@${weekendNow}`]: T,
    [`c1:daily@${oldDaily}`]: T,
    [`c1:weekly@${oldWeek}`]: T,
    [`c1:weekend@${oldWeekend}`]: T,
  },
});
const loaded = loadLinkDevice();
assert(
  loaded.localWrites[`c1:daily@${dailyNow}`] === T &&
    loaded.localWrites[`c1:weekly@${weekNow}`] === T &&
    loaded.localWrites[`c1:weekend@${weekendNow}`] === T,
  "the live daily, weekly and weekend buckets survive a load"
);
assert(
  loaded.localWrites[`c1:daily@${oldDaily}`] === undefined &&
    loaded.localWrites[`c1:weekly@${oldWeek}`] === undefined &&
    loaded.localWrites[`c1:weekend@${oldWeekend}`] === undefined,
  "stale daily, weekly and weekend buckets are pruned on load"
);

const weeklyOnly = applyLinkRows(base({ rows: [{ ...rows.blackHole, at: T }] }));
const weeklyTap = {
  ...weeklyOnly.device,
  localWrites: { [bankKey]: T + 1 },
};
const weeklyRepeat = applyLinkRows(
  base({
    device: weeklyTap,
    rows: [{ ...rows.blackHole, at: T + 2, value: 4, changed: false }],
  })
);
assert(
  !weeklyRepeat.writes.some((w) => w.taskId === BLACK_HOLE) &&
    weeklyRepeat.device.localWrites[bankKey] === T + 1,
  "a repeat weekly frame does not overwrite the tap"
);
const weeklyChanged = applyLinkRows(
  base({
    device: weeklyTap,
    rows: [{ ...rows.blackHole, at: T + 2, value: 4, changed: true }],
  })
);
assert(
  weeklyChanged.writes.some((w) => w.taskId === BLACK_HOLE),
  "a changed weekly frame with the same bank still applies"
);
const dailyOnly = applyLinkRows(
  base({
    device: weeklyOnly.device,
    rows: [{ ...rows.blackHoleDaily, at: T + 5, value: 1 }],
  })
);
assert(
  !dailyOnly.writes.some((w) => w.taskId === BLACK_HOLE),
  "a later daily stamp does not rewrite the bank"
);
const weeklyLater = applyLinkRows(
  base({
    device: dailyOnly.device,
    rows: [{ ...rows.blackHole, at: T + 1, value: 5 }],
  })
);
assert(
  weeklyLater.writes.find((w) => w.taskId === BLACK_HOLE && w.charId === "c1")?.value === 2,
  "a newer weekly applies after a daily stamp"
);

if (
  getTaipeiWeekKey(new Date(T * 1000)) ===
  getTaipeiWeekKey(new Date((T - 86400) * 1000))
) {
  throw new Error("the rollover fixture no longer spans a weekly boundary");
}
const rollDevice = emptyLinkDevice();
rollDevice.blackHole = {
  c1: { weekly: { at: T - 86400, value: 2, op: 20590 } },
};
const roll = applyLinkRows(
  base({
    device: rollDevice,
    rows: [
      { ...rows.blackHoleToday, at: T, value: 0 },
      { ...rows.blackHoleDaily, at: T, value: 1 },
    ],
  })
);
assert(
  !roll.writes.some((w) => w.taskId === BLACK_HOLE),
  "a Monday daily frame does not carry last week's bank into the new week"
);

const retired = applyLinkRows(
  base({ rows: [{ ...rows.blackHole, value: 11, at: T, op: 170695 }] })
);
assert(
  !retired.writes.some((w) => w.taskId === BLACK_HOLE),
  "a retired 14-scale weekly value does not write the bank"
);
const zeroWeekly = applyLinkRows(
  base({ rows: [{ ...rows.blackHole, value: 0, at: T }] })
);
assert(
  zeroWeekly.writes.find((w) => w.taskId === BLACK_HOLE)?.value === 7,
  "a zero weekly count stores bank 7"
);
const oldWeekly = applyLinkRows(
  base({ rows: [{ ...rows.blackHole, at: T - 86400 }] })
);
assert(
  oldWeekly.oldCycle.some((key) => key.includes(BLACK_HOLE)) &&
    !oldWeekly.writes.some((w) => w.taskId === BLACK_HOLE),
  "a weekly frame from last week is refused before it can write the bank"
);

const liveBh = applyLinkRows(
  base({
    characters: chars(),
    rows: [
      { ...rows.blackHole, value: 5, at: T, op: 20590 },
      { ...rows.blackHoleToday, value: 0, at: T, op: 20590 },
      { ...rows.blackHoleDaily, value: 1, at: T, op: 20590 },
    ],
  })
);
const liveBank = liveBh.writes.find(
  (w) => w.taskId === BLACK_HOLE && w.charId === "c1"
);
assert(liveBank?.value === 2, "the 7-bank remaining 5 stores bank used 2");
assert(
  liveBh.writes.find((w) => w.taskId === "black-hole-daily" && w.charId === "c1")?.value === true,
  "the daily row carries today's used flag"
);

const localChar = (
  id: string,
  name: string,
  taskValues: Record<string, number | boolean> = {}
): Character => ({ id, name, taskValues, hiddenTaskIds: [] });

const fresh = planIdentities(
  [localChar("c1", "角色 1")],
  [{ gameId: 1001, name: "A" }, { gameId: 1002, name: "B" }],
  {}
);
assert(
  fresh.renames.length === 1 && fresh.creates.length === 1 && fresh.bindings.length === 1,
  "a fresh placeholder is renamed and the missing game character is created"
);

const exact = planIdentities(
  [localChar("c1", "A"), localChar("c2", "B")],
  [{ gameId: 1001, name: "A" }, { gameId: 1002, name: "B" }],
  {}
);
assert(
  exact.bindings.length === 2 && exact.renames.length === 0 && exact.creates.length === 0,
  "exact names bind without changing the roster"
);

const single = planIdentities(
  [localChar("c1", "Main")],
  [{ gameId: 1001, name: "A" }],
  {}
);
assert(
  single.bindings[0]?.cid === "c1" && single.renames.length === 0,
  "one local and one game character bind without overwriting the label"
);

const custom = planIdentities(
  [localChar("c1", "Main"), localChar("c2", "Alt")],
  [{ gameId: 1001, name: "A" }, { gameId: 1002, name: "B" }],
  {}
);
assert(
  custom.bindings.length === 0 && custom.renames.length === 0 && custom.unmatched.length === 2,
  "custom names that do not match are left alone"
);

const mixed = planIdentities(
  [localChar("c1", "角色 1"), localChar("c2", "Main")],
  [{ gameId: 1001, name: "A" }, { gameId: 1002, name: "B" }],
  {}
);
assert(
  mixed.renames.length === 1 && mixed.creates.length === 0 && mixed.unmatched.length === 1,
  "a placeholder is adopted while a custom mismatch stays untouched"
);

const six = Array.from({ length: 6 }, (_, i) => localChar(`c${i + 1}`, `角色 ${i + 1}`));
const full = planIdentities(
  six,
  Array.from({ length: 7 }, (_, i) => ({ gameId: 1001 + i, name: `G${i + 1}` })),
  {}
);
assert(
  full.renames.length === 6 && full.unmatched.length === 1 && full.unmatched[0].reason === "full",
  "the six-character cap is respected"
);

const saved = planIdentities(
  [localChar("c1", "X")],
  [{ gameId: 1001, name: "Y" }],
  { "1001": "c1" }
);
assert(
  saved.bindings[0]?.cid === "c1" && saved.renames.length === 0,
  "a persisted match wins over the current names"
);

const progressed = planIdentities(
  [{ ...localChar("c1", "角色 1"), taskValues: { abyss: 1 } }],
  [{ gameId: 1001, name: "A" }],
  {}
);
assert(
  progressed.renames.length === 1 &&
    progressed.renames[0].cid === "c1" &&
    progressed.renames[0].name === "A" &&
    progressed.bindings[0]?.cid === "c1",
  "a default-named character with progress is adopted"
);

const playedBefore = planIdentities(
  [{ ...localChar("c1", "角色 1"), taskValues: { abyss: 1 } }],
  [1, 2, 3, 4, 5, 6].map((n) => ({ gameId: 1000 + n, name: `G${n}` })),
  {}
);
assert(
  playedBefore.renames.length === 1 &&
    playedBefore.creates.length === 5 &&
    playedBefore.bindings.length === 1 &&
    playedBefore.unmatched.length === 0,
  "a roster with progress is adopted and the other game characters are created"
);

const activeFirst = planIdentities(
  [{ ...localChar("c1", "角色 1"), taskValues: { abyss: 1 } }],
  [{ gameId: 1001, name: "A" }, { gameId: 1005, name: "E" }],
  {},
  1005
);
assert(
  activeFirst.renames.length === 1 && activeFirst.renames[0].name === "E",
  "the active game character takes the character with progress"
);

const deal = [...shopDealsByPinId().values()].find(
  (d) => d.id && d.barterText && d.limitTimes != null
);
assert(!!deal, "the shop data has a resolvable barter pin");
if (deal) {
  const shopRow = {
    task: deal.pinId,
    character: { gameId: 1001, name: "角色A" },
    value: 2,
    kind: "count" as const,
    at: T,
    op: 20154,
    confidence: "observed" as const,
  };
  const offered = applyLinkRows(base({ rows: [shopRow] }));
  assert(offered.writes.length === 0 && offered.offers[0]?.taskId === deal.pinId, "an unpinned shop row is offered");
  const applied = applyLinkRows(base({ rows: [shopRow], barterPins: [deal.pinId] }));
  const write = applied.writes[0];
  assert(write?.taskId === deal.pinId && write.scope === (deal.scopeAccount ? "account" : "character"), "a pinned shop row applies in its deal scope");
}

{
  const sockets: string[] = [];
  const waits: number[] = [];
  const queue: Array<() => void> = [];
  class SilentSocket {
    onopen: (() => void) | null = null;
    onmessage: ((e: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: (() => void) | null = null;
    close(): void {}
    send(): void {}
    constructor(public url: string) {
      sockets.push(url);
      queue.push(() => this.onclose?.());
    }
  }
  const scope = globalThis as unknown as Record<string, unknown>;
  scope.window = {
    setTimeout: (fn: () => void, ms: number) => {
      waits.push(ms);
      queue.push(fn);
      return queue.length;
    },
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
  };
  scope.WebSocket = SilentSocket;

  const phases: string[] = [];
  const client = new LinkClient("", {
    onMessage: () => {},
    onPhase: (phase) => phases.push(phase),
  });
  client.start();
  while (queue.length && sockets.length < 8) queue.shift()?.();
  client.stop();

  assert(sockets.length === 8, `a quiet probe retries until a producer answers (${sockets.length} tries)`);
  assert(
    waits.filter((ms) => ms === 3_000).length === sockets.length,
    "every attempt schedules one stall check"
  );
  const ladder = waits.filter((ms) => ms !== 3_000);
  assert(
    JSON.stringify(ladder) ===
      JSON.stringify([2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000]),
    `the quiet retry ladder backs off to a minute (${JSON.stringify(ladder)})`
  );
  assert(
    !phases.includes("error") && !phases.includes("polling"),
    "a quiet retry stays silent and never polls"
  );
  assert(quietDelay(1) === 2_000 && quietDelay(9) === 60_000, "quietDelay caps at a minute");
}

{
  const timers: Record<number, () => void> = {};
  class SilentSocket {
    onopen: (() => void) | null = null;
    onmessage: ((e: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: (() => void) | null = null;
    readyState = 0;
    close(): void {}
    send(): void {}
  }
  const scope = globalThis as unknown as Record<string, unknown>;
  scope.window = {
    setTimeout: (fn: () => void, ms: number) => {
      timers[ms] = fn;
      return 0;
    },
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
  };
  scope.WebSocket = SilentSocket;
  Object.defineProperty(scope, "navigator", {
    value: { permissions: { query: async () => ({ state: "prompt" }) } },
    configurable: true,
  });

  let seen: string | null = null;
  const client = new LinkClient("", {
    onMessage: () => {},
    onPhase: () => {},
    onPermission: (state) => {
      seen = state;
    },
  });
  client.start();
  timers[3_000]?.();
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  client.stop();

  assert(seen === "prompt", "a stalled socket reports the local network permission");
}

console.log("check-link: all assertions passed");
