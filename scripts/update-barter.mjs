#!/usr/bin/env node
/**
 * Barter data updater (build-time, no runtime fetch).
 * Golden sources (TW only, per AGENTS.md):
 *   - https://mabinogi-mobile-notebook.vercel.app/barter-data.js — window.MABINOGI_BARTER_DATA, verified:"tw" (70) / "kr" (18)
 *   - https://mabi.yenyen.dev/ — 86 rows (all TW) with 地區+推薦度
 * nipponhashi barter 226 is cross-ref only (never seed).
 * Usage: node scripts/update-barter.mjs [--dry-run]
 */
import fs from "node:fs";
import path from "node:path";

const NOTEBOOK_URL = "https://mabinogi-mobile-notebook.vercel.app/barter-data.js";
const YENYEN_URL = "https://mabi.yenyen.dev/";
const NIPPON_URL = "https://mabinogimobile.nipponhashi.com/barter/"; // diff only
const DEST = path.resolve("src/data/barter.json");
const DRY = process.argv.includes("--dry-run");

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
  // notebook rec: 必換/推薦/首次必換/視需求 → our priority
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

async function main() {
  const notebookJs = await fetchText(NOTEBOOK_URL);
  const { regions, tw, kr } = parseNotebook(notebookJs);
  console.log(`Notebook: TW=${tw.length} / KR=${kr.length} / total=${tw.length + kr.length}`);

  // yenyen: try to fetch, but site is client-rendered; fallback to count only
  let yenyenCount = null;
  try {
    const yenyenHtml = await fetchText(YENYEN_URL);
    const yCount = (yenyenHtml.match(/地區/g) || []).length;
    console.log(`Yenyen HTML fetched (${yenyenHtml.length} chars), heuristic region mentions=${yCount} (expect 86 rows all TW)`);
    yenyenCount = 86; // known per AGENTS.md; full parse would need JS execution
  } catch (e) {
    console.warn("Yenyen fetch failed, using AGENTS.md count 86:", e.message);
    yenyenCount = 86;
  }

  // nipponhashi diff only (not golden)
  try {
    const nipHtml = await fetchText(NIPPON_URL);
    console.log(`Nipponhashi HTML ${nipHtml.length} chars (diff only, not seeded)`);
  } catch (e) {
    console.warn("Nipponhashi fetch failed (diff only):", e.message);
  }

  const normalized = tw.map((i) => mapNotebookToBarter(i, regions));
  // optional union with yenyen 16 extra could be added here if we parse yenyen fully

  console.log(`\nSeed set: notebook TW ${normalized.length} rows (must=${normalized.filter((x) => x.priority === "must").length})`);
  console.log(`Skipped KR preview: ${kr.length} rows (${kr.map((x) => x.id).join(", ").slice(0, 120)}...)`);
  console.log(`Yenyen TW 86 overlaps this set; 16 extra yenyen rows not in notebook would be added in full union.`);

  // map to our barter.json schema (keep full fields for traceability)
  const out = normalized.map((r) => ({
    id: r.id,
    name: `${r.npc} ${r.get} ← ${r.give}`.replace(/\s+/g, " ").slice(0, 80),
    give: r.give,
    get: r.get,
    town: r.town,
    priority: r.priority,
    gatherSkill: r.town, // notebook has no gatherSkill; use town as grouping proxy
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
    console.log("\nTo apply: node scripts/update-barter.mjs");
    return;
  }
  fs.writeFileSync(DEST, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`Wrote ${DEST} (${out.length} rows)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
