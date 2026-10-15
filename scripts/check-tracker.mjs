#!/usr/bin/env node
/**
 * tracker.json gate (row shape + max rules + sub-task link integrity).
 * Bundles scripts/check-tracker.entry.ts (real tracker.json) with esbuild and
 * runs the assertions in node.
 * Usage: pnpm test:tracker (after touching tracker.json; in the pnpm check gate
 * since the weekly-goals sub-task feature shipped).
 */
import { buildSync } from "esbuild";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const outFile = path.resolve("node_modules/.cache/check-tracker.mjs"); // gitignored via node_modules
fs.mkdirSync(path.dirname(outFile), { recursive: true });
buildSync({
  entryPoints: ["scripts/check-tracker.entry.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: outFile,
  alias: { "@": "./src" },
  logLevel: "error",
});
execFileSync(process.execPath, [outFile], { stdio: "inherit" });
