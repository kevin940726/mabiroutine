import { Redis } from "@upstash/redis";
import type { VercelRequest, VercelResponse } from "@vercel/node";

// Sync-session API for URL-based cross-device sync (spec: shared session,
// whole-state last-write-wins guarded by baseUpdatedAt, server-minted ids).
//
// POST   /api/session  { state }                          -> { id, updatedAt }
// GET    /api/session?id=...                              -> { state, updatedAt } | 404
// PUT    /api/session  { id, state, baseUpdatedAt }       -> { updatedAt } | 404 | 409
// DELETE /api/session  { id }                             -> 200 (idempotent)
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
  v: 1;
  updatedAt: number;
  writerId: string;
  state: unknown;
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

function validState(state: unknown): state is Record<string, unknown> {
  if (!state || typeof state !== "object" || Array.isArray(state)) return false;
  const s = state as { characters?: unknown };
  return Array.isArray(s.characters);
}

function validId(id: unknown): id is string {
  return (
    typeof id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
  );
}

function bodyOf(req: VercelRequest): { id?: unknown; state?: unknown; baseUpdatedAt?: unknown } {
  const b = req.body as { id?: unknown; state?: unknown; baseUpdatedAt?: unknown } | undefined;
  if (!b || typeof b !== "object") return {};
  return b;
}

async function handlePost(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (await overLimit(`${RL_PREFIX}create:${clientIp(req)}`, RL_CREATE_LIMIT, RL_CREATE_WINDOW_S)) {
    res.status(429).json({ error: "too many sessions created, try again later" });
    return;
  }
  const { state } = bodyOf(req);
  if (!validState(state)) {
    res.status(400).json({ error: "state must include characters[]" });
    return;
  }
  if (JSON.stringify(state).length > MAX_STATE_BYTES) {
    res.status(413).json({ error: "state too large" });
    return;
  }
  const id = crypto.randomUUID();
  const updatedAt = Date.now();
  const record: SessionRecord = { v: 1, updatedAt, writerId: clientIp(req), state };
  // NX: impossible to collide with a minted UUID, but create must never
  // overwrite — belt and suspenders against a broken client retrying a PUT id.
  const set = await redis.set(`${SESSION_PREFIX}${id}`, record, { nx: true });
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
  res.status(200).json({ state: record.state, updatedAt: record.updatedAt });
}

async function handlePut(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (await overLimit(`${RL_PREFIX}put:${clientIp(req)}`, RL_GENERAL_LIMIT, RL_GENERAL_WINDOW_S)) {
    res.status(429).json({ error: "rate limited" });
    return;
  }
  const { id, state, baseUpdatedAt } = bodyOf(req);
  // Never reveal whether an id exists: malformed ids 404 like missing ones.
  if (!validId(id)) {
    res.status(404).json({ error: "unknown session" });
    return;
  }
  if (!validState(state)) {
    res.status(400).json({ error: "state must include characters[]" });
    return;
  }
  if (typeof baseUpdatedAt !== "number") {
    res.status(400).json({ error: "baseUpdatedAt required" });
    return;
  }
  if (JSON.stringify(state).length > MAX_STATE_BYTES) {
    res.status(413).json({ error: "state too large" });
    return;
  }
  const key = `${SESSION_PREFIX}${id}`;
  const current = await redis.get<SessionRecord>(key);
  if (!current) {
    res.status(404).json({ error: "unknown session" });
    return;
  }
  // 409 guard: a stale device never silently clobbers a newer push —
  // the client turns this into the 取用雲端 / 保留本機 dialog.
  if (baseUpdatedAt < current.updatedAt) {
    res.status(409).json({ error: "stale", updatedAt: current.updatedAt });
    return;
  }
  const updatedAt = Date.now();
  const record: SessionRecord = { v: 1, updatedAt, writerId: clientIp(req), state };
  await redis.set(key, record);
  res.status(200).json({ updatedAt });
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
    case "PUT":
      return handlePut(req, res);
    case "DELETE":
      return handleDelete(req, res);
    default:
      res.status(405).json({ error: "method not allowed" });
  }
}
