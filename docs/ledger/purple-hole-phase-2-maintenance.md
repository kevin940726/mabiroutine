# Purple-hole phase 2 — maintenance-aware predictions

Status: planned, unstarted. Phase 1 ships with `MAINTENANCE_WINDOWS = []`.

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

### B. Runtime JSON feed (maintainer-published)

App fetches a small `{ windows: [{start, end}], updatedAt }` file at load
(gist, static host, or same-site file updated out-of-band), caches it in
localStorage, falls back to the hardcoded list on any failure. Feed format
is the only contract; the writer can be a human or option C.

- Pro: no app commit per maintenance; failure degrades to phase-1 behavior.
- Con: needs a hosting decision + cache/freshness semantics + a "預測更新
  於 …" honesty label; the feed itself still needs a writer.

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

## Decision (recommended)

Phase 2 = **A + D**. A covers routine maintenance with the cheapest possible
mechanism; D covers emergencies with the only mechanism fast enough. B and C
stay parked until routine maintenance becomes a felt burden (it is weekly at
most — measure before automating). If C's API hunt succeeds later, it feeds
B, and A downgrades to fallback-only.

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

A ~1 hour. D ~half day (UI + storage + expiry). C API hunt ~half day,
boxed — abandon to A if the endpoint isn't cleanly readable.
