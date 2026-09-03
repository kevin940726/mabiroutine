#!/usr/bin/env node
/**
 * Agent pre-push gate for storage migrations.
 * Bundles scripts/migration-check.entry.ts (real migratePersisted from src)
 * with esbuild and runs the fixture assertions in node.
 * Usage: pnpm test:migrations (or pnpm check for lint + migrations + build)
 */
import { buildSync } from "esbuild";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const outFile = path.resolve("node_modules/.cache/migration-check.mjs"); // gitignored via node_modules
fs.mkdirSync(path.dirname(outFile), { recursive: true });
buildSync({
  entryPoints: ["scripts/migration-check.entry.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: outFile,
  alias: { "@": "./src" },
  logLevel: "error",
});
execFileSync(process.execPath, [outFile], { stdio: "inherit" });
