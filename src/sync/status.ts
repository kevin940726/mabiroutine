import { useSyncExternalStore } from "react";
import { loadSession, type LocalSession } from "@/sync/session";

export type SyncStatus = {
  /** The bound session, straight from `loadSession()`. Null = not linked. */
  linked: LocalSession | null;
  /** When this device last reached the link successfully (pull or push), from
   *  `mabiroutine:last-synced`. 0 = never since the key was added. */
  syncedAt: number;
  /** True once automatic pushes have failed three times running. */
  failing: boolean;
};

const SYNCED_KEY = "mabiroutine:last-synced";

function readSyncedAt(): number {
  try {
    const raw = localStorage.getItem(SYNCED_KEY);
    const at = raw ? Number(raw) : 0;
    return Number.isFinite(at) ? at : 0;
  } catch {
    return 0;
  }
}

const EMPTY: SyncStatus = { linked: null, syncedAt: 0, failing: false };

let status: SyncStatus = EMPTY;
let initialized = false;
let persistedAt = 0;
const listeners = new Set<(status: SyncStatus) => void>();

function readBinding(): SyncStatus {
  const linked = loadSession();
  return { linked, syncedAt: status.syncedAt, failing: linked ? status.failing : false };
}

export function getSyncStatus(): SyncStatus {
  if (!initialized) {
    initialized = true;
    status = { linked: loadSession(), syncedAt: readSyncedAt(), failing: false };
  }
  return status;
}

export function markSynced(at = Date.now()): void {
  setSyncStatus({ syncedAt: at });
  if (at - persistedAt < 30_000) return;
  persistedAt = at;
  try {
    localStorage.setItem(SYNCED_KEY, String(at));
  } catch {
    // Private mode: the stamp lasts this visit.
  }
}

export function subscribeSyncStatus(listener: (status: SyncStatus) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function same(a: SyncStatus, b: SyncStatus): boolean {
  return (
    a.failing === b.failing &&
    a.syncedAt === b.syncedAt &&
    a.linked?.id === b.linked?.id &&
    a.linked?.updatedAt === b.linked?.updatedAt
  );
}

function commit(next: SyncStatus): void {
  if (same(status, next)) return;
  status = next;
  for (const listener of listeners) listener(status);
}

export function setSyncStatus(patch: Partial<SyncStatus>): void {
  commit({ ...getSyncStatus(), ...patch });
}

export function refreshSyncStatus(): void {
  getSyncStatus();
  commit(readBinding());
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribeSyncStatus, getSyncStatus, () => EMPTY);
}
