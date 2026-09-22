// PROTOTYPE variant B — "All-deals mode": the existing explorer grows a
// 精選/全部 toggle; 全部 swaps curated rows for NPC accordions of compact deal
// lines (same pin affordance, zero curation chrome). See data.ts header.
import { lazy, Suspense, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { loadShopNpcs, type ShopNpc } from "./data";
import { DealLine, KIND_TABS, NpcFace, type KindFilter } from "./shared";

export const VARIANT_B_NAME = "精選⇄全部（accordion）";

const BarterExplorerLazy = lazy(() =>
  import("@/components/BarterExplorer").then((m) => ({ default: m.BarterExplorer }))
);

function matches(npc: ShopNpc, q: string): boolean {
  if (!q) return true;
  const hay = `${npc.name} ${npc.town} ${npc.deals.map((d) => `${d.name} ${d.costCurrency}`).join(" ")}`.toLowerCase();
  return hay.includes(q.toLowerCase());
}

export function VariantAllMode({
  pinned,
  onTogglePin,
}: {
  pinned: Set<string>;
  onTogglePin: (key: string) => void;
}) {
  const npcs = useMemo(() => loadShopNpcs(), []);
  // Power-user rule: curated 精選 is the landing; 全部 is one tap away.
  const [mode, setMode] = useState<"curated" | "all">("curated");
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [open, setOpen] = useState<string | null>(null);

  const visible = npcs.filter((n) => matches(n, q));

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5">
        <Button
          size="sm"
          variant={mode === "curated" ? "default" : "outline"}
          onClick={() => setMode("curated")}
        >
          🔄 精選（現有）
        </Button>
        <Button size="sm" variant={mode === "all" ? "default" : "outline"} onClick={() => setMode("all")}>
          🏪 全部交易 <Badge variant="secondary" className="ml-1">原型 B</Badge>
        </Button>
      </div>

      {mode === "curated" ? (
        <Suspense fallback={<div className="h-40 animate-pulse rounded-xl border bg-card" />}>
          <BarterExplorerLazy />
        </Suspense>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">全部交易 — 依 NPC 展開</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input placeholder="搜尋 NPC / 物品…" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {KIND_TABS.map((t) => (
                  <Button
                    key={t.value}
                    size="sm"
                    variant={kind === t.value ? "default" : "outline"}
                    onClick={() => setKind(t.value)}
                  >
                    {t.label}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="space-y-2">
            {visible.map((n) => {
              const deals = n.deals.filter((d) => kind === "all" || d.kind === kind);
              if (deals.length === 0) return null;
              const sel = deals.filter((d) => pinned.has(d.key)).length;
              const isOpen = open === n.name;
              return (
                <div key={n.name} className={cn("rounded-xl border bg-card", sel > 0 && "border-emerald-300")}>
                  <button
                    onClick={() => setOpen(isOpen ? null : n.name)}
                    aria-expanded={isOpen}
                    className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left"
                  >
                    <NpcFace npc={n.name} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold">{n.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {n.town} · {deals.length} 筆{sel > 0 ? ` · 已選 ${sel}` : ""}
                      </span>
                    </span>
                    <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
                  </button>
                  {isOpen && (
                    <div className="space-y-1.5 px-3 pb-3">
                      {deals.map((d) => (
                        <DealLine key={d.key} deal={d} pinned={pinned.has(d.key)} onTogglePin={onTogglePin} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {visible.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">沒有符合的項目</p>}
        </>
      )}
    </div>
  );
}
