// mabiroutine-worker: push fanout + purple schedule feed + watcher + admin.
// Full-worker fanout (verdict A, proven 2026-09-17): the hourly cron reads
// push_subscriptions straight from Turso and sends here — no Vercel fanout
// route exists. Timing/tag math is imported from the app source (one module,
// two runtimes — the lib is DOM-free, window refs guarded).
//
// Purple feed (phase 2B, live 2026-09-18): GET /purple-schedule serves the
// published KV doc (CORS *, 60s cache), hardcoded fallback when KV is empty
// or corrupt. The 2x/day watcher fetches the Bahamut maintenance search,
// regexes scheduled windows into KV candidates — never auto-truth. /admin
// (bearer ADMIN_SECRET) is the graduation editor: verify/state/publish/
// promote over the same KV docs. Purple server fanout rides the 15-min tick
// (unfiltered lane=purple subs, skip-past-spawns cutoff).
//
// Secrets (wrangler secret put, never committed): VAPID_JWK (app P-256 key,
// JWK JSON), VAPID_SUBJECT (mailto:/URL contact), TURSO_DB_URL (https),
// TURSO_AUTH_TOKEN (same token as Vercel; full-access — Turso issues no
// read-only tokens at our tier), ADMIN_SECRET (admin page bearer —
// sessionStorage in the browser, never committed). (SPIKE_SECRET + the
// temporary /spike-send + /fanout-test + /db-test routes died 2026-09-17
// with the proven fanout.)

import {
  CATCHUP_MIN_SEC,
  EVENT_SEC_PAST_HOUR,
  HOURLY_TAG,
  secIntoHour,
} from "../../../src/lib/hourlyReminders";
import {
  MAINTENANCE_WINDOWS,
  PURPLE_ANCHOR_MS,
  PURPLE_LEAD_MS,
  PURPLE_TAG,
  firstIndexAfter,
  normalizeWindows,
  nthOccurrence,
  parseScheduleDoc,
  validWindowsList,
  type MaintenanceWindow,
} from "../../../src/lib/purpleHole";

type Env = {
  PURPLE: KVNamespace;
  VAPID_JWK?: string;
  VAPID_SUBJECT?: string;
  TURSO_DB_URL?: string;
  TURSO_AUTH_TOKEN?: string;
  ADMIN_SECRET?: string;
};

type PushSubscriptionJson = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * VAPID Authorization header (RFC 8292): ES256 JWT over the push origin.
 * Signed once per origin per fanout run (the cache): every FCM sub shares
 * one JWT, Mozilla/Apple subs share theirs — a 1000-sub run signs ~3 times.
 */
async function vapidAuthHeader(
  endpoint: string,
  jwk: JsonWebKey,
  subject: string,
  cache?: Map<string, string>,
): Promise<string> {
  const u = new URL(endpoint);
  const aud = `${u.protocol}//${u.host}`;
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
  const te = new TextEncoder();
  const head = bytesToB64url(te.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = bytesToB64url(te.encode(JSON.stringify({ aud, exp, sub: subject })));
  const key = await crypto.subtle.importKey(
    "jwk",
    { ...jwk, key_ops: ["sign"], ext: true },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, te.encode(`${head}.${body}`)),
  );
  const pub = concat(new Uint8Array([4]), b64urlToBytes(jwk.x!), b64urlToBytes(jwk.y!));
  const header = `vapid t=${head}.${body}.${bytesToB64url(sig)}, k=${bytesToB64url(pub)}`;
  cache?.set(aud, header);
  return header;
}

/**
 * RFC 8188 aes128gcm body: salt || rs || idlen || server-pub || ciphertext.
 * HKDF(salt, IKM, info, L) in one WebCrypto deriveBits == the RFC's
 * extract-then-expand. RS is 4000, not 4096: FCM caps the whole body
 * strictly under 4096 bytes, and 86 header + 4096 record overshoots
 * (proven 2026-09-18: 4182-byte body → 400). Our payloads are ~200 bytes.
 */
async function encryptAes128gcm(
  plaintext: Uint8Array,
  clientPub: Uint8Array,
  authSecret: Uint8Array,
): Promise<Uint8Array> {
  const RS = 4000;
  const te = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const serverKeys = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const serverPub = new Uint8Array(await crypto.subtle.exportKey("raw", serverKeys.publicKey));
  const clientKey = await crypto.subtle.importKey(
    "raw",
    clientPub.slice().buffer as ArrayBuffer,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: clientKey }, serverKeys.privateKey, 256),
  );
  async function hkdf(ikm: Uint8Array, saltB: Uint8Array, info: Uint8Array, len: number) {
    const k = await crypto.subtle.importKey(
      "raw",
      ikm.slice().buffer as ArrayBuffer,
      "HKDF",
      false,
      ["deriveBits"],
    );
    return new Uint8Array(
      await crypto.subtle.deriveBits(
        {
          name: "HKDF",
          hash: "SHA-256",
          salt: saltB.slice().buffer as ArrayBuffer,
          info: info.slice().buffer as ArrayBuffer,
        },
        k,
        len * 8,
      ),
    );
  }
  const zero = new Uint8Array([0]);
  const ikm = await hkdf(shared, authSecret, concat(te.encode("WebPush: info"), zero, clientPub, serverPub), 32);
  const cek = await hkdf(ikm, salt, concat(te.encode("Content-Encoding: aes128gcm"), zero), 16);
  const nonce = await hkdf(ikm, salt, concat(te.encode("Content-Encoding: nonce"), zero), 12);
  const padLen = RS - 16 - plaintext.length - 1;
  if (padLen < 0) throw new Error("spike payload exceeds one record");
  const record = concat(plaintext, new Uint8Array([2]), new Uint8Array(padLen));
  const aesKey = await crypto.subtle.importKey(
    "raw",
    cek.slice().buffer as ArrayBuffer,
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce.slice().buffer as ArrayBuffer },
      aesKey,
      record.slice().buffer as ArrayBuffer,
    ),
  );
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, RS);
  return concat(salt, rs, new Uint8Array([serverPub.length]), serverPub, ct);
}

async function sendPush(
  sub: PushSubscriptionJson,
  payload: unknown,
  env: Env,
  jwtCache?: Map<string, string>,
): Promise<{ status: number; detail: string }> {
  if (!env.VAPID_JWK || !env.VAPID_SUBJECT) throw new Error("VAPID secrets missing");
  const data = new TextEncoder().encode(JSON.stringify(payload));
  const [body, authz] = await Promise.all([
    encryptAes128gcm(data, b64urlToBytes(sub.keys.p256dh), b64urlToBytes(sub.keys.auth)),
    vapidAuthHeader(sub.endpoint, JSON.parse(env.VAPID_JWK) as JsonWebKey, env.VAPID_SUBJECT, jwtCache),
  ]);
  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aes128gcm",
      TTL: "3600",
      Authorization: authz,
    },
    body,
  });
  return { status: res.status, detail: (await res.text()).slice(0, 300) };
}

// ---- Turso reads/writes (raw /v2/pipeline over fetch — dependency-free;
// the worker needs no ORM for one SELECT plus prune/update batches). ----

type TursoValue = { type: "text" | "integer" | "float" | "blob" | "null"; value?: unknown };
type TursoResult = {
  cols: string[];
  rows: TursoValue[][];
};

// Pipeline args must be explicitly tagged: bare strings happen to pass,
// but a bare number 400s ("invalid type: integer, expected internally
// tagged enum Value" — proven 2026-09-17: the 16:00 fanout sent fine, then
// its write batch died on the bare `now` timestamp). Tag everything here
// so no caller can repeat it. Integer values are string-encoded per sqld.
function tagArg(v: unknown): { type: string; value: unknown } {
  if (v === null || v === undefined) return { type: "null", value: null };
  if (typeof v === "number") return { type: Number.isInteger(v) ? "integer" : "float", value: String(v) };
  if (typeof v === "boolean") return { type: "integer", value: v ? "1" : "0" };
  return { type: "text", value: String(v) };
}

