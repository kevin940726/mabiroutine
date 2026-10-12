#!/usr/bin/env node
/**
 * Worker gate, in two halves: `wrangler deploy --dry-run` over the Cloudflare
 * Worker, then the POST /hooks/vercel contract (the Vercel → Discord relay)
 * exercised against the emitted bundle.
 * Usage: pnpm test:worker (also inside the pnpm check gate).
 *
 * Why the bundle half exists, measured on 2026-10-12: the Worker imports
 * client modules from `src/lib/` by RELATIVE path (`purpleHole`,
 * `hourlyReminders`, `reset`) to share the schedule math and Taipei helpers. A
 * relative import resolves in wrangler; an ALIASED one (`@/lib/net`) does not,
 * and neither does a DOM-only dependency. Adding `import { netFetch } from
 * "@/lib/net"` to `purpleHole.ts` (an otherwise fine, lint-clean,
 * `pnpm check`-green change) broke the Worker bundle, and nothing in
 * `pnpm check` noticed: the Worker has no tsconfig, so `tsc -b` never sees it,
 * and wrangler bundles with esbuild, which does not type-check. It was found by
 * running the dry run by hand.
 *
 * So the gate runs the real bundler. It uploads nothing (--dry-run), needs no
 * auth, and fails on exactly what a deploy would fail on: unresolvable imports,
 * syntax errors, missing files. `import type` from an alias is fine and stays
 * fine — esbuild strips type-only imports before resolution — which is why
 * `hourlyReminders.ts` may keep its `import type { Task } from "@/lib/types"`.
 *
 * The hook half imports the emitted bundle (a real ES module) and asserts the
 * relay's security and message contract: a signature that does not match, or a
 * body swapped after signing, is rejected before any delivery; delivery goes to
 * DISCORD_WEBHOOK_URL once, with no accidental @everyone; a Discord failure
 * answers 502 so Vercel retries. Cloudflare-only APIs would not run in node,
 * which is why the relay's digest compare is a local XOR rather than
 * `crypto.subtle.timingSafeEqual` — that choice is what makes it testable here.
 *
 * Run it after touching `workers/` or any `src/lib` module the Worker imports.
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// node_modules is gitignored, so the dry-run output never lands in the tree.
const outdir = path.resolve("node_modules/.cache/worker-dry-run");
fs.rmSync(outdir, { recursive: true, force: true });

// Spawn wrangler through node, not through a shell: on Windows a `.cmd` shim
// cannot be spawned without one, and `pnpm exec` would add a second layer of
// quoting for no gain.
const wranglerBin = path.resolve("node_modules/wrangler/bin/wrangler.js");
if (!fs.existsSync(wranglerBin)) {
  console.log(`FAIL: ${wranglerBin} is missing — run \`pnpm install\`, or wrangler moved its bin (check its "bin" field).`);
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

// ---- the POST /hooks/vercel contract ---------------------------------------
const realLog = console.log;
const workerLogs = [];
// The bundle logs what it did; collect that instead of mixing it into the gate's
// own ok/FAIL lines, and surface it only when a check fails.
console.log = (...args) => workerLogs.push(args.map(String).join(" "));
const failures = [];
const check = (ok, label) => {
  realLog(`  ${ok ? "ok" : "FAIL"}: ${label}`);
  if (!ok) failures.push(label);
};

const bundle = path.join(outdir, "index.js");
if (!fs.existsSync(bundle)) {
  console.log(`FAIL: the dry run emitted no ${bundle}; the hook contract cannot be checked.`);
  process.exit(1);
}
// Copied to .mjs so node imports it as ESM whatever package.json says.
const esm = path.join(outdir, "hook-gate.mjs");
fs.copyFileSync(bundle, esm);
const mod = await import(pathToFileURL(esm).href);

const secret = "whsec_gate_secret";
const alertsSecret = "whsec_gate_alerts";
const hookEnv = {
  VERCEL_ACCOUNT_WEBHOOK_SECRET: secret,
  VERCEL_ALERTS_WEBHOOK_SECRET: alertsSecret,
  DISCORD_WEBHOOK_URL: "https://discord.test/api/webhooks/1/gate",
};
const signWith = (s, body) => crypto.createHmac("sha1", s).update(body).digest("hex");
const sign = (body) => signWith(secret, body);

// What the handler would POST to Discord, with the network stubbed out.
const messages = [];
let discordStatus = 204;
globalThis.fetch = async (_url, init) => {
  messages.push(JSON.parse(init.body));
  return new Response(null, { status: discordStatus });
};
const call = (body, headers, env = hookEnv) =>
  mod.default.fetch(
    new Request("https://worker.test/hooks/vercel", { method: "POST", headers, body }),
    env
  );
const lastMsg = () => messages[messages.length - 1] ?? {};
const lastContent = () => lastMsg().content ?? "";

check(
  (await mod.vercelSignatureHex(secret, new Uint8Array(Buffer.from("hello")))) ===
    crypto.createHmac("sha1", secret).update("hello").digest("hex"),
  "the signature helper matches a node HMAC-SHA1 of the same bytes"
);
const digest = sign(Buffer.from("hello"));
const flipped = digest.slice(0, -1) + (digest.endsWith("0") ? "1" : "0");
check(
  mod.constantTimeEqual(digest, digest) && !mod.constantTimeEqual(digest, flipped),
  "the digest compare accepts the match and rejects a one-character difference"
);

const deployBody = Buffer.from(
  JSON.stringify({
    type: "deployment.succeeded",
    payload: {
      target: "production",
      links: { deployment: "https://vercel.com/example-team/sample-app/abc123" },
      deployment: {
        name: "mabiroutine",
        meta: { githubCommitSha: "5a8102abcdef", githubCommitMessage: "chore: date the changelog\n\nbody text" },
      },
    },
  })
);
const okRes = await call(deployBody, { "x-vercel-signature": sign(deployBody) });
const deployMsg = messages[0]?.content ?? "";
check(
  okRes.status === 200 &&
    messages.length === 1 &&
    deployMsg.includes("mabiroutine") &&
    deployMsg.includes("`5a8102a`") &&
    deployMsg.includes("vercel.com/example-team/sample-app/abc123") &&
    messages[0]?.allowed_mentions?.parse?.length === 0,
  "a signed deploy event posts one Discord message with the commit and inspector link, no mentions"
);
check(!deployMsg.includes("undefined"), "the deploy message never prints the string undefined");

const wrongRes = await call(deployBody, { "x-vercel-signature": "0".repeat(40) });
const swappedBody = Buffer.from(JSON.stringify({ type: "deployment.error", payload: {} }));
const swappedRes = await call(swappedBody, { "x-vercel-signature": sign(deployBody) });
check(
  wrongRes.status === 401 && swappedRes.status === 401 && messages.length === 1,
  "a wrong signature, or a body swapped after signing, is 401 and sends nothing"
);

// The two dashboard webhooks each have their own secret, so a request signed
// with either configured one is accepted, and a third secret is not.
const viaAlerts = await call(deployBody, { "x-vercel-signature": signWith(alertsSecret, deployBody) });
const viaOther = await call(deployBody, { "x-vercel-signature": signWith("whsec_someone_else", deployBody) });
check(
  viaAlerts.status === 200 && viaOther.status === 401 && messages.length === 2,
  "either configured webhook secret is accepted, a third one is not"
);
const alertsOnlyEnv = {
  VERCEL_ALERTS_WEBHOOK_SECRET: alertsSecret,
  DISCORD_WEBHOOK_URL: hookEnv.DISCORD_WEBHOOK_URL,
};
const alertsOnly = await call(deployBody, { "x-vercel-signature": signWith(alertsSecret, deployBody) }, alertsOnlyEnv);
check(alertsOnly.status === 200, "one secret alone is enough, so either webhook can be wired first");

const alertBody = Buffer.from(
  JSON.stringify({
    type: "alerts.triggered",
    payload: {
      severity: "high",
      projectSlug: "mabiroutine",
      links: { observability: "https://vercel.com/example-team/observability/alert/1" },
      alerts: [{ title: "Edge Requests", metric: "edge_requests", count: 312440, average: 8120.4, zscore: 41.2, unit: "requests" }],
    },
  })
);
await call(alertBody, { "x-vercel-signature": sign(alertBody) });
const alertMsg = lastContent();
check(
  alertMsg.includes("high") &&
    alertMsg.includes("Edge Requests") &&
    alertMsg.includes("312,440 requests") &&
    alertMsg.includes("vercel.com/example-team/observability/alert/1") &&
    !alertMsg.includes("undefined"),
  "an alert event posts severity, the count with its unit, and the observability link"
);

const sparseBody = Buffer.from(JSON.stringify({ type: "deployment.error", payload: {} }));
await call(sparseBody, { "x-vercel-signature": sign(sparseBody) });
check(
  lastContent().startsWith("🔴") && !lastContent().includes("undefined"),
  "a deploy payload with no meta still formats instead of printing undefined"
);

const beforeSkip = messages.length;
const unknownBody = Buffer.from(JSON.stringify({ type: "project.created", payload: {} }));
const unknownRes = await call(unknownBody, { "x-vercel-signature": sign(unknownBody) });
check(
  unknownRes.status === 200 && messages.length === beforeSkip,
  "an event with no formatter is skipped, not guessed at"
);

discordStatus = 500;
const retryRes = await call(deployBody, { "x-vercel-signature": sign(deployBody) });
check(retryRes.status === 502, "a Discord failure answers 502 so Vercel retries the delivery instead of losing it");
discordStatus = 204;

// Pre-parse guards: nothing here reaches Discord.
const emptyRes = await call(Buffer.alloc(0), {});
const bigRes = await call(Buffer.alloc(70 * 1024, 0x61), {});
check(
  emptyRes.status === 400 && bigRes.status === 413,
  "an empty body is 400 and an oversize body is 413 before any parsing"
);
const noTypeBody = Buffer.from(JSON.stringify({ payload: {} }));
const noTypeRes = await call(noTypeBody, { "x-vercel-signature": sign(noTypeBody) });
check(noTypeRes.status === 400, "a signed body without an event type is 400");

// The email half: Cloudflare Email Routing calls email(), not fetch(), with a
// raw MIME stream and a Headers object.
const streamOf = (s) =>
  new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode(s));
      c.close();
    },
  });
const forwards = [];
const mail = (subject, body, opts = {}) => ({
  from: opts.from ?? "notifications@vercel.com",
  to: "relay@example.com",
  headers: new Headers({ subject }),
  raw: streamOf(body),
  canBeForwarded: true,
  forward: async (rcpt) => {
    if (opts.forwardThrows) throw new Error("destination not verified");
    forwards.push(rcpt);
  },
});
const mailEnv = { ...hookEnv, EMAIL_FORWARD_TO: "mailbox@example.com" };

await mod.default.email(
  mail(
    "Deployment failed for mabiroutine",
    '<p>See <a href="https://vercel.com/example-team/sample-app/deployments/abc?utm=1">the deployment</a>.</p><img src="https://vercel.com/px.gif">'
  ),
  mailEnv
);
const mailMsg = lastContent();
check(
  mailMsg.includes("Deployment failed for mabiroutine") &&
    mailMsg.includes("https://vercel.com/example-team/sample-app/deployments/abc?utm=1") &&
    forwards[0] === "mailbox@example.com",
  "a routed mail posts its subject and Vercel links, and keeps a mailbox copy when asked"
);

const encodedSubject = `=?UTF-8?B?${Buffer.from("部署失敗", "utf8").toString("base64")}?=`;
await mod.default.email(mail(encodedSubject, "<p>no links here</p>"), { ...hookEnv, EMAIL_FORWARD_TO: undefined });
const decodedMsg = lastContent();
check(
  decodedMsg.includes("部署失敗") && !decodedMsg.includes("undefined") && forwards.length === 1,
  "an encoded subject is decoded, and a mail without EMAIL_FORWARD_TO is not forwarded"
);

const qSubject = "=?UTF-8?Q?=E9=83=A8=E7=BD=B2=E5=A4=B1=E6=95=97?=";
await mod.default.email(mail(qSubject, "<p>x</p>"), { ...hookEnv, EMAIL_FORWARD_TO: undefined });
check(lastContent().includes("部署失敗"), "a Q-encoded subject decodes");

const splitSubject = `=?UTF-8?B?${Buffer.from("部署", "utf8").toString("base64")}?= =?UTF-8?B?${Buffer.from("失敗", "utf8").toString("base64")}?=`;
await mod.default.email(mail(splitSubject, "<p>x</p>"), { ...hookEnv, EMAIL_FORWARD_TO: undefined });
check(lastContent().includes("部署失敗"), "adjacent encoded words join without the separating space");

await mod.default.email(mail("no vercel links", '<a href="https://example.com/thing">x</a>'), {
  ...hookEnv,
  EMAIL_FORWARD_TO: undefined,
});
check(
  lastContent().includes("https://example.com/thing"),
  "links fall back to non-Vercel ones when the mail carries none of ours"
);

let forwardThrew = false;
const beforeForwardFail = messages.length;
try {
  await mod.default.email(mail("forward fails", "<p>x</p>", { forwardThrows: true }), mailEnv);
} catch {
  forwardThrew = true;
}
check(
  !forwardThrew && messages.length === beforeForwardFail + 1,
  "a failing forward still posts the alert instead of aborting the handler"
);

const longLinks = Array.from({ length: 6 }, (_, i) => `https://vercel.com/track/${i}?${"x".repeat(400)}`).join(" ");
await mod.default.email(mail("long links", `<p>${longLinks}</p>`), { ...hookEnv, EMAIL_FORWARD_TO: undefined });
const clippedMsg = lastContent();
check(
  clippedMsg.length <= 1900 && clippedMsg.endsWith("…"),
  "an oversized message is clipped instead of being rejected by Discord"
);

const beforeNoDiscord = messages.length;
await mod.default.email(mail("quiet", "x"), {});
check(messages.length === beforeNoDiscord, "a mail with no DISCORD_WEBHOOK_URL posts nothing instead of throwing");

// A transport failure (not an HTTP error) must not escape either handler.
const beforeTransport = messages.length;
const stubbedFetch = globalThis.fetch;
globalThis.fetch = async () => {
  throw new Error("egress down");
};
const thrownHook = await call(deployBody, { "x-vercel-signature": sign(deployBody) });
let emailThrew = false;
try {
  await mod.default.email(mail("transport failure", "<p>x</p>"), { ...hookEnv, EMAIL_FORWARD_TO: undefined });
} catch {
  emailThrew = true;
}
globalThis.fetch = stubbedFetch;
check(
  thrownHook.status === 502 && !emailThrew && messages.length === beforeTransport,
  "a thrown fetch answers 502 on the hook path and is logged, not thrown, on the email path"
);

const unconfigured = await call(deployBody, { "x-vercel-signature": sign(deployBody) }, {});
check(unconfigured.status === 503, "a Worker without the secrets answers 503 rather than silently dropping events");

if (failures.length) {
  console.log = realLog;
  for (const line of workerLogs) console.log(`  worker: ${line}`);
  console.log(`FAIL: the /hooks/vercel contract broke (${failures.length}):`);
  for (const f of failures) console.log(`- ${f}`);
  process.exit(1);
}
console.log = realLog;
console.log("ok: the /hooks/vercel relay verifies signatures and formats both event streams");
