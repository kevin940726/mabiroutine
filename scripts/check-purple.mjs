#!/usr/bin/env node
/**
 * Purple-hole schedule gate. Bundles scripts/check-purple.entry.ts (the real
 * src/lib/purpleHole.ts) with esbuild and runs the assertions in node.
 * Usage: pnpm test:purple (also inside the pnpm check gate).
 */
import { buildSync } from "esbuild";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const outFile = path.resolve("node_modules/.cache/check-purple.mjs");
fs.mkdirSync(path.dirname(outFile), { recursive: true });
buildSync({
  entryPoints: ["scripts/check-purple.entry.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: outFile,
  alias: { "@": "./src" },
  logLevel: "error",
});
execFileSync(process.execPath, [outFile], { stdio: "inherit" });
