import { Redis } from "@upstash/redis";
import type { VercelRequest, VercelResponse } from "@vercel/node";

// Sync-session API for URL-based cross-device sync (spec: shared session,
// per-key last-write-wins by server arrival order, server-minted ids).
//
// Every mutation is an absolute set of flat string keys, so merges are
// deterministic and conflict-free — no 409s, no versions, no clocks.
// Key space (client translates to/from the store shape):
//   v:{charId}:{taskId}  task values (number|boolean)
//   acc:{taskId}          account values
//   hide:{charId}:{taskId} | hide:acc:{taskId}   hidden flags (true)
//   pin:{barterId}        barter pin membership (true; unpin = false)
//   custom:{id}           custom task object | null (tombstone, retained)
//   char:{id}:name | char:{id}:alive             character fields
//   meta:active           active character id
//   pref:hideCompleted | filter:{prio,town,skill,pinned}
// Ordering (drag order, character tabs) is intentionally per-device local
// and never synced; reset markers stay local too (each device resets itself).
//
// Storage layout (one Redis hash per session):
//   key            = `${SESSION_PREFIX}${id}:h`
//   field "~meta"  = tagged-JSON { v: 2, updatedAt, writerId, seq }
//   other fields   = one flat sync key each, value tagged-JSON encoded
//                   (numbers, booleans, strings, objects, null tombstones).
// A PATCH is a SINGLE HSET of meta + changed fields: concurrent PATCHes from
// two devices are per-field last-writer-wins and can never interleave a
// read-modify-write and drop each other's keys (the old single-blob layout
// did exactly that — one device's whole-record write silently discarded the
// other's, and clients then adopted + tombstoned the loss on both ends).
// Values carry a "j:" tag so they survive @upstash/redis response
// deserialization as plain strings regardless of JSON-sniffing behavior.
// Fields starting with "~" are reserved (meta); clients sending them get 400.
// Keys outside the known prefixes, prototype-pollution names, arrays, and
// over-long strings/objects get 400; sessions are capped at 5000 fields
// (413 past that) so no bearer can bloat a hash without bound.
// Tombstones are retained fields (same as the old blob — no GC).
//
// Sessions expire after 180 days without a read/write (sliding TTL,
// refreshed on every GET/PATCH/POST) — a leaked link stops working instead
// of living forever. Rate limits key on the verified client IP (x-real-ip,
// else the last forwarded entry), never the spoofable leftmost entry.
//
// Records written before the hash layout (v1 whole-state blobs and v2 blobs,
// both JSON strings under the bare `${SESSION_PREFIX}${id}` key) are still
// served; the first PATCH upgrades them into the hash and deletes the string.
//
// POST   /api/session  { state: flat map }       -> { id, updatedAt }
// GET    /api/session?id=...                     -> { state: flat map, updatedAt } | 404
//   ?meta=1  -> { updatedAt } (+ legacy:true for pre-hash records); never
//               touches the TTL — polls use it to skip unchanged full GETs.
//   ?touch=1 -> refresh the 180-day sliding TTL (PATCH takes { touch: 1 }).
// PATCH  /api/session  { id, changes: {k: v} }   -> { updatedAt } | 404
// DELETE /api/session  { id }                    -> 200 (idempotent)
//
// Env (auto-injected by the Upstash Marketplace install):
// UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
// (the Node client also accepts the legacy KV_REST_API_URL / KV_REST_API_TOKEN)

const redis = Redis.fromEnv();

// Key namespace. Production uses the default; local `vercel dev` runs with
// SYNC_KEY_PREFIX=mabiroutine:dev: (via .env.local) so throwaway test
// sessions never touch prod keys. Same code, same Redis, zero collision.
const NS = process.env.SYNC_KEY_PREFIX ?? "mabiroutine:";
const SESSION_PREFIX = `${NS}session:`;
const RL_PREFIX = `${NS}rl:`;

const hashKey = (id: string): string => `${SESSION_PREFIX}${id}:h`;
const bareKey = (id: string): string => `${SESSION_PREFIX}${id}`;

// Hard cap per spec: progress values are ~25KB, 200KB leaves 8x headroom
// while keeping a single value far under the 10MB request limit.
const MAX_STATE_BYTES = 200 * 1024;

