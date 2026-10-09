import { eq, type FlatMap } from "@/sync/flat";

// Round planning for the sync engine. The retained base (last synced flat) is
// the arbiter: a local change rides the wire only while the remote still
// carries the base's value for that key. If both sides changed a key since
// this device last synced, the remote wins — without clocks the two cases
// (a stale leftover vs a later local edit) are indistinguishable, and the
// remote bias is the one that can never replay an outdated device's values
// over a peer's newer progress (docs/sync.md decision 16).
//
// `remote` is null when the freshness probe proved the server has not moved
// since the base's `ts`; local changes are then uncontested by definition and
// are returned as-is (no read happened, so there is no view to merge).
export type RoundDecision = {
  /** Keys to PATCH (local changes the remote has not contested). */
  push: FlatMap;
  /** Remote view overlaid with the accepted keys; null when no remote was read. */
  view: FlatMap | null;
  /** Keys the remote had changed too, so the remote value is adopted. */
  dropped: string[];
};

// Overloads keep the caller's knowledge: with a remote in hand the view is
// always present (the caller merges it), with none there is nothing to merge.
export function planRound(base: FlatMap, changes: FlatMap, remote: null): RoundDecision & { view: null };
export function planRound(base: FlatMap, changes: FlatMap, remote: FlatMap): RoundDecision & { view: FlatMap };
export function planRound(base: FlatMap, changes: FlatMap, remote: FlatMap | null): RoundDecision {
  if (remote === null) return { push: { ...changes }, view: null, dropped: [] };
  const push: FlatMap = {};
  const dropped: string[] = [];
  for (const [k, v] of Object.entries(changes)) {
    if (eq(remote[k], base[k])) push[k] = v;
    else dropped.push(k);
  }
  return { push, view: { ...remote, ...push }, dropped };
}
