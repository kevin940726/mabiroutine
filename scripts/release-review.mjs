#!/usr/bin/env node
/**
 * Show the release being pushed and approve its player-facing copy.
 *
 *   pnpm release:review            read, then approve or stop to edit
 *   pnpm release:review --print    print only
 *   pnpm release:review --check    exit 0 only when the tip content is approved
 *   pnpm release:review --approve  approve without a prompt (scripted use)
 *
 * Approval is a hash of the English Features/Fixes and the zh bullets, written
 * to `.git/release-review.json`. The pre-push gate recomputes it from the tip
 * commit, so editing either copy after approval blocks the push.
 */
import { createInterface } from "node:readline/promises";
import { readDisk, readToken, writeToken } from "./release-notes.mjs";

const args = process.argv.slice(2);
const mode = args[0] ?? "";
const root = process.cwd();
const release = readDisk(root);

if (release.unreleasedDirty) {
  console.error("`## Unreleased` still has entries. Cut the release first, then review it.");
  process.exit(1);
}
if (release.problems.length) {
  console.error(`Cannot review "${release.id}":`);
  for (const problem of release.problems) console.error(`- ${problem}`);
  process.exit(1);
}
if (!release.playerFacing) {
  console.log(`Internal-only release: ${release.id}`);
  console.log("No in-app changelog (<!-- whats-new: none -->), so there is nothing to approve.");
  process.exit(0);
}

const group = (title, bullets) => {
  if (!bullets.length) return;
  console.log(`\n${title}`);
  for (const bullet of bullets) console.log(`- ${bullet}`);
};

const zhGroups = release.zhEntries.reduce(
  (acc, entry) => {
    acc[entry.kind].push(entry.text);
    return acc;
  },
  { feature: [], fix: [] }
);

const token = readToken(root);
const approved = token?.release === release.id && token.hash === release.hash;

console.log(`Release: ${release.id}`);
console.log("Files: CHANGELOG.md, CHANGELOG-zh_TW.md, src/data/whatsNew.generated.json");
console.log("\nPlayer-facing changelog (English)");
group("### Features", release.features);
group("### Fixes", release.fixes);
console.log("\nIn-app changelog (zh-TW)");
group("### 新功能", zhGroups.feature);
group("### 修正", zhGroups.fix);
console.log("\nInternal (Chores, not in the app)");
if (release.chores.length) for (const bullet of release.chores) console.log(`- ${bullet}`);
else console.log("- (none)");
console.log(`\nJSON: ${release.jsonEntries.length} entries, in sync with the zh section.`);
console.log(approved ? "\nStatus: approved for this exact content.\n" : "\nStatus: not approved for this content.\n");

if (mode === "--print") process.exit(0);
if (mode === "--check") {
  if (approved) {
    console.log("review: approved");
    process.exit(0);
  }
  console.error("review: not approved for this content; run `pnpm release:review`");
  process.exit(1);
}
if (mode === "--approve") {
  writeToken(release, root);
  console.log("review: approved; `git push` will pass the review check.");
  process.exit(0);
}
if (!process.stdin.isTTY) {
  console.error("No terminal to approve in. Run `pnpm release:review` in a terminal, or use --print / --check.");
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = (await rl.question("Approve this exact player-facing copy? [y/N] ")).trim().toLowerCase();
rl.close();
if (answer === "y" || answer === "yes") {
  writeToken(release, root);
  console.log("review: approved; `git push` will pass the review check.");
} else {
  console.log("review: not approved. Edit the files above, then run `pnpm release:review` again.");
  process.exit(1);
}
