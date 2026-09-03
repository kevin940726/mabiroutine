#!/usr/bin/env node
/**
 * Barter data updater (build-time, no runtime fetch).
 * Golden sources (TW only, per AGENTS.md):
 *   - https://mabinogi-mobile-notebook.vercel.app/barter-data.js — window.MABINOGI_BARTER_DATA, verified:"tw" (70) / "kr" (18)
 *   - https://mabi.yenyen.dev/ — 86 rows (all TW) with 地區+推薦度
 * nipponhashi barter 226 is cross-ref only (never seed).
 * Usage: node scripts/update-barter.mjs [--dry-run] [--merge-yenyen] [--write]
 *   --merge-yenyen: union notebook 70 + yenyen 16 extra = 86 (default now when yenyen fetch succeeds)
 *   default (no --write): SUGGEST ONLY — diff fetched rows against src/data/barter.json
 *     and write suggestions/barter.json {added, removed, changed}. Never touches barter.json.
 *   --write: overwrite src/data/barter.json with fetched rows (escape hatch; wipes manual edits).
 * Manual-first workflow: you own barter.json by hand; fetch output is reference only.
 */
import fs from "node:fs";
import path from "node:path";

const NOTEBOOK_URL = "https://mabinogi-mobile-notebook.vercel.app/barter-data.js";
const YENYEN_URL = "https://mabi.yenyen.dev/";
const NIPPON_URL = "https://mabinogimobile.nipponhashi.com/barter/"; // diff only
const DEST = path.resolve("src/data/barter.json");
const SUGGEST_DEST = path.resolve("suggestions/barter.json");
const DRY = process.argv.includes("--dry-run");
const WRITE = process.argv.includes("--write");
const NO_MERGE = process.argv.includes("--no-merge");

