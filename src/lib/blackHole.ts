// 黑色坑洞 (black hole) state math — pure functions, no React.
//
// The game shows ONE combined attempts-left number R: the weekly bank left plus
// today's daily left. The tracker stores the two halves that need storing — the
// weekly bank used (0..7, carryable) and today's daily used (0/1) — and lets the
// DATE supply the third: every daily slot that has passed is resolved whether it
// was used or wasted, so a reset writes nothing and `elapsed` grows with the
// clock.
//
//   bank     stored `black-hole` (0..7): weekly extra attempts used
//   today    stored `black-hole-daily` (0/1): today's daily used
//   x        daily resets still ahead this week, after today (Mon 6 … Sun 0)
//   elapsed  6 − x     // expired daily slots
//   resolved bank + elapsed + today   // 0..14; the tile's small line and fill
//   R        8 − bank − today         // the game's number; x cancels out
//
// `done` is only reachable at resolved = 14 (bank 7 + x 0 + today 1), i.e.
// Sunday after 06:00: the row must not complete mid-week when the bank is spent,
// because the 14 is the week's whole allowance and six of its slots are still
// ahead. The copy states the in-game spend order is daily-first, which is why a
// plain tap uses today before the bank.

import type { Task } from "@/lib/types";
import { getNextDailyReset, getNextWeeklyReset } from "@/lib/reset";

export const BLACK_HOLE_ID = "black-hole";
export const BLACK_HOLE_DAILY_ID = "black-hole-daily";
/** The week's whole allowance: 7 carryable + 7 daily. */
export const BLACK_HOLE_WEEK_MAX = 14;
/** The stored bank's ceiling (the carryable extras only). */
export const BLACK_HOLE_BANK_MAX = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

function numOf(v: number | boolean | undefined): number {
  return typeof v === "number" ? v : v === true ? 1 : 0;
}

/** The stored bank, clamped: an old save holds "attempts used this week"
 *  (0..14) in the slot whose new meaning is the weekly bank (0..7). Clamp
 *  rather than migrate — the first write replaces the value, per the
 *  content-only max rule in docs/storage.md. */
function bankOf(v: number | boolean | undefined): number {
  return Math.max(0, Math.min(BLACK_HOLE_BANK_MAX, Math.round(numOf(v))));
}

/** Daily resets still ahead this week, after today (Mon 6 … Sun 0). The hours
 *  before Monday 06:00 still belong to the old week (both resets point at the
 *  same Monday 06:00 → 0), so x = 0 means "no daily reset left this week". */
export function blackHoleX(now: Date): number {
  const diff = getNextWeeklyReset(now).getTime() - getNextDailyReset(now).getTime();
  return Math.max(0, Math.min(6, Math.round(diff / DAY_MS)));
}

export type BlackHoleState = {
  /** the stored weekly bank used, clamped to 0..7 */
  bank: number;
  /** today's daily used, 0/1 */
  today: number;
  /** daily resets still ahead this week, after today (Mon 6 … Sun 0) */
  x: number;
  /** expired daily slots, 0 Mon … 6 Sun */
  elapsed: number;
  /** bank + elapsed + today, 0..14: a slot is resolved when used OR wasted */
  resolved: number;
  /** the game's combined attempts left, 0..8 */
  remaining: number;
  fillPct: number;
  done: boolean;
  /** the tile's clamp bounds on the resolved axis: elapsed … elapsed + 8 */
  resolvedMin: number;
  resolvedMax: number;
};

export function blackHoleState(
  bankRaw: number | boolean | undefined,
  todayRaw: number | boolean | undefined,
  now: Date
): BlackHoleState {
  const bank = bankOf(bankRaw);
  const today = numOf(todayRaw) > 0 ? 1 : 0;
  const x = blackHoleX(now);
  const elapsed = 6 - x;
  const resolved = bank + elapsed + today;
  return {
    bank,
    today,
    x,
    elapsed,
    resolved,
    remaining: 8 - bank - today,
    fillPct: Math.min(100, (resolved / BLACK_HOLE_WEEK_MAX) * 100),
    done: resolved >= BLACK_HOLE_WEEK_MAX,
    resolvedMin: elapsed,
    resolvedMax: elapsed + 8,
  };
}

/** The pair whose resolved equals `target` (clamped to the day's bounds),
 *  preferring the current today flag so a sync does not move a logged daily. */
export function blackHolePairForResolved(
  target: number,
  todayRaw: number | boolean | undefined,
  now: Date
): { bank: number; today: boolean } {
  const elapsed = 6 - blackHoleX(now);
  const t = Math.max(elapsed, Math.min(elapsed + 8, Math.round(target)));
  const used = t - elapsed; // 0..8 = bank + today
  if (numOf(todayRaw) > 0 && used >= 1) return { bank: used - 1, today: true };
  if (used <= BLACK_HOLE_BANK_MAX) return { bank: used, today: false };
  return { bank: BLACK_HOLE_BANK_MAX, today: true };
}

/** A plain tap's write: use the daily first, then the bank (the game's order).
 *  Null when there is nothing left to log today. */
export function blackHoleTap(
  bankRaw: number | boolean | undefined,
  todayRaw: number | boolean | undefined
): { bank: number; today: boolean } | null {
  const bank = bankOf(bankRaw);
  if (numOf(todayRaw) <= 0) return { bank, today: true };
  if (bank < BLACK_HOLE_BANK_MAX) return { bank: bank + 1, today: true };
  return null;
}

/** The −1 correction: undo the bank first, then today. Null at zero. */
export function blackHoleDec(
  bankRaw: number | boolean | undefined,
  todayRaw: number | boolean | undefined
): { bank: number; today: boolean } | null {
  const bank = bankOf(bankRaw);
  if (bank > 0) return { bank: bank - 1, today: numOf(todayRaw) > 0 };
  if (numOf(todayRaw) > 0) return { bank: 0, today: false };
  return null;
}

/** The task as the shared progress ruler must see it: the week's 14, not the
 *  bank's 7 — the raw bank would read as "done" the moment it hits 7. */
export function blackHoleProgressTask(t: Task): Task {
  return t.id === BLACK_HOLE_ID ? { ...t, max: BLACK_HOLE_WEEK_MAX } : t;
}

/** The value the shared progress ruler must see: resolved, not the raw bank. */
export function blackHoleProgressValue(
  t: Task,
  raw: boolean | number | undefined,
  dailyRaw: boolean | number | undefined,
  now: Date
): boolean | number | undefined {
  return t.id === BLACK_HOLE_ID ? blackHoleState(raw, dailyRaw, now).resolved : raw;
}
