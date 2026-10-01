// Hover card for a tracker barter row's give→get line: hover (desktop, 150ms
// delay), tap (touch) or keyboard focus opens a lightweight non-modal card
// with the full material sources inline. The row never reflows.
// Hand-rolled positioning (fixed from the trigger rect, dismiss on
// scroll/resize/Escape/outside-tap) — the repo has no hover-card/popover dep
// and the built-in Tooltip is pointer-events-none label-only. Known limits:
// no screen-reader wiring, dismisses on scroll instead of repositioning.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, ReceiptText } from "lucide-react";
import {
  MaterialBreakdown,
  giveHasBreakdown,
} from "@/components/MaterialBreakdown";
import { cn } from "@/lib/utils";
import { displayName, parseItemQty } from "@/lib/materials";

type Props = {
  give: string;
  get: string;
  /** Compact (desktop, truncated row) vs roomy (mobile, wrapping row) trigger. */
  compact?: boolean;
  /** Whole-deal multiplier for the 共需 line — the caller resolves it from
   *  the row's exchange limit (default 1). */
  times?: number;
  /** Shorten the trigger line for a narrow column. Drops the 你給/你拿
   *  verbs (the arrow already says which side is which) and a trailing ×1, which
   *  says nothing about what you hand over (41 of the 100 barter rows are ×1).
   *  The card is unchanged, so the full 你給 X ×N → 你拿 Y is still there on hover.
   *
   *  A whole-deal ×N is NOT dropped: dealTimes multiplies the 共需 total by it, so
   *  hiding it would leave the total unexplained. It is not added to the card
   *  either, because the total already spells it out as 共需（N次）.
   *
   *  Off by default: the tracker's row is wide enough for the full line, so only the
   *  shop tile turns it on. */
  terse?: boolean;
  /** Drop the item you receive from the trigger line, keeping only `give →`. Only
   *  correct when the caller renders that item elsewhere on screen — the shop tile's
   *  title is exactly that item, one line above. Off by default, so the tracker's row
   *  still names both ends of the trade. */
  getless?: boolean;
  /** Optional footer action, e.g. the shop tile's 在商店中查看 link. Rendered only
   *  when the caller passes it, so the tracker's two call sites are unchanged.
   *
   *  A plain <button>, not an <a href>: the jump is a state transition inside a
   *  mounted panel (a URL click would reload the app and lose the very state the
   *  jump needs). The caller owns what happens — the card only draws the control
   *  and closes itself first. */
  action?: { label: string; onClick: () => void };
  /** Barter framing for the breakdown: the producer, the exchange, and the cap. Passed
   *  straight through so the card shows the real deal instead of echoing the hovered
   *  item's name. */
  barter?: {
    exclusive: boolean;
    limit?: string;
    npc?: string;
    town?: string;
    cost?: { name: string; qty: number };
    out?: { name: string; qty: number };
  };
};

/** The item name with its quantity, rendered the ONE way a cost band renders it.
 *
 *  There were two renderings and they did not match: `TradeLine`'s no-recipe
 *  branch split the name from its ` ×N` with `parseItemQty` and drew the count as
 *  a small muted span, while the with-recipe branch printed the whole string, so
 *  its `×N` came out as ordinary body text at full size and colour. Side by side in
 *  the same grid the two read as different kinds of information — measured across
 *  the shop: 9 tiles styled, 25 plain for the same fact.
 *
 *  The styled form wins: the count is secondary to the name, which is what the
 *  muted 11px span says, and it keeps the digits `tabular-nums` so a column of
 *  costs lines up. Nothing about the with-recipe branch wanted plain text; it was
 *  simply the branch that never got the split.
 *
 *  `text` is the data's string (`皮革+ ×10`), NOT a display name: `parseItemQty`
 *  runs first so the quantity is separated, then `displayName` folds only the name
 *  it returns. */
export function QtyName({ text }: { text: string }) {
  const { name, qty } = parseItemQty(text);
  return (
    <>
      {displayName(name)}
      {qty > 1 && (
        <span className="ml-1 text-[11px] whitespace-nowrap tabular-nums text-muted-foreground">×{qty}</span>
      )}
    </>
  );
}

export function MaterialHoverCard({ give, get, compact, times, terse, getless, action, barter }: Props) {
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
        {terse ? "" : "你給 "}
        <QtyName text={give} />
        {getless ? null : <>{"\u00a0→ "}{terse ? "" : "你拿 "}<QtyName text={get} /></>}
      </>
    );
  }
  return (
    <span
      ref={wrapRef}
      // Pointer events, not mouse events, and only for a pointer that can actually
      // hover. A touch tap fires an emulated mouseenter AND mouseleave within a few
      // ms of the click: measured at 390px, click at 38ms then mouseleave at 46ms,
      // which scheduled the 150ms close and killed the card the tap had just opened.
      // Asking the pointer what it is avoids guessing — a tap is pointerType
      // "touch" and neither schedules an open nor a close, so the click handler
      // owns the card and a second tap closes it. Pen and mouse still hover.
      onPointerEnter={(e) => {
        if (e.pointerType !== "touch") scheduleOpen();
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== "touch") scheduleClose();
      }}
    >
      {terse ? null : "你給 "}
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
        aria-label={`查看${parseItemQty(give).name}的材料`}
        className={cn(
          "inline-flex items-center gap-1 text-left font-medium text-foreground underline decoration-dotted underline-offset-4",
          compact ? "max-w-[65%] align-bottom" : "max-w-full"
        )}
      >
        <span className={compact ? "truncate" : "break-words"}><QtyName text={give} /></span>
        <ReceiptText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>{" "}
      {/* One separator for both sides, so getless can drop the separator with the
          item it introduced instead of leaving a dangling arrow. A no-break space on
          each side is what the literal " → " was giving, so nothing else changes.
          getless is legitimate when the caller already prints the item you receive:
          the tile's 15px bold title is the same item. The card keeps the full
          你給 X → 你拿 Y, so hovering still names both.
          Still a prop rather than implied by terse: the tracker's row keeps both
          names, and losing the item from the only place it appeared would be a silent
          regression. */}
      {getless ? null : <>{"\u00a0→ "}{terse ? null : "你拿 "}<QtyName text={get} /></>}
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
          // text-left: same reason as whitespace-normal, for the OTHER inherited
          // property. The shop tile centres its cost band (the trigger line reads
          // better centred under the art), and the card is a DOM child of that
          // band, so it inherits text-align:center and every line inside the card
          // comes out centred — the deal line, the 共需 total, the footer button's
          // label. Centring is right for the short trigger under the art and wrong
          // for a card of stacked sentences, so the card resets it here rather than
          // the tile giving up its centring. Measured: card computed text-align was
          // `center` before this, `left` after.
          className={cn(
            "fixed z-50 w-[min(300px,78vw)] break-words whitespace-normal text-left text-pretty sm:w-[430px]",
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
            <MaterialBreakdown give={give} bare times={times} barter={barter} />
            {action && (
              // Inside the scroll box, below the breakdown, so a clamped card
              // scrolls to reach it. Closing first matters: the jump scrolls the
              // page, and an open card dismisses itself on scroll anyway — doing it
              // here keeps the two from racing and leaves no orphan card behind.
              <button
                type="button"
                onClick={() => {
                  closeCard();
                  action.onClick();
                }}
                className="mt-2 flex w-full items-center justify-center gap-1 rounded-md border py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                {action.label}
                <ArrowUpRight className="size-3.5" />
              </button>
            )}
          </div>
        </div>
      )}
    </span>
  );
}
