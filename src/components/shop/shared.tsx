// Props and the pieces the shop grid shares: the sort, the priority signalling, the
// town/merchant sectioning and the trade popover. The tile lives in Tile.tsx.
import { Pin } from "lucide-react";
import { cn } from "@/lib/utils";
import { barterProducers, dealTimes, hasBarterOnlyRoute, hasBreakdown, parseItemQty } from "@/lib/materials";
import { MaterialHoverCard, QtyName } from "@/components/MaterialHoverCard";
import { Cost } from "./Cost";
import { NpcFace } from "./NpcFace";
import type { ShopRow } from "./types";

export type ShopProps = {
  items: ShopRow[];
  pinned: Set<string>;
  onTogglePin: (id: string) => void;
  /** Show the 金幣 / 以物易物 split inside each section. Set when a town or NPC filter
   *  narrows the list, where two labelled groups carry information; the full catalog
   *  view is left unsplit. */
  splitKind?: boolean;
  /** Section by NPC rather than town. Set when a town or NPC filter narrows the view,
   *  so a town heading would repeat a single value. */
  byNpc?: boolean;
  /** The in-card 在商店中查看 jump, offered on each tile's trade popover. It targets
   *  the merchant that PRODUCES the give (a different shop than the tile being read),
   *  plus the material name so the caller can flash the producing row. Absent when
   *  the caller has no shop view to jump to. */
  onViewInShop?: (npc: string, giveName: string) => void;
  /** Open a merchant's own shop, from the tile's portrait band. Same destination as the
   *  popover's jump but a different intent: this goes to THAT merchant's section, so
   *  there is no row to flash. Kept apart from onViewInShop rather than passing an
   *  empty material name, so each callback says what it does. */
  onOpenNpc?: (npc: string, town: string) => void;
  /** pinIds of the tiles a jump just landed on — flashed, then cleared by the
   *  caller. A set because a group-parent jump lands on every child at once. */
  focusKeys?: string[];
  /** Keep the caller's array order instead of sorting by priority. The panel owns
   *  its order end to end (pins lead, then tiers — see its `items` memo), and a
   *  re-sort here would undo it, so the grid keeps what it is given. */
  preserveOrder?: boolean;
};

/** Priority reads on two channels: the word carries the tier, the stripe only
 *  marks the row as worth acting on (one colour survives colour blindness). */
const PRIORITY = {
  must: { edge: "bg-red-500 dark:bg-red-600", label: "必換" },
  extra: { edge: "bg-red-500 dark:bg-red-600", label: "推薦" },
} as const;

/** The verdict chip, for the two tiers that render a word. The word carries the
 *  tier, so the chip's colour is free to vary; the stripe stays one colour. */
const CHIP = {
  must: "bg-red-500/12 text-red-700 ring-red-500/30 dark:bg-red-400/15 dark:text-red-300 dark:ring-red-400/30",
  extra: "bg-amber-500/12 text-amber-700 ring-amber-500/30 dark:bg-amber-400/15 dark:text-amber-300 dark:ring-amber-400/30",
} as const;

/** Only 必換 and 推薦 render a word; the edge marks those two in one colour. */
export const priorityEdge = (p: ShopRow["priority"]) =>
  p === "must" || p === "extra" ? PRIORITY[p].edge : "bg-border";
export const priorityText = (p: ShopRow["priority"]) =>
  p === "must" || p === "extra" ? PRIORITY[p].label : null;
/** The verdict's chip classes, for the tiers that render a word. "" for the rest. */
export const priorityChip = (p: ShopRow["priority"]) =>
  p === "must" || p === "extra" ? CHIP[p] : "";

/** Not a hook — it reads a Set and returns JSX. Named as a plain function on
 *  purpose: it is called inside a .map, and a `use*` name there trips
 *  rules-of-hooks for no reason. */
export function pinButton(item: ShopRow, pinned: Set<string>, onTogglePin: (id: string) => void) {
  const isPinned = pinned.has(item.pinId);
  return {
    button: (
      <button
        key="pin"
        type="button"
        aria-label={isPinned ? `取消釘選 ${item.title}` : `釘選 ${item.title}`}
        aria-pressed={isPinned}
        onClick={(e) => {
          e.stopPropagation();
          onTogglePin(item.pinId);
        }}
        className={cn(
          "grid size-6 shrink-0 place-items-center rounded-full transition-colors",
          isPinned ? "bg-emerald-600 text-white" : "text-muted-foreground/50 hover:bg-accent hover:text-foreground"
        )}
      >
        <Pin className="size-3.5" fill={isPinned ? "currentColor" : "none"} />
      </button>
    ),
  };
}

