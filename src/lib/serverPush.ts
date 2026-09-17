import { isPushEnabled } from "@/lib/hourlyReminders";
import { loadSession } from "@/sync/session";
import { useAppStore } from "@/store/useAppStore";

// Server-push door (Phase 1, barrier lane only). The bell ↔
// /api/push/subscribe round trip; the worker fanout reads the same table.
// Lives next to the local lane but never touches its timers: server mode
// OWNS the task (D6 — both cards share one collapse tag, running both would
// double-banner every hour), so subscribing here heals any local entry for
// the same task, and the local scheduler never sees server tasks (they stay
// out of the store list).
//
// Bell state is a device-local endpoint map (`lane:taskId → endpoint`):
// the server can't tell the bell anything (no session linkage, D1), and the
// live PushSubscription is async — so `on` reads the map, and a mount effect
// reconciles it against the live subscription (dead sub = silently off).

/** VAPID app-server key (public half — safe client-side). */
export const VAPID_PUBLIC_KEY =
  "BGaqwzh6mEVJXgQiaiYoejpOwhuaGThQl2uf1mIrGkPnzp7J9mv_j51jawf1PZPknuOVnezz6qNHLV2iojNuE2Y";

const SUBS_KEY = "mabiroutine:push-subs";

function subKey(taskId: string): string {
  return `hourly:${taskId}`;
}

function readSubs(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(SUBS_KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : {};
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** Bell state: an endpoint is recorded for this task on this device. */
export function serverPushOn(taskId: string): boolean {
  if (typeof window === "undefined") return false;
  return typeof readSubs()[subKey(taskId)] === "string";
}

export function setServerPushOn(taskId: string, endpoint: string | null): void {
  try {
    const m = readSubs();
    if (endpoint) m[subKey(taskId)] = endpoint;
    else delete m[subKey(taskId)];
    window.localStorage.setItem(SUBS_KEY, JSON.stringify(m));
  } catch {
    // storage full/blocked: the bell just won't stick — no crash.
  }
}

/**
 * Server mode owns exactly one lane: hourly, flagged. The whole path is
 * opt-in (experimental flag → bell tap with linkage disclosure → OS
 * permission), so no UA gate — desktop proved it first (Phase 1), iOS PWA
 * and Android join the matrix on the same flow (Phases 2–3).
 */
export function isServerPushMode(lane: "hourly" | "purple"): boolean {
  return lane === "hourly" && isPushEnabled();
}

export function detectPlatform(): string {
  try {
    const ud = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
    const p = (ud?.platform ?? navigator.platform ?? "").toLowerCase();
    if (/win/.test(p)) return "win";
    if (/mac/.test(p)) return "mac";
    if (/linux/.test(p)) return "linux";
    if (/android/.test(p)) return "android";
    if (/iphone|ipad|ipod|ios/.test(p)) return "ios";
  } catch {
    // fall through to other
  }
  return "other";
}

function b64ToU8(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Live device subscription, or null (no SW in dev counts as null). */
async function getLiveSub(): Promise<PushSubscription | null> {
  try {
    // getRegistration — never .ready: .ready pends forever with no worker
    // registered (dev), same discipline as the local fire path.
    if (!("serviceWorker" in navigator)) return null;
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg?.pushManager) return null;
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

export type ServerSubscribeResult = "ok" | "need-sw" | "failed";

/**
 * Roster snapshot for linked cards (D1a): ordering + fallback names, cut
 * from the live store at subscribe time.
 */
export function snapshotRoster(): { cid: string; name: string }[] {
  try {
    return useAppStore
      .getState()
      .characters.slice(0, 32)
      .map((c) => ({ cid: c.id, name: c.name.slice(0, 32) }));
  } catch {
    return [];
  }
}

/**
 * Full server subscribe: device subscription first, then the registry POST
 * (linkage + roster attached when the device holds them — absent stays
 * absent, never half-linked). A POST failure rolls the device subscription
 * back so no orphan sub lingers that the fanout would 404-prune later
 * anyway. Resolves — never rejects.
 */
export async function subscribeServerPush(taskId: string): Promise<ServerSubscribeResult> {
  try {
    if (!("serviceWorker" in navigator)) return "need-sw";
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg?.pushManager) return "need-sw";
    let sub: PushSubscription;
    try {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: b64ToU8(VAPID_PUBLIC_KEY),
      });
    } catch {
      return "failed";
    }
    let res: Response;
    try {
      res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subscription: sub.toJSON(),
          platform: detectPlatform(),
          lane: "hourly",
          linkSessionId: loadSession()?.id ?? null,
          roster: snapshotRoster(),
        }),
      });
    } catch {
      res = new Response(null, { status: 599 });
    }
    if (!res.ok) {
      try {
        await sub.unsubscribe();
      } catch {
        // orphan: the fanout prunes it on 404/410 — no user action needed.
      }
      return "failed";
    }
    setServerPushOn(taskId, sub.endpoint);
    return "ok";
  } catch {
    return "failed";
  }
}

/**
 * Full server unsubscribe: registry DELETE first (idempotent — a failure
 * still proceeds to the device half), then the device unsubscribe, then the
 * map entry. Scope-1 assumption: this device holds at most one hourly sub
 * (today only `barrier` subscribes), so dropping the live sub is exact.
 */
export async function unsubscribeServerPush(taskId: string): Promise<void> {
  const endpoint = readSubs()[subKey(taskId)];
  if (endpoint) {
    try {
      await fetch("/api/push/subscribe", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint }),
      });
    } catch {
      // idempotent server-side; the fanout prune covers a missed delete.
    }
  }
  try {
    const live = await getLiveSub();
    if (live && (!endpoint || live.endpoint === endpoint)) await live.unsubscribe();
  } catch {
    // map entry still clears below — a stuck sub dies on 404/410 prune.
  }
  setServerPushOn(taskId, null);
}

/**
 * Silent roster refresh (D1a): renames and new characters would otherwise
 * stale the snapshot until the next bell toggle. Runs on bell mount while
 * the live sub is healthy — one cheap upsert per page load, no UI.
 */
export async function refreshServerRoster(taskId: string): Promise<void> {
  try {
    if (!serverPushOn(taskId)) return;
    const live = await getLiveSub();
    if (!live) return;
    await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subscription: live.toJSON(),
        platform: detectPlatform(),
        lane: "hourly",
        linkSessionId: loadSession()?.id ?? null,
        roster: snapshotRoster(),
      }),
    });
  } catch {
    // best-effort: the snapshot just stays a load older.
  }
}

/**
 * Mount reconciliation for server mode: the map entry is a claim, the live
 * subscription is the truth. A dead/missing live sub clears the claim so
 * the bell never shows on for a device the fanout couldn't reach. Returns true
 * when it changed something (caller re-renders).
 */
export async function reconcileServerPush(taskId: string): Promise<boolean> {
  const endpoint = readSubs()[subKey(taskId)];
  if (!endpoint) return false;
  const live = await getLiveSub();
  if (live && live.endpoint === endpoint) return false;
  setServerPushOn(taskId, null);
  // Best-effort: the dead endpoint shouldn't linger server-side either.
  try {
    await fetch("/api/push/subscribe", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint }),
    });
  } catch {
    // fanout prune covers it.
  }
  return true;
}
