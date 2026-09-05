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
// POST   /api/session  { state: flat map }       -> { id, updatedAt }
// GET    /api/session?id=...                     -> { state: flat map, updatedAt } | 404
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

// Hard cap per spec: progress values are ~25KB, 200KB leaves 8x headroom
// while keeping a single value far under the 10MB request limit.
const MAX_STATE_BYTES = 200 * 1024;

// POST / create is the abuse-sensitive endpoint (mints keys): 10/hr per IP.
// Everything else: 60/min per IP — invisible to humans, fatal to scripts.
const RL_CREATE_LIMIT = 10;
const RL_CREATE_WINDOW_S = 3600;
const RL_GENERAL_LIMIT = 60;
const RL_GENERAL_WINDOW_S = 60;

type SessionRecord = {
  v: 2;
  updatedAt: number;
  writerId: string;
  seq: number;
  keys: Record<string, { seq: number; v: unknown }>;
};

function clientIp(req: VercelRequest): string {
  const fwd = req.headers["x-forwarded-for"];
  if (Array.isArray(fwd)) return fwd[0].trim();
  if (typeof fwd === "string" && fwd) return fwd.split(",")[0].trim();
  const real = req.headers["x-real-ip"];
  if (Array.isArray(real)) return real[0].trim();
  if (typeof real === "string" && real) return real.trim();
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

function validId(id: unknown): id is string {
  return (
    typeof id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
  );
}

function bodyOf(req: VercelRequest): { id?: unknown; state?: unknown; changes?: unknown } {
  const b = req.body as { id?: unknown; state?: unknown; changes?: unknown } | undefined;
  if (!b || typeof b !== "object") return {};
  return b;
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
  if (JSON.stringify(state).length > MAX_STATE_BYTES) {
    res.status(413).json({ error: "state too large" });
    return;
  }
  const id = crypto.randomUUID();
  const updatedAt = Date.now();
  const keys: SessionRecord["keys"] = {};
  let seq = 0;
  for (const [k, v] of Object.entries(state)) keys[k] = { seq: ++seq, v };
  const set = await redis.set(`${SESSION_PREFIX}${id}`, { v: 2, updatedAt, writerId: clientIp(req), seq, keys } satisfies SessionRecord, { nx: true });
  if (set !== "OK") {
    res.status(500).json({ error: "id collision, retry" });
    return;
  }
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
  const record = await redis.get<SessionRecord>(`${SESSION_PREFIX}${id}`);
  if (!record) {
    res.status(404).json({ error: "unknown session" });
    return;
  }
  if ((record as { v?: unknown }).v !== 2) {
    // Pre-flat session (v1 whole-state blob): the client flattens locally and
    // upgrades on its next push. Serve the blob as-is under a marker shape.
    res.status(200).json({ legacy: (record as unknown as { state?: unknown }).state, updatedAt: record.updatedAt });
    return;
  }
  const state: Record<string, unknown> = {};
  for (const [k, e] of Object.entries(record.keys)) state[k] = e.v;
  res.status(200).json({ state, updatedAt: record.updatedAt });
}

// PATCH applies absolute key-sets unconditionally, stamping each with the
// next arrival sequence number. Last arrival wins per key — deterministic,
// no versions, no clocks, no 409s. A v1 record upgrades in place (the client
// sends its full flat map once after seeing the legacy marker).
async function handlePatch(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (await overLimit(`${RL_PREFIX}patch:${clientIp(req)}`, RL_GENERAL_LIMIT, RL_GENERAL_WINDOW_S)) {
    res.status(429).json({ error: "rate limited" });
    return;
  }
  const { id, changes } = bodyOf(req);
  // Never reveal whether an id exists: malformed ids 404 like missing ones.
  if (!validId(id)) {
    res.status(404).json({ error: "unknown session" });
    return;
  }
  if (!validFlat(changes)) {
    res.status(400).json({ error: "changes must be a flat key map" });
    return;
  }
  if (JSON.stringify(changes).length > MAX_STATE_BYTES) {
    res.status(413).json({ error: "changes too large" });
    return;
  }
  const key = `${SESSION_PREFIX}${id}`;
  const current = await redis.get<SessionRecord>(key);
  if (!current) {
    res.status(404).json({ error: "unknown session" });
    return;
  }
  const next: SessionRecord =
    (current as { v?: unknown }).v === 2
      ? current
      : { v: 2, updatedAt: current.updatedAt, writerId: clientIp(req), seq: 0, keys: {} };
  for (const [k, v] of Object.entries(changes)) next.keys[k] = { seq: ++next.seq, v };
  next.updatedAt = Date.now();
  next.writerId = clientIp(req);
  await redis.set(key, next);
  res.status(200).json({ updatedAt: next.updatedAt });
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
  await redis.del(`${SESSION_PREFIX}${id}`);
  res.status(200).json({ ok: true });
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
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
