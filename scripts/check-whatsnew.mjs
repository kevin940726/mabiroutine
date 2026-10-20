#!/usr/bin/env node
/**
 * Changelog gate: the zh changelog, the JSON the app renders, and the English
 * log are one record seen three ways, and every seam between them is silent
 * when it breaks.
 *
 * `CHANGELOG-zh_TW.md` is a subsequence of `CHANGELOG.md`: it may skip a
 * release only by carrying `<!-- whats-new: none -->` under that English
 * heading, and it may never invent, duplicate or reorder one.
 * `src/data/whatsNew.generated.json` is a committed derivative of the zh file,
 * written by `scripts/whats-new.mjs --write` at cut time. A release with no zh
 * section is a release the player-facing record never mentioned; an
 * unregenerated JSON is the drawer showing the previous cut's copy; a reworded
 * English heading orphans the marker the seen state keys on, so nothing reads
 * as unread ever again. None of those fail at build or at runtime, and no other
 * gate reads the three files together — this one does.
 *
 * Read-only and offline. It imports `parseZh` and `diff` from
 * `scripts/whats-new.mjs`, so the freshness check *is* `--check`: same parse,
 * same comparison, nothing written. The fixtures pin that parser's contract in
 * both directions (accepted shape, and the constructs it must reject with their
 * line), because "ignore what you do not understand" turns a typo into
 * silently missing copy.
 *
 * Parity covers the dated releases from the baseline forward. The baseline is
 * the oldest section in the zh file (history before it stays English on
 * GitHub, no backfill), and `## Unreleased` is exempt: its zh copy is written in
 * the same cut that labels it, and the pre-push hook already requires it to be
 * empty on a `main` push.
 *
 * Usage: pnpm test:whatsnew
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { diff, parseZh } from "./whats-new.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ZH = "CHANGELOG-zh_TW.md";
const EN = "CHANGELOG.md";
const OUT = "src/data/whatsNew.generated.json";
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8").replace(/^\uFEFF/, "");
const strip = (line) => (line.endsWith("\r") ? line.slice(0, -1) : line);

let bad = 0;
const ok = (msg) => console.log(`ok: ${msg}`);
const fail = (msg) => {
  bad += 1;
  console.log(`FAIL: ${msg}`);
};
const quote = (s) => `"${s.replace(/\s+$/, "").slice(0, 100)}"`;

// --- Parser fixtures ---------------------------------------------------------
// Built here rather than in fixture files: the contract is the shapes, and a
// file would let the shapes drift out of sight of the assertion.
const PAST = "2026-10-18 — An older release";
const NOW = "2026-10-20 — The default-pin audit";
const PREAMBLE = "# 更新記錄\n\n這一頁是給玩家看的更新記錄。\n\n";
const body = "### 新功能\n- 一句給玩家看的話。\n\n### 修正\n- 另一句。\n";
const section = (title, marker, groups) => `${PREAMBLE}## ${title}\n${marker}\n\n${groups}`;

const NORMAL = section(NOW, `<!-- release: ${NOW} -->`, body);
const TWO = `${NORMAL}\n## ${PAST}\n<!-- release: ${PAST} -->\n\n### 修正\n- 比較舊的一句。\n`;
const NO_SECTION = `${PREAMBLE}只有前言，沒有任何一節。\n`;
const MARKER_NO_SECTION = `${PREAMBLE}<!-- release: ${NOW} -->\n\n### 新功能\n- 一句。\n`;
const MALFORMED_HEADING = section("2026-10-20 - 半形連字號", `<!-- release: ${NOW} -->`, body);
const NO_MARKER = section(NOW, "", body);
const NO_MARKER_AT_ALL = `${PREAMBLE}## ${NOW}\n\n### 新功能\n- 一句。\n`;
const DATE_MISMATCH = section("2026-10-20 — 標題", `<!-- release: ${PAST} -->`, body);
const DUPLICATE = `${NORMAL}\n## ${NOW}\n<!-- release: ${NOW} -->\n\n### 修正\n- 重複的標記。\n`;
const EMPTY_SECTION = section(NOW, `<!-- release: ${NOW} -->`, "");
const EMPTY_GROUP = section(NOW, `<!-- release: ${NOW} -->`, "### 新功能\n\n### 修正\n- 一句。\n");
const STRAY_BULLET = section(NOW, `<!-- release: ${NOW} -->`, "- 沒有群組的一句。\n");
const DUPLICATE_GROUP = section(NOW, `<!-- release: ${NOW} -->`, "### 修正\n- 一句。\n\n### 修正\n- 又一句。\n");
const H4 = section(NOW, `<!-- release: ${NOW} -->`, `${body}#### 不該出現的標題\n`);

let accepted = 0;
let rejected = 0;

const expectAccept = (name, markdown, assert) => {
  let entries;
  try {
    entries = parseZh(markdown);
  } catch (error) {
    fail(`fixture ${quote(name)}: parseZh rejected a document it must accept (${error.message})`);
    return;
  }
  const problem = assert(entries);
  if (problem) {
    fail(`fixture ${quote(name)}: ${problem}`);
    return;
  }
  accepted += 1;
};

const expectReject = (name, markdown, pattern) => {
  try {
    parseZh(markdown);
  } catch (error) {
    if (!/^line \d+: /.test(error.message)) {
      fail(`fixture ${quote(name)}: rejected without a line, so the writer cannot find it (${error.message})`);
      return;
    }
    if (!pattern.test(error.message)) {
      fail(`fixture ${quote(name)}: rejected with ${quote(error.message)}; expected ${pattern}`);
      return;
    }
    rejected += 1;
    return;
  }
  fail(`fixture ${quote(name)}: parseZh accepted a document it must reject`);
};

expectAccept("normal section", NORMAL, (entries) =>
  entries.length !== 2
    ? `${entries.length} entries, expected 2`
    : entries[0].release !== NOW || entries[0].kind !== "feature" || entries[0].date !== "2026-10-20"
      ? `first entry is ${JSON.stringify(entries[0])}`
      : entries[1].kind === "fix"
        ? ""
        : `second entry's kind is ${quote(entries[1].kind)}, expected "fix"`
);
expectAccept("two sections, newest first", TWO, (entries) =>
  entries.length === 3 && entries[2].release === PAST ? "" : `${entries.length} entries; the older release is not last`
);
expectReject("missing section", NO_SECTION, /no release section/);
expectReject("marker with no section", MARKER_NO_SECTION, /no release section/);
expectReject("malformed heading", MALFORMED_HEADING, /a release heading must read/);
expectReject("section with no marker", NO_MARKER_AT_ALL, /needs exactly one marker/);
expectReject("blank marker", NO_MARKER, /needs exactly one marker/);
expectReject("marker date differs from the heading (identity)", DATE_MISMATCH, /differs from the heading/);
expectReject("duplicate marker", DUPLICATE, /a second section carries the marker/);
expectReject("empty section", EMPTY_SECTION, /has no bullets/);
expectReject("group with no bullets", EMPTY_GROUP, /group has no bullets/);
expectReject("bullet outside a group", STRAY_BULLET, /outside a group/);
expectReject("duplicate group", DUPLICATE_GROUP, /a second "### 修正"/);
expectReject("an h4 in a section body", H4, /is not part of a release section/);

ok(`parser fixtures: ${accepted} accepted shape(s), ${rejected} rejected shape(s) with their line`);

// --- The zh file parses, and the JSON is a fresh parse -----------------------
let entries;
try {
  entries = parseZh(read(ZH));
} catch (error) {
  fail(`${ZH} ${error.message}`);
}

let committed;
try {
  committed = JSON.parse(read(OUT));
} catch (error) {
  fail(
    error instanceof SyntaxError
      ? `${OUT} is not valid JSON: ${error.message} — run \`node scripts/whats-new.mjs --write\``
      : `${OUT} is missing or unreadable: ${error.message} — run \`node scripts/whats-new.mjs --write\``
  );
}
if (entries && committed) {
  if (!Array.isArray(committed)) fail(`${OUT} holds ${typeof committed}, not the array \`--write\` emits`);
  else {
    const problems = diff(entries, committed);
    if (problems.length) {
      fail(`${OUT} does not match ${ZH}:`);
      problems.forEach((problem) => console.log(`  ${problem}`));
      console.log("  run `node scripts/whats-new.mjs --write` and commit the result");
    } else {
      const releases = new Set(entries.map((entry) => entry.release));
      ok(`${OUT} matches ${ZH} (${entries.length} entries in ${releases.size} release${releases.size === 1 ? "" : "s"})`);
    }
  }
}

// --- Parity with CHANGELOG.md, from the baseline forward --------------------
const DATED = /^(\d{4}-\d{2}-\d{2}) — (.+)$/;
const NONE = /^<!-- whats-new: none -->$/;
const english = [];
const seen = new Map();
const enLines = read(EN).split("\n").map(strip);

enLines.forEach((line, i) => {
  if (!line.startsWith("## ")) return;
  const text = line.slice(3).trim();
  if (text === "Unreleased") return;
  if (!DATED.test(text)) {
    fail(`${EN}:${i + 1} heading ${quote(text)} is neither "## Unreleased" nor "## YYYY-MM-DD — <label>"`);
    return;
  }
  const twin = seen.get(text);
  if (twin) {
    fail(`${EN}:${i + 1} repeats the release heading ${quote(text)} (the first is at line ${twin})`);
    return;
  }
  seen.set(text, i + 1);
  let j = i + 1;
  while (j < enLines.length && enLines[j].trim() === "") j += 1;
  english.push({ id: text, date: DATED.exec(text)[1], line: i + 1, none: j < enLines.length && NONE.test(enLines[j].trim()) });
});

// A `none` marker out of position says "nothing player-facing" somewhere no
// zh section can be missing from, so it is a typo rather than a decision. Only
// a line that IS the marker counts — prose may name it (this changelog does).
const allowedNone = new Set(english.filter((r) => r.none).map((r) => r.line + 1));
enLines.forEach((line, i) => {
  if (NONE.test(line.trim()) && !allowedNone.has(i + 1)) {
    fail(`${EN}:${i + 1} has a whats-new: none marker, but it must sit directly under its dated release heading`);
  }
});

if (entries) {
  const zhIds = [...new Set(entries.map((entry) => entry.release))];
  const zhSet = new Set(zhIds);
  const byId = new Map(english.map((release, index) => [release.id, { ...release, index }]));
  const baseline = zhIds[zhIds.length - 1];
  const base = byId.get(baseline ?? "");

  if (!base) {
    fail(
      `${ZH}'s oldest section ${quote(baseline ?? "")} names no heading in ${EN} — there is no baseline to compare from, ` +
        "and a reworded English heading is a gate failure, not a silent re-key"
    );
  } else {
    ok(`baseline is the oldest zh section: ${quote(baseline)} (${EN}:${base.line})`);
  }

  let unresolved = 0;
  for (const id of zhIds) {
    const hit = byId.get(id);
    if (!hit) {
      unresolved += 1;
      fail(`${ZH} has a section whose marker ${quote(id)} names no heading in ${EN}`);
    } else if (hit.none) {
      fail(`${ZH} has a section for ${quote(id)}, but ${EN}:${hit.line} says <!-- whats-new: none --> — pick one`);
    }
  }

  let covered = [];
  let missing = [];
  if (base) {
    covered = english.slice(0, base.index + 1);
    missing = covered.filter((release) => !zhSet.has(release.id) && !release.none);
    for (const release of missing) {
      fail(
        `${EN}:${release.line} ${quote(release.id)} has no zh section and no <!-- whats-new: none --> marker — ` +
          "write the player-facing copy, or say none deliberately"
      );
    }
  }

  // The zh file is a subsequence of CHANGELOG.md: same relative order, never a
  // superset, never a reorder. Skipped only when a marker resolved to nothing,
  // which already failed above and would make the comparison meaningless.
  if (!unresolved) {
    const expected = english.filter((release) => zhSet.has(release.id)).map((release) => release.id);
    const at = expected.findIndex((id, k) => id !== zhIds[k]);
    const lengthDiffers = expected.length !== zhIds.length;
    if (at >= 0 || lengthDiffers) {
      const position = at >= 0 ? at : Math.min(expected.length, zhIds.length);
      fail(
        `${ZH} order differs from ${EN} at position ${position + 1}: expected ${quote(expected[position] ?? "(nothing)")}, ` +
          `found ${quote(zhIds[position] ?? "(nothing)")}`
      );
    } else {
      ok(`${zhIds.length} zh release(s) follow the ${EN} order`);
    }
  }

  if (base && !missing.length) {
    const withZh = covered.filter((release) => zhSet.has(release.id)).length;
    ok(
      `all ${covered.length} English release(s) from the baseline forward are covered — ` +
        `${withZh} with a zh section, ${covered.length - withZh} with whats-new: none`
    );
  }

  const dated = entries.filter((entry) => entry.date !== entry.release.slice(0, 10));
  dated.forEach((entry) =>
    fail(`${ZH} entry "${entry.text.slice(0, 40)}…" carries release date ${entry.date} but marker date ${entry.release.slice(0, 10)}`)
  );
  if (!dated.length) ok(`every marker's date equals its zh heading date (${zhIds.length} section(s))`);
}

// --- Copy rules -------------------------------------------------------------
// The app renders these bullets as text, so a backtick, a path or a hash is a
// code identifier leaking into player copy. Proper nouns (GitHub, Taipei) are
// not identifiers and stay allowed.
const FILE_NAME = /\b[\w-]+\.(?:md|mdx|mjs|cjs|js|ts|tsx|jsx|json|css|html|png|webp|svg|py|sh|ya?ml)\b/;
const HASH = /\b(?=[0-9a-f]*\d)[0-9a-f]{7,40}\b/i;
const copyProblems = (text) => {
  const problems = [];
  if (text.includes("`")) problems.push("a backtick");
  if (FILE_NAME.test(text)) problems.push("a file name");
  if (HASH.test(text)) problems.push("a commit hash");
  for (const token of text.split(/[\s，。、：；（）()「」『』！？…]+/)) {
    if (token.includes("/") && !/^\d+\s*\/\s*\d+$/.test(token)) problems.push(`a file path ("${token}")`);
  }
  return problems;
};

if (entries) {
  let checked = 0;
  for (const entry of entries) {
    checked += 1;
    for (const problem of copyProblems(entry.text)) {
      fail(`${ZH} bullet under ${quote(entry.release)} carries ${problem}: ${quote(entry.text)}`);
    }
  }
  ok(`${checked} bullet(s) carry no backticks, file names, paths or commit hashes`);
}

if (entries) {
  const first = read(ZH).split("\n").find((line) => line.trim() !== "");
  if (first?.trim() !== "# 更新記錄") {
    fail(`${ZH}:1 starts with ${quote(first ?? "")} — the file opens with "# 更新記錄" and prose`);
  } else {
    ok(`${ZH} opens with "# 更新記錄" and prose`);
  }
}

console.log(bad === 0 ? "whatsnew: all pass" : `whatsnew: ${bad} FAILED`);
process.exit(bad === 0 ? 0 : 1);
