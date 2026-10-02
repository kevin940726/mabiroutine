#!/usr/bin/env node
/**
 * Item-icon path gate. Bundles scripts/check-item-icons.entry.ts (the real
 * src/lib/itemIcon.ts) with esbuild and runs the assertions in node.
 * Usage: pnpm test:icons (also inside the pnpm check gate).
 *
 * Why this is a test and not just a comment: the `+` in the five `*+` item
 * names is spelled `%2B` in the URL and `+` on disk, and getting that backwards
 * is a SILENT miss — Vercel 404s the literal `+` while Vite answers its SPA
 * fallback with HTML at 200, so the icon just disappears with no error. It has
 * been flipped once already. Pinning the exact spelling makes the next flip loud.
 */
import { buildSync } from "esbuild";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const outFile = path.resolve("node_modules/.cache/check-item-icons.mjs"); // gitignored via node_modules
fs.mkdirSync(path.dirname(outFile), { recursive: true });
buildSync({
  entryPoints: ["scripts/check-item-icons.entry.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: outFile,
  alias: { "@": "./src" },
  logLevel: "error",
});
execFileSync(process.execPath, [outFile], { stdio: "inherit" });
