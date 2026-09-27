import { useEffect, useMemo, useState } from "react";
import { Check, MapPin, Pin, RotateCcw, Search, ShoppingBag, Store } from "lucide-react";
import { MenuSelect } from "@/components/MenuSelect";
import { BarterPinButton, BarterRowDesktop, BarterRowMobile, type BarterJsonRow } from "@/components/BarterExplorer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useIsMobile } from "@/hooks/useIsMobile";
import { cn } from "@/lib/utils";
import { compareTowns } from "@/lib/towns";
import { CURATED_LABEL, costText, getText, loadShopNpcs, shopDeals, type CuratedPriority, type ShopDeal } from "@/lib/shops";
import barterJson from "@/data/barter.json";

type NpcTab = "gold" | "barter";

type MerchantItem = {
  key: string;
  npc: string;
  town: string;
  title: string;
  give: string;
  /** display cost: the coin for gold purchases, the material for barter */
  cost: string;
  limitText: string | null;
  /** account-wide rather than per character, i.e. the in-game 伺服器 badge */
  scopeAccount: boolean;
  priority: CuratedPriority | null;
  note: string | null;
  kind: "shop" | "barter";
  /** position in barter.json, or -1 when the deal is not curated */
  curatedIndex: number;
  barterRow?: BarterJsonRow;
};

type MerchantGroup = { name: string; town: string; rows: MerchantItem[] };

const CURATED_ROWS = new Map((barterJson as BarterJsonRow[]).map((row) => [row.id, row]));

function toItem(deal: ShopDeal): MerchantItem {
  return {
    key: deal.key,
    npc: deal.npc,
    town: deal.town,
    title: getText(deal),
    give: costText(deal),
    cost: deal.costCurrency === "gold" ? `🪙${deal.costAmount == null ? "價格未填" : deal.costAmount.toLocaleString()}` : costText(deal),
    limitText: deal.limitText,
    scopeAccount: deal.scopeAccount,
    priority: deal.priority,
    note: deal.note,
    kind: deal.kind,
    curatedIndex: deal.curatedIndex,
    barterRow: deal.barterId ? CURATED_ROWS.get(deal.barterId) : undefined,
  };
}

/**
 * Default listing follows the hand-curated barter.json order rather than
 * shops.json: curated barter first, then the barter rows nobody curated, then
 * every gold purchase last. Within each band the source order is kept, so the
 * list is stable instead of reshuffling when data gains rows.
 */
const ALL_SHOP_ITEMS: MerchantItem[] = (() => {
  const items = shopDeals(loadShopNpcs()).map(toItem);
  const curated = items.filter((item) => item.curatedIndex >= 0).sort((a, b) => a.curatedIndex - b.curatedIndex);
  const rest = items.filter((item) => item.curatedIndex < 0);
  return [...curated, ...rest.filter((item) => item.kind === "barter"), ...rest.filter((item) => item.kind === "shop")];
})();

function rowMatches(item: MerchantItem, query: string) {
  const q = query.trim().toLocaleLowerCase("zh-Hant");
  if (!q) return true;
  return `${item.title} ${item.give} ${item.npc} ${item.town} ${item.note ?? ""}`
    .toLocaleLowerCase("zh-Hant")
    .includes(q);
}

function filterItems(items: MerchantItem[], town: string, query: string) {
  return items.filter((item) => (town === "all" || item.town === town) && rowMatches(item, query));
}

function groupItems(items: MerchantItem[]) {
  const groups = new Map<string, MerchantGroup>();
  for (const item of items) {
    const key = `${item.npc}::${item.town}`;
    const group = groups.get(key) ?? { name: item.npc, town: item.town, rows: [] };
    group.rows.push(item);
    groups.set(key, group);
  }
  // Town order is the game's region order (TOWN_ORDER), then name inside a town.
  return [...groups.values()].sort((a, b) => compareTowns(a.town, b.town) || a.name.localeCompare(b.name, "zh-Hant"));
}

function tabItems(items: MerchantItem[], tab: NpcTab, query: string) {
  const kind = tab === "gold" ? "shop" : "barter";
  return items.filter((item) => item.kind === kind && rowMatches(item, query));
}

function tabCount(items: MerchantItem[], tab: NpcTab) {
  const kind = tab === "gold" ? "shop" : "barter";
  return items.filter((item) => item.kind === kind).length;
}

/** Barter-only NPCs have no gold tab, so open on whichever tab exists. */
function firstTab(items: MerchantItem[]): NpcTab {
  return tabCount(items, "gold") > 0 ? "gold" : "barter";
}

