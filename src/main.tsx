import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'
import { statsSummary } from './sync/stats.ts'
import { readJournal, clearJournal } from './sync/journal.ts'
import { budgetAsk, budgetLog, noteBudgetTrip } from './lib/networkBudget.ts'
import { netSummary } from './lib/net.ts'
import { acceptUpdate, BOOT_WAIT_MS, markUpdateReady } from './lib/updatePrompt.ts'
import { toastAction } from './sync/session.ts'
import { getUndoneReminder, resolveReminderDeepLink } from './hooks/useHourlyReminders.ts'
import { getUndonePurpleReminder } from './hooks/usePurpleHoleReminders.ts'
import {
  eventHourOf,
  fireHourlyReminder,
  msUntilNextEventFire,
  reminderPermission,
  upcomingEventLabel,
} from './lib/hourlyReminders.ts'
import { PURPLE_HOLE_ID, PURPLE_TAG, formatTaipei, initPurpleFeed, msUntilPurpleFire, nextOccurrence, purpleFeedStatus, refreshPurpleFeedThrottled } from './lib/purpleHole.ts'

// Quota telemetry reader (quota §, docs/sync.md): run
// __mabiSyncStats() in DevTools for per-day request/command estimates.
if (typeof window !== 'undefined') {
  (window as unknown as { __mabiSyncStats?: () => string }).__mabiSyncStats = statsSummary;
}

// Sync journal reader (docs/sync.md diagnostics): __mabiSyncJournal() returns
// the last rounds' pushed/dropped/adopted keys as JSON, __mabiSyncJournalClear()
// empties it. Local-only, never sent anywhere.
if (typeof window !== 'undefined') {
  const w = window as unknown as {
    __mabiSyncJournal?: () => string;
    __mabiSyncJournalClear?: () => void;
  };
  w.__mabiSyncJournal = () => JSON.stringify(readJournal());
  w.__mabiSyncJournalClear = clearJournal;
}

// Device request budget (public/sw-budget.js): the worker tells us when this
// device went over its tier; we keep the trip locally. __mabiBudget() reads
// those stored trips, __mabiBudgetAsk() asks the worker for its live counters.
// Local-only, and quiet by design: a tripped device still works, it just stops
// spending requests. See docs/operations.md §7.
if (typeof window !== 'undefined') {
  const w = window as unknown as {
    __mabiBudget?: () => string;
    __mabiBudgetAsk?: () => Promise<string>;
  };
  w.__mabiBudget = budgetLog;
  w.__mabiBudgetAsk = budgetAsk;
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
      const d = event.data as
        | { type?: string; at?: number; trips?: number; sample?: { path?: string; destination?: string } }
        | null;
      if (d?.type === 'mabi-budget-trip' && typeof d.at === 'number') {
        noteBudgetTrip({ at: d.at, trips: d.trips ?? 0, sample: d.sample });
      }
    });
  }
}

// Counted network funnel (docs/operations.md §7): __mabiNet() reports the
// per-day counters for every non-session fetch the app makes. The session API
// has its own reader, __mabiSyncStats().
if (typeof window !== 'undefined') {
  (window as unknown as { __mabiNet?: () => string }).__mabiNet = netSummary;
}

// Purple schedule feed (phase 2B): apply the cached doc now, then refresh at
// boot and arm the ongoing triggers (foreground, reconnect, 30-min interval,
// popover open) — badges follow on their own ticks, the reminder hook re-arms
// on feed change. __mabiPurpleFeed() reports live/cache/hardcoded;
// __mabiPurpleRefresh() forces one round now (bypasses the 60s throttle).
if (typeof window !== 'undefined') {
  initPurpleFeed();
  const w = window as unknown as {
    __mabiPurpleFeed?: () => string;
    __mabiPurpleRefresh?: () => Promise<string>;
  };
  w.__mabiPurpleFeed = () => JSON.stringify(purpleFeedStatus());
  w.__mabiPurpleRefresh = () => refreshPurpleFeedThrottled(0).then((s) => JSON.stringify(s));
}

