// PROTOTYPE — throwaway shop-browser exploration ("what should this look like?").
// Three variants (grid+sheet / all-mode accordion / master-detail split) of a
// shops.json browser, switchable via ?shopproto=a|b|c on the barter tab.
// NOT production code: no tests, memory-only pins, minimal a11y. Do not fold
// into main without a rewrite; capture the winner per skills/prototype/UI.md.
import shopsJson from "@/data/shops.json";
import { compareTowns } from "@/lib/towns";
import { barterStanding } from "@/lib/materials";

export type DealKind = "shop" | "barter";

/** Curated standing of a deal (mirrors barter.json priority). Null = untracked. */
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
  costCurrency: string; // "gold" = direct gold purchase
  outQty: number;
  limitText: string | null;
  scopeAccount: boolean;
  /** already covered by a curated barter.json row (de-dup signal) */
  inCurated: boolean;
  /** curated priority behind the deal; null when untracked */
  priority: CuratedPriority | null;
  /** PRIORITY_RANK (must 3 … situational 0); -1 when untracked */
  rank: number;
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

function limitText(limit?: { times?: number; period?: string }, scope?: string): string | null {
  if (limit?.times == null) return null;
  const day = limit.period === "weekly" ? "週" : "日";
  return `每${day} ${limit.times} 次${scope === "account" ? " (伺服器)" : ""}`;
}

/** Raw shops.json → NPC list in file order (town → npc → items per repo rule). */
export function loadShopNpcs(): ShopNpc[] {
  const raw = shopsJson as unknown as Record<string, { town: string; items: RawOption[] }>;
  const npcs: ShopNpc[] = [];
  for (const [npc, shop] of Object.entries(raw)) {
    if (npc === "$schema" || !shop || !Array.isArray(shop.items)) continue;
    const deals: ShopDeal[] = shop.items.map((it, i) => {
      const kind: DealKind = it.kind === "barter" ? "barter" : "shop";
      const outQty = it.get?.amount ?? 1;
      const standing = barterStanding(it.name, npc);
      return {
        key: `${npc}::${kind}::${it.name}::${i}`,
        npc,
        town: shop.town,
        name: it.name,
        kind,
        costAmount: it.cost?.amount ?? null,
        costCurrency: it.cost?.currency ?? "gold",
        outQty,
        limitText: limitText(it.limit, it.scope),
        scopeAccount: it.scope === "account",
        inCurated: standing !== null,
        priority: (standing?.priority as CuratedPriority | undefined) ?? null,
        rank: standing?.rank ?? -1,
      };
    });
    // Curated-first: tracked deals float above untracked (must > 推薦 >
    // 一次性 > 視需求）; stable sort keeps file order within a rank.
    deals.sort((a, b) => b.rank - a.rank);
    npcs.push({ name: npc, town: shop.town, deals });
  }
  return npcs;
}

/** Towns present, in canonical TOWN_ORDER. */
export function shopTowns(npcs: ShopNpc[]): string[] {
  return [...new Set(npcs.map((n) => n.town))].sort(compareTowns);
}

export function costText(d: ShopDeal): string {
  if (d.costCurrency === "gold") {
    return d.costAmount == null ? "💰價格未填" : `💰${d.costAmount.toLocaleString()}`;
  }
  return `${d.costCurrency}${d.costAmount == null ? "" : ` ×${d.costAmount.toLocaleString()}`}`;
}

export function getText(d: ShopDeal): string {
  return `${d.name}${d.outQty > 1 ? ` ×${d.outQty}` : ""}`;
}
