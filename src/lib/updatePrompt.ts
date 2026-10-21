import { useSyncExternalStore } from "react";

/** A `waiting` worker during registration — before it completes, or within this
 *  window of it — is pre-existing, not news: Workbox re-dispatches `waiting` at
 *  registration for a worker that survived a reload which did not take it over
 *  (`register()` in workbox-window emits it with `wasWaitingBeforeRegister`).
 *  Retire those silently. */
export const BOOT_WAIT_MS = 3000;

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

export function acceptUpdate(): void {
  clearUpdateReady();
  try {
    sessionStorage.setItem(RECEIPT_KEY, "1");
  } catch {
    // Blocked storage: the reload still happens, without the receipt toast.
  }
  window.location.reload();
}

export function takeUpdateReceipt(): boolean {
  try {
    if (sessionStorage.getItem(RECEIPT_KEY) === null) return false;
    sessionStorage.removeItem(RECEIPT_KEY);
    return true;
  } catch {
    return false;
  }
}
