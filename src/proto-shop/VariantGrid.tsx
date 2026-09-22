// PROTOTYPE variant A — "Shop window" (game mimic): NPC portrait grid grouped
// by town → tap opens that NPC's deal sheet (bottom sheet on mobile, centered
// dialog on desktop) with kind tabs. See data.ts header.
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MenuSelect } from "@/components/MenuSelect";
import { useIsMobile } from "@/hooks/useIsMobile";
import { cn } from "@/lib/utils";
import { Search } from "lucide-react";
import { loadShopNpcs, shopTowns, type ShopNpc } from "./data";
import { DealLine, KIND_TABS, NpcFace, type KindFilter } from "./shared";

export const VARIANT_A_NAME = "NPC 商店街（grid + sheet）";

function matches(npc: ShopNpc, q: string): boolean {
  if (!q) return true;
  const hay = `${npc.name} ${npc.town} ${npc.deals.map((d) => `${d.name} ${d.costCurrency}`).join(" ")}`.toLowerCase();
  return hay.includes(q.toLowerCase());
}

function NpcSheet({
  npc,
  kind,
  setKind,
  pinned,
  onTogglePin,
  onClose,
}: {
  npc: ShopNpc;
  kind: KindFilter;
  setKind: (k: KindFilter) => void;
  pinned: Set<string>;
  onTogglePin: (key: string) => void;
  onClose: () => void;
}) {
  const isMobile = useIsMobile();
  const barter = npc.deals.filter((d) => d.kind === "barter").length;
  const shop = npc.deals.length - barter;
  const deals = npc.deals.filter((d) => kind === "all" || d.kind === kind);
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-label={`${npc.name} 的商店`}>
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className={cn(
          "absolute bg-background p-4 space-y-3 overflow-y-auto",
          isMobile
            ? "inset-x-0 bottom-0 top-24 rounded-t-2xl"
            : "left-1/2 top-1/2 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl max-h-[80vh]"
        )}
      >
        <div className="flex items-center gap-3">
          <NpcFace npc={npc.name} size="h-12 w-12" />
          <div className="min-w-0 flex-1">
            <div className="font-bold">{npc.name}</div>
            <div className="text-xs text-muted-foreground">
              {npc.town} · 以物 {barter} · 直購 {shop}
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={onClose}>
            關閉
          </Button>
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
          {deals.map((d) => (
            <DealLine key={d.key} deal={d} pinned={pinned.has(d.key)} onTogglePin={onTogglePin} />
          ))}
          {deals.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">此分類沒有項目</p>}
        </div>
      </div>
    </div>
  );
}

export function VariantGrid({
  pinned,
  onTogglePin,
}: {
  pinned: Set<string>;
  onTogglePin: (key: string) => void;
}) {
  const npcs = useMemo(() => loadShopNpcs(), []);
  const towns = useMemo(() => shopTowns(npcs), [npcs]);
  const [q, setQ] = useState("");
  const [town, setTown] = useState("all");
  const [kind, setKind] = useState<KindFilter>("all");
  const [openNpc, setOpenNpc] = useState<string | null>(null);

  const visible = npcs.filter(
    (n) => (town === "all" || n.town === town) && matches(n, q)
  );
  const opened = openNpc ? npcs.find((n) => n.name === openNpc) ?? null : null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            🏪 商店街 <Badge variant="secondary">原型 A</Badge>
            <span className="text-xs font-normal text-muted-foreground">
              {npcs.length} 位 NPC · {npcs.reduce((a, n) => a + n.deals.length, 0)} 筆交易
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="搜尋 NPC / 物品 / 代幣…" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-2">
            <MenuSelect
              value={town}
              options={[{ value: "all", label: "全部城鎮" }, ...towns.map((t) => ({ value: t, label: t }))]}
              onChange={setTown}
            />
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

      {towns
        .filter((t) => town === "all" || t === town)
        .map((t) => {
          const inTown = visible.filter((n) => n.town === t);
          if (inTown.length === 0) return null;
          return (
            <section key={t} className="space-y-2">
              <h3 className="text-sm font-bold text-muted-foreground">
                {t}（{inTown.length}）
              </h3>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
                {inTown.map((n) => {
                  const barter = n.deals.filter((d) => d.kind === "barter").length;
                  const sel = n.deals.filter((d) => pinned.has(d.key)).length;
                  return (
                    <button
                      key={n.name}
                      onClick={() => setOpenNpc(n.name)}
                      className={cn(
                        "flex flex-col items-center gap-1 rounded-xl border bg-card p-2.5 hover:border-primary/50",
                        sel > 0 && "border-emerald-300"
                      )}
                    >
                      <NpcFace npc={n.name} size="h-12 w-12" />
                      <span className="w-full truncate text-center text-xs font-bold">{n.name}</span>
                      <span className="text-[10px] text-muted-foreground">
                        以物 {barter} · 直購 {n.deals.length - barter}
                      </span>
                      {sel > 0 && (
                        <Badge variant="secondary" className="text-[10px]">
                          已選 {sel}
                        </Badge>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      {visible.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">沒有符合的 NPC</p>}

      {opened && (
        <NpcSheet
          npc={opened}
          kind={kind}
          setKind={setKind}
          pinned={pinned}
          onTogglePin={onTogglePin}
          onClose={() => setOpenNpc(null)}
        />
      )}
    </div>
  );
}
