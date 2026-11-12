import { useSyncExternalStore } from "react";

const KEY = "mabiroutine:link:enabled";

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

let enabled = read();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function linkEnabled(): boolean {
  return enabled;
}

export function setLinkEnabled(on: boolean): boolean {
  if (enabled === on) return true;
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    return false;
  }
  enabled = on;
  for (const listener of listeners) listener();
  return true;
}

export function useLinkEnabled(): boolean {
  return useSyncExternalStore(subscribe, () => enabled, () => false);
}
