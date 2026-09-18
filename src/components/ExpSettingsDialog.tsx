import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { isPushEnabled, setPushFlag } from "@/lib/hourlyReminders";
import { PURPLE_HOLE_ID, isPurpleHoleEnabled, setPurpleHoleFlag } from "@/lib/purpleHole";
import { unsubscribeServerPush } from "@/lib/serverPush";
import { useAppStore } from "@/store/useAppStore";

// Experimental feature toggles. The dialog is the only writer of these
// per-device slots (query-param entry is removed — it never worked inside
// an installed PWA, which has no URL bar). Toggling applies on close with
// one reload: the flags are read-once gates everywhere, so batching + a
// single reload is the honest apply.

function ExpRow({
  on,
  title,
  desc,
  descId,
  onToggle,
}: {
  on: boolean;
  title: string;
  desc: string;
  descId: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-describedby={descId}
      onClick={onToggle}
      className="flex w-full items-center gap-3 rounded-xl border bg-card px-3 py-2.5 text-left transition-colors hover:border-primary"
    >
      <span
        aria-hidden="true"
        className={cn(
          "grid h-6 w-6 shrink-0 place-items-center rounded-md border transition-colors",
          on ? "border-emerald-600 bg-emerald-600 text-white" : "bg-card"
        )}
      >
        <span className="text-sm leading-none">{on ? "✓" : ""}</span>
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        <span id={descId} className="block text-xs text-muted-foreground">
          {desc}
        </span>
      </span>
    </button>
  );
}

/**
 * Bell-off semantics for flag-off: the server row + device sub + local lane
 * entry all go, or an orphan keeps firing after the feature reads off.
 * Single-task scope today (`barrier` is the only hourly subscriber), so the
 * id is literal — same assumption `unsubscribeServerPush` documents.
 * Resolves, never rejects (every half is best-effort inside).
 */
function disarmHourlyLanes(): Promise<void> {
  try {
    const s = useAppStore.getState();
    if ((s.hourlyReminders ?? []).includes("barrier")) s.toggleHourlyReminder("barrier");
  } catch {
    // store unreachable: the local lane just stays as-is; the flag gates
    // cover it after the reload, and the server half still runs below.
  }
  return unsubscribeServerPush("barrier");
}

/**
 * Same bug class, purple lane: the purple server row outlives the purple
 * flag the same way. Single subscriber today (`purple-hole`), same
 * literal-id assumption as the hourly half.
 */
function disarmPurpleLanes(): Promise<void> {
  try {
    const s = useAppStore.getState();
    if ((s.purpleHoleReminders ?? []).includes(PURPLE_HOLE_ID)) {
      s.togglePurpleReminder(PURPLE_HOLE_ID);
    }
  } catch {
    // store unreachable: the flag gates cover the local lane after the
    // reload, and the server half still runs below.
  }
  return unsubscribeServerPush(PURPLE_HOLE_ID, "purple");
}

export function ExpSettingsDialog() {
  const [open, setOpen] = useState(false);
  const [push, setPush] = useState(false);
  const [purple, setPurple] = useState(false);
  // Toggles apply to storage immediately but reload only once on close, and
  // only on a net change — flipping on-then-off in one visit reloads nothing.
  const [initial, setInitial] = useState({ push: false, purple: false });
  const refresh = () => {
    const p = isPushEnabled();
    const h = isPurpleHoleEnabled();
    setPush(p);
    setPurple(h);
    setInitial({ push: p, purple: h });
  };
  const flip = (which: "push" | "purple", on: boolean) => {
    if (which === "push") {
      setPushFlag(!on);
      setPush(!on);
      // Flag-off must actually stop cards: the server row outlives the flag
      // (it lives in Turso, not in the flag slot), so disarm both lanes with
      // bell-off semantics. Fired here for the slow-close path; the close
      // handler below awaits it for the fast-close path (a reload can cancel
      // the in-flight DELETE). Idempotent — double calls are safe.
      if (on) void disarmHourlyLanes().catch(() => {});
    } else {
      setPurpleHoleFlag(!on);
      setPurple(!on);
      if (on) void disarmPurpleLanes().catch(() => {});
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={async (v) => {
        setOpen(v);
        if (v) refresh();
        else {
          if (initial.push && !push) {
            try {
              await disarmHourlyLanes();
            } catch {
              // idempotent server-side; the fanout prune covers a miss.
            }
          }
          if (initial.purple && !purple) {
            try {
              await disarmPurpleLanes();
            } catch {
              // idempotent server-side; the fanout prune covers a miss.
            }
          }
          if (push !== initial.push || purple !== initial.purple) window.location.reload();
        }
      }}
    >
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground"
        onClick={() => {
          refresh();
          setOpen(true);
        }}
      >
        實驗性功能
      </Button>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>實驗性功能</DialogTitle>
          <DialogDescription>
            測試中的功能，可能不穩定或隨時移除。只影響這台裝置，不會同步。關閉後如有變更會重新載入一次套用。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <ExpRow
            on={push}
            title="開場提醒"
            desc="不祥的召喚結界整點提醒，含推播訂閱"
            descId="exp-row-push-desc"
            onToggle={() => flip("push", push)}
          />
          <ExpRow
            on={purple}
            title="紫洞追蹤"
            desc="深淵的黑色坑洞追蹤列與出沒提醒"
            descId="exp-row-purple-desc"
            onToggle={() => flip("purple", purple)}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
