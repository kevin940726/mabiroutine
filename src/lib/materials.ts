import barterJson from "@/data/barter.json";
import recipesJson from "@/data/recipes.json";
import shopsJson from "@/data/shops.json";

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
  /** whole-deal exchange count from shops.json limit.times (barter/shop
   *  legs only) — the explorer scales the 共需 line by this. */
  times?: number;
  /** gold per single item (shop only) — checkout total = price × qty */
  price?: number;
  /** cap scope from shops.json (default character) — planning metadata only;
   *  the tracker authority stays barter.json perChar */
  scope?: Scope;
  components?: { name: string; qty: number }[];
};

export type RecipeEntry = {
  verified: "tw" | "tw-ingame" | "missing";
  note?: string;
  routes: RecipeRoute[];
};

/** Merged route table: recipes.json owns make/gather/quest/drop routes;
 *  shops.json (the shopping DB) owns every shop + barter leg, synthesized
 *  below into route shape. Single read path for the whole engine —
 *  recipes.json carries no shop/barter routes at all. Synthesized-only
 *  items (barter-only products like 未加工黃金原石） enter as verified tw.
 *  Within-kind leg order follows shops.json (town-grouped file order);
 *  selection is rank-driven so only tie display order can shift. */
type ShopOption = {
  name: string;
  kind?: string;
  cost: { amount: number | null; currency?: string };
  get?: { amount: number };
  limit?: { times?: number; period?: "daily" | "weekly" };
  scope?: Scope;
};

const RECIPES = ((): Record<string, RecipeEntry> => {
  const base = recipesJson as unknown as Record<string, RecipeEntry>;
  const merged: Record<string, RecipeEntry> = {};
  for (const [item, e] of Object.entries(base)) {
    merged[item] = {
      ...e,
      routes: (e.routes ?? []).filter((r) => r.kind !== "shop" && r.kind !== "barter"),
    };
  }
  const shops = shopsJson as unknown as Record<string, { town: string; items: ShopOption[] }>;
  for (const [npc, s] of Object.entries(shops)) {
    if (npc === "$schema" || typeof s !== "object" || !s) continue;
    for (const it of s.items ?? []) {
      const kind = it.kind ?? "shop";
      if (kind !== "shop" && kind !== "barter") continue;
      const scope = it.scope ?? "character";
      const route: RecipeRoute = { kind, npc, town: s.town, outQty: 1, scope };
      if (it.limit) {
        const rebuilt = stringifyLimit(it.limit, scope);
        if (rebuilt !== null) route.limit = rebuilt;
        if (Number.isInteger(it.limit.times) && (it.limit.times ?? 0) >= 1) {
          route.times = it.limit.times as number;
        }
      }
      if (it.get && Number.isInteger(it.get.amount) && it.get.amount >= 1) {
        route.outQty = it.get.amount;
      }
      const currency = it.cost.currency ?? "gold";
      if (currency === "gold") {
        if (it.cost.amount !== null && it.cost.amount !== undefined) route.price = it.cost.amount;
      } else if (it.cost.amount !== null && it.cost.amount !== undefined) {
        route.components = [{ name: currency, qty: it.cost.amount }];
      }
      const entry = merged[it.name] ?? { verified: "tw" as const, routes: [] };
      entry.routes.push(route);
      merged[it.name] = entry;
    }
  }
  return merged;
})();

/** Who a cap binds. account covers the 伺服器-suffixed caps (today exactly
 *  the perChar=false rows) and any future per-account cap. */
export type Scope = "character" | "account";


function stringifyLimit(limit: { times?: number; period?: string }, scope?: Scope): string | null {
  // Omitted times = uncapped (a bare 1 must be written out).
  if (limit.times == null) return null;
  const period = limit.period ?? "daily";
  const day = period === "daily" ? "日" : period === "weekly" ? "週" : null;
  const times: number = limit.times;
  if (day === null || !Number.isInteger(times) || times < 1) {
    console.warn(`shops.json: invalid limit, leg left uncapped: ${JSON.stringify(limit)}`);
    return null;
  }
  return `每${day} ${times} 次${scope === "account" ? " (伺服器)" : ""}`;
}


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

/** Standing of a barter leg: best tracked priority + earliest file row.
 *  Null when the exchange isn't a tracked barter row. */
