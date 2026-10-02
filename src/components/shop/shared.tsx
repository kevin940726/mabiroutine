// Props and the pieces the shop grid shares: the sort, the priority signalling, the
// town/merchant sectioning and the trade popover. The tile lives in Tile.tsx.
import { Pin } from "lucide-react";
import { cn } from "@/lib/utils";
import { barterProducers, dealTimes, displayName, hasBarterOnlyRoute, hasBreakdown, parseItemQty } from "@/lib/materials";
import { MaterialHoverCard, QtyName } from "@/components/MaterialHoverCard";
import { ItemIcon } from "./ItemIcon";
import { NpcFace } from "./NpcFace";
import type { ShopRow } from "./types";

/** A price, as the shop shows it: gold is the coin glyph, and 喵幣 / 愛心幣 use their
 *  own art in place of the word.
 *
 *  The `×` is dropped for the icon form. Gold never had one (`🪙1,500`), and once the
 *  currency is a picture the count reads as the amount rather than as a multiplier of
 *  an invisible noun — `[喵幣]20,000`, not `[喵幣] ×20,000`. The text form keeps its
 *  `×` because there the word needs the separator (`生皮 ×3`).
 *
 *  Everything else is unchanged. The other 96 non-gold cost currencies (生皮, 合金鋼錠,
 *  布料+ …) DO have icon files, but a cost line drawn as art for all of them was more
 *  than was asked for, so only the two coin currencies and gold take this path.
 *
 *  `size` is small — a cost sits on a text line, not in a 72px frame, so it renders at
 *  the surrounding line's scale rather than the tile art's. */
export function Cost({
  currency,
  amount,
  size = "size-4",
}: {
  currency: string;
  amount: number | null;
  size?: string;
}) {
  const label = amount == null ? "價格未填" : amount.toLocaleString();
  if (currency === "gold") {
    return (
      <span className="inline-flex items-center gap-0.5 tabular-nums">
        <span aria-hidden>🪙</span>
        {label}
      </span>
    );
  }
  if (currency === "喵幣" || currency === "愛心幣") {
    return (
      <span className="inline-flex items-center gap-1 tabular-nums">
        <ItemIcon name={currency} size={size} />
        {label}
      </span>
    );
  }
  // The word form, unchanged: `生皮 ×3`. displayName folds the parens of a currency
  // that has them (none today, but the rule is the project's).
  return (
    <span className="tabular-nums">
      {displayName(currency)}
      {amount != null && amount > 0 ? ` ×${label}` : ""}
    </span>
  );
}

export type ShopProps = {
  items: ShopRow[];
  pinned: Set<string>;
  onTogglePin: (id: string) => void;
  /** Show the 金幣 / 以物易物 split inside each section. Set when a town or NPC filter
   *  narrows the list, where two labelled groups carry information; the full 194-row
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
  onOpenNpc?: (npc: string) => void;
  /** pinId of the tile a jump just landed on — flashed, then cleared by the caller. */
  focusKey?: string | null;
  /** Keep the caller's array order instead of sorting by priority. The 已選 view is
   *  the one caller that wants this: its promise is selection order, which
   *  `compareRows` would overwrite. */
  preserveOrder?: boolean;
};

/**
 * Priority reads as two facts: WHICH tier (the word, 必換 vs 推薦) and WHETHER the row
 * is marked at all (the stripe down the left edge).
 *
 * Those are deliberately different channels. The stripe used to carry the tier in its
 * colour too (red for 必換, amber for 推薦), which made it invisible to a red-green
 * colour-blind reader: red and amber collapse toward each other under deuteranopia and
 * protanopia, and no shade choice fixes that. So the stripe marks only "this row is
 * worth acting on", in one colour, and the tier lives in the WORD, which needs no
 * colour vision. `tint` is the word's colour — kept per-tier because it is a redundant
 * reinforcement of a distinction the word already makes in text, not the only signal.
 *
 * 視需求, 一次性 and no-priority rows get the normal border, not a colour. Measured:
 * 94 rows have no priority, 53 are 視需求 and 8 are 一次性, so 155 of 194 (80%) carried
 * one of five stripe colours that said nothing.
 */
const PRIORITY = {
  // One marker colour for every marked tier. Chosen on LIGHTNESS against the card
  // (light card is near-white, dark card near-black), since lightness survives
  // colour-blindness where hue does not: red-500 on light, red-600 on dark.
  must: { edge: "bg-red-500 dark:bg-red-600", text: "text-red-600 dark:text-red-400", label: "必換" },
  extra: { edge: "bg-red-500 dark:bg-red-600", text: "text-amber-600 dark:text-amber-400", label: "推薦" },
  once: { edge: "bg-border", text: "text-sky-600 dark:text-sky-400", label: "一次性" },
  situational: { edge: "bg-border", text: "text-zinc-500 dark:text-zinc-400", label: "視需求" },
} as const;