// POST / create is the abuse-sensitive endpoint (mints keys): 10/hr per IP.
// Everything else: 60/min per IP — invisible to humans, fatal to scripts.
// Non-prod namespaces (local `vercel dev` runs `mabiroutine:dev:`) get roomy
// budgets so the regression gate (`pnpm test:sync`) never trips them —
// throwaway keys, same Redis, zero prod impact. Gated on the server-side
// namespace (clients can't choose it), so prod abuse protection is untouched.
const IS_TEST_NS = NS !== "mabiroutine:";
const RL_CREATE_LIMIT = IS_TEST_NS ? 500 : 10;
const RL_CREATE_WINDOW_S = 3600;
const RL_GENERAL_LIMIT = IS_TEST_NS ? 600 : 60;
const RL_GENERAL_WINDOW_S = 60;

// Session lifetime: a leaked link must not work forever. Hash (and legacy
// string) keys expire after 180 days without a successful read/write; every
// GET/PATCH/POST refreshes the TTL (sliding), so active sessions never die
// from under the user. Best-effort: a failed EXPIRE never fails the request,
// the next access retries it.
const SESSION_TTL_S = 180 * 24 * 3600;

async function touchHash(id: string): Promise<void> {
  try {
    await redis.expire(hashKey(id), SESSION_TTL_S);
  } catch {
    // best-effort renewal — the next access retries
  }
}

async function readMeta(id: string): Promise<SessionMeta | null> {
  const raw = (await redis.hget(hashKey(id), META_FIELD)) as unknown;
  if (typeof raw !== "string") return null;
  const meta = dec(raw) as SessionMeta | undefined;
  if (!meta || typeof meta !== "object" || meta.v !== 2) return null;
  return meta;
}

// TTL-renewal beacon: GET/PATCH refresh the 180-day sliding TTL only
// when the client asks (?touch=1 / {touch: 1}, sent at most once/day per
// session) — routine polls stop paying an EXPIRE per request. POST (session
// mint, rare) always stamps.
function wantsTouch(value: unknown): boolean {
  return value === 1 || value === "1" || value === true;
}

async function touchBare(id: string): Promise<void> {
  try {
    await redis.expire(bareKey(id), SESSION_TTL_S);
  } catch {
    // best-effort renewal — the next access retries
  }
}

type SessionMeta = {
  v: 2;
  updatedAt: number;
  writerId: string;
  seq: number;
};

const META_FIELD = "~meta";

// Pre-hash record shapes (bare string key): v1 whole-state blob, or v2
// {v:2, seq, keys} blob. Served read-only; upgraded on first PATCH.
type LegacyRecord = {
  v?: unknown;
  updatedAt: number;
  state?: unknown;
  keys?: Record<string, { seq: number; v: unknown }>;
};

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

// Fixed-window rate limit. Returns true when the caller is over budget.
async function overLimit(key: string, limit: number, windowS: number): Promise<boolean> {
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowS);
  return count > limit;
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
// curious bearer from turning a session hash into arbitrary junk storage and
// bounds per-key memory. CJK barter ids are legitimate, so no charset gate.
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

type HashSession = { meta: SessionMeta; state: Record<string, unknown> };

async function readHash(id: string): Promise<HashSession | null> {
  const all = await redis.hgetall<Record<string, string>>(hashKey(id));
  if (!all || typeof all !== "object") return null;
  const meta = dec((all as Record<string, unknown>)[META_FIELD]) as SessionMeta | undefined;
  if (!meta || typeof meta !== "object" || meta.v !== 2) return null;
  const state: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(all)) {
    if (k === META_FIELD) continue;
    const d = dec(v);
    if (d !== undefined) state[k] = d;
  }
  return { meta, state };
}