// Event-reminder debug handles (same pattern, always on): run
// __mabiHourlyTick() in DevTools for the live :00 countdown readout, or
// __mabiHourlyFire() to force one card now with the current undone subs
// (no waiting for :00; still needs permission + at least one sub).
// __mabiPurpleTick/__mabiPurpleFire are the purple-hole equivalents (next
// spawn countdown, force one 15-min-early card now).
if (typeof window !== 'undefined') {
  const w = window as unknown as {
    __mabiHourlyTick?: () => string;
    __mabiHourlyFire?: () => Promise<string>;
  };
  w.__mabiHourlyTick = () => {
    const ms = msUntilNextEventFire();
    const r = getUndoneReminder();
    const names = r?.names ?? [];
    return (
      `next fire in ${Math.round(ms / 1000)}s ` +
      `(event ${upcomingEventLabel(Date.now())} Taipei) · ` +
      `permission=${reminderPermission()} · ` +
      `undone (${names.length})${r?.taskName ? ` ${r.taskName}: ` : ': '}${names.join('、') || '—'}`
    );
  };
  w.__mabiHourlyFire = async () => {
    const r = getUndoneReminder();
    if (!r) return 'shown (nothing due)';
    const res = await fireHourlyReminder({
      names: r.names,
      eventLabel: upcomingEventLabel(Date.now()),
      titleTask: r.taskName,
      taskId: r.taskId,
      charIds: r.charIds,
      slot: eventHourOf(Date.now()),
      onClick: () => resolveReminderDeepLink(r.taskId, r.charIds),
    });
    return `${res} (names: ${r.names.join('、')})`;
  };
  const w2 = window as unknown as {
    __mabiPurpleTick?: () => string;
    __mabiPurpleFire?: () => Promise<string>;
  };
  w2.__mabiPurpleTick = () => {
    const spawn = nextOccurrence(Date.now());
    const r = getUndonePurpleReminder();
    const names = r?.names ?? [];
    return (
      `next fire in ${Math.round(msUntilPurpleFire() / 1000)}s ` +
      `(spawn ${formatTaipei(spawn)} Taipei) · ` +
      `permission=${reminderPermission()} · ` +
      `undone (${names.length}): ${names.join('、') || '—'}`
    );
  };
  w2.__mabiPurpleFire = async () => {
    const r = getUndonePurpleReminder();
    if (!r) return 'shown (nothing due)';
    const spawn = nextOccurrence(Date.now());
    const mins = Math.max(1, Math.round((spawn - Date.now()) / 60000));
    const res = await fireHourlyReminder({
      names: r.names,
      eventLabel: formatTaipei(spawn),
      title: `${r.taskName}即將出現`,
      body: `女神庭園、冰霜峽谷、雲海曠野各生成一個，預計 ${mins} 分鐘後出現。`,
      tag: PURPLE_TAG,
      taskId: PURPLE_HOLE_ID,
      charIds: r.charIds,
      onClick: () => resolveReminderDeepLink(PURPLE_HOLE_ID, r.charIds),
    });
    return `${res} (names: ${r.names.join('、')})`;
  };
}