/** The verdict as a CHIP, for the tile's overlaid top-left mark.
 *
 *  The hue moves into a low-alpha tint and a ring so the word reads as a mark on the
 *  tile rather than as stray text: an absolutely-positioned word on a busy tile edge
 *  attaches itself to whatever happens to be beside it.
 *
 *  The tint is a per-TIER hue rather than the single colour `priorityEdge` uses, and
 *  that difference is deliberate. The stripe stays one colour because marked vs
 *  unmarked has to survive colour blindness as a difference in lightness; the chip's
 *  WORD carries the tier, so its colour is free to vary.
 *
 *  The dark values are lower-alpha lighter steps rather than the light values hue-
 *  swapped, following the repo's dark-tint convention: the dark card is
 *  oklch(0.205 0 0), so a light-mode tint at a real alpha glares. */
const CHIP = {
  must: "bg-red-500/12 text-red-700 ring-red-500/30 dark:bg-red-400/15 dark:text-red-300 dark:ring-red-400/30",
  extra: "bg-amber-500/12 text-amber-700 ring-amber-500/30 dark:bg-amber-400/15 dark:text-amber-300 dark:ring-amber-400/30",
  once: "bg-sky-500/12 text-sky-700 ring-sky-500/30 dark:bg-sky-400/15 dark:text-sky-300 dark:ring-sky-400/30",
  situational: "bg-zinc-500/12 text-zinc-600 ring-zinc-500/30 dark:bg-zinc-400/15 dark:text-zinc-300 dark:ring-zinc-400/30",
} as const;

/** Only 必換 and 推薦 render a word. 視需求 is the true default (53 rows) so naming
 *  it says nothing, and 一次性 reads as a warning but behaves like 推薦 for planning.
 *  Labels stay on the tiers that never render, so the map is total.
 *
 *  The edge marks the two tiers that render a word, in one colour. It is intentionally
 *  NOT a per-tier colour: see the PRIORITY comment — the tier is the word's job. */
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
        aria-label={isPinned ? `取消選取 ${item.title}` : `選取 ${item.title}`}
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

/**
 * The limit, with the （伺服器） suffix stripped.
 *
 * `limitText` is built in shops.ts:118 as `每日 N 次（伺服器）`, so the string carries
 * the scope inside it. The tile renders scope separately, and the parenthetical said
 * the same thing a second time in the same line. Stripping here is display-only; the
 * value the tracker and the store see still has it.
 *
 * This mirrors MerchantPanel.tsx, which does the same strip for the production row
 * (and both should go away together if limitText ever stops embedding scope).
 */
export const limitOf = (i: ShopRow) => (i.limitText ?? "不限次數").replace("（伺服器）", "");

/**
 * The merchant header used by every NPC-sectioned view: portrait, name, town and that
 * merchant's row count.
 */
