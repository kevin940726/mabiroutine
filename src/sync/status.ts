import { useSyncExternalStore } from "react";
import { loadSession, type LocalSession } from "@/sync/session";

// The sync engine's externally observable state. The engine writes it and every
// entry point reads it — the menu row, the dialog. It lives OUTSIDE React on
// purpose: the menu unmounts whenever it closes, so component state would go
// stale or vanish exactly where the status has to stay live, and the binding it
// describes is localStorage anyway (shared with other tabs and with the `?s=`
// arrival path), not React state.
export type SyncStatus = {
  /** The bound session, straight from `loadSession()`. Null = this device is
   *  not linked. */
  linked: LocalSession | null;
  /** `linked.updatedAt` flattened out for the row's relative time. 0 when
   *  unlinked, or linked but never acknowledged. */
  lastSyncedAt: number;
  /** True once automatic pushes have failed three times running; the row says
   *  同步失敗 until the network answers again. The toast at the third failure
   *  is unchanged — this only makes the state readable at any later moment. */
  failing: boolean;
};

const EMPTY: SyncStatus = { linked: null, lastSyncedAt: 0, failing: false };

let status: SyncStatus = EMPTY;
let initialized = false;
const listeners = new Set<(status: SyncStatus) => void>();

function readBinding(): SyncStatus {
  const linked = loadSession();
  return { linked, lastSyncedAt: linked?.updatedAt ?? 0, failing: status.failing };
}

export function getSyncStatus(): SyncStatus {
  if (!initialized) {
    initialized = true;
    status = { linked: loadSession(), lastSyncedAt: 0, failing: false };
    status.lastSyncedAt = status.linked?.updatedAt ?? 0;
  }
  return status;
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
    a.lastSyncedAt === b.lastSyncedAt &&
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

/** Re-read the binding after anything that can move it: `saveSession` /
 *  `clearSession`, a `?s=` adopt in another module, or a storage event from
 *  another tab. `failing` is kept — a binding change says nothing about the
 *  network. */
export function refreshSyncStatus(): void {
  getSyncStatus();
  commit(readBinding());
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribeSyncStatus, getSyncStatus, () => EMPTY);
}