/** Display-only: strip the （伺服器） suffix; the stored value keeps it. */
export const limitOf = (i: ShopRow) => (i.limitText ?? "不限次數").replace("（伺服器）", "");

/**
 * The merchant header used by every NPC-sectioned view: portrait, name, town and that
 * merchant's row count.
 */
export function NpcHeader({ npc, town, count }: { npc: string; town: string; count: number }) {
  return (
    <div className="mb-3 flex items-center gap-3 border-b pb-2">
      <NpcFace npc={npc} town={town} size="size-10" />
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-base font-semibold text-foreground">{npc}</h3>
        <p className="text-[11px] text-muted-foreground">
          {town} · {count} 筆
        </p>
      </div>
    </div>
  );
}

/**
 * Sort inside a section: priority, then authored order, then NPC.
 *
 * Tier order puts 必換 first because it is the one you act on, then 推薦, then
 * 一次性, then 視需求, then unranked. Unranked last because a row with no verdict is
 * not competing for your attention. The authored order is `curatedIndex`, the row's
 * position in the curated order list; -1 means no curated entry, so those sort after the ranked
 * rows in their tier rather than first.
 */
const PRIORITY_RANK: Record<string, number> = { must: 0, extra: 1, once: 2, situational: 3 };

export function compareRows(a: ShopRow, b: ShopRow) {
  const pa = a.priority ? (PRIORITY_RANK[a.priority] ?? 4) : 4;
  const pb = b.priority ? (PRIORITY_RANK[b.priority] ?? 4) : 4;
  if (pa !== pb) return pa - pb;

  const ca = a.curatedIndex < 0 ? Number.MAX_SAFE_INTEGER : a.curatedIndex;
  const cb = b.curatedIndex < 0 ? Number.MAX_SAFE_INTEGER : b.curatedIndex;
  if (ca !== cb) return ca - cb;

  return a.npc.localeCompare(b.npc, "zh-Hant");
}

/**
 * The trades, sectioned by town or by merchant, with the merchant inside each tile.
 *
 * Section key: NPC when a town or NPC filter narrows the view, otherwise town. With
 * one town selected there is exactly one town heading, which says nothing, and the
 * useful grouping is the merchants inside it.
 *
 * Header and tile band are alternatives and never both: a multi-merchant section gets
 * a portrait header and its tiles carry no band, while the unsectioned-by-merchant
 * view has no header above it so every tile carries its own band. A single-section view
 * has no header, so its bands come back.
 */
export function TradeGrid({
  items,
  byNpc,
  splitKind,
  preserveOrder,
  renderTile,
}: {
  items: ShopRow[];
  byNpc?: boolean;
  splitKind?: boolean;
  preserveOrder?: boolean;
  renderTile: (item: ShopRow, showBand: boolean) => React.ReactNode;
}) {
  // preserveOrder keeps the caller's sequence (pins lead, then tiers); otherwise
  // sort by priority tier, which is the shop's reading order.
  const sorted = preserveOrder ? [...items] : [...items].sort(compareRows);

  const keyed = new Map<string, ShopRow[]>();
  for (const i of sorted) {
    // Composite key: bare NPC names conflate same-name merchants across
    // towns into one section.
    const key = byNpc ? `${i.npc}::${i.town}` : i.town;
    const bucket = keyed.get(key);
    if (bucket) bucket.push(i);
    else keyed.set(key, [i]);
  }

  const single = keyed.size === 1;
  const showBandInGroup = !byNpc || single;

  const kindGroup = (rows: ShopRow[]) => {
    const gold = rows.filter((r) => r.kind === "shop");
    const barter = rows.filter((r) => r.kind === "barter");
    // a section with only one kind gets no labels: there is nothing to tell apart, and
    // a lone 金幣 heading above a whole section is a heading that says nothing
    if (!splitKind || gold.length === 0 || barter.length === 0) {
      return <div className={GRID}>{rows.map((r) => renderTile(r, showBandInGroup))}</div>;
    }
    const groups: { label: string; rows: ShopRow[] }[] = [
      { label: "金幣", rows: gold },
      { label: "以物易物", rows: barter },
    ];
    return (
      <div className="flex flex-col gap-3">
        {groups.map((g) => (
          <div key={g.label}>
            <h4 className="mb-1.5 flex items-baseline gap-1.5 text-[11px] font-semibold text-muted-foreground">
              <span>{g.label}</span>
              <span className="tabular-nums">{g.rows.length}</span>
            </h4>
            <div className={GRID}>{g.rows.map((r) => renderTile(r, showBandInGroup))}</div>
          </div>
        ))}
      </div>
    );
  };

  return (
    // `GRID_CONTAINER` here, on the one ancestor every grid instance shares: an
    // element cannot answer its own `@container` query, so the scope has to be a
    // wrapper. This is also the widest sensible scope — the section headings and
    // the sections themselves sit inside the same measured width. See the constant
    // for the caveat about the queries being unnamed.
    <div className={`flex flex-col gap-5 ${GRID_CONTAINER}`}>
      {[...keyed.entries()].map(([key, rows]) => (
        <section key={key}>
          {/* a single-section view has no header, so its tiles' bands carry the name */}
          {single ? null : byNpc ? (
            // `key` is the composite `npc::town` identity the section buckets on; the
            // header needs the DISPLAY name, so read it back off the rows. (Feeding the
            // key here rendered `npc::town` as both the label and the portrait path,
            // which 404'd into the initial-letter fallback.)
            <NpcHeader npc={rows[0]?.npc ?? key} town={rows[0]?.town ?? ""} count={rows.length} />
          ) : (
            <h3 className="mb-2 flex items-baseline gap-1.5 text-xs font-semibold text-muted-foreground">
              <span>{key}</span>
              <span className="tabular-nums">{rows.length}</span>
            </h3>
          )}
          {kindGroup(rows)}
        </section>
      ))}
    </div>
  );
}

