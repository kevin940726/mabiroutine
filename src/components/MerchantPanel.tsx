import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, MapPin, Pin, RotateCcw, Search, ShoppingBag, Store } from "lucide-react";
import { MenuSelect, MenuMultiSelect } from "@/components/MenuSelect";
import { BarterRowDesktop, BarterRowMobile, BarterPinButton, type BarterJsonRow } from "@/components/BarterExplorer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useIsMobile } from "@/hooks/useIsMobile";
import { cn } from "@/lib/utils";
import { compareTowns } from "@/lib/towns";
import { useAppStore } from "@/store/useAppStore";
import { CURATED_LABEL, costText, getText, loadShopNpcs, shopDeals, type CuratedPriority, type ShopDeal } from "@/lib/shops";
import { displayName, parseItemQty } from "@/lib/materials";
// The shop grid (src/proto-grid/), which is the shop view; the old row/tab UI it
// replaced is kept behind a dev-only ?rows=1 for comparison until the fold-in.
import { ProtoGrid } from "@/proto-grid/ProtoGrid";
import barterJson from "@/data/barter.json";

/** How long the jumped-to tile stays tinted. Long enough to find by eye after the
 *  scroll settles, short enough that it stops reading as a selected row. The timer
 *  is cleared on unmount and on a second jump so two quick jumps cannot leave the
 *  first one's timer to cut the second flash short. */
const FOCUS_FLASH_MS = 1600;

/** Scroll the flashed tile into the middle of the viewport. "center" rather than
 *  "start": the card can sit directly under a tile, and a top-aligned scroll puts
 *  the target under the sticky header on desktop. */
function scrollToFocus(key: string): boolean {
  const el = document.querySelector(`[data-tile-key="${CSS.escape(key)}"]`);
  if (!(el instanceof HTMLElement)) return false;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  return true;
}

type NpcTab = "gold" | "barter";

/** The view state a jump wipes, kept so the 返回 chip can put it back. A jump
 *  clears every filter and switches merchant, which is right for landing on the
 *  producing shop but destroys the context you were reading. Scroll is part of it:
 *  the whole point is to return to the row you left, not just its filters. */
type ViewSnapshot = {
  town: string;
  merchant: string;
  npcTab: NpcTab;
  query: string;
  selectedOnly: boolean;
  protoPriority: string[];
  protoKind: string;
  scrollY: number;
};

