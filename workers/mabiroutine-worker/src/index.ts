// mabiroutine-worker: push fanout + purple schedule feed + admin + watcher.
// Spike A (plan §2A): full Web Push send (VAPID + aes128gcm) in pure
// WebCrypto, exercised via POST /spike-send against one real test
// subscription. If the spike lands a real card, fanout lives here and the
// Vercel fanout route never gets built; if it fights back, this route is
// deleted and the worker drops to a dumb scheduler.
//
// Secrets (wrangler secret put, never committed): VAPID_JWK (app P-256 key,
// JWK JSON), VAPID_SUBJECT (mailto:/URL contact), SPIKE_SECRET (bearer for
// the spike route; deleted with the route).

type Env = {
  PURPLE: KVNamespace;
  VAPID_JWK?: string;
  VAPID_SUBJECT?: string;
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

/** VAPID Authorization header (RFC 8292): ES256 JWT over the push origin. */
async function vapidAuthHeader(
  endpoint: string,
  jwk: JsonWebKey,
  subject: string,
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
  return `vapid t=${head}.${body}.${bytesToB64url(sig)}, k=${bytesToB64url(pub)}`;
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
): Promise<{ status: number; detail: string }> {
  if (!env.VAPID_JWK || !env.VAPID_SUBJECT) throw new Error("VAPID secrets missing");
  const data = new TextEncoder().encode(JSON.stringify(payload));
  const [body, authz] = await Promise.all([
    encryptAes128gcm(data, b64urlToBytes(sub.keys.p256dh), b64urlToBytes(sub.keys.auth)),
    vapidAuthHeader(sub.endpoint, JSON.parse(env.VAPID_JWK) as JsonWebKey, env.VAPID_SUBJECT),
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

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/") {
      return Response.json({ ok: true, worker: "mabiroutine-worker" });
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

  // Stub: proves cron wiring via `wrangler tail` until verdict A lands the
  // real fanout (or drops the worker to a dumb VercelPOST scheduler).
  async scheduled(event: ScheduledEvent, _env: Env, _ctx: ExecutionContext): Promise<void> {
    console.log(`tick: ${event.cron} at ${new Date(event.scheduledTime).toISOString()}`);
  },
} satisfies ExportedHandler<Env>;
