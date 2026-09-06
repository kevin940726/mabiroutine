import type { AppState, Character, Task } from "@/lib/types";
import type { SyncSnapshot } from "@/sync/session";
import { currentDailyBucket, getTaipeiWeekKey } from "@/lib/reset";
import {
  parseCycleKey,
  isCycleKey,
  expiredCycleKeys,
  cycleBucketFor,
} from "@/lib/cycle";

export { parseCycleKey, isCycleKey, expiredCycleKeys };

// Flat key-space for conflict-free sync (rev 3). Every mutation anywhere in
// the app is an absolute set of one of these keys, so per-key
// last-arrival-wins is deterministic and complete — no versions, no clocks,
// no 409s (null = deleted tombstone, retained; sent exactly once).
//
//   v:{cid}:{tid}@{bucket}   task values, tagged with the cycle they belong
//   acc:{tid}@{bucket}       account values (same tagging)
//   hide:{cid}:{tid} | hide:acc:{tid}   hidden flags (true)
//   pin:{bid}        barter pin membership (true; unpin = null)
//   custom:{id}      custom task object (order stripped) | null
//   char:{cid}:name  character name
//   meta:active      active character id
//   pref:hideCompleted | filter:{priority|town|skill|onlyPinned}
//
// BUCKETED CYCLE KEYS — the core of rev 3: a value is written under the
// Taipei day bucket (daily-kind tasks) or week bucket (weekly-kind) it was
// set in. Reads only consider the CURRENT bucket, so a reset is a pure
// read-time expiry: the protocol contains NO reset deletes at all. A stale
// device (opened days late) can never tombstone a peer's progress because it
// never deletes anything — its stale memory can only write stale values into
// the current bucket, which is ordinary per-key LWW within the stated
// tolerance (same-key concurrency resolves by arrival; end state wins).
// Old-bucket keys age out server-side via GC (expiredCycleKeys, tombstoned
// once past the retention window). Buckets are fixed-width date strings.
//
// Deliberately NOT synced (per-device local): all ordering (drag order,
// character tabs, pin order — deterministic id-sorted fallback on fresh
// adopt); reset markers (each device resets itself by Taipei clock; those
// deletes are memory-only and healed by the next pull's re-adopt).

export type FlatMap = Record<string, unknown>;

