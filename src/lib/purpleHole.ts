// 深淵的黑色坑洞 (purple hole) schedule engine — pure functions, no React.
//
// Cycle: 36h15m between spawns. No observation shows maintenance affecting the
// cycle (the pause read was falsified 2026-09-30 — see docs/purple-hole.md), so
// the model dropped the pause (2026-10-07) and the grid is a plain fixed step:
//   next = prev + PERIOD
// Maintenance windows are used only to stand cards down (`isInMaintenance`);
// they are not fed into the grid.
//
// Two rays (2026-10-14): the anchor is the RECORD — the last spawn actually
// observed — while a forward correction lives in its own `nextMs` slot
// (nextMs, nextMs+PERIOD, …). Correcting the next spawn must never rewrite the
// recorded past, so `nextMs` never moves the anchor; only an explicit
// re-anchor (a new observation) does, and `prevMs` carries the recorded spawn
// before the anchor so the row behind it stays exact across a phase seam
// (a recorded pair is not always PERIOD apart, e.g. the 22h29m 10-13→10-14
// seam). The record ray is the anchor, then `prevMs` and its backward steps;
// with neither correction nor prevMs the whole thing degenerates to the old
// single lattice (a doc with a pre-rule anchor in the future, as published on
// 2026-10-14, keeps the old behavior exactly).
//
// A correction that is already past and not yet absorbed into the record would
// take its passed spawns out of the past, so publishing one is refused until
// the record covers it (correctionSupersedeError; the maintainer's choice of
// 2026-10-14: refuse and record first, never fold silently).
//
// Anchor: the lattice reference (the last recorded spawn). The
// /purple-schedule feed owns it; the code value below is only the
// empty-KV/offline fallback (see "Schedule feed" near the end of this file).

export const PURPLE_HOLE_ID = "purple-hole";

