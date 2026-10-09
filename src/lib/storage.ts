import type { StateStorage } from "zustand/middleware";

// Async-ish persistence: memory state updates stay synchronous (UI reads memory,
// so every tap renders instantly); localStorage writes are deferred to idle so
// rapid taps (counters, checks) never block the main thread.
// Latest write wins; flushStorage() forces a synchronous write and is wired to
// page hide/close. Crash-before-flush can lose <~1.5s of taps — acceptable for
// a tracker (see README storage section).
//
// Writes are queued per storage key and land in insertion order in one flush.
// The sync base relies on that ordering: the engine saves the adopted base
// right after the store state, and writeBase (src/sync/flat.ts) queues through
// here and flushes, so the persisted state always lands before the base that
// describes it. A base fresher than the persisted state made the next boot
// read a day-old local state as "changed since the base" and replay it over
// the peer — see docs/sync.md decision 17.
const pending = new Map<string, string>();
let scheduled = false;

function writeNow(): void {
  scheduled = false;
  if (pending.size === 0) return;
  const entries = [...pending];
  pending.clear();
  for (const [key, value] of entries) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Quota exceeded: keep memory state, drop persistence — and stop here,
      // so an entry queued later (the sync base) can never land without the
      // state it describes. Entries are inserted state-first (writeBase).
      break;
    }
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

/** Queue a storage write; flushed together with the store state in one pass. */
export function queueStorageWrite(key: string, value: string): void {
  pending.set(key, value);
  scheduleWrite();
}

// A kill without these loses up to ~1.5s of input (the debounced write), and
// the base/state ordering below is only worth anything if the pair actually
// reaches storage before the page goes away.
if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushStorage();
  });
}
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("pagehide", flushStorage);
}

export const idleStorage: StateStorage = {
  getItem: (key) => {
    const queued = pending.get(key);
    if (queued !== undefined) return queued; // read-through
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key, value) => {
    queueStorageWrite(key, value);
  },
  removeItem: (key) => {
    pending.delete(key);
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
  },
};
