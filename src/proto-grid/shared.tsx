// PROTOTYPE (throwaway). Props and the pieces the shop grid shares.
//
// There is one design now: variant B with the tight density. The A/verdict/title/band
// alternatives were removed after review, so nothing here branches on which one to
// use. The tile lives in Tile.tsx.
import { Pin } from "lucide-react";
import { cn } from "@/lib/utils";
import { barterProducers, dealTimes, hasBarterOnlyRoute, hasBreakdown, parseItemQty } from "@/lib/materials";
import { MaterialHoverCard } from "@/components/MaterialHoverCard";
import { NpcFace } from "@/components/MerchantPanel";

export type ProtoItem = {
  key: string;
  pinId: string;
  npc: string;
  town: string;
  title: string;
  /** Exactly as authored: a gold row carries the coin glyph here, a barter row carries
   *  "name xN". The tile shows a stripped name plus qty instead (see Price). */
  give: string;
  /** What the trade yields. Needed only by the hover card, which reads "你給 X → 你拿 Y". */
  get: string;
  cost: string;
  limitText: string | null;
  scopeAccount: boolean;
  priority: "must" | "extra" | "once" | "situational" | null;
  note: string | null;
  kind: "shop" | "barter";
  /** Position in barter.json, or -1 for a row with no curated entry (every gold
   *  row, plus barter rows the curation skipped). Used as the tiebreak inside a
   *  priority tier, so -1 sorts last rather than first. */
  curatedIndex: number;
};

export type ProtoProps = {
  items: ProtoItem[];
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

/** Only 必換 and 推薦 render a word. 視需求 is the true default (53 rows) so naming
 *  it says nothing, and 一次性 reads as a warning but behaves like 推薦 for planning.
 *  Labels stay on the tiers that never render, so the map is total.
 *
 *  The edge marks the two tiers that render a word, in one colour. It is intentionally
 *  NOT a per-tier colour: see the PRIORITY comment — the tier is the word's job. */
export const priorityEdge = (p: ProtoItem["priority"]) =>
  p === "must" || p === "extra" ? PRIORITY[p].edge : "bg-border";
export const priorityText = (p: ProtoItem["priority"]) =>
  p === "must" || p === "extra" ? PRIORITY[p].label : null;
export const priorityTint = (p: ProtoItem["priority"]) => (p ? PRIORITY[p].text : "");

/** Not a hook — it reads a Set and returns JSX. Named as a plain function on
 *  purpose: it is called inside a .map, and a `use*` name there trips
 *  rules-of-hooks for no reason. */
export function pinButton(item: ProtoItem, pinned: Set<string>, onTogglePin: (id: string) => void) {
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
export const limitOf = (i: ProtoItem) => (i.limitText ?? "不限次數").replace("（伺服器）", "");

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

export function compareRows(a: ProtoItem, b: ProtoItem) {
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
  renderTile,
}: {
  items: ProtoItem[];
  byNpc?: boolean;
  splitKind?: boolean;
  renderTile: (item: ProtoItem, showBand: boolean) => React.ReactNode;
}) {
  const sorted = [...items].sort(compareRows);

  const keyed = new Map<string, ProtoItem[]>();
  for (const i of sorted) {
    const key = byNpc ? i.npc : i.town;
    const bucket = keyed.get(key);
    if (bucket) bucket.push(i);
    else keyed.set(key, [i]);
  }

  const single = keyed.size === 1;
  const showBandInGroup = !byNpc || single;

  const kindGroup = (rows: ProtoItem[]) => {
    const gold = rows.filter((r) => r.kind === "shop");
    const barter = rows.filter((r) => r.kind === "barter");
    // a section with only one kind gets no labels: there is nothing to tell apart, and
    // a lone 金幣 heading above a whole section is a heading that says nothing
    if (!splitKind || gold.length === 0 || barter.length === 0) {
      return <div className={GRID}>{rows.map((r) => renderTile(r, showBandInGroup))}</div>;
    }
    const groups: { label: string; rows: ProtoItem[] }[] = [
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

/** 1 column on phones, 2 from the sm breakpoint (640px), 3 on desktop. One column on
 *  a phone because two leaves a 154px tile carrying a 15px CJK title: a long name
 *  like 高級鍊金術再燃燒催化劑 wrapped to three lines, the trade line wrapped with it,
 *  and the merchant name truncated (迪莉絲 · 堤爾…). The wider tiles are what let the
 *  text stop wrapping, the same reason desktop went to three columns.
 *
 *  The gap is 20px where the tile's own rhythm is 8px: the 2.5:1 ratio is deliberate,
 *  so the tiles read as cards rather than a wall. Wider tiles cost ~25% more page
 *  height on desktop (68 grid rows vs 53), which is the trade for it. */
export const GRID = "grid gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3";

/**
 * Hover/tap popover for one barter row, carrying the same MaterialBreakdown the
 * shipped rows expand inline.
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
 * `times` comes from the row's own limit, resolved the way the shipped row does
 * (dealTimes: a twin leg's times, else the limit string, else 1). The breakdown
 * multiplies its 共需 total by it, so passing 1 unconditionally would under-report
 * every multi-per-day trade.
 *
 * Renders the plain line with no hover when the give has no recipe, which is the
 * common case: hasBreakdown excludes trivial self-only leaves and gather-only paths.
 */
export function TradeLine({ item, onViewInShop }: { item: ProtoItem; onViewInShop?: (npc: string, giveName: string) => void }) {
  const { name, qty } = parseItemQty(item.give);
  const times = dealTimes(item.npc, name, qty, item.limitText ?? undefined);
  if (!hasBreakdown(name)) {
    return (
      <span className="text-[14px] font-semibold text-foreground">
        {name}
        {qty > 1 && <span className="ml-1 text-[11px] whitespace-nowrap tabular-nums text-muted-foreground">×{qty}</span>}
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
