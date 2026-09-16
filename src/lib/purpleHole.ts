// 深淵的黑色坑洞 (purple hole) schedule engine — pure functions, no React.
//
// Cycle: 36h15m between spawns. The timer PAUSES during game maintenance,
// so each leg stretches by the maintenance overlapping it:
//   next = prev + PERIOD + overlap(prev, next)
// Phase 1 ships with MAINTENANCE_WINDOWS = [] (unpredictable); the pause
// math is already here so a future window feed just fills the list.
//
// Anchor (observed in-game): 2026-09-16 14:08 Taipei → predicts
// 2026-09-18 02:23. Correct drift by moving the anchor in code (phase 1,
// same hand-owned discipline as all other TW data).

export const PURPLE_HOLE_ID = "purple-hole";

/** Observed spawn; the whole timetable derives from this. */
export const PURPLE_ANCHOR_MS = Date.UTC(2026, 8, 16, 14 - 8, 8, 0);

/** 36h15m in ms. */
export const PURPLE_PERIOD_MS = (36 * 60 + 15) * 60 * 1000;

export type MaintenanceWindow = { startMs: number; endMs: number };

/** Phase 1: empty — maintenance is not predictable. */
export const MAINTENANCE_WINDOWS: MaintenanceWindow[] = [];

function totalOverlap(aMs: number, bMs: number, windows: MaintenanceWindow[] = MAINTENANCE_WINDOWS): number {
  let total = 0;
  for (const w of windows) {
    total += Math.max(0, Math.min(bMs, w.endMs) - Math.max(aMs, w.startMs));
  }
  return total;
}

/** Forward leg: occurrence after `fromMs`, stretched by overlapping maintenance. */
export function nextAfter(fromMs: number, windows: MaintenanceWindow[] = MAINTENANCE_WINDOWS): number {
  let end = fromMs + PURPLE_PERIOD_MS;
  for (let i = 0; i < 8; i++) {
    const stretched = fromMs + PURPLE_PERIOD_MS + totalOverlap(fromMs, end, windows);
    if (stretched === end) return end;
    end = stretched;
  }
  return end;
}

/** Backward leg: occurrence before `toMs` (inverse of nextAfter). */
export function prevBefore(toMs: number, windows: MaintenanceWindow[] = MAINTENANCE_WINDOWS): number {
  let p = toMs - PURPLE_PERIOD_MS;
  for (let i = 0; i < 8; i++) {
    const corrected = toMs - PURPLE_PERIOD_MS - totalOverlap(p, toMs, windows);
    if (corrected === p) return p;
    p = corrected;
  }
  return p;
}

/** nth occurrence relative to the anchor (0 = anchor, negative = past). */
export function nthOccurrence(n: number, windows: MaintenanceWindow[] = MAINTENANCE_WINDOWS): number {
  if (n === 0) return PURPLE_ANCHOR_MS;
  if (n > 0) {
    let t = PURPLE_ANCHOR_MS;
    for (let k = 0; k < n; k++) t = nextAfter(t, windows);
    return t;
  }
  let t = PURPLE_ANCHOR_MS;
  for (let k = 0; k < -n; k++) t = prevBefore(t, windows);
  return t;
}

/** Index of the first occurrence strictly after `nowMs`. */
export function firstIndexAfter(nowMs: number, windows: MaintenanceWindow[] = MAINTENANCE_WINDOWS): number {
  // Estimate ignoring maintenance, then walk to the truth (maintenance only
  // shifts forward, so the estimate is never ahead by more than the windows).
  let k = Math.floor((nowMs - PURPLE_ANCHOR_MS) / PURPLE_PERIOD_MS);
  while (nthOccurrence(k + 1, windows) <= nowMs) k++;
  while (nthOccurrence(k, windows) > nowMs) k--;
  return k + 1;
}

/** Past `past` + next `future` occurrences around now (ascending). */
export function occurrencesAround(
  nowMs: number = Date.now(),
  past = 2,
  future = 3,
  windows: MaintenanceWindow[] = MAINTENANCE_WINDOWS
): number[] {
  const first = firstIndexAfter(nowMs, windows);
  const out: number[] = [];
  for (let k = first - past; k < first + future; k++) out.push(nthOccurrence(k, windows));
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
  windows: MaintenanceWindow[] = MAINTENANCE_WINDOWS
): boolean {
  return bucketOccurrence(nowMs, windows) !== null;
}

/**
 * The occurrence inside the current daily bucket, if any. At most one: the
 * 36h15m period exceeds the 24h bucket, so two can never share it.
 */
export function bucketOccurrence(
  nowMs: number = Date.now(),
  windows: MaintenanceWindow[] = MAINTENANCE_WINDOWS
): number | null {
  const start = dailyBucketStartMs(nowMs);
  const end = start + 24 * 60 * 60 * 1000;
  const first = firstIndexAfter(start - PURPLE_PERIOD_MS * 2, windows);
  for (let k = first; ; k++) {
    const t = nthOccurrence(k, windows);
    if (t >= end) return null;
    if (t >= start) return t;
  }
}

/** First occurrence strictly after now. */
export function nextOccurrence(
  nowMs: number = Date.now(),
  windows: MaintenanceWindow[] = MAINTENANCE_WINDOWS
): number {
  return nthOccurrence(firstIndexAfter(nowMs, windows), windows);
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
  windows: MaintenanceWindow[] = MAINTENANCE_WINDOWS
): PurpleBadge | null {
  const t = bucketOccurrence(nowMs, windows);
  if (t === null) return null;
  // Absolute "MM-DD HH:mm": relative words (昨日/明日) lie to late-night
  // players sitting on the wrong side of midnight from the 06:00 bucket.
  if (t > nowMs) return { past: null, next: formatTaipei(t) };
  if (t > nowMs - SPAWN_FRESH_MS) return { past: formatTaipei(t), next: null };
  return { past: formatTaipei(t), next: formatTaipei(nextOccurrence(nowMs, windows)) };
}

/** "09-18 02:23"-style label for the next upcoming spawn (off-day note). */
export function nextBadgeLabel(
  nowMs: number = Date.now(),
  windows: MaintenanceWindow[] = MAINTENANCE_WINDOWS
): string {
  return formatTaipei(nextOccurrence(nowMs, windows));
}

/** "MM-DD HH:mm" in Taipei. */
export function formatTaipei(ms: number): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

// Feature flag: `?purple_hole=1` enables and persists,
// `?purple_hole=0` clears. Mirrors the ?push=1 gate, separate slot.
const PURPLE_FLAG_KEY = "mabiroutine:purple-hole-flag";
export function isPurpleHoleEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const q = new URLSearchParams(window.location.search).get("purple_hole");
    if (q === "1") window.localStorage.setItem(PURPLE_FLAG_KEY, "1");
    else if (q === "0") window.localStorage.removeItem(PURPLE_FLAG_KEY);
    return window.localStorage.getItem(PURPLE_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}
