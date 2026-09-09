// PROTOTYPE (throwaway, dev-only): three tracker shells for one question —
// "how should the breakdown surface in checklist rows without reflowing them?"
// Switch via ?shell=overlay|line|drawer|tip or the floating bar (tracker tab only).
// Content inside shells still follows ?variant=a|b|c. Winner gets productionized;
// the rest is deleted.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronDown, ClipboardList, PinOff, X } from "lucide-react";
import { Dialog, DialogOverlay, DialogTitle } from "@/components/ui/dialog";
import {
  BreakdownVariant,
  giveHasBreakdown,
  type BreakdownVariantKey,
} from "@/components/MaterialBreakdownProto";
import { flattenBreakdown, parseItemQty, squashTree, sumLeaves, sortByPlanNeed } from "@/lib/materials";
import { useAppStore } from "@/store/useAppStore";
import { cn } from "@/lib/utils";

export type BreakdownShellKey = "overlay" | "line" | "drawer" | "tip";
export const BREAKDOWN_SHELLS: { key: BreakdownShellKey; name: string }[] = [
  { key: "overlay", name: "彈窗" },
  { key: "line", name: "一行" },
  { key: "drawer", name: "抽屜" },
  { key: "tip", name: "浮層" },
];

/** Shared shell default: ?shell=overlay|line|drawer|tip, falls back to overlay. */
export function readBreakdownShell(): BreakdownShellKey {
  const v = new URLSearchParams(window.location.search).get("shell");
  return v === "line" || v === "drawer" || v === "tip" ? v : "overlay";
}

type ShellProps = {
  barterId: string;
  give: string;
  get: string;
  variant: BreakdownVariantKey;
  /** Compact (desktop, truncated) vs roomy (mobile, wrapping) trigger styling. */
  compact?: boolean;
};

function GiveTrigger({
  give,
  open,
  hasBreakdown,
  onClick,
  compact,
  label,
}: {
  give: string;
  open?: boolean;
  hasBreakdown: boolean;
  onClick?: () => void;
  compact?: boolean;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-expanded={open}
      aria-label={label}
      className={cn(
        "inline-flex items-center gap-0.5 text-left font-medium text-foreground disabled:cursor-default",
        compact ? "max-w-[65%] align-bottom" : "max-w-full"
      )}
      disabled={!hasBreakdown || !onClick}
    >
      <span className={compact ? "truncate" : "break-words"}>{give}</span>
      {hasBreakdown && onClick && (
        <ChevronDown className={cn("h-3 w-3 shrink-0 transition-transform", open && "rotate-180")} />
      )}
    </button>
  );
}