export function NpcHeader({ npc, town, count }: { npc: string; town: string; count: number }) {
  return (
    <div className="mb-3 flex items-center gap-3 border-b pb-2">
      <NpcFace npc={npc} size="size-10" />
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
 * position in barter.json; -1 means no curated entry, so those sort after the ranked
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
  // preserveOrder keeps the caller's sequence (the 已選 view's selection order);
  // otherwise sort by priority tier, which is the shop's reading order.
  const sorted = preserveOrder ? [...items] : [...items].sort(compareRows);

  const keyed = new Map<string, ShopRow[]>();
  for (const i of sorted) {
    const key = byNpc ? i.npc : i.town;
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
    <div className="flex flex-col gap-5">
      {[...keyed.entries()].map(([key, rows]) => (
        <section key={key}>
          {/* a single-section view has no header, so its tiles' bands carry the name */}
          {single ? null : byNpc ? (
            <NpcHeader npc={key} town={rows[0]?.town ?? ""} count={rows.length} />
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

/** The grid: 2 columns on phones, 3 from lg (1024px), 4 from xl (1280px).
 *
 *  Two columns on a phone, which REVERSES an earlier decision. The old note read
 *  "one column because two leaves a 154px tile carrying a 15px CJK title: 高級鍊金術再
 *  燃燒催化劑 wrapped to three lines, the trade line wrapped with it, and the merchant
 *  name truncated". That was measured before the tile was re-cut around the item art and
 *  before the name band reserved its second line, and neither part still holds. Forced
 *  to two columns across all 194 real rows:
 *
 *  | viewport | tile  | names wrapping | costs wrapping | most lines |
 *  |---|---|---|---|---|
 *  | 360px | 158px | 14 | 12 | 2 |
 *  | 390px | 173px | 12 |  8 | 2 |
 *  | 430px | 193px |  5 |  4 | 2 |
 *
 *  (Those tile widths are with the `gap-3` below `sm`; at `gap-5` they are 154 / 169 /
 *  189px and the wrap counts are the same.)
 *
 *  Nothing exceeds two lines at any phone width, which is the case the name band already
 *  reserves for (`xl:min-h-[2lh]` is `xl`-gated, but 14 of 194 is small enough that the
 *  wrap costs the row it happens in and nothing else — `items-start` keeps it from
 *  stretching the tile beside it). The merchant band was the one band that could be made
 *  to stop wrapping entirely, and that is what keeps the phone grid near-uniform: its
 *  common label needed 101px against a 90px box, so 46 of 194 rows wrapped to a second
 *  line and the grid had TEN distinct tile heights. Hiding the town below `sm` (see
 *  `MerchantBand`) takes that to zero wraps, and with the tighter `gap-3` and `STACK`
 *  gaps the grid ends at SIX heights with 172 of 194 rows on the same 214/215px. The
 *  rest are the genuinely long strings (`稀有鍊金術再燃燒催化劑` plus a 13-character cost)
 *  and no readable font size fits those: measured, they would need 9-10px.
 *
 *  What it buys is height, and the ratio is lopsided: the same 194 rows go from a 9976px
 *  page to 4667px at 360px, versus 5264px with the town shown and the wider gaps.
 *
 *  The town is still shown from `sm`, in the section header when grouped by NPC, and in
 *  the material popover regardless.
 *
 *  Four columns from 1280px is the widest the tile has been cut, and it costs page
 *  height for width: at 1440px a tile is 169px against 232px at three columns, and the
 *  longest item name (高級鍊金術再燃燒催化劑, 13 characters) then wraps to a second
 *  line. `xl` rather than `lg` is what keeps that off the 1024-1280 band, where the
 *  third column is still 232px and the name still fits on one.
 *
 *  The gap is 20px where the tile's own rhythm is 8px: the 2.5:1 ratio is deliberate,
 *  so the tiles read as cards rather than a wall. It is 12px below `sm` instead, where
 *  the width is the scarce resource: 20px of a 328px row is 6% of the space, and at
 *  12px a two-column tile is 158px against 154px — every band gains 4px, which is 4% of
 *  a name's box. The 20px ratio resumes from `sm`, where the trade is no longer forced.
 *
 *  `items-start` so a tile is its OWN content height instead of being stretched to its
 *  row's tallest. Grid items stretch by default, and four trade lines wrap to a second
 *  line at 4 columns (`凱琳特製全麥麵包 ×10`, `格莉娜的蘋果奶茶 ×2`, `特蕾西的原木音樂盒 ×1`,
 *  檸檬橄欖油義大利麵), making those tiles 265px against 248px. Stretching meant one wrapped
 *  trade line padded the three one-line tiles beside it, so the padding belonged to a
 *  neighbour rather than to the tile and only appeared in rows that happened to contain a
 *  wrap — measured: row `top=569` was 265/265/265/265 with cost-band heights 37/20/20/20.
 *  With `items-start` each tile keeps its own height, so a one-line tile is never taller
 *  than its content and a wrapped row is simply a taller row. */
export const GRID =
  "grid gap-3 sm:gap-5 items-start grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

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
  const times = dealTimes(item.npc, name, qty, item.limitText ?? undefined);
  // A barter row whose give IS an icon currency (喵幣 / 愛心幣) is really a purchase
  // priced in that coin, not a material trade: 貓商人's 鱸魚, 毒囊 and both 魔力石
  // rows hand over 喵幣 above and yield the item below. Those render through `Cost`,
  // so the price reads as art with no `×` — the same shape gold has had all along —
  // rather than as the word `喵幣 ×20,000`. Everything else, including a material
  // that merely HAS art (生皮, 布料+), keeps the text form.
  //
  // The test reads `costCurrency`, NOT `parseItemQty(give).name`, and the difference
  // is not cosmetic: `give` for these rows is `喵幣 ×20,000`, and `parseItemQty`'s
  // `(\d+)` cannot match a comma-grouped amount, so it falls through to
  // `{ name: "喵幣 ×20,000", qty: 1 }` and the comparison silently fails. That is a
  // latent hole in `parseItemQty` for any comma number; it goes unreported because
  // every other caller parses a yield (`×10`), never a price. Reading the row's own
  // currency field avoids needing the parse at all.
  const pricedInIcon =
    item.costCurrency === "喵幣" || item.costCurrency === "愛心幣";
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