/** The grid's track template: 2 columns on phones, 3 on a narrow desktop, 4 wide.
 *
 *  CONTAINER QUERIES, so the column count follows the width the GRID has, not the
 *  window's. The grid sits inside the shell's capped, padded column, so the window
 *  answer is always larger than the box being laid out. `GRID_CONTAINER` marks the
 *  ancestor these queries resolve against, and it is the same box the shell's cap
 *  constrains, so changing the cap moves the columns with it.
 *
 *  PX THRESHOLDS, not the container scale (`@3xl`, `@4xl`). A `rem` breakpoint
 *  resolves against the browser's INITIAL font size, so on a reader whose default is
 *  20px the same rules fire much later and the column count changes for reasons that
 *  have nothing to do with the width available. The thresholds are layout facts and
 *  stay in px; only the text inside them scales.
 *
 *  768px is 3 columns and 840px is 4. The shell caps at 896px, which leaves the grid
 *  864px, so the shop shows 4 columns with 24px of slack and the 768-839px band holds
 *  3. The slack keeps the pair from being tied by arithmetic: were the threshold equal
 *  to the grid width, a change to the shell's `px-4` would drop the shop to 3 columns
 *  silently.
 *
 *  The 4-column threshold and the name band's two-line reservation (Tile.tsx) must
 *  stay at DIFFERENT widths. Two container-query utilities at one width collide and
 *  the grid's own rule loses, leaving the reservation in force and the grid silently
 *  unchanged. Move both if the pair needs shifting, and check the built CSS after. */
export const GRID =
  "grid gap-3 sm:gap-5 items-start grid-cols-2 @min-[768px]:grid-cols-3 @min-[840px]:grid-cols-4";

/** The container the grid's width queries resolve against.
 *
 *  It has to be an ANCESTOR, not the grid itself: an element cannot answer its own
 *  container query.
 *
 *  CAVEAT, worth knowing before relying on it: the theme's `@min-[…]` variants compile
 *  to an UNNAMED `@container`, so they bind to the nearest ancestor that declares
 *  container-type, not to the `shop` name. The name is set here for the same reason,
 *  but nothing currently references it, so a new container introduced between this
 *  wrapper and the grid would silently take over the query. Use the named form on the
 *  query if that ever needs pinning. */
export const GRID_CONTAINER = "@container/shop";

