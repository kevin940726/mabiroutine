// PROTOTYPE shell: ?shopproto=a|b|c switcher + shared memory-only pin tray.
// See data.ts header. Pins are stubs (the question is look-and-feel, not the
// store wiring); the tray surfaces full pin state for comparison.
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { loadShopNpcs } from "./data";
import { VARIANT_A_NAME, VariantGrid } from "./VariantGrid";
import { VARIANT_B_NAME, VariantAllMode } from "./VariantAllMode";
import { VARIANT_C_NAME, VariantSplit } from "./VariantSplit";

const VARIANTS = [
  { key: "a", name: VARIANT_A_NAME },
  { key: "b", name: VARIANT_B_NAME },
  { key: "c", name: VARIANT_C_NAME },
] as const;

export type VariantKey = (typeof VARIANTS)[number]["key"];

function readVariant(): VariantKey {
  const v = new URLSearchParams(window.location.search).get("shopproto");
  return VARIANTS.some((x) => x.key === v) ? (v as VariantKey) : "a";
}

function PrototypeSwitcher({
  current,
  onChange,
}: {
  current: VariantKey;
  onChange: (v: VariantKey) => void;
}) {
  // Obviously-not-production pill; dev-only so a stray merge can't ship it.
  // (Hooks run unconditionally above the prod early-return.)
  const idx = VARIANTS.findIndex((x) => x.key === current);
  const step = (d: number) => onChange(VARIANTS[(idx + d + VARIANTS.length) % VARIANTS.length].key);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, [contenteditable]")) return;
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);
  const exit = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("shopproto");
    window.location.href = url.toString();
  };
  if (!import.meta.env.DEV) return null;
  return (
    <div className="fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-1 rounded-full border-2 border-dashed border-fuchsia-500 bg-black px-2 py-1.5 text-white shadow-xl">
      <span className="px-1 text-[10px] font-bold uppercase tracking-wider text-fuchsia-300">proto</span>
      <button aria-label="上一個" onClick={() => step(-1)} className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/20">
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="min-w-40 text-center text-xs font-bold">
        {current.toUpperCase()} · {VARIANTS[idx].name}
      </span>
      <button aria-label="下一個" onClick={() => step(1)} className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/20">
        <ChevronRight className="h-4 w-4" />
      </button>
      <button aria-label="離開原型" onClick={exit} className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/20">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export function ShopProto() {
  const [variant, setVariant] = useState<VariantKey>(readVariant);
  const [pinned, setPinned] = useState<Set<string>>(new Set());
  const [npcs] = useState(loadShopNpcs);

  const change = (v: VariantKey) => {
    setVariant(v);
    const url = new URL(window.location.href);
    url.searchParams.set("shopproto", v);
    window.history.replaceState(null, "", url.toString());
  };
  const togglePin = useCallback((key: string) => {
    setPinned((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const pinList = [...pinned];
  const pinNpcs = [...new Set(pinList.map((k) => k.split("::")[0]))];

  return (
    <div className="space-y-4 pb-16">
      {/* shared pin tray — same stub state under every variant for comparison */}
      <div className="rounded-xl border-2 border-dashed border-fuchsia-500/60 bg-card px-3 py-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold">📌 原型已選 {pinned.size} 筆</span>
          {pinNpcs.length > 0 && <span className="text-muted-foreground">（{pinNpcs.join("、")}）</span>}
          {pinned.size > 0 && (
            <>
              <details className="text-muted-foreground">
                <summary className="cursor-pointer underline underline-offset-2">keys</summary>
                <pre className="mt-1 max-h-24 overflow-auto rounded bg-muted p-1.5 text-[10px]">{pinList.join("\n")}</pre>
              </details>
              <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setPinned(new Set())}>
                清除
              </Button>
            </>
          )}
          <span className="ml-auto text-muted-foreground">共 {npcs.reduce((a, n) => a + n.deals.length, 0)} 筆交易可選</span>
        </div>
      </div>

      {variant === "a" && <VariantGrid pinned={pinned} onTogglePin={togglePin} />}
      {variant === "b" && <VariantAllMode pinned={pinned} onTogglePin={togglePin} />}
      {variant === "c" && <VariantSplit pinned={pinned} onTogglePin={togglePin} />}

      <PrototypeSwitcher current={variant} onChange={change} />
    </div>
  );
}