export function barterStanding(item: string, npc?: string): {
  rank: number; index: number; priority: BarterRow["priority"] | null;
} | null {
  if (!npc) return null;
  let best: { rank: number; index: number; priority: BarterRow["priority"] | null } | null = null;
  BARTER_ROWS.forEach((r, i) => {
    if (r.npc !== npc) return;
    if (parseItemQty(r.give).name !== item && parseItemQty(r.get).name !== item) return;
    const rank = PRIORITY_RANK[r.priority] ?? 0;
    if (!best || rank > best.rank || (rank === best.rank && i < best.index)) {
      best = { rank, index: i, priority: r.priority };
    }
  });
  return best;
}

/** "蘋果汁 ×1" -> { name: "蘋果汁", qty: 1 }. Every barter give is one item ×N. */
export function parseItemQty(s: string): { name: string; qty: number } {
  const m = s.match(/^(.*?)\s*[×x]\s*(\d+)\s*$/);
  return m ? { name: m[1].trim(), qty: Number(m[2]) } : { name: s.trim(), qty: 1 };
}

/** Twin trade leg in the merged route table behind a barter-explorer row:
 *  the shops.json option for (npc, received item, outQty). Exact single
 *  match only — ambiguity returns null and the caller falls back to the
 *  barter.json display string. shops.json owns the mechanics, so a matched
 *  leg with no limit means uncapped (never "fall back"). */
export function twinTradeLeg(npc: string, name: string, qty: number): RecipeRoute | null {
  const entry = RECIPES[name];
  if (!entry) return null;
  const cands = (entry.routes ?? []).filter(
    (r) => (r.kind === "barter" || r.kind === "shop") && r.npc === npc && (r.outQty ?? 1) === qty
  );
  return cands.length === 1 ? cands[0] : null;
}

/** Whole-deal exchange count for a barter-explorer row: the shops.json twin
 *  leg's limit.times when an exact twin exists (a matched leg with no limit
 *  means uncapped — the row string is never consulted), else the row's own
 *  limit string ("每日 3 次" → 3, 一次性 → 1), else 1. */