export type MerchantItem = {
  key: string;
  npc: string;
  town: string;
  title: string;
  give: string;
  /** what the trade yields, i.e. "what you get". Barter only: a gold purchase has
   *  no get, and the field is "" for it rather than optional, so the type stays
   *  total and every item is assignable to the prototype's ProtoItem. */
  get: string;
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
  /** barter.json id when this deal is curated */
  barterId: string | null;
  /** the id a pin on this row uses — barterId when curated, else a shop:: id */
  pinId: string;
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
    // costText owns the gold glyph, so `cost` and `give` are the same string
    // here. They are kept as separate fields because a barter row's give is a
    // material while a gold row's is a price, and the row layouts read them
    // differently.
    give: costText(deal),
    // gold has no get: the coin glyph makes the whole trade. Cosmetics, so the
    // field is total rather than optional — every item is a ProtoItem.
    get: deal.kind === "barter" ? getText(deal) : "",
    cost: costText(deal),
    limitText: deal.limitText,
    scopeAccount: deal.scopeAccount,
    priority: deal.priority,
    note: deal.note,
    kind: deal.kind,
    curatedIndex: deal.curatedIndex,
    barterId: deal.barterId,
    pinId: deal.pinId,
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

/** A pin can point at a curated row that shops.json has no entry for, so build
 *  the row straight from barter.json — same shape as a shop-derived item. */
function barterRowToItem(row: BarterJsonRow): MerchantItem {
  return {
    key: `curated-only::${row.id}`,
    npc: row.npc,
    town: row.town,
    title: row.get,
    give: row.give,
    get: row.get,
    cost: row.give,
    limitText: row.limit ?? null,
    scopeAccount: row.perChar === false,
    priority: row.priority as CuratedPriority,
    note: row.note ?? null,
    kind: "barter",
    curatedIndex: -1,
    barterId: row.id,
    pinId: row.id,
    barterRow: row,
  };
}

function rowMatches(item: MerchantItem, query: string) {
  // Folded on both sides so a name pasted from the game (half-width parens,
  // which is how shops.json spells it) still matches the full-width display.
  const q = displayName(query.trim()).toLocaleLowerCase("zh-Hant");
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

export function NpcFace({ npc, size = "size-10" }: { npc: string; size?: string }) {
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

/**
 * The tracker's pin on a gold tile, which has no barter.json recipe behind it.
 * Same store field and same toggle the curated rows use, so a gold pin behaves
 * identically everywhere: it shows on the dailies, syncs, and unpinning from
 * either side agrees. Compact and icon-only because a tile has room for one
 * control; the emerald fill matches the row buttons so the two read as the
 * same action. A tile's 44px target is smaller than the row's, which is the
 * tradeoff for keeping the grid dense.
 */
function GoldPinButton({ item }: { item: MerchantItem }) {
  const pinned = useAppStore((s) => s.barterPins.includes(item.pinId));
  const toggle = useAppStore((s) => s.toggleBarterPin);
  return (
    <button
      type="button"
      aria-label={pinned ? `取消選取 ${item.title}` : `選取 ${item.title}`}
      aria-pressed={pinned}
      onClick={() => toggle(item.pinId)}
      className={cn(
        "grid size-6 shrink-0 place-items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        pinned ? "bg-emerald-600 text-white" : "text-muted-foreground/60 hover:bg-accent hover:text-foreground"
      )}
    >
      <Pin className="size-3.5" fill={pinned ? "currentColor" : "none"} />
    </button>
  );
}

function MerchantGrid({ items }: { items: MerchantItem[] }) {
  return (
    <div className="@container">
      <div className="grid grid-cols-2 gap-2 @lg:grid-cols-3 @2xl:grid-cols-4 @4xl:grid-cols-5">
        {items.map((item) => (
          <article
            key={item.key}
            data-shop-tile
            className="flex flex-col gap-0.5 rounded-lg border bg-card p-2 transition-colors hover:bg-accent/40"
          >
            <h3 className="line-clamp-2 text-sm font-semibold leading-snug">{item.title.replace(/ ×\d+$/, "")}</h3>
            <p className="text-xs font-medium leading-snug text-foreground/80">{item.cost}</p>
            <div className="mt-auto flex items-center justify-between gap-1.5">
              <p className="text-[10px] leading-snug text-muted-foreground">{item.limitText ?? "不限次數"}</p>
              <div className="flex items-center gap-1">
                {item.priority && (
                  <Badge
                    variant={item.priority === "must" ? "default" : "secondary"}
                    className={cn("shrink-0 text-[10px]", item.priority === "must" && "bg-red-600 text-white hover:bg-red-700")}
                  >
                    {CURATED_LABEL[item.priority]}
                  </Badge>
                )}
                <GoldPinButton item={item} />
              </div>
            </div>
            {item.note && <p className="line-clamp-1 text-[10px] leading-snug italic text-muted-foreground">📝 {item.note}</p>}
          </article>
        ))}
      </div>
    </div>
  );
}

/** Mirrors BarterRowDesktop so gold and uncurated rows read as the same row:
 *  same container, portrait, title + badges, npc · town, 你給 → 你拿, cap and
 *  note. The pin button writes the tracker's pin under the row's shop:: id.
 *  The one thing it cannot copy is the expandable material breakdown, which
 *  needs a curated row too. */
function PlainRow({ item, onSelectNpc }: { item: MerchantItem; onSelectNpc: (npc: string) => void }) {
  const cap = item.limitText?.replace("（伺服器）", "");
  return (
    <div className="rounded-lg border bg-card px-3 py-2.5 [content-visibility:auto] [contain-intrinsic-size:auto_80px]">
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
      </div>
    </div>
  );
}

/** Curated rows get no pin overrides, so they read and write the tracker's
 *  `barterPins` directly: one pin per barter id, shared with the tracker tab
 *  and synced, instead of a second panel-local list. Uncurated barter rows
 *  reuse the same button under their shop:: id, so a pin looks and behaves the
 *  same whichever of the two it is. */
function MerchantRows({ items, onSelectNpc }: { items: MerchantItem[]; onSelectNpc: (npc: string) => void }) {
  const isMobile = useIsMobile();
  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => {
        if (item.barterRow) {
          const Row = isMobile ? BarterRowMobile : BarterRowDesktop;
          return <Row key={item.barterId} b={item.barterRow} onSelectNpc={onSelectNpc} />;
        }
        return (
          <div key={item.key} className="flex items-stretch gap-2">
            <div className="min-w-0 flex-1">
              <PlainRow item={item} onSelectNpc={onSelectNpc} />
            </div>
            <BarterPinButton id={item.pinId} />
          </div>
        );
      })}
    </div>
  );
}

