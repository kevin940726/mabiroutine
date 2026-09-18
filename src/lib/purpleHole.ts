// 深淵的黑色坑洞 (purple hole) schedule engine — pure functions, no React.
//
// Cycle: 36h15m between spawns. The timer PAUSES during game maintenance,
// so each leg stretches by the maintenance overlapping it:
//   next = prev + PERIOD + overlap(prev, next)
// Phase 1 ships with MAINTENANCE_WINDOWS = [] (unpredictable); the pause
// math is already here so a future window feed just fills the list.
//
// Anchor (observed in-game): 2026-09-16 14:08 Taipei → predicts
// 2026-09-18 02:23. Correct drift by moving the anchor in code until the
// admin feed (phase 2B) publishes it — then the worker's /purple-schedule
// doc wins and the code values below are only the offline fallback
// (see "Schedule feed" near the end of this file).

export const PURPLE_HOLE_ID = "purple-hole";

/** Observed spawn 2026-09-16 14:08 Taipei (= 06:08 UTC); the whole timetable derives from this. */
export const PURPLE_ANCHOR_MS = Date.UTC(2026, 8, 16, 6, 8, 0);

/** 36h15m in ms. */
export const PURPLE_PERIOD_MS = (36 * 60 + 15) * 60 * 1000;

export type MaintenanceWindow = { startMs: number; endMs: number };

/**
 * Taipei wall-clock → UTC ms. Month is 1-based; Taipei is UTC+8 with no DST,
 * so the shift is a constant (hardcoded UTC ms is error-prone — always build
 * entries through this).
 */
export function taipeiWall(y: number, mo: number, d: number, h: number, mi: number): number {
  return Date.UTC(y, mo - 1, d, h - 8, mi, 0);
}

/**
 * Hand-owned maintenance list (phase 2A — same discipline as all TW data):
 * dated entries, verified against the 維護公告 (~1 day before routine),
 * spent entries pruned in the same commit that adds new ones. Same-day
 * emergencies go through a code edit + push like everything else — no
 * in-app override by design (the maintainer's announcement read is the
 * canonical source).
 */
export const MAINTENANCE_WINDOWS: MaintenanceWindow[] = [
  // 2026-09-23 (Wed) routine, PREDICTED — last routine ran 06:00–08:30
  // announced (actually 09:00; extend by editing this entry, not by
  // appending an overlapping one — normalizeWindows merges overlaps, but
  // one truthful entry beats two). VERIFY against the announcement on 9/22;
  // delete after passing. Errs short on purpose: an overstated window skews
  // predictions LATE (miss), an understated one skews EARLY (wait).
  { startMs: taipeiWall(2026, 9, 23, 6, 0), endMs: taipeiWall(2026, 9, 23, 8, 30) },
];

/**
 * Sort + merge overlapping/adjacent windows. Extension reposts overlap the
 * original window (e.g. 06:00–08:30 then 08:00–09:00) — summed raw, the
 * overlap double-counts and legs overshoot. All leg math runs on merged
 * windows; callers must not sum raw lists.
 */
export function normalizeWindows(windows: MaintenanceWindow[]): MaintenanceWindow[] {
  const sorted = [...windows].sort((a, b) => a.startMs - b.startMs);
  const out: MaintenanceWindow[] = [];
  for (const w of sorted) {
    const last = out[out.length - 1];
    if (last && w.startMs <= last.endMs) last.endMs = Math.max(last.endMs, w.endMs);
    else out.push({ startMs: w.startMs, endMs: w.endMs });
  }
  return out;
}

// Active timetable: the code values above until a schedule feed doc applies.
// Every public entry point defaults to this snapshot (anchor AND windows),
// so a feed update shifts badges, popover, and fire times with no caller
// changes; explicit args keep working for probes and tests. The worker
// imports this module too (one math module, two runtimes) — the snapshot
// is per-runtime, and the worker reads KV directly instead of this.
export type PurpleTimetable = { anchorMs: number; windows: MaintenanceWindow[] };

let activeAnchorMs = PURPLE_ANCHOR_MS;
let activeWindows: MaintenanceWindow[] | null = null; // null = MAINTENANCE_WINDOWS