/**
 * Hover/tap popover for one barter row, carrying the same MaterialBreakdown the old
 * row layout used to expand inline.
 *
 * It renders as the tile's WHOLE trade line, not just the give. MaterialHoverCard
 * draws its own `你給 X → 你拿 Y` line around the trigger, so wrapping only the give
 * printed the trade twice — measured on the first build: the tile read
 * `你給 | 鋼錠 | ×2 | → | 你拿 | 合金鋼錠×2` with the give named once by the trigger,
 * once by the row, and the qty stranded between them. Making the trigger the whole
 * line means the card's own line IS the tile's line, so nothing repeats and the
 * click target is the full trade instead of one word of it.
 *
 * Uses MaterialHoverCard rather than assembling a card here: it already has the
 * measured natural height, the flip-above / clamp-and-scroll, the 150ms
 * open-and-close forgiveness for a diagonal pointer path, and dismissal on scroll,
 * resize, Escape or an outside tap. It had no call site after the old explorer was
 * deleted, so this is what it was kept for.
 *
 * `times` comes from the row's own limit, resolved through dealTimes (a twin leg's
 * times, else the limit string, else 1). The breakdown multiplies its 共需 total by
 * it, so passing 1 unconditionally would under-report every multi-per-day trade.
 *
 * Renders the plain line with no hover when the give has no recipe, which is the
 * common case: hasBreakdown excludes trivial self-only leaves and gather-only paths.
 */
export function TradeLine({ item, onViewInShop }: { item: ShopRow; onViewInShop?: (npc: string, giveName: string) => void }) {
  const { name, qty } = parseItemQty(item.give);
  const times = dealTimes(item.npc, name, qty, item.limitText ?? undefined, item.town);
  // A barter row whose give IS a signature token currency (喵幣 / 愛心幣 / 魔物討伐證明)
  // is really a purchase priced in that token, not a material trade: 貓商人's 鱸魚,
  // 毒囊 and both 魔力石 rows hand over 喵幣 above and yield the item below, and every
  // 伊文 row is priced in 魔物討伐證明. Those render through `Cost`, so the price reads
  // as art with no `×` — the same shape gold has had all along — rather than as the
  // word `喵幣 ×20,000`. Everything else, including a material that merely HAS art
  // (生皮, 布料+), keeps the text form.
  //
  // The test reads `costCurrency`, NOT `parseItemQty(give).name`, and the difference
  // is not cosmetic: `give` for these rows is `喵幣 ×20,000`, and `parseItemQty`'s
  // `(\d+)` cannot match a comma-grouped amount, so it falls through to
  // `{ name: "喵幣 ×20,000", qty: 1 }` and the comparison silently fails. That is a
  // latent hole in `parseItemQty` for any comma number; it goes unreported because
  // every other caller parses a yield (`×10`), never a price. Reading the row's own
  // currency field avoids needing the parse at all.
  const pricedInIcon =
    item.costCurrency === "喵幣" || item.costCurrency === "愛心幣" || item.costCurrency === "魔物討伐證明";
  if (!hasBreakdown(name)) {
    return (
      <span className="text-[14px] font-semibold text-foreground">
        {pricedInIcon ? <Cost currency={item.costCurrency} amount={item.costAmount} /> : <QtyName text={item.give} />}
      </span>
    );
  }
  // The footer jumps to where the GIVE is obtained, which is a different merchant
  // than the row being read: a tile is `give → get`, so the row that produces the
  // give is not this tile. barterProducers resolves that leg.
  //
  // Resolved even when there is no jump target (onViewInShop absent): the producer and
  // the deal describe the item, not the link, so they must not vanish with it.
  const producers = barterProducers(name);
  const primary = producers[0];
  // The producer's own exchange, for the card's deal line. components[0] is what the
  // leg hands over (牛奶×10) and outQty is what the deal yields (麵包×3) — the qty is
  // on the leg, not in the component list, so it has to be read from both.
  const cost = primary?.components?.[0];
  const barter = {
    exclusive: hasBarterOnlyRoute(name),
    // Kept intact, scope tag included: the tile's limitOf strips （伺服器） because it
    // renders the scope as a separate tag, but the card has no such tag and the card is
    // where the deal gets planned — dropping per-char vs account-wide there loses a real
    // constraint. So the card spells 每日 1 次（伺服器） out in full.
    limit: primary?.limit,
    npc: primary?.npc,
    town: primary?.town,
    cost: cost ? { name: cost.name, qty: cost.qty } : undefined,
    out: primary?.npc ? { name, qty: primary.outQty ?? 1 } : undefined,
  };
  return (
    <span
      className="text-[14px] leading-tight break-words"
      // the tile is a whole-tile target; a tap on this line must only open the card
      onClick={(e) => e.stopPropagation()}
    >
      <MaterialHoverCard
        give={item.give}
        get={item.get}
        times={times}
        terse
        getless
        barter={barter}
        action={
          onViewInShop && primary?.npc
            ? {
                label: `在 ${primary.npc} 查看`,
                onClick: () => onViewInShop(primary.npc!, name),
              }
            : undefined
        }
      />
    </span>
  );
}
