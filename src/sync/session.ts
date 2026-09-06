import { useAppStore, migratePersisted } from "@/store/useAppStore";
import type { AppState } from "@/lib/types";
import { getSession, SyncNotFound, type FlatMap } from "@/sync/api";
import { flattenSnapshot, loadBase, saveBase, unflattenReplace } from "@/sync/flat";

// Local session binding: which cloud session this device is linked to, plus
// the last server timestamp seen (ordering debug aid — merges are
// arrival-ordered server-side, no base guard). Kept OUT of the zustand store
// on purpose — no schema migration needed.
const SESSION_KEY = "mabiroutine:session";

export type LocalSession = { id: string; updatedAt: number };

export function loadSession(): LocalSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<LocalSession>;
    if (typeof s.id !== "string" || !s.id) return null;
    return { id: s.id, updatedAt: typeof s.updatedAt === "number" ? s.updatedAt : 0 };
  } catch {
    return null;
  }
}

export function saveSession(s: LocalSession): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  if (typeof window !== "undefined") window.dispatchEvent(new Event("mabiroutine:session-changed"));
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
  if (typeof window !== "undefined") window.dispatchEvent(new Event("mabiroutine:session-changed"));
}

// Snapshot = exactly the persisted slice (same fields as partialize), so a
// pulled snapshot feeds straight into migratePersisted like a backup import.
export type SyncSnapshot = Pick<
  AppState,
  | "version"
  | "characters"
  | "activeCharId"
  | "accountValues"
  | "hiddenAccountTaskIds"
  | "barterPins"
  | "customTasks"
  | "lastDailyReset"
  | "lastWeeklyReset"
  | "prefs"
  | "globalTaskOrder"
  | "barterFilters"
>;

export function buildSnapshot(): SyncSnapshot {
  const s = useAppStore.getState();
  return {
    version: s.version,
    characters: s.characters,
    activeCharId: s.activeCharId,
    accountValues: s.accountValues,
    hiddenAccountTaskIds: s.hiddenAccountTaskIds,
    barterPins: s.barterPins,
    customTasks: s.customTasks,
    lastDailyReset: s.lastDailyReset,
    lastWeeklyReset: s.lastWeeklyReset,
    prefs: s.prefs,
    globalTaskOrder: s.globalTaskOrder,
    barterFilters: s.barterFilters,
  };
}

// Returns false when the payload fails validation (caller toasts).
export function applySnapshot(snapshot: unknown): boolean {
  try {
    const data = snapshot as { version?: unknown };
    const migrated = migratePersisted(
      snapshot,
      typeof data.version === "number" ? data.version : 0
    );
    useAppStore.setState({ ...migrated, _hasHydrated: true });
    return true;
  } catch {
    return false;
  }
}

// True when this device holds no user data worth protecting: no progress
// values anywhere, no custom tasks, single character. Opening a sync link
// on such a profile adopts silently — the confirm dialog would only ask
// permission to delete defaults.
export function isPristine(): boolean {
  const s = useAppStore.getState();
  if (s.customTasks.length > 0) return false;
  if (s.characters.length !== 1) return false;
  if (Object.keys(s.accountValues).length > 0) return false;
  for (const c of s.characters) {
    if (Object.keys(c.taskValues).length > 0) return false;
  }
  return true;
}

export function syncUrl(id: string): string {
  return `${window.location.origin}${window.location.pathname}?s=${id}`;
}

export function sessionIdFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("s");
}

// Parse a pasted sync link (or bare id) — the manual path for buckets a ?s=
// tap can never reach (iOS web app, mismatched Android browsers).
export function sessionIdFromText(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  let id: string | null = null;
  if (/^https?:\/\//i.test(t)) {
    try {
      id = new URLSearchParams(new URL(t).search).get("s");
    } catch {
      return null;
    }
  } else {
    id = t;
  }
  return id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    ? id
    : null;
}

export function stripSessionParam(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("s");
  window.history.replaceState(null, "", url.toString());
}

// Reflect the binding in the address bar (no history entry — replaceState).
// The URL is then shareable as-is; arrival via ?s= was already kept.
export function setSessionParam(id: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set("s", id);
  window.history.replaceState(null, "", url.toString());
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// Minimal toast bus: any sync module can toast without prop drilling.
export function toast(message: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<string>("mabiroutine:toast", { detail: message }));
}

export type ImportRequest = { id: string; state: unknown; updatedAt: number };

// Background engine hook (owned by SyncButton's effect). Lets session-level
// flows trigger a pull round without prop drilling. Promise-returning so
// syncAndResets can order reset-after-pull.
let pullHook: (() => Promise<void>) | null = null;
export function setPullHook(fn: (() => Promise<void>) | null): void {
  pullHook = fn;
}
export function requestPull(): void {
  void pullHook?.();
}

// Last remote reset markers seen per session (local-only sidecar, no store
// migration). A device whose reset bucket a peer already reached is late:
// its deletions are stale echoes, not news — tombstones suppressed.
const SEEN_KEY = "mabiroutine:seenmarkers";
export type SeenMarkers = { daily: string; weekly: string };