async function tursoPipeline(
  env: Env,
  stmts: { sql: string; args?: unknown[] }[],
): Promise<TursoResult[]> {
  if (!env.TURSO_DB_URL || !env.TURSO_AUTH_TOKEN) throw new Error("turso secrets missing");
  const res = await fetch(`${env.TURSO_DB_URL}/v2/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.TURSO_AUTH_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: stmts.map((s) => ({
        type: "execute",
        stmt: { sql: s.sql, args: (s.args ?? []).map(tagArg) },
      })),
    }),
  });
  // Read the body as text first: on failure sqld's error names the exact
  // complaint (bare-vs-tagged args, bad shape), and a masked status cost an
  // hour of guessing on 2026-09-17. Never throw a bare status again.
  const text = await res.text();
  let doc: {
    results?: { type: string; response?: { type: string; result?: { cols: ({ name: string } | string)[]; rows: TursoValue[][] } } }[];
  };
  try {
    doc = JSON.parse(text) as typeof doc;
  } catch {
    throw new Error(`turso ${res.status}: ${text.slice(0, 200)}`);
  }
  if (!res.ok) throw new Error(`turso ${res.status}: ${text.slice(0, 200)}`);
  return (doc.results ?? []).map((r) => {
    // Success response types observed live: "execute" (verified 2026-09-17
    // against the real endpoint — NOT "execution"; demanding that string
    // would turn every success into a "bad shape" throw).
    if (r?.type !== "ok" || (r.response?.type !== "execute" && r.response?.type !== "execution") || !r.response.result) {
      throw new Error(`turso bad shape: ${text.slice(0, 200)}`);
    }
    return {
      cols: r.response.result.cols.map((c) => (typeof c === "string" ? c : c.name)),
      rows: r.response.result.rows ?? [],
    };
  });
}

const textOf = (v: TursoValue | undefined): string =>
  v && v.type === "text" ? String(v.value) : "";

// Bounded fan-in: 20 concurrent sends (plan §7: 20–50), results in order.
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k]);
    }
  });
  await Promise.all(runners);
  return out;
}

export type FanoutReport = {
  skipped: boolean;
  reason: string;
  subs: number;
  sent: number;
  pruned: number;
  named: number;
  generic: number;
  silenced: number;
};

// Barrier task shape for the done mirror (src/data/tracker.json `barrier`:
// type countdown, max 7 — hardcoded like the EVENT constants, same file the
// local predicate reads). Mirror isTaskDone exactly: whatever it means
// locally, the server means too.
const BARRIER_MAX = 7;
const BARRIER_TITLE = "不祥的召喚結界出現了";

function barrierDone(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) && value >= BARRIER_MAX;
  return false;
}

// Tagged session value → raw (`j:` + JSON, the sync codec). Garbage reads as
// missing (undone), never as done — a corrupt row must nag, not silence.
function decTagged(raw: string): unknown {
  if (!raw.startsWith("j:")) return undefined;
  try {
    return JSON.parse(raw.slice(2)) as unknown;
  } catch {
    return undefined;
  }
}

type RosterEntry = { cid: string; name: string };

function parseRoster(raw: string | null): RosterEntry[] | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v) || v.length === 0) return null;
    const out: RosterEntry[] = [];
    for (const e of v.slice(0, 32)) {
      if (e && typeof e === "object") {
        const { cid, name } = e as { cid?: unknown; name?: unknown };
        if (typeof cid === "string" && cid && !cid.includes(":")) {
          out.push({ cid, name: typeof name === "string" ? name.slice(0, 32) : "" });
        }
      }
    }
    return out.length ? out : null;
  } catch {
    return null;
  }
}

type NamedCard = { body: string; chars: string } | null;

/**
 * Named card for a linked sub (D1a): read the session's current-bucket
 * barrier values live and print undone names exactly like the local card
 * (capped 3 + 等N隻). Returns null when the generic copy applies (no link,
 * bad roster, missing/expired session) — and "all-done" silences the send
 * entirely, same as local. The worker only READS sessions (never writes or
 * deletes them); an expired read is just a generic card.
 *
 * Bucket without the reset math: keys carry `@bucket`, cycle-key GC keeps
 * ≤8d of history, so the lexically largest weekly bucket IS the current
 * week. LIKE overmatches on exotic cids (`_` is a wildcard) — the regexes
 * below re-filter precisely, so overmatches die in code, not in cards.
 */
async function resolveNamedCard(
  env: Env,
  sessionId: string | null,
  roster: RosterEntry[] | null,
  now: number,
): Promise<{ kind: "named" | "generic" | "silenced"; body?: string; chars?: string }> {
  if (!sessionId || !roster) return { kind: "generic" };
  try {
    const [probe, kvs] = await tursoPipeline(env, [
      { sql: "SELECT updated_at FROM sessions WHERE id = ? AND expires_at > ?", args: [sessionId, now] },
      {
        sql: "SELECT key, value FROM kv WHERE session_id = ? AND (key LIKE 'v:%:barrier@%' OR key LIKE 'hide:%:barrier' OR key LIKE 'char:%:name')",
        args: [sessionId],
      },
    ]);
    if (!probe.rows.length) return { kind: "generic" };
    const byBucket = new Map<string, Map<string, unknown>>();
    const hidden = new Set<string>();
    const namesByCid = new Map<string, string>();
    for (const r of kvs.rows) {
      const k = textOf(r[0]);
      let m = /^v:([^:]+):barrier@(\d{4}-W\d{4})$/.exec(k);
      if (m) {
        let b = byBucket.get(m[2]);
        if (!b) byBucket.set(m[2], (b = new Map()));
        b.set(m[1], decTagged(textOf(r[1])));
        continue;
      }
      m = /^hide:([^:]+):barrier$/.exec(k);
      if (m) {
        if (decTagged(textOf(r[1])) === true) hidden.add(m[1]);
        continue;
      }
      m = /^char:([^:]+):name$/.exec(k);
      if (m) {
        const n = decTagged(textOf(r[1]));
        if (typeof n === "string" && n) namesByCid.set(m[1], n);
      }
    }
    // Order: roster snapshot first, then session-only cids lexical (a char
    // created after subscribing still gets named once the boot refresh
    // picks the snapshot up).
    const sessionCids = new Set<string>();
    for (const b of byBucket.values()) for (const cid of b.keys()) sessionCids.add(cid);
    for (const cid of namesByCid.keys()) sessionCids.add(cid);
    const rosterCids = new Set(roster.map((e) => e.cid));
    const ordered = [...roster.map((e) => e.cid), ...[...sessionCids].filter((c) => !rosterCids.has(c)).sort()];
    const bucket = [...byBucket.keys()].sort().pop() ?? null;
    const vals = (bucket && byBucket.get(bucket)) || new Map<string, unknown>();
    const undone: string[] = [];
    const names: string[] = [];
    for (const cid of ordered) {
      if (hidden.has(cid)) continue;
      if (bucket && barrierDone(vals.get(cid))) continue;
      const name = namesByCid.get(cid) ?? roster.find((e) => e.cid === cid)?.name ?? "";
      if (!name) continue;
      undone.push(cid);
      names.push(name);
    }
    // No history at all + no names anywhere → generic; a current bucket
    // with nobody undone → silence. Hidden-everyone with no history lands
    // generic (done-state unknowable — nagging blind beats silencing blind).
    if (!undone.length) return bucket ? { kind: "silenced" } : { kind: "generic" };
    return { kind: "named", ...nameBody(undone, names) };
  } catch {
    // Any read failure degrades to the generic copy — a failed lookup must
    // never cost the user their reminder.
    return { kind: "generic" };
  }
}

/** Local-identical name body: capped 3 + 等N隻. */
function nameBody(undone: string[], names: string[]): { body: string; chars: string } {
  const shown = names.slice(0, 3).join("、");
  const more = names.length > 3 ? ` 等 ${names.length} 隻` : "";
  return { body: `${shown}${more}`, chars: undone.join(",") };
}

/**
 * Hourly barrier fanout. Staleness guard first (D4): the useful window ends
 * at :02:00 Taipei — a delayed tick degrades to a clean miss, never a
 * misleading card. Then one batched read, concurrent sends, and a single
 * write batch (dead-endpoint prune on 404/410 + last_sent_at stamps).
 *
 * Card copy: linked subs get undone names (D1a — same cap/format as the
 * local card, with undone cids riding top-level chars so the tap selects
 * exactly); unlinked subs get the generic start-time body (D1 — the server
 * knows no done-state); all-done linked subs get silence. Tap deep-links
 * task-only for generic cards; the page resolves the first undone
 * character, like a char-less local card.
 */
export async function runBarrierFanout(env: Env): Promise<FanoutReport> {
  const now = Date.now();
  if (secIntoHour(now) > EVENT_SEC_PAST_HOUR - CATCHUP_MIN_SEC) {
    return { skipped: true, reason: "past-cutoff", subs: 0, sent: 0, pruned: 0, named: 0, generic: 0, silenced: 0 };
  }
  const [listed] = await tursoPipeline(env, [
    {
      sql: "SELECT endpoint, p256dh, auth, link_session, roster_json FROM push_subscriptions WHERE lane = ?",
      args: ["hourly"],
    },
  ]);
  const subs = listed.rows
    .map((r) => ({
      endpoint: textOf(r[0]),
      p256dh: textOf(r[1]),
      auth: textOf(r[2]),
      linkSession: r[3]?.type === "text" ? String(r[3].value) : null,
      roster: parseRoster(r[4]?.type === "text" ? String(r[4].value) : null),
    }))
    .filter((s) => s.endpoint.startsWith("https://") && s.p256dh && s.auth);
  if (!subs.length) {
    return { skipped: true, reason: "no-subs", subs: 0, sent: 0, pruned: 0, named: 0, generic: 0, silenced: 0 };
  }
  // Generic copy for unlinked subs (D1): the server knows no done-state, so
  // the body names nothing. `JJ！` = 結界 initials, in-group shorthand —
  // and deliberately no clock time (the old MM:SS "02:30" read as 2:30 AM,
  // seen 2026-09-17).
  const genericBody = `JJ！`;
  const jwtCache = new Map<string, string>();
  let named = 0;
  let generic = 0;
  let silenced = 0;
  const statuses = await mapLimit(subs, 20, async (sub) => {
    const card = await resolveNamedCard(env, sub.linkSession, sub.roster, now);
    if (card.kind === "silenced") {
      silenced++;
      return { endpoint: sub.endpoint, status: 0 };
    }
    if (card.kind === "named") named++;
    else generic++;
    // Deep-link fields ride TOP-LEVEL per the SW contract (sw-push.js:
    // "the push payload is { title, body, tag, url?, task?, chars? }") —
    // nested under `data` they never reach notification.data and every tap
    // focuses without flashing (seen 2026-09-17 on all server cards).
    const payload = {
      title: BARRIER_TITLE,
      body: card.kind === "named" && card.body ? card.body : genericBody,
      tag: HOURLY_TAG,
      url: "/",
      task: "barrier",
      ...(card.kind === "named" && card.chars ? { chars: card.chars } : {}),
    };
    try {
      const r = await sendPush(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        env,
        jwtCache,
      );
      return { endpoint: sub.endpoint, status: r.status };
    } catch {
      return { endpoint: sub.endpoint, status: -1 };
    }
  });
  const sent = statuses.filter((s) => s.status === 201).map((s) => s.endpoint);
  const dead = statuses.filter((s) => s.status === 404 || s.status === 410).map((s) => s.endpoint);
  // Lane-scoped (shared helper below): a dead hourly endpoint must not
  // delete the purple row on the same endpoint, nor stamp its timestamp.
  await writeSendBatch(env, sent, dead, now, "hourly");
  return {
    skipped: false,
    reason: "fanned-out",
    subs: subs.length,
    sent: sent.length,
    pruned: dead.length,
    named,
    generic,
    silenced,
  };
}

// ---- Purple schedule feed (phase 2B) ----
//
// KV `purple:schedule` is the published doc
// {anchorMs, windows: [{startMs, endMs}], updatedAt, updatedBy} — written by
// the dashboard (day one) or /admin (graduation), seeded once by hand. The
// client prefers it over its hardcoded timetable; an empty KV, a corrupt
// doc, or a KV failure all degrade to the hardcoded values with
// confidence "hardcoded" and updatedAt null — "unknown", never "no
// maintenance". parseScheduleDoc is the shared strict gate (one fat-fingered
// entry rejects the whole doc).

export type ScheduleResponse = {
  anchorMs: number;
  windows: MaintenanceWindow[];
  updatedAt: number | null;
  updatedBy: string | null;
  auto: boolean;
  confidence: "verified" | "hardcoded";
  sources: string[];
};

async function readSchedule(env: Env): Promise<ScheduleResponse> {
  try {
    const doc = parseScheduleDoc(await env.PURPLE.get("purple:schedule", "json"));
    if (doc) {
      return {
        anchorMs: doc.anchorMs,
        windows: doc.windows,
        updatedAt: doc.updatedAt,
        updatedBy: doc.updatedBy,
        auto: doc.auto,
        confidence: "verified",
        sources: ["kv:purple:schedule"],
      };
    }
  } catch (e) {
    console.log(`purple-schedule kv read failed: ${String(e)}`);
  }
  return {
    anchorMs: PURPLE_ANCHOR_MS,
    windows: MAINTENANCE_WINDOWS,
    updatedAt: null,
    updatedBy: null,
    auto: true,
    confidence: "hardcoded",
    sources: ["code"],
  };
}

const SCHEDULE_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=60",
};

// ---- Purple watcher (2x/day Bahamut poll → candidates, never truth) ----
//
// The official board is JS-rendered, but the Bahamut search endpoint serves
// the 8 maintenance posts pre-filtered and time-sorted to a bare GET — full
// first-post bodies inline, fixed-format 維護時間 lines a regex extracts
// (proven 2026-09-18: 8 mentions → 7 unique windows, 0.39ms parse, 25x
// inside the 10ms cron CPU budget). Public fan forum, facts only.
//
// Gotcha (proven same day): reposts are snapshots — 9/16 announced
// 06:00–08:30 but actually ended 09:00, and the repost still reads 08:30.
// So candidates are SCHEDULED windows (earliest-possible); the human
// confirmer checks the newest replies for 延長 bumps before promoting.
// CF-egress access (Bahamut blocking Cloudflare IPs) is the one unverified
// bit — first deploy proves it via the log lines below; on failure the
// watcher degrades to local script + dashboard paste, feed contract
// unchanged.

const BAHAMUT_SEARCH_URL =
  "https://forum.gamer.com.tw/search.php?bsn=32564&q=" +
  encodeURIComponent("維護公告") +
  "&field=title&firstFloorOnly=1&advancedSearch=1&subbsn=5&sortType=mtime";
const WATCH_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

// One window per 維護時間 mention (120-char window past the mention —
// precise, no cross-post bleed): `2026年9月16日(三) 上午6時 ～ 上午8時30分`.
// ampm prefixes are optional on either half (missing inherits the other,
// both missing means 上午); end <= start rolls to the next day.
const MAINT_RE =
  /(\d{4})年(\d{1,2})月(\d{1,2})日[^上中下\d]{0,20}(上午|下午|中午)?(\d{1,2})時(?:(\d{1,2})分)?\s*[～~\-–—至]\s*(上午|下午|中午)?(\d{1,2})時(?:(\d{1,2})分)?/;

function maintHour(ampm: string | undefined, inherit: string | undefined, h: number): number {
  const ap = ampm ?? inherit ?? "上午";
  if (ap === "下午") return h < 12 ? h + 12 : h;
  if (ap === "上午") return h === 12 ? 0 : h;
  return 12; // 中午
}

export function parseMaintWindows(html: string): MaintenanceWindow[] {
  const out: MaintenanceWindow[] = [];
  for (let i = html.indexOf("維護時間"); i !== -1; i = html.indexOf("維護時間", i + 4)) {
    const m = MAINT_RE.exec(html.slice(i, i + 120));
    if (!m) continue;
    const [, Y, Mo, D, ap1, h1, mi1, ap2, h2, mi2] = m;
    const y = +Y;
    const mo = +Mo;
    const d = +D;
    const start = Date.UTC(y, mo - 1, d, maintHour(ap1, ap2, +h1) - 8, +(mi1 ?? 0));
    let end = Date.UTC(y, mo - 1, d, maintHour(ap2, ap1, +h2) - 8, +(mi2 ?? 0));
    if (end <= start) end += 24 * 3600 * 1000; // overnight tail
    if (start < end) out.push({ startMs: start, endMs: end });
  }
  const seen = new Set<string>();
  return out.filter((w) => {
    const k = `${w.startMs}-${w.endMs}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export async function runPurpleWatch(env: Env): Promise<{ windows: number; applied: boolean }> {
  const res = await fetch(BAHAMUT_SEARCH_URL, { headers: { "User-Agent": WATCH_UA } });
  if (!res.ok) throw new Error(`bahamut ${res.status}`);
  const windows = parseMaintWindows(await res.text());
  const now = Date.now();
  await env.PURPLE.put(
    "purple:candidates",
    JSON.stringify({ windows, observedAt: now, sources: [BAHAMUT_SEARCH_URL] })
  );
  // Auto-apply with per-window overrides (decided 2026-09-18): unlocked docs
  // take the resolved windows — candidates base, overrides on top. Empty
  // candidates never wipe verified (parse failure degrades to last good);
  // a locked doc is left alone until resumed.
  let applied = false;
  if (windows.length > 0) {
    const current = await readSchedule(env);
    if (current.auto) {
      const resolved = await resolveAndStore(env, current.anchorMs, windows, now, "watcher");
      applied = resolved;
    }
  }
  return { windows: windows.length, applied };
}

// ---- Per-window overrides (admin surgery on auto output) ----
//
// KV `purple:overrides`: {overrides: [{startMs, endMs}], tombstones:
// [{startMs, endMs}], updatedAt, updatedBy}. An override sharing a
// candidate's startMs REPLACES it (extensions keep the announced start, so
// the correction tracks re-parses); overrides matching nothing are
// additions; a tombstone sharing a startMs suppresses both. Tombstones
// carry the suppressed window's end so they expire like anything else.

export type PurpleOverrides = {
  overrides: MaintenanceWindow[];
  tombstones: MaintenanceWindow[];
  updatedAt: number | null;
  updatedBy: string | null;
};

const EMPTY_OVERRIDES: PurpleOverrides = {
  overrides: [],
  tombstones: [],
  updatedAt: null,
  updatedBy: null,
};

async function readOverrides(env: Env): Promise<PurpleOverrides> {
  try {
    const raw = (await env.PURPLE.get("purple:overrides", "json")) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return EMPTY_OVERRIDES;
    const d = raw as Record<string, unknown>;
    const overrides = validWindowsList(d.overrides ?? []);
    const tombstones = validWindowsList(d.tombstones ?? []);
    // Corrupt lists read as empty (never half-apply); a corrupt envelope
    // reads as absent. Either way the candidates flow through unresolved.
    if (!overrides || !tombstones) return EMPTY_OVERRIDES;
    return {
      overrides,
      tombstones,
      updatedAt: typeof d.updatedAt === "number" && Number.isFinite(d.updatedAt) ? d.updatedAt : null,
      updatedBy: typeof d.updatedBy === "string" ? d.updatedBy.slice(0, 32) : null,
    };
  } catch {
    return EMPTY_OVERRIDES;
  }
}

async function storeOverrides(
  env: Env,
  overrides: MaintenanceWindow[],
  tombstones: MaintenanceWindow[],
  updatedBy: string
): Promise<void> {
  await env.PURPLE.put(
    "purple:overrides",
    JSON.stringify({ overrides, tombstones, updatedAt: Date.now(), updatedBy })
  );
}

/**
 * Resolve candidates against override records, then normalize. Exported
 * for probes (the re-parse tracking and tombstone precedence are the
 * load-bearing semantics here).
 */
export function resolveWindows(
  candidates: MaintenanceWindow[],
  overrides: MaintenanceWindow[],
  tombstones: MaintenanceWindow[]
): MaintenanceWindow[] {
  const tombed = new Set(tombstones.map((t) => t.startMs));
  const overByStart = new Map(overrides.map((o) => [o.startMs, o]));
  const out: MaintenanceWindow[] = [];
  const seen = new Set<number>();
  const take = (w: MaintenanceWindow) => {
    if (seen.has(w.startMs)) return;
    seen.add(w.startMs);
    out.push({ startMs: w.startMs, endMs: w.endMs });
  };
  for (const c of candidates) {
    if (tombed.has(c.startMs)) continue;
    take(overByStart.get(c.startMs) ?? c);
  }
  for (const o of overrides) take(o); // additions (matched ones are seen)
  return normalizeWindows(out);
}

/**
 * Override-record hygiene: drop records entirely in the past (endMs < now)
 * that no current candidate references — the correction already served.
 * Records still observed stay (the candidate still needs correcting);
 * future records stay. Tombstones expire by the suppressed window's end.
 *
 * Deliberately NOT pruned: spent CANDIDATE windows. Legs tile continuously
 * from the anchor, so every post-anchor window permanently shapes later
 * legs — pruning one un-does a real pause and shifts all future predictions
 * earlier (this corrects the old "mathematically inert" claim in the
 * phase-2 doc). Only pre-anchor windows are truly inert.
 */
export function pruneOverrideRecords(
  ov: PurpleOverrides,
  candidates: MaintenanceWindow[],
  now: number
): PurpleOverrides {
  const observed = new Set(candidates.map((c) => c.startMs));
  const live = (w: MaintenanceWindow) => w.endMs >= now || observed.has(w.startMs);
  return { ...ov, overrides: ov.overrides.filter(live), tombstones: ov.tombstones.filter(live) };
}

function overridesEqual(a: PurpleOverrides, b: PurpleOverrides): boolean {
  return (
    JSON.stringify(a.overrides) === JSON.stringify(b.overrides) &&
    JSON.stringify(a.tombstones) === JSON.stringify(b.tombstones)
  );
}

/**
 * One resolve round: read records, prune the dead ones (persisted back when
 * changed), resolve against candidates, write verified. Shared by the
 * watcher, the overrides save, and resume-auto — one code path, three
 * triggers. Returns whether verified was written.
 */
async function resolveAndStore(
  env: Env,
  anchorMs: number,
  candidates: MaintenanceWindow[],
  now: number,
  by: string
): Promise<boolean> {
  const raw = await readOverrides(env);
  const ov = pruneOverrideRecords(raw, candidates, now);
  if (!overridesEqual(raw, ov)) {
    await storeOverrides(env, ov.overrides, ov.tombstones, ov.updatedBy ?? by);
  }
  const doc = parseScheduleDoc({
    anchorMs,
    windows: resolveWindows(candidates, ov.overrides, ov.tombstones),
    updatedAt: now,
    updatedBy: by,
    auto: true,
  });
  if (!doc) return false;
  await env.PURPLE.put("purple:schedule", JSON.stringify(doc));
  return true;
}

// ---- /admin (graduation editor over the same KV docs) ----
//
// One screen, three blocks: current verified values, watcher candidates,
// and a promote button. Auth: ADMIN_SECRET bearer per API call (kept in
// sessionStorage, re-entered once per session); comparison via
// timingSafeEqual with a length check first (the mismatch throws, and a
// throw-vs-false oracle leaks the length). No rate limiting (single form,
// nuisance-grade asset); rotation is a secret put + re-login, no code.
// The worker never auto-publishes truth: candidates stay candidates until
// a promote/publish stamps updatedBy "admin".

function adminAuthed(req: Request, env: Env): boolean {
  const secret = env.ADMIN_SECRET;
  if (!secret) return false;
  const h = req.headers.get("Authorization");
  if (!h || !h.startsWith("Bearer ")) return false;
  const got = h.slice("Bearer ".length);
  if (got.length !== secret.length) return false;
  try {
    const te = new TextEncoder();
    return crypto.subtle.timingSafeEqual(te.encode(got), te.encode(secret)) as unknown as boolean;
  } catch {
    return false;
  }
}

async function readCandidates(env: Env): Promise<{
  windows: MaintenanceWindow[];
  observedAt: number | null;
  sources: string[];
} | null> {
  try {
    const raw = (await env.PURPLE.get("purple:candidates", "json")) as {
      windows?: unknown;
      observedAt?: unknown;
      sources?: unknown;
    } | null;
    if (!raw || !Array.isArray(raw.windows)) return null;
    const windows = raw.windows.filter(
      (w): w is MaintenanceWindow =>
        !!w &&
        typeof w === "object" &&
        typeof (w as { startMs?: unknown }).startMs === "number" &&
        typeof (w as { endMs?: unknown }).endMs === "number" &&
        Number.isFinite((w as { startMs: number }).startMs) &&
        Number.isFinite((w as { endMs: number }).endMs) &&
        (w as { startMs: number }).startMs < (w as { endMs: number }).endMs
    );
    return {
      windows,
      observedAt: typeof raw.observedAt === "number" ? raw.observedAt : null,
      sources: Array.isArray(raw.sources)
        ? raw.sources.filter((s): s is string => typeof s === "string").slice(0, 8)
        : [],
    };
  } catch {
    return null;
  }
}

// Inputs are native datetime-local only (zero dependencies). Values are
// TAIPEI wall time (the maintainer reads announcements in Taipei) — parsed
// back through the same UTC+8 shift as taipeiWall, never the browser zone.
// Styling is hand CSS in a shadcn-like register (zinc palette, cards, ring
// focus, dark-mode aware): a React/shadcn build can't run inside a
// worker-served page without a static-asset pipeline, which is
// disproportionate for one maintainer form.
const ADMIN_HTML = `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>紫洞排程管理</title>
<style>
:root{--bg:#fafafa;--card:#fff;--border:#e4e4e7;--text:#18181b;--muted:#71717a;--primary:#18181b;--primary-fg:#fafafa;--danger:#dc2626;--ok:#15803d;--radius:.5rem;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#09090b;--card:#18181b;--border:#27272a;--text:#fafafa;--muted:#a1a1aa;--primary:#fafafa;--primary-fg:#18181b;--danger:#f87171;--ok:#4ade80;color-scheme:dark}}
*{box-sizing:border-box}body{font-family:system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);margin:0;padding:1.5rem 1rem 4rem}
.wrap{max-width:36rem;margin:0 auto}h1{font-size:1.25rem;margin:0 0 .25rem}.sub{color:var(--muted);font-size:.85rem;margin:0 0 1.25rem}
.card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:1rem 1.1rem;margin-bottom:1rem;box-shadow:0 1px 2px rgb(0 0 0/.04)}
.card h2{font-size:.95rem;margin:0 0 .75rem}label.lbl{display:block;font-size:.8rem;color:var(--muted);margin:.5rem 0 .25rem}
input[type=datetime-local],input[type=password]{width:100%;font-size:1rem;padding:.5rem .6rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text)}
input:focus{outline:2px solid var(--primary);outline-offset:1px}
button{font-size:.9rem;font-weight:500;padding:.55rem 1rem;border-radius:var(--radius);border:1px solid var(--border);background:var(--card);color:var(--text);cursor:pointer}
button:hover{border-color:var(--muted)}button.primary{background:var(--primary);color:var(--primary-fg);border-color:var(--primary)}
button.danger{background:var(--danger);color:#fff;border-color:var(--danger)}
button:disabled{opacity:.5;cursor:default}.btnrow{display:flex;gap:.5rem;margin-top:.9rem;flex-wrap:wrap}
button.mini{padding:.35rem .65rem;font-size:.8rem}
.win{border:1px solid var(--border);border-radius:var(--radius);padding:.7rem;margin-bottom:.6rem}
.win .grid{display:grid;grid-template-columns:1fr 1fr auto;gap:.5rem;align-items:end}
@media (max-width:26rem){.win .grid{grid-template-columns:1fr}.win .del{justify-self:end}}
.preview{font-size:.8rem;color:var(--muted);margin-top:.4rem}.preview b{color:var(--text);font-weight:600}
.cand{border:1px solid var(--border);border-left:3px solid #8b5cf6;border-radius:var(--radius);padding:.6rem .8rem;margin-bottom:.5rem}
.cand .range{font-weight:600}.cand .meta,.foot{font-size:.8rem;color:var(--muted);margin-top:.35rem}
ol.steps{margin:.2rem 0 .6rem;padding-left:1.3rem}ol.steps li{font-size:.88rem;margin-bottom:.45rem}
#msg{border-radius:var(--radius);padding:.7rem .9rem;font-size:.9rem;min-height:2.6rem;background:var(--bg);border:1px solid var(--border)}
#msg.ok{border-color:var(--ok);color:var(--ok)}#msg.err{border-color:var(--danger);color:var(--danger)}
.empty{color:var(--muted);font-size:.9rem}
details{margin-top:.8rem}summary{cursor:pointer;font-size:.85rem;color:var(--muted)}
</style>
</head><body><div class="wrap">
<h1>紫洞排程管理</h1>
<p class="sub">時間一律是台北牆鐘。發佈即全站生效，請先對過公告。</p>
<section class="card"><h2>使用說明（第一次請讀完）</h2>
<ol class="steps">
<li><b>對答案</b>：「監看候選」是機器人從巴哈公告抓的。逐條對到巴哈搜尋頁（日期、上午下午、分鐘都要對），並看該篇最新留言有沒有「延長」——有就以留言的時間為準。</li>
<li><b>修答案</b>：候選有錯 → 按那條的「修正」改對，或按「忽略」丟掉它；公告上有但候選沒有 → 在「手動覆寫」按「＋ 覆寫」自己加一條。改完按「儲存覆寫」。</li>
<li><b>發佈</b>：候選全部正確 → 按「採用候選」。自己動手改過 → 按「發佈」（發佈後自動更新會鎖定，監看只寫候選不再覆蓋；想恢復按「恢復自動更新」）。</li>
</ol>
<p class="foot">不確定的時候不要按發佈——維持現狀比發佈錯誤好，玩家看到錯的時間會白跑一趟。</p></section>
<div id="login" class="card"><h2>登入</h2><label class="lbl" for="secret">ADMIN_SECRET（只留在此分頁）</label><input id="secret" type="password" autocomplete="off"><div class="btnrow"><button id="loginBtn" class="primary">登入</button></div></div>
<div id="ed" hidden>
<section class="card"><h2>監看候選</h2>
<p class="foot">機器人每 12 小時抓一次巴哈「維護公告」搜尋結果。只採用跟官方公告一字不差的；例行維修通常是週三早上 6 點開始——長得不像的先不要採用，來問。</p>
<div id="cands"><p class="empty">載入中…</p></div>
<div class="btnrow"><button id="promo">採用候選 → 發佈</button></div>
</section>
<section class="card"><h2>手動覆寫</h2>
<p class="foot">覆寫以開始時間對上候選（只改結束時間也行）；對不上的成為新增；忽略的候選不再出現，結束時間只決定何時自動清理。儲存後即時生效（未鎖定時）。覆寫只影響你改的那一條，其他照常自動更新。</p>
<div id="ovr"></div>
<div class="btnrow"><button id="addOvr">＋ 覆寫</button></div>
<h2 style="margin-top:1rem">忽略</h2><div id="tmb"></div>
<div class="btnrow"><button id="saveOvr" class="primary">儲存覆寫</button></div>
</section>
<section class="card"><h2>已發佈（唯讀預覽）</h2>
<p class="foot">這就是玩家現在看到的時刻表。錨點＝上次親眼看到紫洞出沒的時間；維護窗＝遊戲維修的時段（那段時間計時暫停，預測順延）。日常修正請用上面的候選和覆寫——這裡很少需要動。</p>
<div id="autoLine" class="preview"></div>
<div id="pubView"></div>
<details><summary>手動修改全部（很少用到）</summary>
<p class="foot">這裡的發佈會一次換掉全部已發佈內容，並且鎖定自動更新（之後監看只寫候選）。確定整份都要自己寫才用；改一兩條請用手動覆寫。</p>
<label class="lbl" for="anchor">錨點（觀測到的出沒時刻）</label><input id="anchor" type="datetime-local"><div id="anchorPrev" class="preview"></div>
<div id="wins"></div>
<div class="btnrow"><button id="addWin">＋ 維護窗</button><button id="pub" class="primary">發佈</button></div>
<div class="btnrow"><button id="resumeAuto" hidden>恢復自動更新</button></div>
</details></section>
<section class="card"><h2>狀態</h2><div id="msg">尚未載入。</div>
<div class="btnrow"><button id="logout">登出</button></div>
</section>
</div>
<script>
const $=id=>document.getElementById(id);
function say(t,cls){const m=$("msg");m.textContent=t;m.className=cls||"";}
const auth=()=>({Authorization:"Bearer "+(sessionStorage.getItem("ADMIN")||"")});
function msToInput(ms){const p=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(ms));const g=t=>(p.find(x=>x.type===t)||{}).value||"";return g("year")+"-"+g("month")+"-"+g("day")+"T"+g("hour")+":"+g("minute");}
function inputToMs(s){const m=/^(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2})$/.exec(s||"");if(!m)return NaN;return Date.UTC(+m[1],+m[2]-1,+m[3],+m[4]-8,+m[5]);}
function fmt(ms){return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(new Date(ms));}
function prevText(s,e){if(!Number.isFinite(s))return "錨點未填。";return "台北 "+fmt(s)+(e===undefined?"":(Number.isFinite(e)?" ～ "+fmt(e):" ～ （結束未填）"));}
function paintPreview(row){const s=inputToMs(row.querySelector(".ws").value),e=inputToMs(row.querySelector(".we").value);row.querySelector(".preview").innerHTML="台北 <b>"+(Number.isFinite(s)?fmt(s):"？")+"</b> ～ <b>"+(Number.isFinite(e)?fmt(e):"？")+"</b>";}
function winRow(s,e){const d=document.createElement("div");d.className="win";const g=document.createElement("div");g.className="grid";g.innerHTML='<div><label class="lbl">開始</label><input type="datetime-local" class="ws"></div><div><label class="lbl">結束</label><input type="datetime-local" class="we"></div><div><button class="del">刪</button></div>';const pv=document.createElement("div");pv.className="preview";d.appendChild(g);d.appendChild(pv);if(s)g.querySelector(".ws").value=msToInput(s);if(e)g.querySelector(".we").value=msToInput(e);const paint=()=>{const a=inputToMs(g.querySelector(".ws").value),b=inputToMs(g.querySelector(".we").value);pv.innerHTML="台北 <b>"+(Number.isFinite(a)?fmt(a):"？")+"</b> ～ <b>"+(Number.isFinite(b)?fmt(b):"？")+"</b>";};g.querySelector(".ws").oninput=paint;g.querySelector(".we").oninput=paint;g.querySelector(".del").onclick=()=>d.remove();paint();return d;}
function paintAnchor(){const a=inputToMs($("anchor").value);$("anchorPrev").textContent=Number.isFinite(a)?"台北 "+fmt(a):"錨點未填。";}
async function load(){const r=await fetch("/admin/api/state",{headers:auth()});if(r.status===401){say("登入失效，請重新登入。","err");return;}const st=await r.json();$("anchor").value=msToInput(st.verified.anchorMs);paintAnchor();$("wins").innerHTML="";for(const w of st.verified.windows)$("wins").appendChild(winRow(w.startMs,w.endMs));say("已發佈：更新於 "+(st.verified.updatedAt?fmt(st.verified.updatedAt):"（未曾）")+"（"+(st.verified.confidence||"verified")+"）","ok");const pv=$("pubView");pv.innerHTML="";const pa=document.createElement("div");pa.className="preview";pa.innerHTML="錨點 <b>"+fmt(st.verified.anchorMs)+"</b>";pv.appendChild(pa);for(const w of st.verified.windows){const pr=document.createElement("div");pr.className="preview";pr.innerHTML="維護 <b>"+fmt(w.startMs)+"</b> ～ <b>"+fmt(w.endMs)+"</b>";pv.appendChild(pr);}if(!st.verified.windows.length){const pr=document.createElement("div");pr.className="preview";pr.textContent="無維護窗。";pv.appendChild(pr);}const locked=st.verified.auto===false;$("autoLine").textContent=locked?"手動鎖定中：監看只寫候選，不覆蓋已發佈。":"自動更新中：監看有新結果會直接採用。";$("resumeAuto").hidden=!locked;const ov=st.overrides||{overrides:[],tombstones:[]};$("ovr").innerHTML="";for(const w of (ov.overrides||[]))$("ovr").appendChild(winRow(w.startMs,w.endMs));$("tmb").innerHTML="";for(const w of (ov.tombstones||[]))$("tmb").appendChild(winRow(w.startMs,w.endMs));const c=$("cands");c.innerHTML="";if(!st.candidates||!st.candidates.windows.length){c.innerHTML='<p class="empty">無候選。</p>';return;}const h=document.createElement("p");h.className="foot";h.textContent=st.candidates.windows.length+" 個候選（觀測於 "+(st.candidates.observedAt?fmt(st.candidates.observedAt):"？")+"）——採用前請逐條對過公告：";c.appendChild(h);for(const w of st.candidates.windows){const d=document.createElement("div");d.className="cand";const t=document.createElement("div");t.className="range";t.textContent=fmt(w.startMs)+" ～ "+fmt(w.endMs);d.appendChild(t);const acts=document.createElement("div");acts.className="btnrow";const fix=document.createElement("button");fix.className="mini";fix.textContent="修正";fix.onclick=()=>{const r=winRow(w.startMs,w.endMs);$("ovr").appendChild(r);r.scrollIntoView({block:"nearest"});};const ign=document.createElement("button");ign.className="mini";ign.textContent="忽略";ign.onclick=()=>{$("tmb").appendChild(winRow(w.startMs,w.endMs));};acts.appendChild(fix);acts.appendChild(ign);d.appendChild(acts);c.appendChild(d);}}
$("anchor").oninput=paintAnchor;
$("loginBtn").onclick=async()=>{const s=$("secret").value;if(!s){say("請輸入密碼。","err");return;}const r=await fetch("/admin/api/verify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({secret:s})});if(!r.ok){say("密碼錯誤。","err");return;}sessionStorage.setItem("ADMIN",s);$("login").style.display="none";$("ed").hidden=false;$("secret").value="";say("登入成功，載入中…","");await load();};
if(sessionStorage.getItem("ADMIN")){$("login").style.display="none";$("ed").hidden=false;load();}
$("addWin").onclick=()=>$("wins").appendChild(winRow());
$("addOvr").onclick=()=>{const r=winRow();$("ovr").appendChild(r);r.scrollIntoView({block:"nearest"});};
function collectRows(id){const ws=[];for(const r of document.querySelectorAll("#"+id+" .win")){const s=inputToMs(r.querySelector(".ws").value),e=inputToMs(r.querySelector(".we").value);if(!Number.isFinite(s)||!Number.isFinite(e)||!(s<e))return null;ws.push({startMs:s,endMs:e});}return ws;}
$("saveOvr").onclick=async()=>{const o=collectRows("ovr"),t=collectRows("tmb");if(!o||!t){say("覆寫或忽略有未填完整（需開始＜結束）。","err");return;}const r=await fetch("/admin/api/overrides",{method:"POST",headers:{...auth(),"Content-Type":"application/json"},body:JSON.stringify({overrides:o,tombstones:t})});say(r.ok?"已儲存覆寫。":"儲存失敗 "+r.status+"："+await r.text(),r.ok?"ok":"err");if(r.ok)await load();};
$("logout").onclick=()=>{sessionStorage.removeItem("ADMIN");location.reload();};
let armTimer=0;function disarmPub(){const b=$("pub");b.textContent="發佈";b.classList.remove("danger");if(armTimer){clearTimeout(armTimer);armTimer=0;}}
$("pub").onclick=async()=>{const b=$("pub");if(!armTimer){b.textContent="確認發佈？";b.classList.add("danger");say("再按一次才會真的發佈（全站立即生效）。","");armTimer=setTimeout(disarmPub,5000);return;}disarmPub();const a=inputToMs($("anchor").value);if(!Number.isFinite(a)){say("錨點未填。","err");return;}const ws=[];for(const r of document.querySelectorAll("#wins .win")){const s=inputToMs(r.querySelector(".ws").value),e=inputToMs(r.querySelector(".we").value);if(!Number.isFinite(s)||!Number.isFinite(e)||!(s<e)){say("有維護窗未填完整（需開始＜結束）。","err");return;}ws.push({startMs:s,endMs:e});}b.disabled=true;const r=await fetch("/admin/api/publish",{method:"POST",headers:{...auth(),"Content-Type":"application/json"},body:JSON.stringify({anchorMs:a,windows:ws})});b.disabled=false;say(r.ok?"已發佈。":"發佈失敗 "+r.status+"："+await r.text(),r.ok?"ok":"err");if(r.ok)await load();};
$("promo").onclick=async()=>{const r=await fetch("/admin/api/promote",{method:"POST",headers:auth()});const t=await r.text();let j=null;try{j=JSON.parse(t);}catch(e){}say(r.ok?(j&&j.promoted?"已採用 "+j.promoted+" 個候選並發佈。":(j&&j.message?j.message:t)):"採用失敗 "+r.status+"："+t,r.ok?"ok":"err");if(r.ok)await load();};
$("resumeAuto").onclick=async()=>{const r=await fetch("/admin/api/auto",{method:"POST",headers:{...auth(),"Content-Type":"application/json"},body:JSON.stringify({auto:true})});say(r.ok?"已恢復自動更新。":"恢復失敗 "+r.status+"："+await r.text(),r.ok?"ok":"err");if(r.ok)await load();};
</script></div></body></html>`;

const ADMIN_NOINDEX = { "Cache-Control": "no-store" };

// ---- Purple server fanout (15-min tick, unfiltered lane) ----
//
// Decided: the purple bell subscribes a server lane like hourly
// (`lane = "purple"` rows); cards name zones, never people, so no D1a
// linkage — every sub gets the same card (D1-style, opt-in experimental).
// Cutoff: skip past spawns only (the hole persists, so no startle boundary
// like the barrier's :02 guard). Lead: the flat 15-min tick fires exactly
// one tick per spawn inside (now, now+15min]; a KV fire-once guard covers
// retries and restarts. Tap deep-links task-only (page resolves like a
// char-less local card); visibility split needs no new code (shared hidden-
// skip page-side, tag-agnostic suppress SW-side).

export type PurpleFanoutReport = {
  skipped: boolean;
  reason: string;
  spawn: number | null;
  subs: number;
  sent: number;
  pruned: number;
};

const PURPLE_TITLE = "深淵的黑色坑洞即將出現";

async function writeSendBatch(
  env: Env,
  sent: string[],
  dead: string[],
  now: number,
  lane: "hourly" | "purple"
): Promise<void> {
  const batch: { sql: string; args: unknown[] }[] = [];
  for (const e of dead) {
    batch.push({ sql: "DELETE FROM push_subscriptions WHERE endpoint = ? AND lane = ?", args: [e, lane] });
  }
  if (sent.length) {
    const ph = sent.map(() => "?").join(",");
    batch.push({
      sql: `UPDATE push_subscriptions SET last_sent_at = ? WHERE lane = ? AND endpoint IN (${ph})`,
      args: [now, lane, ...sent],
    });
  }
  if (batch.length) await tursoPipeline(env, batch);
}

export async function runPurpleFanout(env: Env): Promise<PurpleFanoutReport> {
  const now = Date.now();
  const sched = await readSchedule(env);
  const spawn = nthOccurrence(
    firstIndexAfter(now, sched.windows, sched.anchorMs),
    sched.windows,
    sched.anchorMs
  );
  // Defensive-only: firstIndexAfter is strictly-after by construction, so
  // spawn is always future here — the branch exists so a future refactor of
  // the index math can never turn into a late card.
  if (spawn <= now) {
    return { skipped: true, reason: "past-spawn", spawn, subs: 0, sent: 0, pruned: 0 };
  }
  if (spawn - now > PURPLE_LEAD_MS) {
    return { skipped: true, reason: "no-spawn", spawn, subs: 0, sent: 0, pruned: 0 };
  }
  let lastFire: number | null = null;
  try {
    const raw = (await env.PURPLE.get("purple:last-fire", "json")) as unknown;
    const ms = (raw as { spawnMs?: unknown } | null)?.spawnMs;
    if (typeof ms === "number" && Number.isFinite(ms)) lastFire = ms;
  } catch {
    // unreadable guard reads as unfired — the stamp below still converges.
  }
  if (lastFire === spawn) {
    return { skipped: true, reason: "fired-already", spawn, subs: 0, sent: 0, pruned: 0 };
  }
  const [listed] = await tursoPipeline(env, [
    { sql: "SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE lane = ?", args: ["purple"] },
  ]);
  const subs = listed.rows
    .map((r) => ({ endpoint: textOf(r[0]), p256dh: textOf(r[1]), auth: textOf(r[2]) }))
    .filter((s) => s.endpoint.startsWith("https://") && s.p256dh && s.auth);
  if (!subs.length) {
    return { skipped: true, reason: "no-subs", spawn, subs: 0, sent: 0, pruned: 0 };
  }
  const mins = Math.max(1, Math.round((spawn - now) / 60000));
  const body = `女神庭園、冰霜峽谷、雲海曠野各生成一個，預計 ${mins} 分鐘後出現。`;
  const jwtCache = new Map<string, string>();
  const statuses = await mapLimit(subs, 20, async (sub) => {
    const payload = { title: PURPLE_TITLE, body, tag: PURPLE_TAG, url: "/", task: "purple-hole" };
    try {
      const r = await sendPush(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        env,
        jwtCache
      );
      return { endpoint: sub.endpoint, status: r.status };
    } catch {
      return { endpoint: sub.endpoint, status: -1 };
    }
  });
  const sent = statuses.filter((s) => s.status === 201).map((s) => s.endpoint);
  const dead = statuses.filter((s) => s.status === 404 || s.status === 410).map((s) => s.endpoint);
  await writeSendBatch(env, sent, dead, now, "purple");
  // Stamp the fire-once guard only when nothing is retryable: at least one
  // card went out, or every sub was terminally dead (pruned above). A fully
  // transient failure (all status -1) leaves the guard clear so the next
  // */15 tick retries instead of missing a spawn ~36h out.
  if (sent.length > 0 || dead.length === subs.length) {
    await env.PURPLE.put("purple:last-fire", JSON.stringify({ spawnMs: spawn }));
  }
  return { skipped: false, reason: "fanned-out", spawn, subs: subs.length, sent: sent.length, pruned: dead.length };
}

export default {
  async fetch(req: Request, _env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/") {
      return Response.json({ ok: true, worker: "mabiroutine-worker" });
    }
    if (req.method === "GET" && url.pathname === "/purple-schedule") {
      return Response.json(await readSchedule(_env), { headers: SCHEDULE_HEADERS });
    }
    // Belt-and-braces with the page's noindex meta: this robots.txt only
    // governs the worker host itself (the app serves its own), and the
    // bearer secret remains the real gate either way.
    if (req.method === "GET" && url.pathname === "/robots.txt") {
      return new Response("User-agent: *\nDisallow: /admin\nDisallow: /admin/api/\n", {
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
      });
    }
    if (req.method === "GET" && url.pathname === "/admin") {
      return new Response(ADMIN_HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8", ...ADMIN_NOINDEX },
      });
    }
    if (req.method === "POST" && url.pathname === "/admin/api/verify") {
      if (!_env.ADMIN_SECRET) {
        return Response.json({ error: "admin not configured" }, { status: 500 });
      }
      let secret: unknown = null;
      try {
        secret = ((await req.json()) as { secret?: unknown } | null)?.secret ?? null;
      } catch {
        // bad json reads as a failed login, not a 500.
      }
      // Length-check first: timingSafeEqual throws on mismatch, and a
      // throw-vs-false oracle leaks the length.
      if (typeof secret !== "string" || secret.length !== _env.ADMIN_SECRET.length) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
      try {
        const te = new TextEncoder();
        const ok = crypto.subtle.timingSafeEqual(
          te.encode(secret),
          te.encode(_env.ADMIN_SECRET)
        ) as unknown as boolean;
        if (!ok) return Response.json({ error: "unauthorized" }, { status: 401 });
      } catch {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
      return Response.json({ ok: true });
    }
    if (req.method === "GET" && url.pathname === "/admin/api/state") {
      if (!adminAuthed(req, _env)) return Response.json({ error: "unauthorized" }, { status: 401 });
      const [verified, candidates, overrides] = await Promise.all([
        readSchedule(_env),
        readCandidates(_env),
        readOverrides(_env),
      ]);
      return Response.json({ verified, candidates, overrides }, { headers: ADMIN_NOINDEX });
    }
    if (req.method === "POST" && url.pathname === "/admin/api/publish") {
      if (!adminAuthed(req, _env)) return Response.json({ error: "unauthorized" }, { status: 401 });
      let body: unknown = null;
      try {
        body = await req.json();
      } catch {
        // bad json falls through to the 400 below.
      }
      const doc = parseScheduleDoc({
        ...((typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>),
        updatedAt: Date.now(),
        updatedBy: "admin",
        // A hand edit locks auto-apply: the published values persist until
        // resumed, so the next watcher run can't regress an extension fix.
        auto: false,
      });
      if (!doc) {
        return Response.json(
          { error: "anchorMs must be a finite number; every window needs finite startMs < endMs" },
          { status: 400 }
        );
      }
      await _env.PURPLE.put("purple:schedule", JSON.stringify(doc));
      return Response.json({ ok: true, updatedAt: doc.updatedAt });
    }
    if (req.method === "POST" && url.pathname === "/admin/api/promote") {
      if (!adminAuthed(req, _env)) return Response.json({ error: "unauthorized" }, { status: 401 });
      const cand = await readCandidates(_env);
      if (!cand || !cand.windows.length) {
        return Response.json({ ok: true, promoted: 0, message: "no candidates — verified untouched" });
      }
      // Promote is an explicit publish, so it applies even on a locked doc —
      // but through the same resolve as everything else, or a curated
      // override/tombstone would silently drop out of verified and flip-flop
      // back on the next watcher run. Keeps auto-apply on: the adopted values
      // equal the resolved candidates, so future runs just keep them current.
      const current = await readSchedule(_env);
      await resolveAndStore(_env, current.anchorMs, cand.windows, Date.now(), "admin");
      const after = await readSchedule(_env);
      return Response.json({ ok: true, promoted: after.windows.length, updatedAt: after.updatedAt });
    }
    if (req.method === "POST" && url.pathname === "/admin/api/auto") {
      if (!adminAuthed(req, _env)) return Response.json({ error: "unauthorized" }, { status: 401 });
      let body: unknown = null;
      try {
        body = await req.json();
      } catch {
        // bad json falls through to the 400 below.
      }
      const auto = (body as { auto?: unknown } | null)?.auto;
      if (typeof auto !== "boolean") {
        return Response.json({ error: "auto must be a boolean" }, { status: 400 });
      }
      // Lock keeps the published values untouched. Resume re-resolves
      // immediately (candidates when non-empty, else the current windows so
      // an empty parse never wipes) instead of waiting for the next cron.
      const current = await readSchedule(_env);
      if (!auto) {
        const doc = parseScheduleDoc({
          anchorMs: current.anchorMs,
          windows: current.windows,
          updatedAt: Date.now(),
          updatedBy: "admin",
          auto,
        });
        if (!doc) {
          return Response.json({ error: "current values fail validation — untouched" }, { status: 400 });
        }
        await _env.PURPLE.put("purple:schedule", JSON.stringify(doc));
        return Response.json({ ok: true, auto, applied: false, updatedAt: doc.updatedAt });
      }
      const cand = await readCandidates(_env);
      const base = cand && cand.windows.length > 0 ? cand.windows : current.windows;
      const applied = await resolveAndStore(_env, current.anchorMs, base, Date.now(), "admin");
      return Response.json({ ok: true, auto, applied });
    }
    if (req.method === "POST" && url.pathname === "/admin/api/overrides") {
      if (!adminAuthed(req, _env)) return Response.json({ error: "unauthorized" }, { status: 401 });
      let body: unknown = null;
      try {
        body = await req.json();
      } catch {
        // bad json falls through to the 400 below.
      }
      // Missing lists default to [] (clear-all is explicit); garbage in
      // either list rejects the whole save — records never half-apply.
      const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
      const overrides = validWindowsList(b.overrides ?? []);
      const tombstones = validWindowsList(b.tombstones ?? []);
      if (!overrides || !tombstones) {
        return Response.json(
          { error: "overrides/tombstones must be lists of finite startMs < endMs (<=64 each)" },
          { status: 400 }
        );
      }
      await storeOverrides(_env, overrides, tombstones, "admin");
      // Immediate effect when unlocked (same resolve as the watcher,same
      // empty-candidates fallback to the current windows); locked docs stay
      // frozen until resumed.
      const current = await readSchedule(_env);
      let applied = false;
      if (current.auto) {
        const cand = await readCandidates(_env);
        const base = cand && cand.windows.length > 0 ? cand.windows : current.windows;
        applied = await resolveAndStore(_env, current.anchorMs, base, Date.now(), "admin");
      }
      return Response.json({ ok: true, applied });
    }
    return Response.json({ error: "not found" }, { status: 404 });
  },

  async scheduled(event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    const at = new Date(event.scheduledTime).toISOString();
    if (event.cron === "0 * * * *") {
      try {
        console.log(`barrier fanout ${at}: ${JSON.stringify(await runBarrierFanout(env))}`);
      } catch (e) {
        console.log(`barrier fanout ${at} error: ${String(e)}`);
      }
      return;
    }
    if (event.cron === "*/15 * * * *") {
      try {
        console.log(`purple fanout ${at}: ${JSON.stringify(await runPurpleFanout(env))}`);
      } catch (e) {
        console.log(`purple fanout ${at} error: ${String(e)}`);
      }
      return;
    }
    if (event.cron === "17 3,15 * * *") {
      try {
        console.log(`purple watch ${at}: ${JSON.stringify(await runPurpleWatch(env))}`);
      } catch (e) {
        console.log(`purple watch ${at} error: ${String(e)}`);
      }
      return;
    }
    console.log(`tick: ${event.cron} (stub) at ${at}`);
  },
} satisfies ExportedHandler<Env>;
