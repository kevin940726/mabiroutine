/* eslint-disable no-console */
// shops.json integrity: strict shape (mirrors shops.schema.json at runtime),
// town-grouped arrays in display order, uniqueness gates (towns, npcs per
// town, minted pin ids), known currencies, null-amount-gold-only, no
// identical-duplicate options, and recipes.json carrying no shop/barter
// routes (they live here now).
// Run after touching shops.json, recipes.json, or barter.json: pnpm test:shops
import barterJson from "@/data/barter.json";
import recipesJson from "@/data/recipes.json";
import shopsJson from "@/data/shops.json";
import { existsSync } from "node:fs";
import path from "node:path";
import { parseItemQty, twinTradeLeg } from "@/lib/materials";
import { TOWN_ORDER } from "@/lib/towns";
import { loadShopNpcs, merchantKey, shopDeals, shopPinId } from "@/lib/shops";

type Route = { kind: string };
const recipes = recipesJson as Record<string, { routes?: Route[] }>;
const shops = shopsJson as Record<string, unknown>;

let bad = 0;
const fail = (msg: string) => {
  bad += 1;
  console.log(`FAIL: ${msg}`);
};

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const keys = (v: unknown): string[] => (isObj(v) ? Object.keys(v) : []);

// 0. top-level shape: $schema plus the towns array. Towns and NPCs are arrays
// (never keyed objects): key order is a formatter away from a silent
// reshuffle, and objects cannot hold two same-name NPCs in different towns.
if (!Array.isArray(shops["towns"])) fail("top level must carry a towns array");
for (const k of keys(shops)) {
  if (k !== "$schema" && k !== "towns") fail(`unknown top-level key: ${k}`);
}
const townList = (Array.isArray(shops["towns"]) ? shops["towns"] : []) as unknown[];
const townKeys = new Set(["name", "npcs"]);
const npcKeys = new Set(["name", "icon", "items"]);
for (const t of townList) {
  if (!isObj(t) || typeof t["name"] !== "string" || !Array.isArray(t["npcs"])) {
    fail(`bad town block: ${JSON.stringify(t)?.slice(0, 80)}`);
    continue;
  }
  for (const k of keys(t)) {
    if (!townKeys.has(k)) fail(`unknown town key ${t["name"]}: ${k}`);
  }
  for (const n of t["npcs"] as unknown[]) {
    if (!isObj(n) || typeof n["name"] !== "string" || !Array.isArray(n["items"])) {
      fail(`bad npc block in ${t["name"]}`);
      continue;
    }
    for (const k of keys(n)) {
      if (!npcKeys.has(k)) fail(`unknown npc key ${t["name"]} ${n["name"]}: ${k}`);
    }
    if (n["icon"] !== undefined && typeof n["icon"] !== "string") {
      fail(`bad icon ${t["name"]} ${n["name"]}: portraits override with a public/npc path or omit`);
    }
  }
}