function activeTimetableWindows(): MaintenanceWindow[] {
  return activeWindows ?? MAINTENANCE_WINDOWS;
}

/** Apply a feed (or probe) timetable; null halves keep the current values. */
export function setPurpleTimetable(anchorMs: number | null, windows: MaintenanceWindow[] | null): void {
  if (typeof anchorMs === "number" && Number.isFinite(anchorMs)) activeAnchorMs = anchorMs;
  if (windows) {
    activeWindows = normalizeWindows(
      windows.filter(
        (w) =>
          w &&
          typeof w.startMs === "number" &&
          typeof w.endMs === "number" &&
          Number.isFinite(w.startMs) &&
          Number.isFinite(w.endMs) &&
          w.startMs < w.endMs
      )
    );
  }
}

export function currentPurpleTimetable(): PurpleTimetable {
  return { anchorMs: activeAnchorMs, windows: activeTimetableWindows() };
}

export function resetPurpleTimetable(): void {
  activeAnchorMs = PURPLE_ANCHOR_MS;
  activeWindows = null;
}

function totalOverlap(aMs: number, bMs: number, windows: MaintenanceWindow[]): number {
  let total = 0;
  for (const w of windows) {
    total += Math.max(0, Math.min(bMs, w.endMs) - Math.max(aMs, w.startMs));
  }
  return total;
}

/** Forward leg: occurrence after `fromMs`, stretched by overlapping maintenance. */
export function nextAfter(fromMs: number, windows: MaintenanceWindow[] = MAINTENANCE_WINDOWS): number {
  // Merged: each extension pulls the end into at most the next window, so
  // the fixed point converges in ≤ windows+1 steps; 8 caps pathological
  // input instead of looping.
  const ws = normalizeWindows(windows);
  let end = fromMs + PURPLE_PERIOD_MS;
  for (let i = 0; i < 8; i++) {
    const stretched = fromMs + PURPLE_PERIOD_MS + totalOverlap(fromMs, end, ws);
    if (stretched === end) return end;
    end = stretched;
  }
  return end;
}

/** Backward leg: occurrence before `toMs` (inverse of nextAfter). */
export function prevBefore(toMs: number, windows: MaintenanceWindow[] = MAINTENANCE_WINDOWS): number {
  const ws = normalizeWindows(windows);
  let p = toMs - PURPLE_PERIOD_MS;
  for (let i = 0; i < 8; i++) {
    const corrected = toMs - PURPLE_PERIOD_MS - totalOverlap(p, toMs, ws);
    if (corrected === p) return p;
    p = corrected;
  }
  return p;
}

/** nth occurrence relative to the anchor (0 = anchor, negative = past). */
export function nthOccurrence(
  n: number,
  windows: MaintenanceWindow[] = activeTimetableWindows(),
  anchorMs: number = activeAnchorMs
): number {
  if (n === 0) return anchorMs;
  if (n > 0) {
    let t = anchorMs;
    for (let k = 0; k < n; k++) t = nextAfter(t, windows);
    return t;
  }
  let t = anchorMs;
  for (let k = 0; k < -n; k++) t = prevBefore(t, windows);
  return t;
}

/** Index of the first occurrence strictly after `nowMs`. */
export function firstIndexAfter(
  nowMs: number,
  windows: MaintenanceWindow[] = activeTimetableWindows(),
  anchorMs: number = activeAnchorMs
): number {
  // Estimate ignoring maintenance, then walk to the truth (maintenance only
  // shifts forward, so the estimate is never ahead by more than the windows).
  let k = Math.floor((nowMs - anchorMs) / PURPLE_PERIOD_MS);
  while (nthOccurrence(k + 1, windows, anchorMs) <= nowMs) k++;
  while (nthOccurrence(k, windows, anchorMs) > nowMs) k--;
  return k + 1;
}

/** Past `past` + next `future` occurrences around now (ascending). */
export function occurrencesAround(
  nowMs: number = Date.now(),
  past = 2,
  future = 3,
  windows: MaintenanceWindow[] = activeTimetableWindows(),
  anchorMs: number = activeAnchorMs
): number[] {
  const first = firstIndexAfter(nowMs, windows, anchorMs);
  const out: number[] = [];
  for (let k = first - past; k < first + future; k++) out.push(nthOccurrence(k, windows, anchorMs));
  return out;
}

