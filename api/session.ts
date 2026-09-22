import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_db/index.js";
import type { SessionMeta } from "./_db/types.js";

// Sync-session API for URL-based cross-device sync (spec: shared session,
// per-key last-write-wins by server arrival order, server-minted ids).
//
// Every mutation is an absolute set of flat string keys, so merges are
// deterministic and conflict-free — no 409s, no versions, no clocks.
// Key space (client translates to/from the store shape):
//   v:{charId}:{taskId}@{bucket}  task values (number|boolean), cycle-tagged
//   acc:{taskId}@{bucket}         account values (same tagging)
//   hide:{charId}:{taskId} | hide:acc:{taskId}   hidden flags (true)
//   pin:{barterId}                barter pin membership (true; unpin = false)
//   custom:{id}                   custom task object | null (tombstone, retained)
//   char:{id}:name | char:{id}:alive             character fields
//   meta:active                   active character id
//   meta:charorder                character tab order, comma-joined cids
//   pref:hideCompleted | filter:{prio,town,skill,pinned}
// Drag order, pin order, and reset markers stay per-device local and never
// sync; character tabs do (meta:charorder, last writer wins, then sticks) so
// linked devices converge instead of splitting permanently at adopt time.
//
// Storage (docs/sql-migration.md): one `sessions` probe row per session plus
// one `kv` row per flat key, written as ONE atomic unit per PATCH — concurrent
// PATCHes from two devices are per-field last-writer-wins and can never
// interleave a read-modify-write and drop each other's keys (the old
// single-blob layout did exactly that). Values carry a "j:" tag so they
// survive serialization as plain strings. Fields starting with "~" are
// reserved (meta); clients sending them get 400. Keys outside the known
// prefixes, prototype-pollution names, arrays, and over-long strings/objects
// get 400; sessions are capped at 5000 fields (413 past that).
//
// Cycle-key tombstones (null for v:/acc: keys with a bucket) are physically
// deleted, not retained — expired buckets must not count against the field
// budget forever. All other tombstones are retained rows (same as the Redis
// layout). Pre-hash records (v1 whole-state blobs and v2 blobs under a bare
// key) are still served; the first PATCH upgrades them in place.
//
// Sessions expire after 180 days without a read/write (sliding TTL, refreshed
// by the daily touch beacon) — a leaked link stops working instead of living
// forever. Rate limits key on the verified client IP (x-real-ip, else the last
// forwarded entry), never the spoofable leftmost entry. The limiter is
// per-instance in memory by design (docs/sql-migration.md decision 6).
//
// POST   /api/session  { state: flat map }       -> { id, updatedAt }
// GET    /api/session?id=...                     -> { state: flat map, updatedAt } | 404
//   ?meta=1  -> { updatedAt } (+ legacy:true for pre-hash records); never
//               touches the TTL — polls use it to skip unchanged full GETs.
//   ?touch=1 -> refresh the 180-day sliding TTL (PATCH takes { touch: 1 }).
// PATCH  /api/session  { id, changes: {k: v} }   -> { updatedAt } | 404
// DELETE /api/session  { id }                    -> 200 (idempotent)
//
// Env: DATABASE_URL / TURSO_DATABASE_URL (see api/_db/index.ts). Local dev
// falls back to a `file:` SQLite database, so no cloud credentials are needed.

// Hard cap per spec: progress values are ~25KB, 200KB leaves 8x headroom
// while keeping a single value far under any request limit.
const MAX_STATE_BYTES = 200 * 1024;

// POST / create is the abuse-sensitive endpoint (mints keys): 10/hr per IP.
// Everything else: 60/min per IP — invisible to humans, fatal to scripts.
// Non-prod namespaces get roomy budgets so the regression gate never trips
// them. Gated on the server-side env signal, so prod abuse protection is
// untouched.
const IS_TEST_NS = (process.env.SYNC_KEY_PREFIX ?? "mabiroutine:") !== "mabiroutine:";
const RL_CREATE_LIMIT = IS_TEST_NS ? 500 : 10;
const RL_CREATE_WINDOW_S = 3600;
const RL_GENERAL_LIMIT = IS_TEST_NS ? 600 : 60;
const RL_GENERAL_WINDOW_S = 60;

// Session lifetime: a leaked link must not work forever. Every file: touch
// path refreshes the sliding TTL; ordinary polls skip it (daily beacon only).
const SESSION_TTL_S = 180 * 24 * 3600;
const expiresAt = (now: number): number => now + SESSION_TTL_S * 1000;

type SessionLegacy = {
  v?: unknown;
  updatedAt: number;
  state?: unknown;
  keys?: Record<string, { seq: number; v: unknown }>;
};