/** Last observed spawn 2026-09-30 17:44:35 Taipei (= 09:44:35 UTC); the whole timetable derives from this. */
export const PURPLE_ANCHOR_MS = Date.UTC(2026, 8, 30, 9, 44, 35);

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
 * spent entries pruned in the same commit that adds new ones. These windows
 * are not fed into the schedule (pause model dropped 2026-10-07): they only
 * stand cards down while the game is down. The feed owns the full verified
 * list and the app/worker prefer it; this dated entry is only the
 * empty-KV/offline suppression baseline. Same-day emergencies go through a
 * code edit + push like everything else — no in-app override by design (the
 * maintainer's announcement read is the canonical source).
 */
export const MAINTENANCE_WINDOWS: MaintenanceWindow[] = [
  // 2026-09-30 (Wed) routine, mirrored from the watcher feed (KV
  // `purple:schedule`, updatedBy "watcher"): 06:00–10:00 Taipei, a 4h window,
  // longer than the usual 2.5–3h.
  { startMs: taipeiWall(2026, 9, 30, 6, 0), endMs: taipeiWall(2026, 9, 30, 10, 0) },
];

/**
 * Sort + merge overlapping/adjacent windows. Extension reposts overlap the
 * original window (e.g. 06:00–08:30 then 08:00–09:00) — summed raw, the
 * overlap double-counts. All suppression runs on merged windows; callers must
 * not sum raw lists.
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

/**
 * True while the game is inside a maintenance window (half-open [start, end)).
 * Both notification lanes stand down on this: a card fired while the game is
 * down names a spawn that cannot happen. It is not fed into the schedule: the
 * grid is computed without the windows (pause model dropped 2026-10-07).
 * Suppression is only as good as the window list — unknown maintenance still
 * notifies.
 */
export function isInMaintenance(
  nowMs: number,
  windows: MaintenanceWindow[] = activeTimetableWindows()
): boolean {
  for (const w of normalizeWindows(windows)) {
    if (nowMs >= w.startMs && nowMs < w.endMs) return true;
    if (w.startMs > nowMs) break;
  }
  return false;
}

// Active timetable: the code values above until a schedule feed doc applies.
// Every schedule entry point defaults to this snapshot's anchor, and
// `isInMaintenance` defaults to its windows, so a feed update moves the grid
// and the suppression list with no caller changes; explicit args keep working
// for probes and tests. The worker imports this module too (one math module,
// two runtimes) — the snapshot is per-runtime, and the worker reads KV
// directly instead of this.
export type PurpleTimetable = {
  anchorMs: number;
  prevMs: number | null;
  nextMs: number | null;
  windows: MaintenanceWindow[];
};

let activeAnchorMs = PURPLE_ANCHOR_MS;
let activePrevMs: number | null = null;
let activeNextMs: number | null = null;
let activeWindows: MaintenanceWindow[] | null = null; // null = MAINTENANCE_WINDOWS

function activeTimetableWindows(): MaintenanceWindow[] {
  return activeWindows ?? MAINTENANCE_WINDOWS;
}

/**
 * Apply a feed (or probe) timetable; null halves keep the current values.
 * `nextMs` / `prevMs` are written directly when given (undefined = keep), so
 * a doc without a correction can clear a stale one.
 */
export function setPurpleTimetable(
  anchorMs: number | null,
  windows: MaintenanceWindow[] | null,
  nextMs?: number | null,
  prevMs?: number | null
): void {
  if (typeof anchorMs === "number" && Number.isFinite(anchorMs)) activeAnchorMs = anchorMs;
  if (nextMs !== undefined) {
    activeNextMs = typeof nextMs === "number" && Number.isFinite(nextMs) ? nextMs : null;
  }
  if (prevMs !== undefined) {
    activePrevMs = typeof prevMs === "number" && Number.isFinite(prevMs) ? prevMs : null;
  }
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
  return {
    anchorMs: activeAnchorMs,
    prevMs: activePrevMs,
    nextMs: activeNextMs,
    windows: activeTimetableWindows(),
  };
}

export function resetPurpleTimetable(): void {
  activeAnchorMs = PURPLE_ANCHOR_MS;
  activePrevMs = null;
  activeNextMs = null;
  activeWindows = null;
}

/** nth occurrence relative to the anchor (0 = anchor, negative = past). */
export function nthOccurrence(n: number, anchorMs: number = activeAnchorMs): number {
  return anchorMs + n * PURPLE_PERIOD_MS;
}

/** Index of the first occurrence strictly after `nowMs` (no-correction lattice). */
export function firstIndexAfter(nowMs: number, anchorMs: number = activeAnchorMs): number {
  return Math.floor((nowMs - anchorMs) / PURPLE_PERIOD_MS) + 1;
}

/**
 * First occurrence strictly after `nowMs`. With a correction set, the next
 * spawn is the correction's first item after now: a correction replaces the
 * lattice's forward half, leaving the recorded past alone.
 */
export function nextOccurrence(
  nowMs: number = Date.now(),
  anchorMs: number = activeAnchorMs,
  nextMs: number | null = activeNextMs
): number {
  if (nextMs !== null) {
    const k = Math.max(0, Math.floor((nowMs - nextMs) / PURPLE_PERIOD_MS) + 1);
    return nextMs + k * PURPLE_PERIOD_MS;
  }
  return nthOccurrence(firstIndexAfter(nowMs, anchorMs), anchorMs);
}

/**
 * The occurrence at or before `nowMs`; `back` walks that many steps earlier.
 * Steps go through `prevAtOrBefore` so they cross the record/correction seam
 * correctly (the item before a correction is the record's last item, not that
 * item minus PERIOD).
 */
export function prevOccurrence(
  nowMs: number = Date.now(),
  back = 0,
  anchorMs: number = activeAnchorMs,
  nextMs: number | null = activeNextMs,
  prevMs: number | null = activePrevMs
): number {
  let t = prevAtOrBefore(nowMs, anchorMs, nextMs, prevMs);
  for (let i = 0; i < back; i++) t = prevAtOrBefore(t - 1, anchorMs, nextMs, prevMs);
  return t;
}

function prevAtOrBefore(
  nowMs: number,
  anchorMs: number,
  nextMs: number | null,
  prevMs: number | null
): number {
  let best = recordItemAtOrBefore(nowMs, anchorMs, nextMs, prevMs);
  // The correction ray covers nextMs and later; a passed correction stays in
  // the past (it happened) while the record ray feeds everything before it.
  if (nextMs !== null && nowMs >= nextMs) {
    best = Math.max(
      best,
      nextMs + Math.floor((nowMs - nextMs) / PURPLE_PERIOD_MS) * PURPLE_PERIOD_MS
    );
  }
  return best;
}

/**
 * The record ray at/before `nowMs`: the anchor's lattice (or just the anchor
 * when a correction owns the forward half), and below the anchor the recorded
 * `prevMs` and its own backward steps. `prevMs` never lets the derived
 * anchor−PERIOD through when the recorded pair is not PERIOD apart (the seam).
 */
function recordItemAtOrBefore(
  nowMs: number,
  anchorMs: number,
  nextMs: number | null,
  prevMs: number | null
): number {
  const k = Math.floor((nowMs - anchorMs) / PURPLE_PERIOD_MS);
  if (nowMs >= anchorMs || prevMs === null) {
    // Forward leg. No correction: the plain lattice (k goes negative for a
    // pre-rule anchor in the future). With one: the record ends at the
    // anchor, because the correction ray is ahead.
    return anchorMs + (nextMs === null ? k : Math.min(0, k)) * PURPLE_PERIOD_MS;
  }
  return prevMs + Math.floor((nowMs - prevMs) / PURPLE_PERIOD_MS) * PURPLE_PERIOD_MS;
}

/** Past `past` + next `future` occurrences around now (ascending). */
export function occurrencesAround(
  nowMs: number = Date.now(),
  past = 2,
  future = 3,
  anchorMs: number = activeAnchorMs,
  nextMs: number | null = activeNextMs,
  prevMs: number | null = activePrevMs
): number[] {
  const back: number[] = [];
  let t = prevOccurrence(nowMs, 0, anchorMs, nextMs, prevMs);
  for (let i = 0; i < past; i++) {
    back.push(t);
    t = prevOccurrence(t - 1, 0, anchorMs, nextMs, prevMs);
  }
  const out = back.reverse();
  t = nextOccurrence(nowMs, anchorMs, nextMs);
  for (let i = 0; i < future; i++) {
    out.push(t);
    t = nextOccurrence(t, anchorMs, nextMs);
  }
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
  anchorMs: number = activeAnchorMs,
  nextMs: number | null = activeNextMs,
  prevMs: number | null = activePrevMs
): boolean {
  return bucketOccurrence(nowMs, anchorMs, nextMs, prevMs) !== null;
}

/**
 * The occurrence inside the current daily bucket, if any. Without a
 * correction at most one can land in a 24h bucket (the 36h15m period exceeds
 * it); with one, two can share a bucket — prefer the spawn at/before now,
 * else the next one in the bucket.
 */
export function bucketOccurrence(
  nowMs: number = Date.now(),
  anchorMs: number = activeAnchorMs,
  nextMs: number | null = activeNextMs,
  prevMs: number | null = activePrevMs
): number | null {
  const start = dailyBucketStartMs(nowMs);
  const prev = prevOccurrence(nowMs, 0, anchorMs, nextMs, prevMs);
  if (prev >= start) return prev;
  const next = nextOccurrence(nowMs, anchorMs, nextMs);
  return next < start + 24 * 60 * 60 * 1000 ? next : null;
}

/**
 * Publish guard (the maintainer's 2026-10-14 choice: refuse and record, never
 * fold): a correction that has already passed must be absorbed into the record
 * before it is dropped or moved, or its spawns would disappear from the past.
 * Returns a message for the caller to reject with, or null when the publish is
 * allowed (an unchanged `nextMs`, a future correction, an anchor that covers
 * the latest passed spawn, or `discardPassed`). The auto paths carry `nextMs`
 * through unchanged and pass.
 *
 * `discardPassed` is the one bypass, for the case the guard cannot know: the
 * maintainer asserts the passed correction never happened, so there is nothing
 * to record and its rows are dropped. Explicit only (CLI `forget` / the admin
 * page's 放棄 checkbox); never set on the auto paths.
 */
export function correctionSupersedeError(
  stored: { anchorMs: number; nextMs: number | null } | null | undefined,
  incoming: { anchorMs: number; nextMs: number | null },
  nowMs: number = Date.now(),
  discardPassed = false
): string | null {
  if (discardPassed) return null;
  const prevNext = stored?.nextMs ?? null;
  if (prevNext === null || incoming.nextMs === prevNext || prevNext > nowMs) return null;
  const latest = latestSpawnAtOrBefore(prevNext, nowMs);
  if (incoming.anchorMs >= latest) return null;
  // Seconds matter here: the value is copied into `anchorMs`, and a minute-
  // truncated reading of it would fail this same check.
  return (
    `the stored correction (nextMs ${formatTaipeiSec(prevNext)}) has already passed; ` +
    `record its latest spawn first — set anchorMs to ${formatTaipeiSec(latest)} or later ` +
    `(the skill's \`anchor\` clears the caught-up correction), or drop it with \`forget\` ` +
    `if it never happened`
  );
}

/** "MM/DD HH:mm:ss" in Taipei (guard messages only; the timetable is minute-grained). */
function formatTaipeiSec(ms: number): string {
  const s = String(new Date(ms + 8 * 3600e3).getUTCSeconds()).padStart(2, "0");
  return `${formatTaipei(ms)}:${s}`;
}

/** The correction's last spawn at/before `nowMs` — the one a record must cover to absorb it. */
export function latestSpawnAtOrBefore(nextMs: number, nowMs: number): number {
  return nextMs + Math.floor((nowMs - nextMs) / PURPLE_PERIOD_MS) * PURPLE_PERIOD_MS;
}

export type PurpleHistoryEntry = {
  /** `anchor` = a spawn recorded as observed, `next` = a correction, `forget` = a correction dropped as never-happened. */
  kind: "anchor" | "next" | "forget";
  /** The spawn/correction this entry is about. */
  at: string;
  /** `anchor` only: the spawn recorded before it (`prevMs`), when the doc carried one. */
  prev?: string;
  /** When the publish that wrote the entry landed — `at` can be days earlier (a late record). */
  logged: string;
};

type PurpleRecord = Pick<PurpleScheduleDoc, "anchorMs" | "prevMs" | "nextMs">;

/** ISO-8601 Taipei wall clock with an explicit offset, seconds kept ("2026-10-20T15:10:09+08:00"). */
export function formatTaipeiIso(ms: number): string {
  return new Date(ms + 8 * 3600e3).toISOString().replace(/\.\d{3}Z$/, "+08:00");
}

export function scheduleHistoryEntries(
  before: PurpleRecord,
  after: PurpleRecord,
  nowMs: number = Date.now()
): PurpleHistoryEntry[] {
  const out: PurpleHistoryEntry[] = [];
  const logged = formatTaipeiIso(nowMs);
  const recordMoved = after.anchorMs !== before.anchorMs || after.prevMs !== before.prevMs;
  if (recordMoved) {
    out.push({
      kind: "anchor",
      at: formatTaipeiIso(after.anchorMs),
      ...(after.prevMs === null ? {} : { prev: formatTaipeiIso(after.prevMs) }),
      logged,
    });
  }
  if (after.nextMs !== before.nextMs && after.nextMs !== null) {
    out.push({ kind: "next", at: formatTaipeiIso(after.nextMs), logged });
  }
  const prevNext = before.nextMs;
  if (
    prevNext !== null &&
    after.nextMs === null &&
    !absorbedByRecord(prevNext, after.anchorMs, nowMs)
  ) {
    out.push({ kind: "forget", at: formatTaipeiIso(prevNext), logged });
  }
  return out;
}

function absorbedByRecord(prevNext: number, anchorMs: number, nowMs: number): boolean {
  return prevNext <= nowMs && anchorMs >= latestSpawnAtOrBefore(prevNext, nowMs);
}

/** Stored log → entries; null when the value is not one, so a writer can refuse to overwrite it. */
export function parseHistoryDoc(raw: unknown): PurpleHistoryEntry[] | null {
  if (raw === null || raw === undefined) return [];
  const entries = (raw as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) return null;
  return entries.filter(isHistoryEntry);
}

const ISO_TAIPEI_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/;
const isIsoTaipei = (v: unknown): boolean => typeof v === "string" && ISO_TAIPEI_RE.test(v);

function isHistoryEntry(v: unknown): v is PurpleHistoryEntry {
  if (!v || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  return (
    (e.kind === "anchor" || e.kind === "next" || e.kind === "forget") &&
    isIsoTaipei(e.at) &&
    isIsoTaipei(e.logged) &&
    (e.prev === undefined || isIsoTaipei(e.prev))
  );
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
  anchorMs: number = activeAnchorMs,
  nextMs: number | null = activeNextMs,
  prevMs: number | null = activePrevMs
): PurpleBadge | null {
  const t = bucketOccurrence(nowMs, anchorMs, nextMs, prevMs);
  if (t === null) return null;
  // Absolute "MM/DD HH:mm": relative words (昨日/明日) lie to late-night
  // players sitting on the wrong side of midnight from the 06:00 bucket.
  if (t > nowMs) return { past: null, next: formatTaipei(t) };
  if (t > nowMs - SPAWN_FRESH_MS) return { past: formatTaipei(t), next: null };
  return { past: formatTaipei(t), next: formatTaipei(nextOccurrence(nowMs, anchorMs, nextMs)) };
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
  anchorMs: number = activeAnchorMs,
  nextMs: number | null = activeNextMs,
  prevMs: number | null = activePrevMs
): PurpleLive | null {
  const t = bucketOccurrence(nowMs, anchorMs, nextMs, prevMs);
  if (t === null) return null;
  if (t > nowMs) return { kind: "upcoming", nextMs: t };
  if (t > nowMs - SPAWN_FRESH_MS) return { kind: "live", endsMs: t + SPAWN_FRESH_MS };
  return { kind: "stale", pastMs: t, nextMs: nextOccurrence(nowMs, anchorMs, nextMs) };
}

/** "09-18 02:23"-style label for the next upcoming spawn (off-day note). */
export function nextBadgeLabel(
  nowMs: number = Date.now(),
  anchorMs: number = activeAnchorMs,
  nextMs: number | null = activeNextMs
): string {
  return formatTaipei(nextOccurrence(nowMs, anchorMs, nextMs));
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
  const spawn = nextOccurrence(nowMs);
  return Math.max(1_000, nextOccurrence(spawn) - PURPLE_LEAD_MS - nowMs);
}

// Reminder availability: shipped to everyone (same graduated-flag deal as
// the push lane — slot retained unread for old saves, dialog renders
// nothing while empty).
const PURPLE_FLAG_KEY = "mabiroutine:purple-hole-flag";
/** Legacy writer (kept for the dialog registry shape; nothing calls it). */
export function setPurpleHoleFlag(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(PURPLE_FLAG_KEY, "1");
    else window.localStorage.removeItem(PURPLE_FLAG_KEY);
  } catch {
    // storage blocked: the toggle just won't stick — no crash.
  }
}
export function isPurpleHoleEnabled(): boolean {
  return true;
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
  /**
   * The recorded spawn before the anchor (rule of 2026-10-14): the record is
   * explicit points plus backward derivation, so a seam where two spawns are
   * not PERIOD apart (10-13 15:41:02 → 10-14 14:10:09 is 22h29m) does not
   * invent an `anchor − PERIOD` row. Null/absent = derive from the anchor.
   * Must sit strictly before `anchorMs`.
   */
  prevMs: number | null;
  /**
   * Explicit next-spawn correction (rule added 2026-10-14): the recorded past
   * never moves on a correction, so the next spawn lives here instead of in
   * the anchor. Null = derive from the anchor lattice (old docs parse to
   * null). Present = the spawn the maintainer says comes next; it and every
   * PERIOD after it replace the lattice's forward half.
   */
  nextMs: number | null;
  windows: MaintenanceWindow[];
  updatedAt: number | null;
  updatedBy: string | null;
  /**
   * Watcher auto-apply (decided 2026-09-18): true (default) = each watcher
   * run overwrites `windows` when candidates are non-empty; any manual
   * publish flips it false (the hand edit wins and persists); promote keeps
   * it true; the admin resume button flips it back. The anchor is always
   * manual — the watcher never observes spawns, only maintenance posts.
   */
  auto: boolean;
};

/**
 * Strict window-list gate, both runtimes: an array (cap 64) of finite
 * {startMs, endMs} with start < end, or null. One bad entry rejects the
 * whole list — a fat-fingered dashboard edit degrades instead of
 * half-applying.
 */
export function validWindowsList(v: unknown): MaintenanceWindow[] | null {
  if (!Array.isArray(v) || v.length > 64) return null;
  const windows: MaintenanceWindow[] = [];
  for (const e of v) {
    if (!e || typeof e !== "object") return null;
    const { startMs, endMs } = e as Record<string, unknown>;
    if (typeof startMs !== "number" || typeof endMs !== "number") return null;
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || !(startMs < endMs)) return null;
    windows.push({ startMs, endMs });
  }
  return windows;
}

