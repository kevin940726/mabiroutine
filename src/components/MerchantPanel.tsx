import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, MapPin, RotateCcw, Search, ShoppingBag, Store } from "lucide-react";
import { MenuSelect, MenuMultiSelect } from "@/components/MenuSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { compareTowns } from "@/lib/towns";
import { useAppStore } from "@/store/useAppStore";
import { costText, getText, loadShopNpcs, shopDeals, type CuratedPriority, type ShopDeal } from "@/lib/shops";
import { displayName, parseItemQty } from "@/lib/materials";
import { ShopGrid } from "@/components/shop/ShopGrid";
import { NpcFace } from "@/components/shop/NpcFace";
import type { ShopRow } from "@/components/shop/types";
import barterJson from "@/data/barter.json";

/** How long the jumped-to tile stays tinted. Long enough to find by eye after the
 *  scroll settles, short enough that it stops reading as a selected row. The timer
 *  is cleared on unmount and on a second jump so two quick jumps cannot leave the
 *  first one's timer to cut the second flash short. */
const FOCUS_FLASH_MS = 1600;

/** The 優先度 a fresh visit opens with: the two tiers worth acting on. 39 of the 194
 *  shop rows, which is the set the priority stripe already marks, so the shop opens on
 *  what the tracker actually asks you to do rather than on the whole catalog.
 *
 *  A default, not a floor: 清除篩選 empties it to show all 194 rows, and the 優先度
 *  trigger is highlighted and reads 必換/推薦 from the first paint, so the filter is
 *  visible state rather than a hidden one. Without that the default would be
 *  indistinguishable from "no filter", and clearing would look like the only way to
 *  see rows it had been hiding. */
const DEFAULT_PRIORITY = ["must", "extra"];

/** Scroll the flashed tile into the middle of the viewport. "center" rather than
 *  "start": the card can sit directly under a tile, and a top-aligned scroll puts
 *  the target under the sticky header on desktop. */
function scrollToFocus(key: string): boolean {
  const el = document.querySelector(`[data-tile-key="${CSS.escape(key)}"]`);
  if (!(el instanceof HTMLElement)) return false;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  return true;
}

/** The view state a jump wipes, kept so the 返回 chip can put it back. A jump
 *  clears every filter and switches merchant, which is right for landing on the
 *  producing shop but destroys the context you were reading. Scroll is part of it:
 *  the whole point is to return to the row you left, not just its filters. */
type ViewSnapshot = {
  town: string;
  merchant: string;
  query: string;
  selectedOnly: boolean;
  priorityFilter: string[];
  kindFilter: string;
  scrollY: number;
};

type MerchantGroup = { name: string; town: string; rows: ShopRow[] };

function toItem(deal: ShopDeal): ShopRow {
  return {
    key: deal.key,
    npc: deal.npc,
    town: deal.town,
    title: getText(deal),
    rawName: deal.name,
    // costText owns the gold glyph, so `cost` and `give` are the same string
    // here. They are kept as separate fields because a barter row's give is a
    // material while a gold row's is a price, and the row layouts read them
    // differently.
    give: costText(deal),
    // gold has no get: the coin glyph makes the whole trade. Cosmetics, so the
    // field is total rather than optional.
    get: deal.kind === "barter" ? getText(deal) : "",
    cost: costText(deal),
    costCurrency: deal.costCurrency,
    costAmount: deal.costAmount ?? null,
    limitText: deal.limitText,
    scopeAccount: deal.scopeAccount,
    priority: deal.priority,
    note: deal.note,
    kind: deal.kind,
    curatedIndex: deal.curatedIndex,
    barterId: deal.barterId,
    pinId: deal.pinId,
  };
}

/**
 * Default listing follows the hand-curated barter.json order rather than
 * shops.json: curated barter first, then the barter rows nobody curated, then
 * every gold purchase last. Within each band the source order is kept, so the
 * list is stable instead of reshuffling when data gains rows.
 */
const ALL_SHOP_ITEMS: ShopRow[] = (() => {
  const items = shopDeals(loadShopNpcs()).map(toItem);
  const curated = items.filter((item) => item.curatedIndex >= 0).sort((a, b) => a.curatedIndex - b.curatedIndex);
  const rest = items.filter((item) => item.curatedIndex < 0);
  return [...curated, ...rest.filter((item) => item.kind === "barter"), ...rest.filter((item) => item.kind === "shop")];
})();

