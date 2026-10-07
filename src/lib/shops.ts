import shopsJson from "@/data/shops.json";
import { CURATED_ORDER } from "@/data/curatedOrder";
import { displayName } from "@/lib/materials";
import type { BarterPriority, Task } from "@/lib/types";

export type DealKind = "shop" | "barter";
const SHOP_PRIORITY_LIST = ["must", "extra", "once", "situational"] as const;
export type CuratedPriority = (typeof SHOP_PRIORITY_LIST)[number];

const SHOP_PRIORITIES: ReadonlySet<string> = new Set(SHOP_PRIORITY_LIST);

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
  priority: CuratedPriority | null;
  /** Art override from the option (`icon`): a data-spelled item name whose file
   *  to show instead of this deal's own. Null follows the filename convention. */
  icon: string | null;
  /** Stable pin id from the option (`id`): the retired barter.json id string,
   *  verbatim. Null for gold rows, which pin under the derived shop:: id. */
  id: string | null;
  /** Legacy display strings from the option (`barter`): authored give/get/limit
   *  text, verbatim. The tracker renders these, never a recomposition — the
   *  quirks (missing ×1, 不限次數) are data facts. Null on shop legs. */
  barterText: { give: string; get: string; limit: string } | null;
  barterId: string | null;
  /** the id a pin on this row uses: the curated barter id, or a shop:: id */
  pinId: string;
  /** position in the curated order list, or -1 when the deal is not curated */
  curatedIndex: number;
}

export interface ShopNpc {
  name: string;
  town: string;
  /** Portrait override from the NPC object (`icon`); null follows the convention. */
  icon: string | null;
  deals: ShopDeal[];
}

interface RawOption {
  name: string;
  kind?: string;
  cost?: { amount?: number | null; currency?: string };
  get?: { amount?: number };
  limit?: { times?: number; period?: string };
  scope?: string;
  priority?: string;
  icon?: string;
  id?: string;
  barter?: { give?: string; get?: string; limit?: string };
}

/**
 * Pin id for a deal with no explicit option id, so there is no recipe to put on a
 * daily. Content-derived, and deliberately without the cost: a price change in a
 * game patch must not orphan a pin.
 *
 * Only gold rows reach this now. Every barter leg carries an explicit `id`,
 * and those are unique file-wide (gated) — measured, 0 collisions. That is what makes the
 * short id sufficient, and it is why this does not need a currency segment: a
 * gold row's currency is always `gold`, so the segment would separate nothing.
 *
 * If a second gold listing for the same NPC and item ever appears, give the
 * shop row an explicit `id` rather than widening this key — the id is
 * persisted in users' pins, so changing its shape orphans saved state.
 */
export function shopPinId(npc: string, name: string): string {
  return `shop::${npc}::${name}`;
}

let pinIdCache: Set<string> | null = null;
let byPinCache: Map<string, ShopDeal> | null = null;

/**
 * Every deal keyed by the id a pin on it uses, so a pin id resolves to its row
 * without re-deriving anything. Covers both namespaces: a curated deal is
 * keyed by its explicit option id, an uncurated one by its shop:: id. Memoized —
 * the store, the tracker and the panel all read it.
 */
export function shopDealsByPinId(): Map<string, ShopDeal> {
  if (!byPinCache) byPinCache = new Map(shopDeals(loadShopNpcs()).map((d) => [d.pinId, d]));
  return byPinCache;
}

/**
 * The shop-namespace pin ids: the gold rows, which are the only deals with no
 * explicit id, and is what a caller validating a pin id needs. Curated rows
 * are excluded because they pin under their explicit option id, which the
 * curated set already covers. Memoized because the store builds this on every
 * load and on every version upgrade.
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
 * 每日 — most limited rows carry none), null when unlimited. Same rule as the
 * deal lookup in cycle.ts, kept local so the dependency arrow stays
 * one-way (cycle → shops, never back).
 */