// 0b. file town order must respect TOWN_ORDER. Display follows the constant,
// not file position — but a file that disagrees with it is either a mistake
// or a silent no-op edit, so the gate keeps the two in sync. Unknown towns
// (not in the constant) are unconstrained and sort after known ones.
{
  const rank = new Map<string, number>((TOWN_ORDER as readonly string[]).map((t, i) => [t, i]));
  const fileTowns = townList
    .filter(isObj)
    .map((t) => t["name"])
    .filter((n): n is string => typeof n === "string");
  const known = fileTowns.filter((t) => rank.has(t));
  const ordered = [...known].sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
  if (known.some((t, i) => t !== ordered[i])) {
    fail(`town order drifts from TOWN_ORDER: file has ${known.join(" → ")} (reorder the file or update the constant)`);
  }
}
// 0c. uniqueness gates.
// Towns are the top-level identity: two blocks for one town would split its
// merchants across sections with no error at runtime.
{
  const seen = new Set<string>();
  for (const t of townList) {
    if (!isObj(t) || typeof t["name"] !== "string") continue;
    if (seen.has(t["name"])) fail(`duplicate town block: ${t["name"]} (merge the npcs into one)`);
    seen.add(t["name"]);
  }
}
// Same-name NPCs in DIFFERENT towns are supported (separate entries under
// their own town). Twice in ONE town is unrepresentable by design — JSON
// would keep only the last — so fail loudly instead of silently dropping a
// merchant. Two boards in one town needs the array escape hatch: say so here.
for (const t of townList) {
  if (!isObj(t) || !Array.isArray(t["npcs"])) continue;
  const seen = new Set<string>();
  for (const n of t["npcs"] as unknown[]) {
    if (!isObj(n) || typeof n["name"] !== "string") continue;
    if (seen.has(n["name"] as string)) {
      fail(
        `duplicate npc ${(n["name"] as string)} in ${t["name"]}: one town cannot hold two same-name merchants ` +
          `(split them across towns if they are distinct; a genuine same-town pair needs the schema's array escape hatch)`
      );
    }
    seen.add(n["name"] as string);
  }
}
// Shop-option priority must reach the deal: a curated barter row wins when both
// exist, otherwise the option's own tier flows through (today exactly the four
// 推薦 quest-board scrolls). If this count moves, the new mark is either
// intended (update the count) or a stray tier leaking a chip onto a tile.
{
  const marked = shopDeals(loadShopNpcs()).filter((d) => !d.barterId && d.priority !== null);
  const extras = marked.filter((d) => d.priority === "extra");
  if (extras.length !== 4) {
    fail(`expected 4 shop-option extra marks, got ${extras.length}: ${extras.map((d) => d.pinId).join(" | ")}`);
  }
}
// Minted pin ids must be unique: a `shop::<npc>::<name>` id is persisted in
// users' pins and sync buckets, so two deals sharing one means one pin
// completing two rows. (Items differ per town today, so this passes on
// npc::name alone.) If it ever fails, keep the bare id on the first
// (npc, name) in file order and give the newcomer an explicit town-qualified
// id — never rewrite the faces users already saved.
{
  const seen = new Map<string, string>();
  for (const deal of shopDeals(loadShopNpcs())) {
    if (deal.barterId) continue;
    const id = shopPinId(deal.npc, deal.name);
    const where = `${deal.town} ${deal.npc} ${deal.name}`;
    const prev = seen.get(id);
    if (prev !== undefined) {
      fail(`pin id collision ${id}: ${prev} vs ${where} (qualify the newcomer with its town)`);
    } else {
      seen.set(id, where);
    }
  }
}

