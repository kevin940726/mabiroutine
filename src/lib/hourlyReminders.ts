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

// Experimental gate: the 實驗性功能 dialog flips this per device; everything
// reminder-shaped (bell, scheduler) hides when off. Read-once, no reactivity
// — the dialog reloads on close to apply, which keeps every reader honest.
const PUSH_FLAG_KEY = "mabiroutine:push-flag";
/** Experimental-settings write end (the dialog's only writer). */
export function setPushFlag(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(PUSH_FLAG_KEY, "1");
    else window.localStorage.removeItem(PUSH_FLAG_KEY);
  } catch {
    // storage blocked: the toggle just won't stick — no crash.
  }
}
export function isPushEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(PUSH_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

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

/**
 * Seconds into the current Taipei hour (0–3599). Exported for the worker
 * fanout (one math module, two runtimes — the worker imports it directly).
 */
export function secIntoHour(ms: number): number {
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

/**
 * Milliseconds until NEXT hour's scheduled fire, strictly skipping the
 * current window. Re-arm here after firing: re-using msUntilNextEventFire
 * would land back inside the catch-up window and re-fire every second
 * until the cutoff.
 */
export function msUntilNextHourFire(nowMs: number = Date.now()): number {
  const t = secIntoHour(nowMs);
  return Math.max(1_000, (3600 - t + FIRE_SEC_PAST_HOUR) * 1000);
}

/** "HH:02" label of the event a fire belongs to (Taipei). */
export function upcomingEventLabel(nowMs: number = Date.now()): string {
  const { hour } = taipeiHMS(nowMs);
  // A fire belongs to this hour's event unless we're already past it.
  const h = secIntoHour(nowMs) <= EVENT_SEC_PAST_HOUR ? hour : (hour + 1) % 24;
  return `${String(h).padStart(2, "0")}:02`;
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

/**
 * Wait for the notification grant to land outside our gesture (the Chrome
 * address-bar chip, site settings). Browsers never re-prompt once the user
 * leaves our dialog, so without this the user must reload and re-tap. Arm
 * BEFORE prompting so there is no race. Resolves true on grant, false on
 * denial, timeout, or abort. Never rejects.
 */
export function waitForReminderGrant(timeoutMs = 120_000, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      resolve(false);
      return;
    }
    if (Notification.permission !== "default") {
      resolve(Notification.permission === "granted");
      return;
    }
    let done = false;
    let stopWatch: (() => void) | null = null;
    const finish = (v: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearInterval(poll);
      stopWatch?.();
      signal?.removeEventListener("abort", onAbort);
      resolve(v);
    };
    const onAbort = () => finish(false);
    const check = () => {
      const p = Notification.permission;
      if (p === "granted") finish(true);
      else if (p === "denied") finish(false);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    // Poll backstop: universal, cheap (2s), covers browsers where the
    // Permissions API lacks the notifications descriptor.
    const poll = setInterval(check, 2000);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      finish(false);
      return;
    }
    try {
      const perms = navigator.permissions;
      if (perms?.query) {
        perms
          .query({ name: "notifications" as PermissionName })
          .then((status) => {
            if (done) return;
            check(); // race: flipped before the listener attached
            if (done) return;
            // addEventListener, not `onchange =`: concurrent watchers share
            // one PermissionStatus object and assignments would clobber.
            status.addEventListener("change", check);
            stopWatch = () => {
              status.removeEventListener("change", check);
            };
          })
          .catch(() => {
            /* poll backstop already running */
          });
      }
    } catch {
      /* poll backstop already running */
    }
  });
}

export type HourlyFireResult = "shown" | "skipped-permission" | "skipped-unsupported" | "skipped-hidden" | "failed";

export type ReminderFire = {
  names: string[];
  eventLabel: string;
  /** Task display name for the title (omitted → generic count title). */
  titleTask?: string;
  /** Full title override (e.g. early-fire lanes where 出現了 would lie). */
  title?: string;
  /** Collapse key override (default HOURLY_TAG — separate lanes need tags). */
  tag?: string;
  /** Full body override (default: capped name list — lanes that must not leak names pass their own). */
  body?: string;
  /** Deep-link payload: task row id + undone character ids for tap-through. */
  taskId?: string;
  charIds?: string[];
  /** Page-side tap handler (dev `new Notification()` path; the SW path
   * carries task/chars in notification.data instead). */
  onClick?: () => void;
};

/**
 * Show one collapsed hourly card. Prefers the service worker registration
 * (works on mobile, where `new Notification()` throws) and falls back to
 * the page constructor. Taps deep-link to the task row (see sw-push.js +
 * useReminderDeepLink). Resolves — never rejects — so the scheduler loop
 * cannot die on a notification error.
 */
export async function fireHourlyReminder(f: ReminderFire): Promise<HourlyFireResult> {
  const { names, eventLabel } = f;
  const titleTask = f.titleTask ?? "";
  if (names.length === 0) return "shown"; // nothing undone: silence is correct
  if (typeof window === "undefined" || !("Notification" in window)) return "skipped-unsupported";
  if (Notification.permission !== "granted") return "skipped-permission";
  // Visibility split (with the SW-side suppression in sw-push.js): a hidden
  // page stands down and lets the server card deliver — the local fire would
  // double it (same tag) with a throttled-late timer. Skip ONLY on a
  // positive "hidden" (missing API → fire): delivery guaranteed, dedup
  // opportunistic. Callers treat non-"shown" as no-card (see scheduler).
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return "skipped-hidden";
  // Character names (per-char tasks) count 隻, task names count 項.
  const unit = titleTask ? "隻" : "項";
  const shown = names.slice(0, 3).join("、");
  const more = names.length > 3 ? ` 等 ${names.length} ${unit}` : "";
  // Dormant branch: single-task scope always passes titleTask today; the
  // generic title survives for a future multi-task scope. The live path
  // carries no clock time, counts, or lead text.
  const title =
    f.title ??
    (titleTask ? `${titleTask}出現了` : `${eventLabel} 將至 — ${names.length} 項未完成`);
  const data: Record<string, string> = { url: "/" };
  if (f.taskId) data.task = f.taskId;
  if (f.charIds?.length) data.chars = f.charIds.join(",");
  // renotify/vibrate predate the TS DOM lib: typed locally, passed through
  // to showNotification which honors them at runtime.
  const options: NotificationOptions & { renotify?: boolean; vibrate?: number[] } = {
    body: f.body ?? `${shown}${more}`,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: f.tag ?? HOURLY_TAG,
    renotify: true,
    requireInteraction: false,
    silent: false,
    data,
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
    const n = new Notification(title, options);
    if (f.onClick) n.onclick = () => f.onClick!();
    return "shown";
  } catch {
    return "failed";
  }
}
