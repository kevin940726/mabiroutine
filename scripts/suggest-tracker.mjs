#!/usr/bin/env node
/**
 * Tracker suggestion fetcher (reference only — NEVER writes src/data/tracker.json).
 * You own tracker.json by hand; this script only reports how the hand-maintained
 * rows compare against the TW tracker page.
 *   - Fetches https://mabinogimobile.nipponhashi.com/tracker/ (default tw view)
 *   - Verifies tw-view markers; warns (does not fail) if the site changed
 *   - Matches each builtin task name against page text -> matched / missing
 *   - Lists heading/list-item candidate texts not matching any builtin row
 * Usage: node scripts/suggest-tracker.mjs
 * Output: suggestions/tracker.json (gitignored) + human-readable summary.
 */
import fs from "node:fs";
import path from "node:path";

const TW_URL = "https://mabinogimobile.nipponhashi.com/tracker/";
const TRACKER_JSON = path.resolve("src/data/tracker.json");
const SUGGEST_DEST = path.resolve("suggestions/tracker.json");

async function fetchText(url) {
  console.log(`Fetching ${url} ...`);
  const res = await fetch(url, { headers: { "User-Agent": "mabiroutine-suggester/1.0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

function loadTracker() {
  return JSON.parse(fs.readFileSync(TRACKER_JSON, "utf8"));
}

function stripToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

function extractCandidates(html) {
  const out = [];
  const re = /<(h1|h2|h3|h4|li|button)[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(html))) {
    const text = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (text.length >= 2 && text.length <= 30 && /[\u4e00-\u9fff]/.test(text)) out.push(text);
  }
  return [...new Set(out)];
}

const NOISE = ["登入", "選單", "首頁", "更多", "分享", "複製", "確認", "取消", "關閉", "搜尋", "語言", "伺服器", "台服", "韓服", "追蹤器", "以物易物"];

async function main() {
  const builtin = loadTracker();
  console.log(`tracker.json: ${builtin.length} rows (hand-maintained, will not be modified)`);

  let html;
  try {
    html = await fetchText(TW_URL);
  } catch (e) {
    console.error(`Fetch failed (${e.message}). No suggestions written; edit tracker.json by hand.`);
    process.exit(1);
  }

  // verify TW view markers (warn only — layout drift is informational here)
  const twMarkers = ['data-server-set="tw"', "預設只顯示台服"];
  const twViewVerified = twMarkers.some((s) => html.includes(s));
  if (!twViewVerified) console.warn("WARNING: TW-view markers not found — site layout may have changed; treat candidates with care.");

  const pageText = stripToText(html);
  const matched = [];
  const missing = [];
  for (const b of builtin) {
    (pageText.includes(b.name) ? matched : missing).push(b);
  }
  const krMentions = (pageText.match(/韓服|KR預覽|台服未實裝/g) || []).length;

  const candidates = extractCandidates(html).filter(
    (t) =>
      !builtin.some((b) => t.includes(b.name) || b.name.includes(t)) &&
      !NOISE.some((n) => t === n) &&
      t.length <= 24
  );

  const suggestions = {
    generatedAt: new Date().toISOString(),
    source: TW_URL,
    twViewVerified,
    counts: { builtin: builtin.length, matched: matched.length, missing: missing.length, candidates: candidates.length, krMentions },
    missingFromSource: missing,
    candidateNewRows: candidates.slice(0, 40),
    note: "Reference only. Apply by hand to src/data/tracker.json after checking AGENTS.md hardcodes (barrier 7, black-hole 7+7).",
  };
  fs.mkdirSync(path.dirname(SUGGEST_DEST), { recursive: true });
  fs.writeFileSync(SUGGEST_DEST, JSON.stringify(suggestions, null, 2) + "\n", "utf8");

  console.log(`\n[suggest] builtin=${builtin.length} matched=${matched.length} missing=${missing.length} candidates=${candidates.length} krMentions=${krMentions}`);
  for (const b of missing) console.log(`  ? not on page: ${b.id} | ${b.name}`);
  for (const c of candidates.slice(0, 15)) console.log(`  + candidate: ${c}`);
  console.log(`\nFull diff: ${SUGGEST_DEST} — apply by hand to src/data/tracker.json.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