function NpcFace({ npc, size = "size-10" }: { npc: string; size?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <span className={cn("grid shrink-0 place-items-center rounded-full border bg-muted text-sm font-semibold", size)}>{npc.slice(0, 1)}</span>;
  }
  return (
    <img
      src={`/npc/${encodeURIComponent(npc)}.png`}
      alt=""
      aria-hidden
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn("shrink-0 rounded-full border bg-muted object-cover", size)}
    />
  );
}

function PinButton({ item, pinned, onTogglePin, label = false, className }: {
  item: MerchantItem;
  pinned: boolean;
  onTogglePin: (key: string) => void;
  label?: boolean;
  className?: string;
}) {
  return (
    <Button
      type="button"
      size={label ? "sm" : "icon"}
      variant={pinned ? "default" : "outline"}
      aria-label={pinned ? `取消選取 ${item.title}` : `選取 ${item.title}`}
      aria-pressed={pinned}
      onClick={() => onTogglePin(item.key)}
      className={cn(!label && "rounded-full", pinned && "bg-emerald-600 text-white hover:bg-emerald-700", className)}
    >
      {pinned ? <Check /> : <Pin />}
      {label && (pinned ? "已選" : "選取")}
    </Button>
  );
}

function NpcTabToggle({ items, tab, onChange }: { items: MerchantItem[]; tab: NpcTab; onChange: (tab: NpcTab) => void }) {
  const gold = tabCount(items, "gold");
  const barter = tabCount(items, "barter");
  if (gold + barter === 0) return null;
  return (
    <div className="inline-flex rounded-xl bg-muted p-1" role="tablist" aria-label="NPC 交易類型">
      {gold > 0 && (
        <button type="button" role="tab" aria-selected={tab === "gold"} onClick={() => onChange("gold")} className={cn("inline-flex h-9 items-center gap-1.5 rounded-lg px-4 text-sm font-medium text-muted-foreground", tab === "gold" && "bg-background text-foreground shadow-sm")}>
          <Store /> 金幣 {gold}
        </button>
      )}
      {barter > 0 && (
        <button type="button" role="tab" aria-selected={tab === "barter"} onClick={() => onChange("barter")} className={cn("inline-flex h-9 items-center gap-1.5 rounded-lg px-4 text-sm font-medium text-muted-foreground", tab === "barter" && "bg-background text-foreground shadow-sm")}>
          以物易物 {barter}
        </button>
      )}
    </div>
  );
}

