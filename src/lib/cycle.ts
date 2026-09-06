import { currentDailyBucket, getTaipeiWeekKey } from "@/lib/reset";
import trackerJson from "@/data/tracker.json";
import barterJson from "@/data/barter.json";

// Cycle bucketing for task values: a value is tagged with the Taipei day
// bucket (daily-kind tasks) or week bucket (weekly-kind) it was set in.
// Reads consider only the CURRENT bucket, so a reset is a pure memory prune
// — the sync protocol contains no reset deletes at all (see docs/sync.md).
// Shared by the store (provenance pruning) and the sync codec (wire tags).

type Builtin = { id: string; kind: string };
const BUILTIN_KIND = new Map<string, string>((trackerJson as Builtin[]).map((t) => [t.id, t.kind]));
const BARTER_IDS = new Set((barterJson as { id: string }[]).map((b) => b.id));

const WEEKLY_KINDS = new Set(["weekly", "account-weekly"]);

export function taskKind(tid: string, customTasks: { id: string; kind: string }[]): string {
  const b = BUILTIN_KIND.get(tid);
  if (b) return b;
  const c = customTasks.find((t) => t.id === tid);
  if (c) return c.kind;
  if (BARTER_IDS.has(tid)) return "daily";
  return "daily";
}

// The bucket a value for `tid` belongs to, computed from the current clock.
export function cycleBucketFor(tid: string, customTasks: { id: string; kind: string }[], now: Date = new Date()): string {
  return WEEKLY_KINDS.has(taskKind(tid, customTasks)) ? getTaipeiWeekKey(now) : currentDailyBucket(now);
}

// Cycle-scoped wire key parser: `...{tid}@{bucket}` under v:/acc: prefixes.
// Returns null for untagged (legacy) keys — inert garbage: never adopted,
// never tombstoned; they age in place server-side.
export function parseCycleKey(key: string): { prefix: string; bucket: string } | null {
  const at = key.lastIndexOf("@");
  if (at < 0) return null;
  if (!key.startsWith("v:") && !key.startsWith("acc:")) return null;
  return { prefix: key.slice(0, at), bucket: key.slice(at + 1) };
}

export function isCycleKey(key: string): boolean {
  return parseCycleKey(key) !== null;
}

export const GC_DAYS = 60;

function bucketStartMs(bucket: string): number {
  // Day buckets: "YYYY-MM-DD" (Taipei date). Week buckets: "YYYY-Wmmdd"
  // (the Monday's date). Both fixed-width; parse the date part.
  const w = /^(\d{4})-W(\d{2})(\d{2})$/.exec(bucket);
  if (w) return Date.UTC(Number(w[1]), Number(w[2]) - 1, Number(w[3]), -8);
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(bucket);
  if (d) return Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), -8);
  return NaN; // unknown format — never expires
}

// Cycle keys whose bucket started more than GC_DAYS ago: safe to tombstone
// for real (no current device reads them; racing GCs dedupe via
// tombstones-once). Keeps the server hash and GET payloads bounded.
export function expiredCycleKeys(flat: Record<string, unknown>, now: Date = new Date()): string[] {
  const cutoff = now.getTime() - GC_DAYS * 24 * 3600 * 1000;
  const out: string[] = [];
  for (const k of Object.keys(flat)) {
    const p = parseCycleKey(k);
    if (!p) continue;
    const start = bucketStartMs(p.bucket);
    if (!Number.isNaN(start) && start < cutoff) out.push(k);
  }
  return out;
}
