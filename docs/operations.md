# Operations — push lanes + purple schedule (LIVING DOC)

Status: everything below is LIVE in prod as of 2026-09-18. This is the one
file to update when operations change. Design rationale lives in
`docs/push-notifications.md`; day-by-day history lives in git history
(the `docs/ledger/` files were folded away 2026-09-18).

## 1. Services & URLs

- Worker: `https://mabiroutine-worker.kaihao.workers.dev` (`workers/mabiroutine-worker`, wrangler).
- App: `https://mabiroutine.vercel.app` (Vercel, deploys on push to `main`).

| Endpoint | Access | Contract |
|---|---|---|
| `GET /` | public | `{ok, worker}` health |
| `GET /purple-schedule` | public, CORS `*`, 60s cache | `{anchorMs, windows[], updatedAt, updatedBy, auto, confidence, sources[]}`; `confidence: "hardcoded"` + `updatedAt: null` when KV is empty/corrupt |
| `GET /admin` | bearer (login form) | the editor page; `noindex`, `no-store` |
| `POST /admin/api/verify` | `{secret}` in body, once | `{ok}` / 401; 500 when `ADMIN_SECRET` unset |
| `GET /admin/api/state` | bearer | `{verified, candidates, overrides}` |
| `POST /admin/api/publish` | bearer, `{anchorMs, windows[]}` | strict-gates the whole doc (400 on garbage), stamps `admin`, **locks auto** |
| `POST /admin/api/promote` | bearer | resolves candidates through overrides, writes verified, keeps auto on |
| `POST /admin/api/auto` | bearer, `{auto: boolean}` | lock keeps values; resume re-resolves immediately |
| `POST /admin/api/overrides` | bearer, `{overrides[], tombstones[]}` full replacement | strict-gates both lists (400), re-resolves when unlocked |
| `GET /robots.txt` | public | disallows `/admin*` (belt-and-braces; the secret is the real gate) |
| `POST/DELETE /api/push/subscribe` | app origin (Vercel) | sub registry; lanes `hourly` / `purple`; idempotent delete, lane-scoped when `lane` given |

## 2. Cron schedule (UTC == Taipei minute, +8 fixed, no DST)

| Cron (UTC) | Taipei | Job | Healthy log line |
|---|---|---|---|
| `0 * * * *` | :00 hourly | barrier fanout | `barrier fanout … fanned-out` / `past-cutoff` / `no-subs` |
| `* * * * *` | every minute | purple tick → fanout when a spawn is within 15 min (pages the lane, ~30 sends/tick) | `purple fanout … fanned-out` / `retry-pending` (page had zero deliveries, held for the next tick) / `no-spawn` / `fired-already` |
| `17 3,15 * * *` | 11:17 / 23:17 daily | Bahamut watcher → candidates → auto-apply | `purple watch … {"windows": N, "applied": bool}` |

Cron edits take ~15 min to propagate (CF-documented). Tail with
`pnpm wrangler tail --config workers/mabiroutine-worker/wrangler.jsonc`.

## 3. KV inventory (`PURPLE`, id `2c35b0732c9a4ebd8d3088824fdc9401`)

| Key | Shape | Writer |
|---|---|---|
| `purple:schedule` | `{anchorMs, windows[{startMs,endMs}], updatedAt, updatedBy, auto}` | watcher (auto, `updatedBy: "watcher"`), admin publish/promote/resume (`"admin"`), dashboard hand-edit |
| `purple:candidates` | `{windows[], observedAt, sources[]}` | watcher only, every run |
| `purple:overrides` | `{overrides[], tombstones[], updatedAt, updatedBy}` | `/admin` overrides save only |
| `purple:last-fire` | `{spawnMs}` | purple fanout (stamped when a run finishes the lane) |
| `purple:fanout` | `{spawnMs, offset, done}` | purple fanout paging cursor, also its fire-once guard. The free plan caps subrequests at 50, so one page (~30 sends) goes per tick; a page that throws on read, or whose every send fails transiently (zero delivered, zero dead), is retried the next tick; a page that made progress advances and is never resent |