function MerchantGrid({ items, pinned, onTogglePin }: { items: MerchantItem[]; pinned: Set<string>; onTogglePin: (key: string) => void }) {
  return (
    <div className="@container">
      <div className="grid grid-cols-2 gap-2 @lg:grid-cols-3 @2xl:grid-cols-4 @4xl:grid-cols-5">
        {items.map((item) => {
          const isPinned = pinned.has(item.key);
          return (
            <article
              key={item.key}
              data-shop-tile
              className={cn(
                "relative flex flex-col gap-0.5 rounded-lg border bg-card p-2 transition-colors hover:bg-accent/40",
                isPinned && "border-emerald-300 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20",
              )}
            >
              <h3 className="line-clamp-2 pr-5 text-sm font-semibold leading-snug">{item.title.replace(/ ×\d+$/, "")}</h3>
              <p className="text-xs font-medium leading-snug text-foreground/80">{item.cost}</p>
              <div className="flex items-center justify-between gap-1.5">
                <p className="text-[10px] leading-snug text-muted-foreground">{item.limitText ?? "不限次數"}</p>
                {item.priority && (
                  <Badge
                    variant={item.priority === "must" ? "default" : "secondary"}
                    className={cn("shrink-0 text-[10px]", item.priority === "must" && "bg-red-600 text-white hover:bg-red-700")}
                  >
                    {CURATED_LABEL[item.priority]}
                  </Badge>
                )}
              </div>
              {item.note && <p className="line-clamp-1 text-[10px] leading-snug italic text-muted-foreground">📝 {item.note}</p>}
              <div className="absolute right-1.5 top-1.5">
                <PinButton item={item} pinned={isPinned} onTogglePin={onTogglePin} className="size-5" />
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

/** Mirrors BarterRowDesktop so gold and uncurated rows read as the same row:
 *  same container, portrait, title + badges, npc · town, 你給 → 你拿, cap, note
 *  and the shared pin button. The one thing it cannot copy is the expandable
 *  material breakdown, which needs a curated barter row. */
function PlainRow({ item, pinned, onTogglePin, onSelectNpc }: { item: MerchantItem; pinned: boolean; onTogglePin: (key: string) => void; onSelectNpc: (npc: string) => void }) {
  const cap = item.limitText?.replace("（伺服器）", "");
  return (
    <div
      className={cn(
        "rounded-lg border bg-card px-3 py-2.5",
        "[content-visibility:auto] [contain-intrinsic-size:auto_80px]",
        pinned && "border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20",
      )}
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onSelectNpc(item.npc)}
          aria-label={`開啟 ${item.npc} 的商店`}
          className="shrink-0 rounded-full transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <NpcFace npc={item.npc} size="size-10" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-primary truncate">{item.title.replace(/ ×\d+$/, "")}</span>
            {item.priority && (
              <Badge variant={item.priority === "must" ? "default" : "secondary"} className={cn("text-[10px] shrink-0", item.priority === "must" && "bg-red-600 hover:bg-red-700")}>
                {CURATED_LABEL[item.priority]}
              </Badge>
            )}
            {item.scopeAccount && (
              <Badge variant="secondary" className="text-[10px] shrink-0 bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300 hover:bg-sky-100">
                伺服器
              </Badge>
            )}
            <span className="ml-auto flex items-center gap-1 text-xs shrink-0 min-w-0">
              <span className="font-medium truncate">{item.npc}</span>
              <span className="text-muted-foreground truncate">· {item.town}</span>
            </span>
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground min-w-0">
            <span className="truncate">
              你給 <span className="font-medium text-foreground">{item.cost}</span> → 你拿 {item.title}
            </span>
            <span className="ml-auto shrink-0">{cap}</span>
          </div>
          {item.note && (
            <p className="text-xs leading-snug text-muted-foreground/80 mt-1 italic truncate border-l-2 border-muted pl-1.5">📝 {item.note}</p>
          )}
        </div>
        <BarterPinButton id={item.key} pinned={pinned} onTogglePin={onTogglePin} />
      </div>
    </div>
  );
}

function MerchantRows({ items, pinned, onTogglePin, onSelectNpc }: { items: MerchantItem[]; pinned: Set<string>; onTogglePin: (key: string) => void; onSelectNpc: (npc: string) => void }) {
  const isMobile = useIsMobile();
  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => {
        if (item.barterRow) {
          const Row = isMobile ? BarterRowMobile : BarterRowDesktop;
          return <Row key={item.key} b={item.barterRow} pinned={pinned.has(item.key)} onTogglePin={() => onTogglePin(item.key)} onSelectNpc={onSelectNpc} />;
        }
        return <PlainRow key={item.key} item={item} pinned={pinned.has(item.key)} onTogglePin={onTogglePin} onSelectNpc={onSelectNpc} />;
      })}
    </div>
  );
}

/** Gold is a price comparison, so it reads fine as tiles. Barter is a recipe:
 *  what you hand over and what it costs to make is the point, so it keeps the
 *  full barter row (material chain, NPC, note) instead of a tile. */
function TabContent({ items, tab, pinned, onTogglePin, onSelectNpc }: { items: MerchantItem[]; tab: NpcTab; pinned: Set<string>; onTogglePin: (key: string) => void; onSelectNpc: (npc: string) => void }) {
  return tab === "gold"
    ? <MerchantGrid items={items} pinned={pinned} onTogglePin={onTogglePin} />
    : <MerchantRows items={items} pinned={pinned} onTogglePin={onTogglePin} onSelectNpc={onSelectNpc} />;
}

function SearchControls({ query, onQueryChange, selectedOnly, onSelectedOnlyChange, selectedCount }: {
  query: string;
  onQueryChange: (query: string) => void;
  selectedOnly: boolean;
  onSelectedOnlyChange: (value: boolean) => void;
  selectedCount: number;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row">
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="搜尋獎勵、材料、NPC 或城鎮" className="h-10 bg-background pl-9" />
      </div>
      <Button type="button" variant={selectedOnly ? "default" : "outline"} className="h-10 shrink-0" aria-pressed={selectedOnly} onClick={() => onSelectedOnlyChange(!selectedOnly)}>
        <ShoppingBag data-icon="inline-start" />
        已選 {selectedCount}
      </Button>
    </div>
  );
}

export function MerchantPanel() {
  const [town, setTown] = useState("all");
  const [merchant, setMerchant] = useState("all");
  const [npcTab, setNpcTab] = useState<NpcTab>("gold");
  const [pinned, setPinned] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const [selectedOnly, setSelectedOnly] = useState(false);

  const towns = useMemo(() => [...new Set(ALL_SHOP_ITEMS.map((item) => item.town))].sort(compareTowns), []);
  const options = useMemo(() => filterItems(ALL_SHOP_ITEMS, town, ""), [town]);
  const groups = useMemo(() => groupItems(options), [options]);
  const items = useMemo(
    () => filterItems(ALL_SHOP_ITEMS, town, query).filter((item) => merchant === "all" || item.npc === merchant),
    [town, query, merchant],
  );

  const selected = merchant === "all" ? null : groups.find((group) => group.name === merchant) ?? null;
  const npcRows = selected?.rows ?? [];
  const visible = selected ? tabItems(npcRows, npcTab, query) : items;
  const selectedItems = useMemo(
    () => ALL_SHOP_ITEMS.filter((item) => pinned.has(item.key)).filter((item) => rowMatches(item, query)),
    [pinned, query],
  );

  // ?npc= deep link, same param convention as the reminder links. Kept in the
  // URL (not stripped) so an NPC view is shareable and survives a reload.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const npc = new URLSearchParams(window.location.search).get("npc");
    if (!npc) return;
    const group = groupItems(ALL_SHOP_ITEMS).find((entry) => entry.name === npc);
    if (!group) return;
    setTown("all");
    setMerchant(npc);
    setNpcTab(firstTab(group.rows));
  }, []);

  const writeNpcParam = (name: string) => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (name === "all") url.searchParams.delete("npc");
    else url.searchParams.set("npc", name);
    window.history.replaceState(null, "", url.toString());
  };

  const togglePin = (key: string) => {
    setPinned((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectNpc = (name: string) => {
    setMerchant(name);
    setNpcTab(name === "all" ? "gold" : firstTab(groups.find((group) => group.name === name)?.rows ?? []));
    writeNpcParam(name);
  };

  const filtersActive = town !== "all" || merchant !== "all";

  const clearFilters = () => {
    setTown("all");
    setMerchant("all");
    setNpcTab("gold");
    writeNpcParam("all");
  };

  return (
    <div className="flex flex-col gap-5">
      <header className="rounded-2xl border bg-card p-4 sm:p-5">
        <div className="mb-4">
          <h1 className="text-2xl font-semibold">NPC 商店</h1>
          <p className="mt-1 text-sm text-muted-foreground">選擇 NPC 後，於頁籤內瀏覽完整內容</p>
        </div>
        <SearchControls query={query} onQueryChange={setQuery} selectedOnly={selectedOnly} onSelectedOnlyChange={setSelectedOnly} selectedCount={pinned.size} />
      </header>

      {!selectedOnly && (
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <MenuSelect
            value={town}
            ariaLabel="城鎮"
            onChange={(value) => { setTown(value); setMerchant("all"); writeNpcParam("all"); }}
            options={[{ value: "all", label: "全部城鎮" }, ...towns.map((value) => ({ value, label: value }))]}
            triggerClassName={cn("w-full", town !== "all" && "border-primary text-primary")}
          />
          <MenuSelect
            value={merchant}
            ariaLabel="NPC"
            onChange={selectNpc}
            options={[
              { value: "all", label: "全部 NPC", icon: <span className="grid size-5 shrink-0 place-items-center rounded-full border bg-muted"><Store className="size-3" /></span> },
              ...groups.map((group) => ({ value: group.name, label: group.name, icon: <NpcFace npc={group.name} size="size-5" /> })),
            ]}
            triggerClassName={cn("w-full", merchant !== "all" && "border-primary text-primary")}
          />
          <Button type="button" variant="ghost" onClick={clearFilters} disabled={!filtersActive} aria-label="清除城鎮與 NPC 篩選" className="h-9 shrink-0 self-center">
            <RotateCcw />
            清除篩選
          </Button>
        </div>
      )}

      {selectedOnly ? (
        <section>
          <div className="mb-4 flex items-end justify-between border-b pb-3">
            <div>
              <h2 className="text-lg font-semibold">已選交易</h2>
              <p className="mt-1 text-xs text-muted-foreground">所有來源，依選取順序</p>
            </div>
            <span className="text-sm text-muted-foreground">{selectedItems.length} 筆</span>
          </div>
          {selectedItems.length > 0
            ? <MerchantRows items={selectedItems} pinned={pinned} onTogglePin={togglePin} onSelectNpc={selectNpc} />
            : <div className="rounded-xl border border-dashed py-16 text-center text-sm text-muted-foreground">尚無已選交易</div>}
        </section>
      ) : (
        <section>
          <div className="mb-4 flex flex-wrap items-center gap-3 border-b pb-4">
            {selected ? (
              <NpcFace npc={selected.name} size="size-12" />
            ) : (
              <span className="grid size-12 place-items-center rounded-full border bg-background"><Store /></span>
            )}
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-lg font-semibold">{selected?.name ?? "全部商店"}</h2>
              <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                {selected ? <><MapPin /> {selected.town} · {npcRows.length} 筆</> : `${items.length} 筆 · 以物易物優先，金幣最後`}
              </p>
            </div>
            {selected && <NpcTabToggle items={npcRows} tab={npcTab} onChange={setNpcTab} />}
          </div>
          {selected
            ? <TabContent items={visible} tab={npcTab} pinned={pinned} onTogglePin={togglePin} onSelectNpc={selectNpc} />
            : <MerchantRows items={items} pinned={pinned} onTogglePin={togglePin} onSelectNpc={selectNpc} />}
        </section>
      )}
    </div>
  );
}
