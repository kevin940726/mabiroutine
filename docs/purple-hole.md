# 深淵的黑色坑洞 — feature ledger

Branch: `feat/purple-hole` merged to main; phase 2 shipped 2026-09-18.
Flag: the 實驗性功能 dialog persists `mabiroutine:purple-hole-flag`. Prod default: zero surface.

## Schedule (feed-owned since 2026-09-18)

- Cycle 36h15m, timer pauses during maintenance; windows come from the worker
  feed (`/purple-schedule`, KV `purple:schedule`), hardcoded list is the
  empty-KV/offline baseline.
- Spawns: one each in 女神庭園, 冰霜峽谷, 雲海曠野 (row desc, per user 2026-09-17).
- Anchor (observed in-game): 2026-09-16 14:08 Taipei; now published via the
  worker feed — edit it on `/admin` (錨點 field), no code push. Moving
  `PURPLE_ANCHOR_MS` in code only matters for the hardcoded fallback.

## Phases (from the original brief, 2026-09-17)

- **Phase 1 (shipped):** local page-timer notification, 36h15m cycle,
  `purple_hole` flag, daily tracker row (max 3/char, spawn-day only),
  timetable popover.
- **Phase 2 (SHIPPED 2026-09-18):** maintenance-aware predictions — worker
  watcher parses Bahamut into candidates, auto-applies published windows,
  per-window admin overrides/tombstones, `/admin` editor. Runbook:
  `docs/operations.md`; history:
  `docs/ledger/purple-hole-phase-2-maintenance.md` (archived).
- **Phase 3 (B shipped 2026-09-18):** timetable updates without commits —
  the anchor is published through the same feed/admin. Crowd reports (C) stay
  evidence-gated. History:
  `docs/ledger/purple-hole-phase-3-timetable-updates.md` (archived).

## Decisions

- Daily per-char counter ×3 (`tracker.json` `purple-hole`, order 55), 06:00 reset with everything else. No store change for progress.
- Row visibility: render-only parking in 已隱藏項目 on off-days (no store writes, out of progress). "Spawn day" = 06:00 daily bucket (decided 09-17: the row showing through 09-17 for the 09-18 02:23 spawn is correct — it doubles as heads-up; calendar-day and hours-before variants rejected).
- Row times: absolute `MM/DD HH:mm` plain text under the title (no 昨日/明日 — lies across midnight); stale spawn shows `已過` + `下次` pair.
- Timetable: click-toggle calendar popover, past 2 + next 3, frozen at open, follows page scroll. No dialog.
- Notification: separate lane (store v19 `purpleHoleReminders`, card tag `mabi-purple`), fires 15 min early, catch-up allowed, no silence cutoff. Card title `深淵的黑色坑洞即將出現`; body `女神庭園、冰霜峽谷、雲海曠野各生成一個，預計 XX 分鐘後出現。` (live minutes: 15 on schedule, fewer on catch-up; no character names — deliberate, decided 09-17, tested end-to-end).
- Maintenance feed (phase 2) + no-commit timetable updates (phase 3): deferred — see Phases.
- Same local-only rules as the hourly lane: never synced, never sent anywhere, page-open-only.

## Done

- [x] Schedule engine (`purpleHole.ts`): anchor, legs, maintenance stretch, bucket check, flag
- [x] Tracker row + off-day parking + 非出沒日 note with next spawn
- [x] Spawn-time badges → twin 已過/下次 plain-text lines
- [x] Timetable popover (calendar icon, scroll-follow, 時刻表 wording)
- [x] Bell subscribe/unsubscribe (shared permission flow, purple soft-ask copy)
- [x] 15-min-early scheduler + catch-up + dedup + tap deep-link + DevTools handles
- [x] Store v18→v19 + migrate step + fixtures (A bumped, S added)
- [x] Card body: names removed, predicted-time placeholder
- [x] `pnpm check` green (repeatedly, including the feed/overrides work)
- [x] Phase 2 shipped: feed + watcher + auto-apply + overrides + `/admin` (2026-09-18)
- [x] Phase 3B shipped: anchor published through the feed/admin (2026-09-18)
- [x] Purple server lane live: `lane=purple` subs, fanout on the 15-min tick

## Todos

- [ ] Observe the first server purple card (due 09/19 14:30 Taipei; closed-app proof = close all tabs)
- [ ] Verify the 9/23 predicted window against the 09/22 announcement (auto-apply may drop it until announced — see the phase-2 gap note)
- [ ] Optional: surface `updatedAt` freshness (`預測更新於 …`) in the popover — data already travels on the feed
- [ ] Phase 3C crowd reports — evidence-gated, not started
- [ ] README privacy bullets — at official release, not before

## Open questions

(none — card body decided 09-17; per-device corrections dropped 2026-09-18.)
