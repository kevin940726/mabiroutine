import type { Task } from "@/lib/types";

// One ruler for every progress number in the app (section badges + header
// overall). check = 0/1; counter/countdown = 1 when complete, half
// proportional credit while partially done (cur > 0 counts, scaled by 0.5).
export function taskCredit(task: Task, value: boolean | number | undefined): number {
  if (task.type === "check") return value ? 1 : 0;
  const cur = typeof value === "number" ? value : 0;
  const max = task.max ?? 1;
  if (cur >= max) return 1;
  if (cur > 0) return (cur / max) * 0.5;
  return 0;
}

export function summarizeProgress(
  tasks: Task[],
  getValue: (t: Task) => boolean | number | undefined
): { done: number; total: number; percent: number } {
  let credit = 0;
  for (const t of tasks) credit += taskCredit(t, getValue(t));
  const total = tasks.length;
  // done rounds the summed credit; percent uses the unrounded sum so a lone
  // partial still moves the bar even when done rounds to 0.
  return { done: Math.round(credit), total, percent: total ? Math.round((credit / total) * 100) : 0 };
}
