# Purple-hole phase 2 — maintenance-aware predictions

Status: A built 2026-09-17 (helper + first dated entry); D dropped same day
(correction below); watcher + feed unstarted. Phase 1 shipped with
`MAINTENANCE_WINDOWS = []`.

## Goal

When the game goes down for maintenance, the spawn timer pauses — so the
next prediction must shift by the overlapped downtime automatically
(verified example: 06:00–08:00 maintenance moves 02:23 → 04:23). The stretch
math (`nextAfter`/`prevBefore` in `src/lib/purpleHole.ts`) already does this;
phase 2 is only about **feeding the window list**.

## Non-goals

- Real-time detection (no game API exists; the app learns about maintenance
  the same way players do — by reading announcements).
- Historical archive (windows older than the current spawn are mathematically
  inert; prune by convention, don't build storage for them).
- Server push (orthogonal; phase 1's local timer consumes the same list).

## Verified alternate doors (2026-09-17, probed live)

The official API wall stands — but it turns out we never needed that door:

1. **Bahamut search is statically fetchable — and it's the poll endpoint.**
   `forum.gamer.com.tw/search.php?bsn=32564&q=維護公告&field=title&firstFloorOnly=1&advancedSearch=1&subbsn=5&sortType=mtime`
   (user-supplied, verified live 2026-09-17) returns the 8 maintenance posts
   pre-filtered and time-sorted to a bare server-side GET — no cookies, no
   JS, no stealth — with **full first-post bodies inline**, including the
   exact ranges (9/16 例行 6:00–8:30, 9/10 臨時 6:00–8:00, 9/9 例行
   6:00–11:30, 8/26 & 8/19 & 8/12 例行 6:00–9:00, 7/29 例行 6:00–8:30).
   Bodies follow a fixed format (`◼ 維護時間 - 2026年9月16日(三) 上午6時 ～
   上午8時30分`) that a regex can extract reliably. One fetch, no N+1.
   The plain board list (`B.php?bsn=32564`) works too as a backup. Posture:
   public fan forum, facts only — consistent with the repo's existing
   source rules.
2. **GNN news pages are fully readable.** `gnn.gamer.com.tw/detail.php?sn=…`
   returns complete article text server-side (verified). GNN covers TW
   maintenance as news — second source, same dumb-fetch profile.
3. **Routine maintenance is weekly Wednesday mornings** (8/5, 8/12, 8/19,
   8/26 all 例行維護 on Wednesdays; PC-side precedent 07:00–12:00). A
   hardcoded Wednesday rule covers ~90% of cases with zero fetching — the
   poller only needs to catch deviations and emergencies.
4. **Bonus (phase 3 relevant):** players already crowdsource purple-hole
   times in thread titles — e.g. `【攻略】通往深淵的黑色坑洞的機制說明和攻略
   (通報，下場紫洞時間9/16（三) 下午14:08)`. A future timetable feed could
   parse these (with verification caveats) instead of building reporting
   infra from zero.
5. **Official Discord exists** (announcement channel seen referenced in board
   threads) — not directly fetchable (login-walled), but its announcements
   get reposted to Bahamut within the community, so door #1 covers it
   indirectly.

## Established facts (2026-09-17)

- Official TW board: `https://tw.nexon.com/mabinogimobile/home/news/notice`,
  category 維護. Routine posts (例行維護公告) land ~1 day before with a time
  range in-body (e.g. `07:00 ~ 12:00`); extensions and emergency posts
  (臨時維護公告) update same-day.
- The board is **fully JS-rendered**: a static fetch returns the chrome with
  an empty list (`目前尚無相關內容`). Any automation must first find the
  backing API via browser devtools (Network tab, filter XHR while switching
  to the 維護 tab) — that hunt is step 0 and may fail (auth-walled or
  obfuscated endpoints both kill it).
- Fact-level reuse (start/end times) is low-risk like other tracker facts,
  but this is NEXON's official site, not a fan wiki — read its backing API
  the way a browser does (same endpoints, low frequency), never hammer it,
  and keep any fetching code private-local per the repo's data rules.

## Options

### A. Hand-entered windows in code

Extend `MAINTENANCE_WINDOWS` with dated entries around each maintenance, add
a `taipeiWall(y, m, d, hh, mm)` helper (hardcoded UTC ms is error-prone),
remove spent entries in the same commit. Matches the hand-owned TW-data
discipline exactly.

- Pro: ~1 hour, zero infra, zero failure modes at runtime, reviewable.
- Con: commit + push + redeploy per maintenance; useless for same-day
  emergency maintenance unless someone edits within the hour.

### B. KV-backed feed with built-in editing (no gist needed — decided 2026-09-18)

App fetches `{ windows: [{start, end}], updatedAt }` from the worker's
`/purple-schedule` (KV-cached, CORS `*`), caches it in localStorage, falls
back to the hardcoded list on any failure. The writer is the worker's
watcher (candidates) or the maintainer — and the maintainer needs no
separate CMS, because Cloudflare already ships two:

- *Day one:* the **KV dashboard itself** — namespace → key → edit raw JSON.
  Zero code, phone-accessible, ~1 write/day against the 1k budget.
- *Graduation:* a **one-page `/admin` route on the same worker** (bearer
  `ADMIN_SECRET`, timing-safe compare, `noindex`): datetime-local inputs,
  current-values preview, and a **promote-candidate button** that copies the
  watcher's parsed candidates into verified values in one tap. ~1 hour
  extra; the human-confirm loop becomes "open page, glance, tap". Full
  build spec: `docs/ledger/purple-hole-admin-page.md`.

- Pro: no app commit per maintenance; no third-party host; failure degrades
  to phase-1 behavior; threat model is a nuisance at worst (leaked secret
  shifts hole predictions — strong random secret suffices, no user system).
- Con: one more secret to hold (`ADMIN_SECRET`); dashboard JSON has no
  validation (the `/admin` form fixes that when it lands).

### C. Scraper (private-local, gitignored)

Script that reads the board (or its backing API once found) and emits the
feed for B — or a patch for A. Maintainer-run, never committed, never
published, same as the existing tracker/barter fetchers.

- Pro: removes the human from the loop for routine maintenance.
- Con: blocked on the API hunt; parsing bodies (`07:00 ~ 12:00`, 延長公告,
  提早開機) is fragile Han-text parsing that needs eyeball verification
  anyway; emergency posts still arrive too late to matter.

### D. In-app user-entered window ("maintenance until HH:mm")

A small local override: user reads the announcement, enters one end time,
engine treats `[now, end]` (or a typed range) as a window for the current
leg. Stored in localStorage, device-local, cleared once passed.

- Pro: covers exactly the case A/B/C all miss (same-day emergency, spotted
  in-game); no infra, works offline.
- Con: manual per device; user must remember to enter it; wrong entries
  skew predictions until cleared (mitigate: one-tap clear + auto-expiry).

## Gotcha: extensions don't propagate (found 2026-09-17)

Bahamut reposts are **snapshots**: when maintenance overruns, only the
official post is edited — the Bahamut copy stays stale. Concrete case: 9/16
was announced 06:00–08:30 but actually ended 09:00; the repost still reads
08:30. A poll of this endpoint therefore yields *scheduled* windows, and any
leg overlapping one predicts **earliest-possible**, up to the extension
error (here 30 min early).

Mitigations, in order of reliability:

1. **Reply bumps as extension signal.** The poll sorts by `mtime` (latest
   activity), so a maintenance thread bumped by "延長到9:00" replies
   resurfaces on re-poll — the human confirmer checks the newest replies,
   not just the first post. Cheap, uses the existing endpoint.
2. **Earliest-possible semantics.** Any prediction whose leg overlaps a
   window is a lower bound; if this ever surfaces in UI copy, say so
   (or更晚-style), never a false-precise time.
3. **In-app entry (D) and recalibrate (phase 3A)** as the backstops: the
   person watching the extension happen corrects it on the spot.
4. The official detail page remains the only source of actuals — still
   behind the session wall (see Established facts). No change there.

## Correction 2026-09-17: D dropped

No in-app override — the maintainer's announcement read is the canonical
source, and same-day emergencies go through a code edit + push like every
other TW-data fix. Phase 2 = Wednesday rule (A) + worker watcher, nothing
on-device. The D UI/storage spec below (§Technical touch points D parts,
option D) is retained as rejected context, not a build plan.

## Decision (recommended, revised with worker + verified doors)

Phase 2 = **Wednesday rule + worker watcher (KV candidates, human-promoted)
+ D**, built on the push release's worker (shared scaffold, secrets, and
cron — see the combined architecture below). Concretely: hardcode the
Wednesday-morning window as the default; a 2×/day worker cron fetches the
Bahamut search endpoint, regexes windows into KV candidates; the maintainer
promotes them via KV dashboard (day one) or the `/admin` promote button
(graduation) — minutes per week. D still covers same-day emergencies the
poll can't reach in time. The official-API scraper (C) is dropped, not
parked. Full automation (unattended poll → truth with no human) stays out —
and the failure design keeps "fetch failed" distinguishable from "no
maintenance" via `updatedAt` age.

## Combined worker architecture (shared with the push release)

One worker, three jobs — the barrier push plan already pays the fixed costs
(scaffold, wrangler deploys, `CRON_SECRET`, Turso subs, VAPID), so purple's
marginal additions are small:

## Cadence decision (locked 2026-09-17)

15-min tick + 15-min lead, kept as-is. The hole despawns 13 min after
spawn — that bounds *lateness* (alert must land before S+13), not the lead
target, which stays prep-time + delivery margin. Lead lands in (L, L+I],
so a tighter lead without a tighter tick is fiction (5/15 delivers 5–20
min early while promising 5); and early is cheap while late is fatal
(Doze/battery-saver eats minutes — L=15 tolerates 28 min of slip).
Revisit only on evidence: bored waits → 10/5 (tick shrinks too);
missed holes → loosen, never tighten.

```
CF Worker (extends barrier's push-cron worker)
├── every 15 min: spawn check ──▶ spawn within 15 min? ──▶ purple fanout
│   (imports src/lib/purpleHole.ts directly — DOM-free pure math, window
│   refs already guarded — one implementation, two runtimes)
├── 2×/day: Bahamut watch ──▶ search.php fetch ──▶ regex windows + 紫洞
│   report titles ──▶ KV candidates (maintainer promotes, never auto-truth)
└── GET /purple-schedule ──▶ resolved {anchorMs, windows[], updatedAt,
    confidence, sources[]} with CORS *, KV-cached (≥60s TTL)
```

Client fallback chain: manual override > worker/KV > hardcoded.
New secret vs the push plan: only `ADMIN_SECRET` (and it degrades to
dashboard-only without the `/admin` page). Limits (free tier, 2026 docs):
96 ticks + 2 watcher runs/day ≈ 0.1% of 100k req; KV ~4 writes/day vs 1k;
watcher parse must fit **10ms CPU per cron run** (network wait excluded —
keep it to string ops, split fetch/parse across crons if it doesn't fit);
unverified whether Bahamut rate-limits CF egress (tiny volume says no —
fallback chain covers a failure).

## Technical touch points (A + D)

- `src/lib/purpleHole.ts`: `taipeiWall()` helper; `MAINTENANCE_WINDOWS` gains
  dated entries; engine already consumes them (no scheduler changes — fire
  times derive from `nextOccurrence`, so windows shift bells automatically).
- D storage: `mabiroutine:purple-maint-override` (`{startMs, endMs} | null`),
  read alongside `MAINTENANCE_WINDOWS` in the three public entry points
  (`occurrencesAround`, `bucketOccurrence`, `nextOccurrence` callers pass
  `[...MAINTENANCE_WINDOWS, ...overrides]`). Local-only, never synced
  (consistent with both reminder lanes).
- D UI: one row in the timetable popover (currently read-only — note the
  change) or a long-press on the 已過/下次 line; keep it to set + clear.
- Convention: prune spent windows when adding new ones (same commit for A).

## Tests

- Synthetic-window probes (the 02:23 → 04:23 pattern) via `node -e` against
  the real module math, documented in the commit message; no harness exists
  for lib code, and none is proposed for this.
- Manual matrix: routine window shifts popover + badges + fire time; D entry
  shifts the same; expiry restores; offline + failed-feed behavior unchanged
  (phase-1 baseline).

## Effort

A ~1 hour. D ~half day (UI + storage + expiry). Watcher + KV + endpoint
~2–3 days with the push infra (spike first: 10ms CPU fit + Bahamut-from-CF
egress — one afternoon answers both). `/admin` page ~1 hour on top.
