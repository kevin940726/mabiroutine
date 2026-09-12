// Thin fetch wrapper over /api/session. Typed errors let the UI branch
// without parsing status codes at every call site. Per-key LWW: the client
// sends absolute key-sets (PATCH) and reads flat maps (GET) — the server
// stamps arrival order, so there are no versions, no clocks, no 409s.

import { bumpStat } from "@/sync/stats";

export class SyncNotFound extends Error {}
export class SyncTooLarge extends Error {}
export class SyncRateLimited extends Error {}
export class SyncFailed extends Error {}
export type FlatMap = Record<string, unknown>;

async function readError(res: Response): Promise<{ error?: string; updatedAt?: number }> {
  try {
    return (await res.json()) as { error?: string; updatedAt?: number };
  } catch {
    return {};
  }
}

function offline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export type RemoteSession = { state?: unknown; legacy?: unknown; updatedAt: number };

// Boot preload (index.html inline fetch): the session GET fires before the
// module graph loads so it overlaps JS bootstrap. Consume-once, id-matched,
// 60s TTL — any mismatch, expiry, or failure returns null and the caller
// falls back to a live GET, so this can never break the pull (only skip its
// head start).
declare global {
  interface Window {
    __mabiPreload?: { id: string; at: number; res: Promise<unknown> };
  }
}

const PRELOAD_TTL_MS = 60_000;

export function takePreloaded(id: string): Promise<RemoteSession | null> | null {
  try {
    if (typeof window === "undefined") return null;
    const p = window.__mabiPreload;
    if (!p) return null;
    delete window.__mabiPreload; // take (any outcome discards — no late reuse)
    if (p.id !== id) return null;
    if (typeof p.at !== "number" || Date.now() - p.at > PRELOAD_TTL_MS) return null;
    return p.res
      .then((r) => {
        const valid =
          r && typeof r === "object" && typeof (r as RemoteSession).updatedAt === "number";
        // The preload fired a real full GET (no touch beacon) — count it so
        // the quota telemetry matches the dashboard.
        if (valid) bumpStat("get");
        return valid ? (r as RemoteSession) : null;
      })
      .catch(() => null);
  } catch {
    return null;
  }
}

export async function createSession(state: FlatMap): Promise<{ id: string; updatedAt: number }> {
  if (offline()) throw new SyncFailed("offline");
  bumpStat("post"); // attempt-counted: even 4xx/429s cost the rate-limit INCR
  const res = await fetch("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    // Sync payloads must never be served from HTTP cache: a stale read
    // adopted wholesale would wipe newer local state (then tombstone it).
    cache: "no-store",
    body: JSON.stringify({ state }),
  });
  if (res.ok) return (await res.json()) as { id: string; updatedAt: number };
  const body = await readError(res);
  if (res.status === 413) throw new SyncTooLarge(body.error ?? "too large");
  if (res.status === 429) throw new SyncRateLimited(body.error ?? "rate limited");
  throw new SyncFailed(body.error ?? `create failed: ${res.status}`);
}

export async function getSession(id: string, opts?: { touch?: boolean }): Promise<RemoteSession> {
  if (offline()) throw new SyncFailed("offline");
  const pre = takePreloaded(id);
  if (pre) {
    const cached = await pre;
    if (cached) return cached;
    // Preload missed (non-OK / malformed) — fall through to a live GET so
    // error semantics (404 → SyncNotFound etc.) stay exactly as before.
  }
  const res = await fetch(
    `/api/session?id=${encodeURIComponent(id)}${opts?.touch ? "&touch=1" : ""}`,
    {
      // See POST: a stale GET adopted by a pull wipes + tombstones live keys.
      cache: "no-store",
    }
  );
  bumpStat(opts?.touch ? "getTouch" : "get");
  if (res.ok) return (await res.json()) as RemoteSession;
  const body = await readError(res);
  if (res.status === 404) throw new SyncNotFound(body.error ?? "unknown session");
  if (res.status === 429) throw new SyncRateLimited(body.error ?? "rate limited");
  throw new SyncFailed(body.error ?? `get failed: ${res.status}`);
}

// Freshness probe (quota §): returns only { updatedAt } (+ legacy:true for
// pre-hash records) so unchanged polls skip the full GET. Never touches the
// server TTL — renewal rides the full GET's daily beacon.
export type RemoteMeta = { updatedAt: number; legacy?: boolean };

export async function getSessionMeta(id: string): Promise<RemoteMeta> {
  if (offline()) throw new SyncFailed("offline");
  const res = await fetch(`/api/session?id=${encodeURIComponent(id)}&meta=1`, {
    cache: "no-store",
  });
  bumpStat("meta");
  if (res.ok) {
    const body = (await res.json()) as { updatedAt?: unknown; legacy?: unknown };
    if (typeof body.updatedAt === "number") {
      return body.legacy === true ? { updatedAt: body.updatedAt, legacy: true } : { updatedAt: body.updatedAt };
    }
    throw new SyncFailed("bad meta response");
  }
  const body = await readError(res);
  if (res.status === 404) throw new SyncNotFound(body.error ?? "unknown session");
  if (res.status === 429) throw new SyncRateLimited(body.error ?? "rate limited");
  throw new SyncFailed(body.error ?? `meta failed: ${res.status}`);
}

export async function patchSession(id: string, changes: FlatMap, opts?: { touch?: boolean }): Promise<number> {
  if (offline()) throw new SyncFailed("offline");
  const res = await fetch("/api/session", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(opts?.touch ? { id, changes, touch: 1 } : { id, changes }),
  });
  bumpStat(opts?.touch ? "patchTouch" : "patch");
  if (res.ok) return ((await res.json()) as { updatedAt: number }).updatedAt;
  const body = await readError(res);
  if (res.status === 404) throw new SyncNotFound(body.error ?? "unknown session");
  if (res.status === 413) throw new SyncTooLarge(body.error ?? "too large");
  if (res.status === 429) throw new SyncRateLimited(body.error ?? "rate limited");
  throw new SyncFailed(body.error ?? `patch failed: ${res.status}`);
}

export async function deleteSession(id: string): Promise<void> {
  if (offline()) throw new SyncFailed("offline");
  const res = await fetch("/api/session", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ id }),
  });
  bumpStat("del");
  if (res.ok || res.status === 404) return;
  const body = await readError(res);
  if (res.status === 429) throw new SyncRateLimited(body.error ?? "rate limited");
  throw new SyncFailed(body.error ?? `delete failed: ${res.status}`);
}
