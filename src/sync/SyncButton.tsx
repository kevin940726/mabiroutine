import { memo, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Link2, Loader2, Copy, RefreshCw } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { Separator } from "@/components/ui/separator";
import { useIsMobile } from "@/hooks/useIsMobile";
import {
  createSession,
  getSession,
  patchSession,
  deleteSession,
  SyncNotFound,
  SyncTooLarge,
  SyncRateLimited,
} from "@/sync/api";
import {
  loadSession,
  saveSession,
  clearSession,
  buildSnapshot,
  applySnapshot,
  syncUrl,
  copyText,
  sessionIdFromText,
  requestImport,
  setSessionParam,
  stripSessionParam,
  setPullHook,
  markFullPush,
  takeFullPush,
  toast,
  type LocalSession,
} from "@/sync/session";
import {
  flattenSnapshot,
  diffFlat,
  loadBase,
  saveBase,
  unflattenMerge,
  type FlatMap,
} from "@/sync/flat";

function errorMessage(e: unknown): string {
  if (e instanceof SyncTooLarge) return "進度過大，無法同步";
  if (e instanceof SyncRateLimited) return "操作太頻繁，請稍後再試";
  return "同步失敗，請檢查網路";
}

type Confirming = null | "regen" | "cancel";

// Shared session, per-key last-arrival-wins (absolute sets only).
// Header button is status + entry only: link icon, emerald tint when linked
// (both mobile + desktop). Opening the dialog ensures the session exists
// (create) so the URL is always live — no separate push button.
// Everything else (copy, paste-import, regenerate, cancel) lives in the dialog.
// There are no conflicts by construction: every merge is deterministic.
export const SyncButton = memo(function SyncButton() {
  const [linked, setLinked] = useState<LocalSession | null>(() => loadSession());
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [pasteValue, setPasteValue] = useState("");
  const [pasteBusy, setPasteBusy] = useState(false);
  const [ensureError, setEnsureError] = useState(false);
  const [copiedTick, setCopiedTick] = useState(0);
  // Mobile header is space-tight: circular icon button. Desktop: pill + text.
  const isMobile = useIsMobile();

  // Mirrors for the background sync loop (runs outside React state updates).
  const linkedRef = useRef(linked);
  linkedRef.current = linked;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const lastPullAt = useRef(0);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pushFails = useRef(0);

  // Copy-confirmation bubble lives inside the dialog (above the URL row) —
  // the global toast would render underneath the dialog overlay.
  useEffect(() => {
    if (!copiedTick) return;
    const id = setTimeout(() => setCopiedTick(0), 1500);
    return () => clearTimeout(id);
  }, [copiedTick]);

  // Import flow (?s= adopt) and other tabs mutate the binding outside
  // this component — reload it on change, not just on mount.
  useEffect(() => {
    const reload = () => setLinked(loadSession());
    const onStorage = (e: StorageEvent) => {
      if (e.key === "mabiroutine:session") reload();
    };
    window.addEventListener("mabiroutine:session-changed", reload);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("mabiroutine:session-changed", reload);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // 404 = link died server-side (revoked/expired): drop the local binding.
  function dropDeadLink(): void {
    clearSession();
    setLinked(null);
    toast("此同步連結已失效");
  }

  // Background auto-push: while linked, any progress change pushes its key
  // diff after a quiet window. Absolute sets only — the server stamps arrival
  // order, so pushes never conflict. Returns false when edits remain unsent
  // (offline/failure): callers must not clobber them.
  async function pushNow(): Promise<boolean> {
    const session = linkedRef.current;
    if (!session || busyRef.current) return true;
    const flat = flattenSnapshot(buildSnapshot());
    const base = loadBase(session.id);
    const changes = takeFullPush() ? { ...flat } : diffFlat(base, flat);
    if (Object.keys(changes).length === 0) return true;
    try {
      const updatedAt = await patchSession(session.id, changes as FlatMap);
      const next = { id: session.id, updatedAt };
      saveSession(next);
      setLinked(next);
      saveBase(session.id, { ...base, ...changes });
      pushFails.current = 0;
      return true;
    } catch (e) {
      if (e instanceof SyncNotFound) {
        dropDeadLink();
        return true; // nothing left to protect — binding is gone
      }
      pushFails.current += 1;
      if (pushFails.current === 3) toast("自動同步失敗，請檢查網路");
      return false;
    }
  }

  // Pull round: flush local edits first (arrival = order, so ours land
  // before we adopt remote), then adopt remote wholesale — safe, because the
  // flush guarantees every local key already exists remotely. Mid-flight
  // edits abort the apply; the scheduled push + next pull converge.
  // Legacy (v1 blob) sessions upgrade via one full push, then proceed.
  async function pullNow(): Promise<void> {
    const session = linkedRef.current;
    if (!session || busyRef.current) return;
    const now = Date.now();
    if (now - lastPullAt.current < 10_000) return;
    lastPullAt.current = now;
    try {
      if (!(await pushNow())) return;
      const before = JSON.stringify(flattenSnapshot(buildSnapshot()));
      let remote = await getSession(session.id);
      if (remote.legacy !== undefined) {
        markFullPush();
        if (!(await pushNow())) return;
        remote = await getSession(session.id);
      }
      if (!remote.state || typeof remote.state !== "object" || Array.isArray(remote.state)) return;
      if (JSON.stringify(flattenSnapshot(buildSnapshot())) !== before) return;
      const merged = unflattenMerge(remote.state as FlatMap, buildSnapshot(), useAppStore.getState().version);
      if (!applySnapshot(merged)) return;
      saveBase(session.id, remote.state as FlatMap);
      const next = { id: session.id, updatedAt: remote.updatedAt };
      saveSession(next);
      setLinked(next);
    } catch (e) {
      if (e instanceof SyncNotFound) dropDeadLink();
      // Network errors stay silent — the next visible/change retries.
    }
  }

  useEffect(() => {
    const schedule = () => {
      if (!linkedRef.current) return;
      if (pushTimer.current) clearTimeout(pushTimer.current);
      pushTimer.current = setTimeout(() => void pushNow(), 3000);
    };
    // Hide flushes unsynced changes; show pulls newer remote state.
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        if (pushTimer.current) clearTimeout(pushTimer.current);
        void pushNow();
      } else {
        void pullNow();
      }
    };
    // Focus without a visibility flip (side-by-side windows, app switch):
    // same throttled pull.
    const onFocus = () => void pullNow();
    const unsub = useAppStore.subscribe(() => schedule());
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onFocus);
    // Foreground re-pull: an app left open never flips visibility/focus, so
    // two active sessions could diverge silently. 60s cadence ≈ 1.5K reads
    // per user/day — noise against the ops budget. Throttle dedupes overlap
    // with visible/focus pulls.
    const repoll = setInterval(() => {
      if (document.visibilityState === "visible") void pullNow();
    }, 60_000);
    // Mount pull: this device's storage may predate another device's push.
    void pullNow();
    setPullHook(() => void pullNow());
    return () => {
      unsub();
      clearInterval(repoll);
      setPullHook(null);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onFocus);
      if (pushTimer.current) clearTimeout(pushTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dialog open pushes nothing when linked — the background loop owns that.
  // Unlinked opens create once so the URL field has something to show.
  async function ensureCreated(): Promise<void> {
    if (busyRef.current || linkedRef.current) return;
    setBusy(true);
    setEnsureError(false);
    try {
      const flat = flattenSnapshot(buildSnapshot());
      const { id, updatedAt } = await createSession(flat);
      const next = { id, updatedAt };
      saveSession(next);
      setLinked(next);
      setSessionParam(id);
      saveBase(id, flat);
      // First sync ends with the link on the clipboard, bubble confirms it.
      if (await copyText(syncUrl(id))) setCopiedTick((t) => t + 1);
      else toast("請手動複製下方連結");
    } catch (e) {
      setEnsureError(true);
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function handleOpenChange(v: boolean): void {
    setOpen(v);
    if (v) {
      setConfirming(null);
      void ensureCreated();
    }
  }

  async function copyCurrentLink(): Promise<void> {
    if (!linked) return;
    if (await copyText(syncUrl(linked.id))) {
      setCopiedTick((t) => t + 1);
    } else {
      toast("請手動複製下方連結");
    }
  }

  async function submitPaste(): Promise<void> {
    const id = sessionIdFromText(pasteValue);
    if (!id) {
      toast("連結格式錯誤");
      return;
    }
    setPasteBusy(true);
    // Step aside: the adopt-confirm renders in its own dialog.
    setOpen(false);
    setPasteValue("");
    try {
      await requestImport(id);
    } finally {
      setPasteBusy(false);
    }
  }

  async function regenerate(): Promise<void> {
    if (!linked || busy) return;
    setBusy(true);
    try {
      const oldId = linked.id;
      const flat = flattenSnapshot(buildSnapshot());
      const { id, updatedAt } = await createSession(flat);
      try {
        await deleteSession(oldId);
      } catch {
        // old link may linger; the new one is already live — don't fail the flow.
      }
      const next = { id, updatedAt };
      saveSession(next);
      setLinked(next);
      setSessionParam(id);
      setConfirming(null);
      saveBase(id, flat);
      setCopiedTick((t) => t + 1);
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirmCancel(): Promise<void> {
    if (!linked || busy) return;
    setBusy(true);
    try {
      await deleteSession(linked.id);
      clearSession();
      setLinked(null);
      setConfirming(null);
      stripSessionParam();
      setOpen(false);
      toast("已取消同步");
    } catch (e) {
      // Stay linked on failure: no orphaned live link the user can't retry.
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size={isMobile ? "icon" : "sm"}
        onClick={() => handleOpenChange(true)}
        aria-label={linked ? "已同步" : "跨裝置同步"}
        className={
          isMobile
            ? `rounded-full shrink-0 translate-x-[6px] ${linked ? "border-emerald-600/40 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400" : ""}`
            : `whitespace-nowrap shrink-0 ${linked ? "border-emerald-600/40 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400" : ""}`
        }
      >
        {/* Mobile-only +6px shift of the whole button: balances the header's
            visual weight, which otherwise sits heavy on the left. */}
        <Link2 className="h-4 w-4" />
        {isMobile ? null : linked ? "已同步" : "跨裝置同步"}
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
            <div className="space-y-4">
              <DialogHeader>
                <DialogTitle asChild>
                  <h1 className="text-lg font-semibold leading-none tracking-tight mb-2">跨裝置同步</h1>
                </DialogTitle>
                <DialogDescription>
                  {linked ? "此裝置已連結，進度變更會自動同步，另一台裝置的變更也會自動合併。" : "正在產生連結…"}
                  <br />
                  在另一台裝置開啟下方連結，兩邊共用同一份雲端進度。
                  <br />
                  若點連結無法開啟此 App（例如 iPhone 主畫面 App），可將連結貼到下方加入。
                  <br />
                  連結即是存取權限，請只傳給自己的裝置。
                </DialogDescription>
              </DialogHeader>
              <Separator />

              <div className="relative">
                {copiedTick > 0 && (
                  <span
                    key={copiedTick}
                    className="absolute -top-10 left-1/2 -translate-x-1/2 rounded-full bg-foreground px-3 py-1 text-xs text-background shadow-lg whitespace-nowrap"
                  >
                    已複製
                    <span
                      aria-hidden
                      className="absolute -bottom-[3px] left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-foreground"
                    />
                  </span>
                )}
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={linked ? syncUrl(linked.id) : ""}
                    placeholder={busy ? "產生連結中…" : ""}
                    ref={(el) => {
                      // Long URLs overflow the field — pin the scroll to the
                      // id tail (the only part worth eyeballing) on show.
                      if (el && linked) el.scrollLeft = el.scrollWidth;
                    }}
                    onFocus={(e) => {
                      e.target.select();
                      e.target.scrollLeft = e.target.scrollWidth;
                    }}
                    onClick={() => void copyCurrentLink()}
                    aria-label="sync link, tap to copy"
                    className="cursor-pointer font-mono text-xs text-right"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void copyCurrentLink()}
                    disabled={!linked || busy}
                    className="shrink-0"
                  >
                    {busy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Copy className="h-4 w-4" />
                        複製
                      </>
                    )}
                  </Button>
                </div>
                {ensureError && !busy && (
                  <div className="mt-2 flex items-center gap-2">
                    <p className="text-xs text-destructive">同步失敗，請檢查網路。</p>
                    <Button variant="ghost" size="sm" onClick={() => void ensureCreated()}>
                      再試一次
                    </Button>
                  </div>
                )}
              </div>

              {/* Manual import: link taps can't reach every bucket (iOS web
                  app, mismatched Android browsers) — paste the link here. */}
              <div className="flex items-center gap-2">
                <Input
                  value={pasteValue}
                  onChange={(e) => setPasteValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void submitPaste();
                  }}
                  placeholder="貼上同步連結加入此裝置"
                  aria-label="paste sync link"
                  className="font-mono text-xs"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void submitPaste()}
                  disabled={!pasteValue.trim() || pasteBusy}
                  className="shrink-0"
                >
                  {pasteBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "加入"}
                </Button>
              </div>

              {confirming === "regen" ? (
                <div className="space-y-3 rounded-lg border border-input p-3">
                  <p className="text-sm text-muted-foreground">
                    舊連結立即失效，其他裝置需用新連結重新連結；本機保持連結並複製新連結。
                  </p>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => setConfirming(null)}>
                      返回
                    </Button>
                    <Button size="sm" onClick={() => void regenerate()} disabled={busy}>
                      {busy ? "處理中" : "確認重新產生"}
                    </Button>
                  </div>
                </div>
              ) : confirming === "cancel" ? (
                <div className="space-y-3 rounded-lg border border-destructive/50 bg-destructive/5 p-3">
                  <p className="text-sm text-muted-foreground">
                    此裝置回到本機模式，雲端備份立即刪除。其他已連結的裝置保留目前進度，但無法再同步。
                  </p>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => setConfirming(null)}>
                      返回
                    </Button>
                    <Button variant="destructive" size="sm" onClick={() => void confirmCancel()} disabled={busy}>
                      {busy ? "處理中" : "確認取消同步"}
                    </Button>
                  </div>
                </div>
              ) : (
                linked && (
                  <div className="flex items-center justify-between">
                    <Button variant="ghost" size="sm" onClick={() => setConfirming("regen")} disabled={busy}>
                      <RefreshCw className="h-3.5 w-3.5" />
                      重新產生連結
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirming("cancel")}
                      disabled={busy}
                      className="text-destructive hover:text-destructive"
                    >
                      取消同步
                    </Button>
                  </div>
                )
              )}
            </div>
        </DialogContent>
      </Dialog>
    </>
  );
});

export function SyncToasts() {
  const [msg, setMsg] = useState<{ text: string; key: number } | null>(null);
  useEffect(() => {
    const onToast = (e: Event) => setMsg({ text: (e as CustomEvent<string>).detail, key: Date.now() });
    window.addEventListener("mabiroutine:toast", onToast);
    return () => window.removeEventListener("mabiroutine:toast", onToast);
  }, []);
  useEffect(() => {
    if (!msg) return;
    const id = setTimeout(() => setMsg(null), 2600);
    return () => clearTimeout(id);
  }, [msg]);
  if (!msg) return null;
  return (
    <div
      key={msg.key}
      className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-foreground px-4 py-2 text-xs text-background shadow-lg whitespace-nowrap max-w-[calc(100vw-2rem)] overflow-hidden text-ellipsis"
    >
      {msg.text}
    </div>
  );
}
