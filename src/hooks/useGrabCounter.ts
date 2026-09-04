import { useEffect, useRef, useState } from "react";
import { useAppStore } from "@/store/useAppStore";

const STEP_PX = 14; // px of vertical drag per ±1
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
export function useGrabCounter(taskId: string, count: number, max: number, isAccount: boolean) {
  const setCounter = useAppStore((s) => s.setCounter);
  const incCounter = useAppStore((s) => s.incCounter);
  const [grabbed, setGrabbed] = useState(false);
  const [coach, setCoach] = useState(false);
  const [, setTick] = useState(0);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const startY = useRef(0);
  const startVal = useRef(0);
  const moved = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const done = max > 0 && count >= max;
  // desktop (hover-capable): coach shows on hover only; touch: on tap only
  const [canHover] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(hover: hover)").matches
  );

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const clamp = (v: number) => Math.min(max, Math.max(0, v));
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
        if (Math.abs(e.clientY - startY.current) < 6) return;
        moved.current = true;
        const steps = Math.trunc((startY.current - e.clientY) / STEP_PX);
        const next = clamp(startVal.current + steps);
        if (next !== count) {
          setCounter(taskId, next, isAccount);
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
          if (done) setCounter(taskId, 0, isAccount);
          else incCounter(taskId, 1, isAccount);
          if (!canHover && !grabLearned()) showCoach();
        }
      },
      onPointerCancel: () => {
        if (grabbed) endGrab();
        else clear();
      },
      onContextMenu: (e: React.MouseEvent<HTMLButtonElement>) => {
        e.preventDefault(); // also kills the mobile long-press popup
        incCounter(taskId, -1, isAccount);
      },
      onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => {
        if (e.key === "ArrowUp" || e.key === "ArrowRight") {
          e.preventDefault();
          setCounter(taskId, clamp(count + 1), isAccount);
        } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
          e.preventDefault();
          setCounter(taskId, clamp(count - 1), isAccount);
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
