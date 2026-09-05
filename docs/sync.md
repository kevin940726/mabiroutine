# Sync architecture — conflict-free per-key LWW

Single user, many devices. Goal: edits on any device converge everywhere with
no dialogs, no versions, no clocks. Tolerance (explicit): end state wins over
intent audit — a converged value both devices display beats a history of who
tapped what.

## Protocol

One Upstash record per session: `{ v: 2, updatedAt, writerId, seq, keys }`
where `keys` maps flat string keys to `{ seq, v }`. The server is
schema-agnostic: it versions JSON paths, never tracker semantics.

| Method | Body | Effect |
|---|---|---|
| POST | `{ state: flat map }` | Mint id, all keys at seq 1..n |
| GET | `?id=` | `{ state: flat map (nulls incl.), updatedAt }`, or `{ legacy, updatedAt }` for v1 blobs |
| PATCH | `{ id, changes: {k: v} }` | Apply unconditionally, each key stamped `++seq`. Never 409s |
| DELETE | `{ id }` | Drop record (idempotent) |

Rate limits: create 10/hr/IP, everything else 60/min/IP. Payload cap 200KB.
Code: `api/session.ts`. Namespace `mabiroutine:` prod / `mabiroutine:dev:` local
(the latter is a Development-scoped project env var — `vercel dev` does NOT
forward `.env.local` custom keys to functions).

## Key space (`src/sync/flat.ts`)

```
v:{cid}:{tid}    task values (number|boolean)
acc:{tid}        account values
hide:{cid}:{tid} | hide:acc:{tid}   hidden flags (true)
pin:{bid}        pin membership (true; unpin = null)
custom:{id}      custom task object, order stripped | null
char:{cid}:name  character name
meta:active      active character id
pref:hideCompleted | filter:{priority|town|skill|onlyPinned}
```

## Client engine (`src/sync/SyncButton.tsx`, `src/sync/session.ts`)

- **Push** (debounced 3s, flushed on tab-hide): diff current flat vs retained
  base (`mabiroutine:flatbase`, per-session) → PATCH changed keys; base-keys
  gone from current go as `null` (tombstones). Returns false when edits remain
  unsent — callers must not clobber them.
- **Pull** (mount, tab-visible, window-focus, 60s foreground repoll, 10s
  throttle): flush first (arrival = order, so local edits land before adopting
  remote), abort if still dirty, GET, abort if edited mid-flight, apply
  wholesale via `unflattenMerge` (remote values, **local ordering**), save base.
- **Adopt** (`?s=` boot, paste field): pristine → silent wholesale adopt;
  other session + non-pristine → confirm dialog (consent for binding *switch*,
  not conflict resolution); same session → pull round.
- Binding shown in URL (`?s=`, `replaceState`, stripped on cancel).

## Findings → decisions

1. **Counters are increments, not sets — until you define intent as end
   state.** Both devices at 5, both tap → both write 6, merge 6. Under
   increment semantics that's a lost update (truth 7); under set semantics
   both intents ("I saw 5, I want 6") are satisfied. With the stated
   tolerance, per-key LWW converges correctly. Same-key concurrency resolves
   by arrival order — silent, deterministic, accepted.
2. **Toggles must be absolute.** The UI knows current state, so it sends
   `= true/false`, never "flip". RMW shape eliminated at the source.
3. **Deletes are booleans, never removals.** Unpin/unhide/remove-character
   write `false`/`null`; tombstones (`null`) are retained server-side.
   No GC needed: reset-cleared keys are revived by reuse, and
   never-reused keys (deleted customs/chars) are bytes at this scale.
   Stale replicas cannot resurrect — the tombstone's newer seq wins.
4. **Ordering is per-device local, never synced.** Drag order, pin order,
   character tabs. Cross-device order merge is index soup even with ranks;
   local order is also arguably better UX (different screens, different ideal
   orders). Fresh adopts fall back to deterministic id-sorted layout.
   Cost: reordering on desktop doesn't move phone rows. Accepted.
5. **Reset markers stay local; resets delete keys.** Each device resets
   itself by Taipei clock; deletions propagate as tombstones and revive on
   next cycle. Ordering guarantee that makes this safe: reset-check runs
   before any post-boot push (hydrate/focus cadence; mount path only pulls).
6. **Timestamp trust is the load-bearing remainder — solved by arrival
   order.** Phone clocks skew, so wall time is out; HLCs would bloat user
   state. A single server's receive order is total and matches real order
   for alternating-device use. No versions, no clocks, no 409s.
7. **Base map is per-session and minimal.** First push after session switch
   sends the full map (always safe); `null`s persist in base so tombstones
   aren't re-sent.
8. **v1 sessions upgrade transparently.** GET serves the blob under `legacy`;
   client adopts/flattens locally; next push sends full flat and the server
   replaces the record. No re-linking, verified live against a seeded v1.
9. **Whole-state LWW + 409 + dialog deleted** (server guard, conflict UI,
   badge, takeTheirs/keepMine). The 409 era's lesson is preserved as a
   negative: detection was automatic but announcement was manual — silent
   limbo. The new design has no limbo state to announce.

## Trade-offs and residual risks

- Same-key concurrent edits resolve by arrival with no trace. By design
  tolerance; add per-key versions to GET only if a real complaint arrives.
- Tombstones grow on deletes that are never reused (deleted customs/chars).
  Bounded by user behavior; revisit if a record ever approaches the 200KB cap.
- 6-character cap: a merge yielding 7+ slices like load does. Two devices
  both creating at cap is the only trigger; accepted.
- Repoll-while-visible is the quota driver, not the merge model (below).
- `handle_links: preferred` routes tapped links into the installed app
  (Chrome 122+); iOS web apps and mismatched Android browsers still need the
  paste field — buckets are per-browser-partition and no manifest bridges them.

## Quota budget (Upstash free: 500K cmds/mo)

Merge model adds zero commands vs 409 era (same round trips; smaller push
payloads). Per round ≈ 3 cmds (INCR + GET/SET).

| Profile | Cost | Headroom |
|---|---|---|
| Normal (~30 pulls + ~30 pushes/day) | ~6K/mo | ~80 such users |
| Always-open tab (60s repoll) | ~135K/mo | ~3 such users |

First knobs if pinched: repoll 60s → 5min (5×), or `updatedAt`-only check
before full GETs. Not needed now.

## Verified (rig, two isolated profiles, real clicks)

Disjoint edits converge · same-counter race converges, no dialog · unpin
tombstone propagates, no resurrection · legacy blob adopts (values + toast)
and upgrades to flat · cancel strips `?s=` · offline shell renders ·
rebuild-under-open-page auto-updates with toast · zero page errors throughout.
