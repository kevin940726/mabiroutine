# Sync architecture — conflict-free per-key LWW

Single user, many devices. Goal: edits on any device converge everywhere with
no dialogs, no versions, no clocks. Tolerance (explicit): end state wins over
intent audit — a converged value both devices display beats a history of who
tapped what.

## Protocol

One Upstash **hash** per session (key `` `${SESSION_PREFIX}${id}:h` ``):
field `~meta` holds `{ v: 2, updatedAt, writerId, seq }`, every other field is
one flat sync key with a tagged-JSON value (`j:` + JSON — the tag keeps values
plain strings through client deserialization; `~`-prefixed keys are rejected
with 400 so no client can forge meta). The server is schema-agnostic: it
versions JSON paths, never tracker semantics. A PATCH is a **single HSET** of
meta + changed fields, so concurrent PATCHes from two devices are per-field
last-writer-wins and can never interleave a read-modify-write and drop each
other's keys (the pre-hash single-blob layout did exactly that — see 10).
Pre-hash string records (v1 blobs, v2 blobs) are still served and upgrade
into the hash on first PATCH.

| Method | Body | Effect |
|---|---|---|
| POST | `{ state: flat map }` | Mint id, all keys at seq 1..n |
| GET | `?id=` | `{ state: flat map (nulls incl.), updatedAt }`, or `{ legacy, updatedAt }` for v1 blobs |
| PATCH | `{ id, changes: {k: v} }` | One HSET of meta + fields (atomic per-field LWW). Never 409s |
| DELETE | `{ id }` | Drop hash + legacy string (idempotent) |

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
meta:resetDaily | meta:resetWeekly   reset-bucket signals (peers gate
                                     tombstones on them; never user data)
pref:hideCompleted | filter:{priority|town|skill|onlyPinned}
```

## Client engine (`src/sync/SyncButton.tsx`, `src/sync/session.ts`)

- **Push** (debounced 3s, flushed on tab-hide): diff current flat vs retained
  base (`mabiroutine:flatbase`, per-session) → PATCH changed keys; base-keys
  gone from current go as `null` (tombstones). Resolves the pushed key-set
  ({} when clean) or null when nothing was sent — callers must not treat
  remote state as newer than unsent local edits.
- **Pull** (mount, tab-visible, window-focus, 60s foreground repoll, 10s
  throttle): flush first (arrival = order, so local edits land before adopting
  remote), abort if still dirty, GET, abort if edited mid-flight, fold the
  acknowledged push over the GET result (a lagged/cached read must never
  resurrect a pre-push absence — the merge would adopt it and the next push
  would tombstone it), apply wholesale via `unflattenMerge` (remote values,
  **local ordering**), save base + seen peer markers.
- **Reset** (`syncAndResets`: pull → `checkResets` → maybe pull): every trigger
  (boot, focus, 60s) pulls first so the tombstone decision sees fresh peer
  markers; a branch firing into an already-peer-reached bucket suppresses its
  tombstones (scrubs them from the base) and re-pulls to re-adopt. Serialized
  — overlapping triggers share one run.
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
5. **Reset markers stay local; resets delete keys — but tombstones are
   marker-gated.** Each device resets itself by Taipei clock; deletions
   propagate as tombstones and revive on next cycle. The FIRST device into a
   bucket resets fully (stale keys die everywhere, correctly). A LATE device
   (peer marker already in the bucket) still wipes locally but suppresses its
   tombstones — otherwise it nukes the peer's same-bucket progress every
   morning it wakes second (the pre-gate ordering note below was wrong about
   exactly this). Adopt/import stamp the current bucket so arrivals never
   wipe-and-tombstone on next tick.
6. **Timestamp trust is the load-bearing remainder — solved by arrival
   order.** Phone clocks skew, so wall time is out; HLCs would bloat user
   state. A single server's receive order is total and matches real order
   for alternating-device use. No versions, no clocks, no 409s.
7. **Base map is per-session and minimal.** First push after session switch
   sends the full map (always safe); `null`s persist in base so tombstones
   aren't re-sent.
8. **v1 sessions upgrade transparently.** GET serves the blob under `legacy`;
   client adopts/flattens locally; next push sends full flat and the server
   upgrades the record (v2 strings upgrade the same way). No re-linking,
   verified live against a seeded v1.
9. **Whole-state LWW + 409 + dialog deleted** (server guard, conflict UI,
   badge, takeTheirs/keepMine). The 409 era's lesson is preserved as a
   negative: detection was automatic but announcement was manual — silent
   limbo. The new design has no limbo state to announce.
10. **PATCH must be single-command atomic — the blob RMW lost updates.**
    The v2 blob PATCHed via get → merge → set; two devices pushing inside the
    same window (each PATCH is several sequential REST round trips) resolved
    to last-*record*-wins, silently dropping the loser's keys. Clients then
    adopted the loss on next pull and tombstoned it everywhere — a permanent,
    ping-ponging wipe that looked like "focus makes the other device truth".
    The hash layout fixes the class: concurrent PATCHes only ever race on the
    *same field*, which is true per-key LWW. Client shields stay as defense in
    depth (no-store fetches + `Cache-Control: no-store` + acknowledged-push
    overlay), but they cannot fix a server that drops writes — only atomicity
    can.
11. **Same key, two buckets — markers break the tie.** A late device's reset
    deletions are indistinguishable from news at the key level (its stale
    Monday copy vs the peer's fresh Tuesday write share one key), so the
    decision moved up one level: synced `meta:reset*` bucket signals + a
    local per-session seen-sidecar. Suppress = scrub-from-base (never send),
    never delete-from-server. Residual: sub-second simultaneous first-wakes
    both reset fully (same stale keys, idempotent nulls — converges); mixed
    versions fall back to full resets until all devices update.

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
payloads). Per round ≈ INCR + HGETALL/HSET (same count as the blob's
INCR + GET/SET).

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
Server, live against prod Redis (`mabiroutine:dev:`): `j:`-tag round-trips as
plain strings through client deserialization · 20 concurrent disjoint HSETs
all survive · immediate HGETALL-after-HSET reads fresh on this database.
