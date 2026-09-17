// mabiroutine-worker: push fanout + purple schedule feed + admin + watcher.
// Full-worker fanout (verdict A, proven 2026-09-17): the hourly cron reads
// push_subscriptions straight from Turso and sends here — no Vercel fanout
// route exists. Timing/tag math is imported from the app source (one module,
// two runtimes — the lib is DOM-free, window refs guarded).
//
// Secrets (wrangler secret put, never committed): VAPID_JWK (app P-256 key,
// JWK JSON), VAPID_SUBJECT (mailto:/URL contact), TURSO_DB_URL (https),
// TURSO_AUTH_TOKEN (same token as Vercel; full-access — Turso issues no
// read-only tokens at our tier), SPIKE_SECRET (bearer for the temporary
// /spike-send + /fanout-test routes; deleted with them).

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
  SPIKE_SECRET?: string;
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

function bearerOk(req: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const got = req.headers.get("Authorization") ?? "";
  const a = new TextEncoder().encode(got);
  const b = new TextEncoder().encode(`Bearer ${secret}`);
  return a.length === b.length && crypto.subtle.timingSafeEqual(a, b);
}

// ---- Turso reads/writes (raw /v2/pipeline over fetch — dependency-free;
// the worker needs no ORM for one SELECT plus prune/update batches). ----

type TursoValue = { type: "text" | "integer" | "float" | "blob" | "null"; value?: unknown };
type TursoResult = {
  cols: string[];
  rows: TursoValue[][];
};

async function tursoPipeline(
  env: Env,
  stmts: { sql: string; args?: unknown[] }[],
): Promise<TursoResult[]> {
  if (!env.TURSO_DB_URL || !env.TURSO_AUTH_TOKEN) throw new Error("turso secrets missing");
  const res = await fetch(`${env.TURSO_DB_URL}/v2/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.TURSO_AUTH_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ requests: stmts.map((s) => ({ type: "execute", stmt: s })) }),
  });
  if (!res.ok) throw new Error(`turso ${res.status}`);
  const doc = (await res.json()) as {
    results?: { type: string; response?: { type: string; result?: { cols: ({ name: string } | string)[]; rows: TursoValue[][] } } }[];
  };
  return (doc.results ?? []).map((r) => {
    if (r?.type !== "ok" || r.response?.type !== "execution" || !r.response.result) {
      throw new Error("turso bad shape");
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
};

/**
 * Hourly barrier fanout. Staleness guard first (D4): the useful window ends
 * at :02:00 Taipei — a delayed tick degrades to a clean miss, never a
 * misleading card. Then one batched read, concurrent sends, and a single
 * write batch (dead-endpoint prune on 404/410 + last_sent_at stamps).
 *
 * Card copy is deliberately NOT the Phase-0 body: the server knows no
 * done-state (D1, unfiltered bell-only fanout), so there are no names to
 * print — the start time (derived from EVENT_SEC_PAST_HOUR, same source as
 * the local lane) is the actionable half. Tap deep-links task-only; the
 * page resolves the first undone character, like a char-less local card.
 */
export async function runBarrierFanout(env: Env): Promise<FanoutReport> {
  const now = Date.now();
  if (secIntoHour(now) > EVENT_SEC_PAST_HOUR - CATCHUP_MIN_SEC) {
    return { skipped: true, reason: "past-cutoff", subs: 0, sent: 0, pruned: 0 };
  }
  const [listed] = await tursoPipeline(env, [
    { sql: "SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE lane = ?", args: ["hourly"] },
  ]);
  const subs = listed.rows
    .map((r) => ({ endpoint: textOf(r[0]), p256dh: textOf(r[1]), auth: textOf(r[2]) }))
    .filter((s) => s.endpoint.startsWith("https://") && s.p256dh && s.auth);
  if (!subs.length) return { skipped: true, reason: "no-subs", subs: 0, sent: 0, pruned: 0 };
  const mm = String(Math.floor(EVENT_SEC_PAST_HOUR / 60)).padStart(2, "0");
  const ss = String(EVENT_SEC_PAST_HOUR % 60).padStart(2, "0");
  const payload = {
    title: "不祥的召喚結界出現了",
    body: `結界開場了，${mm}:${ss} 開始。`,
    tag: HOURLY_TAG,
    data: { url: "/", task: "barrier" },
  };
  const jwtCache = new Map<string, string>();
  const statuses = await mapLimit(subs, 20, (sub) =>
    sendPush(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      payload,
      env,
      jwtCache,
    )
      .then((r) => ({ endpoint: sub.endpoint, status: r.status }))
      .catch(() => ({ endpoint: sub.endpoint, status: -1 })),
  );
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
  return { skipped: false, reason: "fanned-out", subs: subs.length, sent: sent.length, pruned: dead.length };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/") {
      return Response.json({ ok: true, worker: "mabiroutine-worker" });
    }
    // TEMPORARY test hook (bearer-guarded): runs the real fanout path on
    // demand so it can be proven without waiting for :00. Deleted with
    // /spike-send once the hourly tick proves itself for real.
    if (req.method === "POST" && url.pathname === "/fanout-test") {
      if (!bearerOk(req, env.SPIKE_SECRET)) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
      try {
        return Response.json(await runBarrierFanout(env));
      } catch (e) {
        return Response.json({ error: String(e) }, { status: 500 });
      }
    }
    if (req.method === "POST" && url.pathname === "/spike-send") {
      if (!bearerOk(req, env.SPIKE_SECRET)) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
      try {
        const { subscription, title, body, tag } = (await req.json()) as {
          subscription: PushSubscriptionJson;
          title: string;
          body: string;
          tag: string;
        };
        const r = await sendPush(subscription, { title, body, tag }, env);
        return Response.json({ ok: r.status === 201, pushStatus: r.status, detail: r.detail });
      } catch (e) {
        return Response.json({ error: String(e) }, { status: 500 });
      }
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
