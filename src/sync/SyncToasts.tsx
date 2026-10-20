import { useEffect, useState } from "react";
import type { ToastDetail } from "@/sync/session";

// The one toast surface the sync modules raise through `toast` / `toastAction`
// (session.ts). Mounted at App level, outside the menu: a toast is a receipt for
// something that just happened, so it must outlive whatever raised it.
export function SyncToasts() {
  const [msg, setMsg] = useState<{ text: string; key: number; actionLabel?: string; actionKey?: string; ms?: number } | null>(null);
  useEffect(() => {
    const onToast = (e: Event) => {
      const d = (e as CustomEvent<string | ToastDetail>).detail;
      const norm =
        typeof d === "string"
          ? { text: d, key: Date.now() }
          : { text: d.text, actionLabel: d.actionLabel, actionKey: d.actionKey, ms: d.ms, key: Date.now() };
      setMsg(norm);
    };
    window.addEventListener("mabiroutine:toast", onToast);
    return () => window.removeEventListener("mabiroutine:toast", onToast);
  }, []);
  useEffect(() => {
    if (!msg) return;
    const id = setTimeout(() => setMsg(null), msg.ms ?? 2600);
    return () => clearTimeout(id);
  }, [msg]);
  if (!msg) return null;
  return (
    <div
      key={msg.key}
      // This bus carries the only recovery for a destructive write (the goal
      // turn-in), so it is announced, not just painted.
      role="status"
      aria-live="polite"
      className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-foreground px-4 py-2 text-xs text-background shadow-lg whitespace-nowrap max-w-[calc(100vw-2rem)] overflow-hidden text-ellipsis flex items-center gap-3"
    >
      <span className="overflow-hidden text-ellipsis">{msg.text}</span>
      {msg.actionLabel && msg.actionKey && (
        <button
          className="font-bold underline underline-offset-2 shrink-0"
          onClick={() => {
            window.dispatchEvent(new CustomEvent<string>("mabiroutine:toast-action", { detail: msg.actionKey }));
            setMsg(null);
          }}
        >
          {msg.actionLabel}
        </button>
      )}
    </div>
  );
}
