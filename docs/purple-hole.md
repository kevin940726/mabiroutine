# 深淵的黑色坑洞 — feature ledger

Branch: `feat/purple-hole` merged to main; phase 2 shipped 2026-09-18.
Reminders graduated 2026-09-19: no flag, bells show for everyone.

## Schedule (feed-owned since 2026-09-18)

- Cycle 36h15m. No observation shows maintenance affecting it, so the pause
  model was dropped (2026-10-07). Spawns are two rays (2026-10-14): the record
  lattice (`anchorMs`, backward) supplies the past, and an explicit correction
  (`nextMs`, 下次, forward) supplies the next spawn and onward when set;
  without one the rays degenerate to the old single lattice. Windows come from
  the worker feed (`/purple-schedule`, KV `purple:schedule`) and are
  suppression-only (not fed into the grid); the hardcoded list is the
  empty-KV/offline baseline. Client refresh: boot, every 30 min, foreground
  return, reconnect, popover open, through one throttled single-flight call
  (see `docs/operations.md` §7).
- Spawns: one each in 女神庭園, 冰霜峽谷, 雲海曠野 (row desc, per user 2026-09-17).
- Anchor: feed-owned, edited on `/admin` (錨點 field), no code push. It is the
  RECORD (the last spawn actually observed), with `prevMs` (前一筆) as the
  recorded spawn before it so the row behind the anchor stays exact across a
  seam (10-13 15:41:02 → 10-14 14:10:09 is 22h29m, not 36h15m). Only an
  explicit re-anchor moves the record. A correction of the next spawn lives in
  its own feed field (`nextMs`, 下次) and never touches the record, so the past
  rows do not move on a correction (rule of 2026-10-14; the old habit of
  re-anchoring did move them). A passed correction that the record does not
  cover is refused by the publish (409: record first, never fold). Drift is
  handled with `next` (the next spawn) or `anchor` (an observation).
  `PURPLE_ANCHOR_MS` in code is the empty-KV/offline fallback only.

## Phases (from the original brief, 2026-09-17)

- **Phase 1 (shipped):** local page-timer notification, 36h15m cycle,
  `purple_hole` flag, daily tracker row (max 3/char, spawn-day only),
  timetable popover.
- **Phase 2 (SHIPPED 2026-09-18; pause model dropped 2026-10-07):** worker
  watcher parses Bahamut into candidates, auto-applies published windows, and
  keeps per-window admin overrides/tombstones — now curating the SUPPRESSION
  list only. Runbook: `docs/operations.md`.
- **Phase 3 (B shipped 2026-09-18):** timetable updates without commits —
  the anchor is published through the same feed/admin. Crowd reports (C) stay
  evidence-gated.

## Decisions

