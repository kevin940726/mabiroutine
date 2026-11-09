#!/usr/bin/env node
/**
 * The pre-push gate's own gate. `scripts/pre-push-gate.mjs` is the only thing
 * enforcing two rules that used to be prose — a `CHANGELOG.md` change in every
 * pushed commit, and an empty `## Unreleased` on a `main` push — and the local hook
 * blocks a push on its say-so. A silent regression there is therefore a rule that
 * stops being enforced, or a push that cannot go through, so its outcomes are
 * pinned here against a throwaway repo in the temp dir.
 *
 * The repo it builds is deliberately minimal: one `package.json` whose `check`
 * exits 1, and `--changelog-only` wherever the suite is not the thing under test,
 * so this never re-enters the real `pnpm check`.
 *
 * Why the hook itself is not tested: `.git/hooks/pre-push` is uncommitted by
 * design, and it is a shim — all the logic is in the script.
 * No bundling: spawns git and node against a temp dir.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const GATE = path.join(import.meta.dirname, "pre-push-gate.mjs");
const REVIEW = path.join(import.meta.dirname, "release-review.mjs");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mabiroutine-prepush-"));
const ZERO = "0".repeat(40);
const LABELLED = "# Changelog\n\n## Unreleased\n\n## 2026-01-01 — first\n<!-- whats-new: none -->\n";
const UNLABELLED = "# Changelog\n\n## Unreleased\n\n### Chores\n- a change\n";
const FEATURE_EN = "# Changelog\n\n## Unreleased\n\n## 2026-01-02 — feature\n\n### Features\n- a thing\n";
const FEATURE_ZH =
  "# 更新記錄\n\n## 2026-01-02 — 功能\n<!-- release: 2026-01-02 — feature -->\n\n### 新功能\n- 一件事。\n";
const FEATURE_JSON = `${JSON.stringify(
  [{ release: "2026-01-02 — feature", date: "2026-01-02", kind: "feature", text: "一件事。" }],
  null,
  2
)}\n`;

let bad = 0;
const ok = (msg) => console.log(`ok: ${msg}`);
const fail = (msg) => {
  bad += 1;
  console.log(`FAIL: ${msg}`);
};
const write = (name, text) => fs.writeFileSync(path.join(dir, name), text);
const git = (...args) =>
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: dir, encoding: "utf8" });
const commit = (message) => {
  git("add", "-A");
  git("commit", "-qm", message);
  return git("rev-parse", "HEAD").trim();
};
/** Run the gate; a non-zero exit throws, so catch it and keep its output. */
const gate = (...args) => {
  try {
    return { status: 0, out: execFileSync(process.execPath, [GATE, ...args], { cwd: dir, encoding: "utf8" }) };
  } catch (e) {
    return { status: e.status, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
};
const review = (...args) => execFileSync(process.execPath, [REVIEW, ...args], { cwd: dir, encoding: "utf8" });
const expect = (name, r, { status, has = [], notHas = [] }) => {
  const problems = [];
  if (r.status !== status) problems.push(`exit ${r.status}, expected ${status}`);
  for (const s of has) if (!r.out.includes(s)) problems.push(`missing ${JSON.stringify(s)}`);
  for (const s of notHas) if (r.out.includes(s)) problems.push(`unexpected ${JSON.stringify(s)}`);
  if (problems.length) fail(`${name} — ${problems.join("; ")}`);
  else ok(name);
};

try {
  git("init", "-q");
  // A global hook or a signing config would otherwise reach into this repo.
  git("config", "core.hooksPath", path.join(dir, "no-hooks"));
  git("config", "commit.gpgsign", "false");
  write("package.json", JSON.stringify({ name: "t", private: true, scripts: { check: "exit 1" } }));
  write("CHANGELOG.md", LABELLED);
  commit("first");

  // 1. an unlabelled `## Unreleased` on a `main` push fails, before the suite runs
  write("CHANGELOG.md", UNLABELLED);
  const unlabelled = commit("unlabelled");
  expect("an unlabelled `## Unreleased` fails on `main`", gate(unlabelled, ZERO, "refs/heads/main"), {
    status: 1,
    has: ["label the release", "## Unreleased"],
    notHas: ["pnpm check"], // fail-fast: the suite must not have run
  });

  // 2. …but a feature-branch push skips that rule
  expect("a `feat/*` ref skips the Unreleased rule", gate(unlabelled, ZERO, "refs/heads/feat/x", "--changelog-only"), {
    status: 0,
    has: ["pre-push gate: pass"],
  });

  // 3. a labelled release on `main` passes
  write("CHANGELOG.md", LABELLED);
  const labelled = commit("labelled");
  expect("a labelled `## Unreleased` passes", gate(labelled, ZERO, "refs/heads/main", "--changelog-only"), {
    status: 0,
    has: ["`## Unreleased` is empty"],
  });

  // 4. a player-facing release needs an approval of the exact copy
  fs.mkdirSync(path.join(dir, "src/data"), { recursive: true });
  write("CHANGELOG.md", FEATURE_EN);
  write("CHANGELOG-zh_TW.md", FEATURE_ZH);
  write("src/data/whatsNew.generated.json", FEATURE_JSON);
  fs.rmSync(path.join(dir, ".git/release-review.json"), { force: true });
  const feature = commit("feature release");
  expect("a player-facing release is blocked until reviewed", gate(feature, ZERO, "refs/heads/main", "--changelog-only"), {
    status: 1,
    has: ["not reviewed", "pnpm release:review"],
  });
  review("--approve");
  expect("the approved feature release passes", gate(feature, ZERO, "refs/heads/main", "--changelog-only"), {
    status: 0,
    has: ["release notes reviewed"],
  });
  write("CHANGELOG.md", FEATURE_EN.replace("a thing", "a different thing"));
  const edited = commit("edit after approval");
  expect("an edit after approval blocks the push", gate(edited, ZERO, "refs/heads/main", "--changelog-only"), {
    status: 1,
    has: ["not reviewed"],
  });

  // 5. a failing suite with a dirty tree says so
  fs.appendFileSync(path.join(dir, "CHANGELOG.md"), "scratch\n");
  expect("a failing suite names the dirty tree", gate(labelled, ZERO, "refs/heads/main"), {
    status: 1,
    has: ["pnpm check failed", "may be unshipped work"],
  });
  git("checkout", "--", "CHANGELOG.md");

  // 6. a commit with no changelog change fails, naming the commit
  write("src.txt", "x");
  const noEntry = commit("no changelog entry");
  expect("a commit with no changelog change fails", gate(noEntry, labelled, "refs/heads/feat/x", "--changelog-only"), {
    status: 1,
    has: [noEntry.slice(0, 7), "does not touch CHANGELOG.md"],
  });

  // 7. a bad revision range reports git's message, not a stack trace
  expect("a bad revision range reports git's message", gate(labelled, "deadbeef".repeat(5), "refs/heads/main", "--changelog-only"), {
    status: 1,
    has: ["git rev-list", "failed:"],
    notHas: ["at Module", "at Object."],
  });
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(bad === 0 ? "pre-push gate tests: all pass" : `pre-push gate tests: ${bad} FAILED`);
process.exit(bad === 0 ? 0 : 1);
