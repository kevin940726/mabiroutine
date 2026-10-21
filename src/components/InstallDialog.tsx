import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { InstallStatus } from "@/hooks/useInstall";

const STEPS: Record<"ios" | "samsung" | "other", { steps: string[]; note: string }> = {
  ios: {
    steps: ["用 Safari 開啟這個網站", "點下方的分享按鈕", "選「加入主畫面」，再按「新增」"],
    note: "安裝後才能在 iPhone 上收到提醒通知。",
  },
  samsung: {
    steps: ["開啟瀏覽器選單", "選「加到主畫面」", "按「新增」"],
    note: "安裝後開起來更像一個 App。",
  },
  other: {
    steps: ["開啟瀏覽器選單", "選「安裝 App」或「加到主畫面」"],
    note: "安裝後開起來更像一個 App。",
  },
};

export function InstallDialog({
  open,
  onOpenChange,
  status,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: InstallStatus;
}) {
  const info = status === "ios" ? STEPS.ios : status === "samsung" ? STEPS.samsung : STEPS.other;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>安裝 App</DialogTitle>
          <DialogDescription>把 MabiRoutine 加到主畫面，開起來更快。</DialogDescription>
        </DialogHeader>
        <ol className="list-decimal space-y-1.5 pl-5 text-sm">
          {info.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="text-xs text-muted-foreground">{info.note}</p>
        <Button onClick={() => onOpenChange(false)}>知道了</Button>
      </DialogContent>
    </Dialog>
  );
}