/** Start (inclusive) of the current daily bucket (06:00→06:00 Taipei). */
export function dailyBucketStartMs(nowMs: number = Date.now()): number {
  // Taipei is UTC+8, no DST: bucket boundaries are 22:00 UTC of the prior day.
  const dayMs = 24 * 60 * 60 * 1000;
  const shifted = nowMs + 8 * 60 * 60 * 1000 - 6 * 60 * 60 * 1000;
  const bucketDay = Math.floor(shifted / dayMs);
  return bucketDay * dayMs - (8 - 6) * 60 * 60 * 1000;
}

/** True when at least one occurrence falls in the current daily bucket. */
export function isScheduledToday(
  nowMs: number = Date.now(),
  windows: MaintenanceWindow[] = activeTimetableWindows(),
  anchorMs: number = activeAnchorMs
): boolean {
  return bucketOccurrence(nowMs, windows, anchorMs) !== null;
}

/**
 * The occurrence inside the current daily bucket, if any. At most one: the
 * 36h15m period exceeds the 24h bucket, so two can never share it.
 */
export function bucketOccurrence(
  nowMs: number = Date.now(),
  windows: MaintenanceWindow[] = activeTimetableWindows(),
  anchorMs: number = activeAnchorMs
): number | null {
  const start = dailyBucketStartMs(nowMs);
  const end = start + 24 * 60 * 60 * 1000;
  const first = firstIndexAfter(start - PURPLE_PERIOD_MS * 2, windows, anchorMs);
  for (let k = first; ; k++) {
    const t = nthOccurrence(k, windows, anchorMs);
    if (t >= end) return null;
    if (t >= start) return t;
  }
}

/** First occurrence strictly after now. */
export function nextOccurrence(
  nowMs: number = Date.now(),
  windows: MaintenanceWindow[] = activeTimetableWindows(),
  anchorMs: number = activeAnchorMs
): number {
  return nthOccurrence(firstIndexAfter(nowMs, windows, anchorMs), windows, anchorMs);
}



/**
 * How long after a spawn the badge still shows it alone ("happening now").
 * Past this, the spawn is history and the badge points forward instead.
 */
export const SPAWN_FRESH_MS = 15 * 60 * 1000;

/**
 * Row badges, or null off-days. Fresh spawn (upcoming or within
 * SPAWN_FRESH_MS): a single badge for it. Stale: both past and next, so
 * the row renders two badges. One call for render sites (keeps Date.now
 * out of JSX).
 */
export type PurpleBadge = { past: string | null; next: string | null };
export function purpleBadge(
  nowMs: number = Date.now(),
  windows: MaintenanceWindow[] = activeTimetableWindows(),
  anchorMs: number = activeAnchorMs
): PurpleBadge | null {
  const t = bucketOccurrence(nowMs, windows, anchorMs);
  if (t === null) return null;
  // Absolute "MM/DD HH:mm": relative words (昨日/明日) lie to late-night
  // players sitting on the wrong side of midnight from the 06:00 bucket.
  if (t > nowMs) return { past: null, next: formatTaipei(t) };
  if (t > nowMs - SPAWN_FRESH_MS) return { past: formatTaipei(t), next: null };
  return { past: formatTaipei(t), next: formatTaipei(nextOccurrence(nowMs, windows, anchorMs)) };
}

/**
 * Live badge state in ms (render sites derive countdown text from `nowMs`,
 * so a ticking clock re-renders text without recomputing the timetable).
 * Null off-days. Upcoming = spawn in the future, live = within
 * SPAWN_FRESH_MS after the spawn, stale = older (past + next pair).
 */
export type PurpleLive =
  | { kind: "upcoming"; nextMs: number }
  | { kind: "live"; endsMs: number }
  | { kind: "stale"; pastMs: number; nextMs: number };
