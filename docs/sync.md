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

Rate limits: create 10/hr/IP, everything else 60/min/IP (prod, keyed on the
verified client IP — `x-real-ip`, else the last forwarded entry). Dev
namespace (`mabiroutine:dev:`): 500/hr + 600/min — the regression gate would
trip prod budgets, and dev keys are throwaway. Payload cap 200KB per request;
keys must use a known prefix (`v:|acc:|hide:|pin:|custom:|char:|meta:|pref:|filter:`,
128 chars max), string values 500 chars max, objects 8KB max, arrays rejected,
`__proto__`/`constructor`/`prototype` rejected, 2000 keys per request and 5000
fields per session (400/413 past that). Sessions expire after 180 days without
a read/write (sliding TTL on every GET/PATCH/POST) — a leaked link dies on its
own.
Namespace by Vercel scope (`SYNC_KEY_PREFIX`): Development + Preview use
`mabiroutine:dev:`, Production uses the default — preview deployments are
the staging environment (prod code path, isolated data). Env changes bake
in at deploy time: a new preview deployment is needed to pick them up.
Code: `api/session.ts`. Namespace `mabiroutine:` prod / `mabiroutine:dev:` local
(the latter is a Development-scoped project env var — `vercel dev` does NOT
forward `.env.local` custom keys to functions).

## Key space (`src/sync/flat.ts`, rev 3)

```
v:{cid}:{tid}@{bucket}   task values, tagged with the cycle they belong to
acc:{tid}@{bucket}       account values (same tagging)
hide:{cid}:{tid} | hide:acc:{tid}   hidden flags (true)
pin:{bid}        pin membership (true; unpin = null)
custom:{id}      custom task object, order stripped | null
char:{cid}:name  character name
meta:active      active character id
pref:hideCompleted | filter:{priority|town|skill|onlyPinned}
```

`{bucket}` is the Taipei day key (`YYYY-MM-DD`) for daily-kind values
(daily, account-daily, barter rows) and the week key (`YYYY-Wmmdd`) for
weekly kinds. Provenance lives in the store (`taskBuckets: tid -> bucket`,
v13) and rides the wire on every value key.

## Client engine (`src/sync/SyncButton.tsx`, `src/sync/session.ts`)

- **Push** (debounced 3s, flushed on tab-hide): diff current flat vs retained
  **per-tab** base (sessionStorage `flattab`, seeded once from the shared
  localStorage `flatbase`) → PATCH changed keys. Two silences: base-keys
  already null stay silent (tombstones send exactly once), and **cycle keys
  never tombstone** (they expire by bucket — a stale device physically
  cannot delete anything). Resolves the pushed key-set ({} when clean) or
  null when nothing was sent — callers must not treat remote state as newer
  than unsent local edits. (→ S2)
- **Pull** (mount, tab-visible, window-focus, 60s foreground repoll, 10s
  throttle — hook-driven pulls via `syncAndResets` bypass the throttle so
  reset-after-pull ordering holds on boot; a throttled no-op pull would let
  `checkResets` prune before the adopt lands and trip the mid-flight guard;
  mount GET preloaded by an `index.html` inline fetch so the round trip
  overlaps JS bootstrap — consume-once, id-matched, 60s TTL, live-GET
  fallback; concurrent pulls join one in-flight run):
  flush first (arrival = order, so local edits land before adopting
  remote), abort if still dirty, GET, abort if edited mid-flight, fold the
  acknowledged push over the GET result (a lagged/cached read must never
  resurrect a pre-push absence — this also covers the preloaded pre-flush
  read), apply wholesale via `unflattenMerge`
  (current-bucket values only, **local ordering**), GC expired cycle keys
  (tombstone once past the 60-day retention), save base. Offline (boot
  included): `offline()` throws before any fetch, the round fails silent and
  local state stands — resume on next foreground / 60s repoll. (→ S1, S3, S5)
- **Reset** (`syncAndResets`: pull → `checkResets`): the pull-first order is
  UX only (a late wake adopts the peer's current-bucket values before its own
  stale ones are pruned). The prune is memory-only; there is nothing to
  suppress, gate, or re-pull. Serialized — overlapping triggers share one run.
  (→ S3)
- **Adopt** (`?s=` boot, paste field): pristine → silent wholesale adopt;
  other session + non-pristine → confirm dialog (consent for binding *switch*,
  not conflict resolution); same session → pull round. (→ S4)
