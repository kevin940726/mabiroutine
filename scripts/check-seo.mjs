#!/usr/bin/env node
import fs from "node:fs";
import { SEO_INPUTS } from "./seo-inputs.mjs";

let bad = 0;
const ok = (msg) => console.log(`ok: ${msg}`);
const fail = (msg) => {
  bad += 1;
  console.log(`FAIL: ${msg}`);
};
const eq = (actual, expected, msg) =>
  actual === expected ? ok(msg) : fail(`${msg} — got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);

const deepTypes = (value, found = new Set()) => {
  if (Array.isArray(value)) {
    for (const v of value) deepTypes(v, found);
  } else if (value && typeof value === "object") {
    const t = value["@type"];
    if (typeof t === "string") found.add(t);
    for (const v of Object.values(value)) deepTypes(v, found);
  }
  return found;
};

const pngSize = (file) => {
  const b = fs.readFileSync(file);
  if (b[0] !== 0x89 || b[1] !== 0x50) return null;
  return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`;
};

const SITE = "https://mabiroutine.vercel.app";
const html = fs.readFileSync("index.html", "utf8");
const head = html.slice(0, html.indexOf("<body"));
const robots = fs.readFileSync("public/robots.txt", "utf8");
const vercel = JSON.parse(fs.readFileSync("vercel.json", "utf8"));
const app = fs.readFileSync("src/App.tsx", "utf8");
const vite = fs.readFileSync("vite.config.ts", "utf8");

for (const f of SEO_INPUTS) {
  if (!fs.existsSync(f)) fail(`the gate reads ${f}, which is missing`);
}

const disallowRules = robots
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => /^Disallow:/i.test(l))
  .map((l) => l.replace(/^Disallow:/i, "").trim())
  .filter(Boolean);

const noindexSources = (vercel.headers ?? [])
  .filter((h) => (h.headers ?? []).some((x) => /^x-robots-tag$/i.test(x.key) && /noindex/i.test(x.value)))
  .map((h) => String(h.source ?? ""));

// A noindex response must stay fetchable: a crawler that robots.txt stops from
// fetching the response never reads the header, and reports the URL as blocked.
if (!noindexSources.length) {
  ok("vercel.json declares no noindex header (nothing to reconcile)");
}
for (const source of noindexSources) {
  if (!source.startsWith("/")) {
    fail(`vercel.json noindex source ${JSON.stringify(source)} is not a path, so it cannot be reconciled with robots.txt`);
    continue;
  }
  const p = source.replace(/\(\.\*\)$/, "").replace(/\/?$/, "/");
  const shadowed = disallowRules.find((d) => p.startsWith(d) || d.startsWith(p));
  if (shadowed) {
    fail(`robots.txt \`Disallow: ${shadowed}\` hides the \`noindex\` header on ${p} — drop the Disallow and let the header do the work`);
  } else {
    ok(`robots.txt leaves ${p} fetchable, so its noindex header can be read`);
  }
}

// The installed app's icon comes from the manifest, so the manifest is the
// file that must survive a launch with no network.
eq(/globPatterns:\s*\[[^\]]*webmanifest/.test(vite), true, "vite.config.ts precaches .webmanifest files");
const manifestFile = "public/manifest.webmanifest";
eq(fs.existsSync(manifestFile), true, `${manifestFile} exists`);
let manifest = null;
try {
  manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  ok("manifest.webmanifest parses as JSON");
} catch (e) {
  fail(`manifest.webmanifest does not parse: ${e.message}`);
}
if (manifest) {
  const icons = manifest.icons ?? [];
  eq(icons.length > 0, true, "the manifest declares icons");
  eq(icons.some((i) => String(i.purpose ?? "").includes("maskable")), true, "the manifest declares a maskable icon");
  for (const icon of icons) {
    const file = "public" + String(icon.src ?? "");
    if (!icon.src || !fs.existsSync(file)) {
      fail(`${manifestFile} names ${JSON.stringify(icon.src)} but it is not in public/`);
      continue;
    }
    eq(pngSize(file), String(icon.sizes ?? ""), `${icon.src} is ${icon.sizes} as declared`);
  }
}

const iconLinks = [...head.matchAll(/<link\b[^>]*>/g)]
  .map((m) => m[0])
  .filter((l) => /rel="(?:icon|shortcut icon|apple-touch-icon)"/.test(l));
const relOf = (l) => (/rel="([^"]+)"/.exec(l) ?? [])[1] ?? "";
const sizeOf = (l) => /sizes="([^"]+)"/.exec(l)?.[1];
const relIcons = iconLinks.filter((l) => relOf(l) !== "apple-touch-icon");
const declaredSizes = relIcons.map(sizeOf).filter(Boolean);

