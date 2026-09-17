# 深淵的黑色坑洞 — feature ledger

Branch: `feat/purple-hole` (unmerged, unpushed until user approves).
Flag: `?purple_hole=1` persists `mabiroutine:purple-hole-flag`. Prod default: zero surface.

## Schedule (hand-owned, phase 1)

- Cycle 36h15m, timer pauses during maintenance (math in place, window list empty).
- Anchor (observed in-game): 2026-09-16 14:08 Taipei → predicts 2026-09-18 02:23.
- Correct drift by moving `PURPLE_ANCHOR_MS` in `src/lib/purpleHole.ts` + commit.

## Decisions

- Daily per-char counter ×3 (`tracker.json` `purple-hole`, order 55), 06:00 reset with everything else. No store change for progress.
- Row visibility: render-only parking in 已隱藏項目 on off-days (no store writes, out of progress). "Spawn day" = 06:00 daily bucket (decided 09-17: the row showing through 09-17 for the 09-18 02:23 spawn is correct — it doubles as heads-up; calendar-day and hours-before variants rejected).
- Row times: absolute `MM/DD HH:mm` plain text under the title (no 昨日/明日 — lies across midnight); stale spawn shows `已過` + `下次` pair.
- Timetable: click-toggle calendar popover, past 2 + next 3, frozen at open, follows page scroll. No dialog.
- Notification: separate lane (store v19 `purpleHoleReminders`, card tag `mabi-purple`), fires 15 min early, catch-up allowed, no silence cutoff. Card title `深淵的黑色坑洞即將出現`; body TBD (currently predicted time placeholder, no character names — deliberate).
- Maintenance feed + no-commit timetable updates: deferred to future exploration.
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
- [ ] Decide card body copy (currently `預計 MM/DD HH:mm 出沒` placeholder)
- [ ] Record purple lane in `docs/push-notifications.md` (still barrier-only)
- [ ] Final `pnpm check`, then push/merge on user approval

## Open questions

1. Card body: keep predicted time, or something else entirely?