- Binding lives in `localStorage` (`mabiroutine:session`); `?s=` is
  arrival-only transport, never persisted. `index.html` stashes the arrival id
  and strips `?s=` before the React bundle (and analytics) loads; the dialog's
  copy field is the share surface. One binding per browser profile — two
  synced accounts need separate storage partitions (browser vs installed PWA,
  two browsers, normal vs private window); opening a second link in another
  tab switches both tabs to it.

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
 5. **Resets are read-time expiry, never deletes** (rev 3 — supersedes the
    marker-gating of #11). Every wiped session traced to one domain decision:
    resets as write-time deletes. Rev 3 tags every value with its cycle
    bucket (store provenance `taskBuckets`, v13); reads consider only the
    current bucket; a reset prunes memory and writes NOTHING. A stale device
    (opened days late) can no longer wipe a peer: it never deletes, and its
    stale values live under old buckets no one reads. Local prune ordering
    vs pulls is a UX nicety, not a safety property. Companion rule (2026-09-07):
    user-initiated clears write explicit PRESENT values (uncheck → `false`,
    counter-zero/clear → `0`), never absence — presence is the propagation
    bit. Deleting on uncheck stays silent on the wire (correct for resets)
    but the server's old `true` then resurrects on the next pull; explicit
    falses propagate through the ordinary value path and converge. Provenance-less values
    (v12 upgrades, ancient imports) are NOT blindly stamped current — the
    last-reset markers witness their age, and a stale marker drops them
    (2026-09-07: an upgrade landing after the Monday reset otherwise keeps
    last week's checks all week, then sync adopts them everywhere).
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
    verified live against a seeded v1. Rev-2 untagged value keys are inert
    garbage under rev 3: never adopted, never tombstoned.
 8b. **Merges never rebuild nameless characters.** removeCharacter/resetAll
    tombstone the persistent `char:<cid>:name` while the `v:` keys linger
    till GC; both merge paths drop buckets with no live name key (absence ⟺
    deleted — flatten always emits names and pushes are single-PATCH atomic).
    Without this the removed character resurrects on every pull (proven
    2026-09-07: E10 failed pre-fix with `["c1","c2"]`).
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
11. *(superseded by #5 — marker-gated tombstone suppression, removed with the
    reset-deletion machinery it existed to protect)*
12. **The base must track the tab's memory vintage, not the browser's
    freshest.** localStorage is shared across tabs but memory isn't: a shared
    base lets a suspended tab wake, diff stale memory against another tab's
    fresh base, and tombstone live keys it never saw. Bases are per-tab
    (sessionStorage, memory fallback); the shared copy is seed-only for tabs
    born later. Under rev 3 the remaining exposure (cycle keys) is silent by
    #5; persistent keys are still scrubbed for cap slices (#13).
13. **Cap-sliced characters must not tombstone.** The 6-cap merge drops
    overflow characters from memory while the saved base still holds their
    keys — the next diff then deletes a character nobody removed, permanently
    (same victim every merge, never returns). Pulls scrub sliced ids' keys
    from the base (`capOverflowKeys`, account scope excluded); the keys stay
    server-side and re-adopt if a slot frees. Same-harness proof both ways.
14. **Cycle-key GC bounds the wire.** Old buckets are inert but not free:
    HGETALL grows ~1.2KB/day/device. Pulls tombstone cycle keys older than
    60 days once (real deletes of values no device reads; racing GCs dedupe
    via tombstones-once + base advance). Unformatted/legacy keys never
    expire — bounded by the one-time pre-rev-3 dump.

## Trade-offs and residual risks

- Same-key concurrent edits resolve by arrival with no trace. By design
  tolerance; add per-key versions to GET only if a real complaint arrives.
- A stale device's own values can arrive tagged with the CURRENT bucket if
  its provenance was laundered at upgrade (fixed 2026-09-07: stale reset
  markers now drop provenance-less values instead of stamping them). With no
  witness (null markers on versionless imports) stamp-current remains, and a
  yesterday value on a never-since-opened device reads as today's until the
  first prune tick. Self-heals within one tick; never destructive.
- Mixed-version window: pre-rev-3 devices read/write untagged keys, so they
  neither see nor destroy rev-3 values (but cannot adopt them either).
  Update all devices promptly; old keys age out via GC... untagged keys are
  never GC'd (no parseable bucket) — bounded by the one-time pre-rev-3 dump.
- Tombstones grow on deletes that are never reused (deleted customs/chars).
  Bounded by user behavior; revisit if a record ever approaches the 200KB cap.
- Sessions expire after 180 idle days (sliding TTL): a device returning after
  the expiry sees a dead link (binding dropped with a notice) and must re-link
  from a live device. Idle sessions never linger server-side.
- 6-character cap: a merge yielding 7+ slices like load does. Two devices
  both creating at cap is the only trigger; accepted.
- Repoll-while-visible is the quota driver, not the merge model (below).
- Explicit `false`/`0` values accumulate per cycle (every uncheck leaves a
  present value instead of an absence). Bounded: the next cycle prune drops
  them with their bucket, 60-day GC bounds the server hash. All readers
  (`TaskRow`, progress, `hideCompleted`, `isPristine`, migration caps) are
  falsy-safe by audit; `isPristine` counts set values, not keys.
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

## Regression gate (`pnpm test:sync`, in `pnpm check`)

No unit tests — every suite drives real code (`scripts/sync-tests/`):

| ID | What | How |
|---|---|---|
| T1 | Stale tab with poisoned base sends NO cycle tombstones | vm-realm tabs, real `flat.ts` |
| T2 | Cap-sliced characters never tombstoned | same harness, 7-char union |
| E1 | Local reset (bucket rollover) pushes no tombstones; old keys stay server-side | real store + `syncAndResets` |
| E2 | Adoption filters by tag; provenance recorded; memory keys plain | same |
| E3 | Legacy untagged keys inert (not adopted, not tombstoned) | same |
| E4 | Uncheck pushes false / zero pushes 0; peer adopts, pair goes quiet | same |
| E5 | resetAll nukes persistent keys only (locked behavior) | same |
| E6 | GC tombstones only >60-day buckets, exactly once | same |
| E7 | Adopt/import stamp markers; values preserved | same |
| E8 | Production scenario: stale evening device can't wipe the 09:00 peer | same |
| E9 | clearSection zeroes in place, propagates, never resurrects | same |
| E10 | Removed character stays removed after pull (no ghosts) | same |
| E11 | Custom kind change re-stamps provenance, keeps the check | same |
| P | 300 randomized prune runs (stale removed, current kept, idempotent) | real store, seeded |
| A | 25-parallel-PATCH atomicity, upgrades, 4xx/405, no-store | live dev API |
| E1E | Real tap → server → second device renders checked | real Edge (CDP) |
| E2E | Wake-pull leaves server value intact | same |

Teeth: removing the cycle-key exemption from `diffFlat` fails E1/E4/E5 with
the exact production wipe payload (`v:c1:parttime@…: null` on reset). Live
suites SKIP loudly without `pnpm dev:api`/Edge; hermetic suites always run.