/**
 * Strict schedule-doc parse, both runtimes: finite anchor + a valid window
 * list — one bad entry rejects the whole doc instead of half-applying it,
 * and the caller falls back to cache/hardcoded. Returns the doc normalized
 * (sorted + merged), or null.
 */
export function parseScheduleDoc(v: unknown): PurpleScheduleDoc | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const d = v as Record<string, unknown>;
  if (typeof d.anchorMs !== "number" || !Number.isFinite(d.anchorMs)) return null;
  const windows = validWindowsList(d.windows);
  if (!windows) return null;
  // Absent/null is the no-recorded-previous case (every pre-rule doc). A
  // present value must sit strictly before the anchor.
  let prevMs: number | null = null;
  if (d.prevMs !== undefined && d.prevMs !== null) {
    if (typeof d.prevMs !== "number" || !Number.isFinite(d.prevMs) || !(d.prevMs < d.anchorMs)) {
      return null;
    }
    prevMs = d.prevMs;
  }
  // Absent/null is the no-correction case (every pre-rule doc). A present
  // value must be a finite time after the anchor: a "next" before or at the
  // record would cross the two rays.
  let nextMs: number | null = null;
  if (d.nextMs !== undefined && d.nextMs !== null) {
    if (typeof d.nextMs !== "number" || !Number.isFinite(d.nextMs) || !(d.nextMs > d.anchorMs)) {
      return null;
    }
    nextMs = d.nextMs;
  }
  const updatedAt =
    typeof d.updatedAt === "number" && Number.isFinite(d.updatedAt) ? d.updatedAt : null;
  const updatedBy = typeof d.updatedBy === "string" ? d.updatedBy.slice(0, 32) : null;
  // Absent (all pre-auto docs, incl. the first dashboard seed) reads as
  // auto-on: the watcher starts improving the doc on its next run.
  const auto = typeof d.auto === "boolean" ? d.auto : true;
  return {
    anchorMs: d.anchorMs,
    prevMs,
    nextMs,
    windows: normalizeWindows(windows),
    updatedAt,
    updatedBy,
    auto,
  };
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
    cur.prevMs === doc.prevMs &&
    cur.nextMs === doc.nextMs &&
    JSON.stringify(normalizeWindows(cur.windows)) === JSON.stringify(doc.windows);
  setPurpleTimetable(doc.anchorMs, doc.windows, doc.nextMs, doc.prevMs);
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
 * in the background and arm the ongoing refresh triggers. Consumers already
 * re-render on their own ticks; the reminder hook re-arms via
 * subscribePurpleFeed. Resolves — never rejects.
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
  void refreshPurpleFeedThrottled(0);
  startPurpleFeedAutoRefresh();
}