- Daily per-char counter ×3 (`tracker.json` `purple-hole`, order 55), 06:00 reset with everything else. No store change for progress.
- Row visibility: render-only parking in 已隱藏項目 on off-days (no store writes, out of progress). "Spawn day" = 06:00 daily bucket (decided 09-17: the row showing through 09-17 for the 09-18 02:23 spawn is correct — it doubles as heads-up; calendar-day and hours-before variants rejected).
- Row times: absolute `MM/DD HH:mm` plain text under the title (no 昨日/明日 — lies across midnight); stale spawn shows `已過` + `下次` pair.
- Timetable: click-toggle calendar popover, past 2 + next 3, frozen at open (opening refetches the feed and may correct the table once), follows page scroll. No dialog.
- Notification: separate lane (store v19 `purpleHoleReminders`, card tag `mabi-purple`), local page-timer fires exactly 15 min early, catch-up allowed, no silence cutoff. Card title `深淵的黑色坑洞即將出現`; body `女神庭園、冰霜峽谷、雲海曠野各生成一個，預計 XX 分鐘後出現。` (live minutes: 15 on schedule, fewer on catch-up; no character names — deliberate, decided 09-17, tested end-to-end). Server-lane (closed-app) lead is near-exact by design: first 1-min cron tick inside the window, so 14–15 min (was 1–15 min on the 15-min tick — the 8-min card for the ~14:38 spawn on 2026-09-19 was that old design working). Both lanes stand down inside a maintenance window (`isInMaintenance` on the feed windows): the page timer skips that spawn and arms the next, the server tick reports `maintenance` without moving the fanout cursor, so post-window ticks resume the same spawn's remaining pages.
- Server-lane paging (2026-09-30): the fanout sends one page (~30 subs) per tick so a single invocation stays under the Workers free-plan 50-subrequest cap, and the `purple:fanout` cursor doubles as the fire-once guard (any 2xx counts as delivered). Before this the one-shot run threw past 50 subs (58 on 2026-09-30) *before* stamping the guard, so the 1-min tick re-sent the first ~48 subs every minute.
- Maintenance feed + no-commit timetable updates: shipped (phase 2 + 3B) — runbook in `docs/operations.md`.
- Pause model dropped (2026-10-07): no observation shows maintenance affecting the cycle, so the grid is a plain `anchor + n × 36h15m`. The 2026-09-30 evidence (a leg that crossed a window landed ~13h from either reading, and the 2026-10-08 spawn is a clean `anchor + 5 × 36h15m`) showed the shift is not a function of the window. Maintenance windows are suppression-only: `isInMaintenance` stands cards down while the game is down; they are not fed into the grid. Re-anchor by hand when a spawn drifts from the grid (錨點 + 發佈, then 回復自動更新). Quick fixes on `/admin` (§6): 忽略 a window (drop it from suppression), 修正 its bounds, or re-anchor.
- Corrections freeze the past (2026-10-14, maintainer rule): a next-spawn correction must not rewrite the previously recorded past, so the feed doc pairs the record (`anchorMs`, the last observed spawn, plus `prevMs`, the spawn recorded before it) with an explicit next (`nextMs`); a correction swaps only the next spawn and everything after it, and the timetable's 過去 rows stay byte-identical until an explicit re-anchor. The skill's `next <t>` is the correction verb; `anchor <t> [prev]` is the only verb that moves the record. Two follow-ups decided in the same pass: a passed correction that the record does not cover is *refused* at publish (409, naming the spawn to record first; folding it into the record unseen was rejected), and `prevMs` exists so the row behind a recorded spawn is exact across a seam (the maintained records are not always 36h15m apart). Background: the 2026-10-14 correction (next spawn 10-14 14:10:09) was published as a re-anchor, which moved the past rows from 10-13 15:41:02 / 10-12 03:26:02 to 10-13 01:55:09 / 10-11 13:40:09; the endorsed record (anchor 10-13 15:41:02, prev 10-12 03:26:02, next 10-14 14:10:09) is restored once the build carrying the fields is deployed, because a pre-field client ignores them and derives from the anchor alone.
- Feed refresh (2026-09-30): boot-only was the gap for always-open apps (the app is never closed, so a long-lived tab could sit on an indefinitely stale timetable). Now refreshed at boot + every 30 min + foreground return + reconnect + popover open, all coalesced through one throttled (60s gap) single-flight call. A no-change response is a no-op apply that notifies nobody.
- Same local-only rules as the hourly lane: never synced, never sent anywhere, page-open-only.
- Record log (2026-10-21): the schedule doc keeps two explicit points and every publish overwrites them, so the observed spawn sequence was unrecoverable — not in KV, and not in the worker logs (a publish logs nothing). KV `purple:history` now appends what each publish changed: `anchor` (a spawn recorded, with the point behind it), `next` (a correction), `forget` (a correction dropped as never-happened; one the record already covers — its latest passed spawn is at/before the new anchor — is absorbed instead and gets no entry). Entries carry Taipei wall clock with an explicit `+08:00` and seconds plus `logged`, the publish time (`at` can be days earlier, so a late record is visible), oldest first, capped at 500 (~two years of spawns); a stored value that is not a log is never overwritten, and unreadable entries are dropped on read. Nothing in the app or the feed reads it: it exists so an agent can ask whether a re-anchored time is predictable from the recorded ones, which is a theory, not a rule — the 36h15m grid stays the model. Read it with the skill's `history [n]` or `GET /admin/api/state`.

