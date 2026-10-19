#!/usr/bin/env node
/**
 * Does this diff need the live sync legs? Prints the verdict and the paths that
 * matched, so "does the live E2E apply here?" stops being a judgement call.
 *
 * Why this exists: `pnpm test:sync`'s live legs SKIP loudly without `pnpm dev:api`
 * and the Playwright Chromium, and a skipped leg proves nothing. The old rule read
 * "if you touch sync, reset, or merge code", which had no answer for the black-hole
 * diff — it added a store action that writes task values and called `checkResets`,
 * so the decision was a coin flip that happened to land on "skip".
 *
 * Advisory: this never fails anything, and it exits 0 even when it cannot diff.
 * The enforced half is `scripts/pre-push-gate.mjs`; this only says whether to go
 * and run the real thing. The pre-push hook calls it, and it is runnable by hand:
 *
 *   node scripts/needs-live-sync.mjs [base]     (default origin/main, then main)
 */
import { execFileSync } from "node:child_process";

// A persisted-write path, or a lane that reads one. Keep this in step with the
// `test:sync` trigger in AGENTS.md § Pre-push Gate.
const TRIGGERS = [
  [/^src\/sync\//, "the sync client"],
  [/^api\//, "the API routes"],
  [/^src\/lib\/reset\.ts$/, "reset math"],
  [/^src\/store\/useAppStore\.ts$/, "a store write path"],
  [/^src\/lib\/hourlyReminders\.ts$/, "the reminder lane"],
  [/^src\/hooks\/useHourlyReminders\.ts$/, "the reminder lane"],
  [/^public\/sw-push\.js$/, "the reminder lane"],
  [/^workers\//, "the Worker"],
];

const run = (a) => {
  try {
    return execFileSync("git", a, { encoding: "utf8" });
  } catch {
    return "";
  }
};

const base =
  process.argv[2] || (run(["rev-parse", "--verify", "--quiet", "origin/main"]).trim() ? "origin/main" : "main");
const files = [
  ...run(["diff", "--name-only", `${base}...HEAD`]).split("\n"),
  ...run(["diff", "--cached", "--name-only"]).split("\n"),
]
  .map((f) => f.trim())
  .filter(Boolean);

const hits = [];
for (const file of files) {
  for (const [re, why] of TRIGGERS) {
    if (!re.test(file)) continue;
    hits.push(`${file} (${why})`);
    break;
  }
}

if (hits.length) {
  console.log(`live sync: REQUIRED — ${hits.join(", ")}`);
  console.log("  run `pnpm dev:api` in one terminal, then `pnpm test:sync` (the live legs skip without it)");
} else {
  console.log(`live sync: not needed — nothing in ${base}...HEAD or the staged diff matches the trigger list`);
}
