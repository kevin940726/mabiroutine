import { useMemo, useRef } from "react";
import { TAP_GATE_IDLE, tapGateClear, tapGateOwnsClick, tapGatePress, tapGateRelease, type TapGate } from "@/lib/tapGate";

export function useTapGate() {
  const ref = useRef<TapGate>(TAP_GATE_IDLE);
  return useMemo(
    () => ({
      handlers: {
        onPointerDown: () => {
          ref.current = tapGatePress();
        },
        onPointerUp: () => {
          ref.current = tapGateRelease(ref.current, true);
        },
        onPointerCancel: () => {
          ref.current = tapGateClear();
        },
      },
      press: () => {
        ref.current = tapGatePress();
      },
      release: (isTap: boolean) => {
        ref.current = tapGateRelease(ref.current, isTap);
      },
      cancel: () => {
        ref.current = tapGateClear();
      },
      ownsClick: (e: { detail: number }): boolean => {
        const r = tapGateOwnsClick(ref.current, e.detail);
        ref.current = r.gate;
        return r.allowed;
      },
    }),
    []
  );
}
