import { useSyncExternalStore } from "react";

/** The waiting-update nudge, and the receipt for the reload it asks for.
 *
 *  The state lives OUTSIDE React because `main.tsx` is what raises it (the
 *  service-worker callbacks run long before and after any component mounts).
 *  Two readers share it: the ☰ menu's conditional row, which outlives the nudge,
 *  and the toast's action, which shares one accept path with that row.
 *
 *  Device-local and deliberately not part of `useAppStore`: "this page load has
 *  a newer bundle parked behind it" is a fact about this tab, not progress —
 *  nothing here is saved, synced or migrated, so no schema bump. */

/** A `waiting` worker during registration — before it completes, or within this
 *  window of it — is pre-existing, not news: Workbox re-dispatches `waiting` at
 *  registration for a worker that survived a reload which did not take it over
 *  (the 6h path, a page opened while a deploy was waiting), and this page has
 *  just rendered fresh HTML from the network. Retire those silently. A real
 *  deploy lands minutes into a session, far outside this window. */
export const BOOT_WAIT_MS = 3000;

/** One-shot: the next page load is the reload the user asked for, so it owes
 *  them a receipt. `sessionStorage` because it belongs to this tab's trip
 *  through the reload and must not outlive it. */
const RECEIPT_KEY = "mabiroutine:update-receipt";

let ready = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function getUpdateReady(): boolean {
  return ready;
}

export function subscribeUpdateReady(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A newer worker is waiting and this page's bundle is behind. The menu row
 *  carries this until the user accepts or the page reloads, so it survives a
 *  dismissed toast. */
export function markUpdateReady(): void {
  if (ready) return;
  ready = true;
  emit();
}

export function clearUpdateReady(): void {
  if (!ready) return;
  ready = false;
  emit();
}

export function useUpdateReady(): boolean {
  return useSyncExternalStore(subscribeUpdateReady, getUpdateReady, () => false);
}

/** Take the update: write the receipt, then reload.
 *
 *  The worker was already taken over when the nudge fired (`updateSW(false)` in
 *  `onNeedRefresh`), so a plain reload IS the accept path — asking
 *  `updateSW(true)` now would find nothing to activate. */
export function acceptUpdate(): void {
  // Nothing is left to wait for: the reload is the accept.
  clearUpdateReady();
  try {
    sessionStorage.setItem(RECEIPT_KEY, "1");
  } catch {
    // Blocked storage: the reload still happens, it just lands without the
    // receipt toast. The harmless direction.
  }
  window.location.reload();
}

/** Read-and-clear, called from the App effect that raises the receipt: the flag
 *  is claimed exactly once, and a reload that was never accepted (the 6h absence
 *  path writes no flag) claims nothing. */
export function takeUpdateReceipt(): boolean {
  try {
    if (sessionStorage.getItem(RECEIPT_KEY) === null) return false;
    sessionStorage.removeItem(RECEIPT_KEY);
    return true;
  } catch {
    return false;
  }
}