/** A pin can point at a curated row that shops.json has no entry for, so build
 *  the row straight from barter.json — same shape as a shop-derived item. */
function barterRowToItem(row: (typeof barterJson)[number]): ShopRow {
  return {
    key: `curated-only::${row.id}`,
    npc: row.npc,
    town: row.town,
    title: row.get,
    // row.get carries the yield inline (`… ×1`), so the icon key is the parsed part.
    // parseItemQty, not displayName: the raw name keeps its half-width parens.
    rawName: parseItemQty(row.get).name,
    give: row.give,
    get: row.get,
    cost: row.give,
    // A curated row's cost is a material string (`皮革+ ×5`), so the parts come from
    // parsing it rather than from a currency field. Same split as the icon key above.
    costCurrency: parseItemQty(row.give).name,
    costAmount: parseItemQty(row.give).qty,
    limitText: row.limit ?? null,
    scopeAccount: row.perChar === false,
    priority: row.priority as CuratedPriority,
    note: row.note ?? null,
    kind: "barter",
    curatedIndex: -1,
    barterId: row.id,
    pinId: row.id,
  };
}

function rowMatches(item: ShopRow, query: string) {
  // Fold BOTH sides, so a query typed or pasted in either paren width matches a row
  // whose text carries the other. `displayName` narrows to half-width, and the fields
  // below are not uniformly spelled (a `note` is free text), so folding only the query
  // would still miss a full-width `（` sitting inside a note. Folding the haystack too
  // makes the two comparable regardless of which width either side happens to use.
  //
  // The thin space `displayName` inserts before a suffix is STRIPPED here, on both
  // sides, because it is typography rather than content: a name pasted from the game
  // arrives as `設計圖(3級)` with no space, and it has to match the spaced display form
  // `設計圖 (3級)`. Without this the search would fail on exactly the paste it exists
  // to serve, and it would fail quietly.
  const fold = (v: string) => displayName(v).replace(/\u2009/g, "").toLocaleLowerCase("zh-Hant");
  const q = fold(query.trim());
  if (!q) return true;
  return fold(`${item.title} ${item.give} ${item.npc} ${item.town} ${item.note ?? ""}`).includes(q);
}

function filterItems(items: ShopRow[], town: string, query: string) {
  return items.filter((item) => (town === "all" || item.town === town) && rowMatches(item, query));
}