export function loadSeen(sessionId: string): SeenMarkers {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return { daily: "", weekly: "" };
    const p = JSON.parse(raw) as { sessionId?: unknown; daily?: unknown; weekly?: unknown };
    if (p.sessionId !== sessionId) return { daily: "", weekly: "" };
    return {
      daily: typeof p.daily === "string" ? p.daily : "",
      weekly: typeof p.weekly === "string" ? p.weekly : "",
    };
  } catch {
    return { daily: "", weekly: "" };
  }
}

export function saveSeen(sessionId: string, seen: SeenMarkers): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify({ sessionId, ...seen }));
  } catch {
    // private mode — next reset degrades to full (pre-marker behavior)
  }
}

// Drop keys from the sync base without sending: the next diff then stays
// silent for them instead of tombstoning. Catch-up resets and cap-overflow
// (keys nobody deleted) only — never user deletes.
export function scrubBase(sessionId: string, keys: string[]): void {
  if (keys.length === 0) return;
  const base = loadBase(sessionId);
  let changed = false;
  for (const k of keys) {
    if (k in base) {
      delete base[k];
      changed = true;
    }
  }
  if (changed) saveBase(sessionId, base);
}

// Reset entry point — App calls this instead of checkResets. Pulls first so
// the tombstone decision sees fresh peer markers, then resets: a branch
// firing into a bucket the peer already reached suppresses its tombstones
// (scrubs them from the base) and re-pulls promptly to re-adopt the peer's
// same-bucket values the local wipe just dropped. Unlinked devices (or
// unknown peer markers) take the full path — today's behavior, unchanged.
// Serialized: overlapping triggers (focus + interval on one wake) must not
// interleave a reset between the other's pull and decision.
let running: Promise<void> | null = null;
export function syncAndResets(): Promise<void> {
  running ??= runResets().finally(() => {
    running = null;
  });
  return running;
}

async function runResets(): Promise<void> {
  await pullHook?.();
  const r = useAppStore.getState().checkResets();
  if (!r.daily && !r.weekly) return;
  const session = loadSession();
  if (!session) return;
  const seen = loadSeen(session.id);
  const stamped = useAppStore.getState();
  let suppressed = false;
  if (r.daily && seen.daily >= (stamped.lastDailyReset ?? "")) {
    scrubBase(session.id, r.dailyKeys);
    suppressed = true;
  }
  if (r.weekly && seen.weekly >= (stamped.lastWeeklyReset ?? "")) {
    scrubBase(session.id, r.weeklyKeys);
    suppressed = true;
  }
  if (suppressed) await pullHook?.();
}

// One-shot flag: after seeing a legacy (v1 blob) session, the next push
// sends the full flat map so the server upgrades the record in place.
let fullPushNext = false;
export function markFullPush(): void {
  fullPushNext = true;
}
export function takeFullPush(): boolean {
  const f = fullPushNext;
  fullPushNext = false;
  return f;
}

// Adopt a remote payload (flat map, or legacy whole-state blob) wholesale.
// Used by pristine auto-adopt and the binding-switch confirm dialog.
export function adoptState(remote: { state?: unknown; legacy?: unknown }): boolean {
  if (remote.legacy !== undefined) return applySnapshot(remote.legacy);
  if (!remote.state || typeof remote.state !== "object" || Array.isArray(remote.state)) return false;
  return applySnapshot(unflattenReplace(remote.state as FlatMap, useAppStore.getState().version));
}

// Adopt a session id obtained by ?s= link or paste. Pristine profiles adopt
// silently, otherwise the confirm dialog (SyncImport listens on
// mabiroutine:import); same-session links just pull. Binding switches keep
// the adopt-or-confirm consent model — only same-session merging is
// conflict-free.
export async function requestImport(
  id: string
): Promise<"adopted" | "confirm" | "pulled" | "uptodate" | "notfound" | "failed"> {
  try {
    const remote = await getSession(id);
    const local = loadSession();
    if (!local || local.id !== id) {
      if (isPristine()) {
        if (!adoptState(remote)) {
          toast("連結進度格式錯誤");
          return "failed";
        }
        saveSession({ id, updatedAt: remote.updatedAt });
        setSessionParam(id);
        toast("已同步到此裝置");
        return "adopted";
      }
      window.dispatchEvent(
        new CustomEvent<ImportRequest>("mabiroutine:import", {
          detail: { id, state: remote.state ?? remote.legacy, updatedAt: remote.updatedAt },
        })
      );
      return "confirm";
    }
    if (
      remote.legacy === undefined &&
      remote.state &&
      typeof remote.state === "object" &&
      JSON.stringify(remote.state) === JSON.stringify(flattenSnapshot(buildSnapshot()))
    ) {
      return "uptodate";
    }
    requestPull();
    return "pulled";
  } catch (e) {
    if (e instanceof SyncNotFound) {
      toast("此同步連結已失效");
      return "notfound";
    }
    toast("同步載入失敗，請檢查網路");
    return "failed";
  }
}
