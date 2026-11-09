import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseZh } from "./whats-new.mjs";

const EN = "CHANGELOG.md";
const ZH = "CHANGELOG-zh_TW.md";
const JSON_FILE = "src/data/whatsNew.generated.json";
const DATE_HEADING = /^(\d{4}-\d{2}-\d{2}) — (.+)$/;

const bulletText = (line) => {
  const m = /^- (.*)$/.exec(line);
  return m ? m[1].trim() : null;
};

export function parseEnglish(md) {
  const lines = md.split(/\r?\n/);
  const sections = [];
  let cur = null;
  let group = null;
  for (const line of lines) {
    const heading = /^## (.+)$/.exec(line);
    if (heading) {
      cur = { heading: heading[1].trim(), features: [], fixes: [], chores: [], none: false };
      sections.push(cur);
      group = null;
      continue;
    }
    if (!cur) continue;
    const g = /^### (Features|Fixes|Chores)$/.exec(line.trim());
    if (g) {
      group = g[1].toLowerCase();
      continue;
    }
    if (line.trim() === "<!-- whats-new: none -->") {
      cur.none = true;
      continue;
    }
    const text = bulletText(line);
    if (text && group) cur[group].push(text);
  }

  const unreleasedIndex = sections.findIndex((s) => s.heading === "Unreleased");
  if (unreleasedIndex < 0) throw new Error(`${EN} has no "## Unreleased" heading`);
  const unreleased = sections[unreleasedIndex];
  const unreleasedDirty = [unreleased.features, unreleased.fixes, unreleased.chores].some((b) => b.length > 0);
  const dated = sections.slice(unreleasedIndex + 1).find((s) => DATE_HEADING.test(s.heading));
  if (!dated) throw new Error(`${EN} has no dated release under "## Unreleased"`);
  const [, date, title] = DATE_HEADING.exec(dated.heading);
  return {
    unreleasedDirty,
    release: {
      id: dated.heading,
      date,
      title,
      features: dated.features,
      fixes: dated.fixes,
      chores: dated.chores,
      none: dated.none,
    },
  };
}

function problemList(release, zhEntries, jsonEntries) {
  const problems = [];
  const playerFacing = release.features.length + release.fixes.length > 0;
  if (!playerFacing && !release.none) {
    problems.push(`a Chores-only release needs <!-- whats-new: none --> under "## ${release.id}"`);
  }
  if (playerFacing && release.none) {
    problems.push(`"## ${release.id}" has player-facing entries and <!-- whats-new: none -->; pick one`);
  }
  if (playerFacing) {
    if (!zhEntries.length) {
      problems.push(`${ZH} has no section for "${release.id}"`);
    }
    if (!jsonEntries.length) {
      problems.push(`${JSON_FILE} has no entries for "${release.id}"`);
    } else if (jsonEntries.length !== zhEntries.length) {
      problems.push(`${JSON_FILE} has ${jsonEntries.length} entries for "${release.id}", ${ZH} has ${zhEntries.length}`);
    } else {
      for (let i = 0; i < zhEntries.length; i += 1) {
        if (jsonEntries[i].kind !== zhEntries[i].kind || jsonEntries[i].text !== zhEntries[i].text) {
          problems.push(`${JSON_FILE} entry ${i + 1} differs from ${ZH}; run node scripts/whats-new.mjs --write`);
          break;
        }
      }
    }
  }
  return problems;
}

function build(release, zhMarkdown, jsonText) {
  const zhEntries = zhMarkdown ? parseZh(zhMarkdown).filter((entry) => entry.release === release.id) : [];
  const parsedJson = jsonText ? JSON.parse(jsonText) : [];
  const jsonEntries = Array.isArray(parsedJson) ? parsedJson.filter((entry) => entry.release === release.id) : [];
  const problems = problemList(release, zhEntries, jsonEntries);
  const playerFacing = release.features.length + release.fixes.length > 0;
  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        id: release.id,
        features: release.features,
        fixes: release.fixes,
        zh: zhEntries.map((entry) => ({ kind: entry.kind, text: entry.text })),
      })
    )
    .digest("hex");
  return { ...release, zhEntries, jsonEntries, problems, playerFacing, hash };
}

export function readDisk(root = process.cwd()) {
  const english = fs.readFileSync(path.join(root, EN), "utf8");
  const { unreleasedDirty, release } = parseEnglish(english);
  const zhPath = path.join(root, ZH);
  const jsonPath = path.join(root, JSON_FILE);
  const zh = fs.existsSync(zhPath) ? fs.readFileSync(zhPath, "utf8") : "";
  const json = fs.existsSync(jsonPath) ? fs.readFileSync(jsonPath, "utf8") : "";
  return { unreleasedDirty, ...build(release, zh, json) };
}

function gitShow(root, sha, file) {
  try {
    return execFileSync("git", ["show", `${sha}:${file}`], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return "";
  }
}

export function readGit(root, sha) {
  const english = gitShow(root, sha, EN);
  if (!english) throw new Error(`cannot read ${EN} from ${sha}`);
  const { unreleasedDirty, release } = parseEnglish(english);
  return { unreleasedDirty, ...build(release, gitShow(root, sha, ZH), gitShow(root, sha, JSON_FILE)) };
}

export function tokenPath(root = process.cwd()) {
  const gitDir = execFileSync("git", ["rev-parse", "--git-dir"], { cwd: root, encoding: "utf8" }).trim();
  return path.join(path.isAbsolute(gitDir) ? gitDir : path.join(root, gitDir), "release-review.json");
}

export function readToken(root = process.cwd()) {
  try {
    return JSON.parse(fs.readFileSync(tokenPath(root), "utf8"));
  } catch {
    return null;
  }
}

export function writeToken(release, root = process.cwd()) {
  fs.writeFileSync(
    tokenPath(root),
    `${JSON.stringify({ release: release.id, hash: release.hash, approvedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8"
  );
}
