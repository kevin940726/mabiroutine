import { useAppStore, migratePersisted } from "@/store/useAppStore";
import type { AppState } from "@/lib/types";

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

export function stripSessionParam(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("s");
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