// Fixed-window limiter, per process. Best-effort: not shared across instances
// and reset on cold start — runaway-loop hygiene, not security (the app is
// unauthenticated and sessions are free to mint). Never touches the database.
const windows = new Map<string, { count: number; resetAt: number }>();
function overLimit(key: string, limit: number, windowS: number): boolean {
  const now = Date.now();
  const w = windows.get(key);
  if (!w || w.resetAt <= now) {
    if (windows.size > 10000) {
      for (const [k, v] of windows) if (v.resetAt <= now) windows.delete(k);
    }
    windows.set(key, { count: 1, resetAt: now + windowS * 1000 });
    return false;
  }
  w.count += 1;
  return w.count > limit;
}

// TTL-renewal beacon: GET/PATCH refresh the 180-day sliding TTL only when the
// client asks (?touch=1 / {touch: 1}, sent at most once/day per session).
function wantsTouch(value: unknown): boolean {
  return value === 1 || value === "1" || value === true;
}

function clientIp(req: VercelRequest): string {
  // Rate-limit keying must not trust the leftmost x-forwarded-for entry: the
  // client controls it and can rotate arbitrary prefixes to dodge per-IP
  // budgets (and poison writerId). Vercel overwrites x-real-ip with the
  // verified connecting IP, so prefer it; otherwise take the LAST forwarded
  // entry (closest to the edge, appended by trusted proxies).
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

function validFlat(state: unknown): state is Record<string, unknown> {
  return !!state && typeof state === "object" && !Array.isArray(state);
}

// "~"-prefixed fields are server-reserved (meta). Reject them outright so no
// client can forge session metadata through POST/PATCH.
function hasReservedKey(map: Record<string, unknown>): boolean {
  return Object.keys(map).some((k) => k.startsWith("~"));
}

// Flat key-space allowlist (docs/sync.md rev 3): the server stays
// schema-agnostic but refuses anything outside the known prefixes, plus
// prototype-pollution names that would be hazardous if a future merge ever
// used assignment instead of spread/JSON round-trips. Keeps a compromised or
// curious bearer from turning a session into arbitrary junk storage and bounds
// per-key memory. CJK barter ids are legitimate, so no charset gate.
const KEY_PREFIXES = ["v:", "acc:", "hide:", "pin:", "custom:", "char:", "meta:", "pref:", "filter:"];
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_KEY_LEN = 128;
const MAX_STR_LEN = 500;
const MAX_VALUE_BYTES = 8 * 1024;
const MAX_KEYS_PER_REQUEST = 2000;
const MAX_HASH_FIELDS = 5000;

function validSyncKey(k: string): boolean {
  if (!k || k.length > MAX_KEY_LEN) return false;
  if (FORBIDDEN_KEYS.has(k)) return false;
  return KEY_PREFIXES.some((p) => k.startsWith(p));
}

function validSyncValue(v: unknown): boolean {
  if (v === null || typeof v === "boolean") return true;
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v === "string") return v.length <= MAX_STR_LEN;
  if (typeof v === "object") {
    if (Array.isArray(v)) return false;
    try {
      return JSON.stringify(v).length <= MAX_VALUE_BYTES;
    } catch {
      return false;
    }
  }
  return false; // undefined, bigint, function, symbol — never valid on the wire
}

// Shape-guard for a POST/PATCH map. Returns an error string, or null when ok.
function invalidMapReason(map: Record<string, unknown>): string | null {
  const keys = Object.keys(map);
  if (keys.length > MAX_KEYS_PER_REQUEST) return "too many keys";
  for (const k of keys) {
    if (!validSyncKey(k)) return `invalid key: ${k.slice(0, 64)}`;
    if (!validSyncValue(map[k])) return `invalid value for key: ${k.slice(0, 64)}`;
  }
  return null;
}

// Cycle key: v:/acc: with a "@bucket" suffix (mirrors src/lib/cycle.ts
// parseCycleKey — duplicated here so the server bundle never pulls in the
// client data files the client module imports).
function isCycleKey(k: string): boolean {
  if (!k.startsWith("v:") && !k.startsWith("acc:")) return false;
  return k.lastIndexOf("@") >= 0;
}

function validId(id: unknown): id is string {
  return (
    typeof id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
  );
}

function bodyOf(req: VercelRequest): { id?: unknown; state?: unknown; changes?: unknown; touch?: unknown } {
  // req.body parses lazily on some platforms: vercel dev throws (ApiError 400)
  // on malformed JSON instead of answering 400, and the uncaught throw kills
  // the dev server. Treat unparseable as absent — validators 400/404 below.
  let b: unknown;
  try {
    b = req.body;
  } catch {
    return {};
  }
  if (!b || typeof b !== "object") return {};
  return b as { id?: unknown; state?: unknown; changes?: unknown; touch?: unknown };
}

