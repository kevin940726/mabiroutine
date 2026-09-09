import barterJson from "@/data/barter.json";
import recipesJson from "@/data/recipes.json";

export type RouteKind =
  | "make"
  | "shop"
  | "barter"
  | "gather"
  | "quest"
  | "drop"
  | "disassemble";

export type RecipeRoute = {
  kind: RouteKind;
  station?: string;
  level?: string;
  skill?: string;
  npc?: string;
  town?: string;
  limit?: string;
  outQty?: number;
  components?: { name: string; qty: number }[];
};

export type RecipeEntry = {
  verified: "tw" | "tw-ingame" | "missing";
  note?: string;
  routes: RecipeRoute[];
};

const RECIPES = recipesJson as unknown as Record<string, RecipeEntry>;

type BarterRow = {
  id: string;
  give: string;
  get: string;
  npc: string;
  town?: string;
  priority: "must" | "extra" | "once" | "situational";
};

const BARTER_ROWS = barterJson as unknown as BarterRow[];

/** must(必換) > extra(推薦) > once(一次性/首次必換) > situational(視需求/別換). */
const PRIORITY_RANK: Record<BarterRow["priority"], number> = {
  must: 3,
  extra: 2,
  once: 1,
  situational: 0,
};

/** Best priority rank among tracked rows trading this item at this NPC
 *  (either side of the trade — the item can be the give or the cost).
 *  Null when the exchange isn't a tracked barter row. */
function barterRankFor(item: string, npc?: string): number | null {
  if (!npc) return null;
  let best: number | null = null;
  for (const r of BARTER_ROWS) {
    if (r.npc !== npc) continue;
    if (parseItemQty(r.give).name !== item && parseItemQty(r.get).name !== item) continue;
    const rank = PRIORITY_RANK[r.priority] ?? 0;
    if (best === null || rank > best) best = rank;
  }
  return best;
}

/** Drop 別換-tier barter legs (source priority below 一次性) from multi-source
 *  items. Single-source items keep their only leg; untracked exchanges keep
 *  theirs. Falls back to all routes if filtering would leave none. */
function filterDeprioritizedBarter(name: string, routes: RecipeRoute[]): RecipeRoute[] {
  if (routes.length < 2) return routes;
  const kept = routes.filter((r) => {
    if (r.kind !== "barter") return true;
    const rank = barterRankFor(name, r.npc);
    return rank === null || rank >= PRIORITY_RANK.once;
  });
  return kept.length > 0 ? kept : routes;
}

/** "蘋果汁 ×1" -> { name: "蘋果汁", qty: 1 }. Every barter give is one item ×N. */
export function parseItemQty(s: string): { name: string; qty: number } {
  const m = s.match(/^(.*?)\s*[×x]\s*(\d+)\s*$/);
  return m ? { name: m[1].trim(), qty: Number(m[2]) } : { name: s.trim(), qty: 1 };
}

/** Gather-first leaf ranking (minimize store trips): gather wins, shop is the fallback. */
const LEAF_RANK: RouteKind[] = ["gather", "shop", "barter", "quest", "drop", "disassemble"];

export type SquashNode = {
  name: string;
  qty: number;
  /** chosen route (null when missing/unknown/cycle) */
  route: RecipeRoute | null;
  /** batches to craft (make nodes only) */
  batches: number;
  /** exchanges needed at this route (barter/shop with outQty) */
  exchanges: number;
  /** chosen route cost scaled by exchanges (barter/shop with cost components) */
  scaledCosts: { name: string; qty: number }[];
  /** non-chosen routes for the same item */
  siblings: RecipeRoute[];
  /** non-chosen routes available */
  alternatives: number;
  status: "ok" | "missing" | "unknown" | "cycle";
  children: SquashNode[];
};

function emptyNode(name: string, qty: number, status: SquashNode["status"]): SquashNode {
  return { name, qty, route: null, batches: 1, exchanges: 1, scaledCosts: [], siblings: [], alternatives: 0, status, children: [] };
}

/** Recursively expand an item into its base ingredients. Craftable items recurse
 *  through their make route; everything else stops as an acquisition leaf. */
