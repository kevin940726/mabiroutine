import { useEffect, useState } from "react";
import { useAppStore } from "@/store/useAppStore";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { getSession, SyncNotFound } from "@/sync/api";
import {
  loadSession,
  saveSession,
  applySnapshot,
  isPristine,
  sessionIdFromUrl,
  stripSessionParam,
  toast,
  type ImportRequest,
} from "@/sync/session";
import type { ConflictInfo } from "@/sync/SyncButton";

type ImportState = { id: string; state: unknown; updatedAt: number };

// Handles ?s= on boot: unknown id → adopt dialog; same id + remote newer →
// conflict bus (SyncButton renders it); dead link → notice + strip param.
export function SyncImport() {
  const hasHydrated = useAppStore((s) => s._hasHydrated);
  const [importing, setImporting] = useState<ImportState | null>(null);

  useEffect(() => {
    const onManual = (e: Event) => setImporting((e as CustomEvent<ImportRequest>).detail);
    window.addEventListener("mabiroutine:import", onManual);
    return () => window.removeEventListener("mabiroutine:import", onManual);
  }, []);

  useEffect(() => {
    if (!hasHydrated) return;
    const incoming = sessionIdFromUrl();
    if (!incoming) return;
    (async () => {
      try {
        const remote = await getSession(incoming);
        const local = loadSession();
        if (!local || local.id !== incoming) {
          // Pristine profile (fresh incognito): nothing to lose, adopt
          // silently. Otherwise ask — the link replaces local progress.
          if (isPristine()) {
            if (!applySnapshot(remote.state)) {
              toast("連結進度格式錯誤");
            } else {
              saveSession({ id: incoming, updatedAt: remote.updatedAt });
              toast("已同步到此裝置");
            }
          } else {
            setImporting({ id: incoming, state: remote.state, updatedAt: remote.updatedAt });
          }
        } else if (remote.updatedAt > local.updatedAt) {
          const detail: ConflictInfo = { id: incoming, remoteUpdatedAt: remote.updatedAt, remoteState: remote.state };
          window.dispatchEvent(new CustomEvent<ConflictInfo>("mabiroutine:conflict", { detail }));
        }
        // same session, local current or newer — nothing to do, stay linked.
      } catch (e) {
        if (e instanceof SyncNotFound) {
          toast("此同步連結已失效");
          stripSessionParam();
        } else {
          toast("同步載入失敗，請檢查網路");
        }
      }
    })();
  }, [hasHydrated]);

  function adopt(): void {
    if (!importing) return;
    if (!applySnapshot(importing.state)) {
      toast("連結進度格式錯誤");
      return;
    }
    saveSession({ id: importing.id, updatedAt: importing.updatedAt });
    setImporting(null);
    // keep ?s= : this device is now bound to the shared session.
    toast("已同步到此裝置");
  }

  return (
    <Dialog open={importing !== null} onOpenChange={(v) => !v && (setImporting(null), stripSessionParam())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle asChild>
            <h1 className="text-lg font-semibold leading-none tracking-tight mb-2">同步到此裝置</h1>
          </DialogTitle>
          <DialogDescription>此連結的進度將取代本機進度。確定要在這台裝置繼續嗎？</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => (setImporting(null), stripSessionParam())}>
            取消
          </Button>
          <Button onClick={adopt}>同步到此裝置</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
