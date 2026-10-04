import barterJson from "@/data/barter.json";
import shopsJson from "@/data/shops.json";
import { displayName, parseItemQty } from "@/lib/materials";

export type DealKind = "shop" | "barter";
export type CuratedPriority = "must" | "extra" | "once" | "situational";

export const CURATED_LABEL: Record<CuratedPriority, string> = {
  must: "必換",
  extra: "推薦",
  once: "一次性",
  situational: "視需求",
};

export interface ShopDeal {
  key: string;
  npc: string;
  town: string;
  name: string;
  kind: DealKind;
  costAmount: number | null;
  costCurrency: string;
  outQty: number;
  limitText: string | null;
  /**
   * Structured reset cycle behind limitText: "weekly" when the row's limit
   * says so, "daily" for any other limited row, null when unlimited. Cycle
   * readers (pinCycleOf, taskKind, section placement) must use this, never
   * parse limitText — display copy is free to reword, this is not.
   */
  limitPeriod: "daily" | "weekly" | null;
  /** Structured purchase cap behind limitText (null when unlimited). */
  limitTimes: number | null;
  /** account-wide rather than per character, i.e. the in-game 伺服器 badge */
  scopeAccount: boolean;
  note: string | null;
  priority: CuratedPriority | null;
  barterId: string | null;
  /** the id a pin on this row uses: the curated barter id, or a shop:: id */
  pinId: string;
  /** position in barter.json, or -1 when the deal is not curated */
  curatedIndex: number;
  /** false for a curated row with no matching entry in shops.json */
  inShopCatalog: boolean;
}

export interface ShopNpc {
  name: string;
  town: string;
  deals: ShopDeal[];
}

interface RawOption {
  name: string;
  kind?: string;
  cost?: { amount?: number | null; currency?: string };
  get?: { amount?: number };
  limit?: { times?: number; period?: string };
  scope?: string;
}

type CuratedRow = {
  id: string;
  give: string;
  get: string;
  npc: string;
  town: string;
  priority: CuratedPriority;
  perChar: boolean;
  limit?: string;
  note?: string;
};

/**
 * Pin id for a deal with no barter.json row, so there is no recipe to put on a
 * daily. Content-derived, and deliberately without the cost: a price change in a
 * game patch must not orphan a pin.
 *
 * Only gold rows reach this now. Every barter row in shops.json matches a
 * curated entry, so the `shop::` namespace is exactly the 94 gold rows, and those
 * are unique on `npc::name` — measured, 0 collisions. That is what makes the
 * short id sufficient, and it is why this does not need a currency segment: a
 * gold row's currency is always `gold`, so the segment would separate nothing.
 *
 * Two shapes would break it, and neither exists today: a second gold listing for
 * the same NPC and item, or a barter row that stops matching its curated entry
 * (see the punctuation folding in matchKey, which is what previously caused the
 * second). If either appears, give the shop row an explicit `id` rather than
 * widening this key — the id is persisted in users' pins, so changing its shape
 * orphans saved state.
 */
export function shopPinId(npc: string, name: string): string {
  return `shop::${npc}::${name}`;
}

let pinIdCache: Set<string> | null = null;
let byPinCache: Map<string, ShopDeal> | null = null;

/**
 * Every deal keyed by the id a pin on it uses, so a pin id resolves to its row
 * without re-deriving the match. Covers both namespaces: a curated deal is
 * keyed by its barter.json id, an uncurated one by its shop:: id. Memoized —
 * the store, the tracker and the panel all read it.
 */
export function shopDealsByPinId(): Map<string, ShopDeal> {
  if (!byPinCache) byPinCache = new Map(shopDeals(loadShopNpcs()).map((d) => [d.pinId, d]));
  return byPinCache;
}

/**
 * The shop-namespace pin ids: the gold rows, which are the only deals with no
 * barter.json entry, and is what a caller validating a pin id needs. Curated rows
 * are excluded because they pin under their barter.json id, which the barter set
 * already covers. Memoized because the store builds this on every load and on
 * every version upgrade.
 */
export function shopPinIds(): Set<string> {
  if (!pinIdCache) {
    pinIdCache = new Set(shopDeals(loadShopNpcs()).filter((d) => !d.barterId).map((d) => d.pinId));
  }
  return pinIdCache;
}

function limitText(limit?: { times?: number; period?: string }, scope?: string): string | null {
  if (limit?.times == null) return null;
  const day = limit.period === "weekly" ? "週" : "日";
  return `每${day} ${limit.times} 次${scope === "account" ? "（伺服器）" : ""}`;
}

/**
 * Structured twin of limitText's cycle: "weekly" only on an explicit weekly
 * period, "daily" for every other limited row (an absent period renders as
 * 每日 — most limited rows carry none), null when unlimited. Same rule as
 * isWeeklyLimit in cycle.ts, kept local so the dependency arrow stays
 * one-way (cycle → shops, never back).
 */
function limitPeriod(limit?: { times?: number; period?: string }): "daily" | "weekly" | null {
  if (limit?.times == null) return null;
  return limit.period === "weekly" ? "weekly" : "daily";
}

/** Cycle of a barter.json limit string (curated-only rows carry no RawOption). */
function barterLimitPeriod(limit?: string | null): "daily" | "weekly" | null {
  if (limit == null) return null;
  return /每週\s*\d+\s*次/.test(limit) ? "weekly" : "daily";
}