async function handlePost(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (await overLimit(`${RL_PREFIX}create:${clientIp(req)}`, RL_CREATE_LIMIT, RL_CREATE_WINDOW_S)) {
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
  // Note: POST creates the hash, so its field count equals the key count —
  // MAX_KEYS_PER_REQUEST (2000, checked above) is the effective cap, tighter
  // than MAX_HASH_FIELDS (5000, enforced on PATCH growth).
  if (JSON.stringify(state).length > MAX_STATE_BYTES) {
    res.status(413).json({ error: "state too large" });
    return;
  }
  const id = crypto.randomUUID();
  // UUIDv4 collision is ~impossible, but overwriting an existing session
  // would be data loss — check both layouts before writing (POST is rare).
  const taken = (await readHash(id)) ?? (await redis.get<LegacyRecord>(bareKey(id)));
  if (taken) {
    res.status(500).json({ error: "id collision, retry" });
    return;
  }
  const updatedAt = Date.now();
  const meta: SessionMeta = { v: 2, updatedAt, writerId: clientIp(req), seq: Object.keys(state).length };
  await redis.hset(hashKey(id), { [META_FIELD]: enc(meta), ...encodeAll(state) });
  await touchHash(id);
  res.status(200).json({ id, updatedAt });
}

async function handleGet(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (await overLimit(`${RL_PREFIX}get:${clientIp(req)}`, RL_GENERAL_LIMIT, RL_GENERAL_WINDOW_S)) {
    res.status(429).json({ error: "rate limited" });
    return;
  }
  const raw = req.query.id;
  const id = Array.isArray(raw) ? raw[0] : raw;
  if (!validId(id)) {
    res.status(404).json({ error: "unknown session" });
    return;
  }
  // Freshness probe (quota §): ?meta=1 returns only {updatedAt} (+legacy for
  // pre-hash records) so unchanged polls skip the full HGETALL. Never touches
  // the TTL — the full GET's daily beacon owns renewal.
  const metaOnly = req.query.meta === "1" || req.query.meta === "true";
  if (metaOnly) {
    const meta = await readMeta(id);
    if (meta) {
      res.status(200).json({ updatedAt: meta.updatedAt });
      return;
    }
    const legacyRec = await redis.get<LegacyRecord>(bareKey(id));
    if (!legacyRec) {
      res.status(404).json({ error: "unknown session" });
      return;
    }
    res.status(200).json({ updatedAt: legacyRec.updatedAt, legacy: true });
    return;
  }
  const h = await readHash(id);
  if (h) {
    if (wantsTouch(req.query.touch)) await touchHash(id);
    res.status(200).json({ state: h.state, updatedAt: h.meta.updatedAt });
    return;
  }
  const record = await redis.get<LegacyRecord>(bareKey(id));
  if (!record) {
    res.status(404).json({ error: "unknown session" });
    return;
  }
  if (wantsTouch(req.query.touch)) await touchBare(id);
  if ((record as { v?: unknown }).v !== 2) {
    // Pre-flat session (v1 whole-state blob): the client flattens locally and
    // upgrades on its next push. Serve the blob as-is under a marker shape.
    res.status(200).json({ legacy: (record as unknown as { state?: unknown }).state, updatedAt: record.updatedAt });
    return;
  }
  const state: Record<string, unknown> = {};
  for (const [k, e] of Object.entries(record.keys ?? {})) state[k] = e.v;
  res.status(200).json({ state, updatedAt: record.updatedAt });
}

// PATCH applies absolute key-sets as ONE HSET: per-field last-arrival-wins,
// deterministic, no versions, no clocks, no 409s — and concurrent PATCHes can
// no longer clobber each other. A string-layout record upgrades into the hash
// in place (the client sends its full flat map once after seeing the legacy
// marker, so a discarded v1 blob loses nothing).
async function handlePatch(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (await overLimit(`${RL_PREFIX}patch:${clientIp(req)}`, RL_GENERAL_LIMIT, RL_GENERAL_WINDOW_S)) {
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
  const h = await readHash(id);
  if (h) {
    // Bound total hash growth (no extra Redis round trip — readHash already
    // fetched the field set). Tombstone-valued updates to existing keys are
    // always allowed; only genuinely new fields count against the budget.
    let fresh = 0;
    for (const k of Object.keys(changes)) if (!(k in h.state)) fresh += 1;
    if (Object.keys(h.state).length + fresh > MAX_HASH_FIELDS) {
      res.status(413).json({ error: "session too large" });
      return;
    }
    const meta: SessionMeta = {
      v: 2,
      updatedAt: Date.now(),
      writerId: clientIp(req),
      seq: h.meta.seq + 1,
    };
    await redis.hset(hashKey(id), { [META_FIELD]: enc(meta), ...encodeAll(changes) });
    if (wantsTouch(touch)) await touchHash(id);
    res.status(200).json({ updatedAt: meta.updatedAt });
    return;
  }
  // First write since the hash layout shipped: upgrade the string record.
  // Guarded by an NX lock so two concurrent first-PATCHes can't both
  // read-merge-write the same base and drop each other's keys (one-time
  // window, but the loss would be permanent). The loser waits for the hash
  // to appear and applies its changes onto it as an ordinary PATCH.
  let bare = await redis.get<LegacyRecord>(bareKey(id));
  if (!bare) {
    res.status(404).json({ error: "unknown session" });
    return;
  }
  const lockKey = `${SESSION_PREFIX}${id}:upgrading`;
  let claimed: unknown = null;
  try {
    claimed = await redis.set(lockKey, "1", { nx: true, ex: 30 });
  } catch {
    claimed = null;
  }
  if (claimed !== "OK") {
    for (let i = 0; i < 10; i += 1) {
      await new Promise((r) => setTimeout(r, 100));
      const raced = await readHash(id);
      if (raced) {
        let fresh = 0;
        for (const k of Object.keys(changes)) if (!(k in raced.state)) fresh += 1;
        if (Object.keys(raced.state).length + fresh > MAX_HASH_FIELDS) {
          res.status(413).json({ error: "session too large" });
          return;
        }
        const retryMeta: SessionMeta = {
          v: 2,
          updatedAt: Date.now(),
          writerId: clientIp(req),
          seq: raced.meta.seq + 1,
        };
        await redis.hset(hashKey(id), { [META_FIELD]: enc(retryMeta), ...encodeAll(changes) });
        if (wantsTouch(touch)) await touchHash(id);
        res.status(200).json({ updatedAt: retryMeta.updatedAt });
        return;
      }
    }
    // Lock holder vanished without publishing (or Redis refused NX) — fall
    // through and perform the upgrade ourselves, but re-read the bare record
    // first: the pre-lock snapshot above may predate the holder's publish.
    // If bare is gone, the holder published-then-deleted (or someone called
    // DELETE): apply onto the hash if it exists, else 404 like a dead link.
    bare = await redis.get<LegacyRecord>(bareKey(id));
    if (!bare) {
      const racedHash = await readHash(id);
      if (!racedHash) {
        res.status(404).json({ error: "unknown session" });
        return;
      }
      let fresh = 0;
      for (const k of Object.keys(changes)) if (!(k in racedHash.state)) fresh += 1;
      if (Object.keys(racedHash.state).length + fresh > MAX_HASH_FIELDS) {
        res.status(413).json({ error: "session too large" });
        return;
      }
      const lateMeta: SessionMeta = {
        v: 2,
        updatedAt: Date.now(),
        writerId: clientIp(req),
        seq: racedHash.meta.seq + 1,
      };
      await redis.hset(hashKey(id), { [META_FIELD]: enc(lateMeta), ...encodeAll(changes) });
      if (wantsTouch(touch)) await touchHash(id);
      res.status(200).json({ updatedAt: lateMeta.updatedAt });
      return;
    }
  }
  const base: Record<string, unknown> = {};
  if ((bare as { v?: unknown }).v === 2) {
    for (const [k, e] of Object.entries(bare.keys ?? {})) base[k] = e.v;
  }
  const merged = { ...base, ...changes };
  if (Object.keys(merged).length > MAX_HASH_FIELDS) {
    res.status(413).json({ error: "session too large" });
    return;
  }
  const meta: SessionMeta = {
    v: 2,
    updatedAt: Date.now(),
    writerId: clientIp(req),
    seq: Object.keys(base).length + Object.keys(changes).length,
  };
  await redis.hset(hashKey(id), { [META_FIELD]: enc(meta), ...encodeAll(merged) });
  await redis.del(bareKey(id));
  await touchHash(id);
  try {
    await redis.del(lockKey);
  } catch {
    // lock auto-expires — upgrade already published
  }
  res.status(200).json({ updatedAt: meta.updatedAt });
}

async function handleDelete(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (await overLimit(`${RL_PREFIX}del:${clientIp(req)}`, RL_GENERAL_LIMIT, RL_GENERAL_WINDOW_S)) {
    res.status(429).json({ error: "rate limited" });
    return;
  }
  const { id } = bodyOf(req);
  if (!validId(id)) {
    res.status(404).json({ error: "unknown session" });
    return;
  }
  await redis.del(hashKey(id));
  await redis.del(bareKey(id));
  res.status(200).json({ ok: true });
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // Sync state must never be cached anywhere: a stale GET adopted wholesale
  // by a client pull wipes newer local keys (then tombstones them server-side).
  res.setHeader("Cache-Control", "no-store");
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
}
