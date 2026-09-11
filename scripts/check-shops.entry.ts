/* eslint-disable no-console */
// shops.json integrity: strict shape (mirrors shops.schema.json at runtime),
// known currencies, null-amount-gold-only, no identical-duplicate options,
// and recipes.json carrying no shop/barter routes (they live here now).
// Run after touching shops.json, recipes.json, or barter.json: pnpm test:shops
import barterJson from "@/data/barter.json";
import recipesJson from "@/data/recipes.json";
import shopsJson from "@/data/shops.json";
import { parseItemQty, twinTradeLeg } from "@/lib/materials";

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

// 1. strict shape per option
const optKeys = new Set(["name", "kind", "cost", "get", "limit", "scope"]);
const costKeys = new Set(["amount", "currency"]);
const getKeys = new Set(["amount"]);
const limitKeys = new Set(["times", "period"]);
for (const [npc, s] of Object.entries(shops)) {
  if (npc === "$schema") continue;
  if (!isObj(s) || typeof s["town"] !== "string" || !Array.isArray(s["items"])) {
    fail(`bad shop block: ${npc}`);
    continue;
  }
  for (const it of s["items"] as unknown[]) {
    const where = `${npc} ${(isObj(it) && it["name"]) || "?"}`;
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
  }
}

// 2. currencies must be gold, a known item, a barter give/get token,
// or an allowlisted sourceless token
const SOURCLESS: Record<string, string> = {
  // event/dungeon tender with no acquisition route by design (see tracker-data)
  喵幣: "sourceless tender",
  // source TBD — fill an acquisition leg and drop this line
  特蕾西的原木音樂盒: "source unknown",
  不死粉末: "source unknown",
  解除詛咒藥水: "source unknown",
  豆乳防風草蛋糕: "source unknown",
  最高級木材: "source unknown (higher tier of 高級木材)",
};
const base = (s: string): string => s.split(" ×")[0];
const known = new Set<string>(["gold", ...Object.keys(recipes), ...Object.keys(SOURCLESS)]);
for (const r of (barterJson as { rows?: { give?: string; get?: string }[] }).rows ??
  (barterJson as unknown as { give?: string; get?: string }[])) {
  if (typeof r?.give === "string") known.add(base(r.give));
  if (typeof r?.get === "string") known.add(base(r.get));
}
for (const [, s] of Object.entries(shops)) {
  if (!isObj(s)) continue;
  for (const it of s["items"] as unknown[]) {
    if (isObj(it) && typeof it["name"] === "string") known.add(it["name"]);
  }
}
for (const [npc, s] of Object.entries(shops)) {
  if (npc === "$schema" || !isObj(s)) continue;
  for (const it of s["items"] as unknown[]) {
    if (!isObj(it) || !isObj(it["cost"])) continue;
    const currency = ((it["cost"] as Record<string, unknown>)["currency"] as string | undefined) ?? "gold";
    if (!known.has(currency)) fail(`unknown currency ${npc} ${it["name"]}: ${currency}`);
  }
}

// 3. no identical-duplicate options (same npc|item|kind + same everything)
{
  const seen = new Map<string, number>();
  for (const [npc, s] of Object.entries(shops)) {
    if (npc === "$schema" || !isObj(s)) continue;
    for (const it of s["items"] as unknown[]) {
      if (!isObj(it)) continue;
      const sig = JSON.stringify([npc, it["name"], it["kind"] ?? "shop", it["cost"], it["get"] ?? null, it["limit"] ?? null, it["scope"] ?? "character"]);
      seen.set(sig, (seen.get(sig) ?? 0) + 1);
    }
  }
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
for (const r of barterJson as unknown as { id?: string; npc?: string; get?: string; limit?: string }[]) {
  if (typeof r?.npc !== "string" || typeof r?.get !== "string") continue;
  const { name, qty } = parseItemQty(r.get);
  const twin = twinTradeLeg(r.npc, name, qty);
  if (!twin) continue;
  const want = twin.limit ?? "不限次數";
  if ((r.limit ?? "") !== want) {
    fail(`cap divergence ${r.id ?? "?"}: barter ${JSON.stringify(r.limit)} vs shops twin ${JSON.stringify(twin.limit ?? null)}`);
  }
}

console.log(bad === 0 ? "ALL SHOPS CHECKS PASSED" : `${bad} FAILURES`);
process.exit(bad === 0 ? 0 : 1);
