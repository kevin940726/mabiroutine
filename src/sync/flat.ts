import type { AppState, Character, Task } from "@/lib/types";
import type { SyncSnapshot } from "@/sync/session";
import { currentDailyBucket, getTaipeiWeekKey } from "@/lib/reset";

// Flat key-space for conflict-free sync. Every mutation anywhere in the app
// is an absolute set of one of these keys, so per-key last-arrival-wins is
// deterministic and complete — no versions, no clocks, no tombstone GC
// (null = deleted tombstone, retained; keys are only ever revived by reuse).
//
//   v:{cid}:{tid}    task values (number|boolean)
//   acc:{tid}        account values
//   hide:{cid}:{tid} | hide:acc:{tid}   hidden flags (true)
//   pin:{bid}        barter pin membership (true; unpin = null)
//   custom:{id}      custom task object (order stripped) | null
//   char:{cid}:name  character name
//   meta:active      active character id
//   meta:resetDaily | meta:resetWeekly   reset-bucket signals (read-only —
//                                        peers gate tombstones on them)
//   pref:hideCompleted | filter:{priority|town|skill|onlyPinned}
//
// Deliberately NOT synced (per-device local): all ordering (drag order,
// character tabs, pin order — deterministic id-sorted fallback on fresh
// adopt). Reset markers sync as signals, but each device still resets itself
// by Taipei clock and decides first-vs-catch-up locally (see syncAndResets).

export type FlatMap = Record<string, unknown>;

const eq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export function flattenSnapshot(s: SyncSnapshot): FlatMap {
  const flat: FlatMap = {};
  for (const c of s.characters ?? []) {
    flat[`char:${c.id}:name`] = c.name;
    for (const [k, v] of Object.entries(c.taskValues ?? {})) flat[`v:${c.id}:${k}`] = v;
    for (const id of c.hiddenTaskIds ?? []) flat[`hide:${c.id}:${id}`] = true;
  }
  for (const [k, v] of Object.entries(s.accountValues ?? {})) flat[`acc:${k}`] = v;
  for (const id of s.hiddenAccountTaskIds ?? []) flat[`hide:acc:${id}`] = true;
  for (const id of s.barterPins ?? []) flat[`pin:${id}`] = true;
  for (const t of s.customTasks ?? []) {
    const { order: _order, ...rest } = t as Task & { order?: unknown };
    flat[`custom:${t.id}`] = rest;
  }
  if (s.activeCharId) flat["meta:active"] = s.activeCharId;
  // Reset markers: peers use them to tell a first reset (tombstones welcome)
  // from a late catch-up reset (tombstones suppressed) — see syncAndResets.
  // Absent when never reset (fresh installs, old clients).
  if (s.lastDailyReset) flat["meta:resetDaily"] = s.lastDailyReset;
  if (s.lastWeeklyReset) flat["meta:resetWeekly"] = s.lastWeeklyReset;
  if (s.prefs) flat["pref:hideCompleted"] = s.prefs.hideCompleted === true;
  const f = s.barterFilters;
  if (f) {
    flat["filter:priority"] = f.priority;
    flat["filter:town"] = f.town;
    flat["filter:skill"] = f.skill;
    flat["filter:onlyPinned"] = f.onlyPinned === true;
  }
  return flat;
}

// Diff current against base: changed keys carry new values, base-keys gone
// from current carry null (tombstone). Nulls already in base stay silent.
export function diffFlat(base: FlatMap, now: FlatMap): FlatMap {
  const changes: FlatMap = {};
  for (const [k, v] of Object.entries(now)) {
    if (!eq(base[k], v)) changes[k] = v;
  }
  for (const k of Object.keys(base)) {
    if (!(k in now)) changes[k] = null;
  }
  return changes;
}

// Per-session sync base (last synced flat, nulls included). Switching
// sessions resets it — first push then sends the full map (always safe).
const BASE_KEY = "mabiroutine:flatbase";

