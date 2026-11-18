import { useSyncExternalStore } from "react";

const KEY = "mabiroutine:link:seen";

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

let seen = read();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function markLinkSeen(): void {
  if (seen) return;
  seen = true;
  try {
    localStorage.setItem(KEY, "1");
  } catch {}
  for (const listener of listeners) listener();
}

export function useLinkSeen(): boolean {
  return useSyncExternalStore(subscribe, () => seen, () => false);
}
