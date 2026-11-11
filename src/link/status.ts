import { useSyncExternalStore } from "react";

export type LinkPhase = "off" | "connecting" | "connected" | "polling" | "error";

export type LinkStatus = {
  phase: LinkPhase;
  lastFrameAt: number | null;
};

const EMPTY: LinkStatus = {
  phase: "off",
  lastFrameAt: null,
};

let current: LinkStatus = EMPTY;
const listeners = new Set<() => void>();

export function setLinkStatus(patch: Partial<LinkStatus>): void {
  current = { ...current, ...patch };
  for (const listener of listeners) listener();
}

export function resetLinkStatus(): void {
  current = EMPTY;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLinkStatus(): LinkStatus {
  return useSyncExternalStore(subscribe, () => current, () => EMPTY);
}