Resolve rule (one path, three triggers): candidates base → same-`startMs`
override replaces → unmatched overrides append → tombstoned starts vanish →
normalize. Anchor is always manual. Empty candidates never wipe verified;
past-and-unobserved override records expire on resolve. Absent `auto` reads
as auto-on.

Seed shape (values change; build numbers with `taipeiWall`, never by hand):

```json
{
  "anchorMs": 1789538880000,
  "windows": [{ "startMs": 1790114400000, "endMs": 1790123400000 }],
  "updatedAt": 1758240000000,
  "updatedBy": "seed",
  "auto": true
}
```

## 4. Secrets (all `wrangler secret put`, never committed, never in Vercel)

`VAPID_JWK` (fanout sender) · `VAPID_SUBJECT` (push contact) ·
`TURSO_DB_URL` / `TURSO_AUTH_TOKEN` (fanout reads; full-access, Turso issues
no read-only tokens) · `ADMIN_SECRET` (admin login; browser keeps it in
`sessionStorage`). Rotate by re-put + re-login (VAPID rotation needs all
devices to resubscribe).

## 5. Deploy & verify runbook

Worker (code + worker behavior ship here, independent of app pushes):

```powershell
pnpm worker:deploy
curl.exe https://mabiroutine-worker.kaihao.workers.dev/purple-schedule   # confidence?
curl.exe https://mabiroutine-worker.kaihao.workers.dev/admin -o NUL -w "%{http_code}"  # 200 = HTML shell
curl.exe -X POST https://mabiroutine-worker.kaihao.workers.dev/admin/api/verify -H "Content-Type: application/json" -d '{"secret":"wrong"}'  # 401 = armed (500 = secret unset)
pnpm wrangler kv key list --config workers/mabiroutine-worker/wrangler.jsonc --namespace-id 2c35b0732c9a4ebd8d3088824fdc9401
```

App ships on push to `main` (Vercel). After a client deploy: hard-reload any
stale tab (else the old bundle POSTs `lane: "hourly"`), re-tap the bell, and
confirm the row in Turso (`push_subscriptions` — query via dashboard or the
`/v2/pipeline` API with `TURSO_DB_URL`/`TOKEN` from `.env.local`).

Bell re-tap signature (server lane): the soft-ask names App-closed delivery
plus server-data deletion (hourly adds the linkage disclosure; purple states
no linkage). First purple card lands in the first 1-min tick inside the
lead window, so 14–15 min before spawn — e.g. under the old 15-min tick,
spawn 14:38 → card 14:30 reading 預計 8 分鐘後出現.

## 6. Admin workflows (`/admin`, helpers welcome — the page teaches itself)

1. **Verify**: open each candidate against the Bahamut search page (date,
   AM/PM, minutes) + newest replies for 延長; routine is Wednesday ~06:00.
2. **Fix one window / add / ignore**: candidate 修正/忽略 stages into
   手動覆寫 → 儲存覆寫. Routine case, no freeze.
3. **Accept all**: 採用候選 (keeps auto on).
4. **Rewrite everything**: the flap under 已發佈 (locks auto; resume to undo).
5. **Anchor drift**: edit 錨點, publish — no code push, all devices follow.
6. **Maintenance that does not shift** (the timer may keep running through a
   maintenance; learned 2026-09-30, first real test 10/01): 忽略 the window.
   Tombstoning takes it out of the pause math while the announcement is still
   a candidate, so the leg is not stretched. If it shifted by a different
   amount than announced, 修正 its bounds to the effective shift instead. If
   predictions are already late beyond what the windows explain, re-anchor
   from an observed spawn (錨點 + 發佈, then 回復自動更新).