const enc = (v: unknown): string => `j:${JSON.stringify(v)}`;

function dec(raw: unknown): unknown {
  if (typeof raw !== "string" || !raw.startsWith("j:")) return undefined;
  try {
    return JSON.parse(raw.slice(2)) as unknown;
  } catch {
    return undefined;
  }
}

function encodeAll(map: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) {
    if (v === undefined) continue;
    out[k] = enc(v);
  }
  return out;
}

// Legacy v2 keys map -> tagged base for the upgrade merge (v1 blobs have no
// per-key base; the client sends a full flat map after seeing the marker).
function legacyBaseFrom(raw: string): Record<string, string> {
  try {
    const rec = JSON.parse(raw) as SessionLegacy;
    if (rec && typeof rec === "object" && rec.v === 2 && rec.keys) {
      const out: Record<string, string> = {};
      for (const [k, e] of Object.entries(rec.keys)) out[k] = enc(e.v);
      return out;
    }
  } catch {
    // unparseable — treat as an opaque legacy record
  }
  return {};
}

function parseLegacy(raw: string): SessionLegacy | null {
  try {
    const rec = JSON.parse(raw) as SessionLegacy;
    return rec && typeof rec === "object" ? rec : null;
  } catch {
    return null;
  }
}

async function handlePost(req: VercelRequest, res: VercelResponse): Promise<void> {
  const db = getDb();
  if (overLimit(`create:${clientIp(req)}`, RL_CREATE_LIMIT, RL_CREATE_WINDOW_S)) {
    res.status(429).json({ error: "too many sessions created, try again later" });
    return;
  }
  const { state } = bodyOf(req);
  if (!validFlat(state)) {
    res.status(400).json({ error: "state must be a flat key map" });
    return;
  }
  if (hasReservedKey(state)) {
    res.status(400).json({ error: "reserved key prefix" });
    return;
  }
  const postReason = invalidMapReason(state);
  if (postReason) {
    res.status(400).json({ error: postReason });
    return;
  }
  if (JSON.stringify(state).length > MAX_STATE_BYTES) {
    res.status(413).json({ error: "state too large" });
    return;
  }
  const id = crypto.randomUUID();
  const now = Date.now();
  // UUIDv4 collision is ~impossible, but overwriting an existing session
  // would be data loss — check before writing (POST is rare).
  if (await db.probe(id, now)) {
    res.status(500).json({ error: "id collision, retry" });
    return;
  }
  const meta: SessionMeta = { v: 2, updatedAt: now, writerId: clientIp(req), seq: Object.keys(state).length };
  await db.create(id, encodeAll(state), enc(meta), now, expiresAt(now));
  res.status(200).json({ id, updatedAt: now });
}

async function handleGet(req: VercelRequest, res: VercelResponse): Promise<void> {
  const db = getDb();
  if (overLimit(`get:${clientIp(req)}`, RL_GENERAL_LIMIT, RL_GENERAL_WINDOW_S)) {
    res.status(429).json({ error: "rate limited" });
    return;
  }
  const raw = req.query.id;
  const id = Array.isArray(raw) ? raw[0] : raw;
  if (!validId(id)) {
    res.status(404).json({ error: "unknown session" });
    return;
  }
  const now = Date.now();
  // Freshness probe (quota §): ?meta=1 returns only {updatedAt} (+legacy) so
  // unchanged polls skip the full read. Never touches the TTL.
  const metaOnly = req.query.meta === "1" || req.query.meta === "true";
  if (metaOnly) {
    const p = await db.probe(id, now);
    if (!p) {
      res.status(404).json({ error: "unknown session" });
      return;
    }
    if (p.hasHash) res.status(200).json({ updatedAt: p.updatedAt });
    else res.status(200).json({ updatedAt: p.updatedAt, legacy: true });
    return;
  }
  const p = await db.probe(id, now);
  if (!p) {
    res.status(404).json({ error: "unknown session" });
    return;
  }
  if (p.hasHash) {
    const h = await db.readHash(id, now);
    const meta = h ? (dec(h.meta) as SessionMeta | undefined) : undefined;
    if (h && meta && typeof meta === "object" && meta.v === 2) {
      const state: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(h.fields)) {
        const d = dec(v);
        if (d !== undefined) state[k] = d;
      }
      if (wantsTouch(req.query.touch)) await db.touch(id, expiresAt(now));
      res.status(200).json({ state, updatedAt: meta.updatedAt });
      return;
    }
    // meta missing/invalid: fall through to the legacy layout, as the old
    // readHash-returns-null path did.
  }
  const legacyRaw = await db.readLegacy(id, now);
  if (!legacyRaw) {
    res.status(404).json({ error: "unknown session" });
    return;
  }
  const record = parseLegacy(legacyRaw);
  if (!record) {
    res.status(404).json({ error: "unknown session" });
    return;
  }
  if (wantsTouch(req.query.touch)) await db.touch(id, expiresAt(now));
  if (record.v !== 2) {
    // Pre-flat session (v1 whole-state blob): the client flattens locally and
    // upgrades on its next push. Serve the blob as-is under a marker shape.
    res.status(200).json({ legacy: (record as unknown as { state?: unknown }).state, updatedAt: record.updatedAt });
    return;
  }
  const state: Record<string, unknown> = {};
  for (const [k, e] of Object.entries(record.keys ?? {})) state[k] = e.v;
  res.status(200).json({ state, updatedAt: record.updatedAt });
}

