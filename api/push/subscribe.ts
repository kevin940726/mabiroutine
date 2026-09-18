import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "../_db/index.js";
import type { PushSubscription, RosterEntry } from "../_db/types.js";

// Push-subscription registry for the server-push fanout (plan: full-worker
// fanout — the worker reads this same table straight from Turso; this route
// is only the subscribe/unsubscribe door).
//
// POST   /api/push/subscribe  { subscription: { endpoint, keys: { p256dh, auth } }, platform?, lane?, linkSessionId?, roster? }
//        -> { ok: true } | 400. Upsert by (endpoint, lane): re-subscribing refreshes
//        the row instead of growing the table, and two lanes on one device
//        (same endpoint) keep separate rows. linkSessionId (a sync session
//        UUID the device holds) + roster ([{cid, name}]) enable named cards
//        (D1a, hourly only — the purple lane is unfiltered); either absent →
//        the generic copy.
// DELETE /api/push/subscribe  { endpoint, lane? } -> { ok: true } (idempotent).
//        Scoped to the lane when given; without it deletes every row for the
//        endpoint (legacy full-unsubscribe).
//
// Validation is structural, not cryptographic: malformed keys 400 here, and
// endpoints that reject at send time are pruned by the fanout on 404/410.
// `lane` is an allowlist ("hourly" / "purple") — expansion is a one-line change,
// not a refactor (same discipline as HOURLY_ELIGIBLE_IDS).
//
// Env: same DATABASE_URL / TURSO resolution as the sync backend (local dev
// falls back to the throwaway `file:` database).

const B64URL = /^[A-Za-z0-9\-_]+$/;
const MAX_ENDPOINT_LEN = 2048;
const LANES = ["hourly", "purple"];
const PLATFORMS = ["win", "mac", "linux", "android", "ios", "other"];

// Subscribe mints no keys and fires at bell-tap frequency: the general
// per-IP budget (mirroring session.ts, same non-prod signal), not the
// 10/hr create budget.
const IS_TEST_NS = (process.env.SYNC_KEY_PREFIX ?? "mabiroutine:") !== "mabiroutine:";
const RL_LIMIT = IS_TEST_NS ? 600 : 60;
const RL_WINDOW_S = 60;

const windows = new Map<string, { count: number; resetAt: number }>();
function overLimit(key: string): boolean {
  const now = Date.now();
  const w = windows.get(key);
  if (!w || w.resetAt <= now) {
    if (windows.size > 10000) {
      for (const [k, v] of windows) if (v.resetAt <= now) windows.delete(k);
    }
    windows.set(key, { count: 1, resetAt: now + RL_WINDOW_S * 1000 });
    return false;
  }
  w.count += 1;
  return w.count > RL_LIMIT;
}

