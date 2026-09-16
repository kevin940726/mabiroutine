import { useEffect } from "react";
import trackerJson from "@/data/tracker.json";
import { useAppStore } from "@/store/useAppStore";
import type { Task } from "@/lib/types";
import {
  fireHourlyReminder,
  isTaskDone,
} from "@/lib/hourlyReminders";
import {
  PURPLE_HOLE_ID,
  PURPLE_TAG,
  firstIndexAfter,
  formatTaipei,
  msUntilNextPurpleFire,
  msUntilPurpleFire,
  nthOccurrence,
} from "@/lib/purpleHole";
import { resolveReminderDeepLink } from "@/hooks/useHourlyReminders";

const BUILTIN_TASKS = trackerJson as Task[];

// What would fire now, read live from the store. Per-character task, so the
// card names UNDONE CHARACTER names (roster order), like the hourly lane.
// Null = nothing due (silence is correct).
export type UndonePurpleReminder = { taskName: string; names: string[]; charIds: string[] };
export function getUndonePurpleReminder(): UndonePurpleReminder | null {
  const s = useAppStore.getState();
  if (!(s.purpleHoleReminders ?? []).includes(PURPLE_HOLE_ID)) return null;
  const task = BUILTIN_TASKS.find((t) => t.id === PURPLE_HOLE_ID);
  if (!task) return null;
  if (s.isTaskHidden(PURPLE_HOLE_ID)) return null; // hidden = never do: don't nag
  const names: string[] = [];
  const charIds: string[] = [];
  for (const c of s.characters) {
    if (c.hiddenTaskIds.includes(PURPLE_HOLE_ID)) continue;
    if (!isTaskDone(task, c.taskValues[PURPLE_HOLE_ID])) {
      names.push(c.name);
      charIds.push(c.id);
    }
  }
  if (names.length === 0) return null;
  return { taskName: task.name, names, charIds };
}

// Page-timer scheduler for purple-hole reminders. Fires 15 min before each
// predicted spawn while the app is open: collects subscribed + still-undone +
// unhidden characters, shows one collapsed card on its own tag, then arms
// the next spawn. Opens after the fire time get an immediate catch-up card
// (the spawn is still future, so it's always truthful). Closed app/page =
// no fire (documented limitation, same as the hourly lane).
// Module-scope so a remount can't re-card a spawn already fired for.
let firedSpawn: number | null = null;

export function usePurpleHoleReminders(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined" || !("Notification" in window)) return;
    let timer = 0;
    let cancelled = false;

    // Re-arm strictly for NEXT spawn's fire (after firing or skipping).
    const armNextSpawn = () => {
      if (cancelled) return;
      timer = window.setTimeout(fireStep, msUntilNextPurpleFire(Date.now()));
    };

    const fireStep = () => {
      void (async () => {
        if (cancelled) return;
        const spawn = nthOccurrence(firstIndexAfter(Date.now()));
        // Already fired for this spawn (e.g. foreground bounce right after
        // a fire): skip, don't double-card.
        if (firedSpawn === spawn) {
          armNextSpawn();
          return;
        }
        const r = getUndonePurpleReminder();
        if (r && Notification.permission === "granted") {
          await fireHourlyReminder({
            names: r.names,
            eventLabel: formatTaipei(spawn),
            // titleTask keeps the 隻 unit for character names; title
            // overrides the text (出現了 would lie 15 min early).
            titleTask: r.taskName,
            title: `${r.taskName}即將出現`,
            tag: PURPLE_TAG,
            taskId: PURPLE_HOLE_ID,
            charIds: r.charIds,
            onClick: () => resolveReminderDeepLink(PURPLE_HOLE_ID, r.charIds),
          });
          firedSpawn = spawn;
        }
        armNextSpawn();
      })();
    };

    // Fresh arm (mount / foreground return): catch-up fire allowed.
    const armCatchUp = () => {
      if (cancelled) return;
      timer = window.setTimeout(fireStep, msUntilPurpleFire(Date.now()));
    };

    armCatchUp();
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
