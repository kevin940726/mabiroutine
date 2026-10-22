import { useSyncExternalStore } from "react";

/** A `waiting` worker during registration — before it completes, or within this
 *  window of it — is pre-existing, not news: Workbox re-dispatches `waiting` at
 *  registration for a worker that survived a reload which did not take it over
 *  (`register()` in workbox-window emits it with `wasWaitingBeforeRegister`).
 *  Retire those silently. */
export const BOOT_WAIT_MS = 3000;

const RECEIPT_KEY = "mabiroutine:update-receipt";
const ACK_KEY = "mabiroutine:update-ack";

let ready = false;
let readyAt: number | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function getUpdateReady(): boolean {
  return ready;
}

export function getUpdateReadyAt(): number | null {
  return readyAt;
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
  readyAt = Date.now();
  emit();
}

export function clearUpdateReady(): void {
  if (!ready) return;
  ready = false;
  readyAt = null;
  emit();
}

export function useUpdateReady(): boolean {
  return useSyncExternalStore(subscribeUpdateReady, getUpdateReady, () => false);
}

function reloadWithReceipt(acknowledgeChangelog: boolean): void {
  clearUpdateReady();
  try {
    sessionStorage.setItem(RECEIPT_KEY, "1");
    if (acknowledgeChangelog) sessionStorage.setItem(ACK_KEY, "1");
  } catch {
    // Blocked storage: the reload still happens, without the receipt toast.
  }
  window.location.reload();
}

export function acceptUpdate(): void {
  reloadWithReceipt(true);
}

export function autoUpdate(): void {
  reloadWithReceipt(false);
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

export function takeUpdateAcknowledgement(): boolean {
  try {
    if (sessionStorage.getItem(ACK_KEY) === null) return false;
    sessionStorage.removeItem(ACK_KEY);
    return true;
  } catch {
    return false;
  }
}
