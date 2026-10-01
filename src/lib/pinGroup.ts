// The arithmetic behind a group of pinned rows, kept apart from the component that
// draws them.
//
// These are pure: a group's "how far along" state and fill are derived from the
// rows alone, with no store and no React. They live here rather than inside
// PinnedGroups.tsx so they can be unit-tested directly (a component file may not
// export non-components without breaking Fast Refresh), and so the rules are
// stated once in one place.
import type { Task } from "@/lib/types";

/** One row's worth of state: the task, its saved value, and whether it is the
 *  account-scoped (server-shared) copy. */
export type PinRow = { task: Task; value: number | boolean | undefined; isAccount: boolean };

/** A child's progress as two facts: "touched" and "finished" are different.
 *  1/10 has started, so the parent is no longer empty, but it is not done. */
export function progressOf(r: PinRow): { touched: boolean; done: boolean } {
  if (r.task.type === "check") {
    const v = Boolean(r.value);
    return { touched: v, done: v };
  }
  const n = typeof r.value === "number" ? r.value : 0;
  return { touched: n > 0, done: n >= (r.task.max ?? 0) && (r.task.max ?? 0) > 0 };
}

/** The parent tile's three states: untouched, some-but-not-all, every child done.
 *  "touched" and "done" are separate so a group with one counter at 1/10 is
 *  partial, not empty. An empty group is "empty", NOT "full" — `done === 0 ===
 *  rows.length` would otherwise read as complete. */
export function parentState(rows: PinRow[]): "empty" | "partial" | "full" {
  if (rows.length === 0) return "empty";
  const touched = rows.filter((r) => progressOf(r).touched).length;
  const done = rows.filter((r) => progressOf(r).done).length;
  if (touched === 0) return "empty";
  if (done === rows.length) return "full";
  return "partial";
}

/** How far along one child is, 0-1. A check child is binary; a counter child is
 *  count/max, so 5 of 10 is half of that child's own work. A counter with no max
 *  cannot express a fraction, so it contributes 0. */
function childFraction(r: PinRow): number {
  const { done } = progressOf(r);
  if (r.task.type === "check") return done ? 1 : 0;
  const max = r.task.max ?? 0;
  if (max <= 0) return 0;
  const n = typeof r.value === "number" ? r.value : 0;
  return Math.min(1, Math.max(0, n / max));
}

/** How full the parent's tile is, 0-100: the group's analogue of a row's counter.
 *
 *  A row fills by its own count/max; a group has no single max, so every child owns
 *  an equal 1/N of the tile and a counter child is scaled by its own count/max
 *  inside that slice. So a group of two with one counter at 5/10 fills a quarter,
 *  and it only reaches 100% when every child is actually done. */
export function parentFillPct(rows: PinRow[]): number {
  if (rows.length === 0) return 0;
  const sum = rows.reduce((a, r) => a + childFraction(r), 0);
  return Math.round((sum / rows.length) * 100);
}
