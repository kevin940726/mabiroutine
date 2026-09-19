import { loadSession } from "@/sync/session";
import { useAppStore } from "@/store/useAppStore";

// Server-push door (barrier + purple lanes). The bell ↔ /api/push/subscribe
// round trip; the worker fanout reads the same table per lane.
// Lives next to the local lanes but never touches their timers: server mode
// OWNS the task (D6 — both cards share one collapse tag, running both would
// double-banner every hour), so subscribing here heals any local entry for
// the same task, and the local scheduler never sees server tasks (they stay
// out of the store list).
//
// Bell state is a device-local endpoint map (`lane:taskId → endpoint`):
// the server can't tell the bell anything (no session linkage, D1), and the
// live PushSubscription is async — so `on` reads the map, and a mount effect
// reconciles it against the live subscription (dead sub = silently off).
//
// The purple lane is unfiltered (decided): cards name zones, never people,
// so no D1a linkage — linkSession/roster are accepted by the API but the
// purple fanout never reads them.

/** VAPID app-server key (public half — safe client-side). */
export const VAPID_PUBLIC_KEY =
  "BGaqwzh6mEVJXgQiaiYoejpOwhuaGThQl2uf1mIrGkPnzp7J9mv_j51jawf1PZPknuOVnezz6qNHLV2iojNuE2Y";

const SUBS_KEY = "mabiroutine:push-subs";

export type PushLane = "hourly" | "purple";

function subKey(lane: PushLane, taskId: string): string {
  return `${lane}:${taskId}`;
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
export function serverPushOn(taskId: string, lane: PushLane = "hourly"): boolean {
  if (typeof window === "undefined") return false;
  return typeof readSubs()[subKey(lane, taskId)] === "string";
}

export function setServerPushOn(taskId: string, endpoint: string | null, lane: PushLane = "hourly"): void {
  try {
    const m = readSubs();
    if (endpoint) m[subKey(lane, taskId)] = endpoint;
    else delete m[subKey(lane, taskId)];
    window.localStorage.setItem(SUBS_KEY, JSON.stringify(m));
  } catch {
    // storage full/blocked: the bell just won't stick — no crash.
  }
}

/**
 * Server mode per lane, always on (the experimental-flag era ended — the
 * flag slots below are retained unread so old saves carry over). The whole
 * path stays opt-in per bell tap (bell tap → OS permission), no UA gate.
 */
export function isServerPushMode(_lane: "hourly" | "purple"): boolean {
  return true;
}

/**
 * iOS runs Web Push only from an installed Home-Screen app — a bell tap in a
 * plain Safari tab can never subscribe (the native prompt never comes up and
 * there is no settings switch to guide to). Detect it up front so the bell
 * explains instead of failing into the generic retry loop.
 */
export function isIOSWithoutPWA(): boolean {
  try {
    if (typeof window === "undefined" || typeof navigator === "undefined") return false;
    const ua = navigator.userAgent || "";
    const isiOS =
      /iPad|iPhone|iPod/.test(ua) ||
      ((navigator as Navigator & { platform?: string }).platform === "MacIntel" &&
        navigator.maxTouchPoints > 1);
    if (!isiOS) return false;
    if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return false;
    if (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(display-mode: standalone)").matches
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
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
 * absent, never half-linked; the purple lane sends neither, its fanout is
 * unfiltered). A POST failure rolls the device subscription back so no
 * orphan sub lingers that the fanout would 404-prune later anyway.
 * Resolves — never rejects.
 */
export async function subscribeServerPush(
  taskId: string,
  lane: PushLane = "hourly"
): Promise<ServerSubscribeResult> {
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
          lane,
          linkSessionId: lane === "hourly" ? (loadSession()?.id ?? null) : null,
          roster: lane === "hourly" ? snapshotRoster() : [],
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
    setServerPushOn(taskId, sub.endpoint, lane);
    return "ok";
  } catch {
    return "failed";
  }
}

/**
 * Full server unsubscribe: registry DELETE first (idempotent — a failure
 * still proceeds to the device half), then the device unsubscribe, then the
 * map entry. Scope-1 assumption per lane: this device holds at most one sub
 * per lane (today `barrier` on hourly, `purple-hole` on purple), so dropping
 * the live sub is exact.
 */
export async function unsubscribeServerPush(taskId: string, lane: PushLane = "hourly"): Promise<void> {
  const endpoint = readSubs()[subKey(lane, taskId)];
  if (endpoint) {
    try {
      await fetch("/api/push/subscribe", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint, lane }),
      });
    } catch {
      // idempotent server-side; the fanout prune covers a missed delete.
    }
  }
  try {
    const live = await getLiveSub();
    if (live && (!endpoint || live.endpoint === endpoint)) {
      // One live sub per origin serves every lane: only revoke it when no
      // other lane entry still points at it — otherwise bell-off on one lane
      // silently kills the other lane's delivery (its row survives, pointing
      // at a dead endpoint, until the prune + reconcile cascade confuses the
      // bell). The other lane keeps working on the shared sub untouched.
      const shared = Object.entries(readSubs()).some(
        ([k, v]) => k !== subKey(lane, taskId) && v === live.endpoint
      );
      if (!shared) await live.unsubscribe();
    }
  } catch {
    // map entry still clears below — a stuck sub dies on 404/410 prune.
  }
  setServerPushOn(taskId, null, lane);
}

/**
 * Silent roster refresh (D1a, hourly only — the purple lane is unlinked):
 * renames and new characters would otherwise stale the snapshot until the
 * next bell toggle. Runs on bell mount while the live sub is healthy — one
 * cheap upsert per page load, no UI.
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
export async function reconcileServerPush(taskId: string, lane: PushLane = "hourly"): Promise<boolean> {
  const endpoint = readSubs()[subKey(lane, taskId)];
  if (!endpoint) return false;
  const live = await getLiveSub();
  if (live && live.endpoint === endpoint) return false;
  setServerPushOn(taskId, null, lane);
  // Best-effort: the dead endpoint shouldn't linger server-side either
  // (scoped to this lane — the other lane's row is untouched).
  try {
    await fetch("/api/push/subscribe", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint, lane }),
    });
  } catch {
    // fanout prune covers it.
  }
  return true;
}
