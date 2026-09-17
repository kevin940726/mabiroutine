# Purple-hole phase 3 — timetable updates without commits

Status: planned, unstarted. Phase 1 corrects drift by moving
`PURPLE_ANCHOR_MS` in code + push (redeploys prod on merge).

## Goal

When an observed spawn disagrees with the prediction, fix the timetable
without touching code — for the user on the spot, not just the maintainer
at a keyboard.

## Non-goals

- Automatic detection (no game API; the app cannot observe spawns itself).
- Crowd consensus as a first step (needs backend + moderation + abuse
  handling — disproportionate until drift is proven frequent).
- Rewriting history (only the anchor moves forward; past legs stay as-is).

## Options

### A. Recalibrate button ("剛出沒過")

One tap stamps `now` as the anchor override:
`mabiroutine:purple-anchor-override` (`{anchorMs, setAtMs}`), consumed with
priority override → feed → hardcoded. Companion reset ("恢复官方預測")
deletes it. Popover footer shows a small `已手動校準` hint while active.

- Pro: ~half day, zero infra, works offline, fixes the exact moment the
  user is staring at the hole.
- Con: per-device (other devices keep the old anchor); no verification —
  a mis-tap skews everything until reset (mitigate: confirm dialog showing
  the resulting next spawn before committing).
- Sync: leave local-only (consistent with both reminder lanes + the phase-2
  D override). Revisit only on multi-device complaints.

### B. Published JSON feed (maintainer-verified anchor)

App fetches `{ anchorMs, updatedAt, note }` at load, caches in localStorage,
falls back to hardcoded on any failure. Maintainer updates the file after
verifying in-game. Surfaces `預測更新於 MM/DD` in the popover footer.

- Pro: one edit fixes every user, no app release; failure degrades to
  phase-1 baseline.
- Con: the maintainer still does per-drift work, just not a code push;
  offline-first loads use the cache, which can go stale silently (mitigate
  with the updated-at label + age warning past N days).
- Hosting: **no gist needed** (decided 2026-09-18) — the anchor rides the
  same worker/KV feed as phase 2 (`/purple-schedule` serves ONE doc,
  `{anchorMs, windows[], updatedAt, confidence, sources[]}`), edited via KV
  dashboard or the `/admin` page. The admin edit path already exists for
  windows; anchor is one more field on the same form.

### C. Crowd reports (user-submitted observations)

Precedent found 2026-09-17: Bahamut players already publish purple-hole
times in thread titles (e.g. 通報下場紫洞時間9/16（三) 下午14:08 on the
board list, which is statically fetchable — see phase-2 doc door #1). A
phase-3 feed could start as *parsing existing community reports* rather than
building submission infra — verification caveat (thread titles are claims,
not measurements) applies, but the crowd already exists.

Users submit observed spawn times; a backend reconciles (median of recent
reports) and publishes the anchor. Natural home: the phase-2 worker + KV
(`POST /purple-reports`, near-zero writes against the 1k/day cap; cron
reconciles into candidates) — no Turso table, no Vercel route needed.

- Pro: most robust long-term; no single maintainer bottleneck.
- Con: by far the most work (API, storage, rate-limiting, abuse/garbage
  handling, consensus UI); first server-side *user-generated* data beyond
  sync payloads — privacy disclosure + opt-in consent needed (today's
  posture is "progress lives in your browser" plus narrow exceptions);
  cold-start problem (needs a crowd before it's trustworthy).
- Verdict: only on evidence — frequent drift AND an active reporter base.
  Not this year on current information.

## Decision (recommended)

Phase 3 = **A first, B if the burden justifies, C on evidence**. A puts the
fix in the hands of the person seeing the hole, today, with no infra. B
centralizes only when the maintainer is recalibrating often enough that a
file edit beats telling users to tap recalibrate. A and B compose (override
wins), so building A never blocks B.

## Technical touch points (A)

- `src/lib/purpleHole.ts`: `readAnchorOverride()` (validates shape, ignores
  garbage), anchor resolution `override ?? hardcoded`; all public entry
  points already funnel through `PURPLE_ANCHOR_MS` reads — centralize to one
  `currentAnchor()` so the override can't be missed by a new caller.
- UI: timetable popover gains its first interactive rows (回報出沒 with
  confirm showing the recomputed next spawn; 重設 when an override exists;
  `已手動校準` footer hint). Popover is read-only today — note the change.
- Anchor re-bases all legs: maintenance windows before the new anchor go
  inert automatically (overlap only counts forward legs) — document, don't
  code.
- Tests: override set → popover/badges/fire time all shift; reset restores;
  corrupt override value ignored; reload persists (localStorage).

## Effort

A ~half day. B ~1 day (hosting + cache + freshness UI). C ~1 week+ and a
privacy review — do not start without the evidence bar above.
