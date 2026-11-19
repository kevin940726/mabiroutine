import { currentDailyBucket, currentWeekendBucket, getTaipeiWeekKey } from "@/lib/reset";

export type LinkStamp = { at: number; value: number | boolean; op?: number };
export type LinkBlackHole = {
  weekly?: LinkStamp;
  today?: LinkStamp;
  daily?: LinkStamp;
};

export type LinkDeviceState = {
  version: 1;
  token: string;
  match: Record<string, string>;
  localWrites: Record<string, number>;
  watermarks: Record<string, LinkStamp>;
  blackHole: Record<string, LinkBlackHole>;
  lastFrameAt: number | null;
};

export const LINK_DEVICE_KEY = "mabiroutine:link";

export function emptyLinkDevice(): LinkDeviceState {
  return {
    version: 1,
    token: "",
    match: {},
    localWrites: {},
    watermarks: {},
    blackHole: {},
    lastFrameAt: null,
  };
}

function rec(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function pruneLocalWrites(
  writes: Record<string, number>,
  now: Date
): Record<string, number> {
  const live = new Set([
    currentDailyBucket(now),
    getTaipeiWeekKey(now),
    currentWeekendBucket(now),
  ]);
  const out: Record<string, number> = {};
  for (const [key, at] of Object.entries(writes)) {
    if (!Number.isFinite(at)) continue;
    const bucket = key.slice(key.lastIndexOf("@") + 1);
    if (live.has(bucket)) out[key] = at;
  }
  return out;
}

export function loadLinkDevice(): LinkDeviceState {
  if (typeof localStorage === "undefined") return emptyLinkDevice();
  try {
    const raw = localStorage.getItem(LINK_DEVICE_KEY);
    if (!raw) return emptyLinkDevice();
    const blob: unknown = JSON.parse(raw);
    if (!rec(blob)) return emptyLinkDevice();
    // A saved boolean pin has no timestamp, so it is dropped; the next snapshot
    // is allowed to heal those rows.
    const localWrites: Record<string, number> = {};
    if (rec(blob.localWrites)) {
      for (const [key, at] of Object.entries(blob.localWrites)) {
        if (typeof at === "number" && Number.isFinite(at)) localWrites[key] = at;
      }
    }
    return {
      version: 1,
      token: typeof blob.token === "string" ? blob.token : "",
      match: rec(blob.match) ? (blob.match as Record<string, string>) : {},
      localWrites: pruneLocalWrites(localWrites, new Date()),
      watermarks: rec(blob.watermarks)
        ? (blob.watermarks as Record<string, LinkStamp>)
        : {},
      blackHole: rec(blob.blackHole) ? (blob.blackHole as Record<string, LinkBlackHole>) : {},
      lastFrameAt: typeof blob.lastFrameAt === "number" ? blob.lastFrameAt : null,
    };
  } catch {
    return emptyLinkDevice();
  }
}

export function saveLinkDevice(state: LinkDeviceState): void {
  try {
    localStorage.setItem(LINK_DEVICE_KEY, JSON.stringify(state));
  } catch {
    // Storage full or blocked: the feed still works for this session.
  }
}

export function setLinkToken(token: string): LinkDeviceState {
  const state = { ...loadLinkDevice(), token: token.trim() };
  saveLinkDevice(state);
  return state;
}

export function linkKey(
  scope: "character" | "account",
  charId: string | null,
  taskId: string,
  bucket: string
): string {
  const owner = scope === "account" ? "account" : (charId ?? "unknown");
  return `${owner}:${taskId}@${bucket}`;
}

export function isGuarded(
  state: LinkDeviceState,
  key: string,
  rowAt: number
): boolean {
  const at = state.localWrites[key];
  return at !== undefined && rowAt <= at;
}

export function recordLocalWrites(
  state: LinkDeviceState,
  keys: string[],
  at: number
): LinkDeviceState {
  const localWrites = { ...state.localWrites };
  for (const key of keys) localWrites[key] = at;
  const next = {
    ...state,
    localWrites: pruneLocalWrites(localWrites, new Date(at * 1000)),
  };
  saveLinkDevice(next);
  return next;
}
