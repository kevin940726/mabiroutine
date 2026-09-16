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
export function confirmSubscribeReminder(): Promise<boolean> {
  return confirmAction({
    title: "訂閱開場提醒？",
    body: "每小時整點跳一則通知，只在 App 開著時響。提醒只記在這台裝置，點鈴鐺隨時可取消。按確定後，瀏覽器會再問一次是否允許通知。",
    confirmText: "訂閱",
    cancelText: "先不要",
    danger: false,
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
          <Button variant="outline" onClick={() => close(false)}>
            {req?.cancelText}
          </Button>
          <Button variant={req?.danger === false ? "default" : "destructive"} onClick={() => close(true)}>
            {req?.confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
