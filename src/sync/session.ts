import { useAppStore, migratePersisted } from "@/store/useAppStore";
import type { AppState } from "@/lib/types";
import { getSession, SyncNotFound } from "@/sync/api";
import type { ConflictInfo } from "@/sync/SyncButton";

// Local session binding: which cloud session this device is linked to, plus
// the last server timestamp we saw (the 409 guard's baseUpdatedAt). Kept OUT
// of the zustand store on purpose — no schema migration needed.
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
  window.dispatchEvent(new Event("mabiroutine:session-changed"));
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
  window.dispatchEvent(new Event("mabiroutine:session-changed"));
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
  window.dispatchEvent(new CustomEvent<string>("mabiroutine:toast", { detail: message }));
}

export type ImportRequest = { id: string; state: unknown; updatedAt: number };

// Manual counterpart of the ?s= boot flow: adopt a session id obtained by
// paste (link taps can't reach every bucket — iOS web app, mismatched
// Android browsers). Pristine profiles adopt silently, otherwise the confirm
// dialog (SyncImport listens on mabiroutine:import); same-session-newer
// remote goes to the conflict bus.
export async function requestImport(id: string): Promise<void> {
  try {
    const remote = await getSession(id);
    const local = loadSession();
    if (!local || local.id !== id) {
      if (isPristine()) {
        if (!applySnapshot(remote.state)) {
          toast("連結進度格式錯誤");
        } else {
          saveSession({ id, updatedAt: remote.updatedAt });
          setSessionParam(id);
          toast("已同步到此裝置");
        }
      } else {
        window.dispatchEvent(
          new CustomEvent<ImportRequest>("mabiroutine:import", {
            detail: { id, state: remote.state, updatedAt: remote.updatedAt },
          })
        );
      }
    } else if (remote.updatedAt > local.updatedAt) {
      const detail: ConflictInfo = { id, remoteUpdatedAt: remote.updatedAt, remoteState: remote.state };
      window.dispatchEvent(new CustomEvent<ConflictInfo>("mabiroutine:conflict", { detail }));
    } else {
      toast("已是最新");
    }
  } catch (e) {
    if (e instanceof SyncNotFound) toast("此同步連結已失效");
    else toast("同步載入失敗，請檢查網路");
  }
}
