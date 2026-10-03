// Section-completion celebration: a small emoji puff of the section's own
// task icons, erupting where the completing tap landed. Best-effort by
// design — reduced-motion skips it entirely, a hidden tab skips it (with no
// catch-up burst on return), and completions with no fresh tap (keyboard,
// sync) fall back to the section header.
import confetti from "canvas-confetti";
import trackerJson from "@/data/tracker.json";
import barterJson from "@/data/barter.json";
import {
  barterToTask,
  isServerSharedPinId,
  pinCycleOf,
  shopDealToTask,
} from "@/store/useAppStore";
import { shopDealsByPinId } from "@/lib/shops";
import { PURPLE_HOLE_ID, isScheduledToday } from "@/lib/purpleHole";
import { isTaskDone } from "@/lib/hourlyReminders";
import type { Character, Task, TaskSection } from "@/lib/types";

export type CelebrationSnapshot = {
  customTasks: Task[];
  barterPins: string[];
  characters: Character[];
  activeCharId: string;
  accountValues: Record<string, number | boolean>;
  hiddenAccountTaskIds: string[];
};

function activeChar(s: CelebrationSnapshot): Character | undefined {
  return s.characters.find((c) => c.id === s.activeCharId) ?? s.characters[0];
}

function isHidden(
  t: Pick<Task, "id" | "section"> & { serverShared?: boolean },
  s: CelebrationSnapshot,
  char: Character | undefined
): boolean {
  if (t.section === "account" || t.serverShared === true) {
    return (s.hiddenAccountTaskIds ?? []).includes(t.id);
  }
  return char?.hiddenTaskIds.includes(t.id) ?? false;
}

/**
 * Visible tasks of a section — the same denominator as the progress badge:
 * builtin + custom + pinned shop rows, minus manual hides and the parked
 * off-day purple-hole row.
 */
export function visibleSectionTasks(section: TaskSection, s: CelebrationSnapshot): Task[] {
  const char = activeChar(s);
  const kept: Task[] = [];
  const take = (t: Task) => {
    if (isHidden(t, s, char)) return;
    if (t.id === PURPLE_HOLE_ID && !isScheduledToday(Date.now())) return;
    kept.push(t);
  };
  for (const t of trackerJson as Task[]) if (t.section === section) take(t);
  for (const t of s.customTasks ?? []) if (t.section === section) take(t);
  if (section === "daily" || section === "weekly") {
    const barterList = barterJson as unknown as Parameters<typeof barterToTask>[0][];
    const deals = shopDealsByPinId();
    for (const id of s.barterPins ?? []) {
      if (pinCycleOf(id) !== section) continue;
      const shared = isServerSharedPinId(id);
      const hidden = shared
        ? (s.hiddenAccountTaskIds ?? []).includes(id)
        : (char?.hiddenTaskIds.includes(id) ?? false);
      if (hidden) continue;
      const b = barterList.find((x) => x.id === id);
      if (b) {
        take(barterToTask(b));
        continue;
      }
      const deal = deals.get(id);
      if (deal) take(shopDealToTask(deal));
    }
  }
  return kept;
}

/** Strict all-done over the visible tasks (empty counts as incomplete). */
export function isSectionComplete(section: TaskSection, s: CelebrationSnapshot): boolean {
  const tasks = visibleSectionTasks(section, s);
  if (tasks.length === 0) return false;
  const char = activeChar(s);
  return tasks.every((t) => {
    const v =
      t.section === "account" || t.serverShared === true
        ? s.accountValues[t.id]
        : char?.taskValues[t.id];
    return isTaskDone(t, v);
  });
}

// Fallback when the live set is empty (unreachable after a real completion —
// completion requires a non-empty set — but a burst of nothing is worse).
const FALLBACK_ICONS: Record<TaskSection, string[]> = {
  daily: ["☀️", "🌤️", "✨"],
  weekly: ["🗓️", "📅", "✨"],
  account: ["👥", "🤝", "✨"],
};

/** Particle shapes: the section's own icons, capped (each bakes a canvas). */
function sectionShapes(section: TaskSection, s: CelebrationSnapshot) {
  const icons = new Set<string>();
  for (const t of visibleSectionTasks(section, s)) {
    if (t.icon) icons.add(t.icon);
  }
  const texts = [...icons].slice(0, 14);
  return (texts.length > 0 ? texts : FALLBACK_ICONS[section]).map((text) =>
    confetti.shapeFromText({ text, scalar: 2 })
  );
}

type Point = { x: number; y: number };
const clampPoint = (x: number, y: number): Point => ({
  x: Math.min(0.95, Math.max(0.05, x / window.innerWidth)),
  y: Math.min(0.95, Math.max(0.05, y / window.innerHeight)),
});

// Last tap position, written by the hook's pointerup listener. Freshness is
// the whole trick: only the tap that just completed a row may aim the burst.
let lastPointer: { x: number; y: number; t: number } | null = null;
const POINTER_FRESH_MS = 2000;

export function noteCelebrationPointer(x: number, y: number): void {
  lastPointer = { x, y, t: Date.now() };
}

/** Tap point when fresh, else the section header (keyboard/sync fallback). */
function celebrationOrigin(section: TaskSection): { point: Point; aimed: boolean } {
  if (lastPointer && Date.now() - lastPointer.t < POINTER_FRESH_MS) {
    return { point: clampPoint(lastPointer.x, lastPointer.y), aimed: true };
  }
  const header = document.querySelector(`[data-celebrate-section="${section}"]`);
  if (!header) return { point: { x: 0.5, y: 0.2 }, aimed: false };
  const r = header.getBoundingClientRect();
  return {
    point: clampPoint(r.left + r.width / 2, r.top + r.height / 2),
    aimed: false,
  };
}

/**
 * Aim up-inward outside the comfortable middle zone, so edge taps don't fire
 * the fan straight off-screen. The anchor sits above the viewport, tuning a
 * mid-edge tap to ~125°; the middle keeps the plain upward fan. A few
 * escapees to randomness are acceptable.
 */
function edgeAim(p: Point): { angle: number; spread: number } {
  const m = 0.2;
  if (p.x > m && p.x < 1 - m && p.y > m && p.y < 1 - m) return { angle: 90, spread: 65 };
  return { angle: (Math.atan2(0.14 + p.y, 0.5 - p.x) * 180) / Math.PI, spread: 50 };
}

export function celebrateSection(section: TaskSection, s: CelebrationSnapshot): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (document.visibilityState !== "visible") return;
  if (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    return;
  }
  const { point, aimed } = celebrationOrigin(section);
  confetti({
    particleCount: 36,
    spread: 65,
    startVelocity: 30,
    gravity: 1.1,
    ticks: 150,
    scalar: 2,
    ...(aimed ? edgeAim(point) : null),
    shapes: sectionShapes(section, s),
    origin: point,
  });
}