function limitPeriod(limit?: { times?: number; period?: string }): "daily" | "weekly" | null {
  if (limit?.times == null) return null;
  return limit.period === "weekly" ? "weekly" : "daily";
}

/** Curated position by stable pin id, from the curated order list. Unknown
 *  ids sink last (persisted strays sort after live rows, never among them). */
const CURATED_ORDER_POS = new Map<string, number>(
  (CURATED_ORDER as string[]).map((id, i) => [id, i])
);

/**
 * Composite merchant key for every surface that looks an NPC up by name:
 * filter values, section keys, pinned-group buckets, jump params. Bare names
 * conflate same-name NPCs across towns; the town half disambiguates while the
 * display keeps the bare name (suffixed only when ambiguous).
 */
export function merchantKey(npc: string, town: string): string {
  return `${npc}::${town}`;
}

/** Portrait for a merchant: the NPC object's `icon` override, else null for
 *  the /npc/<name>.png convention. Memoized with the deal maps. */
let npcIconCache: Map<string, string> | null = null;
export function shopNpcIcon(npc: string, town: string): string | null {
  if (!npcIconCache) {
    npcIconCache = new Map(loadShopNpcs().flatMap((n) => (n.icon ? [[merchantKey(n.name, n.town), n.icon]] : [])));
  }
  return npcIconCache.get(merchantKey(npc, town)) ?? null;
}

/** Every NPC in shops.json.
 *
 *  The file is town-grouped arrays, and the loader preserves file order end
 *  to end — NPC sequence inside a town and deal sequence inside an NPC are
 *  file-owned. Town sequence for display follows TOWN_ORDER, not the file.
 *  Memoized: the module data never changes, and the store, checks and panel
 *  all read it.
 */
let npcsCache: ShopNpc[] | null = null;
export function loadShopNpcs(): ShopNpc[] {
  if (npcsCache) return npcsCache;
  const raw = shopsJson as unknown as {
    towns?: { name?: unknown; npcs?: { name?: unknown; icon?: unknown; items?: RawOption[] }[] }[];
  };
  const npcs: ShopNpc[] = [];
  for (const townEntry of raw.towns ?? []) {
    if (typeof townEntry?.name !== "string" || !Array.isArray(townEntry.npcs)) continue;
    const town = townEntry.name;
    for (const shop of townEntry.npcs) {
      if (typeof shop?.name !== "string" || !Array.isArray(shop.items)) continue;
      const npc = shop.name;
      const deals = shop.items.map((item, index): ShopDeal => {
        const kind: DealKind = item.kind === "barter" ? "barter" : "shop";
        const costCurrency = item.cost?.currency ?? "gold";
        const costAmount = item.cost?.amount ?? null;
        const outQty = item.get?.amount ?? 1;
        return {
          key: `${town}::${npc}::${kind}::${item.name}::${index}`,
          npc,
          town,
          name: item.name,
          kind,
          costAmount,
          costCurrency,
          outQty,
          limitText: limitText(item.limit, item.scope),
          limitPeriod: limitPeriod(item.limit),
          limitTimes: item.limit?.times ?? null,
          scopeAccount: item.scope === "account",
          barterId: typeof item.id === "string" ? item.id : null,
          pinId: typeof item.id === "string" ? item.id : shopPinId(npc, item.name),
          priority: typeof item.priority === "string" && SHOP_PRIORITIES.has(item.priority) ? (item.priority as CuratedPriority) : null,
          icon: typeof item.icon === "string" ? item.icon : null,
          id: typeof item.id === "string" ? item.id : null,
          barterText:
            typeof item.barter?.give === "string" &&
            typeof item.barter?.get === "string" &&
            typeof item.barter?.limit === "string"
              ? { give: item.barter.give, get: item.barter.get, limit: item.barter.limit }
              : null,
          curatedIndex: typeof item.id === "string" ? (CURATED_ORDER_POS.get(item.id) ?? -1) : -1,
        };
      });
      npcs.push({ name: npc, town, icon: typeof shop.icon === "string" ? shop.icon : null, deals });
    }
  }
  npcsCache = npcs;
  return npcs;
}

