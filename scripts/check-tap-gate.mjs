#!/usr/bin/env node
import { buildSync } from "esbuild";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const outFile = path.resolve("node_modules/.cache/check-tap-gate.mjs");
fs.mkdirSync(path.dirname(outFile), { recursive: true });
buildSync({
  entryPoints: ["scripts/check-tap-gate.entry.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: outFile,
  alias: { "@": "./src" },
  logLevel: "error",
});
execFileSync(process.execPath, [outFile], { stdio: "inherit" });

const WRITES = ["setCounter(", "incCounter(", "toggleCheck(", "recordGoalRound(", "celebrateAfterWrite(", "setV(", "incV(", "decV(", "toggleGroup("];
const POINTER = ["onPointerDown", "onPointerUp", "onMouseDown", "onMouseUp", "onTouchStart", "onTouchEnd"];
const ROOTS = ["src/components", "src/hooks"];

const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name).split(path.sep).join("/");
    if (entry.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(p);
  }
  return out;
};

const blocks = (src, names) => {
  const lines = src.split("\n");
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    const handler = names.find((name) => new RegExp(`(^|[\\s{])${name}\\s*[:=]`).test(lines[i]));
    if (!handler) continue;
    let depth = 0;
    let started = false;
    let text = "";
    for (let j = i; j < Math.min(lines.length, i + 120); j++) {
      text += `${lines[j]}\n`;
      for (const ch of lines[j]) {
        if (ch === "{") {
          depth += 1;
          started = true;
        } else if (ch === "}") depth -= 1;
      }
      if (started && depth <= 0) {
        found.push({ line: i + 1, handler, text });
        break;
      }
    }
  }
  return found;
};

let scanBad = 0;
const scanFail = (msg) => {
  scanBad += 1;
  console.log(`FAIL: ${msg}`);
};

const files = ROOTS.flatMap((root) => walk(root));
for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  for (const block of blocks(src, POINTER)) {
    const wrote = WRITES.filter((token) => block.text.includes(token));
    if (wrote.length) {
      scanFail(
        `${file}:${block.line} ${block.handler} writes progress (${wrote.join(", ")}) — a pointer release can reflow the list before the gesture's own click, so a tile writes on its click or through useGrabCounter`
      );
    }
  }
  for (const block of blocks(src, ["onClick"])) {
    const wrote = WRITES.filter((token) => block.text.includes(token));
    if (wrote.length && !block.text.includes("ownsClick(")) {
      scanFail(
        `${file}:${block.line} onClick writes progress (${wrote.join(", ")}) with no ownsClick guard — a click the browser synthesized for a tap that ended elsewhere must not write`
      );
    }
  }
}

console.log(
  scanBad === 0
    ? `tap gate: ${files.length} UI files scanned, every completion write is gated`
    : `tap gate: ${scanBad} source violation(s)`
);
process.exit(scanBad === 0 ? 0 : 1);
