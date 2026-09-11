// Hover card for a tracker barter row's give→get line: hover (desktop, 150ms
// delay), tap (touch) or keyboard focus opens a lightweight non-modal card
// with the full material sources inline. The row never reflows.
// Hand-rolled positioning (fixed from the trigger rect, dismiss on
// scroll/resize/Escape/outside-tap) — the repo has no hover-card/popover dep
// and the built-in Tooltip is pointer-events-none label-only. Known limits:
// no screen-reader wiring, dismisses on scroll instead of repositioning.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReceiptText } from "lucide-react";
import {
  MaterialBreakdown,
  giveHasBreakdown,
} from "@/components/MaterialBreakdown";
import { cn } from "@/lib/utils";

type Props = {
  give: string;
  get: string;
  /** Compact (desktop, truncated row) vs roomy (mobile, wrapping row) trigger. */
  compact?: boolean;
  /** Whole-deal multiplier for the 共需 line — the caller resolves it from
   *  the row's exchange limit (default 1). */
  times?: number;
};

export function MaterialHoverCard({ give, get, compact, times }: Props) {
  const hasBreakdown = useMemo(() => giveHasBreakdown(give), [give]);

  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; arrowX: number; above: boolean } | null>(null);
  // Card opens at natural height (hidden), gets measured, then flips/clamps.
  // maxH stays null while content fits — no scrollbar unless the breakdown
  // exceeds the viewport space in both directions.
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
        <ReceiptText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
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
            <MaterialBreakdown give={give} bare times={times} />
          </div>
        </div>
      )}
    </span>
  );
}
