import trackerJson from "@/data/tracker.json";
import { cycleBucketFor } from "@/lib/cycle";
import { shopDealsByPinId, type ShopDeal } from "@/lib/shops";
import type { Task } from "@/lib/types";

export const BLACK_HOLE = "black-hole";
export const BLACK_HOLE_DAILY = "black-hole-daily";
export const BLACK_HOLE_TODAY = "black-hole-today";
export const BARRIER = "barrier";

export const AUX_INPUTS: ReadonlySet<string> = new Set([BLACK_HOLE_TODAY, "parttime-active"]);

const BUILTIN = new Map<string, Task>((trackerJson as Task[]).map((t) => [t.id, t]));

export type LinkTarget =
  | { kind: "task"; task: Task; scope: "character" | "account" }
  | { kind: "shop"; taskId: string; deal: ShopDeal; scope: "character" | "account" }
  | { kind: "aux"; taskId: string }
  | { kind: "unknown"; taskId: string };

export function resolveTarget(taskId: string, customTasks: Task[]): LinkTarget {
  const builtin = BUILTIN.get(taskId);
  if (builtin) {
    return {
      kind: "task",
      task: builtin,
      scope: builtin.section === "account" ? "account" : "character",
    };
  }
  const custom = customTasks.find((t) => t.id === taskId);
  if (custom) {
    return {
      kind: "task",
      task: custom,
      scope: custom.section === "account" ? "account" : "character",
    };
  }
  const deal = shopDealsByPinId().get(taskId);
  if (deal) {
    return {
      kind: "shop",
      taskId,
      deal,
      scope: deal.scopeAccount ? "account" : "character",
    };
  }
  if (AUX_INPUTS.has(taskId)) return { kind: "aux", taskId };
  return { kind: "unknown", taskId };
}

export function targetBucket(target: LinkTarget, customTasks: Task[], at: number): string | null {
  if (target.kind === "task") {
    return cycleBucketFor(target.task.id, customTasks, new Date(at * 1000));
  }
  if (target.kind === "shop") {
    return cycleBucketFor(target.taskId, customTasks, new Date(at * 1000));
  }
  return null;
}

export function targetMax(target: LinkTarget): number | undefined {
  if (target.kind === "task") return target.task.max;
  if (target.kind === "shop") return target.deal.limitTimes ?? undefined;
  return undefined;
}

/** The stored value for one observation, or null when a composite owns it. */
export function normalizeValue(
  target: LinkTarget,
  wireValue: number,
  kind: "done" | "count" | "remaining"
): number | boolean | null {
  if (target.kind !== "task" && target.kind !== "shop") return null;
  if (target.kind === "task" && target.task.id === BLACK_HOLE) return null;

  const max = targetMax(target);
  let value = wireValue;

  if (
    target.kind === "task" &&
    target.task.id === BARRIER &&
    (kind === "remaining" || target.task.type === "countdown") &&
    max !== undefined
  ) {
    value = max - value;
  }

  if (target.kind === "task" && target.task.type === "check") return value >= 1;
  if (target.kind === "shop" && !((target.deal.limitTimes ?? 0) > 1)) return value >= 1;
  value = Math.max(0, value);
  if (max !== undefined) value = Math.min(max, value);
  else value = Math.min(999, value);
  return value;
}
