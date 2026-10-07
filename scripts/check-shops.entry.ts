/* eslint-disable no-console */
// shops.json integrity: strict shape (mirrors shops.schema.json at runtime),
// town-grouped arrays in display order, uniqueness gates (towns, npcs per
// town, minted pin ids, curated order), known currencies, null-amount-gold-only, no
// identical-duplicate options, and recipes.json carrying no shop/barter
// routes (they live here now).
// Run after touching shops.json, recipes.json, or curatedOrder.ts: pnpm test:shops
import { CURATED_ORDER } from "@/data/curatedOrder";
import recipesJson from "@/data/recipes.json";
import shopsJson from "@/data/shops.json";
import { existsSync } from "node:fs";
import path from "node:path";
import { parseItemQty, stringifyLimit, twinTradeLeg } from "@/lib/materials";
import { TOWN_ORDER } from "@/lib/towns";
import { barterRowName, dealToBarterTask, loadShopNpcs, shopDeals, shopPinId } from "@/lib/shops";

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
// Curated order list: the display order for curated rows. Every curated
// (id-bearing) option appears exactly once — adding a row forces an explicit
// placement in the same diff instead of a silent end-of-list drift. Unknown
// ids keep the MAX_SAFE_INTEGER sink (persisted strays), never a catalog row.
{
  const live = shopDeals(loadShopNpcs()).filter((d) => d.id).map((d) => d.id as string);
  const listed = CURATED_ORDER as string[];
  if (listed.length !== new Set(listed).size) fail("curatedOrder: duplicate ids");
  const missing = live.filter((id) => !listed.includes(id));
  const extra = listed.filter((id) => !live.includes(id));
  if (missing.length || extra.length) {
    fail(`curatedOrder: missing ${JSON.stringify(missing)} extra ${JSON.stringify(extra)}`);
  }
}
// Twin probes: every shops.json leg must be reachable in the materials route
// table through twinTradeLeg. The town-group conversion once left materials.ts
// reading the old npc-keyed shape, which synthesized zero legs — the grid
// (shops.ts) looked fine while 30 popovers went 找不到資料, and every gate
// stayed green. These probes cover a gold leg, a barter leg, a multi-yield
// leg, and a quest-board leg; ambiguity (same npc+name+outQty twice) returns
// null by design, so keep the probes unique.
{
  const probes: Array<[string, string, string, number]> = [
    ["安黛莉", "堤爾克那", "聖水", 1],
    ["安黛莉", "堤爾克那", "聖水", 10],
    ["佛格斯", "堤爾克那", "鐵礦石", 1],
    ["任務佈告欄", "堤爾克那", "料理卷軸：煎蛋", 1],
  ];
  for (const [npc, town, name, qty] of probes) {
    if (!twinTradeLeg(npc, name, qty, town)) {
      fail(`twin probe blind: ${town} ${npc} ${name} ×${qty} has no leg in the materials table`);
    }
  }
}
// Task builder smoke: every id-bearing deal builds a barter-shaped Task
// carrying its own fields (the deep row-vs-deal parity this replaced held
// through the whole migration: 0/107 drift at every step).
{
  const built = shopDeals(loadShopNpcs()).filter((d) => d.id);
  if (built.length === 0) fail("tasks: no id-bearing deals to build from");
  for (const d of built) {
    if (!d.barterText) { fail(`tasks: option ${d.id} lacks barter display strings`); continue; }
    const t = dealToBarterTask({
      id: d.id!,
      name: barterRowName(d.npc, d.barterText.get, d.barterText.give),
      give: d.barterText.give,
      get: d.barterText.get,
      town: d.town,
      npc: d.npc,
      priority: d.priority ?? "situational",
      scopeAccount: d.scopeAccount,
      limit: d.barterText.limit,
    });
    if (t.id !== d.id || t.source !== "barter" || t.town !== d.town || t.npc !== d.npc) {
      fail(`tasks: builder dropped fields for ${d.id}`);
    }
  }
}
// Id uniqueness: two options sharing one id would silently collapse two pins.
{
  const seen = new Set<string>();
  for (const d of shopDeals(loadShopNpcs())) {
    if (!d.id) continue;
    if (seen.has(d.id)) fail(`duplicate option id ${d.id}`);
    seen.add(d.id);
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
const optKeys = new Set(["name", "kind", "cost", "get", "limit", "scope", "priority", "icon", "id", "barter"]);
const optPriorities = new Set(["must", "extra", "once", "situational"]);
const barterTextKeys = new Set(["give", "get", "limit"]);
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
    // Stable pin id: non-empty, unique file-wide (checked below against the
    // retired barter ids), never reshaped once pinned. An id without a
    // priority would silently render situational, so the pair is required
    // together — no quiet defaults on the pin path.
    if (it["id"] !== undefined && (typeof it["id"] !== "string" || (it["id"] as string).trim() === "")) {
      fail(`bad id ${where}: ${it["id"]}`);
    }
    if (it["id"] !== undefined && !optPriorities.has(it["priority"] as string)) {
      fail(`id without priority ${where} (a pin must carry its tier)`);
    }
    // Legacy display strings: all three verbatim when present (the tracker
    // renders them, never a recomposition). Barter legs carry all three;
    // shop legs carry none.
    if (it["barter"] !== undefined) {
      if (!isObj(it["barter"])) fail(`bad barter ${where}`);
      else {
        for (const k of keys(it["barter"])) {
          if (!barterTextKeys.has(k)) fail(`unknown barter key ${where}: ${k}`);
        }
        for (const k of ["give", "get", "limit"]) {
          if (typeof (it["barter"] as Record<string, unknown>)[k] !== "string") {
            fail(`bad barter.${k} ${where}`);
          }
        }
      }
    }
    if ((it["kind"] ?? "shop") !== "barter" && it["barter"] !== undefined) {
      fail(`barter display on shop leg ${where} (display strings ride barter legs only)`);
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
eachNpc((_town, _npc, items) => {
  for (const it of items) {
    if (!isObj(it)) continue;
    if (typeof it["name"] === "string") known.add(it["name"]);
    const b = it["barter"];
    if (isObj(b)) {
      if (typeof b["give"] === "string") known.add(base(b["give"]));
      if (typeof b["get"] === "string") known.add(base(b["get"]));
    }
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
      const sig = JSON.stringify([town, npc, it["name"], it["kind"] ?? "shop", it["cost"], it["get"] ?? null, it["limit"] ?? null, it["scope"] ?? "character", it["priority"] ?? null, it["icon"] ?? null, it["id"] ?? null]);
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

// 5. twin cap parity: every id-bearing leg must resolve in the materials
// table, and its carried display limit must equal the rebuilt structured
// limit (shops owns mechanics). A leg with no structured limit pairs with
// 不限次數 only. Reachability + value in one check: a leg that drops out of
// the table (or whose strings drift from its mechanics) fails here, which is
// what caught the silent route-table collapse before. Legs the twin matcher
// finds ambiguous by design (same npc+name+outQty twice, e.g. two currencies
// for one item) skip the table half and check the rebuild direct from the
// option — same mechanics, no ambiguity involved.
for (const deal of shopDeals(loadShopNpcs())) {
  if (!deal.id || !deal.barterText) continue;
  const twin = twinTradeLeg(deal.npc, deal.name, deal.outQty, deal.town);
  const want = twin ? (twin.limit ?? "不限次數") : "twin-ambiguous";
  if (twin && deal.barterText.limit !== want) {
    fail(`cap divergence ${deal.id}: display ${JSON.stringify(deal.barterText.limit)} vs structured ${JSON.stringify(twin.limit ?? null)}`);
    continue;
  }
  if (!twin) {
    const opt = { times: deal.limitTimes ?? undefined, period: deal.limitPeriod ?? undefined };
    const rebuilt = (deal.limitTimes ?? 0) >= 1 ? stringifyLimit(opt, deal.scopeAccount ? "account" : "character") : null;
    if (deal.barterText.limit !== (rebuilt ?? "不限次數")) {
      fail(`cap divergence ${deal.id}: display ${JSON.stringify(deal.barterText.limit)} vs structured ${JSON.stringify(rebuilt)}`);
    }
  }
}

// 6. curated completeness: every barter leg carries its curation inline —
// a stable id, a priority tier, and the legacy display strings — so no row
// renders degraded (no badge, no breakdown, shop:: pin). This replaces the
// old cross-file curation check: there is no second file to drift from, but
// the display strings and the structured mechanics are still two copies of
// one fact, so they are asserted equal here (names and per-exchange
// quantities). A split would render one item on the tracker and resolve
// another in the shop, with every other gate green.
for (const deal of shopDeals(loadShopNpcs())) {
  if (deal.kind !== "barter") continue;
  const key = `${deal.town} ${deal.npc} ${deal.name}`;
  if (!deal.id) fail(`uncurated barter row ${key}: no stable id, pins fall back to derived keys`);
  if (!deal.priority) fail(`uncurated barter row ${key}: no priority tier, renders without a badge`);
  if (!deal.barterText) fail(`uncurated barter row ${key}: no display strings, renders without a breakdown`);
  if (deal.id && deal.curatedIndex < 0) fail(`uncurated barter row ${key}: id ${deal.id} missing from the curated order list`);
  if (!deal.barterText) continue;
  const give = parseItemQty(deal.barterText.give);
  const get = parseItemQty(deal.barterText.get);
  if (give.name !== deal.costCurrency) {
    fail(`display/mechanics drift ${key}: give ${JSON.stringify(give.name)} vs cost.currency ${JSON.stringify(deal.costCurrency)}`);
  }
  if (deal.costAmount !== null && give.qty !== deal.costAmount) {
    fail(`display/mechanics drift ${key}: give qty ${give.qty} vs cost.amount ${deal.costAmount}`);
  }
  if (get.name !== deal.name) {
    fail(`display/mechanics drift ${key}: get ${JSON.stringify(get.name)} vs option name ${JSON.stringify(deal.name)}`);
  }
  if (get.qty !== deal.outQty) {
    fail(`display/mechanics drift ${key}: get qty ${get.qty} vs get.amount ${deal.outQty}`);
  }
}

console.log(bad === 0 ? "ALL SHOPS CHECKS PASSED" : `${bad} FAILURES`);
process.exit(bad === 0 ? 0 : 1);
