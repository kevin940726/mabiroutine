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

function limitText(limit?: { times?: number; period?: string }, scope?: string): string | null {
  if (limit?.times == null) return null;
  const day = limit.period === "weekly" ? "週" : "日";
  return `每${day} ${limit.times} 次${scope === "account" ? "（伺服器）" : ""}`;
}

function matchKey(npc: string, kind: DealKind, costCurrency: string, costAmount: number | null, name: string, outQty: number) {
  return [npc, kind, costCurrency, costAmount ?? "?", name, outQty].join("::");
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
