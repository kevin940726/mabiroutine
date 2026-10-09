# Sync architecture — conflict-free per-key LWW

Single user, many devices. Goal: edits on any device converge everywhere with
no dialogs, no versions, no clocks. Tolerance (explicit): end state wins over
intent audit — a converged value both devices display beats a history of who
tapped what.

## Protocol

One `sessions` probe row per session plus one `kv` row per flat key
(`api/_db/`, see `docs/sql-migration.md`): the `meta` column holds
`{ v: 2, updatedAt, writerId, seq }`, every other row is one flat sync key with
a tagged-JSON value (`j:` + JSON — the tag keeps values plain strings through
client serialization; `~`-prefixed keys are rejected with 400 so no client can
forge meta). The server is schema-agnostic: it versions JSON paths, never
tracker semantics. A PATCH is a **single atomic transaction** covering the kv
rows and the probe row, so concurrent PATCHes from two devices are per-field
last-writer-wins and can never interleave a read-modify-write and drop each
other's keys (the pre-row single-blob layout did exactly that — see 10).
Cycle-key `null`s are physical deletes; every other `null` is a retained
tombstone. Pre-SQL records (v1 blobs, v2 blobs) are still served and upgrade on
first PATCH.

| Method | Body | Effect |
|---|---|---|
| POST | `{ state: flat map }` | Mint id, all keys at seq 1..n |
| GET | `?id=` | `{ state: flat map (nulls incl.), updatedAt }`, or `{ legacy, updatedAt }` for v1 blobs |
| PATCH | `{ id, changes: {k: v} }` | One transaction of meta + fields (atomic per-field LWW). Never 409s |
| DELETE | `{ id }` | Drop the session + its kv rows (idempotent) |

Rate limits: create 10/hr/IP, everything else 60/min/IP (prod, keyed on the
verified client IP — `x-real-ip`, else the last forwarded entry). The limiter is
per-instance in memory (`docs/sql-migration.md`), not shared; non-prod setups
get 500/hr + 600/min via the `SYNC_KEY_PREFIX` dev signal so the regression gate
never trips prod budgets. Payload cap 200KB per request;
keys must use a known prefix (`v:|acc:|hide:|pin:|custom:|char:|meta:|pref:|filter:`,
128 chars max), string values 500 chars max, objects 8KB max, arrays rejected,
`__proto__`/`constructor`/`prototype` rejected, 2000 keys per request and 5000
fields per session (400/413 past that). Sessions expire after 180 days without
a read/write (sliding TTL, refreshed by the daily touch beacon and on POST;
expired reads act as 404) — a leaked link dies on its
own.
Storage is separated by Vercel environment, not by key prefix: Preview and
Production point at Turso (`TURSO_DATABASE_URL`), local `vercel dev` uses a
throwaway `file:` database even when the Turso URL is present
(`docs/sql-migration.md` Environments). `SYNC_KEY_PREFIX` no longer prefixes
keys; non-prod values only signal the roomy test rate budget. Env changes bake
in at deploy time: a new deployment is needed to pick them up.
Code: `api/session.ts` + `api/_db/`.

## Key space (`src/sync/flat.ts`, rev 3)

```
v:{cid}:{tid}@{bucket}   task values, tagged with the cycle they belong to
acc:{tid}@{bucket}       account values (same tagging)
hide:{cid}:{tid} | hide:acc:{tid}   hidden flags (true)
pin:{bid}        pin membership (true; unpin = null)
custom:{id}      custom task object, order stripped | null
char:{cid}:name  character name
meta:active      active character id
meta:charorder   character tab order, comma-joined cids (string — the API
                 rejects array values; last writer wins, then sticks, see decision 4b)
pref:hideCompleted | filter:{priority|town|skill|onlyPinned}
```

`{bucket}` is the Taipei day key (`YYYY-MM-DD`) for daily-kind values
(daily, account-daily, barter rows) and the week key (`YYYY-Wmmdd`) for
weekly kinds. Provenance lives in the store (`taskBuckets: tid -> bucket`,
v13) and rides the wire on every value key.

