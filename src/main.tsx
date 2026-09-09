import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'

// Service worker: production only (dev keeps the live shell).
// Silent-fresh: navigations are NetworkFirst, so the running page is always
// the latest build — updates only need to refresh caches, never interrupt.
// Prompt mode gives us the update handle; we acknowledge it silently
// (SKIP_WAITING, no toast, no reload) instead of autoUpdate's forced reload.
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
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  let lastSwCheck = 0;
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
      // for the event; reload into it now, dialog re-checked.
      if (!hasOpenDialog()) {
        disarm();
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
      // Update pending. Armed by a long-absence return (dialog re-checked:
      // one may have opened between arming and landing) → reload into it.
      // Otherwise take it over silently — the page already renders fresh
      // HTML from the network; this just retires the old caches.
      if (reloadOnUpdate && navigator.onLine && !hasOpenDialog()) {
        disarm();
        window.location.reload();
        return;
      }
      void updateSW(false);
    },
    onNeedReload() {
      // Suppress the client's built-in reload-on-takeover: with NetworkFirst
      // navigations there is never stale UI to flush, so reloading would
      // only lose scroll/state for nothing.
    },
    onRegisteredSW(_swUrl, reg) {
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
