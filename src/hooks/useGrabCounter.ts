import { useEffect, useRef, useState } from "react";
import { useAppStore } from "@/store/useAppStore";
import { celebrateAfterWrite, controlPoint } from "@/lib/confetti";
import type { TaskSection } from "@/lib/types";

const MAX_RANGE_PX = 140; // px of vertical drag for full range
const MIN_STEP_PX = 6; // px of vertical drag to count as a step
const MAX_STEP_PX = 14; // px of vertical drag to count as a step
const HOLD_MS = 300; // hold duration before grab mode
const LEARNED_KEY = "mabiroutine:grab-learned";
const COACH_EVENT = "mabiroutine:grab-coach"; // { taskId: string | null } — null hides all

function buzz(ms: number) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* iOS Safari: no haptics API — silent */
  }
}

export function grabLearned(): boolean {
  try {
    return localStorage.getItem(LEARNED_KEY) === "1";
  } catch {
    return true;
  }
}

function markGrabLearned() {
  try {
    localStorage.setItem(LEARNED_KEY, "1");
  } catch {
    /* noop */
  }
}

// Hold-to-grab quick-adjust for counter/countdown tiles.
// Hold 0.3s → grab (haptic + pointer capture), drag vertically ±1 per step,
// release to end. Plain tap keeps existing behavior (+1, full → reset 0).
// Desktop right-click stays −1 (mobile long-press menu is suppressed).
// Teaching: touch learns on tap, hover-capable learns on hover; the coach
// bubble retires everywhere after the first successful grab.
//
// `writes` lets a caller replace the store writes without losing this machinery
// (GoalGroup's tiles): a goal child's write can consume a completed round, and an
// unbounded parent clamps at 0 only. Timing, haptics, the coach mark and the
// celebrations stay here, so a row tile and a goal tile cannot drift apart.
export type CounterWrites = {
  /** absolute write (drag step, keyboard, tap-at-full reset) */
  set: (v: number) => void;
  /** +1 write (a plain tap) */
  inc: () => void;
  /** −1 write (right-click) */
  dec: () => void;
  /** tap-at-full resets to 0 when true (false for an unbounded counter) */
  done: boolean;
  /** the write range; an unbounded counter clamps at 0 only */
  clamp: (v: number) => number;
  /** a new write gesture begins (pointerdown / keydown): callers clear
   *  per-gesture state here (the goal turn-in suppression) */
  onWriteStart?: () => void;
};

export function useGrabCounter(
  taskId: string,
  count: number,
  max: number,
  isAccount: boolean,
  section: TaskSection,
  writes?: CounterWrites
) {
  const setCounter = useAppStore((s) => s.setCounter);
  const incCounter = useAppStore((s) => s.incCounter);
  const setV = writes?.set ?? ((v: number) => setCounter(taskId, v, isAccount));
  const incV = writes?.inc ?? (() => incCounter(taskId, 1, isAccount));
  const decV = writes?.dec ?? (() => incCounter(taskId, -1, isAccount));
  // `max <= 0` reads as unbounded (an absent max): floor at 0 only, no ceiling.
  const clampV = writes?.clamp ?? ((v: number) => (max > 0 ? Math.min(max, Math.max(0, v)) : Math.max(0, v)));
  const [grabbed, setGrabbed] = useState(false);
  const [coach, setCoach] = useState(false);
  const [, setTick] = useState(0);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const startY = useRef(0);
  const startVal = useRef(0);
  const moved = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // desktop (hover-capable): coach shows on hover only; touch: on tap only
  const [canHover] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(hover: hover)").matches
  );

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const clamp = (v: number) => clampV(v);
  const showCoach = () => {
    setCoach(true);
    window.dispatchEvent(new CustomEvent(COACH_EVENT, { detail: taskId }));
  };

  const beginGrab = (node: HTMLButtonElement, pid: number) => {
    try {
      node.setPointerCapture(pid);
    } catch {
      /* noop */
    }
    setCoach(false);
    window.dispatchEvent(new CustomEvent(COACH_EVENT, { detail: null }));
    markGrabLearned();
    setTick((t) => t + 1);
    setGrabbed(true);
    buzz(20);
  };
  const endGrab = () => {
    clear();
    setGrabbed(false);
    moved.current = false;
    buzz(10);
  };

  // hide coach on outside tap or another tile's interaction; re-render when
  // anyone reports a grab (retires hover coach)
  useEffect(() => {
    const onDocDown = (e: PointerEvent) => {
      if (!(e.target instanceof Node) || !wrapRef.current?.contains(e.target)) setCoach(false);
    };
    const onCoach = (e: Event) => {
      const detail = (e as CustomEvent).detail as string | null;
      if (detail === null) setTick((t) => t + 1);
      if (detail !== taskId) setCoach(false);
    };
    document.addEventListener("pointerdown", onDocDown, true);
    window.addEventListener(COACH_EVENT, onCoach);
    return () => {
      document.removeEventListener("pointerdown", onDocDown, true);
      window.removeEventListener(COACH_EVENT, onCoach);
    };
  }, [taskId]);

  return {
    grabbed,
    coach,
    wrapRef,
    handlers: {
      onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
        if (e.pointerType === "mouse" && e.button !== 0) return; // right-click handled by contextmenu
        writes?.onWriteStart?.();
        // pin node + id synchronously: the synthetic event is dead by the time
        // the hold timer fires (currentTarget nulls after dispatch)
        const node = e.currentTarget;
        const pid = e.pointerId;
        startY.current = e.clientY;
        startVal.current = count;
        moved.current = false;
        clear();
        timer.current = setTimeout(() => beginGrab(node, pid), HOLD_MS);
      },
      onPointerMove: (e: React.PointerEvent<HTMLButtonElement>) => {
        if (!grabbed) return;
        if (Math.abs(e.clientY - startY.current) < MIN_STEP_PX) return;
        moved.current = true;
        const stepPx = Math.min(MAX_STEP_PX, Math.max(MIN_STEP_PX, MAX_RANGE_PX / max)); // px of vertical drag per ±1
        const steps = Math.trunc((startY.current - e.clientY) / stepPx);
        const next = clamp(startVal.current + steps);
        if (next !== count) {
          celebrateAfterWrite(section, controlPoint(e), () => setV(next));
          buzz(8);
        }
      },
      onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => {
        if (e.button !== 0) return; // right-click release: contextmenu already handled −1, not a tap
        const wasGrabbed = grabbed;
        const didMove = moved.current;
        if (wasGrabbed) endGrab();
        else clear();
        if (!wasGrabbed && !didMove) {
          if (writes?.done ?? (max > 0 && count >= max)) setV(0);
          else celebrateAfterWrite(section, controlPoint(e), incV);
          if (!canHover && !grabLearned()) showCoach();
        }
      },
      onPointerCancel: () => {
        if (grabbed) endGrab();
        else clear();
      },
      onContextMenu: (e: React.MouseEvent<HTMLButtonElement>) => {
        e.preventDefault(); // also kills the mobile long-press popup
        writes?.onWriteStart?.();
        decV();
      },
      onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => {
        if (e.key === "ArrowUp" || e.key === "ArrowRight") {
          e.preventDefault();
          writes?.onWriteStart?.();
          celebrateAfterWrite(section, controlPoint(e), () =>
            setV(clamp(count + 1))
          );
        } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
          e.preventDefault();
          writes?.onWriteStart?.();
          setV(clamp(count - 1));
        }
      },
      onMouseEnter: () => {
        if (!canHover) return;
        if (!grabLearned()) showCoach();
      },
      onMouseLeave: () => setCoach(false),
    },
  };
}