// 1. strict shape per option
const optKeys = new Set(["name", "kind", "cost", "get", "limit", "scope", "priority", "icon"]);
const optPriorities = new Set(["must", "extra", "once", "situational"]);
const costKeys = new Set(["amount", "currency"]);
const getKeys = new Set(["amount"]);
const limitKeys = new Set(["times", "period"]);
const eachNpc = (fn: (town: string, npc: string, items: unknown[]) => void) => {
  for (const t of townList) {
    if (!isObj(t) || typeof t["name"] !== "string" || !Array.isArray(t["npcs"])) continue;
    for (const n of t["npcs"] as unknown[]) {
      if (!isObj(n) || typeof n["name"] !== "string" || !Array.isArray(n["items"])) continue;
      fn(t["name"] as string, n["name"] as string, n["items"] as unknown[]);
    }
  }
};
eachNpc((town, npc, items) => {
  for (const it of items) {
    const where = `${town} ${npc} ${(isObj(it) && it["name"]) || "?"}`;
    if (!isObj(it)) {
      fail(`non-object option: ${where}`);
      continue;
    }
    for (const k of keys(it)) {
      if (!optKeys.has(k)) fail(`unknown option key ${where}: ${k}`);
    }
    if (typeof it["name"] !== "string") fail(`bad name: ${where}`);
    if (it["kind"] !== undefined && it["kind"] !== "shop" && it["kind"] !== "barter") {
      fail(`bad kind ${where}: ${it["kind"]}`);
    }
    const cost = it["cost"];
    if (!isObj(cost)) fail(`missing cost: ${where}`);
    else {
      for (const k of keys(cost)) {
        if (!costKeys.has(k)) fail(`unknown cost key ${where}: ${k}`);
      }
      const amount = cost["amount"];
      if (amount !== null && (typeof amount !== "number" || amount < 0)) {
        fail(`bad cost.amount ${where}: ${amount}`);
      }
      if (cost["currency"] !== undefined && typeof cost["currency"] !== "string") {
        fail(`bad currency ${where}`);
      }
      const currency = (cost["currency"] as string | undefined) ?? "gold";
      if (amount === null && currency !== "gold") fail(`null token amount ${where}`);
      // Counter purchases are gold-only; token exchanges are kind: barter.
      if ((it["kind"] ?? "shop") !== "barter" && currency !== "gold") {
        fail(`token cost on shop leg ${where} (use kind: barter): ${currency}`);
      }
      // Barter legs exchange item tokens — a gold cost belongs on a shop leg.
      if ((it["kind"] ?? "shop") === "barter" && currency === "gold") {
        fail(`gold cost on barter leg ${where} (barter legs cost item tokens)`);
      }
    }
    const get = it["get"];
    if (get !== undefined) {
      if (!isObj(get)) fail(`bad get ${where}`);
      else {
        for (const k of keys(get)) {
          if (!getKeys.has(k)) fail(`unknown get key ${where}: ${k}`);
        }
        if (!Number.isInteger(get["amount"]) || (get["amount"] as number) < 1) {
          fail(`bad get.amount ${where}: ${get["amount"]}`);
        }
      }
    }
    const limit = it["limit"];
    if (limit !== undefined) {
      if (!isObj(limit)) fail(`bad limit ${where}`);
      else {
        for (const k of keys(limit)) {
          if (!limitKeys.has(k)) fail(`unknown limit key ${where}: ${k}`);
        }
        // Omitted times = uncapped ({} is legal explicit-uncapped);
        // a lone period with no times is contradictory.
        if (limit["times"] === undefined || limit["times"] === null) {
          if (limit["period"] !== undefined) {
            fail(`period without times ${where} (drop period, or write times explicitly)`);
          }
        } else if (!Number.isInteger(limit["times"]) || (limit["times"] as number) < 1) {
          fail(`bad limit.times ${where}: ${limit["times"]}`);
        }
        const period = (limit["period"] as string | undefined) ?? "daily";
        if (period !== "daily" && period !== "weekly") fail(`bad limit.period ${where}: ${limit["period"]}`);
      }
    }
    if (it["scope"] !== undefined && it["scope"] !== "character" && it["scope"] !== "account") {
      fail(`bad scope ${where}: ${it["scope"]}`);
    }
    if (it["priority"] !== undefined && !optPriorities.has(it["priority"] as string)) {
      fail(`bad priority ${where}: ${it["priority"]}`);
    }
    // Art override: a data-spelled item name, never empty, whose file must be
    // on disk (an explicit pointer at nothing is author error, not art lag).
    // Every scroll row carries one — shared paper art is a data fact, not a
    // lookup rule, so a 卷軸 name without an icon fails instead of rendering
    // the placeholder.
    if (typeof it["name"] === "string" && (it["name"] as string).includes("卷軸") && it["icon"] === undefined) {
      fail(`scroll without icon ${where} (point it at the shared paper file)`);
    }
    if (it["icon"] !== undefined) {
      if (typeof it["icon"] !== "string" || (it["icon"] as string).trim() === "") {
        fail(`bad icon ${where}: ${it["icon"]}`);
      } else if (!existsSync(path.join("public", "items", `${it["icon"]}.webp`))) {
        fail(`icon target missing ${where}: public/items/${it["icon"]}.webp`);
      }
    }
  }
});

// 2. currencies must be gold, a known item, or a barter give/get token.
// Quest-sourced tokens (喵幣, 不死粉末, 解除詛咒藥水) resolve through their
// recipes.json quest stubs like everything else — there is no separate
// allowlist: if a stub is ever deleted, this gate fails loudly instead of
// staying green behind an exception.
const base = (s: string): string => s.split(" ×")[0];
const known = new Set<string>(["gold", ...Object.keys(recipes)]);
for (const r of (barterJson as { rows?: { give?: string; get?: string }[] }).rows ??
  (barterJson as unknown as { give?: string; get?: string }[])) {
  if (typeof r?.give === "string") known.add(base(r.give));
  if (typeof r?.get === "string") known.add(base(r.get));
}
eachNpc((_town, _npc, items) => {
  for (const it of items) {
    if (isObj(it) && typeof it["name"] === "string") known.add(it["name"]);
  }
});
eachNpc((town, npc, items) => {
  for (const it of items) {
    if (!isObj(it) || !isObj(it["cost"])) continue;
    const currency = ((it["cost"] as Record<string, unknown>)["currency"] as string | undefined) ?? "gold";
    if (!known.has(currency)) fail(`unknown currency ${town} ${npc} ${it["name"]}: ${currency}`);
  }
});