## History & past decisions (day-by-day log in git history, ex-`docs/ledger/`)

- Sources (verified live 2026-09-17): the official TW board is JS-rendered
  (static fetch returns empty chrome — no official scraper), but the Bahamut
  search endpoint serves the maintenance posts pre-filtered + time-sorted to a
  bare GET with full first-post bodies inline
  (`forum.gamer.com.tw/search.php?bsn=32564&q=維護公告&field=title&firstFloorOnly=1&advancedSearch=1&subbsn=5&sortType=mtime`).
  GNN news pages are fully readable (second source). Routine maintenance is
  Wednesday mornings; same-day emergencies go through a code edit + push like
  all TW data.
- Cadence locked 2026-09-17: 15-min lead; server tick later tightened from 15-min to 1-min (worst-case lead 1 min → 14 min). The hole despawns
  ~13 min after spawn, which bounds *lateness*, not lead; early is cheap
  (wait), late is fatal (miss). Revisit only on evidence.
- Extension gotcha (proven 9/16: announced 06:00–08:30, actually ended
  09:00): Bahamut reposts are snapshots — only the official post is edited on
  overrun. Candidates are therefore *scheduled* windows (earliest-possible);
  whoever confirms checks the newest replies for 延長 bumps first.
- Legs tile continuously from the anchor at a fixed 36h15m; windows are not fed
  into them (pause model dropped 2026-10-07). Windows still should not be
  pruned while they matter for suppression, but they are not part of the
  schedule.
- Dropped, not parked: official-API scraper, Wednesday-rule default (the feed
  carries verified windows instead), in-app maintenance override, per-device
  recalibrate button (the maintainer's announcement read is canonical), GH
  Actions backup trigger (CF worker entirely), Vercel fanout route
  (full-worker fanout proven with FCM 201), gist/R2/Turso feed hosting
  (KV + dashboard + `/admin`).
- Auto-apply (2026-09-18, reverses the earlier never-auto rule): unlocked docs
  take resolved candidates (anchor stays manual, empty never wipes); manual
  publish locks; promote/resume keep/set auto; per-window overrides replace by
  startMs, unmatched append, tombstones suppress, past + unobserved records
  expire. Known limitation, accepted: auto-apply drops future hand-predicted
  windows not yet announced (9/23 case) — the announcement restores them
  before the affected spawn.

## Done

- [x] Schedule engine (`purpleHole.ts`): anchor, fixed 36h15m grid, suppression windows, bucket check, flag
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
- [x] First server purple card observed 2026-09-19 (~14:38 spawn, 8-min lead — closed-app proof, variable lead confirmed by design)
- [x] Client auto-refresh: boot + 30 min + foreground + reconnect + popover open (2026-09-30)
- [x] Maintenance fallback pruned to the current routine: spent 9/23 prediction dropped, 9/30 watcher-verified window (06:00–10:00) mirrored (2026-09-30)
- [x] Pause model dropped (2026-10-07): the cycle is a fixed 36h15m, windows are suppression-only, and the grid was re-set (next spawn 2026-10-08 06:59:35)
- [x] Corrections freeze the past (2026-10-14): `nextMs` + `prevMs` on the feed, `/admin` (下次出沒 / 前一筆) and the skill (`next`, `anchor [prev]`), the 409 supersede guard, with `test:purple` pinning the two rays

## Todos

- [ ] Optional: surface `updatedAt` freshness (`預測更新於 …`) in the popover — data already travels on the feed
- [ ] Phase 3C crowd reports — evidence-gated, not started

## Open questions

(none — card body decided 09-17; per-device corrections dropped 2026-09-18.)
