import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useIsMobile } from "@/hooks/useIsMobile";

export type CoachMarkKind = "prompt" | "waiting";

type Props = {
  kind: CoachMarkKind;
  taskName: string;
  onClose: () => void;
};

/**
 * "Look up" coach mark for the notification permission moment. The native
 * prompt lives in browser chrome — a page can never anchor to it exactly
 * (window position, fullscreen, and mobile bottom-sheets all move it) — so
 * this is deliberately approximate: a dimmed page (the Chrome team's own
 * tip) plus a top-center card pointing up on desktop, plain on mobile where
 * the prompt is a bottom sheet and an up-arrow would lie.
 *
 * Portaled to document.body: immune to ancestor filter/backdrop-filter
 * (e.g. the sticky blurred header) becoming the containing block for fixed
 * overlays — same reason the Radix dialog portals.
 */
export function PermissionCoachMark({ kind, taskName, onClose }: Props) {
  const isMobile = useIsMobile();
  if (kind === "waiting") {
    return createPortal(
      <div className="fixed bottom-4 left-1/2 z-[70] -translate-x-1/2" role="status" aria-live="polite">
        <div className="flex items-center gap-2 rounded-full border bg-background/95 py-2 pl-4 pr-2 shadow-lg backdrop-blur">
          <span className="whitespace-nowrap text-xs">等候通知權限中，允許後自動完成訂閱</span>
          <button
            onClick={onClose}
            aria-label="關閉等候提示"
            className="grid h-6 w-6 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>,
      document.body,
    );
  }
  return createPortal(
    // pointer-events-none: the dim must never swallow the tap on Allow —
    // it only stills the page behind the browser prompt.
    <div className="pointer-events-none fixed inset-0 z-[70]" role="status" aria-live="polite">
      <div className="absolute inset-0 bg-black/40" />
      <div className="absolute left-1/2 top-3 w-max max-w-[calc(100vw-2rem)] -translate-x-1/2">
        <div className="relative rounded-lg border bg-background px-4 py-3 text-center shadow-xl">
          {!isMobile && (
            <div aria-hidden className="absolute -top-[7px] left-1/2 h-3.5 w-3.5 -translate-x-1/2 rotate-45 border-l border-t bg-background" />
          )}
          <p className="text-sm font-bold">請在上方點「允許」</p>
          <p className="mt-1 text-xs text-muted-foreground">
            開啟「{taskName}」開場提醒。沒看到詢問？它可能縮在網址列旁，Chrome 在左上角。
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