export function dealTimes(npc: string, name: string, qty: number, rowLimit?: string): number {
  const twin = twinTradeLeg(npc, name, qty);
  if (twin) return twin.times ?? 1;
  const m = rowLimit?.match(/(\d+)\s*次/);
  return m ? Number(m[1]) : 1;
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

// ---- Assumed paths (2026-09-12): starmoon-style 3-line plan ----------
// One assumed source per ingredient, no user planning: cheapest wins with a
// fixed kind rank; same-cost ties (shops, gather stations) show together.
// Rank: gather (all) > free-craft (make whose components all bottom out at
// gather) > barter must/extra/untracked (untracked counts as extra — only
// explicitly once/situational demote) > shop (all) > craft-fallback (make it
// yourself from bought mats beats one-shot sources: repeatable) >
// quest/drop/disassemble > barter once/situational. Barter ties: priority
// first, then earliest barter.json row.

export type AssumedLeaf =
  | { kind: "terminal"; routes: RecipeRoute[] }
  | { kind: "craft"; route: RecipeRoute };

function bestBarter(name: string, legs: RecipeRoute[]): RecipeRoute {
  const stood = legs.map((r) => {
    const s = barterStanding(name, r.npc);
    return { r, rank: s?.rank ?? PRIORITY_RANK.extra, index: s?.index ?? Number.MAX_SAFE_INTEGER };
  });
  stood.sort((a, b) => b.rank - a.rank || a.index - b.index);
  return stood[0].r;
}

/** True when the item can be reached through make chains from gather-only
 *  leaves — i.e. crafting it is free and uncapped (麵粉 ← 小麥 ← 收割). */
function bottomsAtGather(name: string, seen: Set<string>): boolean {
  if (seen.has(name)) return false;
  const entry = RECIPES[name];
  if (!entry || entry.verified === "missing" || entry.routes.length === 0) return false;
  if (entry.routes.some((r) => r.kind === "gather")) return true;
  const make = entry.routes.find((r) => r.kind === "make" && (r.components?.length ?? 0) > 0);
  if (!make) return false;
  const next = new Set(seen);
  next.add(name);
  return (make.components ?? []).every((c) => bottomsAtGather(c.name, next));
}

/** The make route the assumed path uses: the first that bottoms at gather
 *  (free craft), else the first make with components. Shared by the L1
 *  recipe and `assumeLeaf` so the rendered recipe and the assumed path can
 *  never pick different makes when an item has more than one. */
function assumedMake(name: string): RecipeRoute | undefined {
  const entry = RECIPES[name];
  if (!entry) return undefined;
  const makes = entry.routes.filter((r) => r.kind === "make" && (r.components?.length ?? 0) > 0);
  return (
    makes.find((m) => (m.components ?? []).every((c) => bottomsAtGather(c.name, new Set([name])))) ??
    makes[0]
  );
}

export function assumeLeaf(name: string, seen: Set<string> = new Set()): AssumedLeaf | null {
  const entry = RECIPES[name];
  if (!entry || entry.verified === "missing" || entry.routes.length === 0 || seen.has(name)) {
    return null;
  }
  const routes = entry.routes;
  const gather = routes.filter((r) => r.kind === "gather");
  if (gather.length > 0) return { kind: "terminal", routes: gather };
  const makes = routes.filter((r) => r.kind === "make" && (r.components?.length ?? 0) > 0);
  if (makes.some((m) => (m.components ?? []).every((c) => bottomsAtGather(c.name, new Set([name]))))) {
    return { kind: "craft", route: assumedMake(name)! };
  }
  const barters = routes.filter((r) => r.kind === "barter");
  const hi = barters.filter((r) => (barterStanding(name, r.npc)?.rank ?? PRIORITY_RANK.extra) >= PRIORITY_RANK.extra);
  if (hi.length > 0) return { kind: "terminal", routes: [bestBarter(name, hi)] };
  const shops = routes.filter((r) => r.kind === "shop");
  if (shops.length > 0) return { kind: "terminal", routes: shops };
  if (makes.length > 0) return { kind: "craft", route: assumedMake(name)! };
  const rest = routes.filter((r) => r.kind === "quest" || r.kind === "drop" || r.kind === "disassemble");
  if (rest.length > 0) return { kind: "terminal", routes: [rest[0]] };
  if (barters.length > 0) return { kind: "terminal", routes: [bestBarter(name, barters)] };
  return null;
}

export type PillFace = { npc: string; town?: string; limit?: string; price?: number };
export type PillSource = { faces: PillFace[]; skills: string[]; labels: string[] };

function emptyPill(): PillSource {
  return { faces: [], skills: [], labels: [] };
}

function dedupePill(p: PillSource): PillSource {
  return {
    faces: [...new Map(p.faces.map((f) => [`${f.npc}|${f.town ?? ""}|${f.limit ?? ""}|${f.price ?? ""}`, f])).values()],
    skills: [...new Set(p.skills)],
    labels: [...new Set(p.labels)],
  };
}

/** L2 pill: where this ingredient comes from, counts ignored. Craft chains
 *  resolve through to their terminal faces/skills (麵粉 → 收割）. */
export function pillFor(name: string, seen: Set<string> = new Set()): PillSource {
  if (seen.has(name)) return emptyPill();
  const leaf = assumeLeaf(name, seen);
  if (!leaf) return { ...emptyPill(), labels: ["找不到資料"] };
  if (leaf.kind === "craft") {
    const next = new Set(seen);
    next.add(name);
    const out = emptyPill();
    for (const c of leaf.route.components ?? []) {
      const p = pillFor(c.name, next);
      out.faces.push(...p.faces);
      out.skills.push(...p.skills);
      out.labels.push(...p.labels);
    }
    return dedupePill(out);
  }
  const [first] = leaf.routes;
  if (first.kind === "gather") {
    return { ...emptyPill(), skills: leaf.routes.map((r) => r.station ?? KIND_LABEL.gather) };
  }
  if (first.kind === "shop" || first.kind === "barter") {
    return {
      ...emptyPill(),
      faces: leaf.routes.filter((r) => r.npc).map((r) => ({ npc: r.npc!, town: r.town, limit: r.limit, price: r.price })),
    };
  }
  return { ...emptyPill(), labels: [routeLabel(first)] };
}

/** True when the assumed-path plan would render anything beyond echoing the
 *  give: a make recipe (L1 + ingredient pills), or a non-gather leaf with
 *  more than one assumed route (tie faces). Gather-only and lone non-gather
 *  legs stay shut — vacuous pills. Mirrors assumedPlan's inputs. */
export function hasBreakdown(name: string): boolean {
  const entry = RECIPES[name];
  if (!entry || entry.verified === "missing" || entry.routes.length === 0) return false;
  if (entry.routes.some((r) => r.kind === "make" && (r.components?.length ?? 0) > 0)) return true;
  const leaf = assumeLeaf(name);
  if (!leaf) return false;
  if (leaf.kind === "craft") return true;
  if (leaf.routes.some((r) => r.kind === "gather")) return false;
  return leaf.routes.length > 1;
}

export type AssumedPlan = {
  title: string;
  directs: { name: string; qty: number }[];
  showRecipe: boolean;
  /** L2: one pill per direct ingredient, counts ignored. */
  pills: { item: string; pill: PillSource }[];
  /** L3: deeply flattened whole-deal terminal totals (per-1 walk × the
   *  row's exchange limit; barter costs × ceil exchanges, no prorating —
   *  surplus stays silent; over-cap needs unflagged). */
  totals: { name: string; qty: number }[];
  /** L3 gold estimate: price × qty summed over terminal shop-gold legs. */
  gold: number;
  problems: { name: string; status: string }[];
};

/** Full 3-line plan for a give ("沙威瑪 ×1", whole deal × times). L1 stays
 *  the ×1 direct recipe; L2 pills assume one path per ingredient; L3 sums
 *  what the whole deal needs (e.g. 每日 3 次 → 3×). */
export function assumedPlan(give: string, times = 1): AssumedPlan {
  const { name, qty } = parseItemQty(give);
  const deal = Number.isInteger(times) && times > 1 ? times : 1;
  const entry = RECIPES[name];
  const problems: { name: string; status: string }[] = [];
  if (!entry || entry.verified === "missing" || entry.routes.length === 0) {
    return {
      title: "", directs: [], showRecipe: false,
      pills: [{ item: name, pill: { faces: [], skills: [], labels: ["找不到資料"] } }],
      totals: [{ name, qty: qty * deal }],
      gold: 0,
      problems: [{ name, status: !entry ? "unknown" : "missing" }],
    };
  }
  const make = assumedMake(name);
  const directs: { item: string; qty: number }[] = make
    ? (make.components ?? []).map((c) => ({
        item: c.name,
        qty: c.qty * Math.ceil(qty / (make.outQty ?? 1)),
      }))
    : [{ item: name, qty }];
  const totals = new Map<string, number>();
  const add = (n: string, q: number) => totals.set(n, (totals.get(n) ?? 0) + q);
  let gold = 0;
  const walk = (n: string, q: number, seen: Set<string>) => {
    if (seen.has(n)) {
      problems.push({ name: n, status: "cycle" });
      add(n, q);
      return;
    }
    const leaf = assumeLeaf(n, seen);
    if (!leaf) {
      problems.push({ name: n, status: "unknown" });
      add(n, q);
      return;
    }
    if (leaf.kind === "craft") {
      const batches = Math.ceil(q / (leaf.route.outQty ?? 1));
      const next = new Set(seen);
      next.add(n);
      for (const c of leaf.route.components ?? []) walk(c.name, c.qty * batches, next);
      return;
    }
    const [first] = leaf.routes;
    if ((first.kind === "barter" || first.kind === "shop") && (first.components?.length ?? 0) > 0) {
      const ex = Math.ceil(q / (first.outQty ?? 1));
      for (const c of first.components ?? []) add(c.name, c.qty * ex);
      return;
    }
    if (first.kind === "shop" && (first.price ?? 0) > 0) {
      gold += first.price! * q;
    }
    add(n, q);
  };
  const seen = new Set<string>();
  for (const d of directs) walk(d.item, d.qty * deal, seen);
  return {
    title: make ? `材料 · 以${name}一份計` : "",
    directs: directs.map((d) => ({ name: d.item, qty: d.qty })),
    showRecipe: !!make,
    pills: directs.map((d) => ({ item: d.item, pill: pillFor(d.item) })),
    totals: [...totals.entries()].map(([n, q]) => ({ name: n, qty: q })),
    gold,
    problems,
  };
}