export function loadBase(sessionId: string): FlatMap {
  try {
    const raw = localStorage.getItem(BASE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { sessionId?: unknown; flat?: unknown };
    if (parsed.sessionId !== sessionId || !parsed.flat || typeof parsed.flat !== "object") return {};
    return parsed.flat as FlatMap;
  } catch {
    return {};
  }
}

export function saveBase(sessionId: string, flat: FlatMap): void {
  try {
    localStorage.setItem(BASE_KEY, JSON.stringify({ sessionId, flat }));
  } catch {
    // private mode — next push degrades to full map, still correct
  }
}

function validCustom(v: unknown): v is Task {
  if (!v || typeof v !== "object") return false;
  const t = v as Partial<Task>;
  return typeof t.id === "string" && typeof t.name === "string";
}

function sortedIds(ids: string[]): string[] {
  return [...ids].sort();
}

type CharBucket = { name: string; taskValues: Record<string, number | boolean>; hidden: string[] };

// Group flat keys per character; skips malformed values defensively.
function bucketize(flat: FlatMap): Map<string, CharBucket> {
  const map = new Map<string, CharBucket>();
  const bucket = (cid: string): CharBucket => {
    let b = map.get(cid);
    if (!b) {
      b = { name: "", taskValues: {}, hidden: [] };
      map.set(cid, b);
    }
    return b;
  };
  for (const [k, v] of Object.entries(flat)) {
    if (v == null) continue;
    let m = /^char:([^:]+):name$/.exec(k);
    if (m) {
      if (typeof v === "string") bucket(m[1]).name = v;
      continue;
    }
    m = /^v:([^:]+):(.+)$/.exec(k);
    if (m) {
      if (typeof v === "number" || typeof v === "boolean") bucket(m[1]).taskValues[m[2]] = v;
      continue;
    }
    m = /^hide:([^:]+):(.+)$/.exec(k);
    if (m && m[1] !== "acc") {
      if (v === true) bucket(m[1]).hidden.push(m[2]);
    }
  }
  return map;
}

function buildCharacters(
  buckets: Map<string, CharBucket>,
  order: string[],
  cap = 6
): Character[] {
  const ids = sortedIds([...buckets.keys()]);
  const ordered = [...order.filter((id) => buckets.has(id)), ...ids.filter((id) => !order.includes(id))];
  return ordered.slice(0, cap).map((id) => {
    const b = buckets.get(id)!;
    return {
      id,
      name: b.name || "角色",
      taskValues: b.taskValues,
      hiddenTaskIds: b.hidden,
    } as Character;
  });
}

// Fresh adopt (no local order to preserve): deterministic id-sorted layout.
// Feeds applySnapshot like a backup import.
export function unflattenReplace(flat: FlatMap, version: number): AppState & { version: number } {
  const buckets = bucketize(flat);
  const customs: Task[] = [];
  for (const [k, v] of Object.entries(flat)) {
    const m = /^custom:(.+)$/.exec(k);
    if (m && validCustom(v)) customs.push(v);
  }
  customs.sort((a, b) => (a.id < b.id ? -1 : 1));
  const withOrder = customs.map((t, i) => ({ ...t, order: (i + 1) * 10 }));
  const pins = sortedIds(
    Object.entries(flat)
      .filter(([k, v]) => v === true && k.startsWith("pin:"))
      .map(([k]) => k.slice(4))
  );
  const characters = buildCharacters(buckets, []);
  const active =
    typeof flat["meta:active"] === "string" && characters.some((c) => c.id === flat["meta:active"])
      ? (flat["meta:active"] as string)
      : (characters[0]?.id ?? "");
  // Adopted state counts as current-bucket: null markers would wipe the
  // adoption on next tick and tombstone the peer's same-bucket progress.
  const now = new Date();
  return {
    version,
    characters,
    activeCharId: active,
    accountValues: pickValues(flat, "acc:"),
    hiddenAccountTaskIds: pickTrue(flat, "hide:acc:"),
    barterPins: pins,
    customTasks: withOrder,
    lastDailyReset: currentDailyBucket(now),
    lastWeeklyReset: getTaipeiWeekKey(now),
    prefs: { hideCompleted: flat["pref:hideCompleted"] === true },
    barterFilters: {
      priority: pickOne(flat["filter:priority"], ["all", "must", "extra", "once", "situational", "skip"], "all"),
      town: typeof flat["filter:town"] === "string" ? (flat["filter:town"] as string) : "all",
      skill: typeof flat["filter:skill"] === "string" ? (flat["filter:skill"] as string) : "all",
      onlyPinned: flat["filter:onlyPinned"] === true,
    },
    // NOTE: globalTaskOrder intentionally omitted — ordering is per-device
    // local; applySnapshot keeps the current value when the key is absent.
  } as AppState & { version: number };
}

function pickValues(flat: FlatMap, prefix: string): Record<string, number | boolean> {
  const out: Record<string, number | boolean> = {};
  for (const [k, v] of Object.entries(flat)) {
    if (k.startsWith(prefix) && (typeof v === "number" || typeof v === "boolean")) {
      out[k.slice(prefix.length)] = v;
    }
  }
  return out;
}

function pickTrue(flat: FlatMap, prefix: string): string[] {
  return Object.entries(flat)
    .filter(([k, v]) => v === true && k.startsWith(prefix))
    .map(([k]) => k.slice(prefix.length));
}

function pickOne<T extends string>(v: unknown, allowed: T[], fallback: T): T {
  return typeof v === "string" && (allowed as string[]).includes(v) ? (v as T) : fallback;
}

// Merge pull: remote values wholesale (caller guarantees local already
// pushed, so every local key exists remotely), local ordering preserved.
// Dead keys (null/absent remotely) drop; new ids append deterministically.
export function unflattenMerge(
  flat: FlatMap,
  local: SyncSnapshot,
  version: number
): AppState & { version: number } {
  const buckets = bucketize(flat);
  const localOrder = (local.characters ?? []).map((c) => c.id);
  const characters = buildCharacters(buckets, localOrder);
  // Names for brand-new chars come from the bucket; order preserved above.
  const remoteCustoms = new Map<string, Task>();
  for (const [k, v] of Object.entries(flat)) {
    const m = /^custom:(.+)$/.exec(k);
    if (m && validCustom(v)) remoteCustoms.set(m[1], v);
  }
  const localById = new Map((local.customTasks ?? []).map((t) => [t.id, t]));
  const merged: Task[] = [];
  for (const t of local.customTasks ?? []) {
    const r = remoteCustoms.get(t.id);
    if (r) merged.push({ ...r, order: t.order });
  }
  let maxOrder = merged.reduce((m, t) => Math.max(m, t.order ?? 0), 0);
  for (const id of sortedIds([...remoteCustoms.keys()])) {
    if (localById.has(id)) continue;
    maxOrder += 10;
    merged.push({ ...remoteCustoms.get(id)!, order: maxOrder });
  }
  const members = new Set(
    Object.entries(flat)
      .filter(([k, v]) => v === true && k.startsWith("pin:"))
      .map(([k]) => k.slice(4))
  );
  const pins = [
    ...(local.barterPins ?? []).filter((id) => members.has(id)),
    ...sortedIds([...members]).filter((id) => !(local.barterPins ?? []).includes(id)),
  ];
  const active =
    typeof flat["meta:active"] === "string" &&
    characters.some((c) => c.id === flat["meta:active"])
      ? (flat["meta:active"] as string)
      : (local.activeCharId && characters.some((c) => c.id === local.activeCharId)
        ? local.activeCharId
        : (characters[0]?.id ?? ""));
  return {
    version,
    characters,
    activeCharId: active,
    accountValues: pickValues(flat, "acc:"),
    hiddenAccountTaskIds: pickTrue(flat, "hide:acc:"),
    barterPins: pins,
    customTasks: merged,
    lastDailyReset: local.lastDailyReset ?? null,
    lastWeeklyReset: local.lastWeeklyReset ?? null,
    prefs: { hideCompleted: flat["pref:hideCompleted"] === true },
    barterFilters: {
      priority: pickOne(flat["filter:priority"], ["all", "must", "extra", "once", "situational", "skip"], local.barterFilters?.priority ?? "all"),
      town: typeof flat["filter:town"] === "string" ? (flat["filter:town"] as string) : (local.barterFilters?.town ?? "all"),
      skill: typeof flat["filter:skill"] === "string" ? (flat["filter:skill"] as string) : (local.barterFilters?.skill ?? "all"),
      onlyPinned: flat["filter:onlyPinned"] === true,
    },
    globalTaskOrder: local.globalTaskOrder,
  } as AppState & { version: number };
}
