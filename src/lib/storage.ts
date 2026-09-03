import type { StateStorage } from "zustand/middleware";

// Async-ish persistence: memory state updates stay synchronous (UI reads memory,
// so every tap renders instantly); localStorage writes are deferred to idle so
// rapid taps (counters, checks) never block the main thread.
// Latest write wins; flushStorage() forces a synchronous write and is wired to
// page hide/close. Crash-before-flush can lose <~1.5s of taps — acceptable for
// a tracker (see README storage section).
let pending: { key: string; value: string } | null = null;
let scheduled = false;

function writeNow(): void {
  scheduled = false;
  if (!pending) return;
  const { key, value } = pending;
  pending = null;
  try {
    localStorage.setItem(key, value);
  } catch {
    // quota exceeded: keep memory state, drop persistence
  }
}

function scheduleWrite(): void {
  if (scheduled) return;
  scheduled = true;
  const ric =
    typeof window !== "undefined"
    ? (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void }).requestIdleCallback
    : undefined;
  if (ric) ric(writeNow, { timeout: 1500 });
  else setTimeout(writeNow, 0);
}

export function flushStorage(): void {
  writeNow();
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushStorage();
  });
}
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushStorage);
}

export const idleStorage: StateStorage = {
  getItem: (key) => {
    if (pending?.key === key) return pending.value; // read-through
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key, value) => {
    pending = { key, value };
    scheduleWrite();
  },
  removeItem: (key) => {
    if (pending?.key === key) pending = null;
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
  },
};
