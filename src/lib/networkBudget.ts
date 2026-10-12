// Device network budget: the page-side half of `public/sw-budget.js`.
//
// The guard itself lives in the Service Worker (it is the only place that sees
// every request, art included). This module does three things: it keeps a local
// log of the trips the worker reports, it answers `window.__mabiBudget()` in
// DevTools, and it can ask the worker for its live counters. Local only: a trip
// is never sent anywhere, because the guard's success is measured by the
// provider's request count staying flat, not by the app reporting home.
//
// Why a Device may see a trip and the user may see nothing: the policy in the
// worker degrades quietly (art from cache or a transparent pixel, /api/ as the
// 429 the app already renders, navigations from the cached shell). A tripped
// device still works. That is deliberate; see docs/operations.md § The device
// request budget.

const KEY = "mabiroutine:budget";
const KEEP = 10;

export type BudgetTrip = {
  at: number;
  trips: number;
  sample?: { path?: string; destination?: string };
};

type BudgetDoc = { trips: BudgetTrip[] };

function readDoc(): BudgetDoc {
  try {
    if (typeof localStorage === "undefined") return { trips: [] };
    const raw = localStorage.getItem(KEY);
    if (!raw) return { trips: [] };
    const doc = JSON.parse(raw) as unknown;
    if (!doc || typeof doc !== "object") return { trips: [] };
    const trips = (doc as { trips?: unknown }).trips;
    if (!Array.isArray(trips)) return { trips: [] };
    return {
      trips: trips
        .filter((t): t is BudgetTrip => !!t && typeof t === "object" && typeof (t as BudgetTrip).at === "number")
        .slice(-KEEP),
    };
  } catch {
    return { trips: [] };
  }
}

function writeDoc(doc: BudgetDoc): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(KEY, JSON.stringify(doc));
  } catch {
    // storage full/blocked: the trip log is best-effort, never load-bearing
  }
}

/** Called from the worker's trip message (wired in main.tsx). */
export function noteBudgetTrip(t: BudgetTrip): void {
  const doc = readDoc();
  doc.trips = [...doc.trips, t].slice(-KEEP);
  writeDoc(doc);
}

/** `__mabiBudget()`: what this device has seen, without a round trip. */
export function budgetLog(): string {
  const { trips } = readDoc();
  if (!trips.length) return "budget: no trips on this device";
  return trips
    .map((t) => {
      const when = new Date(t.at).toISOString().slice(5, 16).replace("T", " ");
      const where = t.sample?.path ?? "?";
      return `${when} trip #${t.trips} at ${where}`;
    })
    .join(" · ");
}

/** `__mabiBudgetAsk()`: the worker's live counters (bounded wait, never hangs). */
export async function budgetAsk(timeoutMs = 600): Promise<string> {
  const sw = typeof navigator !== "undefined" ? navigator.serviceWorker : undefined;
  const target = sw?.controller;
  if (!target) return "budget: no service worker in control (first visit, or not installed yet)";
  return new Promise<string>((resolve) => {
    let settled = false;
    const done = (msg: string) => {
      if (settled) return;
      settled = true;
      resolve(msg);
    };
    const timer = setTimeout(() => done("budget: worker did not answer (asleep?)"), timeoutMs);
    const channel = new MessageChannel();
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      const d = event.data as {
        attempts?: number;
        blocked?: number;
        trips?: number;
        over?: boolean;
        lastMinute?: number;
        last30?: number;
        last6h?: number;
        config?: { burst?: number; sustained?: number; long?: number };
      };
      done(
        `budget: attempts=${d.attempts ?? "?"} blocked=${d.blocked ?? "?"} trips=${d.trips ?? "?"} over=${d.over ? "yes" : "no"}` +
          ` | last 1m=${d.lastMinute ?? "?"} 30m=${d.last30 ?? "?"} 6h=${d.last6h ?? "?"}` +
          ` | tiers 1m/${d.config?.burst ?? "?"} 30m/${d.config?.sustained ?? "?"} 6h/${d.config?.long ?? "?"}`
      );
    };
    try {
      target.postMessage({ type: "mabi-budget-state" }, [channel.port2]);
    } catch {
      clearTimeout(timer);
      done("budget: could not reach the worker");
    }
  });
}