async function fetchText(url) {
  console.log(`Fetching ${url} ...`);
  const res = await fetch(url, { headers: { "User-Agent": "mabiroutine-updater/1.0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

function parseNotebook(js) {
  const m = js.match(/window\.MABINOGI_BARTER_DATA\s*=\s*(\{.*\});/s);
  if (!m) throw new Error("notebook: cannot find MABINOGI_BARTER_DATA");
  const data = JSON.parse(m[1]);
  const tw = data.items.filter((i) => i.verified === "tw");
  const kr = data.items.filter((i) => i.verified === "kr");
  return { regions: data.regions, tw, kr, all: data.items };
}

function mapNotebookRec(rec) {
  if (rec === "必換") return "must";
  if (rec === "推薦") return "extra";
  if (rec === "首次必換") return "once";
  if (rec === "視需求") return "situational";
  return "extra";
}

function mapNotebookToBarter(item, regions) {
  const region = regions.find((r) => r.id === item.region);
  return {
    id: item.id,
    name: `${item.reward} ← ${item.cost}`,
    give: item.cost,
    get: item.reward,
    town: region?.name ?? item.region,
    priority: mapNotebookRec(item.rec),
    gatherSkill: item.note ?? "",
    perChar: !item.limit.includes("帳號") && !item.limit.includes("伺服器"),
    limit: item.limit,
    rec: item.rec,
    region: item.region,
    verified: item.verified,
    npc: item.npc,
    note: item.note,
  };
}

// yenyen parsing
function parseYenyen(html) {
  const rows = [...html.matchAll(/<li class="lrow">([\s\S]*?)<\/li>/g)];
  const items = [];
  for (const [, row] of rows) {
    const npc = row.match(/class="lnpc">([^<]+)</)?.[1]?.trim() ?? "";
    const region = row.match(/class="lregion">([^<]+)</)?.[1]?.trim() ?? "";
    // give/get: inside lgive/lget, strip tags
    const giveBlock = row.match(/class="lgive">([\s\S]*?)<\/span>\s*<span class="lflow"/)?.[1] ?? "";
    const getBlock = row.match(/class="lget">([\s\S]*?)<\/span>\s*<div class="lnote"/)?.[1] ?? "";
    const strip = (s) => s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    const give = strip(giveBlock).replace(/\s*×\s*/g, " ×");
    const get = strip(getBlock).replace(/\s*×\s*/g, " ×");
    const prioRaw = row.match(/prio-([^"\s]+)/)?.[1]?.trim() ?? "";
    const limit = row.match(/llimit[^>]*>([^<]+)</)?.[1]?.trim() ?? "";
    const note = row.match(/lnote[^>]*>([^<]+)</)?.[1]?.trim() ?? "";
    // map prio
    let priority = "extra";
    let rec = "視需求";
    if (prioRaw === "must") { priority = "must"; rec = "必換"; }
    else if (prioRaw === "recommended") { priority = "extra"; rec = "推薦"; }
    else if (prioRaw === "once" || prioRaw.includes("once")) { priority = "once"; rec = "首次必換"; }
    else if (prioRaw === "situational" || prioRaw.includes("situational")) { priority = "situational"; rec = "視需求"; }
    else if (prioRaw === "skip") { priority = "skip"; rec = "別換"; }
    // yenyen's prio text is in the span inner, but class is reliable
    // also check inner text for 必換 etc as fallback
    const prioText = row.match(/prio-[^"]*">([^<]+)</)?.[1]?.trim();
    if (prioText === "必換") { priority = "must"; rec = "必換"; }
    else if (prioText === "推薦") { priority = "extra"; rec = "推薦"; }
    else if (prioText === "首次必換") { priority = "once"; rec = "首次必換"; }

    if (!npc || !give || !get) continue;
    items.push({ npc, region, give, get, priority, rec, limit, note, prioRaw });
  }
  return items;
}

function yenyenToBarter(y, idx) {
  // generate stable id for yenyen-only rows
  const slug = `${y.npc}-${y.give}-${y.get}`.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, "").slice(0, 20) || `yen${idx}`;
  const id = `yen-${slug}-${idx}`;
  const town = y.region || "未知";
  return {
    id,
    name: `${y.npc} ${y.get} ← ${y.give}`.slice(0, 80),
    give: y.give,
    get: y.get,
    town,
    priority: y.priority,
    gatherSkill: town,
    perChar: !y.limit.includes("帳號") && !y.limit.includes("伺服器"),
    limit: y.limit || "每日 1 次",
    rec: y.rec,
    verified: "tw",
    npc: y.npc,
    note: y.note,
    _yenyen: true,
  };
}

async function main() {
  const notebookJs = await fetchText(NOTEBOOK_URL);
  const { regions, tw, kr } = parseNotebook(notebookJs);
  console.log(`Notebook: TW=${tw.length} / KR=${kr.length} / total=${tw.length + kr.length}`);

  let yenyenItems = [];
  try {
    const yenyenHtml = await fetchText(YENYEN_URL);
    yenyenItems = parseYenyen(yenyenHtml);
    console.log(`Yenyen parsed: ${yenyenItems.length} rows (distinct NPC ${new Set(yenyenItems.map(x=>x.npc)).size})`);
    // debug prio distribution
    const prioCounts = {};
    for (const y of yenyenItems) prioCounts[y.priority] = (prioCounts[y.priority]||0)+1;
    console.log(`Yenyen prio:`, prioCounts);
  } catch (e) {
    console.warn("Yenyen parse failed, using notebook only:", e.message);
    yenyenItems = [];
  }

  try {
    const nipHtml = await fetchText(NIPPON_URL);
    console.log(`Nipponhashi HTML ${nipHtml.length} chars (diff only, not seeded)`);
  } catch (e) {
    console.warn("Nipponhashi fetch failed (diff only):", e.message);
  }

  const normalized = tw.map((i) => mapNotebookToBarter(i, regions));

  // union with yenyen extra (if not --no-merge and yenyen fetched)
  let extra = [];
  if (!NO_MERGE && yenyenItems.length) {
    const key = (x) => `${x.npc}|${x.give}|${x.get}`;
    const notebookKeys = new Set(normalized.map(n => key({ npc: n.npc, give: n.give, get: n.get })));
    // also consider normalized give/get may have different spacing; normalize
    const norm = (s) => s.replace(/\s+/g, "").replace(/×/g, "×");
    const notebookKeysNorm = new Set(normalized.map(n => `${n.npc}|${norm(n.give)}|${norm(n.get)}`));
    for (let i=0;i<yenyenItems.length;i++) {
      const y = yenyenItems[i];
      const k = `${y.npc}|${norm(y.give)}|${norm(y.get)}`;
      if (!notebookKeysNorm.has(k)) {
        extra.push(yenyenToBarter(y, i));
      }
    }
    console.log(`Yenyen extra not in notebook: ${extra.length} (e.g. ${extra.slice(0,5).map(e=>e.npc+':'+e.get).join(', ')})`);
  }

  const combined = [...normalized, ...extra];
  // sort by priority then town
  const order = { must:0, extra:1, once:2, situational:3, skip:4 };
  combined.sort((a,b) => (order[a.priority]??9)-(order[b.priority]??9) || a.town.localeCompare(b.town));

  console.log(`\nSeed set: notebook TW ${normalized.length} + yenyen extra ${extra.length} = ${combined.length} rows (must=${combined.filter(x=>x.priority==="must").length})`);
  console.log(`Skipped KR preview: ${kr.length} rows (${kr.map((x) => x.id).join(", ").slice(0, 120)}...)`);

  const out = combined.map((r) => ({
    id: r.id,
    name: `${r.npc} ${r.get} ← ${r.give}`.replace(/\s+/g, " ").slice(0, 80),
    give: r.give,
    get: r.get,
    town: r.town,
    priority: r.priority,
    gatherSkill: r.town,
    perChar: r.perChar,
    limit: r.limit,
    rec: r.rec,
    verified: r.verified,
    npc: r.npc,
    note: r.note,
  }));

  if (DRY) {
    console.log(`\n[dry-run] would write ${out.length} rows to ${DEST}`);
    console.log(JSON.stringify(out.slice(0, 2), null, 2));
    if (extra.length) {
      console.log("\n[yenyen extra sample]");
      console.log(JSON.stringify(extra.slice(0, 2), null, 2));
    }
    console.log("\nTo suggest (diff vs current file): node scripts/update-barter.mjs --suggest");
    console.log("To overwrite (wipes manual edits): node scripts/update-barter.mjs --write");
    return;
  }
  if (!WRITE) {
    // SUGGEST ONLY — diff fetched rows against the hand-maintained file.
    let current = [];
    try {
      current = JSON.parse(fs.readFileSync(DEST, "utf8"));
    } catch {
      console.warn(`Cannot read current ${DEST}; treating all fetched rows as added.`);
    }
    const FIELDS = ["give", "get", "town", "priority", "limit", "rec", "npc", "note"];
    const curById = new Map(current.map((r) => [r.id, r]));
    const outById = new Map(out.map((r) => [r.id, r]));
    const added = out.filter((r) => !curById.has(r.id));
    const removed = current.filter((r) => !outById.has(r.id)).map((r) => ({ id: r.id, name: r.name }));
    const changed = [];
    for (const r of out) {
      const c = curById.get(r.id);
      if (!c) continue;
      const diff = {};
      for (const f of FIELDS) {
        if ((c[f] ?? "") !== (r[f] ?? "")) diff[f] = { current: c[f] ?? "", fetched: r[f] ?? "" };
      }
      if (Object.keys(diff).length) changed.push({ id: r.id, name: r.name, diff });
    }
    const suggestions = {
      generatedAt: new Date().toISOString(),
      sources: { notebook: NOTEBOOK_URL, yenyen: YENYEN_URL, nipponhashiDiffOnly: NIPPON_URL },
      counts: { fetched: out.length, current: current.length, added: added.length, removed: removed.length, changed: changed.length },
      added,
      removed,
      changed,
    };
    fs.mkdirSync(path.dirname(SUGGEST_DEST), { recursive: true });
    fs.writeFileSync(SUGGEST_DEST, JSON.stringify(suggestions, null, 2) + "\n", "utf8");
    console.log(`\n[suggest] fetched=${out.length} current=${current.length} added=${added.length} removed=${removed.length} changed=${changed.length}`);
    for (const a of added.slice(0, 10)) console.log(`  + ${a.id} | ${a.npc} ${a.get} ← ${a.give} (${a.limit})`);
    for (const r of removed.slice(0, 10)) console.log(`  - ${r.id} | ${r.name}`);
    for (const c of changed.slice(0, 10)) console.log(`  ~ ${c.id} | ${Object.keys(c.diff).join(", ")}`);
    console.log(`\nFull diff: ${SUGGEST_DEST} — apply by hand to ${DEST}.`);
    console.log("To overwrite (wipes manual edits): node scripts/update-barter.mjs --write");
    return;
  }
  console.warn("WARNING: --write overwrites src/data/barter.json, wiping manual edits.");
  fs.writeFileSync(DEST, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`Wrote ${DEST} (${out.length} rows)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