// Service worker: production only (dev keeps the live shell).
// Silent-fresh: navigations are NetworkFirst, so the running page is always
// the latest build — an update only needs to retire the old caches, and the
// page is never force-reloaded.
// Prompt mode gives us the update handle; the caches are taken over silently
// (SKIP_WAITING) instead of autoUpdate's forced reload, and only a genuine
// mid-session deploy is announced (see onNeedRefresh).
//
// Long-absence reload (4 gates, all required): installed PWAs and pinned tabs
// can sit for days on stale code. On return after 6h+ away, IF online, IF no
// dialog is open, and IF an update is actually pending, reload once into it.
// Otherwise do nothing — a reload with no deploy behind it is pure cost.
// The arm always disarms (settle timeout + next hide) so a later deploy can
// never reload a mid-session user by surprise.
//
// Update discovery: the browser only revalidates sw.js on navigation, so a
// PWA resumed from memory would keep stale caches until force-restart.
// Re-check on foreground and on reconnect — now harmless background cache
// refreshes. No hourly interval: sessions here are minutes-long;
// foregrounding covers every realistic stale case. Throttled so
// app-switcher spam doesn't revalidate constantly.
const MIN_SW_CHECK_GAP_MS = 10 * 60 * 1000;
const ABSENCE_RELOAD_MS = 6 * 60 * 60 * 1000;
const UPDATE_SETTLE_MS = 15_000;
const LAST_HIDDEN_KEY = "mabiroutine:last-hidden";
// Long enough to read and tap, but inside the bus's 10s action TTL, so the
// button can never outlive its callback. Not the 2.6s receipt default.
const UPDATE_TOAST_MS = 8000;
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  let lastSwCheck = 0;
  // When this page's registration completed (0 = not yet). The boot window is
  // measured from here rather than from module evaluation: registration runs on
  // `load`, which a slow first paint can push well past the module's own start,
  // and a replay must stay inside the window however long that took.
  let registeredAt = 0;
  // Armed by a long-absence return; consumed (reload) only if an update lands
  // inside the settle window. Always disarmed — never leaks into a session.
  let reloadOnUpdate = false;
  let disarmTimer = 0;
  const disarm = () => {
    reloadOnUpdate = false;
    if (disarmTimer) {
      window.clearTimeout(disarmTimer);
      disarmTimer = 0;
    }
  };
  // Any Radix dialog (custom-task editor, confirms, sync sheets): reloading
  // under one vaporizes its draft, so an open dialog vetoes everything.
  const hasOpenDialog = () => !!document.querySelector('[role="dialog"]');
  const checkForSwUpdate = (reg: ServiceWorkerRegistration | undefined) => {
    if (!reg || reg.installing) return;
    if ('connection' in navigator && !navigator.onLine) return;
    const now = Date.now();
    if (now - lastSwCheck < MIN_SW_CHECK_GAP_MS) return;
    lastSwCheck = now;
    reg.update().catch(() => {});
  };
  const noteHidden = () => {
    try {
      localStorage.setItem(LAST_HIDDEN_KEY, String(Date.now()));
    } catch {
      // private mode — absence tracking off, no reload arming
    }
    disarm();
  };
  const noteVisible = (reg: ServiceWorkerRegistration | undefined) => {
    if (!reg) return;
    let last = 0;
    try {
      last = Number(localStorage.getItem(LAST_HIDDEN_KEY) ?? 0);
    } catch {
      return;
    }
    if (!last || Date.now() - last < ABSENCE_RELOAD_MS) return;
    if (!navigator.onLine || hasOpenDialog()) return;
    if (reg.waiting) {
      // Update already parked (landed while we were away) — no need to wait
      // for the event; reload into it now, dialog re-checked. Take it over
      // first, and write NO receipt flag: nobody asked for this reload, so the
      // page it lands on must not claim an update the user never accepted.
      if (!hasOpenDialog()) {
        disarm();
        void updateSW(false);
        window.location.reload();
      }
      return;
    }
    reloadOnUpdate = true;
    disarmTimer = window.setTimeout(disarm, UPDATE_SETTLE_MS);
    // If one is already installing, its waiting will trip onNeedRefresh
    // while armed — don't start a second update check.
    if (!reg.installing) reg.update().catch(() => disarm());
  };
  // Updater handle (registerSW's return value). Referenced inside the async
  // callbacks below — safe: they only run after registration resolves.
  const updateSW = registerSW({
    immediate: false,
    onNeedRefresh() {
      // Armed by a long-absence return (dialog re-checked: one may have opened
      // between arming and landing) → reload into it, no receipt: nobody asked
      // for this one. Checked first because arming only ever follows a
      // visibility change, i.e. a deliberate return, so it outranks the
      // boot-window heuristic below.
      if (reloadOnUpdate && navigator.onLine && !hasOpenDialog()) {
        disarm();
        void updateSW(false);
        window.location.reload();
        return;
      }
      // A `waiting` event at boot is not news. Before registration completes it
      // can only be a worker the registration found already parked, and Workbox
      // replays the event for exactly that worker once registration resolves —
      // the page has just rendered fresh HTML from the network, so all it needs
      // is the old caches retired. Announcing it here would describe a reload
      // that has effectively just happened.
      if (!registeredAt || Date.now() - registeredAt < BOOT_WAIT_MS) {
        void updateSW(false);
        return;
      }
      // A deploy landed mid-session: that IS news. Keep the cache takeover and
      // mark `updateReady` for the menu row, which outlives the toast.
      void updateSW(false);
      markUpdateReady();
      // Never interrupt an editor, and never toast a tab nobody is looking at —
      // `updateReady` already carries both cases into the menu row.
      if (document.visibilityState !== "visible" || hasOpenDialog()) return;
      toastAction("有新版本可用", "重新載入", acceptUpdate, UPDATE_TOAST_MS);
    },
    onNeedReload() {
      // Suppress the client's built-in reload-on-takeover: with NetworkFirst
      // navigations there is never stale UI to flush, so reloading would
      // only lose scroll/state for nothing.
    },
    onRegisteredSW(_swUrl, reg) {
      registeredAt = Date.now();
      if (!reg) return;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          noteVisible(reg);
          checkForSwUpdate(reg);
        } else noteHidden();
      });
      // pagehide covers OS-level kills that skip visibilitychange (mobile).
      window.addEventListener('pagehide', noteHidden);
      window.addEventListener('online', () => checkForSwUpdate(reg));
    },
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