export function purpleLive(
  nowMs: number = Date.now(),
  windows: MaintenanceWindow[] = activeTimetableWindows(),
  anchorMs: number = activeAnchorMs
): PurpleLive | null {
  const t = bucketOccurrence(nowMs, windows, anchorMs);
  if (t === null) return null;
  if (t > nowMs) return { kind: "upcoming", nextMs: t };
  if (t > nowMs - SPAWN_FRESH_MS) return { kind: "live", endsMs: t + SPAWN_FRESH_MS };
  return { kind: "stale", pastMs: t, nextMs: nextOccurrence(nowMs, windows, anchorMs) };
}

/** "09-18 02:23"-style label for the next upcoming spawn (off-day note). */
export function nextBadgeLabel(
  nowMs: number = Date.now(),
  windows: MaintenanceWindow[] = activeTimetableWindows(),
  anchorMs: number = activeAnchorMs
): string {
  return formatTaipei(nextOccurrence(nowMs, windows, anchorMs));
}

/** "MM/DD HH:mm" in Taipei. */
export function formatTaipei(ms: number): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    // hour12:false alone can render midnight as "24:xx" in Chrome/ICU —
    // h23 pins it to 00:xx (review catch).
    hourCycle: "h23",
  });
  const parts = fmt.formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("month")}/${get("day")} ${get("hour")}:${get("minute")}`;
}

// Notification lane: fire 15 minutes before the predicted spawn, one
// collapsed card per spawn. Catch-up is automatic (opened after the fire
// time but while the spawn is still future fires ~immediately); no silence
// cutoff is needed — the card stays truthful until the spawn passes, and
// nextOccurrence is always strictly future so every fire re-arms forward.

/** Lead time before the predicted spawn. */
export const PURPLE_LEAD_MS = 15 * 60 * 1000;

/** Collapse key: separate tag from the hourly lane — one card per spawn, replaced, never stacked with barrier cards. */
export const PURPLE_TAG = "mabi-purple";

/** Ms until this spawn's fire (catch-up: ~immediately when already due). */
export function msUntilPurpleFire(nowMs: number = Date.now()): number {
  const fireAt = nextOccurrence(nowMs) - PURPLE_LEAD_MS;
  return Math.max(1_000, fireAt - nowMs);
}

/**
 * Ms until the NEXT spawn's fire, strictly skipping the current one. Re-arm
 * here after firing: msUntilPurpleFire would catch-up refire every second
 * until the spawn passes.
 */
export function msUntilNextPurpleFire(nowMs: number = Date.now()): number {
  return Math.max(1_000, nthOccurrence(firstIndexAfter(nowMs) + 1) - PURPLE_LEAD_MS - nowMs);
}

// Experimental gate: the 實驗性功能 dialog flips this per device; the row,
// timetable, bell, and scheduler all hide when off. Mirrors the push gate,
// separate slot.
const PURPLE_FLAG_KEY = "mabiroutine:purple-hole-flag";
/** Experimental-settings write end (the dialog's only writer). */
export function setPurpleHoleFlag(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(PURPLE_FLAG_KEY, "1");
    else window.localStorage.removeItem(PURPLE_FLAG_KEY);
  } catch {
    // storage blocked: the toggle just won't stick — no crash.
  }
}
export function isPurpleHoleEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(PURPLE_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

// Schedule feed (phase 2B): the worker's /purple-schedule doc (KV-backed,
// maintainer-published) wins over the hardcoded timetable above. Chain:
// live fetch > localStorage cache > hardcoded. A failed fetch keeps the
// cache (or hardcoded); an empty-windows doc is a real "no maintenance",
// distinguishable from "unknown" via updatedAt (null = never published).
// The worker imports this module for parseScheduleDoc (one module, two
// runtimes) but reads KV directly — it never calls the browser half below.

/** Worker endpoint serving the published doc (public, CORS *, 60s cache). */
export const PURPLE_SCHEDULE_URL =
  "https://mabiroutine-worker.kaihao.workers.dev/purple-schedule";

const FEED_CACHE_KEY = "mabiroutine:purple-schedule";

export type PurpleScheduleDoc = {
  anchorMs: number;
  windows: MaintenanceWindow[];
  updatedAt: number | null;
  updatedBy: string | null;
};

/**
 * Strict schedule-doc parse, both runtimes: anchor must be a finite number
 * and EVERY window entry must be finite with start < end — one fat-fingered
 * dashboard entry rejects the whole doc instead of half-applying it, and the
 * caller falls back to cache/hardcoded. Returns the doc normalized (sorted +
 * merged), or null.
 */
export function parseScheduleDoc(v: unknown): PurpleScheduleDoc | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const d = v as Record<string, unknown>;
  if (typeof d.anchorMs !== "number" || !Number.isFinite(d.anchorMs)) return null;
  if (!Array.isArray(d.windows) || d.windows.length > 64) return null;
  const windows: MaintenanceWindow[] = [];
  for (const e of d.windows) {
    if (!e || typeof e !== "object") return null;
    const { startMs, endMs } = e as Record<string, unknown>;
    if (typeof startMs !== "number" || typeof endMs !== "number") return null;
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || !(startMs < endMs)) return null;
    windows.push({ startMs, endMs });
  }
  const updatedAt =
    typeof d.updatedAt === "number" && Number.isFinite(d.updatedAt) ? d.updatedAt : null;
  const updatedBy = typeof d.updatedBy === "string" ? d.updatedBy.slice(0, 32) : null;
  return { anchorMs: d.anchorMs, windows: normalizeWindows(windows), updatedAt, updatedBy };
}

export type PurpleFeedSource = "live" | "cache" | "hardcoded";
export type PurpleFeedStatus = {
  source: PurpleFeedSource;
  updatedAt: number | null;
  fetchedAtMs: number | null;
};

let feedStatus: PurpleFeedStatus = { source: "hardcoded", updatedAt: null, fetchedAtMs: null };
let feedVersion = 0;
const feedListeners = new Set<() => void>();

/** Feed-change generation (consumers re-arm/re-render on change only). */
export function purpleFeedVersion(): number {
  return feedVersion;
}

export function purpleFeedStatus(): PurpleFeedStatus {
  return feedStatus;
}

/** Subscribe to feed changes; returns the unsubscriber. */
export function subscribePurpleFeed(fn: () => void): () => void {
  feedListeners.add(fn);
  return () => {
    feedListeners.delete(fn);
  };
}

function applyFeedDoc(doc: PurpleScheduleDoc, source: "live" | "cache"): boolean {
  const cur = currentPurpleTimetable();
  const same =
    cur.anchorMs === doc.anchorMs &&
    JSON.stringify(normalizeWindows(cur.windows)) === JSON.stringify(doc.windows);
  setPurpleTimetable(doc.anchorMs, doc.windows);
  feedStatus = { source, updatedAt: doc.updatedAt, fetchedAtMs: Date.now() };
  if (!same) {
    feedVersion++;
    for (const fn of [...feedListeners]) {
      try {
        fn();
      } catch {
        // a listener must never break the feed for the others.
      }
    }
  }
  return !same;
}

/**
 * Boot entry: apply the cache synchronously (no network wait), then refresh
 * in the background. Consumers already re-render on their own ticks; the
 * reminder hook re-arms via subscribePurpleFeed. Resolves — never rejects.
 */
export function initPurpleFeed(): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(FEED_CACHE_KEY);
    if (raw) {
      const cached = parseScheduleDoc((JSON.parse(raw) as { doc?: unknown })?.doc);
      if (cached) applyFeedDoc(cached, "cache");
    }
  } catch {
    // no (or corrupt) cache: hardcoded stands until the refresh lands.
  }
  void refreshPurpleFeed().catch(() => {
    // offline / worker down: cache-or-hardcoded stands, status says so.
  });
}

/**
 * Fetch-apply-cache one round. Throws on network or shape failure so the
 * caller (or DevTools) can tell "failed" from "stale-but-usable".
 */
export async function refreshPurpleFeed(): Promise<PurpleFeedStatus> {
  const res = await fetch(PURPLE_SCHEDULE_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`schedule ${res.status}`);
  const doc = parseScheduleDoc(await res.json());
  if (!doc) throw new Error("schedule bad shape");
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(
        FEED_CACHE_KEY,
        JSON.stringify({ doc, fetchedAtMs: Date.now() })
      );
    } catch {
      // storage blocked: this session still uses the live doc.
    }
  }
  applyFeedDoc(doc, "live");
  return purpleFeedStatus();
}