/** Gold is a price comparison, so it reads fine as tiles. Barter is a recipe:
 *  what you hand over and what it costs to make is the point, so it keeps the
 *  full barter row (material chain, NPC, note) instead of a tile. */
function TabContent({ items, tab, onSelectNpc }: { items: MerchantItem[]; tab: NpcTab; onSelectNpc: (npc: string) => void }) {
  return tab === "gold"
    ? <MerchantGrid items={items} />
    : <MerchantRows items={items} onSelectNpc={onSelectNpc} />;
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
  const [query, setQuery] = useState("");
  const [selectedOnly, setSelectedOnly] = useState(false);
  // The tracker's pin list, shared: pinning here and pinning in the tracker are
  // the same action on the same barter id, and the pins sync with it.
  const barterPins = useAppStore((s) => s.barterPins);
  // The grid is the shop view now, so it needs no param: this is the inverse gate.
  // The shipped row/tab UI is still reachable at ?rows=1 (DEV only) so the two can
  // be compared while the grid is polished. Both this param and that UI are deleted
  // in the fold-in, which is why the row components below are still compiled.
  const showRows = (() => {
    if (!import.meta.env.DEV) return false;
    return new URLSearchParams(window.location.search).get("rows") === "1";
  })();
  // Prototype-local filters: deliberately not persisted, so nothing here leaks into
  // the store or costs a version bump. The store used to carry a persisted
  // barterFilters with a priority field, but nothing read it after the old explorer
  // was deleted; it has since been removed outright (store v20), so there is no
  // production filter state to accidentally drive from an unshipped prototype.
  const [protoPriority, setProtoPriority] = useState<string[]>([]);
  const [protoKind, setProtoKind] = useState<string>("all");
  // The tile a jump just landed on, flashed and then cleared. Keyed by pinId, the
  // same id a pin uses: a curated barter row's `key` is the shop deal's key and is
  // absent when the row came from barter.json alone, while pinId is total.
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const focusTimer = useRef<number | null>(null);
  // The view to return to, armed by a jump and discharged by the 返回 chip. Null
  // when there is nothing to go back to, which is what hides the chip.
  const [preJump, setPreJump] = useState<ViewSnapshot | null>(null);
  const togglePin = useAppStore((s) => s.toggleBarterPin);

  const towns = useMemo(() => [...new Set(ALL_SHOP_ITEMS.map((item) => item.town))].sort(compareTowns), []);
  const options = useMemo(() => filterItems(ALL_SHOP_ITEMS, town, ""), [town]);
  const groups = useMemo(() => groupItems(options), [options]);
  const items = useMemo(
    () =>
      filterItems(ALL_SHOP_ITEMS, town, query)
        .filter((item) => merchant === "all" || item.npc === merchant)
        // PROTOTYPE filters. Applied here so every view below (all merchants, one
        // merchant, and the counts in the header) sees the same list.
        // Priority is multi-select: an empty set is unfiltered, otherwise a row
        // passes on any of the ticked tiers. Ticking several tiers widens the list
        // (union), which is what a filter is for.
        .filter((item) => protoPriority.length === 0 || (item.priority != null && protoPriority.includes(item.priority)))
        .filter((item) => protoKind === "all" || (protoKind === "shop" ? item.kind === "shop" : item.kind === "barter")),
    [town, query, merchant, protoPriority, protoKind],
  );

  const selected = merchant === "all" ? null : groups.find((group) => group.name === merchant) ?? null;
  const npcRows = selected?.rows ?? [];
  const visible = selected ? tabItems(npcRows, npcTab, query) : items;
  // Pinned rows resolve through barter.json, so a pin made in the tracker (or on
  // another device) shows here even when that row is not in shops.json. Matched
  // on pinId, not barterId: a gold pin has no barter.json id and would be
  // missing from its own 已選 list while still counted in the header.
  const pinnedItems = useMemo(() => {
    const wanted = new Set(barterPins);
    const fromShops = ALL_SHOP_ITEMS.filter((item) => wanted.has(item.pinId));
    const seen = new Set(fromShops.map((item) => item.pinId));
    const orphans = (barterJson as BarterJsonRow[])
      .filter((row) => wanted.has(row.id) && !seen.has(row.id))
      .map((row) => barterRowToItem(row));
    return [...fromShops, ...orphans].filter((item) => rowMatches(item, query));
  }, [barterPins, query]);

  /** Flash a tile and scroll to it. Shared by the in-card 在商店中查看 jump and the
   *  ?item= landing, so a shared link and a click land identically. */
  const focusTile = useCallback((key: string) => {
    setFocusKey(key);
    if (focusTimer.current) window.clearTimeout(focusTimer.current);
    focusTimer.current = window.setTimeout(() => setFocusKey(null), FOCUS_FLASH_MS);
  }, []);
  // Scroll to the flashed tile from here, not from focusTile: a jump switches merchant
  // in the same handler, so at call time the list still renders the OLD merchant and
  // the target is not mounted. This effect runs after the commit that mounts it. The
  // rAF waits one frame for layout, since scrollIntoView on a not-yet-laid-out node
  // lands nowhere.
  useEffect(() => {
    if (!focusKey) return;
    const raf = requestAnimationFrame(() => scrollToFocus(focusKey));
    return () => cancelAnimationFrame(raf);
  }, [focusKey]);
  useEffect(
    () => () => {
      if (focusTimer.current) window.clearTimeout(focusTimer.current);
    },
    []
  );

  /** The in-card jump: go to the merchant that PRODUCES the give, not the row being
   *  read. A same-session state transition, not a URL navigation: the panel is
   *  already mounted, and a reload would lose the shop state the jump depends on.
   *  The URL is rewritten as a shareable byproduct and never read back — an
   *  installed PWA that only gets focused never sees a param, which is why this is
   *  state and the URL is not the mechanism.
   *
   *  Clears every filter that could hide the target: the 優先度/類型 selects and the
   *  search box all sit between the lander and the tile, and a hidden target scrolls
   *  nowhere. Town/merchant are set from the producer instead of cleared, so the
   *  landed view is that merchant's section.
   *
   *  replaceState, not pushState: there is no in-app history to walk (the tab bar is
   *  useState in App.tsx), so a pushed entry would make Back leave the shop entirely
   *  rather than undo the jump. */
  const viewInShop = useCallback(
    (npc: string, giveName: string) => {
      // Snapshot BEFORE the setters run: React batches them, so reading after would
      // capture the jumped-to view instead of the one being left.
      setPreJump({
        town,
        merchant,
        npcTab,
        query,
        selectedOnly,
        protoPriority,
        protoKind,
        scrollY: typeof window === "undefined" ? 0 : window.scrollY,
      });
      setQuery("");
      setProtoPriority([]);
      setProtoKind("all");
      setSelectedOnly(false);
      setTown("all");
      setMerchant(npc);
      setNpcTab(firstTab(ALL_SHOP_ITEMS.filter((row) => row.npc === npc)));
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.set("npc", npc);
        url.searchParams.delete("item");
        window.history.replaceState(null, "", url.toString());
      }
      // Flash the row that produces the material: the producing merchant trades it as
      // the GET of one of its deals. Matched on get-name within that merchant, since
      // the producer leg is a shops.json entry with no barter-row pinId of its own.
      // get is the display string ("凱琳特製全麥麵包 ×3"), so compare the parsed name.
      // ALL_SHOP_ITEMS is module-level data, so the row resolves synchronously — the
      // only thing that has to wait is the DOM, which the focusKey effect handles.
      // Not found (a curation gap) still lands on the section, minus the flash.
      const row = ALL_SHOP_ITEMS.find((r) => r.npc === npc && parseItemQty(r.get).name === giveName);
      if (row) focusTile(row.pinId);
    },
    [focusTile, town, merchant, npcTab, query, selectedOnly, protoPriority, protoKind]
  );
  // One-shot landing for ?npc= and ?item=, the same convention the reminder params
  // use in useHourlyReminders: read once, act, then strip so the URL stops claiming
  // to be navigation state. A param is only reachable on a cold load anyway (an
  // installed PWA that gets focused never sees one), so keeping it around adds
  // nothing a reload would honour.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search);
    const npc = q.get("npc");
    const item = q.get("item");
    if (!npc && !item) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("npc");
    url.searchParams.delete("item");
    window.history.replaceState(null, "", url.toString());
    if (!npc && !item) return;
    // ?item= wins: it names an exact row, and knows its own NPC.
    const target = item ? ALL_SHOP_ITEMS.find((row) => row.pinId === item) : undefined;
    if (target) {
      setTown("all");
      setMerchant(target.npc);
      setNpcTab(firstTab(ALL_SHOP_ITEMS.filter((row) => row.npc === target.npc)));
      focusTile(target.pinId);
      return;
    }
    // Bare ?npc= (or an ?item= that no longer resolves — a data edit retires row
    // ids), which degrades to the merchant's section rather than a blank view.
    const group = groupItems(ALL_SHOP_ITEMS).find((entry) => entry.name === npc);
    if (!group) return;
    setTown("all");
    setMerchant(npc!);
    setNpcTab(firstTab(group.rows));
  }, [focusTile]);

  const writeNpcParam = (name: string) => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (name === "all") url.searchParams.delete("npc");
    else url.searchParams.set("npc", name);
    window.history.replaceState(null, "", url.toString());
  };

  const selectNpc = (name: string) => {
    setMerchant(name);
    setNpcTab(name === "all" ? "gold" : firstTab(groups.find((group) => group.name === name)?.rows ?? []));
    writeNpcParam(name);
  };

  // The reset button covers every filter in this row, the two prototype filters
  // included. They were missed when they were added, so the button stayed greyed
  // out while a priority or kind filter was live, and pressing it left them set.
  const filtersActive = town !== "all" || merchant !== "all" || protoPriority.length > 0 || protoKind !== "all";

  const clearFilters = () => {
    setTown("all");
    setMerchant("all");
    setNpcTab("gold");
    setProtoPriority([]);
    setProtoKind("all");
    writeNpcParam("all");
  };

  /** Discharge the 返回 chip: put back the filters and scroll a jump wiped. Runs as
   *  a same-session state restore, symmetric with the jump — the URL is rewritten to
   *  match so a shared link stops claiming the jumped-to merchant. */
  const goBack = () => {
    const snap = preJump;
    if (!snap) return;
    setTown(snap.town);
    setMerchant(snap.merchant);
    setNpcTab(snap.npcTab);
    setQuery(snap.query);
    setSelectedOnly(snap.selectedOnly);
    setProtoPriority(snap.protoPriority);
    setProtoKind(snap.protoKind);
    writeNpcParam(snap.merchant);
    setPreJump(null);
    // After the restore commits, put the viewport back where it was. The rAF lets
    // the restored list lay out first; without it the scroll lands on the wrong
    // height (the pre-jump scrollY measured against a different list).
    if (typeof window !== "undefined") {
      requestAnimationFrame(() => window.scrollTo({ top: snap.scrollY, behavior: "auto" }));
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <header className="rounded-2xl border bg-card p-4 sm:p-5">
        <div className="mb-4">
          <h1 className="text-2xl font-semibold">NPC 商店</h1>
          <p className="mt-1 text-sm text-muted-foreground">選擇 NPC 後，於頁籤內瀏覽完整內容</p>
        </div>
        <SearchControls query={query} onQueryChange={setQuery} selectedOnly={selectedOnly} onSelectedOnlyChange={setSelectedOnly} selectedCount={barterPins.length} />
      </header>

      {/* Armed by a jump, discharged here. Sits above the filters rather than in the
          toolbar grid: the jump clears the filters and switches merchant, so this is
          the one control that undoes the whole transition, and it would wrap the
          5-column grid if it were one more cell. Hidden on the ?rows=1 dev view,
          which predates the jump. */}
      {preJump && !showRows && (
        <div className="-mt-1">
          <button
            type="button"
            onClick={goBack}
            className="inline-flex items-center gap-1.5 rounded-full border bg-muted/50 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="size-3.5" />
            返回{preJump.merchant !== "all" ? ` ${preJump.merchant}` : preJump.town !== "all" ? ` ${preJump.town}` : "全部商店"}
          </button>
        </div>
      )}

      {/* 3 fields + the reset button on the row view; the grid adds 優先度 and
          類型, so the template has to widen or the fifth control wraps under the
          button */}
      {!selectedOnly && (
        <div
          className={cn(
            "grid gap-2",
            showRows
              ? "sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
              : "sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
          )}
        >
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
              // grouped by town: the list is already town-ordered, so headings
              // make that visible instead of leaving 36 rows to scan
              ...groups.map((group) => ({ value: group.name, label: group.name, group: group.town, icon: <NpcFace npc={group.name} size="size-5" /> })),
            ]}
            triggerClassName={cn("w-full", merchant !== "all" && "border-primary text-primary")}
          />
          {/* Grid-only filters: local state, so they reset on reload. They are
              hidden on the ?rows=1 comparison view, which has its own tabs. There
              is no store-side filter state to touch — barterFilters was removed at
              store v20. */}
          {!showRows && (
            <>
              <MenuMultiSelect
                values={protoPriority}
                ariaLabel="優先度"
                onChange={setProtoPriority}
                options={[
                  { value: "must", label: "必換" },
                  { value: "extra", label: "推薦" },
                  { value: "once", label: "一次性" },
                  { value: "situational", label: "視需求" },
                ]}
                triggerClassName={cn("w-full", protoPriority.length > 0 && "border-primary text-primary")}
              />
              <MenuSelect
                value={protoKind}
                ariaLabel="交易類型"
                onChange={setProtoKind}
                options={[
                  { value: "all", label: "全部類型" },
                  { value: "shop", label: "金幣" },
                  { value: "barter", label: "以物易物" },
                ]}
                triggerClassName={cn("w-full", protoKind !== "all" && "border-primary text-primary")}
              />
            </>
          )}
          <Button type="button" variant="ghost" onClick={clearFilters} disabled={!filtersActive} aria-label="清除全部篩選" className="h-9 shrink-0 self-center">
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
            <span className="text-sm text-muted-foreground">{pinnedItems.length} 筆</span>
          </div>
          {pinnedItems.length > 0 ? (
            showRows ? (
              <MerchantRows items={pinnedItems} onSelectNpc={selectNpc} />
            ) : (
              // grouped by merchant, in selection order: this view's premise is
              // that the order you picked things in is the order you want them
              <ProtoGrid
                items={pinnedItems}
                pinned={new Set(barterPins)}
                onTogglePin={togglePin}
                onViewInShop={viewInShop}
                focusKey={focusKey}
                byNpc
                splitKind
              />
            )
          ) : (
            <div className="rounded-xl border border-dashed py-16 text-center text-sm text-muted-foreground">尚無已選交易</div>
          )}
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
            {/* the grid drops the 金幣/以物易物 split, so the toggle belongs to the
                ?rows=1 comparison view only */}
            {selected && showRows && <NpcTabToggle items={npcRows} tab={npcTab} onChange={setNpcTab} />}
          </div>
          {/* The grid is the shop view. It sections by town when the list is
              unfiltered and by merchant once a town or NPC filter narrows it, since
              a town heading would then repeat a single value. ?rows=1 (DEV only)
              still shows the old row/tab UI for comparison; both that param and
              src/proto-grid/'s name are cleaned up in the fold-in. */}
          {showRows ? (
            selected ? (
              <TabContent items={visible} tab={npcTab} onSelectNpc={selectNpc} />
            ) : (
              <MerchantRows items={items} onSelectNpc={selectNpc} />
            )
          ) : (
            <ProtoGrid
              byNpc={town !== "all" || merchant !== "all"}
              splitKind={town !== "all" || merchant !== "all"}
              items={selected ? npcRows : items}
              pinned={new Set(barterPins)}
              onTogglePin={togglePin}
              onViewInShop={viewInShop}
              focusKey={focusKey}
            />
          )}
        </section>
      )}
    </div>
  );
}
