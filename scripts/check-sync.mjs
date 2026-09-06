#!/usr/bin/env node
/**
 * Sync regression gate: every suite that guards the sync engine.
 * Hermetic suites always run (real store/flat/session code, stubbed
 * storage/server — no network). Live suites SKIP loudly when their
 * dependency (dev:api on :52608, Edge) is absent, so `pnpm check`
 * stays green offline.
 *
 * Suites:
 *  engine     T3–T6 syncAndResets scenarios (suppression, propagation,
 *             adopt/import stamping, resetAll) — the retention-critical path
 *  prop-reset 300 randomized checkResets key-collection exactness runs
 *  tabs       T1 stale-tab tombstones + T2 cap-overflow (vm-realm tabs,
 *             real flat.ts — fails on pre-fix code, see docs/sync.md)
 *  api-live   dev-API concurrency/upgrades/failure paths (needs dev:api)
 *  browser    real-Edge two-context E2E (needs dev:api + Edge)
 *
 * Usage: pnpm test:sync [--skip-live]
 */
import { buildSync } from "esbuild";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const skipLive = process.argv.includes("--skip-live");
const cache = path.resolve("node_modules/.cache/sync-tests"); // gitignored
fs.mkdirSync(cache, { recursive: true });

let failures = 0;
function section(name) {
  console.log(`\n=== sync-tests: ${name} ===`);
}
function run(file, args = []) {
  const r = spawnSync(process.execPath, [file, ...args], { stdio: "inherit" });
  if (r.status !== 0) {
    failures += 1;
    console.log(`--- ${path.basename(file)} FAILED ---`);
  }
}

// engine (T3–T6): bundle worktree entry, run
{
  section("engine (suppression / propagation / adopt / resetAll)");
  const out = path.join(cache, "engine.mjs");
  buildSync({
    entryPoints: ["scripts/sync-tests/engine.entry.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: out,
    alias: { "@": "./src" },
    logLevel: "error",
  });
  run(out);
}

// prop-reset: randomized key-collection exactness
{
  section("prop-reset (300 randomized checkResets runs)");
  const out = path.join(cache, "prop-reset.mjs");
  buildSync({
    entryPoints: ["scripts/sync-tests/prop-reset.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: out,
    alias: { "@": "./src" },
    logLevel: "error",
  });
  run(out);
}

// tabs (T1 stale-tab, T2 cap): bundle worktree flat.ts, run vm realms
{
  section("tabs (stale-tab + cap-overflow, real flat.ts)");
  const flatBundle = path.join(cache, "flat.cjs");
  buildSync({
    entryPoints: ["src/sync/flat.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: flatBundle,
    alias: { "@": "./src" },
    logLevel: "error",
  });
  run("scripts/sync-tests/tabs.cjs", [flatBundle, "worktree"]);
}

// live suites (skip-loud when deps absent)
if (!skipLive) {
  section("api-live (dev API)");
  run("scripts/sync-tests/api-live.mjs");
  section("browser (real Edge E2E)");
  run("scripts/sync-tests/browser-e2e.mjs");
} else {
  console.log("\n(live suites skipped by --skip-live)");
}

console.log(failures === 0 ? "\nALL SYNC TESTS PASSED (or skipped live)" : `\n${failures} SYNC SUITE(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
