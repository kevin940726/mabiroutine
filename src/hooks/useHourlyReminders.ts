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

// Subscribed + still-undone + unhidden task names, read live from the
// store. Shared by the scheduler below and the __mabiHourlyFire DevTools
// handle (main.tsx) — one source of truth for "what would fire now".
export function getUndoneReminderNames(): string[] {
  const s = useAppStore.getState();
  const subs = s.hourlyReminders ?? [];
  if (subs.length === 0) return [];
  const char = s.getActiveChar();
  const pinned = new Set(s.barterPins);
  const byId = new Map<string, Task>();
  for (const t of BUILTIN_TASKS) byId.set(t.id, t);
  for (const t of s.customTasks) byId.set(t.id, t);
  for (const b of barterJson as BarterJsonItem[]) {
    if (pinned.has(b.id)) byId.set(b.id, barterToTask(b));
  }
  const names: string[] = [];
  for (const id of subs) {
    if (!isEligibleReminderId(id)) continue; // timer scoped to eligible tasks only
    const task = byId.get(id);
    if (!task) continue; // removed row: v18 prune clears it on next load
    if (s.isTaskHidden(id)) continue; // hidden = never do: don't nag
    const v =
      task.section === "account" || task.serverShared === true
        ? s.accountValues[id]
        : char?.taskValues[id];
    if (!isTaskDone(task, v)) names.push(task.name);
  }
  return names;
}

// Page-timer scheduler for local event reminders (MVP). Fires at :01:00
// Taipei while the app is open: collects subscribed + still-undone +
// unhidden tasks, shows one collapsed card, then arms the next hour.
// Opens after :01:00 get an immediate catch-up card (still useful); past
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
          const names = getUndoneReminderNames();
          if (names.length > 0 && Notification.permission === "granted") {
            await fireHourlyReminder(names, upcomingEventLabel(Date.now()));
          }
          arm(); // next hour, forever
        })();
      }, wait);
    };

    arm();
    // Foreground return re-arms: a laptop that slept past :01 would otherwise
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
