import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Request = {
  title: string;
  body: string;
  confirmText: string;
  cancelText: string;
  danger: boolean;
  single: boolean;
  resolve: (v: boolean) => void;
};

let pushRequest: ((r: Request) => void) | null = null;

// Promise-based confirm for destructive actions. Resolves false (cancel) if
// the host isn't mounted — deletion never proceeds without an explicit tap.
export function confirmAction(opts: {
  title: string;
  body: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  single?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    if (!pushRequest) {
      resolve(false);
      return;
    }
    pushRequest({
      title: opts.title,
      body: opts.body,
      confirmText: opts.confirmText ?? "刪除",
      cancelText: opts.cancelText ?? "取消",
      danger: opts.danger ?? true,
      single: opts.single ?? false,
      resolve,
    });
  });
}

export function confirmRemoveCharacter(name: string): Promise<boolean> {
  return confirmAction({
    title: "刪除角色",
    body: `確定要刪除「${name}」嗎？此角色的所有進度將一併刪除，且無法復原。`,
  });
}

export function confirmRemoveTask(name: string): Promise<boolean> {
  return confirmAction({
    title: "刪除自訂任務",
    body: `確定要刪除「${name}」嗎？此動作無法復原。`,
  });
}

export function confirmClearSection(title: string): Promise<boolean> {
  return confirmAction({
    title: "清除本區",
    body: `確定要清除「${title}」的所有進度嗎？此動作無法復原。`,
    confirmText: "清除",
  });
}

// Soft-ask before the browser notification permission prompt: cold prompts
// get reflex-denied, and a denial can only be undone in browser settings.
// Non-destructive styling (danger: false) — subscribing takes nothing away.
export function confirmSubscribeReminder(taskName: string, body?: string): Promise<boolean> {
  return confirmAction({
    title: `訂閱通知：${taskName}`,
    body:
      body ??
      "每小時整點提醒一次，App 沒開就不會響。設定只留在這台裝置，隨時點鈴鐺就能取消。按下訂閱後，瀏覽器會再確認一次（Chrome 的提示在左上角），請選允許。",
    confirmText: "訂閱",
    cancelText: "取消",
    danger: false,
  });
}

// Shown when permission is already denied: no prompt will ever appear again,
// so say where the switch is in plain words. Single button — closing it just
// means "got it"; the watcher keeps retrying silently and auto-completes if
// they flip the switch in settings.
export function confirmReenableReminder(): Promise<boolean> {
  return confirmAction({
    title: "通知被瀏覽器擋下了",
    body: "之前在瀏覽器按了封鎖，所以詢問不會再跳出來。想開啟的話，點網址列左邊的圖示進入網站設定，把通知改成允許。改完回到這頁，訂閱會自動完成，不用重整。",
    confirmText: "關閉",
    danger: false,
    single: true,
  });
}

// Mount once near the app root. One dialog at a time; a new request while one
// is open resolves the old one as cancelled.
export function ConfirmHost() {
  const [req, setReq] = useState<Request | null>(null);
  useEffect(() => {
    pushRequest = (r) => {
      setReq((prev) => {
        prev?.resolve(false);
        return r;
      });
    };
    return () => {
      pushRequest = null;
    };
  }, []);
  const close = (v: boolean) => {
    setReq((prev) => {
      prev?.resolve(v);
      return null;
    });
  };
  return (
    <Dialog
      open={!!req}
      onOpenChange={(o) => {
        if (!o) close(false);
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{req?.title}</DialogTitle>
          <DialogDescription>{req?.body}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          {req?.single !== true && (
            <Button variant="outline" onClick={() => close(false)}>
              {req?.cancelText}
            </Button>
          )}
          <Button variant={req?.danger === false ? "default" : "destructive"} onClick={() => close(true)}>
            {req?.confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
