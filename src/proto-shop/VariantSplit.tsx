// PROTOTYPE variant C — "Master-detail": desktop-leaning split view, NPC
// roster (town-grouped) on the left, selected NPC's deal sheet on the right.
// Mobile collapses to list ⇄ detail with a back button. See data.ts header.
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useIsMobile } from "@/hooks/useIsMobile";
import { cn } from "@/lib/utils";
import { Search } from "lucide-react";
import { loadShopNpcs, shopTowns } from "./data";
import { DealLine, KIND_TABS, NpcFace, type KindFilter } from "./shared";

export const VARIANT_C_NAME = "主從分割（sidebar）";

export function VariantSplit({
  pinned,
  onTogglePin,
}: {
  pinned: Set<string>;
  onTogglePin: (key: string) => void;
}) {
  const isMobile = useIsMobile();
  const npcs = useMemo(() => loadShopNpcs(), []);
  const towns = useMemo(() => shopTowns(npcs), [npcs]);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [sel, setSel] = useState<string>(npcs[0]?.name ?? "");

  const hay = (n: (typeof npcs)[number]) =>
    `${n.name} ${n.town} ${n.deals.map((d) => `${d.name} ${d.costCurrency}`).join(" ")}`.toLowerCase();
  const visible = npcs.filter((n) => hay(n).includes(q.toLowerCase()));
  const current = npcs.find((n) => n.name === sel) ?? visible[0] ?? null;
  // On mobile only one pane shows at a time; desktop always shows both.
  const [selMobileOpen, setSelMobileOpen] = useState<string | null>(null);
  const detailNpc = isMobile ? npcs.find((n) => n.name === selMobileOpen) ?? null : current;
  const detailDeals = detailNpc?.deals.filter((d) => kind === "all" || d.kind === kind) ?? [];

  const roster = (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input placeholder="搜尋 NPC / 物品…" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {towns.map((t) => {
        const inTown = visible.filter((n) => n.town === t);
        if (inTown.length === 0) return null;
        return (
          <div key={t} className="space-y-1">
            <div className="px-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{t}</div>
            {inTown.map((n) => {
              const active = detailNpc?.name === n.name;
              const selCount = n.deals.filter((d) => pinned.has(d.key)).length;
              return (
                <button
                  key={n.name}
                  onClick={() => {
                    setSel(n.name);
                    setSelMobileOpen(n.name);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left",
                    active ? "border-primary/60 bg-accent" : "bg-card hover:border-primary/30"
                  )}
                >
                  <NpcFace npc={n.name} size="h-8 w-8" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-bold">{n.name}</span>
                    <span className="block text-[10px] text-muted-foreground">{n.deals.length} 筆</span>
                  </span>
                  {selCount > 0 && (
                    <Badge variant="secondary" className="text-[10px]">
                      {selCount}
                    </Badge>
                  )}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );

  const detail = detailNpc ? (
    <div className="space-y-3">
      {isMobile && (
        <Button variant="outline" size="sm" onClick={() => setSelMobileOpen(null)}>
          ← 回 NPC 列表
        </Button>
      )}
      <div className="flex items-center gap-3">
        <NpcFace npc={detailNpc.name} size="h-12 w-12" />
        <div className="min-w-0 flex-1">
          <div className="font-bold">{detailNpc.name}</div>
          <div className="text-xs text-muted-foreground">{detailNpc.town}</div>
        </div>
      </div>
      <div className="flex gap-1.5">
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
      <div className="space-y-1.5">
        {detailDeals.map((d) => (
          <DealLine key={d.key} deal={d} pinned={pinned.has(d.key)} onTogglePin={onTogglePin} />
        ))}
        {detailDeals.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">此分類沒有項目</p>}
      </div>
    </div>
  ) : (
    <p className="py-8 text-center text-sm text-muted-foreground">選擇一位 NPC</p>
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            🏪 商店 <Badge variant="secondary">原型 C</Badge>
            <span className="text-xs font-normal text-muted-foreground">
              {npcs.length} 位 NPC · 左選人、右看貨
            </span>
          </CardTitle>
        </CardHeader>
      </Card>
      {isMobile ? (
        <Card>
          <CardContent className="pt-4">{detailNpc ? detail : roster}</CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-[240px_1fr] items-start gap-3">
          <Card>
            <CardContent className="max-h-[70vh] overflow-y-auto pt-4">{roster}</CardContent>
          </Card>
          <Card>
            <CardContent className="max-h-[70vh] overflow-y-auto pt-4">{detail}</CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
