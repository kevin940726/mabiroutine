import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CompositionEvent } from "react";
import { ArrowLeft, MapPin, RotateCcw, Search, SlidersHorizontal, Store, X } from "lucide-react";
import { MenuSelect, MenuMultiSelect } from "@/components/MenuSelect";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { cn, focusSelectOnMount } from "@/lib/utils";
import { compareTowns } from "@/lib/towns";
import { useAppStore } from "@/store/useAppStore";
import { useIsMobile } from "@/hooks/useIsMobile";
import { costText, getText, loadShopNpcs, shopDeals, type CuratedPriority, type ShopDeal } from "@/lib/shops";
import { displayName, parseItemQty } from "@/lib/materials";
import { ShopGrid } from "@/components/shop/ShopGrid";
import { compareRows } from "@/components/shop/shared";
import { writeShopJumpParams } from "@/lib/shopJump";
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

/** The 優先度 / 類型 options, shared by the header's filter grid and the floating
 *  pill so the two surfaces cannot drift apart (the pill duplicates the header
 *  by design, but not the option list). */
const PRIORITY_OPTIONS = [
  { value: "must", label: "必換" },
  { value: "extra", label: "推薦" },
  { value: "once", label: "一次性" },
  { value: "situational", label: "視需求" },
];
const KIND_OPTIONS = [
  { value: "all", label: "全部類型" },
  { value: "shop", label: "金幣" },
  { value: "barter", label: "以物易物" },
];

/** The compact trigger treatment for the floating pill. No fixed `h-*`: a px
 *  height does not grow with the browser font size, so at a 32px root the text
 *  was already taller than `h-7` and spilled out of a control that had gone
 *  circular. `h-auto min-h-7` lets the control take its text's height, `shrink-0`
 *  keeps the label on one line, and `whitespace-nowrap` stops it wrapping into a
 *  column. The built-in `h-9` from MenuSelect is overridden explicitly (`h-auto`
 *  after it in the merge order). */
const PILL_TRIGGER = "h-auto min-h-7 shrink-0 rounded-full px-1.5 sm:px-2.5 text-xs gap-0.5 sm:gap-1 whitespace-nowrap";

/** True while the header controls (title card + filter grid) are on screen, so
 *  the pill needs no scroll offset from App.tsx across the tab Activity
 *  boundary. An IntersectionObserver on the controls wrapper, not a scrollY
 *  threshold: a threshold is a proxy that leaves both surfaces visible at some
 *  depths (a short viewport with the header still showing past 200px, or a tall
 *  one with it long gone), while visibility IS the rule — the pill duplicates
 *  the header's search and filters, so it exists only when those have scrolled
 *  away. Starts true (pill hidden): at load the header is on screen, and the
 *  observer corrects immediately if it is not. */
function useControlsInView(ref: { current: Element | null }) {
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), {
      threshold: 0,
    });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return inView;
}

/** Below this width the pill's four filter dropdowns go behind a drawer; at or
 *  above it they lay out inline.
 *
 *  The inline row scales with the root font (~535px at 16px, 794px at 24px,
 *  925px at 28px), so a boundary low enough for `sm` would overflow on a narrow
 *  desktop window with a zoomed font — the reason the drawer existed at all.
 *  1024px (`lg`) covers every size measured with room to spare, and below it the
 *  drawer is the right call anyway: the row genuinely lacks the space. */
const PILL_DRAWER_MAX_WIDTH = 1023;

/** True while the viewport is at or below `maxPx`. A one-off here rather than in
 *  `useIsMobile`, whose 639px meaning drives the app-wide mobile/desktop layout
 *  variants and must not shift for a pill's sake. */
