import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Loader2, Copy, RefreshCw } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import {
  createSession,
  deleteSession,
  SyncTooLarge,
  SyncRateLimited,
} from "@/sync/api";
import {
  saveSession,
  clearSession,
  buildSnapshot,
  syncUrl,
  copyText,
  sessionIdFromText,
  requestImport,
  stripSessionParam,
  loadLastSessionId,
  toast,
} from "@/sync/session";
import { flattenSnapshot, creationState } from "@/sync/flat";
import { useSyncStatus } from "@/sync/status";
import type { SyncEngine } from "@/sync/useSyncEngine";

function errorMessage(e: unknown): string {
  if (e instanceof SyncTooLarge) return "進度過大，無法同步";
  if (e instanceof SyncRateLimited) return "操作太頻繁，請稍後再試";
  return "同步失敗，請檢查網路";
}

function formatSyncTime(ts: number): string {
  if (!ts) return "尚未同步";
  const at = new Date(ts);
  const today = new Date();
  const time = at.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false });
  return at.toDateString() === today.toDateString()
    ? `上次同步 ${time}`
    : `上次同步 ${at.getMonth() + 1}/${at.getDate()} ${time}`;
}

type Confirming = null | "regen" | "cancel";

export function SyncDialog({ engine }: { engine: SyncEngine }) {
  const { linked, syncedAt } = useSyncStatus();
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [pasteValue, setPasteValue] = useState("");
  const [pasteBusy, setPasteBusy] = useState(false);
  const [ensureError, setEnsureError] = useState(false);
  const [copiedTick, setCopiedTick] = useState(0);

  // Copy-confirmation bubble lives inside the dialog — the global toast would
  // render underneath the dialog overlay.
  useEffect(() => {
    if (!copiedTick) return;
    const id = setTimeout(() => setCopiedTick(0), 1500);
    return () => clearTimeout(id);
  }, [copiedTick]);

  const ensureCreated = useCallback(async (): Promise<void> => {
    if (linked || engine.busy) return;
    setEnsureError(false);
    await engine.withBusy(async () => {
      try {
        const flat = flattenSnapshot(buildSnapshot());
        const { id, updatedAt } = await createSession(creationState(flat, loadLastSessionId()));
        const next = { id, updatedAt };
        saveSession(next);
        stripSessionParam();
        if (await copyText(syncUrl(id))) setCopiedTick((t) => t + 1);
        else toast("請手動複製下方連結");
      } catch (e) {
        setEnsureError(true);
        toast(errorMessage(e));
      }
    });
  }, [linked, engine]);

  const wasOpen = useRef(false);
  useEffect(() => {
    if (engine.open && !wasOpen.current) {
      setConfirming(null);
      void ensureCreated();
    }
    wasOpen.current = engine.open;
  }, [engine.open, ensureCreated]);

  function handleOpenChange(v: boolean): void {
    engine.setOpen(v);
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
    engine.setOpen(false);
    setPasteValue("");
    try {
      await requestImport(id);
    } finally {
      setPasteBusy(false);
    }
  }

  async function regenerate(): Promise<void> {
    if (!linked || engine.busy) return;
    await engine.withBusy(async () => {
      try {
        const oldId = linked.id;
        const flat = flattenSnapshot(buildSnapshot());
        const { id, updatedAt } = await createSession(creationState(flat, oldId));
        try {
          await deleteSession(oldId);
        } catch {
          // The old link may linger; the new one is already live.
        }
        saveSession({ id, updatedAt });
        stripSessionParam();
        setConfirming(null);
        if (await copyText(syncUrl(id))) setCopiedTick((t) => t + 1);
        else toast("請手動複製下方連結");
      } catch (e) {
        toast(errorMessage(e));
      }
    });
  }

  async function confirmCancel(): Promise<void> {
    if (!linked || engine.busy) return;
    await engine.withBusy(async () => {
      try {
        await deleteSession(linked.id);
        clearSession();
        setConfirming(null);
        stripSessionParam();
        engine.setOpen(false);
        toast("已取消同步");
      } catch (e) {
        toast(errorMessage(e));
      }
    });
  }

  return (
    <Dialog open={engine.open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <div className="space-y-4">
          <DialogHeader>
            <DialogTitle asChild>
              <h2 className="text-lg font-semibold leading-none tracking-tight mb-2">跨裝置同步</h2>
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
                placeholder={engine.busy ? "產生連結中…" : ""}
                ref={(el) => {
                  if (el && linked) el.scrollLeft = el.scrollWidth;
                }}
                onFocus={(e) => {
                  e.target.select();
                  e.target.scrollLeft = e.target.scrollWidth;
                }}
                onClick={() => void copyCurrentLink()}
                aria-label="sync link, tap to copy"
                className="cursor-pointer font-mono text-base text-right"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => void copyCurrentLink()}
                disabled={!linked || engine.busy}
                className="shrink-0"
              >
                {engine.busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    複製
                  </>
                )}
              </Button>
            </div>
            {ensureError && !engine.busy && (
              <div className="mt-2 flex items-center gap-2">
                <p className="text-xs text-destructive">同步失敗，請檢查網路。</p>
                <Button variant="ghost" size="sm" onClick={() => void ensureCreated()}>
                  再試一次
                </Button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Input
              value={pasteValue}
              onChange={(e) => setPasteValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submitPaste();
              }}
              placeholder="貼上同步連結加入此裝置"
              aria-label="paste sync link"
              className="font-mono text-base"
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
                <Button size="sm" onClick={() => void regenerate()} disabled={engine.busy}>
                  {engine.busy ? "處理中" : "確認重新產生"}
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
                <Button variant="destructive" size="sm" onClick={() => void confirmCancel()} disabled={engine.busy}>
                  {engine.busy ? "處理中" : "確認取消同步"}
                </Button>
              </div>
            </div>
          ) : (
            linked && (
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void engine.syncNow()}
                    disabled={engine.busy || engine.syncing}
                    className="shrink-0"
                  >
                    {engine.syncing ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                    立即同步
                  </Button>
                  <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                    {formatSyncTime(syncedAt)}
                  </span>
                </div>
                <div className="flex items-center shrink-0">
                  <Button variant="ghost" size="sm" onClick={() => setConfirming("regen")} disabled={engine.busy}>
                    <RefreshCw className="h-3.5 w-3.5" />
                    重新產生連結
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirming("cancel")}
                    disabled={engine.busy}
                    className="text-destructive hover:text-destructive"
                  >
                    取消同步
                  </Button>
                </div>
              </div>
            )
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
