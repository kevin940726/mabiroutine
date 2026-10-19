#!/usr/bin/env node
/**
 * The pre-push gate, called by the local `.git/hooks/pre-push` shim. The hook
 * file itself stays uncommitted — it also filters refs (public history stays
 * filtered), which is why it lives in `.git/`; the checks live here, where they
 * can be reviewed, run by hand, and changed like any other code.
 *
 * Three checks, cheapest first, and a changelog failure stops before the suite:
 *   1. the changelog rules, read from the commits themselves: every non-merge
 *      commit in the pushed range updates `CHANGELOG.md`, and a push to `main`
 *      leaves `## Unreleased` empty (the release was labelled in the tip commit);
 *   2. `pnpm check` — the fifteen gates;
 *   3. a note when the working tree is dirty: `pnpm check` reads the tree, not the
 *      pushed snapshot, so a dirty tree means it also checked unshipped work.
 *
 * Manual run: node scripts/pre-push-gate.mjs <local-sha> <remote-sha> [ref]
 *   --changelog-only   skip the suite (testing the changelog half)
 * Exit 1 blocks the push. `git push --no-verify` skips the hook entirely, as
 * always, and is the escape hatch when this gate itself is wrong.
 */
import { execFileSync, spawnSync } from "node:child_process";

const ZERO = /^0{40}$/;
let failed = false;
const fail = (msg) => {
  failed = true;
  console.log(`FAIL: ${msg}`);
};

const args = process.argv.slice(2);
const changelogOnly = args.includes("--changelog-only");
const [localSha, remoteSha, ref = "refs/heads/main"] = args.filter((a) => !a.startsWith("--"));
const git = (a) => {
  try {
    return execFileSync("git", a, { encoding: "utf8" });
  } catch (e) {
    // A git failure (an unfetched remote sha, a missing file in the pushed tip)
    // is a blocked push either way; say what git said instead of a stack trace.
    const why = (e.stderr || e.message || "").toString().trim().split("\n").filter(Boolean).pop() || "unknown error";
    fail(`\`git ${a.join(" ")}\` failed: ${why}`);
    console.log("pre-push gate: BLOCKED (fetch and retry, or `git push --no-verify` if this gate is wrong)");
    process.exit(1);
  }
};

if (!localSha || ZERO.test(localSha)) {
  console.log("pre-push gate: nothing to push");
  process.exit(0);
}

// --- 1. the changelog rules --------------------------------------------------
let range = [];
if (remoteSha && !ZERO.test(remoteSha)) {
  range = git(["rev-list", "--no-merges", `${remoteSha}..${localSha}`]).trim().split("\n").filter(Boolean);
} else {
  range = git(["rev-list", "--no-merges", localSha, "--not", "--remotes"]).trim().split("\n").filter(Boolean);
}
for (const sha of range) {
  const files = git(["show", "--name-only", "--format=", sha]).split("\n").filter(Boolean);
  if (files.includes("CHANGELOG.md")) continue;
  const subject = git(["log", "-1", "--format=%s", sha]).trim();
  fail(
    `${sha.slice(0, 7)} "${subject}" does not touch CHANGELOG.md — one entry per commit (amend it in), ` +
      `or \`git push --no-verify\` if this gate is wrong`
  );
}
if (range.length && !failed) console.log(`ok: all ${range.length} pushed commit(s) carry a CHANGELOG.md change`);

if (ref === "refs/heads/main") {
  const lines = git(["show", `${localSha}:CHANGELOG.md`]).split("\n");
  const start = lines.findIndex((l) => /^## Unreleased\s*$/.test(l));
  if (start < 0) {
    fail("CHANGELOG.md has no `## Unreleased` heading");
  } else {
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((l) => /^## /.test(l));
    const body = (end < 0 ? rest : rest.slice(0, end)).filter((l) => l.trim());
    if (body.length) {
      fail(
        `CHANGELOG.md's \`## Unreleased\` still holds ${body.length} line(s) — label the release (rename it ` +
          `\`## <YYYY-MM-DD> — <label>\`, fresh empty \`## Unreleased\` above) and fold that into the tip commit ` +
          `with \`git commit --amend --no-edit\``
      );
    } else {
      console.log("ok: `## Unreleased` is empty (the release is labelled)");
    }
  }
}

// --- 2. the suite ------------------------------------------------------------
if (!changelogOnly && !failed) {
  const dirty = Boolean(git(["status", "--porcelain"]).trim());
  if (dirty) console.log("note: the working tree is dirty — `pnpm check` reads the tree, so it also covers unshipped work");
  const res = spawnSync("pnpm check", { shell: true, stdio: ["ignore", "inherit", "inherit"] });
  if (res.status !== 0) {
    fail(
      "pnpm check failed" +
        (dirty
          ? " — and the working tree is dirty, so this may be unshipped work: stash or commit it, or `git push --no-verify`"
          : "")
    );
  }
}

console.log(failed ? "pre-push gate: BLOCKED" : "pre-push gate: pass");
process.exit(failed ? 1 : 0);