function useNarrowerThan(maxPx: number) {
  const [narrow, setNarrow] = useState(() => window.matchMedia(`(max-width: ${maxPx}px)`).matches);
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${maxPx}px)`);
    const onChange = () => setNarrow(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [maxPx]);
  return narrow;
}

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
  priorityFilter: string[];
  kindFilter: string;
  scrollY: number;
  /** Which tab the jump came from. Shop-origin jumps restore shop filters;
   *  tracker-origin jumps switch the tab back. Set by snapshotView ("shop")
   *  and overridden by the tracker entry below. */
  origin: "tracker" | "shop";
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

/** Composition-aware search box: CJK input stays local until committed.
 *
 *  An IME keystroke fires `onChange` for every partial (unconverted) syllable —
 *  committing those would re-filter (and shrink/scroll the page) mid-word, so
 *  partial text lives in `draft` and only a finished value reaches the shared
 *  `query`: plain keystrokes commit immediately (today's live search, unchanged),
 *  a composition commits on `compositionend`, and blur always commits (the
 *  backstop for sessions an IME ends without events). The other surface's
 *  commits are adopted unless a composition is in flight here — the IME owns
 *  the field until it says done. setDraft with an identical value bails out, so
 *  adopting a self-commit never re-renders or jumps the caret.
 *
 *  Both search fields (header + pill) own one instance each; they stay in sync
 *  through `query`. Freezing the controlled value instead (no draft) is NOT an
 *  option: the composition text needs value updates to render, and holding it
 *  back breaks the IME session in some browsers. */
function useSearchBox(query: string, onQueryChange: (value: string) => void) {
  const [draft, setDraft] = useState(query);
  const composingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Adopt outside commits (the other field, clears, jumps) — never while THIS
  // field composes.
  useEffect(() => {
    if (!composingRef.current) setDraft(query);
  }, [query]);
  const commit = useCallback(
    (value: string) => {
      setDraft(value);
      onQueryChange(value);
    },
    [onQueryChange]
  );
  // The blur backstop (and the pill's collapse check) need the freshest text:
  // read the field, not state. Returns the committed value.
  const commitField = useCallback(() => {
    const value = inputRef.current?.value ?? draft;
    commit(value);
    return value;
  }, [commit, draft]);
  return {
    inputRef,
    draft,
    composingRef,
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      // Both signals: the ref (set by onCompositionStart) and the event's own
      // flag — neither is redundant across all IMEs and browsers.
      if (composingRef.current || (event.nativeEvent as InputEvent).isComposing) setDraft(value);
      else commit(value);
    },
    onCompositionStart: () => {
      composingRef.current = true;
    },
    onCompositionEnd: (event: CompositionEvent<HTMLInputElement>) => {
      composingRef.current = false;
      commit(event.currentTarget.value);
    },
    onBlurCommit: () => {
      composingRef.current = false;
      return commitField();
    },
  };
}

function SearchControls({ query, onQueryChange }: {
  query: string;
  onQueryChange: (query: string) => void;
}) {
  const box = useSearchBox(query, onQueryChange);
  return (
    <div className="relative min-w-0 flex-1">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={box.inputRef}
        value={box.draft}
        onChange={box.onChange}
        onCompositionStart={box.onCompositionStart}
        onCompositionEnd={box.onCompositionEnd}
        onBlur={box.onBlurCommit}
        placeholder="搜尋獎勵、材料、NPC 或城鎮"
        className="h-10 bg-background pl-9"
      />
    </div>
  );
}

/** Props are navigation only — the panel owns all filter state. `jumpRef` lets App
 *  fire a tracker-originated jump (tab switch is App's job, the filter reset is
 *  here); `onNavigateTab` lets the 返回 chip switch back to the tracker. */
export function MerchantPanel({ jumpRef, onNavigateTab }: {
  jumpRef?: { current: ((npc: string, pinIds: string[]) => void) | null };
  onNavigateTab?: (tab: "tracker" | "barter") => void;
}) {
  const [town, setTown] = useState("all");
  const [merchant, setMerchant] = useState("all");
  const [query, setQuery] = useState("");
  // The tracker's pin list, shared: pinning here and pinning in the tracker are
  // the same action on the same barter id, and the pins sync with it.
  const barterPins = useAppStore((s) => s.barterPins);
  // A Set, memoized: `items` (below) and several grid call sites all need
  // "is this row pinned", and rebuilding it per render per row is wasteful.
  const pinSet = useMemo(() => new Set(barterPins), [barterPins]);
  // Panel-local filters: deliberately not persisted, so nothing here leaks into
  // the store or costs a version bump. The store used to carry a persisted
  // barterFilters with a priority field, but nothing read it after the old explorer
  // was deleted; it has since been removed outright (store v20).
  const [priorityFilter, setPriorityFilter] = useState<string[]>(DEFAULT_PRIORITY);
  const [kindFilter, setKindFilter] = useState<string>("all");
  // The floating filter pill (barter tab's replacement for the character pill).
  // `showPill` is visibility-driven (see `useControlsInView`); `pillSearchOpen`
  // is the pill's only own state — every filter it shows is the panel's (Q1).
  const isMobile = useIsMobile();
  // The pill's four dropdowns go inline only when there is room for them; below
  // that they sit behind the drawer. Separate from `isMobile` on purpose (see
  // PILL_DRAWER_MAX_WIDTH).
  const pillUsesDrawer = useNarrowerThan(PILL_DRAWER_MAX_WIDTH);
  // Observed by `useControlsInView` (see below): while any of it is on screen
  // the pill stays hidden, so the two surfaces never co-exist.
  const controlsRef = useRef<HTMLDivElement | null>(null);
  // A focused field is never yanked: narrowing the list shortens the page, the
  // browser clamps the scroll, the header comes back into view — and without
  // this the pill (and the field being typed in) would vanish mid-word. Active
  // editing outranks the no-coexistence rule; blur restores it immediately.
  const [pillSearchFocused, setPillSearchFocused] = useState(false);
  // Called unconditionally and combined after: short-circuiting the hook call
  // itself (`focused || !useControlsInView(...)`) skips a hook on focused
  // renders, which violates the Rules of Hooks and unmounts the tree.
  const controlsInView = useControlsInView(controlsRef);
  const showPill = pillSearchFocused || !controlsInView;
  const [pillSearchOpen, setPillSearchOpen] = useState(false);
  // The pill's own search-box instance (the header owns the other — see
  // SearchControls). Shares `query`, buffers CJK composition in `draft`.
  const pillBox = useSearchBox(query, setQuery);
  // Stable across renders: an inline ref callback would detach/re-attach (and
  // re-run the focus-select) on every keystroke. Merges the box's field ref
  // with the mount autofocus.
  const setPillInputRef = useCallback(
    (el: HTMLInputElement | null) => {
      pillBox.inputRef.current = el;
      focusSelectOnMount(el);
    },
    [pillBox.inputRef]
  );
  // (focusKeys state lives beside flashTiles below.)
  const focusTimer = useRef<number | null>(null);
  // Guards the one-shot ?npc=/?item= landing below: set on first effect run AND
  // by the in-app jump, which writes fresh params just before the tab shows and
  // the effect runs for the first time. Without the second set the effect would
  // mistake the jump's own deep link for a cold load and strip it on arrival.
  // Refs survive Activity hide/show (only a true remount resets), so the guard
  // holds across tab switches.
  const landingDone = useRef(false);
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
  // Option lists shared by the header grid and the floating pill.
  const townOptions = useMemo(
    () => [{ value: "all", label: "全部城鎮" }, ...towns.map((value) => ({ value, label: value }))],
    [towns]
  );
  const npcOptions = useMemo(
    () => [
      { value: "all", label: "全部 NPC", icon: <span className="grid size-5 shrink-0 place-items-center rounded-full border bg-muted"><Store className="size-3" /></span> },
      // grouped by town: the list is already town-ordered, so headings
      // make that visible instead of leaving 36 rows to scan
      ...groups.map((group) => ({ value: group.name, label: group.name, group: group.town, icon: <NpcFace npc={group.name} size="size-5" /> })),
    ],
    [groups]
  );
  const items = useMemo(
    () => {
      // Orphans: pins that resolve only through barter.json (a tracker-made pin
      // for a row shops.json has no entry for). They rode along in the old
      // pinned-only list; folding them into the pool keeps them visible here
      // instead of dropping a pin the tracker still counts.
      const seen = new Set(ALL_SHOP_ITEMS.map((item) => item.pinId));
      const orphans = (barterJson as (typeof barterJson)[number][])
        .filter((row) => pinSet.has(row.id) && !seen.has(row.id))
        .map((row) => barterRowToItem(row));
      // Pinning order. Pins lead the list (see below), so `barterPins` IS that
      // order; a row missing from it sorts with the unpinned rest rather than
      // being dropped.
      const rank = new Map(barterPins.map((id, i) => [id, i]));
      return filterItems([...ALL_SHOP_ITEMS, ...orphans], town, query)
        .filter((item) => merchant === "all" || item.npc === merchant)
        // Applied here so every view below (all merchants, one merchant, and the
        // counts in the header) sees the same list.
        //
        // Priority is multi-select: an empty set is unfiltered, otherwise a row
        // passes on any of the ticked tiers. Ticking several tiers widens the list
        // (union), which is what a filter is for.
        //
        // A non-empty query SUSPENDS this filter — typed text names what the user
        // wants, and the ticked tiers are (usually) a starting view they never
        // chose, not a choice. Without this a search only finds what the default
        // already shows: type 糖 with one 糖 row pinned and the list holds just
        // that pin, while the other NPCs selling it hide behind 必換+推薦 with no
        // way out in sight. The rule this encodes: explicit input overrides the
        // app's implicit default, never an explicit choice — town / NPC / kind
        // still narrow a search (their triggers show it when set), and the ticks
        // themselves are untouched, so clearing the query resumes exactly the
        // view the user left. The section header states the suspension while it
        // holds (see below), so the trigger reading 必換、推薦 during a search
        // is disclosed, not silent.
        //
        // A PINNED row bypasses this filter when no query suspends it. Pinning is
        // itself a deliberate act, so a pin the user made must not be hidden by a
        // default they did not choose — a pinned 一般 row would otherwise vanish
        // from the very list it was pinned from. The other filters (town / NPC /
        // kind / search) still apply to it: those are things the user set
        // explicitly, and honoring them keeps the pinned row in the context it
        // was found in. The section header names the bypass (see
        // `bypassedCount`), so the trigger reading 必換、推薦 while the list holds
        // a 視需求 row is stated, not silent.
        .filter(
          (item) =>
            priorityFilter.length === 0 ||
            query.trim() !== "" ||
            pinSet.has(item.pinId) ||
            (item.priority != null && priorityFilter.includes(item.priority))
        )
        .filter((item) => kindFilter === "all" || (kindFilter === "shop" ? item.kind === "shop" : item.kind === "barter"))
        // Order is town first (the canonical `TOWN_ORDER`, game-region order —
        // the same list the town dropdown offers), then pins, then tiers. Town
        // first because sections follow row order: sorting pins first GLOBALLY
        // drags a pinned town's whole section to the top (a pinned 地下城 row
        // put 地下城 first), so search results read in no recognizable order.
        // Pins still lead WITHIN their town — pinning visibly moves a row to
        // the top of its section, which is the feedback that the pin landed —
        // and the rest keeps the shop's tier reading order (`compareRows`), not
        // catalog order: the grid has always read 必換 first, and a pin landing
        // should not reshuffle everything below it. Unpinning drops a row back
        // to its tier position (or out of the list, if no ticked tier covers
        // it). The caller owns this order end to end, so the grid must keep
        // it: the panel passes `preserveOrder` (see below).
        .sort((a, b) => {
          const town = compareTowns(a.town, b.town);
          if (town !== 0) return town;
          const ar = rank.get(a.pinId);
          const br = rank.get(b.pinId);
          if (ar !== undefined && br === undefined) return -1;
          if (ar === undefined && br !== undefined) return 1;
          if (ar !== undefined && br !== undefined) return ar - br;
          return compareRows(a, b);
        });
    },
    [town, query, merchant, priorityFilter, kindFilter, pinSet, barterPins],
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
  // The rows the section below renders: one list, filtered once here so the
  // header count, the bypass caption, the empty state and the grid all read the
  // same array instead of each re-deriving it.
  const shown = selected ? npcRows : items;
  // How many of the SHOWN rows are present only because they are pinned — i.e.
  // the trigger reads 必換、推薦 while the list holds rows of other tiers. The
  // section header states this count, so the bypass is visible rather than a
  // silent exception. Zero when the priority filter is empty (nothing bypassed),
  // when a query suspends the filter (nothing is excepted — every tier shows),
  // or when every pin already sits inside a ticked tier.
  const bypassedCount = useMemo(() => {
    if (priorityFilter.length === 0 || query.trim() !== "") return 0;
    return shown.filter(
      (item) => pinSet.has(item.pinId) && !(item.priority != null && priorityFilter.includes(item.priority))
    ).length;
  }, [shown, priorityFilter, pinSet, query]);

  /** Flash tiles and scroll to the first. A SET, not a key: a tracker group-parent
   *  jump lands on every child at once, so all of them flash together under one
   *  timer. Single-row callers pass one element. Keys that never mount (a retired
   *  pin) simply match no tile; scrollToFocus reports it and no scroll happens. */
  const [focusKeys, setFocusKeys] = useState<string[]>([]);
  const flashTiles = useCallback((keys: string[]) => {
    setFocusKeys(keys);
    if (focusTimer.current) window.clearTimeout(focusTimer.current);
    focusTimer.current = window.setTimeout(() => setFocusKeys([]), FOCUS_FLASH_MS);
  }, []);
  // Scroll to the flashed tile from here, not from the jump: a jump switches merchant
  // in the same handler, so at call time the list still renders the OLD merchant and
  // the target is not mounted. This effect runs after the commit that mounts it. The
  // rAF waits one frame for layout, since scrollIntoView on a not-yet-laid-out node
  // lands nowhere. It also re-runs when the tab becomes visible again: Activity
  // tears down the hidden subtree's effects, so a jump fired from the tracker (shop
  // hidden) flashes and scrolls once the shop is shown.
  useEffect(() => {
    if (focusKeys.length === 0) return;
    const raf = requestAnimationFrame(() => scrollToFocus(focusKeys[0]));
    return () => cancelAnimationFrame(raf);
  }, [focusKeys]);
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
      priorityFilter,
      kindFilter,
      scrollY: typeof window === "undefined" ? 0 : window.scrollY,
      origin: "shop",
    }),
    [town, merchant, query, priorityFilter, kindFilter]
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
      setTown("all");
      setMerchant(npc);
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.set("npc", npc);
        url.searchParams.delete("item");
        // A later in-shop jump ends the tracker landing: the way back belongs
        // to the newest jump, and this one arms its own snapshot.
        url.searchParams.delete("from");
        window.history.replaceState(null, "", url.toString());
      }
      // Flash the row that produces the material: the producing merchant trades it as
      // the GET of one of its deals. Matched on get-name within that merchant, since
      // the producer leg is a shops.json entry with no barter-row pinId of its own.
      // get is the display string ("凱琳特製全麥麵包 ×3"), so compare the parsed name.
      // ALL_SHOP_ITEMS is module-level data, so the row resolves synchronously — the
      // only thing that has to wait is the DOM, which the focusKeys effect handles.
      // Not found (a curation gap) still lands on the section, minus the flash.
      const row = ALL_SHOP_ITEMS.find((r) => r.npc === npc && parseItemQty(r.get).name === giveName);
      if (row) flashTiles([row.pinId]);
    },
    [flashTiles, snapshotView]
  );
  // One-shot landing for ?npc= and ?item=, the same convention the reminder params
  // use in useHourlyReminders: read once, act, then strip so the URL stops claiming
  // to be navigation state. A param is only reachable on a cold load anyway (an
  // installed PWA that gets focused never sees one), so keeping it around adds
  // nothing a reload would honour.
  //
  // The once-guard is load-bearing, not belt-and-braces: Activity re-runs a
  // hidden tab's effects on EVERY show, so without it a tab switch back to the
  // shop would re-process whatever params the URL currently holds, clobbering
  // the merchant the user picked meanwhile. (Declared with the refs above: the
  // in-app jump sets it too, covering the first-show case.)
  useEffect(() => {
    if (landingDone.current) return;
    landingDone.current = true;
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search);
    const npc = q.get("npc");
    const item = q.get("item");
    const fromTracker = q.get("from") === "tracker";
    if (!npc && !item) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("npc");
    url.searchParams.delete("item");
    url.searchParams.delete("from");
    window.history.replaceState(null, "", url.toString());
    // A tracker jump copied as a link keeps its way back: arm 返回任務追蹤 with
    // the cold defaults (which ARE the pre-jump shop state on a fresh load —
    // the filter useStates initialize to exactly these). Bare ?npc= links
    // (in-shop jumps, hand-written URLs) arm nothing, as before.
    if (fromTracker && npc) {
      setPreJump({
        town: "all",
        merchant: "all",
        query: "",
        priorityFilter: DEFAULT_PRIORITY,
        kindFilter: "all",
        scrollY: 0,
        origin: "tracker",
      });
    }
    // ?item= wins: it names an exact row, and knows its own NPC.
    const target = item ? ALL_SHOP_ITEMS.find((row) => row.pinId === item) : undefined;
    if (target) {
      setTown("all");
      setMerchant(target.npc);
      flashTiles([target.pinId]);
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
  }, [flashTiles]);

  /** The tracker jump: a tracker row's icon deep-links to that row's NPC shop and
   *  flashes the row (one pinId) or the whole group (every child pinId). The tab
   *  switch itself is the caller's job (App owns `tab`); this runs while the shop
   *  is still hidden, and the flash/scroll effect fires once Activity shows it.
   *
   *  Resets EVERYTHING except the merchant: town, search, 優先度 and 類型 all go
   *  back to unfiltered, so the landed view is that merchant's full section and
   *  the target cannot be hidden behind a stale filter. The snapshot keeps origin
   *  "tracker" so 返回 switches the tab back instead of restoring shop filters.
   *  The URL names the merchant (and the exact row for a single pin) so the
   *  landing is shareable; the mount effect above honors both on a cold load. */
  const viewTaskInShop = useCallback(
    (npc: string, pinIds: string[]) => {
      setPreJump({ ...snapshotView(), origin: "tracker" });
      setQuery("");
      setPriorityFilter([]);
      setKindFilter("all");
      setTown("all");
      setMerchant(npc);
      writeShopJumpParams(npc, pinIds);
      // Claim the landing guard: the tab is about to show and the one-shot
      // effect runs for the first time — these params are the jump's own, not
      // a cold load, so the effect must leave them alone.
      landingDone.current = true;
      flashTiles(pinIds);
    },
    [flashTiles, snapshotView]
  );

  // Publish the tracker jump entry so App can fire it alongside the tab switch.
  // Assigned during RENDER, not in an effect, on purpose: Activity tears down
  // the hidden tab's effects (and never runs them for a panel that mounts
  // hidden), so an effect registration would be missing exactly when a tracker
  // click needs it — and its cleanup would null the ref on every switch back
  // to the tracker. Render assignment always holds the latest rendered closure
  // (an abandoned concurrent render could in theory leave a stale snapshot, but
  // the next commit overwrites it); what a click after any keystroke must see
  // is never older than the last paint.
  if (jumpRef) jumpRef.current = viewTaskInShop;

  const writeNpcParam = (name: string) => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (name === "all") url.searchParams.delete("npc");
    else url.searchParams.set("npc", name);
    // Any merchant change after a landing ends it: a copied URL must not offer
    // a way back to a jump the user already moved on from.
    url.searchParams.delete("from");
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

  // How many of the pill's four filter groups carry a narrowing value, for the
  // 篩選 trigger's badge. Counted per GROUP, not per value, so ticking three
  // 優先度 tiers reads 1 rather than 3 — the badge answers "how many things do I
  // go into the drawer to change", which is what the trigger promises.
  // `query` is excluded: it has its own control on the pill.
  const activeFilterCount =
    (town !== "all" ? 1 : 0) + (merchant !== "all" ? 1 : 0) + (priorityFilter.length > 0 ? 1 : 0) + (kindFilter !== "all" ? 1 : 0);

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
   *  match so a shared link stops claiming the jumped-to merchant.
   *
   *  Tracker-origin jumps switch the tab back instead: the snapshot's filters are
   *  still restored (so the shop keeps its pre-jump state for the next visit) and
   *  the scroll restore lands on the tracker's position, since both tabs share
   *  the window scroll and switching does not preserve it. */
  const goBack = () => {
    const snap = preJump;
    if (!snap) return;
    setTown(snap.town);
    setMerchant(snap.merchant);
    setQuery(snap.query);
    setPriorityFilter(snap.priorityFilter);
    setKindFilter(snap.kindFilter);
    writeNpcParam(snap.merchant);
    setPreJump(null);
    if (snap.origin === "tracker") onNavigateTab?.("tracker");
    // After the restore commits, put the viewport back where it was. The rAF lets
    // the restored list lay out first; without it the scroll lands on the wrong
    // height (the pre-jump scrollY measured against a different list).
    if (typeof window !== "undefined") {
      requestAnimationFrame(() => window.scrollTo({ top: snap.scrollY, behavior: "auto" }));
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Floating filter pill — the barter tab's replacement for the character
          pill (docs/plans/floating-pill-rework.md). It owns no filter state:
          every control drives the panel's own useState, so the pill and the
          header are two surfaces onto one state. It shows only while the header
          controls are off screen (see `useControlsInView`), so the two never
          co-exist — except for a focused search field, which is never yanked
          mid-word (see `pillSearchFocused`). */}
      <div
        className={cn(
          // Hugs its content (`w-max`) and never exceeds the viewport. It was
          // pinned full-width on a phone while the four dropdowns lived inline
          // (a long value needed a definite width to shrink against); those
          // moved into the drawer, so the phone row is now three fixed-width
          // items and nothing in it can grow — full width just left a gap.
          "fixed left-1/2 -translate-x-1/2 z-30 w-max max-w-[calc(100svw-2rem)] transition-all duration-300",
          showPill ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2 pointer-events-none"
        )}
        style={{ top: isMobile ? 70 : 88 }}
      >
        <div className="flex w-full items-center gap-0.5 sm:gap-1.5 rounded-full border bg-card shadow-md px-1.5 py-1.5 sm:px-2.5 text-xs relative isolate overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {pillSearchOpen ? (
            /* Search takes the whole row: on a phone a row of filters plus an
               inline field cannot fit, and a full-width field is a better
               target than a cramped 176px one anyway. */
            <div className="flex items-center gap-1 w-[calc(100svw-4rem)] sm:w-72">
              <Search className="pointer-events-none size-3.5 shrink-0 text-muted-foreground" />
              <input
                ref={setPillInputRef}
                value={pillBox.draft}
                onChange={pillBox.onChange}
                onCompositionStart={pillBox.onCompositionStart}
                onCompositionEnd={pillBox.onCompositionEnd}
                onFocus={() => setPillSearchFocused(true)}
                onBlur={() => { setPillSearchFocused(false); if (!pillBox.onBlurCommit()) setPillSearchOpen(false); }}
                onKeyDown={(event) => {
                  // Mid-composition Escape belongs to the IME (cancels the
                  // syllable); acting on it would yank the session. The flag
                  // covers browsers that don't mark the key event itself.
                  if (pillBox.composingRef.current) return;
                  if (event.key === "Escape") { setQuery(""); setPillSearchOpen(false); }
                }}
                placeholder="搜尋獎勵、材料、NPC 或城鎮"
                aria-label="搜尋獎勵、材料、NPC 或城鎮"
                className="h-auto min-h-7 min-w-0 flex-1 rounded-full border border-input bg-background px-2.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <button
                type="button"
                onMouseDown={(event) => {
                  // Keep focus in the field. Without this the tap blurs first,
                  // and the pill's visibility (focus-kept-alive near the top,
                  // controls rule elsewhere) would make the same tap end
                  // differently by scroll position: near the top the whole pill
                  // vanishes, far down it stays. Clearing must not move focus.
                  event.preventDefault();
                }}
                onClick={() => {
                  // Mid-composition the tap belongs to the IME, like Escape:
                  // clearing under an active session would split the field
                  // (still composing) from the query (emptied). With nothing to
                  // clear the X dismisses instead — the visible way back to the
                  // filter row now that clearing no longer closes it.
                  if (pillBox.composingRef.current) return;
                  if (query === "") setPillSearchOpen(false);
                  else setQuery("");
                }}
                aria-label="清除搜尋"
                className="grid h-auto min-h-7 w-auto min-w-7 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <>
              {query !== "" ? (
                /* A live query is state worth seeing, and the way back to it
                   without re-typing: the field is one tap away through the X. */
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label={`清除搜尋「${query}」`}
                  title={`搜尋：${query}`}
                  className="flex h-auto min-h-7 min-w-0 max-w-[8rem] shrink items-center gap-1 rounded-full border border-primary px-2 text-xs text-primary"
                >
                  <Search className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{query}</span>
                  <X className="h-3 w-3 shrink-0" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setPillSearchOpen(true)}
                  aria-label="搜尋"
                  className="grid h-auto min-h-7 w-auto min-w-7 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Search className="h-3.5 w-3.5" />
                </button>
              )}
              {/* One list, so the four filters are always here: there is no second
                  view for them to vanish into. 優先度 exempts pins (see `items`
                  and the section count), so a pin is never emptied by a default
                  the user did not choose. */}
              {pillUsesDrawer ? (
                <Drawer>
                  <DrawerTrigger asChild>
                    {/* On a phone the four controls do not fit the row (measured
                        ~390px of controls against a 358px phone row), so they live
                        behind one trigger and a drawer. On desktop the row has the
                        room and a drawer would cost an extra click, so the four are
                        laid out inline there instead — see the desktop branch below. */}
                    <button
                      type="button"
                      className={cn(
                        PILL_TRIGGER,
                        "flex items-center border border-input bg-transparent shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        activeFilterCount > 0 && "border-primary text-primary"
                      )}
                      aria-label={activeFilterCount > 0 ? `篩選（${activeFilterCount} 項已套用）` : "篩選"}
                    >
                      {/* The funnel is the Filters icon; the old RotateCcw reset
                          stays in the drawer's footer, where it can say 清除篩選. */}
                      <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" />
                      篩選
                      {activeFilterCount > 0 && (
                        <span className="grid h-4 min-w-4 shrink-0 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                          {activeFilterCount}
                        </span>
                      )}
                    </button>
                  </DrawerTrigger>
                  <DrawerContent aria-describedby={undefined}>
                    <DrawerHeader>
                      <DrawerTitle>篩選商店</DrawerTitle>
                      <DrawerDescription>選擇城鎮、NPC、優先度或類型，縮小下方清單</DrawerDescription>
                    </DrawerHeader>
                    {/* Each group keeps the SAME control the header grid uses, so
                        one surface cannot drift from the other; the drawer only
                        gives them a full-width row and a label of their own. */}
                    <div className="flex flex-col gap-3 overflow-y-auto">
                      <label className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium text-muted-foreground">城鎮</span>
                        <MenuSelect
                          value={town}
                          ariaLabel="城鎮"
                          onChange={(value) => { setTown(value); setMerchant("all"); writeNpcParam("all"); }}
                          options={townOptions}
                          triggerClassName="w-full"
                        />
                      </label>
                      <label className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium text-muted-foreground">NPC</span>
                        <MenuSelect
                          value={merchant}
                          ariaLabel="NPC"
                          onChange={selectNpc}
                          options={npcOptions}
                          triggerClassName="w-full"
                        />
                      </label>
                      <label className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium text-muted-foreground">優先度</span>
                        <MenuMultiSelect
                          values={priorityFilter}
                          ariaLabel="優先度"
                          onChange={setPriorityFilter}
                          options={PRIORITY_OPTIONS}
                          triggerClassName="w-full"
                        />
                      </label>
                      <label className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium text-muted-foreground">類型</span>
                        <MenuSelect
                          value={kindFilter}
                          ariaLabel="交易類型"
                          onChange={setKindFilter}
                          options={KIND_OPTIONS}
                          triggerClassName="w-full"
                        />
                      </label>
                    </div>
                    <DrawerFooter className="flex-row gap-2 border-t pt-3">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={clearFilters}
                        disabled={!filtersActive}
                        className="flex-1"
                      >
                        <RotateCcw />
                        清除篩選
                      </Button>
                      <DrawerClose asChild>
                        <Button type="button" className="flex-1">完成</Button>
                      </DrawerClose>
                    </DrawerFooter>
                  </DrawerContent>
                </Drawer>
              ) : (
                /* Desktop: the four dropdowns inline, each the same control the
                   header uses, so the header grid and the pill are two surfaces onto
                   one state and cannot drift. A trigger reads its short group name
                   while at its default and its chosen value once set, which is the
                   same convention the header uses (`全部城鎮` -> `城鎮`); keeping the
                   label short is what lets four of them fit one row. */
                <>
                  <MenuSelect
                    value={town}
                    ariaLabel="城鎮"
                    triggerLabel={town === "all" ? "城鎮" : undefined}
                    onChange={(value) => { setTown(value); setMerchant("all"); writeNpcParam("all"); }}
                    options={townOptions}
                    triggerClassName={cn(PILL_TRIGGER, "border border-input bg-transparent shadow-sm", town !== "all" && "border-primary text-primary")}
                    contentClassName="min-w-[12rem]"
                  />
                  <MenuSelect
                    value={merchant}
                    ariaLabel="NPC"
                    triggerLabel={merchant === "all" ? "NPC" : undefined}
                    onChange={selectNpc}
                    options={npcOptions}
                    triggerClassName={cn(PILL_TRIGGER, "border border-input bg-transparent shadow-sm", merchant !== "all" && "border-primary text-primary")}
                    contentClassName="min-w-[12rem]"
                  />
                  <MenuMultiSelect
                    values={priorityFilter}
                    ariaLabel="優先度"
                    triggerLabel={priorityFilter.length === 0 ? "優先度" : undefined}
                    onChange={setPriorityFilter}
                    options={PRIORITY_OPTIONS}
                    triggerClassName={cn(PILL_TRIGGER, "border border-input bg-transparent shadow-sm", priorityFilter.length > 0 && "border-primary text-primary")}
                    contentClassName="min-w-[12rem]"
                  />
                  <MenuSelect
                    value={kindFilter}
                    ariaLabel="交易類型"
                    triggerLabel={kindFilter === "all" ? "類型" : undefined}
                    onChange={setKindFilter}
                    options={KIND_OPTIONS}
                    triggerClassName={cn(PILL_TRIGGER, "border border-input bg-transparent shadow-sm", kindFilter !== "all" && "border-primary text-primary")}
                    contentClassName="min-w-[12rem]"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={clearFilters}
                    disabled={!filtersActive}
                    aria-label="清除篩選"
                    title="清除篩選"
                    className={cn(PILL_TRIGGER, "text-muted-foreground hover:text-foreground disabled:opacity-40")}
                  >
                    <RotateCcw className="h-3.5 w-3.5 shrink-0" />
                    清除
                  </Button>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* The controls the pill duplicates. Observed (see `useControlsInView`):
          one wrapper so a single entry answers "are the filters on screen".
          Same `gap-5` rhythm inside as the page uses outside, so wrapping
          changes no spacing — the chip's `-mt-1` still applies within. */}
      <div ref={controlsRef} className="flex min-w-0 flex-col gap-5">
      <header className="rounded-2xl border bg-card p-4 sm:p-5">
        <div className="mb-4">
          <h1 className="text-2xl font-semibold">商店 / 以物易物</h1>
        </div>
        <SearchControls query={query} onQueryChange={setQuery} />
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
            {preJump.origin === "tracker" ? "返回任務追蹤" : `返回${preJump.merchant !== "all" ? ` ${preJump.merchant}` : preJump.town !== "all" ? ` ${preJump.town}` : "全部商店"}`}
          </button>
        </div>
      )}

      {/* 優先度 and 類型 are grid filters, so the template needs five columns or the
          reset button wraps under the last control */}
      <div className={cn("grid gap-2", "sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]")}>
          <MenuSelect
            value={town}
            ariaLabel="城鎮"
            onChange={(value) => { setTown(value); setMerchant("all"); writeNpcParam("all"); }}
            options={townOptions}
            triggerClassName={cn("w-full", town !== "all" && "border-primary text-primary")}
          />
          <MenuSelect
            value={merchant}
            ariaLabel="NPC"
            onChange={selectNpc}
            options={npcOptions}
            triggerClassName={cn("w-full", merchant !== "all" && "border-primary text-primary")}
          />
          <MenuMultiSelect
            values={priorityFilter}
            ariaLabel="優先度"
            onChange={setPriorityFilter}
            options={PRIORITY_OPTIONS}
            triggerClassName={cn("w-full", priorityFilter.length > 0 && "border-primary text-primary")}
          />
          <MenuSelect
            value={kindFilter}
            ariaLabel="交易類型"
            onChange={setKindFilter}
            options={KIND_OPTIONS}
            triggerClassName={cn("w-full", kindFilter !== "all" && "border-primary text-primary")}
          />
          <Button type="button" variant="ghost" onClick={clearFilters} disabled={!filtersActive} aria-label="清除全部篩選" className="h-9 shrink-0 self-center">
            <RotateCcw />
            清除篩選
          </Button>
        </div>
      </div>

      {/* One list, no modes. Pins lead in pinning order (see `items`), so the
          default view IS pins ∪ the ticked tiers; there is no second view to
          switch to and no control that acts in one view and idles in another. */}
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
              {selected ? <><MapPin /> {selected.town} · {shown.length} 筆</> : `${shown.length} 筆`}
              {query.trim() !== "" && priorityFilter.length > 0 ? (
                <span>（搜尋時顯示所有優先度）</span>
              ) : (
                bypassedCount > 0 && <span>（含 {bypassedCount} 筆已釘選，不受優先度篩選）</span>
              )}
            </p>
          </div>
        </div>
          {/* The grid sections by town when the list is unfiltered and by merchant
              once a town or NPC filter narrows it, since a town heading would then
              repeat a single value. */}
          {shown.length === 0 ? (
            // Empty only ever means over-filtered: the unfiltered pool is the
            // whole catalog, so zero rows is always some combination of search +
            // filters hiding everything. Name that (a bare "0 筆" explains nothing)
            // and offer the one tap that undoes it — the filters stay intact
            // until the user chooses to clear them.
            <div className="rounded-xl border border-dashed py-16 text-center">
              <p className="text-sm font-medium">沒有符合條件的項目</p>
              <p className="mt-1 text-xs text-muted-foreground">搜尋與篩選會同時作用，試著放寬其中一邊</p>
              <Button type="button" variant="outline" onClick={clearFilters} className="mt-4">
                <RotateCcw />
                清除篩選
              </Button>
            </div>
          ) : (
          <ShopGrid
            byNpc={town !== "all" || merchant !== "all"}
            splitKind={town !== "all" || merchant !== "all"}
            items={shown}
            pinned={pinSet}
            onTogglePin={togglePin}
            onViewInShop={viewInShop}
            onOpenNpc={openNpc}
            focusKeys={focusKeys}
            // The caller owns the order end to end (pins lead, then tiers —
            // see `items`), so the grid keeps it instead of re-sorting.
            preserveOrder
          />
          )}
        </section>
    </div>
  );
}
