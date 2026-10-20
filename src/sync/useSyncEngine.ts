import { useEffect, useRef, useState } from "react";
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
  refreshSyncStatus,
  setSyncStatus,
  subscribeSyncStatus,
} from "@/sync/status";

// The background sync engine. It used to live inside the header button, which
// was fine while the button was always mounted: the loop, the visibility /
// focus handlers, the idle→active round and the debounced push were the
// button's own effects. The menu row that now carries the status unmounts
// every time the menu closes, so the engine had to leave the UI and mount once
// at App level — rendering it inside the dropdown would stop syncing whenever
// the menu is shut.
//
// Nothing about the algorithm changed in that move: the round, the base
// arbitration, the throttle and the failure accounting are the same code
// (docs/sync.md, "Client engine"). What is new is only what the move made
// possible: the binding is published to an external store (`status.ts`) so a
// component that comes and goes can read it, and the dialog's `open` lives
// here so the menu row and the dialog share one controlled dialog.
export type SyncEngine = {
  /** Dialog visibility, owned here so the menu row and the dialog are one
   *  entry point with one controlled dialog. */
  open: boolean;
  /** Open/close the dialog. Opening on an unlinked device is the dialog's cue
   *  to create the binding (so its URL field always has something to show). */
  setOpen: (v: boolean) => void;
  /** A binding-mutating dialog action (create/paste/regenerate/cancel) is
   *  running. Shared with the engine: the guard is what keeps a push off a
   *  session that is about to be deleted. */
  busy: boolean;
  /** A user-requested 立即同步 round is in flight. */
  syncing: boolean;
  /** Forced pull — the user explicitly asked, so the 10s throttle is bypassed. */
  syncNow: () => Promise<void>;
  /** Run a binding-mutating action under the shared busy guard. Resolves
   *  undefined when the engine was already busy (the caller's precondition was
   *  decided against a stale render). */
  withBusy: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
};