function clientIp(req: VercelRequest): string {
  const real = req.headers["x-real-ip"];
  if (Array.isArray(real) && real[0]?.trim()) return real[0].trim();
  if (typeof real === "string" && real.trim()) return real.trim();
  const fwd = req.headers["x-forwarded-for"];
  if (Array.isArray(fwd)) {
    const last = fwd[fwd.length - 1]?.trim();
    if (last) return last;
  }
  if (typeof fwd === "string" && fwd) {
    const parts = fwd.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return "unknown";
}

function bodyOf(req: VercelRequest): Record<string, unknown> {
  let b: unknown;
  try {
    b = req.body;
  } catch {
    return {};
  }
  if (!b || typeof b !== "object") return {};
  return b as Record<string, unknown>;
}

// base64url string decoding to exactly `len` bytes, or null. Returns the
// original string on success (callers keep the wire form). Rejects
// non-alphabet garbage (Buffer.from silently skips it) so junk keys 400
// instead of landing as short rows the fanout would choke on.
function keyString(s: unknown, len: number): string | null {
  if (typeof s !== "string" || s.length === 0 || s.length > 256 || !B64URL.test(s)) return null;
  try {
    return Buffer.from(s, "base64url").length === len ? s : null;
  } catch {
    return null;
  }
}

function validEndpoint(e: unknown): e is string {
  return typeof e === "string" && e.startsWith("https://") && e.length <= MAX_ENDPOINT_LEN;
}

// Session-id shape (UUIDv4 — mirrors validId in api/session.ts, duplicated
// so this route never imports the session handler's internals).
function validSessionId(id: unknown): id is string {
  return (
    typeof id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
  );
}

// Roster snapshot: ordering + fallback names for linked cards (D1a). Caps
// keep one row small; cids must not contain ":" (they're key segments
// server-side — a colon would break key parsing downstream).
function validRoster(r: unknown): r is RosterEntry[] {
  if (!Array.isArray(r) || r.length > 32) return false;
  for (const e of r) {
    if (!e || typeof e !== "object") return false;
    const { cid, name } = e as { cid?: unknown; name?: unknown };
    if (typeof cid !== "string" || cid.length === 0 || cid.length > 64 || cid.includes(":")) return false;
    if (typeof name !== "string" || name.length > 32) return false;
  }
  return true;
}

async function handlePost(req: VercelRequest, res: VercelResponse): Promise<void> {
  const db = getDb();
  if (overLimit(`push-sub:${clientIp(req)}`)) {
    res.status(429).json({ error: "rate limited" });
    return;
  }
  const body = bodyOf(req);
  const sub = body.subscription as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | undefined;
  const endpoint = sub?.endpoint;
  if (!validEndpoint(endpoint)) {
    res.status(400).json({ error: "subscription.endpoint must be an https URL" });
    return;
  }
  const p256dh = keyString(sub?.keys?.p256dh, 65);
  const auth = keyString(sub?.keys?.auth, 16);
  if (!p256dh || !auth) {
    res.status(400).json({ error: "subscription.keys must be base64url p256dh (65B) + auth (16B)" });
    return;
  }
  const lane = body.lane ?? "hourly";
  if (typeof lane !== "string" || !LANES.includes(lane)) {
    res.status(400).json({ error: "unknown lane" });
    return;
  }
  const platform = typeof body.platform === "string" && PLATFORMS.includes(body.platform) ? body.platform : "other";
  // Session linkage (D1a, opt-in by subscribing): a session id the device
  // already holds (knowledge = capability, same as sync links) plus a roster
  // snapshot. Either absent → the generic copy. Malformed → 400, never
  // silently dropped (a dropped link would mislead the bell into thinking
  // names are coming).
  const linkRaw = body.linkSessionId ?? null;
  if (linkRaw !== null && !validSessionId(linkRaw)) {
    res.status(400).json({ error: "linkSessionId must be a session UUID" });
    return;
  }
  const rosterRaw = body.roster ?? null;
  if (rosterRaw !== null && !validRoster(rosterRaw)) {
    res.status(400).json({ error: "roster must be [{cid, name}] (<=32)" });
    return;
  }
  const now = Date.now();
  const row: PushSubscription = {
    endpoint,
    p256dh,
    auth,
    platform,
    lane,
    createdAt: now,
    lastSentAt: null,
    linkSession: linkRaw,
    roster: rosterRaw,
  };
  await db.upsertPushSub(row);
  res.status(200).json({ ok: true });
}

async function handleDelete(req: VercelRequest, res: VercelResponse): Promise<void> {
  const db = getDb();
  if (overLimit(`push-del:${clientIp(req)}`)) {
    res.status(429).json({ error: "rate limited" });
    return;
  }
  const { endpoint, lane } = bodyOf(req);
  if (!validEndpoint(endpoint)) {
    res.status(400).json({ error: "endpoint must be an https URL" });
    return;
  }
  if (lane !== undefined && (typeof lane !== "string" || !LANES.includes(lane))) {
    res.status(400).json({ error: "unknown lane" });
    return;
  }
  await db.deletePushSub(endpoint, typeof lane === "string" ? lane : undefined);
  res.status(200).json({ ok: true });
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader("Cache-Control", "no-store");
  try {
    switch (req.method) {
      case "POST":
        return handlePost(req, res);
      case "DELETE":
        return handleDelete(req, res);
      default:
        res.status(405).json({ error: "method not allowed" });
    }
  } catch {
    if (!res.headersSent) res.status(500).json({ error: "internal" });
  }
}
