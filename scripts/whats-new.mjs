#!/usr/bin/env node
/** The zh changelog parser, and the only writer of `src/data/whatsNew.generated.json`. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC_FILE = path.join(ROOT, "CHANGELOG-zh_TW.md");
const OUT_FILE = path.join(ROOT, "src/data/whatsNew.generated.json");
const SRC_LABEL = "CHANGELOG-zh_TW.md";
const OUT_LABEL = "src/data/whatsNew.generated.json";

const HEADING = /^## (\d{4}-\d{2}-\d{2}) — (.+)$/;
const MARKER = /^<!-- release: (.+?) -->$/;
const MARKER_ID = /^(\d{4}-\d{2}-\d{2}) — (.+)$/;
const GROUP = /^### (.+)$/;
const BULLET = /^- (.*)$/;
const GROUPS = new Map([
  ["新功能", "feature"],
  ["修正", "fix"],
]);

const isRealDate = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

const quote = (s) => `"${s.replace(/\s+$/, "").slice(0, 100)}"`;

const reject = (line, message) => {
  const error = new Error(`line ${line}: ${message}`);
  error.line = line;
  throw error;
};

/**
 * Parse the zh changelog into flat entries, one per bullet, in file order.
 * Throws (with `error.line`) on any construct the format does not describe.
 */
export const parseZh = (markdown) => {
  const lines = markdown.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
  const entries = [];
  const markers = new Map();

  let i = 0;
  while (i < lines.length && !lines[i].startsWith("## ")) i += 1;
  if (i === lines.length) {
    reject(Math.max(lines.length, 1), 'no release section: the file needs a "## YYYY-MM-DD — <title>" heading');
  }

  while (i < lines.length) {
    const sectionLine = i + 1;
    const heading = HEADING.exec(lines[i].trimEnd());
    if (!heading) {
      reject(sectionLine, `a release heading must read "## YYYY-MM-DD — <title>", got ${quote(lines[i])}`);
    }
    const [, headingDate, rawTitle] = heading;
    if (!isRealDate(headingDate)) reject(sectionLine, `"${headingDate}" is not a real date`);
    if (!rawTitle.trim()) reject(sectionLine, "the release heading has no title");
    i += 1;

    while (i < lines.length && lines[i].trim() === "") i += 1;
    if (i === lines.length) reject(sectionLine, "the section has no <!-- release: ... --> marker");
    const markerLine = i + 1;
    const marker = MARKER.exec(lines[i].trimEnd());
    if (!marker) {
      reject(
        markerLine,
        `a section needs exactly one marker line under its heading, got ${quote(lines[i])} — ` +
          'write it as "<!-- release: YYYY-MM-DD — <English heading> -->"'
      );
    }
    const release = marker[1].trim();
    const id = MARKER_ID.exec(release);
    if (!id) reject(markerLine, `a marker names the English heading as "YYYY-MM-DD — <title>", got ${quote(release)}`);
    if (!isRealDate(id[1])) reject(markerLine, `"${id[1]}" is not a real date`);
    if (!id[2].trim()) reject(markerLine, "the marker has no title");
    if (id[1] !== headingDate) {
      reject(markerLine, `the marker's date ${id[1]} differs from the heading's ${headingDate}`);
    }
    const twin = markers.get(release);
    if (twin) reject(markerLine, `a second section carries the marker ${quote(release)} (the first is at line ${twin})`);
    markers.set(release, markerLine);
    i += 1;

    let kind = null;
    let groupLine = 0;
    let groupLabel = "";
    let groupBullets = 0;
    let sectionBullets = 0;

    const closeGroup = () => {
      if (kind && groupBullets === 0) {
        reject(groupLine, `the "### ${groupLabel}" group has no bullets — delete the group or give it one`);
      }
    };

    while (i < lines.length && !lines[i].startsWith("## ")) {
      const line = lines[i];
      const lineNo = i + 1;
      i += 1;
      if (line.trim() === "") continue;

      const group = GROUP.exec(line.trimEnd());
      if (group) {
        const label = group[1].trim();
        const next = GROUPS.get(label);
        if (!next) {
          reject(lineNo, `unknown group heading "### ${label}" — only "### 新功能" and "### 修正" are allowed`);
        }
        if (next === kind) reject(lineNo, `a second "### ${label}" group in the section that starts at line ${sectionLine}`);
        closeGroup();
        kind = next;
        groupLabel = label;
        groupLine = lineNo;
        groupBullets = 0;
        continue;
      }

      const bullet = BULLET.exec(line);
      if (bullet) {
        if (!kind) {
          reject(lineNo, `a bullet sits outside a group — put it under "### 新功能" or "### 修正"`);
        }
        const text = bullet[1].trim();
        if (!text) reject(lineNo, 'a bullet with no text — write "- <text>"');
        entries.push({ release, date: headingDate, kind, text });
        groupBullets += 1;
        sectionBullets += 1;
        continue;
      }

      if (line.trim() === "-") reject(lineNo, 'a bullet with no text — write "- <text>"');

      if (MARKER.test(line.trimEnd())) {
        reject(lineNo, `a section carries exactly one marker; this is a second one (the first is at line ${markerLine})`);
      }
      reject(
        lineNo,
        `${quote(line)} is not part of a release section — a section holds one marker, ` +
          '"### 新功能" / "### 修正" groups, and "- " bullets (a release with nothing user-facing is left out of this file)'
      );
    }

    closeGroup();
    if (sectionBullets === 0) {
      reject(sectionLine, "this section has no bullets — delete it or give it one");
    }
  }

  return entries;
};

