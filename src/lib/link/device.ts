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
  pins: Record<string, true>;
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
    pins: {},
    watermarks: {},
    blackHole: {},
    lastFrameAt: null,
  };
}

function rec(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function loadLinkDevice(): LinkDeviceState {
  if (typeof localStorage === "undefined") return emptyLinkDevice();
  try {
    const raw = localStorage.getItem(LINK_DEVICE_KEY);
    if (!raw) return emptyLinkDevice();
    const blob: unknown = JSON.parse(raw);
    if (!rec(blob)) return emptyLinkDevice();
    return {
      version: 1,
      token: typeof blob.token === "string" ? blob.token : "",
      match: rec(blob.match) ? (blob.match as Record<string, string>) : {},
      pins: rec(blob.pins) ? (blob.pins as Record<string, true>) : {},
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

export function isPinned(state: LinkDeviceState, key: string): boolean {
  return state.pins[key] === true;
}

export function pinLinkRow(
  state: LinkDeviceState,
  scope: "character" | "account",
  charId: string | null,
  taskId: string,
  bucket: string
): LinkDeviceState {
  const key = linkKey(scope, charId, taskId, bucket);
  if (state.pins[key]) return state;
  const next = { ...state, pins: { ...state.pins, [key]: true as const } };
  saveLinkDevice(next);
  return next;
}