// The set is pinned: Google re-evaluates a changed favicon set and can drop the
// icon for days, so any change here is a decision, not an accident.
eq(declaredSizes.sort().join(","), "16x16,32x32", "the rel=icon size set stays at 16x16 and 32x32");
eq(relIcons.filter((l) => !sizeOf(l)).length <= 1, true, "at most one unsized rel=icon (the .ico)");
eq(iconLinks.filter((l) => relOf(l) === "apple-touch-icon").length <= 1, true, "at most one apple-touch-icon");
eq(iconLinks.length > 0, true, "the head declares at least one favicon");

for (const l of iconLinks) {
  const href = /href="([^"]+)"/.exec(l)?.[1];
  const file = "public" + href;
  if (!href || !fs.existsSync(file)) {
    fail(`${href} is declared as an icon but is not in public/`);
    continue;
  }
  if (/\.ico$/.test(href)) {
    const frames = fs.readFileSync(file).readUInt16LE(4);
    eq(frames > 0, true, `${href} carries ${frames} frames`);
    continue;
  }
  const real = pngSize(file);
  const claimed = sizeOf(l);
  if (claimed && /^\d+x\d+$/.test(claimed)) {
    eq(real, claimed, `${href} is ${real} as claimed`);
  } else {
    const [w, h] = String(real ?? "0x0").split("x").map(Number);
    eq(w === h && w >= 180, true, `${href} is a square at least 180px (${real})`);
  }
}

eq(/<link rel="canonical" href="([^"]+)"/.exec(head)?.[1], SITE + "/", "canonical points at the production origin");
const robotsMeta = /<meta name="robots" content="([^"]+)"/.exec(head)?.[1] ?? "";
eq(/\bindex\b/.test(robotsMeta), true, "the home page is indexable by meta robots");
eq(/\bnoindex\b/.test(robotsMeta), false, "the home page does not carry noindex");

const verification = /<meta name="google-site-verification" content="([^"]+)"/.exec(head)?.[1];
eq(typeof verification === "string" && verification.length >= 20, true, "the Search Console verification tag is present");

const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(head)?.[1];
if (!ld) {
  fail("the head carries no application/ld+json block");
} else {
  let parsed;
  try {
    parsed = JSON.parse(ld);
    ok("structured data parses as JSON");
  } catch (e) {
    fail(`structured data does not parse: ${e.message}`);
  }
  if (parsed) {
    const nodes = parsed["@graph"] ?? [parsed];
    const site = nodes.find((n) => n && n["@type"] === "WebSite");
    if (!site) {
      fail("structured data has no WebSite node (site names require one)");
    } else {
      eq(typeof site.name, "string", "WebSite.name is a string");
      eq(site.url, SITE + "/", "WebSite.url is the canonical home page");
      const alt = site.alternateName;
      if (alt === undefined) {
        ok("WebSite.alternateName is omitted");
      } else {
        // alternateName is a site-name fallback, not a keyword field.
        const list = Array.isArray(alt) ? alt : [alt];
        eq(list.every((a) => a === "mabiroutine.vercel.app"), true, "WebSite.alternateName carries only the bare hostname");
      }
      eq(deepTypes(nodes).has("Organization"), false, "no Organization node is declared (site names need only WebSite)");
    }
  }
}

// Hidden keyword text beside visible content is the shape Google's hidden-text
// policy targets. This reads the source the rendered <h1> comes from.
const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(app)?.[1] ?? "";
if (!h1) {
  fail("src/App.tsx has no <h1>");
} else {
  eq(/sr-only|hidden|aria-hidden/.test(h1), false, "the <h1> carries no visually hidden text");
}

const sitemap = fs.readFileSync("public/sitemap.xml", "utf8");
eq(/<changefreq>/.test(sitemap), false, "the sitemap omits changefreq (ignored by Google)");
eq(/<priority>/.test(sitemap), false, "the sitemap omits priority (ignored by Google)");
// Google reads lastmod only while it stays reliable, and a hand-maintained date
// goes stale on the next commit, so it is optional but must be a real past date.
const lastmod = /<lastmod>([^<]*)<\/lastmod>/.exec(sitemap)?.[1];
if (lastmod === undefined) {
  ok("the sitemap carries no lastmod");
} else {
  eq(/^\d{4}-\d{2}-\d{2}$/.test(lastmod), true, `lastmod ${lastmod} is a plain YYYY-MM-DD date`);
  eq(Number.isNaN(new Date(lastmod + "T00:00:00Z").getTime()), false, `lastmod ${lastmod} parses as a date`);
  eq(lastmod <= new Date().toISOString().slice(0, 10), true, `lastmod ${lastmod} is today or earlier`);
}
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
eq(locs.length > 0, true, `the sitemap lists ${locs.length} URL(s)`);
for (const loc of locs) {
  eq(loc.startsWith(SITE + "/"), true, `sitemap URL ${loc} uses the canonical origin`);
}

eq(robots.includes(`Sitemap: ${SITE}/sitemap.xml`), true, "robots.txt points at the sitemap");

console.log(bad === 0 ? "crawl metadata: all pass" : `crawl metadata: ${bad} FAILED`);
process.exit(bad === 0 ? 0 : 1);