const readJson = () => {
  if (!fs.existsSync(OUT_FILE)) {
    console.log(`FAIL: ${OUT_LABEL} is missing — run \`node scripts/whats-new.mjs --write\` and commit it`);
    process.exit(1);
  }
  try {
    return JSON.parse(fs.readFileSync(OUT_FILE, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    console.log(`FAIL: ${OUT_LABEL} is not valid JSON: ${error.message}`);
    process.exit(1);
  }
};

const FIELDS = ["date", "kind", "text"];
const short = (s) => (s.length > 96 ? `${s.slice(0, 96)}…` : s);

/**
 * Compare a fresh parse with the committed JSON and return the problems; empty
 * means the JSON is in step with the zh file.
 */
export const diff = (parsed, committed) => {
  const problems = [];
  const grouped = (list) => {
    const map = new Map();
    for (const entry of list) map.set(entry.release, [...(map.get(entry.release) ?? []), entry]);
    return map;
  };
  const want = grouped(parsed);
  const have = new Map();
  committed.forEach((entry, index) => {
    if (!entry || typeof entry.release !== "string") {
      problems.push(`the committed JSON's entry ${index} is not a { release, date, kind, text } object`);
      return;
    }
    have.set(entry.release, [...(have.get(entry.release) ?? []), entry]);
  });

  for (const release of want.keys()) {
    if (have.has(release)) continue;
    const count = want.get(release).length;
    problems.push(`missing from the committed JSON: ${quote(release)} (${count} bullet${count === 1 ? "" : "s"})`);
  }
  for (const release of have.keys()) {
    if (want.has(release)) continue;
    problems.push(`stale in the committed JSON: ${quote(release)} — no such marker in the zh file`);
  }

  for (const [release, fresh] of want) {
    const old = have.get(release);
    if (!old) continue;
    if (fresh.length !== old.length) {
      problems.push(`${quote(release)}: ${fresh.length} bullet(s) in the zh file, ${old.length} in the JSON`);
    }
    const n = Math.min(fresh.length, old.length);
    for (let k = 0; k < n; k += 1) {
      const a = fresh[k];
      const b = old[k];
      const changed = FIELDS.filter((field) => a[field] !== b[field]);
      if (!changed.length) continue;
      problems.push(`[${k}] ${quote(release)}: ${changed.join(", ")} differ(s)`);
      for (const field of changed) {
        problems.push(`      zh   ${field}: ${short(String(a[field]))}`);
        problems.push(`      json ${field}: ${short(String(b[field]))}`);
      }
    }
  }

  const order = (map) => [...map.keys()];
  const wantOrder = order(want);
  const haveOrder = order(have).filter((release) => want.has(release));
  if (wantOrder.join("\n") !== haveOrder.join("\n")) {
    problems.push("order differs: the JSON must follow the zh file, newest first, with nothing sorted");
  }
  return problems;
};

const isEntry = path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url);

if (isEntry) {
  const args = process.argv.slice(2);
  const mode = args.length === 1 ? args[0] : "";
  if (mode !== "--write" && mode !== "--check") {
    console.log("usage: node scripts/whats-new.mjs --write | --check");
    process.exit(2);
  }

  let entries;
  try {
    entries = parseZh(fs.readFileSync(SRC_FILE, "utf8"));
  } catch (error) {
    console.log(`FAIL: ${SRC_LABEL} ${error.message}`);
    process.exit(1);
  }
  const releases = new Set(entries.map((entry) => entry.release));
  const summary = `${entries.length} entries in ${releases.size} release${releases.size === 1 ? "" : "s"}`;

  if (mode === "--write") {
    fs.writeFileSync(OUT_FILE, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
    console.log(`wrote ${OUT_LABEL}: ${summary}`);
  } else {
    const problems = diff(entries, readJson());
    if (problems.length) {
      console.log(`FAIL: ${OUT_LABEL} does not match ${SRC_LABEL} (${summary})`);
      problems.forEach((problem) => console.log(`  ${problem}`));
      console.log(`  run \`node scripts/whats-new.mjs --write\` and commit the result`);
      process.exit(1);
    }
    console.log(`ok: ${OUT_LABEL} matches ${SRC_LABEL} (${summary})`);
  }
}
