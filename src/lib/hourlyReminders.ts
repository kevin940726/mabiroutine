import type { Task } from "@/lib/types";

// Local-only hourly reminders (MVP): while the app is open, a page timer
// fires at :58 Taipei — ~2 minutes before each 整點 — and raises one
// collapsed system notification listing subscribed tasks that are still
// undone. No server, no push subscription, nothing leaves the device.
//
// Least-intrusive recipe: a single notification per hour (tag-collapsed),
// auto-dismissing (requireInteraction: false), no re-buzz on replace
// (renotify: false), and silence when there is nothing undone.

// How early before the hour the reminder fires (minutes). Taipei is UTC+8
// with no DST, so wall-clock math is a fixed offset.
export const HOURLY_LEAD_MINUTES = 2;

// Collapse key: one card per hour-slot, replaced — never stacked.
export const HOURLY_TAG = "mabi-hourly";

/** Taipei wall-clock parts for a timestamp (hour/minute/second only). */
function taipeiHMS(ms: number): { hour: number; minute: number; second: number } {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { hour: get("hour") % 24, minute: get("minute"), second: get("second") };
}

/**
 * Milliseconds until the next :58 Taipei tick (the fire time for the
 * upcoming 整點). If we are already past :58 — e.g. the page just opened at
 * :59 — the next tick is next hour's :58, never "right now": firing late
 * would nag after the hour already started.
 */
export function msUntilNextHourlyTick(nowMs: number = Date.now(), lead = HOURLY_LEAD_MINUTES): number {
  const { minute, second } = taipeiHMS(nowMs);
  const tickMinute = 60 - lead; // :58
  // Minutes (fractional) remaining until the next :58 wall mark.
  let deltaMin = tickMinute - minute - second / 60;
  if (deltaMin <= 0) deltaMin += 60;
  return Math.max(1_000, Math.round(deltaMin * 60 * 1000));
}

/** "HH:00" label of the 整點 this tick is warming up for (Taipei). */
export function upcomingHourLabel(fireAtMs: number = Date.now(), lead = HOURLY_LEAD_MINUTES): string {
  const { hour, minute } = taipeiHMS(fireAtMs);
  // A tick at :58 belongs to the coming hour; anything else (clock skew,
  // throttled timer firing late) labels the current hour.
  const h = minute >= 60 - lead ? (hour + 1) % 24 : hour;
  return `${String(h).padStart(2, "0")}:00`;
}

export function isTaskDone(task: Task, value: number | boolean | undefined): boolean {
  if (task.type === "check") return Boolean(value);
  const max = task.max ?? 0;
  return max > 0 && (typeof value === "number" ? value : 0) >= max;
}

export type ReminderPermission = "granted" | "denied" | "default" | "unsupported";

/** Current notification permission without prompting. Never prompts. */
export function reminderPermission(): ReminderPermission {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission as ReminderPermission;
}

/**
 * Ask for notification permission. MUST be called from a user gesture (the
 * per-task 🔔 toggle) — browsers ignore or punish non-gesture prompts.
 */
export async function requestReminderPermission(): Promise<ReminderPermission> {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "granted" || Notification.permission === "denied") {
    return Notification.permission;
  }
  try {
    return (await Notification.requestPermission()) as ReminderPermission;
  } catch {
    return Notification.permission as ReminderPermission;
  }
}

export type HourlyFireResult = "shown" | "skipped-permission" | "skipped-unsupported" | "failed";

/**
 * Show one collapsed hourly card. Prefers the service worker registration
 * (works on mobile, where `new Notification()` throws) and falls back to
 * the page constructor. Resolves — never rejects — so the scheduler loop
 * cannot die on a notification error.
 */
export async function fireHourlyReminder(names: string[], hourLabel: string): Promise<HourlyFireResult> {
  if (names.length === 0) return "shown"; // nothing undone: silence is correct
  if (typeof window === "undefined" || !("Notification" in window)) return "skipped-unsupported";
  if (Notification.permission !== "granted") return "skipped-permission";
  const shown = names.slice(0, 3).join("、");
  const more = names.length > 3 ? ` 等 ${names.length} 項` : "";
  const title = `${hourLabel} 將至 — ${names.length} 項未完成`;
  // renotify/vibrate predate the TS DOM lib: typed locally, passed through
  // to showNotification which honors them at runtime.
  const options: NotificationOptions & { renotify?: boolean; vibrate?: number[] } = {
    body: `再 2 分鐘就整點：${shown}${more}`,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: HOURLY_TAG,
    renotify: false,
    requireInteraction: false,
    silent: false,
    data: { url: "/" },
  };
  try {
    // getRegistration — never .ready: .ready pends FOREVER when no worker
    // is registered (exactly the dev setup, where the SW is disabled), so
    // awaiting it hangs the fire and the page fallback below never runs.
    // getRegistration resolves immediately with undefined instead.
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        await reg.showNotification(title, options);
        return "shown";
      }
    }
  } catch {
    // fall through to the page constructor
  }
  try {
    new Notification(title, options);
    return "shown";
  } catch {
    return "failed";
  }
}
