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
import {
  saveSession,
  sessionIdFromUrl,
  stripSessionParam,
  requestImport,
  adoptState,
  toast,
  type ImportRequest,
} from "@/sync/session";

type ImportState = { id: string; state: unknown; updatedAt: number };

// Handles ?s= on boot: unknown id → adopt dialog (silent when pristine);
// same id → pull round (merges deterministically, never conflicts);
// dead link → notice + strip param.
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
    void requestImport(incoming).then((status) => {
      if (status === "notfound") stripSessionParam();
    });
  }, [hasHydrated]);

  function adopt(): void {
    if (!importing) return;
    if (!adoptState(importing)) {
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