function ShellPanel({
  open,
  onOpenChange,
  title,
  subtitle,
  children,
  placement,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  placement: "overlay" | "drawer";
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogOverlay />
        <DialogPrimitive.Content
          className={cn(
            "fixed z-50 overflow-y-auto border bg-background p-4 shadow-lg",
            // bottom sheet on mobile for both; desktop diverges:
            "inset-x-0 bottom-0 max-h-[85dvh] rounded-t-2xl pb-[max(1rem,env(safe-area-inset-bottom))]",
            placement === "overlay"
              ? "sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[min(430px,92vw)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:pb-4"
              : "sm:inset-x-auto sm:bottom-0 sm:left-auto sm:right-0 sm:top-0 sm:h-full sm:max-h-none sm:w-[min(400px,94vw)] sm:rounded-none sm:border-l sm:border-y-0 sm:border-r-0 sm:pb-4"
          )}
        >
          <div className="mb-1 flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-sm">{title}</DialogTitle>
              {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
            </div>
            <DialogPrimitive.Close
              className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="關閉"
            >
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </Dialog>
  );
}

/** Shell 1 — overlay: trigger opens a centered modal (desktop) / bottom sheet (mobile). */
function ShellOverlay({ give, get, variant, compact }: Omit<ShellProps, "barterId">) {
  const [open, setOpen] = useState(false);
  const hasBreakdown = useMemo(() => giveHasBreakdown(give), [give]);
  return (
    <>
      你給{" "}
      <GiveTrigger
        give={give}
        open={open}
        hasBreakdown={hasBreakdown}
        onClick={() => setOpen(true)}
        compact={compact}
        label="展開材料"
      />{" "}
      → 你拿 {get}
      {hasBreakdown && (
        <ShellPanel
          open={open}
          onOpenChange={setOpen}
          title={get.replace(/ ×\d+$/, "")}
          subtitle={`你給 ${give}`}
          placement="overlay"
        >
          <BreakdownVariant give={give} variant={variant} />
        </ShellPanel>
      )}
    </>
  );
}

/** Shell "line" — always-visible one-line summary, no interaction. */
function ShellLine({ give, get }: Omit<ShellProps, "barterId" | "variant" | "compact">) {
  const hasBreakdown = useMemo(() => giveHasBreakdown(give), [give]);
  const summary = useMemo(() => {
    if (!hasBreakdown) return "";
    const { name, qty } = parseItemQty(give);
    const { leaves } = flattenBreakdown(squashTree(name, qty));
    const summed = sortByPlanNeed(sumLeaves(leaves));
    const shown = summed.slice(0, 4).map((l) => `${l.name}×${l.qty}`);
    return shown.join("、") + (summed.length > 4 ? `…共${summed.length}種` : "");
  }, [give, hasBreakdown]);
  if (!hasBreakdown) {
    return (
      <>
        你給 {give} → 你拿 {get}
      </>
    );
  }
  return (
    <>
      <span className="block">
        你給 {give} → 你拿 {get}
      </span>
      <span className="mt-0.5 block truncate text-muted-foreground">材料：{summary}</span>
    </>
  );
}

/** Shell 4 — drawer: trigger opens an edge drawer (desktop) / bottom sheet (mobile). */
function ShellDrawer({ barterId, give, get, variant, compact }: ShellProps) {
  const [open, setOpen] = useState(false);
  const hasBreakdown = useMemo(() => giveHasBreakdown(give), [give]);
  const togglePin = useAppStore((s) => s.toggleBarterPin);
  return (
    <>
      你給{" "}
      <GiveTrigger
        give={give}
        open={open}
        hasBreakdown={hasBreakdown}
        onClick={() => setOpen(true)}
        compact={compact}
        label="展開材料"
      />{" "}
      → 你拿 {get}
      {hasBreakdown && (
        <ShellPanel
          open={open}
          onOpenChange={setOpen}
          title={get.replace(/ ×\d+$/, "")}
          subtitle={`你給 ${give}`}
          placement="drawer"
        >
          <BreakdownVariant give={give} variant={variant} />
          <div className="mt-3 border-t pt-3">
            <button
              onClick={() => {
                togglePin(barterId);
                setOpen(false);
              }}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <PinOff className="h-3 w-3" /> 取消釘選
            </button>
          </div>
        </ShellPanel>
      )}
    </>
  );
}

/** Shell "tip" — hover card with the full sources inlined (follows ?variant).
 * Hand-rolled (fixed-position from the trigger rect, closes on scroll/resize/
 * Escape/outside-tap) because the repo has no hover-card/popover dep and the
 * built-in Tooltip is pointer-events-none label-only. PROTOTYPE DEBT: no
 * screen-reader wiring, no reposition-on-scroll (we dismiss instead), flip
 * threshold estimated from a fixed height guess — productionize on a real
 * primitive. One input path serves all devices: hover opens (150ms delay,
 * desktop), tap toggles (touch), keyboard focuses (focus-visible only, so
 * touch taps don't double-fire with click). */
function ShellTip({ give, get, variant, compact }: ShellProps) {
  const hasBreakdown = useMemo(() => giveHasBreakdown(give), [give]);

  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; arrowX: number; above: boolean } | null>(null);
  // Pass-2 sizing: card opens at natural height (hidden), gets measured, then
  // flips/clamps. maxH stays null while content fits — no scrollbar unless the
  // breakdown exceeds the viewport space in both directions.
  const [maxH, setMaxH] = useState<number | null>(null);
  const [fitted, setFitted] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  // One shared timer: entering schedules open, leaving schedules close —
  // re-entering (e.g. moving trigger → card) cancels the pending close.
  const hoverTimer = useRef<number | null>(null);

  // Pass 1: open below the trigger at natural height (invisible for one frame).
  const placeInitial = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const w = Math.min(300, vw - 16);
    const left = Math.max(8, Math.min(r.left, vw - w - 8));
    const arrowX = Math.max(14, Math.min(r.left + r.width / 2 - left, w - 14));
    setMaxH(null);
    setFitted(false);
    setPos({ top: r.bottom, left, arrowX, above: false });
  }, []);

  const clearHoverTimer = useCallback(() => {
    if (hoverTimer.current) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  }, []);

  const openCard = useCallback(() => {
    clearHoverTimer();
    placeInitial();
    setOpen(true);
  }, [placeInitial, clearHoverTimer]);
  const closeCard = useCallback(() => {
    clearHoverTimer();
    setOpen(false);
  }, [clearHoverTimer]);

  const scheduleOpen = () => {
    clearHoverTimer();
    hoverTimer.current = window.setTimeout(openCard, 150);
  };
  // Close delay forgives diagonal pointer paths that clip the card corner.
  const scheduleClose = () => {
    clearHoverTimer();
    hoverTimer.current = window.setTimeout(closeCard, 150);
  };

  // dismiss on scroll / resize / Escape / outside-tap (touch's only way out)
  useEffect(() => {
    if (!open) return;
    const dismiss = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!triggerRef.current?.contains(t) && !cardRef.current?.contains(t)) setOpen(false);
    };
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open ]);
  useEffect(
    () => () => {
      if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    },
    []
  );

  // Pass 2: measure the natural height, then grow freely when it fits —
  // flip above, or clamp + scroll, only when the viewport forces it.
  useEffect(() => {
    if (!open || fitted) return;
    const raf = requestAnimationFrame(() => {
      const inner = innerRef.current;
      const outer = cardRef.current;
      const trigger = triggerRef.current;
      if (!inner || !outer || !trigger) return;
      const r = trigger.getBoundingClientRect();
      const vh = window.innerHeight;
      const vw = window.innerWidth;
      // Correct horizontal fit against the REAL rendered width (CSS is
      // responsive, so a hardcoded guess would drift from the stylesheet).
      const w = outer.offsetWidth;
      const left = Math.max(8, Math.min(r.left, vw - w - 8));
      const arrowX = Math.max(14, Math.min(r.left + r.width / 2 - left, w - 14));
      const natural = inner.scrollHeight;
      const spaceBelow = vh - r.bottom - 8;
      const spaceAbove = r.top - 8;
      let above = false;
      let top = r.bottom;
      let h: number | null = null;
      if (natural > spaceBelow + 1) {
        if (natural <= spaceAbove + 1) {
          above = true;
          top = r.top - 8 - natural;
        } else if (spaceAbove > spaceBelow) {
          above = true;
          h = Math.max(120, spaceAbove);
          top = Math.max(8, r.top - 8 - h);
        } else {
          h = Math.max(120, spaceBelow);
        }
      }
      setPos({ top, left, arrowX, above });
      setMaxH(h);
      setFitted(true);
    });
    return () => cancelAnimationFrame(raf);
  }, [open, fitted ]);

  if (!hasBreakdown) {
    return (
      <>
        你給 {give} → 你拿 {get}
      </>
    );
  }
  return (
    <span
      ref={wrapRef}
      onMouseEnter={scheduleOpen}
      onMouseLeave={scheduleClose}
    >
      你給{" "}
      <button
        ref={triggerRef}
        onClick={() => {
          clearHoverTimer();
          if (open) closeCard();
          else openCard();
        }}
        onFocus={(e) => {
          // focus-visible = keyboard only: touch taps skip this (click toggles),
          // so the two paths never double-fire.
          if (e.target.matches(":focus-visible")) openCard();
        }}
        onBlur={(e) => {
          if (!(e.relatedTarget instanceof Node && wrapRef.current?.contains(e.relatedTarget))) closeCard();
        }}
        aria-label={`查看${give}的材料`}
        className={cn(
          "inline-flex items-center gap-1 text-left font-medium text-foreground underline decoration-dotted underline-offset-4",
          compact ? "max-w-[65%] align-bottom" : "max-w-full"
        )}
      >
        <span className={compact ? "truncate" : "break-words"}>{give}</span>
        {/* PROTOTYPE icon: ClipboardList = "bill of materials". One-line swaps:
            Info (quietest), Receipt (shop-flavored), ShoppingBasket (matches
            採買清單 language but implies buying). */}
        <ClipboardList className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>{" "}
      → 你拿 {get}
      {open && pos && (
        // Outer box is transparent but hoverable: its 8px padding bridges the
        // gap between trigger and card, so the pointer path never leaves the
        // wrapper (crossing dead space used to fire mouseleave and kill the card).
        <div
          ref={cardRef}
          role="tooltip"
          style={{ top: pos.top, left: pos.left, visibility: fitted ? "visible" : "hidden" }}
          // whitespace-normal: the card is a DOM child of the row, and the
          // desktop row wraps the trigger in a truncate span (white-space:
          // nowrap, inherited) — without this reset nothing inside wraps.
          // text-pretty: fewer dangling single chars on wrapped CJK lines.
          className={cn(
            "fixed z-50 w-[min(300px,78vw)] break-words whitespace-normal text-pretty sm:w-[430px]",
            pos.above ? "pb-2" : "pt-2"
          )}
        >
          <span
            aria-hidden
            style={{ left: pos.arrowX }}
            className={cn(
              "absolute z-10 h-3 w-3 -translate-x-1/2 rotate-45 border-border bg-popover",
              pos.above ? "bottom-[3px] border-b border-r" : "top-[3px] border-l border-t"
            )}
          />
          <div
            ref={innerRef}
            style={{ maxHeight: maxH ?? undefined }}
            className="overflow-y-auto rounded-xl border bg-popover p-3 shadow-lg"
          >
            <BreakdownVariant give={give} variant={variant} />
          </div>
        </div>
      )}
    </span>
  );
}

/** Shell dispatcher — renders the give→get line for one tracker barter row. */
export function TrackerGiveShell(props: ShellProps & { shell: BreakdownShellKey }) {
  const { shell, ...rest } = props;
  if (shell === "line") return <ShellLine {...rest} />;
  if (shell === "drawer") return <ShellDrawer {...rest} />;
  if (shell === "tip") return <ShellTip {...rest} />;
  return <ShellOverlay {...rest} />;
}

/** Floating shell switcher — dev only, tracker tab only (never ships). */
export function ShellSwitcher({ shell, onChange }: { shell: BreakdownShellKey; onChange: (v: BreakdownShellKey) => void }) {
  if (!import.meta.env.DEV) return null;
  return (
    <div className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full border bg-black px-2 py-1.5 text-white shadow-lg">
      {BREAKDOWN_SHELLS.map((s, i) => (
        <button
          key={s.key}
          onClick={() => onChange(s.key)}
          aria-label={`切換到${s.name}`}
          className={cn(
            "rounded-full px-2.5 py-1.5 text-xs font-semibold",
            shell === s.key ? "bg-white text-black" : "hover:bg-white/20"
          )}
        >
          {i + 1} · {s.name}
        </button>
      ))}
    </div>
  );
}
