#!/usr/bin/env node
/**
 * Worker bundle gate: `wrangler deploy --dry-run` over the Cloudflare Worker.
 * Usage: pnpm test:worker (also inside the pnpm check gate).
 *
 * Why this exists, measured on 2026-10-12: the Worker imports client modules
 * from `src/lib/` by RELATIVE path (`purpleHole`, `hourlyReminders`, `reset`)
 * to share the schedule math and Taipei helpers. A relative import resolves in
 * wrangler; an ALIASED one (`@/lib/net`) does not, and neither does a DOM-only
 * dependency. Adding `import { netFetch } from "@/lib/net"` to `purpleHole.ts`
 * (an otherwise fine, lint-clean, `pnpm check`-green change) broke the Worker
 * bundle, and nothing in `pnpm check` noticed: the Worker has no tsconfig, so
 * `tsc -b` never sees it, and wrangler bundles with esbuild, which does not
 * type-check. It was found by running the dry run by hand.
 *
 * So the gate runs the real bundler. It uploads nothing (--dry-run), needs no
 * auth, and fails on exactly what a deploy would fail on: unresolvable imports,
 * syntax errors, missing files. `import type` from an alias is fine and stays
 * fine — esbuild strips type-only imports before resolution — which is why
 * `hourlyReminders.ts` may keep its `import type { Task } from "@/lib/types"`.
 *
 * Run it after touching `workers/` or any `src/lib` module the Worker imports.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// node_modules is gitignored, so the dry-run output never lands in the tree.
const outdir = path.resolve("node_modules/.cache/worker-dry-run");
fs.rmSync(outdir, { recursive: true, force: true });

// Spawn wrangler through node, not through a shell: on Windows a `.cmd` shim
// cannot be spawned without one, and `pnpm exec` would add a second layer of
// quoting for no gain.
const wranglerBin = path.resolve("node_modules/wrangler/bin/wrangler.js");
if (!fs.existsSync(wranglerBin)) {
  console.log(`FAIL: ${wranglerBin} is missing — run \`pnpm install\` first.`);
  process.exit(1);
}
try {
  const out = execFileSync(
    process.execPath,
    [
      wranglerBin,
      "deploy",
      "--dry-run",
      "--config",
      "workers/mabiroutine-worker/wrangler.jsonc",
      "--outdir",
      outdir,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  const summary = out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /Total Upload|gzip/i.test(l))
    .slice(0, 2);
  console.log(`ok: the worker bundles cleanly${summary.length ? ` (${summary.join(" · ")})` : ""}`);
} catch (e) {
  const detail = `${e.stdout ?? ""}\n${e.stderr ?? ""}\n${e.message ?? ""}`.trim();
  console.log("FAIL: wrangler could not bundle the worker. A relative import from");
  console.log("src/lib resolves; an aliased (@/) runtime import or a DOM-only import does not.");
  console.log(
    detail
      .split("\n")
      .filter((l) => l.trim())
      .slice(-14)
      .join("\n")
  );
  process.exit(1);
}
