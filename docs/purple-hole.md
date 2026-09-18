# 深淵的黑色坑洞 — feature ledger

Branch: `feat/purple-hole` (unmerged, unpushed until user approves).
Flag: the 實驗性功能 dialog persists `mabiroutine:purple-hole-flag`. Prod default: zero surface.

## Schedule (hand-owned, phase 1)

- Cycle 36h15m, timer pauses during maintenance (math in place, window list empty).
- Spawns: one each in 女神庭園, 冰霜峽谷, 雲海曠野 (row desc, per user 2026-09-17).
- Anchor (observed in-game): 2026-09-16 14:08 Taipei → predicts 2026-09-18 02:23.
- Correct drift by moving `PURPLE_ANCHOR_MS` in `src/lib/purpleHole.ts` + commit.

## Phases (from the original brief, 2026-09-17)

- **Phase 1 (this branch):** local page-timer notification on desktop (same architecture as the barrier MVP), 36h15m hardcoded cycle, maintenance ignored (not predictable), `purple_hole` flag, daily tracker row (max 3/char, spawn-day only), timetable popover, anchor updates via commits.
- **Phase 2 (future):** maintenance-aware predictions — see
  `docs/ledger/purple-hole-phase-2-maintenance.md` (recommended: hand-entered
  windows + in-app emergency entry; scraper/feed parked until the burden
  justifies it).
- **Phase 3 (future):** timetable updates without commits — see
  `docs/ledger/purple-hole-phase-3-timetable-updates.md` (admin-published
  feed if burden justifies — the per-device recalibrate button was dropped
  2026-09-18; crowd reports only on evidence).

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
- [x] `pnpm check` green (post-body-change run pending — see todos)

## Todos

- [ ] User test: subscribe persists across reload; forced fire (`__mabiPurpleFire`); real fire 09/18 02:08; tap deep-link + flash
- [x] Card body copy decided + tested end-to-end
- [x] Purple lane recorded in `docs/push-notifications.md` (§2 lane note, D8, flag composition)
- [x] Phase 2 + 3 planned in depth (`docs/ledger/`)
- [ ] Final `pnpm check`, then push/merge on user approval

## Open questions

(none — card body decided 09-17.)
