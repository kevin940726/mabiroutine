// Timetable popover for 深淵的黑色坑洞: click-toggle, read-only, past 2 +
// next 3 predicted spawns. Positioning + dismiss (scroll/resize/Escape/
// outside-tap) follow the MaterialHoverCard pattern — the repo has no
// popover dep. Content is frozen at open time (a ticking clock adds nothing;
// reopening refreshes).
import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTaipei, occurrencesAround } from "@/lib/purpleHole";

export function SchedulePopover({ taskName }: { taskName: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; arrowX: number; above: boolean } | null>(null);
  const [maxH, setMaxH] = useState<number | null>(null);
  const [fitted, setFitted] = useState(false);
  // Frozen at open: the table never re-sorts under the reader.
  const [rows, setRows] = useState<{ times: number[]; nextIdx: number }>({ times: [], nextIdx: -1 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  // Geometry for scroll-follow: which side + rendered height, refreshed on
  // every fit. Scroll/resize repositions from these instead of dismissing.
  const geomRef = useRef<{ above: boolean; h: number }>({ above: false, h: 0 });

  const placeInitial = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const w = Math.min(248, vw - 16);
    const left = Math.max(8, Math.min(r.left, vw - w - 8));
    const arrowX = Math.max(14, Math.min(r.left + r.width / 2 - left, w - 14));
    setMaxH(null);
    setFitted(false);
    setPos({ top: r.bottom, left, arrowX, above: false });
  }, []);

  const openCard = useCallback(() => {
    const now = Date.now();
    const times = occurrencesAround(now, 2, 3);
    setRows({ times, nextIdx: times.findIndex((t) => t > now) });
    placeInitial();
    setOpen(true);
  }, [placeInitial]);

  // Follow the trigger on scroll/resize (rAF-throttled) instead of
  // dismissing: a timetable you can't scroll the page behind is hostile.
  // Escape / outside-tap still dismiss; trigger scrolled out of view does
  // too (nothing left to anchor to).
  const reposition = useCallback(() => {
    const trigger = triggerRef.current;
    const outer = cardRef.current;
    if (!trigger || !outer) return;
    const r = trigger.getBoundingClientRect();
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    if (r.bottom < 0 || r.top > vh) {
      setOpen(false);
      return;
    }
    const w = outer.offsetWidth;
    const left = Math.max(8, Math.min(r.left, vw - w - 8));
    const arrowX = Math.max(14, Math.min(r.left + r.width / 2 - left, w - 14));
    const { above, h } = geomRef.current;
    setPos({ top: above ? r.top - 8 - h : r.bottom, left, arrowX, above });
  }, []);

  useEffect(() => {
    if (!open) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(reposition);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!triggerRef.current?.contains(t) && !cardRef.current?.contains(t)) setOpen(false);
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open, reposition]);

  // Pass 2: measure, then flip above / clamp only when forced.
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
      geomRef.current = { above, h: h ?? natural };
      setFitted(true);
    });
    return () => cancelAnimationFrame(raf);
  }, [open, fitted ]);

  const { times, nextIdx } = rows;

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => (open ? setOpen(false) : openCard())}
        className="h-6 w-6 grid place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label={`出沒時刻表：${taskName}`}
        aria-expanded={open}
        title="出沒時刻表"
      >
        <CalendarDays className="h-3.5 w-3.5" />
      </button>
      {open && pos && (
        <div
          ref={cardRef}
          role="dialog"
          aria-label={`出沒時刻表：${taskName}`}
          style={{ top: pos.top, left: pos.left, visibility: fitted ? "visible" : "hidden" }}
          className={cn(
            "fixed z-50 w-[min(248px,78vw)] break-words whitespace-normal",
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
            <p className="text-xs font-medium mb-1.5">出沒時刻（預測）</p>
            <ul className="space-y-1 font-mono text-xs">
              {times.map((t, i) => (
                <li
                  key={t}
                  className={cn(
                    "flex items-center justify-between rounded px-1.5 py-0.5",
                    i < nextIdx && "text-muted-foreground",
                    i === nextIdx && "bg-primary/10 font-semibold"
                  )}
                >
                  <span>{formatTaipei(t)}</span>
                  {i === nextIdx && (
                    <span className="rounded bg-primary px-1 py-px font-sans text-[10px] text-primary-foreground">下次</span>
                  )}
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-muted-foreground mt-1.5">預測值，實際以遊戲內為準</p>
          </div>
        </div>
      )}
    </>
  );
}
