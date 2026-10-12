#!/usr/bin/env node
/**
 * Art-fallback gate. Four rules about the failure path of art loads —
 * `/items/<name>.webp` and `/npc/<name>.webp`, which are resolved by request, so
 * a miss is discovered by the load failing. Scans `src/`, `api/` and `workers/`
 * (everything that ships or renders app code); `scripts/` is excluded because
 * checking is not shipping. Generated `.wrangler` state is skipped.
 * Usage: pnpm test:fallbacks (also inside the pnpm check gate).
 *
 * Why this exists: on 2026-10-12 the team was paused for exhausting the Hobby
 * plan's 1M/month Edge Requests. The trigger was a deploy that renamed the NPC
 * portraits to WebP, which DELETED `/npc/placeholder.png` — the URL
 * `TaskRow`'s desktop portraits assigned from `onError`. A reassignment to a
 * missing URL re-enters the same handler, so each portrait looped at whatever
 * rate the RTT allows: measured in Chromium with the RTT simulated, 161 loads
 * in 10s at 50ms and 64 in 10s at 150ms, from ONE image, with no cap. One image
 * over the 13.5 hours between that deploy and the pause is 300k-800k requests.
 *
 * The lesson is not "don't rename art" (renames are fine) but "a failing art
 * load must be TERMINAL": render a designed fallback from state and never
 * assign `src` from an error handler. `ArtImg`, `NpcFace` and `ItemIcon` are
 * the three shapes that do this; `docs/item-icons.md` § The fallback rule is
 * the prose version. This gate is what keeps the rule true, because the loop is
 * invisible in review (the old code looks like an ordinary fallback) and
 * invisible in tests (nothing asserts a request count).
 *
 * No bundling: these are text and filesystem checks, not src imports.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

let bad = 0;
const ok = (msg) => console.log(`ok: ${msg}`);
const fail = (msg) => {
  bad += 1;
  console.log(`FAIL: ${msg}`);
};
const lineOf = (text, index) => text.slice(0, index).split("\n").length;

const ROOTS = ["src", "api", "workers"];
const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.name === ".wrangler") return [];
    return e.isDirectory() ? walk(p) : [p];
  });
const appFiles = ROOTS.flatMap((root) => (fs.existsSync(root) ? walk(root) : [])).filter((f) =>
  /\.(tsx?|jsx?)$/.test(f)
);
const exists = (publicPath) => fs.existsSync(path.join("public", decodeURIComponent(publicPath)));

// --- R1: nothing assigns `src` -----------------------------------------------
// The loop needs an assignment that can fail again. This bans the assignment
// outright rather than only inside an `onError` because the two can sit in
// different files (a handler calling a helper that swaps the URL) and because
// the app has no legitimate need for one: an image URL belongs to a render,
// where React owns the swap. `ArtImg` (and the latched fallbacks in `NpcFace`
// and `ItemIcon`) is the shape to use instead. Nothing outside scripts/ assigns
// a `src` today, so this rule costs nothing to keep.
const ASSIGN = /\.src\s*=|setAttribute\(\s*["']src["']/g;
const assignments = [];
for (const file of appFiles) {
  const text = fs.readFileSync(file, "utf8");
  for (const m of text.matchAll(ASSIGN)) {
    assignments.push(
      `${file}:${lineOf(text, m.index)} assigns \`src\` — an assignment to a URL that can be missing is an unbounded ` +
        `retry (2026-10-12: 1M edge requests in 13.5h). Render the swap from state instead (\`ArtImg\`).`
    );
  }
}
if (assignments.length) assignments.forEach(fail);
else ok(`no \`src\` assignment anywhere in ${appFiles.length} files under ${ROOTS.join("/, ")}/`);

// --- R2: every NPC name the data names has a portrait ------------------------
// The fallback is only reached when a lookup MISSES, so a data name without art
// is the state that starts the walk down the fallback. Every NPC name in the
// app comes from `shops.json` (`task.npc` on a barter or shop row is built from
// it in `src/lib/shops.ts`; `tracker.json` and `defaultPins.json` carry no NPC
// fields), so this covers the shipped data. Items get the same guarantee from
// `test:shops` (a scroll without its `icon` file) and `test:icons` (the emitted
// path per name shape).
const npcNames = new Set();
const npcOverrides = new Set();
const shops = JSON.parse(fs.readFileSync("src/data/shops.json", "utf8"));
for (const town of shops.towns ?? []) {
  for (const npc of town.npcs ?? []) {
    if (npc.name) npcNames.add(npc.name);
    if (npc.icon) npcOverrides.add(npc.icon);
  }
}
const missingArt = [...npcNames].filter((n) => !exists(`/npc/${n}.webp`));
if (missingArt.length) {
  fail(`shops.json names an NPC with no portrait: ${missingArt.join(", ")} (expected public/npc/<name>.webp)`);
} else {
  ok(`every one of the ${npcNames.size} NPC names in shops.json has a portrait`);
}
const missingOverride = [...npcOverrides].filter((p) => !exists(p.startsWith("/") ? p : `/${p}`));
if (missingOverride.length) {
  fail(`an NPC \`icon\` override points at a missing file: ${missingOverride.join(", ")}`);
} else {
  ok(`every NPC \`icon\` override (${npcOverrides.size}) resolves`);
}

// --- R3: hardcoded art literals must exist -----------------------------------
// Covers the fallback targets themselves (`/npc/placeholder.webp`), which are
// exactly the paths a rename can silently delete. Only complete filenames
// count: template literals and the `<name>` / `…` shapes comments use to
// describe a path are skipped (the former are data-driven and owned by R2 plus
// `test:icons`, the latter are prose).
const LITERAL = /(["'`])((?:\/npc\/|\/items\/)[^"'`\n]*)\1/g;
const badLiterals = [];
let literals = 0;
for (const file of appFiles) {
  const text = fs.readFileSync(file, "utf8");
  for (const m of text.matchAll(LITERAL)) {
    const p = m[2];
    if (/[<>$*{}\s]/.test(p) || p.includes("...") || !/\.(webp|png)$/i.test(p)) continue;
    literals += 1;
    if (!exists(p)) badLiterals.push(`${file}:${lineOf(text, m.index)} references ${p}, which is not in public/`);
  }
}
if (badLiterals.length) badLiterals.forEach(fail);
else ok(`all ${literals} hardcoded art filenames in ${ROOTS.join("/, ")}/ resolve to files`);

// --- R4: the pre-rename compat shim must stay, and must SHIP -----------------
// `/npc/placeholder.png` was deleted by the WebP rename while pre-rename
// clients were still falling back to it. It is kept as a shim so those clients
// land on 2 requests instead of looping. Tracked, not just present: an
// untracked file is left out of a commit by `git add -a`, so the deploy would
// serve nothing at that URL and the loop would survive the fix. Delete this
// rule (and the file) once no pre-rename client can be live; the pause that
// made it necessary is the 2026-10-12 changelog entry.
const SHIM = "public/npc/placeholder.png";
let tracked = null; // null: no git available to ask
try {
  execFileSync("git", ["ls-files", "--error-unmatch", SHIM], { stdio: "ignore" });
  tracked = true;
} catch (e) {
  tracked = e && e.code === "ENOENT" ? null : false;
}
if (!fs.existsSync(SHIM)) {
  fail(
    `${SHIM} is gone — pre-rename clients fall back to it, so its absence is an unbounded loop. ` +
      `Remove this rule deliberately (and this file) once no pre-rename client can be live.`
  );
} else if (tracked === false) {
  fail(`${SHIM} exists but is NOT tracked by git — an untracked file is left out of a commit, so the deploy would 404 ` +
    `the fallback and the loop would survive. Stage it (\`git add ${SHIM}\`).`);
} else {
  ok(`the ${SHIM} compat shim is in place${tracked ? " and tracked" : " (git unavailable, trackedness unchecked)"}`);
}

console.log(bad === 0 ? "art fallbacks: all pass" : `art fallbacks: ${bad} FAILED`);
process.exit(bad === 0 ? 0 : 1);
