import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore, seedMissingDefaultPins } from "@/store/useAppStore";
import { getSession, getSessionMeta, patchSession, SyncNotFound } from "@/sync/api";
import {
  saveSession,
  clearSession,
  buildSnapshot,
  applySnapshot,
  setPullHook,
  syncAndResets,
  shouldTouch,
  markActivity,
  isIdle,
  scrubBase,
  markFullPush,
  takeFullPush,
  toast,
  type LocalSession,
} from "@/sync/session";
import {
  flattenSnapshot,
  diffFlat,
  guardOrderKeys,
  loadBaseDoc,
  saveBase,
  unflattenMerge,
  capOverflowKeys,
  expiredCycleKeys,
  type FlatMap,
} from "@/sync/flat";
import { planRound } from "@/sync/round";
import { journalPush, journalRound } from "@/sync/journal";
import {
  getSyncStatus,
  markSynced,
  refreshSyncStatus,
  setSyncStatus,
  subscribeSyncStatus,
} from "@/sync/status";

export type SyncEngine = {
  /** Dialog visibility. */
  open: boolean;
  /** Open/close the dialog. Opening on an unlinked device creates the binding. */
  setOpen: (v: boolean) => void;
  /** A binding-mutating dialog action (create/paste/regenerate/cancel) is
   *  running. */
  busy: boolean;
  /** A user-requested 立即同步 round is in flight. */
  syncing: boolean;
  /** Forced pull — the 10s throttle is bypassed. */
  syncNow: () => Promise<void>;
  /** Run a binding-mutating action under the shared busy guard. Resolves
   *  undefined when the engine was already busy. */
  withBusy: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
};

function useBusy() {
  const [busy, setBusyState] = useState(false);
  const ref = useRef(false);
  const set = useCallback((v: boolean) => {
    ref.current = v;
    setBusyState(v);
  }, []);
  return [busy, set, ref] as const;
}