export function squashTree(name: string, qty: number, seen: Set<string> = new Set()): SquashNode {
  const entry = RECIPES[name];
  if (!entry) return emptyNode(name, qty, "unknown");
  if (entry.verified === "missing" || entry.routes.length === 0) {
    return emptyNode(name, qty, "missing");
  }
  if (seen.has(name)) {
    return emptyNode(name, qty, "cycle");
  }
  const routes = filterDeprioritizedBarter(name, entry.routes);
  const make = routes.find((r) => r.kind === "make" && (r.components?.length ?? 0) > 0);
  if (!make) {
    const ranked = [...routes].sort(
      (a, b) => LEAF_RANK.indexOf(a.kind) - LEAF_RANK.indexOf(b.kind)
    );
    const [chosen, ...siblings] = ranked;
    const exchanges = Math.ceil(qty / (chosen.outQty ?? 1));
    const scaledCosts = (chosen.components ?? []).map((c) => ({ name: c.name, qty: c.qty * exchanges }));
    return { name, qty, route: chosen, batches: 1, exchanges, scaledCosts, siblings, alternatives: routes.length - 1, status: "ok", children: [] };
  }
  const batches = Math.ceil(qty / (make.outQty ?? 1));
  const next = new Set(seen);
  next.add(name);
  return {
    name,
    qty,
    route: make,
    batches,
    exchanges: 1,
    scaledCosts: [],
    siblings: routes.filter((r) => r !== make),
    alternatives: routes.length - 1,
    status: "ok",
    children: (make.components ?? []).map((c) => squashTree(c.name, c.qty * batches, next)),
  };
}

const KIND_LABEL: Record<RouteKind, string> = {
  make: "製作",
  shop: "商店",
  barter: "以物易物",
  gather: "採集",
  quest: "任務獎勵",
  drop: "打怪掉落",
  disassemble: "分解裝備",
};

/** Flattened view of a squash tree: final leaves + the make steps between. */
export type FlatBreakdown = {
  leaves: SquashNode[];
  makes: { name: string; batches: number; station?: string; level?: string }[];
};

export function flattenBreakdown(root: SquashNode): FlatBreakdown {
  const leaves: SquashNode[] = [];
  const makes: FlatBreakdown["makes"] = [];
  const walk = (n: SquashNode) => {
    if (n.children.length === 0) {
      leaves.push(n);
      return;
    }
    if (n.route?.kind === "make") {
      makes.push({ name: n.name, batches: n.batches, station: n.route.station, level: n.route.level });
    }
    n.children.forEach(walk);
  };
  walk(root);
  return { leaves, makes };
}

export type SummedLeaf = {
  name: string;
  qty: number;
  route: RecipeRoute;
  toolCosts: { name: string; qty: number }[];
  siblings: RecipeRoute[];
  /** exchanges at this route (barter/shop with outQty), 1 otherwise */
  exchanges: number;
};

/** Aggregate leaves: same-name entries summed once (藥草 in three sub-recipes → one line). */
export function sumLeaves(leaves: SquashNode[]): SummedLeaf[] {
  const map = new Map<string, SummedLeaf>();
  for (const l of leaves) {
    if (l.status !== "ok" || !l.route) continue;
    const cur = map.get(l.name);
    if (cur) {
      cur.qty += l.qty;
    } else {
      map.set(l.name, { name: l.name, qty: l.qty, route: l.route, toolCosts: l.route.components ?? [], siblings: l.siblings, exchanges: 1 });
    }
  }
  // Route choice is deterministic per item, so merged leaves share one route:
  // exchanges derive from the summed total. No day estimates here — other
  // sources are assumed unless an item is flagged single-source.
  for (const s of map.values()) {
    if ((s.route.kind === "barter" || s.route.kind === "shop") && (s.route.components?.length ?? 0) > 0) {
      s.exchanges = Math.ceil(s.qty / (s.route.outQty ?? 1));
    }
  }
  return [...map.values()];
}

/** Plan-needed first (shop/barter/craft-waits), gather-trivial last. */
const PLAN_RANK: RouteKind[] = ["shop", "barter", "quest", "drop", "disassemble", "gather"];

export function sortByPlanNeed(leaves: SummedLeaf[]): SummedLeaf[] {
  return [...leaves].sort((a, b) => PLAN_RANK.indexOf(a.route.kind) - PLAN_RANK.indexOf(b.route.kind));
}

/** One-line acquisition descriptor for a chosen route. */
export function routeLabel(r: RecipeRoute): string {
  const bits: string[] = [];
  if (r.kind === "make") {
    if (r.station) bits.push(`${r.station}${r.level ? ` Lv.${r.level}` : ""}`);
    if (r.skill) bits.push(r.skill);
    if ((r.outQty ?? 1) > 1) bits.push(`1批出${r.outQty}`);
  } else {
    bits.push(KIND_LABEL[r.kind]);
    if (r.station) bits.push(r.station);
    if (r.npc) bits.push(`${r.npc}${r.town ? ` · ${r.town}` : ""}`);
    if (r.limit) bits.push(r.limit);
  }
  return bits.join(" · ");
}
