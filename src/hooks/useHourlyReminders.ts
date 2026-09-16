import { useEffect } from "react";
import trackerJson from "@/data/tracker.json";
import barterJson from "@/data/barter.json";
import { barterToTask, useAppStore } from "@/store/useAppStore";
import type { Task } from "@/lib/types";
import {
  CATCHUP_MIN_SEC,
  fireHourlyReminder,
  isEligibleReminderId,
  isTaskDone,
  msUntilNextEventFire,
  msUntilNextHourFire,
  remainingSecToEvent,
  upcomingEventLabel,
} from "@/lib/hourlyReminders";

const BUILTIN_TASKS = trackerJson as Task[];
type BarterJsonItem = (typeof barterJson)[number];

// What would fire now, read live from the store. Shared by the scheduler
// below and the __mabiHourlyFire DevTools handle (main.tsx) — one source
// of truth. Per-character tasks contribute UNDONE CHARACTER names (the
// remaining count carries little signal — any remainder means "go play
// that char"); account/server-shared tasks fall back to task names.
// Null = nothing due (silence is correct).
export type UndoneReminder = { taskId: string; taskName: string; names: string[]; charIds: string[] };
export function getUndoneReminder(): UndoneReminder | null {
  const s = useAppStore.getState();
  const subs = (s.hourlyReminders ?? []).filter(isEligibleReminderId);
  if (subs.length === 0) return null;
  const pinned = new Set(s.barterPins);
  const byId = new Map<string, Task>();
  for (const t of BUILTIN_TASKS) byId.set(t.id, t);
  for (const t of s.customTasks) byId.set(t.id, t);
  for (const b of barterJson as BarterJsonItem[]) {
    if (pinned.has(b.id)) byId.set(b.id, barterToTask(b));
  }
  // Single-task scope today (barrier), so one taskId/taskName covers the
  // card; a future multi-task scope would need per-group cards instead of
  // mixing. charIds ride along for the tap deep-link (roster order).
  let taskId = "";
  let taskName = "";
  const names: string[] = [];
  const charIds: string[] = [];
  for (const id of subs) {
    const task = byId.get(id);
    if (!task) continue; // removed row: v18 prune clears it on next load
    if (task.section === "account" || task.serverShared === true) {
      if (s.isTaskHidden(id)) continue; // hidden = never do: don't nag
      if (!isTaskDone(task, s.accountValues[id])) names.push(task.name);
    } else {
      if (!taskId) {
        taskId = task.id;
        taskName = task.name;
      }
      for (const c of s.characters) {
        if (c.hiddenTaskIds.includes(id)) continue;
        if (!isTaskDone(task, c.taskValues[id])) {
          names.push(c.name);
          charIds.push(c.id);
        }
      }
    }
  }
  if (names.length === 0) return null;
  return { taskId, taskName, names, charIds };
}

// Page-timer scheduler for local event reminders (MVP). Fires at :00
// Taipei while the app is open: collects subscribed + still-undone +
// unhidden tasks, shows one collapsed card, then arms the next hour.
// Opens after :00 get an immediate catch-up card (still useful); past
// the 30s cutoff the hour is skipped silently. Closed app/page = no fire
// (documented limitation; server push is the follow-up, not this hook).
export function useHourlyReminders(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined" || !("Notification" in window)) return;
    let timer = 0;
    let cancelled = false;
    // Dedup: epoch-hour of the event already fired for. Without this, the
    // post-fire re-arm lands back inside the catch-up window and the card
    // re-fires every second until the cutoff.
    let firedEventHour: number | null = null;
    const eventHourOf = (nowMs: number): number =>
      Math.floor((nowMs + remainingSecToEvent(nowMs) * 1000) / 3600000);

    // Re-arm strictly for NEXT hour's fire (after firing or skipping).
    const armNextHour = () => {
      if (cancelled) return;
      timer = window.setTimeout(fireStep, msUntilNextHourFire(Date.now()));
    };

    const fireStep = () => {
      void (async () => {
        if (cancelled) return;
        // Already fired for this hour's event (e.g. foreground bounce right
        // after a fire): skip, don't double-card.
        if (firedEventHour === eventHourOf(Date.now())) {
          armNextHour();
          return;
        }
        // Re-check the cutoff at fire time: a throttled background timer
        // can slip past it between arming and firing.
        if (remainingSecToEvent(Date.now()) < CATCHUP_MIN_SEC) {
          armNextHour(); // this hour is gone: move on silently
          return;
        }
        const r = getUndoneReminder();
        if (r && Notification.permission === "granted") {
          await fireHourlyReminder({
            names: r.names,
            eventLabel: upcomingEventLabel(Date.now()),
            titleTask: r.taskName,
            taskId: r.taskId,
            charIds: r.charIds,
            onClick: () => resolveReminderDeepLink(r.taskId, r.charIds),
          });
          firedEventHour = eventHourOf(Date.now());
        }
        armNextHour();
      })();
    };

    // Fresh arm (mount / foreground return): catch-up fire allowed.
    const armCatchUp = () => {
      if (cancelled) return;
      timer = window.setTimeout(fireStep, msUntilNextEventFire(Date.now()));
    };

    armCatchUp();
    // Foreground return re-arms: a laptop that slept past :00 would otherwise
    // sit on a stale 50-minute timer instead of the next fire.
    const onVisible = () => {
      if (document.visibilityState === "visible" && !cancelled) {
        window.clearTimeout(timer);
        armCatchUp();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled]);
}

/**
 * Deep-link resolution for a reminder tap, with the requested priority:
 * 1. keep the active character if it's in the undone list;
 * 2. else switch to the first undone character (collector = roster order).
 * Then smooth-scrolls the task row into view and gives it one subtle flash.
 */
export function resolveReminderDeepLink(taskId: string, charIds: string[]): void {
  if (typeof window === "undefined" || !taskId) return;
  const s = useAppStore.getState();
  if (charIds.length > 0 && !charIds.includes(s.activeCharId)) {
    const first = charIds.find((id) => s.characters.some((c) => c.id === id));
    if (first) s.setActiveChar(first);
  }
  flashTaskRow(taskId);
}

function flashTaskRow(taskId: string, attempt = 0): void {
  let el: Element | null = null;
  try {
    el = document.querySelector(`[data-task-id="${CSS.escape(taskId)}"]`);
  } catch {
    el = document.querySelector(`[data-task-id="${taskId}"]`);
  }
  // The character switch above re-renders async — retry briefly, then give
  // up quietly (e.g. the row lives in a collapsed hidden bucket).
  if (!(el instanceof HTMLElement)) {
    if (attempt < 12) window.setTimeout(() => flashTaskRow(taskId, attempt + 1), 150);
    return;
  }
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("reminder-flash");
  el.addEventListener("animationend", () => el.classList.remove("reminder-flash"), { once: true });
  window.setTimeout(() => el.classList.remove("reminder-flash"), 5000);
}

/**
 * Consumes ?task= & ?chars= once after hydration (reminder-tap landing):
 * resolves the character, flashes the row, then strips our params — leaving
 * anything else in the URL untouched.
 */
export function useReminderDeepLink(enabled: boolean) {
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search);
    const task = q.get("task");
    if (!task) return;
    const chars = (q.get("chars") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    const url = new URL(window.location.href);
    url.searchParams.delete("task");
    url.searchParams.delete("chars");
    window.history.replaceState(null, "", url.toString());
    // Let the character switch commit before querying the DOM — the
    // flasher retries on its own if the row isn't there yet.
    requestAnimationFrame(() => window.setTimeout(() => resolveReminderDeepLink(task, chars), 80));
  }, [enabled]);
}
