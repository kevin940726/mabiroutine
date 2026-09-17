// mabiroutine-worker: push fanout + purple schedule feed + admin + watcher.
// Full-worker fanout (verdict A, proven 2026-09-17): the hourly cron reads
// push_subscriptions straight from Turso and sends here — no Vercel fanout
// route exists. Timing/tag math is imported from the app source (one module,
// two runtimes — the lib is DOM-free, window refs guarded).
//
// Secrets (wrangler secret put, never committed): VAPID_JWK (app P-256 key,
// JWK JSON), VAPID_SUBJECT (mailto:/URL contact), TURSO_DB_URL (https),
// TURSO_AUTH_TOKEN (same token as Vercel; full-access — Turso issues no
// read-only tokens at our tier). (SPIKE_SECRET + the temporary
// /spike-send + /fanout-test + /db-test routes died 2026-09-17 with the
// proven fanout — fetch is health + scheduled only.)

import {
  CATCHUP_MIN_SEC,
  EVENT_SEC_PAST_HOUR,
  HOURLY_TAG,
  secIntoHour,
} from "../../../src/lib/hourlyReminders";

type Env = {
  PURPLE: KVNamespace;
  VAPID_JWK?: string;
  VAPID_SUBJECT?: string;
  TURSO_DB_URL?: string;
  TURSO_AUTH_TOKEN?: string;
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
  // the start time (derived from EVENT_SEC_PAST_HOUR, same source as the
  // local lane) is the actionable half.
  const mm = String(Math.floor(EVENT_SEC_PAST_HOUR / 60)).padStart(2, "0");
  const ss = String(EVENT_SEC_PAST_HOUR % 60).padStart(2, "0");
  const genericBody = `結界開場了，${mm}:${ss} 開始。`;
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
  const batch: { sql: string; args: unknown[] }[] = [];
  for (const e of dead) batch.push({ sql: "DELETE FROM push_subscriptions WHERE endpoint = ?", args: [e] });
  if (sent.length) {
    const ph = sent.map(() => "?").join(",");
    batch.push({
      sql: `UPDATE push_subscriptions SET last_sent_at = ? WHERE endpoint IN (${ph})`,
      args: [now, ...sent],
    });
  }
  if (batch.length) await tursoPipeline(env, batch);
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

export default {
  async fetch(req: Request, _env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/") {
      return Response.json({ ok: true, worker: "mabiroutine-worker" });
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
    // Purple 15-min tick + Bahamut watcher land on later branches — the
    // wiring proof stays a log line until then.
    console.log(`tick: ${event.cron} (stub) at ${at}`);
  },
} satisfies ExportedHandler<Env>;
