#!/usr/bin/env node
/**
 * The `pnpm check` runner. One line per gate, and the verdict is the last line —
 * so truncating the output no longer throws the results away.
 *
 * Why this exists: `check` used to be a `&&` chain, so the only visible tail was
 * whatever the last gate printed (the Vite build). A run truncated with
 * `... | Select-Object -Last 25` — the habit on Windows, where the whole gate
 * transcript is thousands of lines — therefore discarded every gate result: the
 * 2026-10-19 session could not tell whether `test:tracker` had passed with new
 * fixtures, and had to re-run it and grep for the assertion text to find out.
 *
 * Behavior: gates run in the listed order and stop at the first failure (the old
 * chain's semantics). A passing gate prints `ok <gate> <ms>`; a failing gate
 * prints `FAIL <gate> <ms>` and its own captured output, then the summary, then
 * exits 1. `--verbose` streams every gate's output instead of capturing it.
 * `node scripts/check-all.mjs test:tracker test:tap` runs a subset (the
 * iteration loop); `--list` prints the gate names.
 *
 * This list is the single source of truth for what `pnpm check` covers; the
 * commands themselves stay in `package.json` (each entry runs `pnpm <name>`),
 * and a name that is not a script there fails loudly rather than being skipped.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";

const GATES = [
  "lint",
  "test:shops",
  "test:tracker",
  "test:docs",
  "test:prepush",
  "test:icons",
  "test:fallbacks",
  "test:budget",
  "test:worker",
  "test:reminders",
  "test:drag",
  "test:tap",
  "test:purple",
  "test:migrations",
  "test:sync",
  "build",
];

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const missingScripts = GATES.filter((g) => !pkg.scripts[g]);
if (missingScripts.length) {
  console.error(`check-all: not a script in package.json: ${missingScripts.join(", ")}`);
  process.exit(1);
}

// Every conditional gate must still have its trigger bullet in AGENTS.md: that
// line is what makes an agent run the gate, so a name that survives only in the
// enumeration is a gate that stops firing. (The gate section was trimmed from
// 1,317 words to ~500 for exactly this reason, and this is what keeps the trim
// honest.) `lint` and `build` are unconditional, so the enumeration is enough.
const agents = fs.readFileSync("AGENTS.md", "utf8");
const bullets = new Set(
  agents
    .split("\n")
    .map((l) => /^- `([^`]+)`/.exec(l)?.[1])
    .filter(Boolean)
);
const unnamed = GATES.filter((g) => g.startsWith("test:") && !bullets.has(g));
if (unnamed.length) {
  console.error(`check-all: AGENTS.md has no trigger bullet for: ${unnamed.join(", ")} — add one there`);
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.includes("--list")) {
  console.log(GATES.join("\n"));
  process.exit(0);
}
const verbose = args.includes("--verbose");
const wanted = args.filter((a) => !a.startsWith("--"));
const notAGate = wanted.filter((w) => !GATES.includes(w));
if (notAGate.length) {
  console.error(`check-all: not a gate: ${notAGate.join(", ")} (--list shows them)`);
  process.exit(1);
}
const run = wanted.length ? GATES.filter((g) => wanted.includes(g)) : GATES;
const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;

for (const [i, gate] of run.entries()) {
  const started = Date.now();
  // One command string, not an args array: `shell` + args is deprecated (DEP0190).
  // The name is safe in a shell string — it comes from the fixed GATES list above,
  // checked against package.json.
  const res = spawnSync(`pnpm ${gate}`, { shell: true, encoding: "utf8", stdio: verbose ? "inherit" : "pipe" });
  const ms = Date.now() - started;
  if (res.status === 0) {
    console.log(`ok   ${gate} (${secs(ms)})`);
    continue;
  }
  console.log(`FAIL ${gate} (${secs(ms)})`);
  if (!verbose) {
    const out = [res.stdout, res.stderr, res.error ? String(res.error) : ""].filter(Boolean).join("").trimEnd();
    if (out) console.log(out.replace(/^/gm, "  | "));
  }
  const notRun = run.slice(i + 1);
  console.log(
    `\ncheck: ${i}/${run.length} gates passed — FAIL ${gate}` +
      (notRun.length ? `; not run: ${notRun.join(", ")}` : "")
  );
  process.exit(1);
}

console.log(`\ncheck: ${run.length}/${run.length} gates passed`);
