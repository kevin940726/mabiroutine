import { TAIPEI_TZ } from "./types";

/** Get current time in Taipei timezone as Date components */
function getTaipeiParts(date: Date) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TAIPEI_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
  };
}

/** Create a UTC timestamp for a given Taipei wall time */
function taipeiWallToUtcMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number
): number {
  // Use Intl to find offset: we binary search offset?
  // Simpler: construct via Temporal-like trick: use Date with explicit offset calculation.
  // Taipei is UTC+8 no DST, so fixed +8.
  const utcMs = Date.UTC(year, month - 1, day, hour - 8, minute, second);
  return utcMs;
}

export function getNextDailyReset(now: Date = new Date()): Date {
  const p = getTaipeiParts(now);
  // daily reset 06:00 Taipei
  if (p.hour < 6) {
    return new Date(taipeiWallToUtcMs(p.year, p.month, p.day, 6, 0, 0));
  }
  // after 06:00 -> tomorrow 06:00
  const tomorrow = new Date(taipeiWallToUtcMs(p.year, p.month, p.day, 6, 0, 0));
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  // taipeiWallToUtc already accounted, but Date is UTC; adding 1 day via UTC works
  return tomorrow;
}

export function getNextWeeklyReset(now: Date = new Date()): Date {
  const p = getTaipeiParts(now);
  // Find next Monday 06:00 Taipei
  // Use Intl to get weekday
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: TAIPEI_TZ,
    weekday: "short",
  }).format(now);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dow = map[weekday] ?? 0;
  // Days until next Monday
  let daysUntilMonday = (8 - dow) % 7; // Mon=1 => 0 if Monday, etc
  // If today is Monday but before 06:00, reset is today 06:00
  if (dow === 1 && p.hour < 6) daysUntilMonday = 0;
  else if (dow === 1 && p.hour >= 6) daysUntilMonday = 7;
  // For other days, we already computed correctly except need to handle hour<6 edge on Tue? No, weekly only Monday.

  const base = new Date(taipeiWallToUtcMs(p.year, p.month, p.day, 6, 0, 0));
  base.setUTCDate(base.getUTCDate() + daysUntilMonday);
  return base;
}

export function formatCountdown(ms: number): string {
  if (ms <= 0) return "00:00:00";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function getTaipeiDateKey(now: Date = new Date()): string {
  const p = getTaipeiParts(now);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function getTaipeiWeekKey(now: Date = new Date()): string {
  // ISO week? Use local Monday-based week key: YYYY-WW where WW is week number with Monday start
  // Simpler: get Monday date's ISO string
  const nextWeekly = getNextWeeklyReset(now);
  // last weekly reset = next -7 days
  const last = new Date(nextWeekly.getTime() - 7 * 24 * 60 * 60 * 1000);
  const p = getTaipeiParts(last);
  // Use date of that Monday
  return `${p.year}-W${String(p.month).padStart(2, "0")}${String(p.day).padStart(2, "0")}`;
}

export function shouldDailyReset(lastResetKey: string | null, now: Date = new Date()): boolean {
  if (!lastResetKey) return true;
  // lastResetKey is date key of last daily reset bucket
  // Compute current bucket: if now is after 06:00 today, bucket = today, else yesterday
  const p = getTaipeiParts(now);
  let bucket: string;
  if (p.hour >= 6) bucket = getTaipeiDateKey(now);
  else {
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    bucket = getTaipeiDateKey(yesterday);
  }
  return lastResetKey !== bucket;
}

export function shouldWeeklyReset(lastWeeklyKey: string | null, now: Date = new Date()): boolean {
  if (!lastWeeklyKey) return true;
  const cur = getTaipeiWeekKey(now);
  return lastWeeklyKey !== cur;
}
