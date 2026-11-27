#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { SEO_INPUTS } from "./seo-inputs.mjs";

const files = [...SEO_INPUTS, "scripts/check-seo.mjs", "scripts/seo-inputs.mjs"];
const assets = fs
  .readdirSync("public")
  .filter((f) => /\.(png|ico|svg)$/.test(f))
  .map((f) => "public/" + f);
const original = Object.fromEntries(files.map((f) => [f, fs.readFileSync(f, "utf8")]));
const originalBytes = Object.fromEntries(assets.map((f) => [f, fs.readFileSync(f)]));

let bad = 0;
const ok = (m) => console.log(`ok: ${m}`);
const fail = (m) => {
  bad += 1;
  console.log(`FAIL: ${m}`);
};

function runGate() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "seo-gate-"));
  try {
    for (const f of files) {
      const dest = path.join(tmp, f);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, original[f]);
    }
    for (const f of assets) {
      fs.writeFileSync(path.join(tmp, f), originalBytes[f]);
    }
    execFileSync(process.execPath, [path.join(tmp, "scripts/check-seo.mjs")], { cwd: tmp, stdio: "pipe" });
    return { code: 0, out: "" };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const cases = [
  ["robots shadows the noindex header", "public/robots.txt", (s) => s.replace(/^Allow: \/$/m, "Allow: /\nDisallow: /api/")],
  ["robots shadows a deeper noindex path", "vercel.json", (s) => s.replace('"/api/(.*)"', '"/(.*)"')],
  ["noindex source is not a path", "vercel.json", (s) => s.replace('"/api/(.*)"', '"api/(.*)"')],
  ["duplicate icon size", "index.html", (s) => s.replace('sizes="32x32" href="/favicon-32x32.png"', 'sizes="32x32" href="/favicon-32x32.png" /><link rel="icon" sizes="32x32" href="/favicon-16x16.png"')],
  ["192px rel=icon restored", "index.html", (s) => s.replace('sizes="32x32" href="/favicon-32x32.png"', 'sizes="32x32" href="/favicon-32x32.png" /><link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png"')],
  ["icon declared but missing", "index.html", (s) => s.replace('href="/favicon-32x32.png"', 'href="/favicon-32x32-missing.png"')],
  ["manifest precache removed", "vite.config.ts", (s) => s.replace(",webmanifest}", "}")],
  ["manifest icon missing", "public/manifest.webmanifest", (s) => s.replace('"/icon-192.png"', '"/icon-192-missing.png"')],
  ["manifest icon size lies", "public/manifest.webmanifest", (s) => s.replace('"sizes": "192x192"', '"sizes": "512x512"')],
  ["canonical removed", "index.html", (s) => s.replace(/<link rel="canonical"[^>]*>/, "")],
  ["verification tag removed", "index.html", (s) => s.replace(/<meta name="google-site-verification"[^>]*>/, "")],
  ["home page noindexed", "index.html", (s) => s.replace('content="index, follow, max-image-preview:large, max-snippet:-1"', 'content="noindex, follow"')],
  ["structured data broken", "index.html", (s) => s.replace('"@context": "https://schema.org",', '"@context": "https://schema.org",,')],
  ["Organization node restored", "index.html", (s) => s.replace('"@type": "WebSite",', '"@type": "WebSite", "logo": {"@type": "Organization", "name": "x"},')],
  ["keyword alternateName restored", "index.html", (s) => s.replace('"alternateName": ["mabiroutine.vercel.app"]', '"alternateName": ["MabiRoutine 瑪奇Mobile 日課追蹤器", "mabiroutine.vercel.app"]')],
  ["hidden h1 text restored", "src/App.tsx", (s) => s.replace(/\n(\s*)MabiRoutine\r?\n(\s*)<\/h1>/, '\n$1MabiRoutine\n$1<span className="sr-only"> — keyword tail</span>\n$2</h1>')],
  ["sitemap gains a future lastmod", "public/sitemap.xml", (s) => s.replace("</loc>", "</loc>\n    <lastmod>2099-01-01</lastmod>")],
  ["sitemap gains a tomorrow lastmod", "public/sitemap.xml", (s) => {
    const d = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    return s.replace("</loc>", `</loc>\n    <lastmod>${d}</lastmod>`);
  }],
  ["sitemap gains a malformed lastmod", "public/sitemap.xml", (s) => s.replace("</loc>", "</loc>\n    <lastmod>yesterday</lastmod>")],
  ["sitemap regains changefreq", "public/sitemap.xml", (s) => s.replace("  </url>", "    <changefreq>weekly</changefreq>\n  </url>")],
  ["sitemap regains priority", "public/sitemap.xml", (s) => s.replace("  </url>", "    <priority>1.0</priority>\n  </url>")],
  ["sitemap points elsewhere", "public/sitemap.xml", (s) => s.replace("https://mabiroutine.vercel.app/</loc>", "https://example.com/</loc>")],
  ["robots drops the sitemap line", "public/robots.txt", (s) => s.replace(/^Sitemap:.*$/m, "")],
];

const baseline = runGate();
if (baseline.code === 0) ok("baseline (unmodified tree) passes");
else fail(`baseline should pass, got ${baseline.code}\n${baseline.out}`);

for (const [label, file, mutate] of cases) {
  const before = original[file];
  const after = mutate(before);
  if (after === before) {
    fail(`${label}: the mutation did not change ${file} (stale test)`);
    continue;
  }
  original[file] = after;
  const r = runGate();
  original[file] = before;
  if (r.code === 0) fail(`${label}: gate stayed green`);
  else ok(`${label}: gate failed as expected`);
}

console.log(bad === 0 ? `seo gate sabotage: all ${cases.length + 1} pass` : `seo gate sabotage: ${bad} FAILED`);
process.exit(bad === 0 ? 0 : 1);
