#!/usr/bin/env node
/**
 * Inline the budget guard and push handler into the generated worker so one
 * update check is one request. Fails the build if the guard is not first.
 */
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const SW = "dist/sw.js";
const BUDGET = "public/sw-budget.js";
const PUSH = "public/sw-push.js";
const MARKER = "mabi-sw-inline";

if (!fs.existsSync(SW)) throw new Error(`sw inline: ${SW} is missing (run vite build first)`);
const budget = fs.readFileSync(BUDGET, "utf8");
const push = fs.readFileSync(PUSH, "utf8");
let sw = fs.readFileSync(SW, "utf8");

if (sw.includes(MARKER)) {
  console.log("sw inline: already inlined, nothing to do");
  process.exit(0);
}

for (const old of [
  'importScripts("/sw-budget.js")',
  'importScripts("/sw-push.js")',
  'importScripts("/workbox-',
]) {
  if (sw.includes(old)) throw new Error(`sw inline: generated worker still contains ${old}`);
}

sw = `/* ${MARKER} */\n${budget}\n${push}\n${sw}`;

const firstRoute = sw.indexOf("registerRoute(");
const guardAt = sw.indexOf("mabi-budget-trip");
const pushAt = sw.indexOf('self.addEventListener("push"');
if (firstRoute < 0) throw new Error("sw inline: generated worker has no registerRoute call");
if (guardAt < 0 || guardAt > firstRoute) throw new Error("sw inline: budget guard is missing or after the first route");
if (pushAt < 0) throw new Error("sw inline: push handler is missing");

fs.writeFileSync(SW, sw, "utf8");
execFileSync(process.execPath, ["--check", SW], { stdio: "inherit" });
console.log(`sw inline: one worker, ${fs.statSync(SW).size} bytes`);