Device-local fields never ride the wire. `barterCustomOrder` / `globalTaskOrder`
(order) are carried through the merge from the local device; `hourlyReminders`
and `purpleHoleReminders` are absent from the merge output entirely, so every
apply path (`applySnapshot` on a pull/adopt, `importJson` on a backup) restores
them from the current device when the incoming payload does not set them
(`DEVICE_LOCAL_STATE_KEYS`). Without that, `normalizePersisted` backfills the
absent key to its default and a routine pull silently clears the reminder bells
— only the peer device still fires (2026-10-07; guarded by `test:sync` engine
E15, which also fails on any new `AppState` field left unclassified).

## Client engine (`src/sync/SyncButton.tsx`, `src/sync/session.ts`, `src/sync/round.ts`)

- **Auto-push** (debounced 3s, flushed on tab-hide): diff current flat vs
  retained **per-tab** base (sessionStorage `flattab`, seeded once from the
  shared localStorage `flatbase`) → PATCH changed keys. It reads no remote: a
  live-tab edit is uncontested in practice, and every scheduled round applies
  the base-arbitrated filter below. Two silences: base-keys already null stay
  silent (tombstones send exactly once), and **cycle keys never tombstone**
  (they expire by bucket — a stale device physically cannot delete anything).
  Resolves the pushed key-set ({} when clean) or null when nothing was sent —
  callers must not treat remote state as newer than unsent local edits. It is
  serialized against rounds (a push joins an in-flight round, a round awaits
  an in-flight push), so a wake's stale diff can never escape unfiltered
  between a round's GET and its merge. (→ S2)
- **Round** (mount, tab-visible, window-focus, 5min foreground repoll — the
  single periodic timer, owned here; App owns wake ordering only — two timers
  would double every poll; 10s throttle — hook-driven pulls via `syncAndResets`
  bypass the throttle so reset-after-pull ordering holds on boot; a throttled
  no-op pull would let `checkResets` prune before the adopt lands and trip
  the mid-flight guard; mount GET preloaded by an `index.html` inline fetch
  so the round trip overlaps JS bootstrap — consume-once, id-matched, 60s
  TTL, live-GET fallback; concurrent rounds join one in-flight run):
  diff current flat vs the base, then a freshness probe (`GET ?meta=1`,
  timestamp-only) **only when the diff is clean** — the probe reads the
  base's own `ts` (the server `updatedAt` the base was read at), not the
  binding's push ack, so a lost adoption cannot make the probe skip forever;
  unchanged clean polls skip the full GET entirely (6-char-cap rounds always
  full-GET so cap-slice scrubbing never lags a push), then GET, then
  `planRound` (decision 16): a local diff is pushed only while the remote
  still carries the base's value for that key, and a key both sides changed
  adopts the remote. The accepted push overlays the GET result (a lagged/
  cached read must never resurrect a pre-push absence — this also covers the
  preloaded pre-flush read); a mid-flight edit lands the pre-edit diff through
  the same plan and skips the apply (the edit stays local for the next round,
  so it cannot fall through to the blind auto-push), apply wholesale via
  `unflattenMerge` (current-bucket values only, remote tab order authoritative when present —
  decision 4b — local ordering only as the no-information fallback), GC expired cycle keys
  (tombstone once past the 8-day retention), save base + `ts` through the same
  storage flush as the store state (decision 17). TTL renewal rides a
  daily beacon (`?touch=1` / `{touch: 1}`, at most once/day per session) —
  routine polls skip the touch. The 5min repoll pauses after 15min without
  input (pointer/key/wheel/touch, focus, visibility all count as attention);
  the idle→active crossing runs the full pull-then-reset round so a return
  across 06:00/Monday prunes after adopting. Offline (boot included):
  `offline()` throws before any fetch, the round fails silent and local state
  stands — resume on next foreground / activity. (→ S1, S3, S5)
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
   silently and deterministically: a key contested at round time goes to the
   remote (decision 16), a live-tab auto-push lands by arrival.
2. **Toggles must be absolute.** The UI knows current state, so it sends
   `= true/false`, never "flip". RMW shape eliminated at the source.
3. **Deletes are booleans, never removals.** Unpin/unhide/remove-character
   write `false`/`null`; tombstones (`null`) are retained server-side.
   No GC needed: reset-cleared keys are revived by reuse, and
   never-reused keys (deleted customs/chars) are bytes at this scale.
   Stale replicas cannot resurrect — the tombstone's newer seq wins.