/**
 * Fetch-apply-cache one round. Throws on network or shape failure so the
 * caller (or DevTools) can tell "failed" from "stale-but-usable".
 */
export async function refreshPurpleFeed(): Promise<PurpleFeedStatus> {
  // Deliberately NOT routed through `lib/net.ts`: this module is shared with the
  // Cloudflare Worker (the fanout imports the pure schedule math by relative
  // path), so it must stay free of aliased runtime imports, and the funnel lives
  // behind an alias. `pnpm test:budget` names this file as one of the three
  // sanctioned request sites and `docs/operations.md` §7 records why. The
  // request is bounded anyway (60s min gap, one in flight) and counted by the
  // device budget in public/sw-budget.js.
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

/** Minimum gap between opportunistic refreshes; every trigger shares it. */
export const PURPLE_REFRESH_MIN_GAP_MS = 60 * 1000;

/**
 * Interval refresh while the page is open. The feed changes at most ~twice a
 * day (the watcher fires 11:17/23:17 Taipei), so 30 min bounds staleness for
 * always-open tabs at trivial cost (the worker serves a 60s edge cache, and a
 * no-change response is a no-op apply that notifies nobody).
 */
export const PURPLE_REFRESH_INTERVAL_MS = 30 * 60 * 1000;

let refreshInFlight: Promise<PurpleFeedStatus> | null = null;
let lastRefreshAttemptMs = 0;

/**
 * One refresh at a time, throttled: boot / foreground / reconnect / popover
 * triggers coalesce onto the in-flight request, and a refresh younger than
 * `minGapMs` is skipped (a failed attempt still counts, so offline spam
 * can't hammer the worker). Never rejects — a failure resolves to the current
 * (stale) status, so callers can fire-and-forget.
 */
export function refreshPurpleFeedThrottled(
  minGapMs: number = PURPLE_REFRESH_MIN_GAP_MS
): Promise<PurpleFeedStatus> {
  if (refreshInFlight) return refreshInFlight;
  if (Date.now() - lastRefreshAttemptMs < minGapMs) return Promise.resolve(purpleFeedStatus());
  lastRefreshAttemptMs = Date.now();
  refreshInFlight = refreshPurpleFeed()
    .catch(() => purpleFeedStatus())
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

let autoRefreshStarted = false;

/**
 * Keep the timetable current for pages that never close: refresh on foreground
 * returns, on reconnect, and on the fixed interval. Idempotent. The reminder
 * hook re-arms on the resulting feed change; badges re-render on their own
 * ticks. Popover-open is a separate trigger in SchedulePopover.
 */
export function startPurpleFeedAutoRefresh(): void {
  if (typeof window === "undefined" || autoRefreshStarted) return;
  autoRefreshStarted = true;
  window.setInterval(() => void refreshPurpleFeedThrottled(), PURPLE_REFRESH_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refreshPurpleFeedThrottled();
  });
  window.addEventListener("online", () => void refreshPurpleFeedThrottled());
}