// 3. no identical-duplicate options (same town|npc|item|kind + same everything)
{
  const seen = new Map<string, number>();
  eachNpc((town, npc, items) => {
    for (const it of items) {
      if (!isObj(it)) continue;
      const sig = JSON.stringify([town, npc, it["name"], it["kind"] ?? "shop", it["cost"], it["get"] ?? null, it["limit"] ?? null, it["scope"] ?? "character"]);
      seen.set(sig, (seen.get(sig) ?? 0) + 1);
    }
  });
  for (const [sig, n] of seen) {
    if (n > 1) fail(`duplicate option ×${n}: ${sig.slice(0, 120)}`);
  }
}

// 4. recipes.json carries no shop/barter routes (sole home is shops.json)
for (const [item, e] of Object.entries(recipes)) {
  for (const r of (e as { routes?: Route[] }).routes ?? []) {
    if (r.kind === "shop" || r.kind === "barter") fail(`trade route in recipes: ${item} ${r.kind}`);
  }
}

// 5. twin cap parity: where a barter row has an exact shops twin, the
// barter display string must equal the twin's rebuilt limit (shops owns
// mechanics). A twin with no limit pairs with 不限次數 only.
for (const r of barterJson as unknown as { id?: string; npc?: string; town?: string; get?: string; limit?: string }[]) {
  if (typeof r?.npc !== "string" || typeof r?.get !== "string") continue;
  const { name, qty } = parseItemQty(r.get);
  const twin = twinTradeLeg(r.npc, name, qty, r.town);
  if (!twin) continue;
  const want = twin.limit ?? "不限次數";
  if ((r.limit ?? "") !== want) {
    fail(`cap divergence ${r.id ?? "?"}: barter ${JSON.stringify(r.limit)} vs shops twin ${JSON.stringify(twin.limit ?? null)}`);
  }
}

// 6. every barter row in shops.json must be curated in barter.json. An
// uncurated one renders as a degraded row: no priority badge, no material
// breakdown, and it pins under a shop:: id instead of a recipe. This check
// exists because twin cap parity (check 5) pairs rows by name and is therefore
// blind to a name mismatch, which is exactly how 精靈的痕跡 / 精靈痕跡 slipped
// through with the suite green.
//
// It deliberately reuses the app's matcher rather than reimplementing the
// match: a second implementation would drift from src/lib/shops.ts, and drift
// between the check and the code is the failure being fixed here. The matcher's
// own behaviour is covered by the migration fixtures instead.
const ALLOWED_UNCURATED_BARTER: string[] = [
  // Intentionally uncurated shop barter rows, as "<npc>::<town>::<name>". Empty today.
  // Listing a row here accepts the degraded rendering on purpose; anything not
  // listed must have a barter.json entry, so an accidental name or quantity
  // typo fails the gate instead of quietly losing the badge and the breakdown.
];

function dealKey(npc: string, town: string, name: string): string {
  return merchantKey(npc, town) + "::" + name;
}

// A near miss is a name that shares its first two characters with the shop row,
// or contains it. Length alone is far too loose for CJK: two unrelated four-char
// item names differ by zero, so a length rule lists the whole merchant's stock
// and buries the one entry that was meant.
const nearMiss = (a: string, b: string): boolean =>
  a.slice(0, 2) === b.slice(0, 2) || a.includes(b) || b.includes(a);

for (const deal of shopDeals(loadShopNpcs())) {
  if (deal.kind !== "barter" || deal.barterId) continue;
  const key = dealKey(deal.npc, deal.town, deal.name);
  if (ALLOWED_UNCURATED_BARTER.includes(key)) continue;
  // Point at the entry that was probably meant, so the fix is a rename rather
  // than a search. Same merchant only: a name that matches elsewhere is a
  // different trade and would be a red herring.
  const sameMerchant = (barterJson as unknown as { npc?: string; town?: string; get?: string; id?: string }[])
    .filter((r) => r?.npc === deal.npc && r?.town === deal.town && typeof r.get === "string")
    .map((r) => ({ r, name: parseItemQty(r.get as string).name }))
    .filter((c) => nearMiss(c.name, deal.name));
  const hint = sameMerchant.length
    ? ` — closest curated entr${sameMerchant.length > 1 ? "ies" : "y"}: ${sameMerchant.map((c) => `${JSON.stringify(c.name)} (${c.r.id})`).join(", ")}`
    : "";
  fail(
    `uncurated barter row ${key}: give ${deal.costCurrency} x${deal.costAmount} yields ${deal.outQty}` +
      ` has no barter.json entry, so it renders without a priority badge or material breakdown${hint}`
  );
}

console.log(bad === 0 ? "ALL SHOPS CHECKS PASSED" : `${bad} FAILURES`);
process.exit(bad === 0 ? 0 : 1);
