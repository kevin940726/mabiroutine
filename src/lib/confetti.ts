// Section-completion celebration: a small emoji puff of the section's own
// task icons, fired from inside the gesture handler that completes it.
// Causality by construction — sync, import and reset never pass through a
// row control, so they can never celebrate. Origin comes straight off the
// event (tap point, or the control's rect for keyboard), so there is no
// pointer tracking, no focus reading, and no fallback chain.
import confetti from "canvas-confetti";
import trackerJson from "@/data/tracker.json";
import barterJson from "@/data/barter.json";
import {
  barterToTask,
  isServerSharedPinId,
  pinCycleOf,
  shopDealToTask,
  useAppStore,
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

export type Point = { x: number; y: number };

function clampPoint(x: number, y: number): Point {
  return {
    x: Math.min(0.95, Math.max(0.05, x / window.innerWidth)),
    y: Math.min(0.95, Math.max(0.05, y / window.innerHeight)),
  };
}

/** Center of a control's own box. */
function rectCenter(el: Element): Point {
  const r = el.getBoundingClientRect();
  return clampPoint(r.left + r.width / 2, r.top + r.height / 2);
}

/**
 * Origin straight off the gesture: the tap point when the event carries
 * coordinates, else the control's own center (keyboard events have none;
 * a keyboard-activated click reports (0, 0)). Any zero/missing coordinate
 * counts as missing — (0, 0) is off-screen chrome, never a genuine tap.
 */
export function controlPoint(e: {
  clientX?: number;
  clientY?: number;
  currentTarget: Element;
}): Point {
  if (e.clientX && e.clientY) return clampPoint(e.clientX, e.clientY);
  return rectCenter(e.currentTarget);
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

function readSnapshot(): CelebrationSnapshot {
  const s = useAppStore.getState();
  return {
    customTasks: s.customTasks,
    barterPins: s.barterPins,
    characters: s.characters,
    activeCharId: s.activeCharId,
    accountValues: s.accountValues,
    hiddenAccountTaskIds: s.hiddenAccountTaskIds,
  };
}

function reducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Wrap a progress write made by a row control: if this write completes the
 * section, celebrate at the gesture's own origin. The was/now comparison
 * runs against the synchronously-updated store, and decrements need not call
 * this (they can only un-complete, which the was-check turns into a no-op
 * anyway).
 */
export function celebrateAfterWrite(
  section: TaskSection,
  origin: Point,
  write: () => void
): void {
  const before = readSnapshot();
  if (isSectionComplete(section, before)) {
    write();
    return;
  }
  write();
  const after = readSnapshot();
  if (!isSectionComplete(section, after) || reducedMotion()) return;
  confetti({
    particleCount: 36,
    ...edgeAim(origin),
    startVelocity: 30,
    gravity: 1.1,
    ticks: 150,
    scalar: 2,
    shapes: sectionShapes(section, after),
    origin,
  });
}
