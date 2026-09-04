// Thin fetch wrapper over /api/session. Typed errors let the UI branch
// without parsing status codes at every call site.

export class SyncNotFound extends Error {}
export class SyncStale extends Error {
  updatedAt: number;
  constructor(updatedAt: number) {
    super("stale");
    this.updatedAt = updatedAt;
  }
}
export class SyncTooLarge extends Error {}
export class SyncRateLimited extends Error {}
export class SyncFailed extends Error {}

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

export type RemoteSession = { state: unknown; updatedAt: number };

export async function createSession(state: unknown): Promise<{ id: string; updatedAt: number }> {
  if (offline()) throw new SyncFailed("offline");
  const res = await fetch("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ state }),
  });
  if (res.ok) return (await res.json()) as { id: string; updatedAt: number };
  const body = await readError(res);
  if (res.status === 413) throw new SyncTooLarge(body.error ?? "too large");
  if (res.status === 429) throw new SyncRateLimited(body.error ?? "rate limited");
  throw new SyncFailed(body.error ?? `create failed: ${res.status}`);
}

export async function getSession(id: string): Promise<RemoteSession> {
  if (offline()) throw new SyncFailed("offline");
  const res = await fetch(`/api/session?id=${encodeURIComponent(id)}`);
  if (res.ok) return (await res.json()) as RemoteSession;
  const body = await readError(res);
  if (res.status === 404) throw new SyncNotFound(body.error ?? "unknown session");
  if (res.status === 429) throw new SyncRateLimited(body.error ?? "rate limited");
  throw new SyncFailed(body.error ?? `get failed: ${res.status}`);
}

export async function putSession(id: string, state: unknown, baseUpdatedAt: number): Promise<number> {
  if (offline()) throw new SyncFailed("offline");
  const res = await fetch("/api/session", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, state, baseUpdatedAt }),
  });
  if (res.ok) return ((await res.json()) as { updatedAt: number }).updatedAt;
  const body = await readError(res);
  if (res.status === 404) throw new SyncNotFound(body.error ?? "unknown session");
  if (res.status === 409) throw new SyncStale(typeof body.updatedAt === "number" ? body.updatedAt : 0);
  if (res.status === 413) throw new SyncTooLarge(body.error ?? "too large");
  if (res.status === 429) throw new SyncRateLimited(body.error ?? "rate limited");
  throw new SyncFailed(body.error ?? `put failed: ${res.status}`);
}

export async function deleteSession(id: string): Promise<void> {
  if (offline()) throw new SyncFailed("offline");
  const res = await fetch("/api/session", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id }),
  });
  if (res.ok || res.status === 404) return;
  const body = await readError(res);
  if (res.status === 429) throw new SyncRateLimited(body.error ?? "rate limited");
  throw new SyncFailed(body.error ?? `delete failed: ${res.status}`);
}
