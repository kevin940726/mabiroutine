import barterJson from "@/data/barter.json";
import shopsJson from "@/data/shops.json";
import { parseItemQty } from "@/lib/materials";

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
 * Pin id for a deal that has no barter.json row, so there is no recipe to put
 * on a daily. Content-derived, and deliberately without the amount: a price
 * change in a game patch must not orphan a pin.
 *
 * The currency segment is what makes it unique. `npc::name` alone is not — 9 of
 * the 192 rows collide on it, four of them across kinds (愛麗沙 sells 麵粉 for
 * both 雞蛋 and 薰衣草花, and four NPCs sell the same name for gold and for
 * materials), and `npc::kind::name` still leaves 5. With the currency all 192
 * are distinct, and currency is the stable half: no barter row spends "gold"
 * and no gold row spends a material, so it is a function of the kind, while
 * the amount is exactly the part a patch rewrites.
 */
export function shopPinId(npc: string, name: string, currency: string): string {
  return `shop::${npc}::${name}::${currency}`;
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
 * The shop-namespace pin ids: the 102 rows with no barter.json entry, which is
 * what a caller validating a pin id needs. Curated rows are excluded because
 * they pin under their barter.json id, which the barter set already covers.
 * Memoized because the store builds this on every load and on every version
 * upgrade.
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
 * Punctuation folding for matching only, never for display.
 *
 * The two sources disagree on bracket width for the same item: shops.json writes
 * 設計圖(3級) with U+0028/U+0029 while barter.json writes 設計圖（3級） with
 * U+FF08/U+FF09. Eight curated blueprint trades therefore failed to match their
 * shop row for that reason alone, so they rendered as second-class shop rows
 * with no material breakdown, no gatherSkill and no 首次必換 badge even though
 * barter.json carried the complete row for each. Folding both sides to one
 * width lets the existing curation do its job with no data change.
 *
 * `×` is deliberately absent: it is the quantity separator parseItemQty consumes,
 * so folding it inside a name would risk merging genuinely different items. Any
 * new disagreement between the sources gets a line here, and the reason.
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
        scopeAccount: item.scope === "account",
        inShopCatalog: true,
        barterId: exact?.row.id ?? null,
        pinId: exact?.row.id ?? shopPinId(npc, item.name, costCurrency),
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

export function costText(deal: ShopDeal): string {
  if (deal.costCurrency === "gold") {
    return deal.costAmount == null ? "價格未填" : `${deal.costAmount.toLocaleString()} 金幣`;
  }
  return `${deal.costCurrency}${deal.costAmount == null ? "" : ` ×${deal.costAmount.toLocaleString()}`}`;
}

export function getText(deal: ShopDeal): string {
  return `${deal.name}${deal.outQty > 1 ? ` ×${deal.outQty}` : ""}`;
}
