// Quota telemetry + idle-pause unit gate (hermetic, no network).
// Real stats.ts/session.ts activity+beacon code, stubbed storage.
//
// Teeth: the budget in docs/sync.md is only as honest as this counter, and
// the repoll gate only fires when isIdle() says active. A broken bump (wrong
// kind, lost day, unpruned growth) or a broken idle window (repoll running
// while the user is away, or starved while present) silently voids the quota
// model — these fixtures pin both.
import {
  bumpStat,
  readStats,
  estimateCmds,
  statsSummary,
  CMD_COST,
  type DayDoc,
} from "@/sync/stats";
import { shouldTouch, markActivity, lastActivity, isIdle, IDLE_MS } from "@/sync/session";

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
  clear(): void {
    this.m.clear();
  }
}

const ls = new MemStorage();
Object.defineProperty(globalThis, "localStorage", { value: ls, configurable: true, writable: true });

let failures = 0;
function ok(name: string, cond: boolean, extra?: unknown): void {
  if (!cond) {
    failures += 1;
    console.log(`FAIL: ${name}`, extra === undefined ? "" : JSON.stringify(extra).slice(0, 300));
  } else {
    console.log(`ok: ${name}`);
  }
}

const D = (isoDay: string): Date => new Date(`${isoDay}T12:00:00`);
const dayDoc = (): DayDoc => ({ meta: 0, get: 0, getTouch: 0, patch: 0, patchTouch: 0, post: 0, del: 0 });

// Q1: bumps count per kind and the command estimate matches the server model
// (INCR + work [+ EXPIRE on touch]).
{
  ls.clear();
  bumpStat("meta", D("2026-09-01"));
  bumpStat("meta", D("2026-09-01"));
  bumpStat("getTouch", D("2026-09-01"));
  bumpStat("patch", D("2026-09-01"));
  const { days, estCmdsTotal, estCmdsByDay } = readStats();
  ok("Q1 kinds counted", days["2026-09-01"]?.meta === 2 && days["2026-09-01"]?.getTouch === 1, days["2026-09-01"]);
  const expect = 2 * CMD_COST.meta + CMD_COST.getTouch + CMD_COST.patch;
  ok("Q1 estimate matches cost model", estCmdsTotal === expect && estCmdsByDay["2026-09-01"] === expect, { estCmdsTotal, expect });
  ok("Q1 model costs sane", CMD_COST.meta === 2 && CMD_COST.getTouch === 3 && CMD_COST.patchTouch === 4 && CMD_COST.post === 5, CMD_COST);
}

// Q2: corrupt stored doc never breaks counting (telemetry can't break sync).
{
  ls.clear();
  ls.setItem("mabiroutine:syncstats", "{not json");
  bumpStat("get", D("2026-09-02"));
  ok("Q2 corrupt doc recovers", readStats().days["2026-09-02"]?.get === 1, ls.getItem("mabiroutine:syncstats"));
  ls.setItem("mabiroutine:syncstats", JSON.stringify({ "2026-09-02": { meta: "x", get: -3, bogus: 9 } }));
  const days = readStats().days;
  ok("Q2 bad values sanitize to zero", days["2026-09-02"]?.meta === 0 && days["2026-09-02"]?.get === 0, days["2026-09-02"]);
  ok("Q2 estimate ignores garbage", estimateCmds(days["2026-09-02"] ?? dayDoc()) === 0, days["2026-09-02"]);
}

// Q3: day rollover + 14-day prune bound the key.
{
  ls.clear();
  for (let i = 1; i <= 20; i += 1) bumpStat("meta", D(`2026-08-${`${i}`.padStart(2, "0")}`));
  const days = readStats().days;
  const keys = Object.keys(days).sort();
  ok("Q3 keeps newest 14 days", keys.length === 14 && keys[0] === "2026-08-07" && keys[13] === "2026-08-20", keys);
  ok("Q3 summary names the latest day", statsSummary().includes("2026-08-20"), statsSummary());
}

// Q4: touch beacon fires at most once/day per session (the EXPIRE saver).
{
  ls.clear();
  const A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
  const B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
  ok("Q4 first touch true", shouldTouch(A) === true, null);
  ok("Q4 same-day repeat false", shouldTouch(A) === false, null);
  ok("Q4 other session true", shouldTouch(B) === true, null);
  // Backdate the beacon past 24h → fires again.
  ls.setItem("mabiroutine:touch", JSON.stringify({ id: A, at: Date.now() - 25 * 3600 * 1000 }));
  ok("Q4 next-day refires", shouldTouch(A) === true, null);
  ls.setItem("mabiroutine:touch", "{broken");
  ok("Q4 corrupt beacon fails open (correctness first)", shouldTouch(A) === true, null);
}

// Q5: idle window — repoll runs while recently active, pauses after 15min.
{
  ok("Q5 window is 15min", IDLE_MS === 15 * 60 * 1000, IDLE_MS);
  markActivity(1_000_000);
  ok("Q5 active inside window", isIdle(1_000_000 + IDLE_MS - 1) === false, null);
  ok("Q5 idle at boundary", isIdle(1_000_000 + IDLE_MS) === true, null);
  ok("Q5 activity re-arms", (markActivity(2_000_000), isIdle(2_000_000 + 1) === false), null);
  markActivity();
  const gap = Date.now() - lastActivity();
  ok("Q5 default marks now", gap >= 0 && gap < 5000, gap);
}

console.log(failures === 0 ? "ALL QUOTA CHECKS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
