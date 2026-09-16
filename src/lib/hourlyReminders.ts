import type { Task } from "@/lib/types";

// Local-only event reminders (MVP): while the app is open, a page timer
// fires once per hour ahead of the verified in-game event at XX:02:30 and
// raises one collapsed system notification for subscribed tasks still
// undone. No server, no push subscription, nothing leaves the device.
//
// Timing (verified in-game): the game pings soft at :00, the real event
// starts :02:30, walking there takes ~1 minute — so the scheduled fire is
// :00:00 sharp, landing together with the soft ping (150s before the
// event: plenty of prep, paired salience). Immediate catch-up for opens
// after :00, silence inside 30s of the start (a card that close is pure
// startle, zero actionability).
//
// Least-intrusive recipe: a single notification per hour (tag-collapsed),
// auto-dismissing (requireInteraction: false), re-buzz on replace
// (renotify: true — each hour is new information; false would silently
// overwrite the previous card with no banner), and silence when there is
// nothing undone.

// In-game event: XX:02:30 Taipei (verified). Taipei is UTC+8 with no DST,
// so wall-clock math is a fixed offset.
export const EVENT_SEC_PAST_HOUR = 150;
// Scheduled fire = event − lead: fires with the :00 soft ping, 150s ahead
// of the event (~60s to stop and move, rest is paired-salience slack).
export const FIRE_LEAD_SEC = 150;
// Inside this many seconds of the event, a card can't help: skip.
export const CATCHUP_MIN_SEC = 30;
// The timer is scoped to these task ids only (today: 不祥的召喚結界).
// Bells render and the scheduler collects exclusively for this list.
export const HOURLY_ELIGIBLE_IDS = ["barrier"] as const;

// Collapse key: one card per hour-slot, replaced — never stacked.
export const HOURLY_TAG = "mabi-hourly";

export function isEligibleReminderId(id: string): boolean {
  return (HOURLY_ELIGIBLE_IDS as readonly string[]).includes(id);
}

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

/** Seconds into the current Taipei hour (0–3599). */
function secIntoHour(ms: number): number {
  const { minute, second } = taipeiHMS(ms);
  return minute * 60 + second;
}

/** Scheduled fire offset within the hour (seconds): :00:00. */
export const FIRE_SEC_PAST_HOUR = EVENT_SEC_PAST_HOUR - FIRE_LEAD_SEC; // 0

/**
 * Milliseconds until the next fire. Before :00 we wait for it; inside
 * (:00, event − 30s] the caller fires ~immediately — late openers still
 * get a useful card; past the cutoff we arm next hour, since the event is
 * effectively now and a card can't help.
 */
export function msUntilNextEventFire(nowMs: number = Date.now()): number {
  const t = secIntoHour(nowMs);
  if (t < FIRE_SEC_PAST_HOUR) return Math.max(1_000, (FIRE_SEC_PAST_HOUR - t) * 1000);
  if (t <= EVENT_SEC_PAST_HOUR - CATCHUP_MIN_SEC) return 1_000;
  return Math.max(1_000, (3600 - t + FIRE_SEC_PAST_HOUR) * 1000);
}

/** Seconds from now until the coming event (always the next :02:30). */
export function remainingSecToEvent(nowMs: number = Date.now()): number {
  const t = secIntoHour(nowMs);
  return t <= EVENT_SEC_PAST_HOUR ? EVENT_SEC_PAST_HOUR - t : 3600 - t + EVENT_SEC_PAST_HOUR;
}

/** "HH:02" label of the event a fire belongs to (Taipei). */
export function upcomingEventLabel(nowMs: number = Date.now()): string {
  const { hour } = taipeiHMS(nowMs);
  // A fire belongs to this hour's event unless we're already past it.
  const h = secIntoHour(nowMs) <= EVENT_SEC_PAST_HOUR ? hour : (hour + 1) % 24;
  return `${String(h).padStart(2, "0")}:02`;
}

/** Event-relative lead copy: 剩3分半 / 剩1分鐘 / 馬上開始. */
export function eventLeadText(remainSec: number): string {
  if (remainSec < 60) return "馬上開始";
  const mins = Math.floor(remainSec / 60);
  return remainSec % 60 >= 30 ? `剩 ${mins} 分半` : `剩 ${mins} 分鐘`;
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
export async function fireHourlyReminder(
  names: string[],
  eventLabel: string,
  titleTask = ""
): Promise<HourlyFireResult> {
  if (names.length === 0) return "shown"; // nothing undone: silence is correct
  if (typeof window === "undefined" || !("Notification" in window)) return "skipped-unsupported";
  if (Notification.permission !== "granted") return "skipped-permission";
  // Character names (per-char tasks) count 隻, task names count 項.
  const unit = titleTask ? "隻" : "項";
  const shown = names.slice(0, 3).join("、");
  const more = names.length > 3 ? ` 等 ${names.length} ${unit}` : "";
  const title = titleTask
    ? `${eventLabel} 將至 — ${titleTask}`
    : `${eventLabel} 將至 — ${names.length} 項未完成`;
  // True lead at fire time, not the nominal 90s: a throttled or catch-up
  // fire states exactly how long is left.
  const leadText = eventLeadText(remainingSecToEvent(Date.now()));
  // renotify/vibrate predate the TS DOM lib: typed locally, passed through
  // to showNotification which honors them at runtime.
  const options: NotificationOptions & { renotify?: boolean; vibrate?: number[] } = {
    body: `${leadText}：${shown}${more}`,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: HOURLY_TAG,
    renotify: true,
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