export function useSyncEngine(enabled: boolean): SyncEngine {
  const [open, setOpen] = useState(false);
  const [busy, setBusyState] = useState(false);
  const [syncing, setSyncingState] = useState(false);

  // Mirrors for the background sync loop (runs outside React state updates).
  const linkedRef = useRef<LocalSession | null>(getSyncStatus().linked);
  const busyRef = useRef(false);
  const lastPullAt = useRef(0);
  const inflightRef = useRef<Promise<void> | null>(null);
  // Debounced push in flight (mirrors flushNow) — a round awaits it before
  // reading the base so the plan can never race a blind push.
  const pushInflight = useRef<Promise<FlatMap | null> | null>(null);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pushFails = useRef(0);
  const pulledSessionRef = useRef<string | null>(null);
  // Binding id the last successful pull completed for. The tab-order key is
  // withheld from pushes until the first pull for the binding lands
  // (decision 4b) — a blind volunteer would overwrite canon the pull was
  // about to adopt. Binding switches reset it via the id comparison.

  function setBusy(v: boolean): void {
    busyRef.current = v;
    setBusyState(v);
  }

  // Any recognised network answer clears the failure flag; the three-failure
  // toast counter below stays exactly as it was (it only counts pushes).
  function reachable(): void {
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
    setSyncStatus({ failing: false });
  }

  // Import flow (?s= adopt) and other tabs mutate the binding outside this
  // engine — reload it on change, not just on mount.
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

  // Background auto-push: while linked, any progress change pushes its key
  // diff after a quiet window. Absolute sets only. This path reads no remote:
  // a live-tab edit is uncontested in practice, and every scheduled round
  // applies the base-arbitrated filter below. Resolves the pushed key-set
  // ({} when already in sync) or null when nothing was sent
  // (offline/failure/busy): callers must not treat remote state as newer than
  // unsent local edits. Wrapped by pushNow, which serializes it against
  // rounds so a wake's stale diff can never escape unfiltered.
  async function flushNow(): Promise<FlatMap | null> {
    const session = linkedRef.current;
    if (!session || busyRef.current) return null;
    const baseDoc = loadBaseDoc(session.id);
    const flat = flattenSnapshot(buildSnapshot());
    const changes = takeFullPush() ? { ...flat } : diffFlat(baseDoc?.flat ?? {}, flat);
    // Order-key guard (decisions 4b-4d): no order key is volunteered before
    // the binding's first pull (nobody volunteers canon blind), and a key
    // flatten omits is stripped rather than tombstoned (omission means "no
    // information", never "empty order").
    guardOrderKeys(changes, flat, pulledSessionRef.current === session.id);
    if (Object.keys(changes).length === 0) return {};
    try {
      const updatedAt = await patchSession(session.id, changes as FlatMap, {
        touch: shouldTouch(session.id),
      });
      saveSession({ id: session.id, updatedAt });
      refreshSyncStatus();
      // ts stays the last GET's: a later round re-reads once to stay honest.
      saveBase(session.id, { ...(baseDoc?.flat ?? {}), ...changes });
      pushLanded();
      journalPush({ sessionId: session.id, remoteTs: updatedAt, pushed: changes });
      return changes;
    } catch (e) {
      if (e instanceof SyncNotFound) {
        dropDeadLink();
        return null; // binding is gone — nothing left to protect or pull
      }
      pushFailed();
      return null;
    }
  }

  // A round owns the flush decision while it runs: its plan must see the base
  // the push produced, and the push must see the base the round adopted. Join
  // rather than race — a blind push interleaved with a round could carry the
  // exact stale diff the plan filters. Flushes are also chained against each
  // other (a hide-flush and a debounced timer can fire together), so a round
  // awaits the whole chain, not just the newest flush.
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

  // PATCH the plan's accepted keys with the shared failure accounting. True
  // when the push landed (or there was nothing to push); false when the caller
  // must not adopt remote (unlanded local diffs would be lost).
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

  // Round: probe → GET → plan → PATCH → merge. The base (last synced flat,
  // decision 16) is the arbiter: a local change is pushed only while the
  // remote still carries the base's value for that key; every contested key
  // adopts the remote's value instead of replaying this device's older copy.
  // That is what keeps an outdated device (unsynced leftovers, a base that
  // outlived its memory) from beating a peer by arrival order — arrival
  // cannot tell stale from fresh. The accepted push overlays the GET result;
  // a mid-flight edit lands the pre-edit diff through the same filter and
  // skips the apply (the edit stays local for the next round), so a stale
  // diff can never fall through to the blind auto-push. Legacy (v1 blob)
  // sessions upgrade via one full push, then proceed.
  // force (hook path: syncAndResets ordering + explicit same-session opens):
  // bypass the 10s background throttle. syncAndResets orders reset-after-pull,
  // so a throttled no-op pull would let checkResets prune BEFORE the fresh
  // adopt lands — on rollover boots the prune even trips the mid-flight guard
  // below and discards the mount round's apply, leaving stale state until the
  // next trigger (up to 60s). Overlapping forced runs still serialize via
  // syncAndResets' shared promise.
  async function runPull(force: boolean): Promise<void> {
    const session = linkedRef.current;
    if (!session || busyRef.current) return;
    const now = Date.now();
    if (!force && now - lastPullAt.current < 10_000) return;
    lastPullAt.current = now;
    try {
      // An in-flight debounced push must land before the plan reads the base;
      // otherwise the round could adopt a remote the push then overwrites.
      if (pushInflight.current) await pushInflight.current;
      const baseDoc = loadBaseDoc(session.id);
      const base = baseDoc?.flat ?? {};
      const localFlat = flattenSnapshot(buildSnapshot());
      const changes = diffFlat(base, localFlat);
      guardOrderKeys(changes, localFlat, pulledSessionRef.current === session.id);
      const clean = Object.keys(changes).length === 0;
      const atCap = buildSnapshot().characters.length >= 6;
      if (clean && !atCap) {
        // Freshness probe first (quota §) — ONLY when there is nothing to
        // push: a clean local against an unmoved server has nothing to adopt,
        // and contested keys cannot exist. The base's own `ts` is the
        // reference (not the binding's ack, which races the debounced state
        // write): the base only advances with the state it describes, so a
        // lost adoption cannot make this probe skip forever. At the 6-char
        // cap the probe is bypassed too: cap-slice base-scrubbing needs the
        // full body, and a skipped round followed by a push could tombstone a
        // sliced char.
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
          return; // network/rate-limit noise — the next tick retries
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
        // Edited mid-flight: adopting the GET would replace the edit, but the
        // pre-edit diff must not be left for the debounced auto-push to replay
        // blind either. Land it through the same contest filter, then advance
        // the base only by what was pushed; the edit itself stays a local diff
        // for the next round, where it is fresh by definition.
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
        return; // unlanded local diffs: adopting would drop them
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
      // ts is the GET's timestamp, not our PATCH ack: any later write (theirs
      // or ours) must re-trigger a read, so a peer write inside the
      // probe-to-PATCH window can never be skipped forever.
      saveBase(session.id, serverView, remote.updatedAt);
      pulledSessionRef.current = session.id;
      // GC: tombstone cycle keys past the retention window. Real deletes of
      // values no device reads anymore — bounds the server hash; racing
      // tabs dedupe via base-advance and tombstones-once. Not journalled:
      // maintenance deletes of inert >8-day cycle keys, not a user push.
      const expired = expiredCycleKeys(serverView);
      if (expired.length) {
        try {
          await patchSession(
            session.id,
            Object.fromEntries(expired.map((k) => [k, null])) as FlatMap
          );
        } catch {
          // best-effort — the next pull retries
        }
        for (const k of expired) delete serverView[k];
      }
      // Cap-sliced characters keep their keys server-side (never tombstoned).
      scrubBase(
        session.id,
        capOverflowKeys(
          serverView,
          merged.characters.map((c) => c.id)
        )
      );
      // Pull-aware default seeding (2026-10-06, supersedes the removed v15
      // migrate-time seed): adopted state may predate rows this device never
      // saw. Missing defaults whose keys the server never saw (absent, not
      // tombstoned) are added and ride the next push; a tombstone means
      // somebody unpinned on purpose and is respected. Runs after the merge
      // so a just-flushed local unpin is already on the server and reads as
      // a tombstone, never as an invitation to re-add.
      seedMissingDefaultPins(serverView);
      saveSession({ id: session.id, updatedAt: remote.updatedAt });
      refreshSyncStatus();
    } catch (e) {
      if (e instanceof SyncNotFound) dropDeadLink();
      // Network errors stay silent — the next visible/change retries.
    }
  }

  // Manual refresh: the background loop only pulls on mount / focus /
  // visibility / 5min-repoll (paused after 15min idle, throttled to 10s), so
  // a stale screen had no recourse except reopening via link (reported
  // 2026-09-15: desktop rename never arrived on the phone). Forced pull
  // bypasses the throttle — the user explicitly asked. The dialog's
  // last-synced readout rides the binding (every push/pull ack advances
  // updatedAt).
  async function syncNow(): Promise<void> {
    if (!linkedRef.current || busyRef.current || syncing) return;
    setSyncingState(true);
    try {
      await pullNow(true);
    } finally {
      setSyncingState(false);
    }
  }

  // Join concurrent runs: boot and focus fire a background pull and a forced
  // hook pull in the same task. Without joining, the awaited forced pull can
  // lose the mid-flight race to the sibling and abort — leaving checkResets
  // ordered behind a pull that adopted nothing. Joiners await the real
  // in-flight round instead of duplicating its GET.
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
    // Idle→active crossing runs the full pull-then-reset round (not just a
    // pull) so a return across 06:00/Monday prunes after adopting — same
    // ordering as the repoll. Throttled/serialized downstream, so a click
    // storm degrades to one round.
    const onActivity = () => {
      const wasIdle = isIdle();
      markActivity();
      if (wasIdle && linkedRef.current && document.visibilityState === "visible") {
        void syncAndResets();
      }
    };
    // Hide flushes unsynced changes; show pulls newer remote state.
    const onVis = () => {
      markActivity();
      if (document.visibilityState === "hidden") {
        if (pushTimer.current) clearTimeout(pushTimer.current);
        void pushNow();
      } else {
        void pullNow();
      }
    };
    // Focus without a visibility flip (side-by-side windows, app switch):
    // same throttled pull.
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
    // Foreground re-pull: an app left open never flips visibility/focus, so
    // two active sessions could diverge silently. 5min cadence while the user
    // was recently active (idle-pause: 15min without input stops the timer —
    // hidden/background tabs already cost nothing, this covers the visible-
    // but-untouched second-monitor case). Runs the full pull-then-reset round
    // so a tab open across 06:00/Monday still prunes after adopting. This is
    // the ONLY periodic timer (App owns wake ordering, never a second
    // interval — two timers double every poll).
    const repoll = setInterval(() => {
      if (document.visibilityState === "visible" && !isIdle()) void syncAndResets();
    }, 300_000);
    // Mount pull: this device's storage may predate another device's push.
    // (The hook below joins this run when still in flight, else re-pulls
    // forced — either way boot checkResets sees fresh remote.)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return { open, setOpen, busy, syncing, syncNow, withBusy };
}
