#!/usr/bin/env node
/**
 * Doc-facts gate. Prose that quotes the tracker's numbers must agree with
 * `src/data/tracker.json`, because every other gate reads the JSON and none of
 * them reads the sentences around it.
 *
 * Why this exists: the 2026-10-19 black-hole rework (`black-hole` max 14 -> 7,
 * one row added) left four stale facts in the tree — `skills/update-tracker/SKILL.md`
 * still told the next writer to keep "`black-hole` max 14 (7+7)" and quoted "25
 * tracker rows", and `docs/development.md` quoted "25 rows". `pnpm check` stayed
 * green: the data gates check the data, the review reads a diff, and nothing
 * reads the prose that quotes the data. A stale hardcode in a skill is the
 * expensive kind — the next writer follows it.
 *
 * Scope: `AGENTS.md`, the READMEs, `docs` (top level) and every `skills` doc. Excluded by
 * design: `CHANGELOG.md` and `docs/plans/**`, which record a point in time and
 * may say what was true then.
 *
 * Blind spots: only the phrasings below are recognized (a doc that quotes the
 * total some other way is not checked), and the inventory table's own `max` /
 * `type` cells are prose, not checked — `test:tracker` owns the row shape.
 * Prose that DESCRIBES this gate is skipped: it quotes the old values as
 * history ("max 14 (7+7)", "25 rows"), and reading those as pins would make the
 * rule police its own documentation.
 * No bundling: text and JSON, no `src/` imports.
 */
import fs from "node:fs";
import path from "node:path";

let bad = 0;
const ok = (msg) => console.log(`ok: ${msg}`);
const fail = (msg) => {
  bad += 1;
  console.log(`FAIL: ${msg}`);
};

const rows = Object.values(JSON.parse(fs.readFileSync("src/data/tracker.json", "utf8")));
const ids = new Set(rows.map((r) => r.id));
const maxOf = new Map(rows.map((r) => [r.id, r.max]));
const inSection = (section) => rows.filter((r) => r.section === section).length;

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.md$/.test(e.name) ? [p] : [];
  });
const PROSE = [
  "AGENTS.md",
  "README.md",
  "README-zh_TW.md",
  ...walk("docs").filter((f) => !/[\\/]plans[\\/]/.test(f)),
  ...walk("skills"),
];
const linesOf = (file) => fs.readFileSync(file, "utf8").split("\n");
// A line that describes this gate is documentation about the rule, not a fact
// about the data: it quotes the values the rule was written to catch.
const DESCRIBES_GATE = /\btest:docs\b|check-doc-facts/;
const factLines = (file) =>
  linesOf(file)
    .map((line, i) => ({ line, i: i + 1 }))
    .filter(({ line }) => !DESCRIBES_GATE.test(line));

// --- R1: a quoted row total is the row total ---------------------------------
// Two shapes, both anchored: "(N rows)" on a line that names tracker.json, and
// "N TW rows" / "N tracker rows". A bare "N rows" is NOT matched — "3 of the
// weekly rows are weekly-goals' subTasks" is a real, correct count of a subset.
const TOTAL_IN_FILE = /\((\d+) rows?\)/;
const TOTAL_LABELLED = /(\d+)\s+(?:TW|tracker)\s+rows?\b/;
let totals = 0;
for (const file of PROSE) {
  for (const { line, i } of factLines(file)) {
    const m = (line.includes("tracker.json") ? TOTAL_IN_FILE.exec(line) : null) ?? TOTAL_LABELLED.exec(line);
    if (!m) continue;
    totals += 1;
    if (Number(m[1]) !== rows.length) {
      fail(`${file}:${i} says "${m[0]}"; tracker.json holds ${rows.length} rows`);
    }
  }
}
if (!totals) fail("no quoted row total found anywhere — restore the pin or delete this rule deliberately");
else ok(`${totals} quoted row total(s) match the ${rows.length} rows in tracker.json`);

// --- R2: a quoted section breakdown is the breakdown -------------------------
const BREAKDOWN = /\((\d+) daily \+ (\d+) weekly \+ (\d+) account\b/;
let breakdowns = 0;
for (const file of PROSE) {
  for (const { line, i } of factLines(file)) {
    const m = BREAKDOWN.exec(line);
    if (!m) continue;
    breakdowns += 1;
    const want = [inSection("daily"), inSection("weekly"), inSection("account")];
    const got = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (got.join() !== want.join()) {
      fail(
        `${file}:${i} says "${m[0]}"; tracker.json is (${want[0]} daily + ${want[1]} weekly + ${want[2]} account)`
      );
    }
  }
}
if (breakdowns) ok(`${breakdowns} quoted section breakdown(s) match the data`);
else fail("no quoted section breakdown found anywhere — restore the pin or delete this rule deliberately");

// --- R3: a "Keep hardcodes:" line pins real maxes ----------------------------
// The one line a writer reads before editing the data. Backticks are stripped so
// both shapes count: "`barrier max 7`" and "`black-hole` max 7".
const KEEP = /keep hardcodes/i;
const PAIR = /([a-z0-9][a-z0-9-]*)\s+max\s+(\d+)/g;
let pairs = 0;
for (const file of PROSE) {
  for (const { line, i } of factLines(file)) {
    if (!KEEP.test(line)) continue;
    for (const m of line.replace(/`/g, "").matchAll(PAIR)) {
      pairs += 1;
      const [, id, n] = m;
      if (!ids.has(id)) fail(`${file}:${i} pins a max for \`${id}\`, which is not a tracker row`);
      else if (maxOf.get(id) !== Number(n)) {
        fail(`${file}:${i} pins \`${id}\` max ${n}; tracker.json says max ${maxOf.get(id) ?? "none"}`);
      }
    }
  }
}
if (pairs) ok(`${pairs} pinned \`<id> max <n>\` pair(s) match the data`);
else fail("the `Keep hardcodes:` line names no `<id> max <n>` pair — restore the pin or delete this rule deliberately");

// --- R4: the inventory tables and the data name the same rows ----------------
// `docs/tracker-data.md`'s tables are the reviewed inventory (the skill calls the
// doc the single source of truth), so a row added to the JSON without a line
// here — or a line for a row that no longer exists — is drift. Sub-task rows are
// listed too, marked with a leading arrow.
const DOC = "docs/tracker-data.md";
const TABLE_ROW = /^\|\s*(?:↳\s*)?([A-Za-z0-9][A-Za-z0-9-]*)\s*\|/;
const listed = [];
linesOf(DOC).forEach((line, i) => {
  const m = TABLE_ROW.exec(line);
  if (!m || m[1].toLowerCase() === "id") return;
  listed.push({ id: m[1], line: i + 1 });
});
const unlisted = rows.filter((r) => !listed.some((t) => t.id === r.id));
const phantom = listed.filter((t) => !ids.has(t.id));
if (unlisted.length) fail(`${DOC} has no inventory line for: ${unlisted.map((r) => r.id).join(", ")}`);
else ok(`all ${rows.length} tracker rows have an inventory line in ${DOC}`);
if (phantom.length) phantom.forEach((t) => fail(`${DOC}:${t.line} lists \`${t.id}\`, which is not a row in tracker.json`));
else ok(`every id in ${DOC}'s inventory tables is a tracker row`);

console.log(bad === 0 ? "doc facts: all pass" : `doc facts: ${bad} FAILED`);
process.exit(bad === 0 ? 0 : 1);