/**
 * Punctuation folding for matching only, never for display.
 *
 * Both sources now spell `設計圖(3級)` with half-width U+0028/U+0029, so this no longer
 * has anything to do for those names — but it exists because they once disagreed (the
 * note here read that barter.json wrote U+FF08/U+FF09), and eight curated blueprint
 * trades matched their shop row only after folding, so keeping it costs nothing and
 * guards the next disagreement. `×` is deliberately absent: it is the quantity separator
 * `parseItemQty` consumes, so folding it inside a name would risk merging genuinely
 * different items. Any new disagreement between the sources gets a line here, and the
 * reason.
 */
const MATCH_FOLD: Record<string, string> = {
  "（": "(", // （
  "）": ")", // ）
  "＋": "+", // ＋
  "；": ";", // ；
  "：": ":", // ：
  "，": ",", // ，
};

function fold(text: string): string {
  return text.replace(/[（）；：，]/g, (c) => MATCH_FOLD[c]);
}

function matchKey(npc: string, kind: DealKind, costCurrency: string, costAmount: number | null, name: string, outQty: number) {
  return [npc, kind, fold(costCurrency), costAmount ?? "?", fold(name), outQty].join("::");
}

const curatedRows = barterJson as unknown as CuratedRow[];
const curatedByDeal = new Map<string, { row: CuratedRow; index: number }>();
curatedRows.forEach((row, index) => {
  const give = parseItemQty(row.give);
  const get = parseItemQty(row.get);
  const key = matchKey(row.npc, "barter", give.name, give.qty, get.name, get.qty);
  if (!curatedByDeal.has(key)) curatedByDeal.set(key, { row, index });
});

/** Every NPC in shops.json, plus any featured barter row with no shop entry. */
export function loadShopNpcs(): ShopNpc[] {
  const raw = shopsJson as unknown as Record<string, { town: string; items: RawOption[] }>;
  const npcs: ShopNpc[] = [];
  const seenCurated = new Set<string>();
  for (const [npc, shop] of Object.entries(raw)) {
    if (npc === "$schema" || !shop || !Array.isArray(shop.items)) continue;
    const deals = shop.items.map((item, index): ShopDeal => {
      const kind: DealKind = item.kind === "barter" ? "barter" : "shop";
      const costCurrency = item.cost?.currency ?? "gold";
      const costAmount = item.cost?.amount ?? null;
      const outQty = item.get?.amount ?? 1;
      const exact = curatedByDeal.get(matchKey(npc, kind, costCurrency, costAmount, item.name, outQty));
      if (exact) seenCurated.add(exact.row.id);
      return {
        key: `${npc}::${kind}::${item.name}::${index}`,
        npc,
        town: shop.town,
        name: item.name,
        kind,
        costAmount,
        costCurrency,
        outQty,
        limitText: limitText(item.limit, item.scope),
        limitPeriod: limitPeriod(item.limit),
        limitTimes: item.limit?.times ?? null,
        scopeAccount: item.scope === "account",
        inShopCatalog: true,
        barterId: exact?.row.id ?? null,
        pinId: exact?.row.id ?? shopPinId(npc, item.name),
        priority: exact?.row.priority ?? null,
        note: exact?.row.note ?? null,
        curatedIndex: exact?.index ?? -1,
      };
    });
    npcs.push({ name: npc, town: shop.town, deals });
  }
  curatedRows.forEach((row, index) => {
    if (seenCurated.has(row.id) || (row.priority !== "must" && row.priority !== "extra")) return;
    const give = parseItemQty(row.give);
    const get = parseItemQty(row.get);
    const deal: ShopDeal = {
      key: `curated-only::${row.id}`,
      npc: row.npc,
      town: row.town,
      name: get.name,
      kind: "barter",
      costAmount: give.qty,
      costCurrency: give.name,
      outQty: get.qty,
      limitText: row.limit ?? null,
      limitPeriod: barterLimitPeriod(row.limit),
      // barter.json carries no structured times — the count parses from the
      // same limit string limitText echoes verbatim.
      limitTimes: Number(row.limit?.match(/(\d+)\s*次/)?.[1] ?? 0) || null,
      scopeAccount: !row.perChar,
      inShopCatalog: false,
      barterId: row.id,
      pinId: row.id,
      priority: row.priority,
      note: row.note ?? null,
      curatedIndex: index,
    };
    const npc = npcs.find((entry) => entry.name === row.npc);
    if (npc) npc.deals.unshift(deal);
    else npcs.push({ name: row.npc, town: row.town, deals: [deal] });
  });
  return npcs;
}

/** The 192 rows the game actually sells, in shops.json order. */
export function shopDeals(npcs: ShopNpc[]): ShopDeal[] {
  return npcs.flatMap((npc) => npc.deals).filter((deal) => deal.inShopCatalog);
}

/** Display strings, passed through `displayName` so every surface shapes the parens the
 *  same way; see that function in materials.ts for what it does now and why the
 *  direction changed. It runs here and not upstream because the DATA keeps the game's
 *  own spelling and lookups resolve against it.
 *
 *  Gold carries the coin glyph rather than the word 金幣, because that is how the
 *  rest of the app shows a price: the shop tile, the shop row and a pinned gold
 *  purchase on the dailies all read 🪙1,500. Writing 金幣 here instead left the
 *  tracker row as the one place that spelled it out. */
export function costText(deal: ShopDeal): string {
  if (deal.costCurrency === "gold") {
    return `🪙${deal.costAmount == null ? "價格未填" : deal.costAmount.toLocaleString()}`;
  }
  return displayName(`${deal.costCurrency}${deal.costAmount == null ? "" : ` ×${deal.costAmount.toLocaleString()}`}`);
}

export function getText(deal: ShopDeal): string {
  return displayName(`${deal.name}${deal.outQty > 1 ? ` ×${deal.outQty}` : ""}`);
}