/**
 * Barter-shaped Task from the legacy display strings carried on the deal —
 * the single constructor behind every pin → task resolver. Same name shape,
 * same limit-string parsing, same order numbers as the retired row path
 * ever produced (proven: 0/107 drift at every migration step).
 */
export function dealToBarterTask(input: {
  id: string;
  name: string;
  give: string;
  get: string;
  town: string;
  npc: string | undefined;
  priority: BarterPriority;
  scopeAccount: boolean;
  limit: string;
}): Task {
  // 每日/每週 N 次：N>1 → counter；N=1 或 不限次數 → check
  const dayCount = Number(input.limit.match(/每日\s*(\d+)\s*次/)?.[1] ?? 0);
  const weekCount = Number(input.limit.match(/每週\s*(\d+)\s*次/)?.[1] ?? 0);
  const weekly = weekCount > 0;
  const isCounter = (weekly ? weekCount : dayCount) > 1;
  const section = weekly ? "weekly" : "daily";
  return {
    id: input.id,
    name: input.name,
    icon: "🔄",
    desc: `${input.give} → ${input.get} · ${input.town} · ${input.town}`,
    section,
    kind: weekly ? "weekly" : "daily",
    type: isCounter ? "counter" : "check",
    max: isCounter ? (weekly ? weekCount : dayCount) : undefined,
    source: "barter",
    town: input.town,
    priority: input.priority,
    npc: input.npc,
    serverShared: input.scopeAccount,
    barterMeta: { give: input.give, get: input.get, limit: input.limit },
    order: weekly ? 150 : 80, // daily pins sit after builtin daily; weekly pins after builtin weekly
  };
}

/**
 * Canonical barter display name from its parts: `${npc} ${get} ← ${give}`.
 * Every retired row name matched this shape exactly (zero deviants), so the
 * composition renders what the stored strings always spelled.
 */
export function barterRowName(npc: string, get: string, give: string): string {
  return `${npc} ${get} ← ${give}`;
}

/**
 * Barter-shaped Task for a pin id, resolved through the shop deal carrying
 * the retired barter id. Null when the id is not a barter leg (gold rows
 * resolve through shopDealToTask instead) or resolves nowhere (dead pin —
 * renders nowhere, same as today). The single resolver behind every pin →
 * task call site, so the file retirement touches callers once.
 */
export function barterTaskForPin(id: string): Task | null {
  const deal = shopDealsByPinId().get(id);
  if (!deal || !deal.barterText || !deal.id) return null;
  return dealToBarterTask({
    id: deal.id,
    name: barterRowName(deal.npc, deal.barterText.get, deal.barterText.give),
    give: deal.barterText.give,
    get: deal.barterText.get,
    town: deal.town,
    npc: deal.npc,
    priority: deal.priority ?? "situational",
    scopeAccount: deal.scopeAccount,
    limit: deal.barterText.limit,
  });
}
/**
 * File-order NPC ranks: NPC sequence inside a town as the file owns it.
 * Unknown entries sort after known ones, zh-Hant between themselves. Town
 * sequence is NOT here — display follows TOWN_ORDER, which stays the single
 * town authority.
 */
let npcRankCache: Map<string, number> | null = null;
export function shopCatalogRanks(): { npcRank: Map<string, number> } {
  if (!npcRankCache) {
    npcRankCache = new Map<string, number>();
    loadShopNpcs().forEach((n, i) => {
      const key = merchantKey(n.name, n.town);
      if (!npcRankCache!.has(key)) npcRankCache!.set(key, i);
    });
  }
  return { npcRank: npcRankCache };
}

/** The rows the game actually sells, in shops.json order. */
export function shopDeals(npcs: ShopNpc[]): ShopDeal[] {
  return npcs.flatMap((npc) => npc.deals);
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