Rules of thumb on the page: unsure → don't publish; overstated windows skew
predictions LATE (miss), understated skew EARLY (wait) — err short. When a
maintenance's pause is uncertain, exclude the window: a missed pause costs a
wait, a kept non-pause costs a miss.

Scriptable: the same edits are wrapped for agents in the `purple-schedule`
skill (`skills/purple-schedule/`, invoked as `/purple-fix`): `state` and
`predict` are read-only, `no-shift` / `shift-amount` / `anchor` write. It reads
`MABI_ADMIN_SECRET` from the environment (never an argument or a file) and
prints the new state and predictions.

## 7. Client behavior contracts (for debugging reports)

- Feed chain: live fetch > localStorage cache > hardcoded; `__mabiPurpleFeed()`
  reports `{source, updatedAt, fetchedAtMs}` in DevTools,
  `__mabiPurpleRefresh()` forces one round.
- Feed refresh: `refreshPurpleFeedThrottled` (one in flight, 60s minimum gap)
  runs at boot, every 30 min, on foreground return, on reconnect, and when the
  timetable popover opens (an open table is corrected once if the feed
  changed, then stays frozen). A no-change response notifies nobody.
- Visibility split (both lanes): visible tab → local card (SW suppresses
  server); hidden/closed → server card (page skips). Same collapse tag per
  lane, `renotify`, no stacking by design.
- Flag-off disarms both halves on both flags (server row DELETE + device
  unsubscribe + local entry clear); re-enabling starts clean, one bell tap.
- Subscribe writes one row per `(endpoint, lane)` (Turso migration v4) —
  two lanes on one device coexist; lane-less DELETE clears every row for the
  endpoint (legacy full-unsubscribe; a stale pre-lane tab can do this, and it
  self-heals via reconcile + re-tap).
- Deep-link: server cards carry top-level `task` (`barrier` / `purple-hole`)
  + `chars`; tap focuses/flashes via URL params or the postMessage channel.

## 8. Known gaps & todos (the only open items)

- [ ] First server purple card — confirm body + closed-app delivery (first
  window after launch; check `purple:last-fire` + `last_sent_at`).
- [ ] Freshness label (`預測更新於 …`) in the purple popover — `updatedAt`
  already travels on the feed; UI not built.
- [ ] Maintenance-shift model (evidence due 10/01): the shift is observationally
  unconfirmed, and the 10/01 spawn is the first leg that crosses a window (feed
  says 20:38 if the 9/30 window pauses, ~16:38 if not). Then decide: keep
  auto-shift, default new candidates to no-shift, or an explicit per-window
  shift flag. Quick fix until then: 忽略 the window. Details in
  `docs/purple-hole.md`.
- [ ] Feed-refresh edge (accepted low-priority 2026-09-30, kept as-is):
  `refreshPurpleFeedThrottled` stamps the attempt at its start, including
  failures, so an `online` recovery (or a popover open) within 60s of a failed
  fetch is skipped and the timetable stays stale until the next 30-min tick.
  Fix if it ever bites: call `refreshPurpleFeedThrottled(0)` on connectivity
  transitions + popover open, or don't count failures toward the gap. Same
  call never rejects, so `__mabiPurpleRefresh()` cannot distinguish
  "unchanged" from "failed".
- [ ] Phase-3C crowd reports — needs frequent drift AND an active reporter
  base plus a privacy review. Not this year on current information.

## 9. History & rationale (read when revisiting a decision)

- Decisions and constraints: `docs/push-notifications.md` (push lanes, fanout,
  flags, matrix) + `docs/purple-hole.md` (feature decisions plus folded
  purple history: sources, cadence, gotchas, dropped options).
- Day-by-day work logs (2026-09-17/18 spikes, proofs, review rounds) lived in
  `docs/ledger/` until the 2026-09-18 fold deleted those files — full text
  recoverable from git history (e.g. `git log -- docs/ledger/server-push.md`).
  Nothing in code referenced them, so deletion changed no behavior.
