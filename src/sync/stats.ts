// Sync quota telemetry (quota §, docs/sync.md). Counts outgoing /api/session
// requests per local day so real device fleets can validate the command
// budget instead of guessing. Approximate server commands per kind
// (rate-limit INCR + work [+ EXPIRE on touch]):
//   meta 2 (INCR + HGET) · get 2 / getTouch 3 · patch 3 / patchTouch 4 ·
//   post 5 (INCR + HGETALL + GET + HSET + EXPIRE) · del 3.
// Read it in DevTools: window.__mabiSyncStats() (wired in main.tsx).

export type SyncStatKind = "meta" | "get" | "getTouch" | "patch" | "patchTouch" | "post" | "del";

export const CMD_COST: Record<SyncStatKind, number> = {
  meta: 2,
  get: 2,
  getTouch: 3,
  patch: 3,
  patchTouch: 4,
  post: 5,
  del: 3,
};

export type DayDoc = Record<SyncStatKind, number>;

const STATS_KEY = "mabiroutine:syncstats";
const KEEP_DAYS = 14;

const KINDS: SyncStatKind[] = ["meta", "get", "getTouch", "patch", "patchTouch", "post", "del"];

function emptyDay(): DayDoc {
  return { meta: 0, get: 0, getTouch: 0, patch: 0, patchTouch: 0, post: 0, del: 0 };
}

function dayKey(d: Date = new Date()): string {
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

type StatsDoc = Record<string, DayDoc>;

function readDoc(): StatsDoc {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = localStorage.getItem(STATS_KEY);
    if (!raw) return {};
    const doc = JSON.parse(raw) as unknown;
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) return {};
    const out: StatsDoc = {};
    for (const [k, v] of Object.entries(doc as Record<string, unknown>)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !v || typeof v !== "object") continue;
      const day = emptyDay();
      for (const kind of KINDS) {
        const n = (v as Record<string, unknown>)[kind];
        day[kind] = typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
      }
      out[k] = day;
    }
    return out;
  } catch {
    return {};
  }
}

export function bumpStat(kind: SyncStatKind, d: Date = new Date()): void {
  try {
    if (typeof localStorage === "undefined") return;
    const doc = readDoc();
    const key = dayKey(d);
    const day = doc[key] ?? emptyDay();
    day[kind] += 1;
    doc[key] = day;
    // Keep the newest KEEP_DAYS (YYYY-MM-DD sorts lexically).
    const keys = Object.keys(doc).sort();
    while (keys.length > KEEP_DAYS) delete doc[keys.shift() as string];
    localStorage.setItem(STATS_KEY, JSON.stringify(doc));
  } catch {
    // telemetry never breaks sync
  }
}

export function estimateCmds(day: DayDoc): number {
  return KINDS.reduce((sum, k) => sum + day[k] * CMD_COST[k], 0);
}

export function readStats(): { days: StatsDoc; estCmdsTotal: number; estCmdsByDay: Record<string, number> } {
  const days = readDoc();
  const estCmdsByDay: Record<string, number> = {};
  let estCmdsTotal = 0;
  for (const [k, v] of Object.entries(days)) {
    estCmdsByDay[k] = estimateCmds(v);
    estCmdsTotal += estCmdsByDay[k];
  }
  return { days, estCmdsTotal, estCmdsByDay };
}

export function statsSummary(): string {
  const { estCmdsByDay } = readStats();
  const keys = Object.keys(estCmdsByDay).sort();
  if (keys.length === 0) return "syncstats: no data yet";
  const last = keys[keys.length - 1];
  const doc = readDoc()[last];
  const parts = KINDS.filter((k) => doc[k] > 0).map((k) => `${k}=${doc[k]}`);
  return `syncstats ${last}: ~${estCmdsByDay[last]} cmds (${parts.join(" ") || "none"}) · 14d total ~${keys.reduce((s, k) => s + estCmdsByDay[k], 0)}`;
}
