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
export type UndoneReminder = { taskName: string; names: string[] };
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
  // Single-task scope today (barrier), so one taskName covers the card; a
  // future multi-task scope would need per-group cards instead of mixing.
  let taskName = "";
  const names: string[] = [];
  for (const id of subs) {
    const task = byId.get(id);
    if (!task) continue; // removed row: v18 prune clears it on next load
    if (task.section === "account" || task.serverShared === true) {
      if (s.isTaskHidden(id)) continue; // hidden = never do: don't nag
      if (!isTaskDone(task, s.accountValues[id])) names.push(task.name);
    } else {
      if (!taskName) taskName = task.name;
      for (const c of s.characters) {
        if (c.hiddenTaskIds.includes(id)) continue;
        if (!isTaskDone(task, c.taskValues[id])) names.push(c.name);
      }
    }
  }
  if (names.length === 0) return null;
  return { taskName, names };
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

    const arm = () => {
      if (cancelled) return;
      const wait = msUntilNextEventFire(Date.now());
      timer = window.setTimeout(() => {
        void (async () => {
          if (cancelled) return;
          // Re-check the cutoff at fire time: a throttled background timer
          // can slip past it between arming and firing.
          if (remainingSecToEvent(Date.now()) < CATCHUP_MIN_SEC) {
            arm(); // this hour is gone: move on silently
            return;
          }
          const r = getUndoneReminder();
          if (r && Notification.permission === "granted") {
            await fireHourlyReminder(r.names, upcomingEventLabel(Date.now()), r.taskName);
          }
          arm(); // next hour, forever
        })();
      }, wait);
    };

    arm();
    // Foreground return re-arms: a laptop that slept past :00 would otherwise
    // sit on a stale 50-minute timer instead of the next fire.
    const onVisible = () => {
      if (document.visibilityState === "visible" && !cancelled) {
        window.clearTimeout(timer);
        arm();
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