export function useSyncEngine(enabled: boolean): SyncEngine {
  const [open, setOpen] = useState(false);
  const [busy, setBusy, busyRef] = useBusy();
  const [syncing, setSyncingState] = useState(false);

  // Mirrors for the background sync loop (runs outside React state updates).
  const linkedRef = useRef<LocalSession | null>(getSyncStatus().linked);
  const lastPullAt = useRef(0);
  const inflightRef = useRef<Promise<void> | null>(null);
  const pushInflight = useRef<Promise<FlatMap | null> | null>(null);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pushFails = useRef(0);
  const pulledSessionRef = useRef<string | null>(null);

  function reachable(): void {
    markSynced();
    setSyncStatus({ failing: false });
  }

  function pushFailed(): void {
    pushFails.current += 1;
    if (pushFails.current === 3) {
      toast("自動同步失敗，請檢查網路");
      setSyncStatus({ failing: true });
    }
  }

  function pushLanded(): void {
    pushFails.current = 0;
    markSynced();
    setSyncStatus({ failing: false });
  }

  useEffect(() => {
    const reload = () => refreshSyncStatus();
    const onStorage = (e: StorageEvent) => {
      if (e.key === "mabiroutine:session") reload();
    };
    const unsubscribe = subscribeSyncStatus((s) => {
      linkedRef.current = s.linked;
    });
    linkedRef.current = getSyncStatus().linked;
    window.addEventListener("mabiroutine:session-changed", reload);
    window.addEventListener("storage", onStorage);
    return () => {
      unsubscribe();
      window.removeEventListener("mabiroutine:session-changed", reload);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // 404 = link died server-side (revoked/expired): drop the local binding.
  function dropDeadLink(): void {
    clearSession();
    refreshSyncStatus();
    toast("此同步連結已失效");
  }

  async function flushNow(): Promise<FlatMap | null> {
    const session = linkedRef.current;
    if (!session || busyRef.current) return null;
    const baseDoc = loadBaseDoc(session.id);
    const flat = flattenSnapshot(buildSnapshot());
    const changes = takeFullPush() ? { ...flat } : diffFlat(baseDoc?.flat ?? {}, flat);
    guardOrderKeys(changes, flat, pulledSessionRef.current === session.id);
    if (Object.keys(changes).length === 0) return {};
    try {
      const updatedAt = await patchSession(session.id, changes as FlatMap, {
        touch: shouldTouch(session.id),
      });
      saveSession({ id: session.id, updatedAt });
      refreshSyncStatus();
      saveBase(session.id, { ...(baseDoc?.flat ?? {}), ...changes });
      pushLanded();
      journalPush({ sessionId: session.id, remoteTs: updatedAt, pushed: changes });
      return changes;
    } catch (e) {
      if (e instanceof SyncNotFound) {
        dropDeadLink();
        return null;
      }
      pushFailed();
      return null;
    }
  }

  async function enqueueFlush(): Promise<FlatMap | null> {
    const prev = pushInflight.current ?? Promise.resolve();
    const run = prev.then(() => flushNow(), () => flushNow());
    pushInflight.current = run;
    try {
      return await run;
    } finally {
      if (pushInflight.current === run) pushInflight.current = null;
    }
  }

  async function pushNow(): Promise<FlatMap | null> {
    if (inflightRef.current) await inflightRef.current;
    return enqueueFlush();
  }

  async function pushPlanned(session: LocalSession, keys: FlatMap): Promise<boolean> {
    try {
      await patchSession(session.id, keys, { touch: shouldTouch(session.id) });
      pushLanded();
      return true;
    } catch (e) {
      if (e instanceof SyncNotFound) {
        dropDeadLink();
        return false;
      }
      pushFailed();
      return false;
    }
  }

  async function runPull(force: boolean): Promise<void> {
    const session = linkedRef.current;
    if (!session || busyRef.current) return;
    const now = Date.now();
    if (!force && now - lastPullAt.current < 10_000) return;
    lastPullAt.current = now;
    try {
      if (pushInflight.current) await pushInflight.current;
      const baseDoc = loadBaseDoc(session.id);
      const base = baseDoc?.flat ?? {};
      const localFlat = flattenSnapshot(buildSnapshot());
      const changes = diffFlat(base, localFlat);
      guardOrderKeys(changes, localFlat, pulledSessionRef.current === session.id);
      const clean = Object.keys(changes).length === 0;
      const atCap = buildSnapshot().characters.length >= 6;
      if (clean && !atCap) {
        const knownTs = baseDoc?.ts ?? 0;
        try {
          const meta = await getSessionMeta(session.id);
          reachable();
          if (!meta.legacy && meta.updatedAt <= knownTs) return;
        } catch (e) {
          if (e instanceof SyncNotFound) {
            dropDeadLink();
            return;
          }
          return;
        }
      }
      const before = JSON.stringify(flattenSnapshot(buildSnapshot()));
      let remote = await getSession(session.id, { touch: shouldTouch(session.id) });
      reachable();
      if (remote.legacy !== undefined) {
        markFullPush();
        const full = await enqueueFlush();
        if (full === null) return;
        remote = await getSession(session.id, { touch: shouldTouch(session.id) });
        reachable();
      }
      if (!remote.state || typeof remote.state !== "object" || Array.isArray(remote.state)) return;
      if (JSON.stringify(flattenSnapshot(buildSnapshot())) !== before) {
        const plan = planRound(base, changes, remote.state as FlatMap);
        const landed = Object.keys(plan.push).length === 0 || (await pushPlanned(session, plan.push));
        if (!landed) return;
        if (Object.keys(plan.push).length > 0) saveBase(session.id, { ...base, ...plan.push });
        journalRound({
          sessionId: session.id,
          remoteTs: remote.updatedAt,
          base,
          changes,
          remote: remote.state as FlatMap,
          pushed: plan.push,
          dropped: plan.dropped,
          adopted: plan.adopted,
          aborted: true,
        });
        return;
      }
      const plan = planRound(base, changes, remote.state as FlatMap);
      if (Object.keys(plan.push).length > 0 && !(await pushPlanned(session, plan.push))) {
        return;
      }
      const serverView = plan.view;
      const merged = unflattenMerge(serverView, buildSnapshot(), useAppStore.getState().version);
      if (!applySnapshot(merged)) return;
      journalRound({
        sessionId: session.id,
        remoteTs: remote.updatedAt,
        base,
        changes,
        remote: remote.state as FlatMap,
        pushed: plan.push,
        dropped: plan.dropped,
        adopted: plan.adopted,
      });
      saveBase(session.id, serverView, remote.updatedAt);
      pulledSessionRef.current = session.id;
      const expired = expiredCycleKeys(serverView);
      if (expired.length) {
        try {
          await patchSession(
            session.id,
            Object.fromEntries(expired.map((k) => [k, null])) as FlatMap
          );
        } catch {
        }
        for (const k of expired) delete serverView[k];
      }
      scrubBase(
        session.id,
        capOverflowKeys(
          serverView,
          merged.characters.map((c) => c.id)
        )
      );
      seedMissingDefaultPins(serverView);
      saveSession({ id: session.id, updatedAt: remote.updatedAt });
      refreshSyncStatus();
    } catch (e) {
      if (e instanceof SyncNotFound) dropDeadLink();
    }
  }

  async function syncNow(): Promise<void> {
    if (!linkedRef.current || busyRef.current || syncing) return;
    setSyncingState(true);
    try {
      await pullNow(true);
    } finally {
      setSyncingState(false);
    }
  }

  async function pullNow(force = false): Promise<void> {
    if (inflightRef.current) return inflightRef.current;
    const run = runPull(force);
    inflightRef.current = run;
    try {
      await run;
    } finally {
      if (inflightRef.current === run) inflightRef.current = null;
    }
  }

  const withBusy = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (busyRef.current) return undefined;
    setBusy(true);
    try {
      return await fn();
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!enabled) return;
    const schedule = () => {
      if (!linkedRef.current) return;
      if (pushTimer.current) clearTimeout(pushTimer.current);
      pushTimer.current = setTimeout(() => void pushNow(), 3000);
    };
    const onActivity = () => {
      const wasIdle = isIdle();
      markActivity();
      if (wasIdle && linkedRef.current && document.visibilityState === "visible") {
        void syncAndResets();
      }
    };
    const onVis = () => {
      markActivity();
      if (document.visibilityState === "hidden") {
        if (pushTimer.current) clearTimeout(pushTimer.current);
        void pushNow();
      } else {
        void pullNow();
      }
    };
    const onFocus = () => {
      markActivity();
      void pullNow();
    };
    const unsub = useAppStore.subscribe(() => schedule());
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pointerdown", onActivity, { passive: true });
    window.addEventListener("keydown", onActivity);
    window.addEventListener("wheel", onActivity, { passive: true });
    window.addEventListener("touchstart", onActivity, { passive: true });
    const repoll = setInterval(() => {
      if (document.visibilityState === "visible" && !isIdle()) void syncAndResets();
    }, 300_000);
    markActivity();
    void pullNow();
    setPullHook(() => pullNow(true));
    return () => {
      unsub();
      clearInterval(repoll);
      setPullHook(null);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("wheel", onActivity);
      window.removeEventListener("touchstart", onActivity);
      if (pushTimer.current) clearTimeout(pushTimer.current);
    };
  }, [enabled]);

  return { open, setOpen, busy, syncing, syncNow, withBusy };
}
