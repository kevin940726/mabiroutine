#!/usr/bin/env node
/**
 * Reminder display gate. Bundles scripts/check-reminders.entry.ts with esbuild
 * and runs the assertions in node; the entry also loads the real
 * public/sw-push.js in a `node:vm` realm (same pattern as check-budget.mjs).
 * Usage: pnpm test:reminders (also inside the pnpm check gate).
 *
 * What it pins: the same-slot re-alert suppression at the local↔server seam
 * (renotify false when the same tag + slot is already on screen), the slot math
 * both runtimes share, and every contract around it (previous-slot cards still
 * buzz, missing stamps and lookup failures fail open, skip paths unchanged).
 */
import { buildSync } from "esbuild";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const outFile = path.resolve("node_modules/.cache/check-reminders.mjs");
fs.mkdirSync(path.dirname(outFile), { recursive: true });
buildSync({
  entryPoints: ["scripts/check-reminders.entry.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: outFile,
  alias: { "@": "./src" },
  logLevel: "error",
});
execFileSync(process.execPath, [outFile], { stdio: "inherit" });