4. **Ordering is per-device local, never synced — except character tabs.**
   Drag order, pin order. Cross-device order merge is index soup even with
   ranks; local order is also arguably better UX (different screens,
   different ideal orders). Cost: reordering on desktop doesn't move phone
   rows. Accepted.
   4b. **Character tabs sync via `meta:charorder` (2026-09-23, supersedes #4
   for tabs only).** The id-sorted fresh-adopt fallback split linked devices
   permanently — creator kept creation order, adopter got id-sorted, with no
   reorder UI to realign (reported: first two characters swapped
   phone-vs-desktop). Last writer wins, then sticks: the remote order is
   authoritative whenever present — every device adopts it instead of
   contesting, so divergent devices converge in one round and go quiet after
   (no ping-pong — post-adopt both sides flatten the same array). Two guards
   bias the race toward the human-made order: pushes withhold the key until
   the first pull for the binding completes (nobody volunteers canon blind),
   and id-sorted orders are never volunteered (an id-sorted layout is
   overwhelmingly likely generated, not chosen — generated layouts can't
   overwrite chosen ones, and coincidentally-sorted creation orders need no
   reconciliation since all parties already agree). The push strips the key
   whenever flatten omits it, so an established device going sorted (e.g. a
   removal leaving a sorted remainder) never tombstones shared canon via
   the null path, either. Sequential upgrades
   converge on the first volunteer; a volunteer-vs-volunteer race resolves
   through decision 16's base rule (the first push is the remote the second
   device contests, so the second adopts it), then sticks. Strict parse
   (any empty/dupe segment rejects the key): absence always means "no
   information" and falls back to local order / id-sorted adopt, which is
   also the stale-client shield — pre-upgrade peers tombstone unknown keys
   on push, so mixed-version households degrade to the old behavior until
   all devices refresh, then converge. Local add/remove still propagates
   (unknown ids append id-sorted, dead ids filter against the live set).
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
 6. **Timestamp trust is the load-bearing remainder — arrival order breaks
    ties, the base breaks contests (superseded in part by #16).** Phone clocks
    skew, so wall time is out; HLCs would bloat user state. A single server's
    receive order is total and matches real order for alternating-device use.
    It stops matching when a device pushes late (unsynced leftovers replaying
    on a later wake), which is what #16's base arbitration exists to catch.
    No versions, no clocks, no 409s.
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
10. **PATCH must be single-transaction atomic — the blob RMW lost updates.**
    The v2 blob PATCHed via get → merge → set; two devices pushing inside the
    same window (each PATCH is several sequential REST round trips) resolved
    to last-*record*-wins, silently dropping the loser's keys. Clients then
    adopted the loss on next pull and tombstoned it everywhere — a permanent,
    ping-ponging wipe that looked like "focus makes the other device truth".
    The row-per-key layout fixes the class: concurrent PATCHes only ever race on
    the *same field*, which is true per-key LWW. Client shields stay as defense in
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
    every pull carries them. Pulls tombstone cycle keys older than **8 days**
    (one weekly cycle plus a day of grace) once. On the SQL backend
    (`docs/sql-migration.md`) those tombstones are physical DELETE rows, so
    dead buckets stop accumulating: a session holds roughly live keys plus 8
    days of history, not an unbounded log. Unformatted/legacy keys never
    expire — bounded by the one-time pre-rev-3 dump.
15. **Upgrades never volunteer pins blind — seeding is pull-aware.**
    The v14→v15 step seeded new default pins eagerly; a stale save cannot tell
    "never saw this row" from "a peer unpinned it", so a pre-refresh device
    upgrading on open reseeded the row and its next push flipped the peer's
    tombstone back to `true` (proven 2026-10-06: desktop unpins
    seumas-finest-bandage, the outdated mobile upgrades, the desktop row comes
    back). Migration never seeds now; `seedMissingDefaultPins` adds a missing
    default only for keys the server never saw (absent, not tombstoned — a
    tombstone is a deliberate unpin and is respected), running after a
    successful pull merge (a just-flushed local unpin is already server-side by
    then, so it reads as a tombstone, never an invitation). Genuinely new rows
    still propagate: the first puller seeds and pushes, peers adopt.
    Session creation carries known tombstones into the fresh POST
    (`creationState` in `flat.ts`): regenerates via the live base, first
    links via the stashed last-session id — so a new session never reads a
    linked-era unpin as "never decided". Unlinked upgraders pin new rows by
    hand once — there is no wire to consult, and boot seeding would re-add
    deliberate local unpins every load.
16. **Contested keys go to the remote; the base is the arbiter (2026-10-09 —
    supersedes the arrival-wins half of #6).** A round builds the local diff
    against the base, then `planRound` (`src/sync/round.ts`) keeps a change
    only while the remote still carries the base's value for that key; a key
    both sides changed since this device last synced adopts the remote. The
    reported wipe: a day-old iOS PWA (its weekly counter and pin edits never
    reached the server) opened after the desktop had cleared/unpinned, pushed
    its leftovers, and arrival order replayed them over the desktop. Arrival
    cannot distinguish "I just tapped this" from "this sat unsynced"; the base
    can (the server saw the base's value or it did not), and the remote bias
    is the one that can never replay an outdated device's state over a peer's
    newer progress. It also generalizes E14: an empty/fresh base no longer
    full-pushes values over rows the server already decided (a peer's unpin
    survives every first-link path). Cost: a genuinely later local edit
    reverts when the same key changed on a peer since this device's last
    sync — without clocks the two cases are indistinguishable, and the
    deterministic remote-wins tie keeps both sides converged with no
    ping-pong. `dropped` names the contested keys for tests and debugging;
    the user-visible rule stays silent.
17. **The persisted base ships in the same flush as the state it describes
    (2026-10-09).** `writeBase` queues the shared `flatbase` doc through
    `src/lib/storage.ts` and flushes with the store write, state first, base
    second (one pass, insertion-ordered); a failed state write aborts the
    flush, so the base can never land alone. The per-tab copy is written last,
    after the shared flush, so a crash between the two leaves it older than
    the persisted state (the contest filter absorbs a re-push) rather than
    fresher. A crash can leave the shared base older than memory (the next
    round re-pushes; safe) but never fresher: a base fresher than the
    persisted state made the next boot read a day-old local state as "changed
    since the base" and replay it over the peer. The base also carries the
    server `updatedAt` it was read at (`ts`), which the freshness probe uses
    instead of the binding's ack — a lost adoption can no longer make the
    probe skip forever. Pre-ts docs load as `ts: 0` (one extra GET, always
    safe).

## Trade-offs and residual risks

- Same-key concurrent edits resolve silently and deterministically: a round's
  contested keys go to the remote (decision 16), a live-tab auto-push lands by
  arrival. The residual cost is the mirror case: a genuinely later local edit
  reverts when the same key changed on a peer since this device's last sync
  (no clocks, so the two cases cannot be told apart). Deterministic and
  convergent; add edit timestamps to the wire only if that trade ever bites.
- A stale device's own values can arrive tagged with the CURRENT bucket if
  its provenance was laundered at upgrade (fixed 2026-09-07: stale reset
  markers now drop provenance-less values instead of stamping them). With no
  witness (null versions on versionless imports) stamp-current remains, but
  decision 16 keeps it harmless: a laundered value is contested whenever the
  remote changed the key, so it can no longer overwrite newer progress.
- Mixed-version window: pre-rev-3 devices read/write untagged keys, so they
  neither see nor destroy rev-3 values (but cannot adopt them either).
  Pre-decision-16 devices push blind: an outdated build can still replay its
  leftovers until it refreshes (the protection is client-side, per device).
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
  them with their bucket, the 8-day GC bounds the store. All readers
  (`TaskRow`, progress, `hideCompleted`, `isPristine`, migration caps) are
  falsy-safe by audit; `isPristine` counts set values, not keys.
- `handle_links: preferred` routes tapped links into the installed app
  (Chrome 122+); iOS web apps and mismatched Android browsers still need the
  paste field — buckets are per-browser-partition and no manifest bridges them.
- Unpins made while a device was never linked leave no record anywhere, so
  the first link reads them as absent once and the seeder adds them back;
  re-unpinning sticks, because the null is retained from then on. Same
  one-time exposure for sessions created before the tombstone carry.

## Quota budget (Turso free: 500M rows read / 10M rows written / mo)

Metered on rows, not commands: 500M rows read/mo, 10M rows written/mo, 5GB
storage — blocked (no overage) on exceed. Rows written is the binding metric,
protected deliberately (in-memory rate limiter, no SQL counter, cap check via
`sessions.field_count` instead of a row scan). Per pull: 1 probe-row read, plus
a full GET of ~230 rows only when changed; per push: the changed keys only, 0
when clean (diff short-circuits). A push burst costs one full GET at the next
poll, because the base's `ts` only advances with a GET (decision 17) — then
the probe skips again. Single 5min timer — no second interval
anywhere (a duplicate would double every poll). Headroom
(`docs/sql-migration.md` Quota estimate): 1000 heavy 2-device users reach ~48%
of reads (~2x headroom, not an order of magnitude); writes are the ceiling —
free holds ~1000 users at light-to-moderate activity, very heavy multi-device
writers press the 10M cap first.

Local dev (`file:` database) costs nothing. Preview shares the production Turso
DB (solo-maintainer decision), so run live suites pre-release or on
sync-touching branches only; hermetic suites are the everyday gate. Per-device
telemetry (`localStorage mabiroutine:syncstats`, `__mabiSyncStats()` in DevTools,
Q1–Q5 gate) validates the model against the Turso dashboard.

> Historical (Redis era: Upstash free 500K cmds/mo). Per request ≈ rate-limit
> INCR + work (HGETALL/HSET) + TTL EXPIRE only on the daily touch beacon.
> Pushes cost 0 when clean; pulls cost 2 cmds when unchanged (`INCR` + `HGET
> ~meta` probe) and a full round only on change.
>
> | Profile | Cost | Headroom |
> |---|---|---|
> | Normal (~30 pulls + ~30 pushes/day) | ~5K/mo | ~100 such users |
> | Always-open idle tab (5min meta polls) | ~17K/mo | ~29 such users |

## Verified (rig, two isolated profiles, real clicks)

Disjoint edits converge · same-counter race converges, no dialog · unpin
tombstone propagates, no resurrection · legacy blob adopts (values + toast)
and upgrades to flat · cancel strips `?s=` · offline shell renders ·
rebuild-under-open-page auto-updates with toast · zero page errors throughout.
Server (SQL): `j:`-tag round-trips as plain strings · 25 concurrent disjoint
PATCHes all survive · cycle-key nulls delete while persistent tombstones
persist · legacy v1/v2 upgrade — `scripts/sync-tests/sql-smoke.mjs` (local file,
and live Turso via `--remote`).

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
| E6 | GC tombstones only >8-day buckets, exactly once | same |
| E7 | Adopt/import stamp markers; values preserved | same |
| E8 | Production scenario: stale evening device can't wipe the 09:00 peer | same |
| E9 | clearSection zeroes in place, propagates, never resurrects | same |
| E10 | Removed character stays removed after pull (no ghosts) | same |
| E11 | Custom kind change re-stamps provenance, keeps the check | same |
| E12 | Tab order syncs LWW-then-sticks; sorted orders never volunteered nor tombstoned; a contest adopts the remote order | same |
| E13 | Merge keeps local pinnedCollapsed, still takes synced hideCompleted | same |
| E14 | Upgrade straggler can't resurrect a peer unpin; absent keys seed pull-aware; regenerate carries tombstones | same |
| E15 | Device-local lanes (reminder bells) survive pull/import; every store field classified synced or local | same |
| E16 | A claimed reminder lane re-arms only when its claim survived and the row is eligible | same |
| E17 | A day-old device's unsynced weekly + pin edits lose to the peer's later clear/unpin; quiet after adopt | same, contested-key plan |
| E18 | A genuinely fresh local edit still pushes and lands (remote unchanged for that key) | same |
| E19 | Empty base (fresh link) respects a peer tombstone while pushing local-only keys | same |
| E20 | Provenance-less stale value cannot overwrite a remote that changed the key | same |
| F1 | State-before-base ordering in one storage flush; read-through; remove | real `storage.ts`, logging localStorage |
| P | 300 randomized prune runs (stale removed, current kept, idempotent) | real store, seeded |
| A | 25-parallel-PATCH atomicity, upgrades, 4xx/405, no-store | live dev API |
| E1E | Real tap → server → second device renders checked | real Edge (CDP) |
| E2E | Wake-pull leaves server value intact | same |

Teeth: removing the cycle-key exemption from `diffFlat` fails E1/E4/E5 with
the exact production wipe payload (`v:c1:parttime@…: null` on reset). Removing
the `planRound` contest filter fails E17/E19/E20 with the stale replay
payload; reordering the flush to base-first fails F1; a push that bypasses
the push/round serialization can still be caught by E17's contested-set
assertions in the round port. Live suites SKIP loudly without `pnpm dev:api`/
Edge; hermetic suites always run.