// PATCH applies absolute key-sets as ONE atomic write: per-field
// last-arrival-wins, deterministic, no versions, no clocks, no 409s — and
// concurrent PATCHes can no longer clobber each other. A legacy record
// upgrades in place in the same transaction.
async function handlePatch(req: VercelRequest, res: VercelResponse): Promise<void> {
  const db = getDb();
  if (overLimit(`patch:${clientIp(req)}`, RL_GENERAL_LIMIT, RL_GENERAL_WINDOW_S)) {
    res.status(429).json({ error: "rate limited" });
    return;
  }
  const { id, changes, touch } = bodyOf(req);
  // Never reveal whether an id exists: malformed ids 404 like missing ones.
  if (!validId(id)) {
    res.status(404).json({ error: "unknown session" });
    return;
  }
  if (!validFlat(changes)) {
    res.status(400).json({ error: "changes must be a flat key map" });
    return;
  }
  if (hasReservedKey(changes)) {
    res.status(400).json({ error: "reserved key prefix" });
    return;
  }
  const patchReason = invalidMapReason(changes);
  if (patchReason) {
    res.status(400).json({ error: patchReason });
    return;
  }
  if (JSON.stringify(changes).length > MAX_STATE_BYTES) {
    res.status(413).json({ error: "changes too large" });
    return;
  }
  const now = Date.now();
  const p = await db.probe(id, now);
  if (!p) {
    res.status(404).json({ error: "unknown session" });
    return;
  }
  const upserts: Record<string, string> = {};
  const deletes: string[] = [];
  for (const [k, v] of Object.entries(changes)) {
    if (v === null && isCycleKey(k)) deletes.push(k);
    else upserts[k] = enc(v);
  }
  let legacyBase: Record<string, string> | undefined;
  if (!p.hasHash && p.hasLegacy) {
    const legacyRaw = await db.readLegacy(id, now);
    if (legacyRaw == null) {
      res.status(404).json({ error: "unknown session" });
      return;
    }
    legacyBase = legacyBaseFrom(legacyRaw);
  }
  const meta: SessionMeta = { v: 2, updatedAt: now, writerId: clientIp(req), seq: p.seq + 1 };
  const result = await db.apply(id, upserts, deletes, enc(meta), now, MAX_HASH_FIELDS, legacyBase);
  if (!result.ok) {
    if (result.reason === "too_large") {
      res.status(413).json({ error: "session too large" });
      return;
    }
    res.status(404).json({ error: "unknown session" });
    return;
  }
  if (wantsTouch(touch)) await db.touch(id, expiresAt(now));
  res.status(200).json({ updatedAt: meta.updatedAt });
}

async function handleDelete(req: VercelRequest, res: VercelResponse): Promise<void> {
  const db = getDb();
  if (overLimit(`del:${clientIp(req)}`, RL_GENERAL_LIMIT, RL_GENERAL_WINDOW_S)) {
    res.status(429).json({ error: "rate limited" });
    return;
  }
  const { id } = bodyOf(req);
  if (!validId(id)) {
    res.status(404).json({ error: "unknown session" });
    return;
  }
  await db.delete(id);
  res.status(200).json({ ok: true });
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // Sync state must never be cached anywhere: a stale GET adopted wholesale
  // by a client pull wipes newer local keys (then tombstones them server-side).
  res.setHeader("Cache-Control", "no-store");
  // A DB error (e.g. SQLITE_BUSY under concurrent writers) must answer 500,
  // never escape: an uncaught throw kills the whole dev server (proven
  // 2026-09-15 by LocalDb.tx's BEGIN IMMEDIATE under parallel PATCH).
  try {
    switch (req.method) {
      case "POST":
        return handlePost(req, res);
      case "GET":
        return handleGet(req, res);
      case "PATCH":
        return handlePatch(req, res);
      case "DELETE":
        return handleDelete(req, res);
      default:
        res.status(405).json({ error: "method not allowed" });
    }
  } catch {
    if (!res.headersSent) res.status(500).json({ error: "internal" });
  }
}
