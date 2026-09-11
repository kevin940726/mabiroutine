#!/usr/bin/env node
/**
 * shops.json gate (shape + currency + dup + no-trade-routes-in-recipes).
 * Bundles scripts/check-shops.entry.ts (real recipes/shops data) with
 * esbuild and runs the assertions in node.
 * Usage: pnpm test:shops (after touching recipes.json, shops.json, or
 * barter.json; in the pnpm check gate since 2026-09-12).
 */
import { buildSync } from "esbuild";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const outFile = path.resolve("node_modules/.cache/check-shops.mjs"); // gitignored via node_modules
fs.mkdirSync(path.dirname(outFile), { recursive: true });
buildSync({
  entryPoints: ["scripts/check-shops.entry.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: outFile,
  alias: { "@": "./src" },
  logLevel: "error",
});
execFileSync(process.execPath, [outFile], { stdio: "inherit" });
