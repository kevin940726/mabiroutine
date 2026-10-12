// The counted funnel for app fetches that are NOT the sync session API.
//
// There are exactly two sanctioned funnels for network calls under `src/`, and
// `pnpm test:budget` keeps it that way: it fails any `fetch(` outside these two
// files. `sync/api.ts` owns `/api/session`, counted per kind in `sync/stats.ts`
// and pinned by the sync gate's quota suite; this module owns everything else
// (the push registry, the purple schedule feed). The rule is the point: a new
// request path cannot land without joining a funnel, so every call is countable
// and visible. Visibility is the half that was missing on 2026-10-12, when a
// loop spent 2.81M edge requests while nothing on the device could say what was
// spending them (docs/operations.md §1 and §7).
//
// `netFetch` is a passthrough: it counts, then returns whatever `fetch` returns.
// No retry, no timeout, no cache policy of its own — every caller here is
// best-effort and already degrades on failure, so the funnel must not change
// those semantics. Bounding runaway demand is the Service Worker's job
// (`public/sw-budget.js`); this module only makes demand visible.
//
// Read it in DevTools: `window.__mabiNet()` (wired in main.tsx).
const KEY = "mabiroutine:netstats";
const KEEP_DAYS = 14;

/** `/api/push/subscribe` for our own origin, `host/path` for a cross-origin one. */
export function netLabel(input: string): string {
  try {
    const url = new URL(input, typeof location !== "undefined" ? location.origin : "https://local.invalid");
    const sameOrigin = typeof location === "undefined" || url.origin === location.origin;
    return sameOrigin ? url.pathname : `${url.host}${url.pathname}`;
  } catch {
    return "unparseable";
  }
}

type NetDay = Record<string, number>;

function dayKey(d: Date = new Date()): string {
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function readDoc(): Record<string, NetDay> {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const doc = JSON.parse(raw) as unknown;
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) return {};
    const out: Record<string, NetDay> = {};
    for (const [k, v] of Object.entries(doc as Record<string, unknown>)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !v || typeof v !== "object" || Array.isArray(v)) continue;
      const day: NetDay = {};
      for (const [label, n] of Object.entries(v as Record<string, unknown>)) {
        if (typeof n === "number" && Number.isFinite(n) && n > 0) day[label] = Math.floor(n);
      }
      out[k] = day;
    }
    return out;
  } catch {
    return {};
  }
}

function bump(label: string): void {
  try {
    if (typeof localStorage === "undefined") return;
    const doc = readDoc();
    const key = dayKey();
    const day = doc[key] ?? {};
    day[label] = (day[label] ?? 0) + 1;
    doc[key] = day;
    const keys = Object.keys(doc).sort();
    while (keys.length > KEEP_DAYS) delete doc[keys.shift() as string];
    localStorage.setItem(KEY, JSON.stringify(doc));
  } catch {
    // telemetry never breaks a request
  }
}

/** One counted request. Returns `fetch`'s promise untouched. */
export function netFetch(input: string, init?: RequestInit): Promise<Response> {
  bump(netLabel(input));
  return fetch(input, init);
}

/** `__mabiNet()`: the last day's counters, and the 14-day total. */
export function netSummary(): string {
  const doc = readDoc();
  const keys = Object.keys(doc).sort();
  if (keys.length === 0) return "netstats: no data yet";
  const last = keys[keys.length - 1];
  const parts = Object.entries(doc[last])
    .sort((a, b) => b[1] - a[1])
    .map(([label, n]) => `${label}=${n}`);
  const total = Object.values(doc).reduce((sum, day) => sum + Object.values(day).reduce((a, n) => a + n, 0), 0);
  return `netstats ${last}: ${parts.join(" ") || "none"} · ${keys.length}d total ${total}`;
}
