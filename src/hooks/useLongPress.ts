import { useRef, useCallback } from "react";

export function useLongPress(onLongPress: () => void, onClick?: () => void, ms = 550) {
  const timer = useRef<number | null>(null);
  const moved = useRef(false);
  const triggered = useRef(false);

  const start = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return; // only primary
      moved.current = false;
      triggered.current = false;
      // need pointer capture to get move/up even outside
      const target = e.currentTarget as HTMLElement;
      try { target.setPointerCapture(e.pointerId); } catch {}
      timer.current = window.setTimeout(() => {
        triggered.current = true;
        onLongPress();
        if (navigator.vibrate) navigator.vibrate(30);
      }, ms);
    },
    [onLongPress, ms]
  );

  const move = useCallback((e: React.PointerEvent) => {
    if (Math.abs(e.movementX) > 10 || Math.abs(e.movementY) > 10) {
      moved.current = true;
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    }
  }, []);

  const end = useCallback(
    (e: React.PointerEvent) => {
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      // if long-press already fired, suppress click
      if (triggered.current) {
        e.preventDefault();
        e.stopPropagation();
        triggered.current = false;
        return;
      }
      if (!moved.current && onClick) onClick();
    },
    [onClick]
  );

  const cancel = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  }, []);

  return {
    onPointerDown: start,
    onPointerMove: move,
    onPointerUp: end,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
  };
}
