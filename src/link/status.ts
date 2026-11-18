import { useSyncExternalStore } from "react";
import type { BlockedPermission } from "@/link/permission";

export type LinkPhase =
  | "off"
  | "connecting"
  | "connected"
  | "polling"
  | "error"
  | "permission";

export type LinkStatus = {
  phase: LinkPhase;
  lastFrameAt: number | null;
  permission: BlockedPermission | null;
  /** The desktop paused capture on purpose; frames are not late, they are off. */
  paused: boolean;
};

const EMPTY: LinkStatus = {
  phase: "off",
  lastFrameAt: null,
  permission: null,
  paused: false,
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

export function getLinkStatus(): LinkStatus {
  return current;
}