function groupItems(items: ShopRow[]) {
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
  const [query, setQuery] = useState("");
  const [selectedOnly, setSelectedOnly] = useState(false);
  // The tracker's pin list, shared: pinning here and pinning in the tracker are
  // the same action on the same barter id, and the pins sync with it.
  const barterPins = useAppStore((s) => s.barterPins);
  // Panel-local filters: deliberately not persisted, so nothing here leaks into
  // the store or costs a version bump. The store used to carry a persisted
  // barterFilters with a priority field, but nothing read it after the old explorer
  // was deleted; it has since been removed outright (store v20).
  const [priorityFilter, setPriorityFilter] = useState<string[]>(DEFAULT_PRIORITY);
  const [kindFilter, setKindFilter] = useState<string>("all");
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
  // The merchant PICKER and the header's town use these: the option list should
  // show every merchant in a town regardless of the priority/kind/search filters,
  // so this is intentionally town-only. It is NOT the source of the selected
  // merchant's grid rows — that is `npcRows`, derived from `items` below.
  const options = useMemo(() => filterItems(ALL_SHOP_ITEMS, town, ""), [town]);
  const groups = useMemo(() => groupItems(options), [options]);
  const items = useMemo(
    () =>
      filterItems(ALL_SHOP_ITEMS, town, query)
        .filter((item) => merchant === "all" || item.npc === merchant)
        // Applied here so every view below (all merchants, one merchant, and the
        // counts in the header) sees the same list.
        // Priority is multi-select: an empty set is unfiltered, otherwise a row
        // passes on any of the ticked tiers. Ticking several tiers widens the list
        // (union), which is what a filter is for.
        .filter((item) => priorityFilter.length === 0 || (item.priority != null && priorityFilter.includes(item.priority)))
        .filter((item) => kindFilter === "all" || (kindFilter === "shop" ? item.kind === "shop" : item.kind === "barter")),
    [town, query, merchant, priorityFilter, kindFilter],
  );

  const selected = merchant === "all" ? null : groups.find((group) => group.name === merchant) ?? null;
  // The selected merchant's rows come from the SAME fully-filtered `items` list,
  // not from `options`/`groups`. Those carry only the town filter, so sourcing the
  // grid from them silently dropped 優先度, 類型 and the search box the moment a
  // merchant was picked — the opposite of what openNpc promises ("keeps the current
  // filters ... wants that merchant's 必換 rows, not an unfiltered dump").
  const npcRows = useMemo(
    () => (merchant === "all" ? [] : items.filter((item) => item.npc === merchant)),
    [items, merchant]
  );
  // Pinned rows resolve through barter.json, so a pin made in the tracker (or on
  // another device) shows here even when that row is not in shops.json. Matched
  // on pinId, not barterId: a gold pin has no barter.json id and would be
  // missing from its own 已選 list while still counted in the header.
  const pinnedItems = useMemo(() => {
    const wanted = new Set(barterPins);
    const fromShops = ALL_SHOP_ITEMS.filter((item) => wanted.has(item.pinId));
    const seen = new Set(fromShops.map((item) => item.pinId));
    const orphans = (barterJson as (typeof barterJson)[number][])
      .filter((row) => wanted.has(row.id) && !seen.has(row.id))
      .map((row) => barterRowToItem(row));
    // Selection order. The 已選 view promises "依選取順序" and pins are appended as
    // they are made, so `barterPins` IS that order; a row missing from it (a pin
    // that did not resolve) sorts last rather than being dropped.
    const rank = new Map(barterPins.map((id, i) => [id, i]));
    return [...fromShops, ...orphans]
      .filter((item) => rowMatches(item, query))
      .sort((a, b) => (rank.get(a.pinId) ?? Infinity) - (rank.get(b.pinId) ?? Infinity));
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

  /** The view a jump leaves behind, captured BEFORE the setters run: React batches
   *  them, so reading after would capture the jumped-to view instead. Shared by the
   *  popover jump and the portrait-band open, so 返回 restores the same shape from
   *  either entry point. */
  const snapshotView = useCallback(
    (): ViewSnapshot => ({
      town,
      merchant,
      query,
      selectedOnly,
      priorityFilter,
      kindFilter,
      scrollY: typeof window === "undefined" ? 0 : window.scrollY,
    }),
    [town, merchant, query, selectedOnly, priorityFilter, kindFilter]
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
      setPreJump(snapshotView());
      setQuery("");
      setPriorityFilter([]);
      setKindFilter("all");
      setSelectedOnly(false);
      setTown("all");
      setMerchant(npc);
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
    [focusTile, snapshotView]
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
    // ?item= wins: it names an exact row, and knows its own NPC.
    const target = item ? ALL_SHOP_ITEMS.find((row) => row.pinId === item) : undefined;
    if (target) {
      setTown("all");
      setMerchant(target.npc);
      focusTile(target.pinId);
      return;
    }
    // Fall back to ?npc=, which covers both a bare NPC link and an ?item= whose row
    // was retired by a data edit. A stale ?item= with NO npc lands on the default
    // view: there is no merchant to degrade to, and inventing one would be worse
    // than the unfiltered shop.
    if (!npc) return;
    const group = groupItems(ALL_SHOP_ITEMS).find((entry) => entry.name === npc);
    if (!group) return;
    setTown("all");
    setMerchant(npc);
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
    writeNpcParam(name);
  };

  /** Open a merchant's shop from a tile's portrait band. Same destination as the
   *  popover jump, but reached by browsing rather than by tracing a material, so it
   *  KEEPS the current filters: someone reading 必換 rows and tapping a merchant wants
   *  that merchant's 必換 rows, not an unfiltered dump. Only 返回 restores what the
   *  jump would have cleared, and arming it is the point — the chip is how you get
   *  back to the list you were scanning. */
  const openNpc = (npc: string) => {
    setPreJump(snapshotView());
    selectNpc(npc);
  };

  // The reset button covers every filter in this row, the two grid filters
  // included. They were missed when they were added, so the button stayed greyed
  // out while a priority or kind filter was live, and pressing it left them set.
  //
  // Priority counts as active whenever it is set at all, the default included: the
  // shop opens on 必換+推薦, which is hiding 155 of the 194 rows, so there IS something
  // to clear and the button says so. Treating the default as "not a filter" would leave
  // the one control that reveals those rows looking disabled on the very screen it
  // applies to. Pressing it empties the filter to all rows, so the outcome matches the
  // promise: enabled on load, disabled after it clears.
  // The search box is a filter too: with only a query typed the reset has something
  // to clear, so it is part of "active" and gets cleared below.
  const filtersActive =
    town !== "all" || merchant !== "all" || priorityFilter.length > 0 || kindFilter !== "all" || query !== "";

  const clearFilters = () => {
    setTown("all");
    setMerchant("all");
    setQuery("");
    // Empties the priority filter to show all 194 rows, the literal meaning of 清除.
    // The 必換+推薦 default is a starting view, not a floor: re-ticking the two tiers
    // in the 優先度 menu is how you get back, and the menu shows its state so that is
    // discoverable. Restoring the default here instead would make 清除篩選 HIDE 155
    // rows, which is the opposite of what the words promise.
    setPriorityFilter([]);
    setKindFilter("all");
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
    setQuery(snap.query);
    setSelectedOnly(snap.selectedOnly);
    setPriorityFilter(snap.priorityFilter);
    setKindFilter(snap.kindFilter);
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
          <h1 className="text-2xl font-semibold">商店 / 以物易物</h1>
          <p className="mt-1 text-sm text-muted-foreground">選擇 NPC 後，於頁籤內瀏覽完整內容</p>
        </div>
        <SearchControls query={query} onQueryChange={setQuery} selectedOnly={selectedOnly} onSelectedOnlyChange={setSelectedOnly} selectedCount={barterPins.length} />
      </header>

      {/* Armed by a jump, discharged here. Sits above the filters rather than in the
          toolbar grid: the jump clears the filters and switches merchant, so this is
          the one control that undoes the whole transition, and it would wrap the
          5-column grid if it were one more cell. */}
      {preJump && (
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

      {/* 優先度 and 類型 are grid filters, so the template needs five columns or the
          reset button wraps under the last control */}
      {!selectedOnly && (
        <div className={cn("grid gap-2", "sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]")}>
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
          <MenuMultiSelect
            values={priorityFilter}
            ariaLabel="優先度"
            onChange={setPriorityFilter}
            options={[
              { value: "must", label: "必換" },
              { value: "extra", label: "推薦" },
              { value: "once", label: "一次性" },
              { value: "situational", label: "視需求" },
            ]}
            triggerClassName={cn("w-full", priorityFilter.length > 0 && "border-primary text-primary")}
          />
          <MenuSelect
            value={kindFilter}
            ariaLabel="交易類型"
            onChange={setKindFilter}
            options={[
              { value: "all", label: "全部類型" },
              { value: "shop", label: "金幣" },
              { value: "barter", label: "以物易物" },
            ]}
            triggerClassName={cn("w-full", kindFilter !== "all" && "border-primary text-primary")}
          />
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
            // grouped by merchant, in selection order: this view's premise is
            // that the order you picked things in is the order you want them
            <ShopGrid
              items={pinnedItems}
              pinned={new Set(barterPins)}
              onTogglePin={togglePin}
              onViewInShop={viewInShop}
              onOpenNpc={openNpc}
              focusKey={focusKey}
              byNpc
              splitKind
              preserveOrder
            />
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
                {selected ? <><MapPin /> {selected.town} · {npcRows.length} 筆</> : `${items.length} 筆`}
              </p>
            </div>
          </div>
          {/* The grid sections by town when the list is unfiltered and by merchant
              once a town or NPC filter narrows it, since a town heading would then
              repeat a single value. */}
          <ShopGrid
            byNpc={town !== "all" || merchant !== "all"}
            splitKind={town !== "all" || merchant !== "all"}
            items={selected ? npcRows : items}
            pinned={new Set(barterPins)}
            onTogglePin={togglePin}
            onViewInShop={viewInShop}
            onOpenNpc={openNpc}
            focusKey={focusKey}
          />
        </section>
      )}
    </div>
  );
}
