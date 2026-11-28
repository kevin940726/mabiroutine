import { useSyncExternalStore } from "react";
import type { BlockedPermission } from "@/link/permission";

export type LinkPhase =
  | "off"
  | "connecting"
  | "connected"
  | "polling"
  | "error"
  | "permission";

export type LinkTrust = "trusted" | "degraded" | "quarantined" | null;

export type LinkStatus = {
  phase: LinkPhase;
  lastFrameAt: number | null;
  permission: BlockedPermission | null;
  capturePaused: boolean;
  trust: LinkTrust;
  trustReason: string | null;
};

const EMPTY: LinkStatus = {
  phase: "off",
  lastFrameAt: null,
  permission: null,
  capturePaused: false,
  trust: null,
  trustReason: null,
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