const eq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export function flattenSnapshot(s: SyncSnapshot): FlatMap {
  const now = new Date();
  const customs = s.customTasks ?? [];
  const buckets = s.taskBuckets ?? {};
  const tagOf = (tid: string): string => buckets[tid] ?? cycleBucketFor(tid, customs, now);
  const flat: FlatMap = {};
  for (const c of s.characters ?? []) {
    flat[`char:${c.id}:name`] = c.name;
    for (const [k, v] of Object.entries(c.taskValues ?? {})) {
      flat[`v:${c.id}:${k}@${tagOf(k)}`] = v;
    }
    for (const id of c.hiddenTaskIds ?? []) flat[`hide:${c.id}:${id}`] = true;
  }
  for (const [k, v] of Object.entries(s.accountValues ?? {})) {
    flat[`acc:${k}@${tagOf(k)}`] = v;
  }
  for (const id of s.hiddenAccountTaskIds ?? []) flat[`hide:acc:${id}`] = true;
  for (const id of s.barterPins ?? []) flat[`pin:${id}`] = true;
  for (const t of s.customTasks ?? []) {
    const { order: _order, ...rest } = t as Task & { order?: unknown };
    flat[`custom:${t.id}`] = rest;
  }
  if (s.activeCharId) flat["meta:active"] = s.activeCharId;
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

// Diff current against base: changed keys carry new values; base-keys gone
// from current carry null (tombstone) — with two silences:
//  - cycle keys never tombstone (they expire via GC, never delete — the
//    whole point of rev 3: a stale device's local reset must not propagate),
//  - already-tombstoned keys stay silent: every tombstone sends exactly
//    once (echoes would mask fresh deletions and bloat payloads). Once-only
//    is safe: the server retains tombstones and a failed push never
//    advances the base.
export function diffFlat(base: FlatMap, now: FlatMap): FlatMap {
  const changes: FlatMap = {};
  for (const [k, v] of Object.entries(now)) {
    if (!eq(base[k], v)) changes[k] = v;
  }
  for (const k of Object.keys(base)) {
    if (k in now) continue;
    if (base[k] === null) continue;
    if (isCycleKey(k)) continue; // cycle keys expire, never delete
    changes[k] = null;
  }
  return changes;
}

// Per-session sync base (last synced flat, nulls included). Switching
// sessions resets it — first push then sends the full map (always safe).
//
// The base is PER TAB, not per browser: localStorage is shared across tabs
// but each tab has its own memory, so a shared base lets a suspended tab wake
// up, diff its stale memory against another tab's fresh base, and tombstone
// live keys it simply never saw (a same-browser "late wake" no marker can
// catch — no reset is involved). Tab bases live in sessionStorage with an
// in-memory fallback; the shared localStorage copy is only the seed for tabs
// born later (so a fresh tab doesn't full-push over keys a peer tombstoned
// while this browser was away) — never read after seeding.
const BASE_KEY = "mabiroutine:flatbase";
const TAB_BASE_KEY = "mabiroutine:flattab";

type BaseDoc = { sessionId: string; flat: FlatMap };

function validBaseDoc(d: unknown): d is BaseDoc {
  if (!d || typeof d !== "object") return false;
  const b = d as Partial<BaseDoc>;
  return typeof b.sessionId === "string" && !!b.flat && typeof b.flat === "object";
}

function readSharedBase(): BaseDoc | null {
  try {
    const raw = localStorage.getItem(BASE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return validBaseDoc(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// sessionStorage access itself can throw (blocked cookies) — fall back to a
// module-level doc (lost on reload, which safely degrades to a full push).
let memBase: BaseDoc | null = null;

function readTabBase(): BaseDoc | null {
  try {
    if (typeof sessionStorage === "undefined") return memBase;
    const raw = sessionStorage.getItem(TAB_BASE_KEY);
    if (!raw) return null; // fresh tab → seed from shared, never another realm's memory
    const parsed: unknown = JSON.parse(raw);
    return validBaseDoc(parsed) ? parsed : null;
  } catch {
    return memBase; // blocked storage → memory only (per-realm, no cross-tab bleed)
  }
}

function writeBase(doc: BaseDoc): void {
  memBase = doc;
  try {
    if (typeof sessionStorage !== "undefined") sessionStorage.setItem(TAB_BASE_KEY, JSON.stringify(doc));
  } catch {
    // memory only — next load re-seeds from shared
  }
  try {
    localStorage.setItem(BASE_KEY, JSON.stringify(doc));
  } catch {
    // private mode — next push degrades to full map, still correct
  }
}

export function loadBase(sessionId: string): FlatMap {
  const tab = readTabBase();
  if (tab && tab.sessionId === sessionId) return tab.flat;
  const shared = readSharedBase();
  if (shared && shared.sessionId === sessionId) {
    writeBase(shared);
    return shared.flat;
  }
  return {};
}

export function saveBase(sessionId: string, flat: FlatMap): void {
  writeBase({ sessionId, flat });
}

function validCustom(v: unknown): v is Task {
  if (!v || typeof v !== "object") return false;
  const t = v as Partial<Task>;
  return typeof t.id === "string" && typeof t.name === "string";
}

function sortedIds(ids: string[]): string[] {
  return [...ids].sort();
}

type CharBucket = {
  name: string;
  taskValues: Record<string, number | boolean>;
  hidden: string[];
  buckets: Record<string, string>;
};

// Group flat keys per character; skips malformed values defensively.
// Task values are adopted only from cycle keys tagged with the CURRENT
// bucket for their kind — older buckets are expired (read-time reset) and
// untagged keys are legacy garbage. Memory keys stay PLAIN (tid); the tag
// lands in the returned buckets map (provenance for the next flatten).
function bucketize(flat: FlatMap, customs: Task[]): Map<string, CharBucket> {
  const map = new Map<string, CharBucket>();
  const bucket = (cid: string): CharBucket => {
    let b = map.get(cid);
    if (!b) {
      b = { name: "", taskValues: {}, hidden: [], buckets: {} };
      map.set(cid, b);
    }
    return b;
  };
  const now = new Date();
  for (const [k, v] of Object.entries(flat)) {
    if (v == null) continue;
    let m = /^char:([^:]+):name$/.exec(k);
    if (m) {
      if (typeof v === "string") bucket(m[1]).name = v;
      continue;
    }
    m = /^v:([^:]+):(.+)@(.+)$/.exec(k);
    if (m) {
      if (
        (typeof v === "number" || typeof v === "boolean") &&
        m[3] === cycleBucketFor(m[2], customs, now)
      ) {
        bucket(m[1]).taskValues[m[2]] = v;
        bucket(m[1]).buckets[m[2]] = m[3];
      }
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

// Flat keys belonging to characters the cap slice dropped from a merge.
// The merge keeps the 6-cap invariant for the UI, but the sync base must
// forget these keys: otherwise the next diff reads "base has them, memory
// doesn't" and tombstones a character nobody deleted — permanent, silent
// loss (the victim is deterministic per id-sort, so it never comes back).
// Scrubbed keys stay server-side and re-adopt if a slot ever frees up.
export function capOverflowKeys(flat: FlatMap, keptIds: string[]): string[] {
  const kept = new Set(keptIds);
  const out: string[] = [];
  for (const k of Object.keys(flat)) {
    const m = /^(?:v|hide):([^:]+):.+$/.exec(k) ?? /^char:([^:]+):name$/.exec(k);
    if (!m || m[1] === "acc") continue; // hide:acc:* is account scope, not a char
    if (!kept.has(m[1])) out.push(k);
  }
  return out;
}

// Fresh adopt (no local order to preserve): deterministic id-sorted layout.
// Feeds applySnapshot like a backup import.
export function unflattenReplace(flat: FlatMap, version: number): AppState & { version: number } {
  const customs: Task[] = [];
  for (const [k, v] of Object.entries(flat)) {
    const m = /^custom:(.+)$/.exec(k);
    if (m && validCustom(v)) customs.push(v);
  }
  const buckets = bucketize(flat, customs);
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
  const accBuckets: Record<string, string> = {};
  const accountValues = pickValues(flat, "acc:", customs, accBuckets);
  // Adopted state counts as current-bucket: stale markers would prune the
  // adoption on next tick. (Adopted values carry their own tags anyway.)
  const now = new Date();
  const taskBuckets: Record<string, string> = {};
  for (const b of buckets.values()) Object.assign(taskBuckets, b.buckets);
  Object.assign(taskBuckets, accBuckets);
  return {
    version,
    characters,
    activeCharId: active,
    accountValues,
    hiddenAccountTaskIds: pickTrue(flat, "hide:acc:"),
    barterPins: pins,
    customTasks: withOrder,
    taskBuckets,
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

// Account values: adopt only current-bucket cycle keys (see bucketize).
// Returns the values; adopted provenance tags accumulate into `bucketsOut`.
function pickValues(
  flat: FlatMap,
  prefix: string,
  customs: Task[],
  bucketsOut: Record<string, string>
): Record<string, number | boolean> {
  const now = new Date();
  const out: Record<string, number | boolean> = {};
  for (const [k, v] of Object.entries(flat)) {
    if (!k.startsWith(prefix) || (typeof v !== "number" && typeof v !== "boolean")) continue;
    const p = parseCycleKey(k);
    if (!p) continue;
    const tid = k.slice(prefix.length, k.lastIndexOf("@"));
    if (p.bucket !== cycleBucketFor(tid, customs, now)) continue;
    out[tid] = v;
    bucketsOut[tid] = p.bucket;
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
  const buckets = bucketize(flat, local.customTasks ?? []);
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
  const accBuckets: Record<string, string> = {};
  const accountValues = pickValues(flat, "acc:", local.customTasks ?? [], accBuckets);
  const taskBuckets: Record<string, string> = {};
  for (const b of buckets.values()) Object.assign(taskBuckets, b.buckets);
  Object.assign(taskBuckets, accBuckets);
  return {
    version,
    characters,
    activeCharId: active,
    accountValues,
    hiddenAccountTaskIds: pickTrue(flat, "hide:acc:"),
    barterPins: pins,
    customTasks: merged,
    taskBuckets,
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
