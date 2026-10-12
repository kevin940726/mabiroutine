# Operations — push lanes + purple schedule (LIVING DOC)

Status: everything below is LIVE in prod as of 2026-09-18. This is the one
file to update when operations change. Design rationale lives in
`docs/push-notifications.md`; day-by-day history lives in git history
(the `docs/ledger/` files were folded away 2026-09-18).

## 1. Services & URLs

- Worker: `https://mabiroutine-worker.kaihao.workers.dev` (`workers/mabiroutine-worker`, wrangler).
- App: `https://mabiroutine.vercel.app` (Vercel, deploys on push to `main`).

### Metered ceilings (the guard's memory: every cap the app can spend)

| Dependency | Ceiling today | Where it surfaces |
|---|---|---|
| Vercel edge requests (all 9 team projects share it) | 1M/month on Hobby, then the account pauses for ~30 days; Pro includes 10M then bills per million | Dashboard usage page; `vercel metrics` + Observability Plus are Pro-only |
| Vercel function invocations | 1M/month on Hobby (same pause) | Same |
| Cloudflare Worker requests (fanout, purple schedule) | Workers Free stops at 100k requests/day | Cloudflare notifications + the Worker's metrics page |
| Turso rows read/written | 500M / 10M per month on free, then blocked (no overage) | Turso usage page |
| Push providers (one send per subscriber per fanout run) | provider rate limits | Worker logs; the hourly fanout is capped at 500 sends per run, the purple lane is paged per tick |

A cap that pauses is the backstop, not the fix: it converts a surprise into an
outage you were warned about. The fix for anything client-side is §7's device
budget, and for anything server-side it is a bounded loop in our own code.

### Capacity verdict: this app fits Hobby at its current scale

Measured over the eight clean days before the 2026-10-12 incident (Oct 3-10),
against Hobby's first-unit allowances:

| Cap | This app, measured | Hobby | Headroom |
|---|---|---|---|
| Edge requests | ~17.6k/day (14k-25k) | 1,000,000/month (~33k/day) | ~1.9x |
| Fast Data Transfer | ~139 MB/day | 100 GB/month | ~25x |
| Function invocations | ~4.8k/day | 1,000,000/month | ~7x |

Deploys are the other line item, and they are cheap since art got a real browser
cache lifetime: the last measured wave was ~150 requests across 24 online
clients, where the hour before that change was ~25,000. The other eight projects
on the team share the same budget and cost ~52k/month together.

So the app should run on Hobby comfortably, with the caveat that edge requests
are the cap that matters and the one to watch: the dashboard usage page shows the
same daily totals these numbers came from (`vercel metrics` is what produced them
here, and that endpoint is Pro-only). Two things would change the arithmetic
rather than fit inside it: traffic growing by a couple of times, or another
feature whose steady state is itself hundreds of thousands of requests a month. A
runaway client is no longer one of them, because §7's device budget bounds one
per device and §10 is the response if the daily total ramps anyway. Hobby also
carries a personal, non-commercial use policy, which is a separate question from
the cap and only matters if this app is ever monetized.

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
| `0 * * * *` | :00 hourly | barrier fanout | `barrier fanout … fanned-out` / `past-cutoff` / `maintenance` / `no-subs` |
| `* * * * *` | every minute | purple tick → fanout when a spawn is within 15 min (pages the lane, ~30 sends/tick) | `purple fanout … fanned-out` / `retry-pending` (page had zero deliveries, held for the next tick) / `no-spawn` / `maintenance` / `fired-already` |
| `17 3,15 * * *` | 11:17 / 23:17 daily | Bahamut watcher → candidates → auto-apply | `purple watch … {"windows": N, "applied": bool}` |

Cron edits take ~15 min to propagate (CF-documented). Tail with
`pnpm wrangler tail --config workers/mabiroutine-worker/wrangler.jsonc`.

Both fanouts stand down inside a game-maintenance window (`isInMaintenance`
over the `purple:schedule` windows, the same half-open `[start, end)` list):
the purple tick and the `:00` barrier tick both return `maintenance` and send
nothing, and the first tick at or after `end` sends normally. The windows come
from the purple feed because maintenance is the game's, not one lane's — a card
sent while the servers are down names an event that cannot happen.

### Experiment 2026-10-02: barrier tick at :59 (worker only, reverted 2026-10-03)

Platform delivers the `:00` tick at :00:58 (`at` stamps `20:00:58Z` hourly and
`19:59:58Z` on the per-minute tick; fanout wall 2.5s for 20 subs), so server
cards land :01 on every device. Hypothesis: the ~58s phase is constant across
minutes → firing at :59 lands completion ≈:00:00 and arrival ≈:00:0x. Scope is
worker cron + dispatch only; the local open-app timer still fires :00:00.x.
Costs accepted for the experiment: the roster snapshot reads ~60s earlier (a
completion at :59:30 still nags) and the fire precedes the :00 soft ping
(arrival still pairs with it). The staleness guard is carved out for the last
minute before the hour — without it every `:59` tick would skip as
past-cutoff and send nothing.
Verify: next ticks' `barrier fanout <at>` stamps + `reason` fields + device
arrival times.
Decide after 2–3 ticks: arrival :00:0x → keep; :59:xx → revert.
Revert: `59 * * * *` → `0 * * * *` in `wrangler.jsonc` + `src/index.ts`
dispatch, one `worker:deploy` (cron propagation ~15 min).

Outcome 2026-10-03: FALSIFIED — the ~58s phase is per-cron, not constant.
The `:59` tick stamped `scheduledTime 1791032351` (20:59:11 Taipei, not
:59:00) and fired 20:59:17 Taipei (+6s, wall 2.5s), so cards land ≈:59:20,
~40s early and no longer paired with the :00 soft ping. Reverted to
`0 * * * *` (cron + dispatch + guard carve-out all back); server cards land
:01 again until a better approach turns up.

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
`sessionStorage`) · `VERCEL_ACCOUNT_WEBHOOK_SECRET` + `VERCEL_ALERTS_WEBHOOK_SECRET`
+ `DISCORD_WEBHOOK_URL` (§11 relay: the two Vercel webhook secrets, which differ
per webhook type, and the Discord channel URL) · `EMAIL_FORWARD_TO` (optional,
§11: an address that also receives a copy of routed mail; must be verified in
Email Routing). Rotate by re-put + re-login (VAPID rotation needs all devices to
resubscribe); the relay trio rotates platform-side first, see §11.

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
6. **Maintenance windows** are not fed into the schedule (pause model dropped
   2026-10-07): they only stand cards down while the game is inside one. Use
   忽略 to drop a window from suppression, 修正 to change its bounds, and
   re-anchor from an observed spawn (錨點 + 發佈, then 回復自動更新) when a
   spawn drifts off the 36h15m grid.

Rules of thumb on the page: unsure → don't publish. A window that is too wide
suppresses a card that would have landed; one too narrow sends a card while the
game is down, so err short and exclude a window you are unsure of. The anchor
is the only input that moves a spawn.

Scriptable: the same edits are wrapped for agents in the `purple-schedule`
skill (`skills/purple-schedule/`, invoked as `/purple-fix`): `state` and
`predict` are read-only, `no-shift` / `shift-amount` / `anchor` write. It reads
`MABI_ADMIN_SECRET` from the process environment and prints the new state and
predictions. Supply it by exporting it, or keep the conventional local copy at
`.env.admin.local` (repo root, gitignored via `.env*`) and load it with
`node --env-file=.env.admin.local …`. Never pass it as an argument (shell
history) and never commit it. Do not use the root `.env.local`: `vercel env
pull` regenerates that file and would wipe the value.

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
- Bell state (both lanes) reports what will actually fire: on = (endpoint
  claim present, or a local-only lane on a device that cannot push) AND
  `Notification.permission === "granted"`. The endpoint map
  (`mabiroutine:push-subs`) is a device-local claim, reconciled against the
  live `PushSubscription` on bell mount — a dead sub clears the claim and the
  bell turns off (the local lane is armed on every subscribe, so it must not
  mask a broken server lane). The bell re-reads on a Permissions API change; a
  revoked permission reads off, and tapping opens guidance that also offers
  取消訂閱 (the only remaining way to delete the row while permission is
  denied). A sync pull or an old backup that lacks the lane cannot clear it,
  and on load `healClaimedReminderLanes` re-arms a claimed lane whose local
  entry is missing (the 2026-10-07 wipe). Residual: a stale pre-lane tab's
  lane-less DELETE drops the server row while the claim lives — the local lane
  is re-armed but closed-app delivery needs a re-tap (no client-side row
  lookup).
- Flag-off disarms both halves on both flags (server row DELETE + device
  unsubscribe + local entry clear); re-enabling starts clean, one bell tap.
- Subscribe writes one row per `(endpoint, lane)` (Turso migration v4) —
  two lanes on one device coexist; lane-less DELETE clears every row for the
  endpoint (legacy full-unsubscribe; a stale pre-lane tab can do this, and it
  self-heals via reconcile + re-tap).
- Deep-link: server cards carry top-level `task` (`barrier` / `purple-hole`)
  + `chars`; tap focuses/flashes via URL params or the postMessage channel.
- Device request budget (`public/sw-budget.js`, `pnpm test:budget`): the Service
  Worker is the only place that sees every same-origin request the page makes,
  so it counts them per device and, past a tier, stops spending requests instead
  of the user's patience. Tiers: 400 requests/minute, 4,000 per 30 minutes,
  6,000 per 6 hours. Past a tier, and for 5 minutes after the last trip, every
  same-origin class gets a real or a retryable answer instead of a request:
  `/api/` as 429 (the state the sync layer already renders), navigations from
  the navigation preload or the `pages` cache and only then the network, images
  from cache else a transparent pixel, and everything else (scripted fetches,
  which have no `destination`, plus fonts, chunks and any future class) from
  cache else a 503 with `Retry-After`. The one class allowed to reach the
  network while over budget is an uncached navigation, because a blank first
  load is worse than a request and the pages cache makes that case
  self-limiting. Cross-origin is never touched, and until a tier is crossed the
  script never intercepts anything, so the Workbox routes behave exactly as they
  do without it. Read a device: `__mabiBudget()` (its trips, including the path
  that crossed) and `__mabiBudgetAsk()` (live counters and the tiers). Trips are
  local-only and silent to the user: a tripped device still works, though an
  uncached chunk refused with 503 can break a load until the trip clears.
- The prevention claim is Chromium-specific, and worth keeping honest: a fetch
  event answered by one listener is not handed to later listeners at all, which
  is why the Workbox routes neither fetch nor throw on a claimed request
  (measured: 8 requests past a tier of 5 cost exactly 5 network hits, and a
  cached portrait was served at 0). The spec instead dispatches later listeners
  and throws `InvalidStateError` on a second `respondWith`, so on an engine that
  follows the spec a matching route's strategy could still spend one backfill per
  blocked request. Owning those caches in the guard instead of in Workbox routes
  is the fix if that ever shows up.
- The tiers are generous on purpose, about 10x a heavy real session, and they
  exist to catch a loop at the incident's rate (16 req/s trips the 1-minute tier
  in ~25 seconds), not to throttle browsing. Tighten them only after a week of
  `__mabiBudgetAsk()` readings; they are calibratable at runtime through the
  worker's `mabi-budget-config` message, which is also how the browser proof
  drives them. The 1-minute tier is exact (raw timestamps, bounded by the tier
  itself); the 30-minute and 6-hour tiers are per-minute buckets, so a
  multi-hour storm cannot grow the worker's memory the way one timestamp per
  request would, at the cost of up to a minute of over-count at their edge.
- Counted network funnel and the three sanctioned request sites: every network
  call under `src/` goes through one of three places, and `pnpm test:budget`
  fails a call made anywhere else. `sync/api.ts` owns `/api/session` (per-kind
  counters, read with `__mabiSyncStats()`); `src/lib/net.ts` owns the push
  registry (per-day counters, read with `__mabiNet()`); and `purpleHole.ts`
  keeps its own `/purple-schedule` fetch, because that module is shared with the
  Cloudflare Worker (the fanout imports its pure schedule math by relative path)
  and must therefore stay free of ALIASED runtime imports. Its request is
  bounded anyway (60s minimum gap, one in flight) and counted by the device
  budget above. The funnel is a passthrough by contract: it counts, and it must
  not add retries, timeouts or cache policy, because its callers are best-effort
  and their failure semantics are their own. Bounding demand is the device
  budget; this makes demand legible.
- Shared modules the Worker imports must stay resolvable in wrangler: relative
  imports only for runtime values (`@/...` fails to resolve there; `import type`
  is fine because it is stripped first), and no DOM-only dependency.
  `pnpm test:worker` bundles the Worker so that mistake fails in the gate rather
  than at deploy time; it was learned the hard way on 2026-10-12.

## 8. Known gaps & todos (the only open items)

- [ ] First server purple card — confirm body + closed-app delivery (first
  window after launch; check `purple:last-fire` + `last_sent_at`).
- [ ] Freshness label (`預測更新於 …`) in the purple popover — `updatedAt`
  already travels on the feed; UI not built.
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
- [ ] Device-budget coverage gaps, accepted with the guard (2026-10-12): a
  first-ever visit (no worker installed yet) and cross-origin requests are
  ungoverned; the rolling windows live in memory, so a loop that paces itself
  under every tier AND survives worker restarts is not caught; an uncached
  navigation is deliberately allowed through, which self-limits after one load
  once the `pages` cache holds the shell; and the zero-cost claim for a blocked
  request is Chromium-measured (see §7). Calibrate from `__mabiBudgetAsk()`
  after a week. If a ceiling ever matters again, the next step is a Cloudflare
  Worker in front of the domain, where every request (assets included, attacker
  traffic included) passes our own code.
- [ ] Barrier fanout cap has no rotation (2026-10-12, only reachable above 500
  hourly subscribers): `MAX_BARRIER_SENDS_PER_RUN` slices the first 500 rows of a
  query with no `ORDER BY`, so if the cap ever engages, the same prefix is served
  every run and the remainder never receives a card. Add rotation (or select by
  least-recently-sent) before that lane reaches the cap; `capped` in the cron log
  line is what would say it happened.
- [ ] Deliberately NOT built (2026-10-12), revisit only on evidence: a GLOBAL
  server-side budget on `/api/*`. The per-IP fixed-window limiter already bounds
  one client (10 creates/min, 60 reads/min) and the device budget bounds a
  runaway client before it ever reaches the API, so a global tier would mostly
  add a self-inflicted outage: one noisy fleet could trip it and lock out
  everybody for the window. Build it if a multi-IP flood ever appears, which is
  an edge problem (a Worker in front) rather than an API-code one.

## 9. History & rationale (read when revisiting a decision)

- Decisions and constraints: `docs/push-notifications.md` (push lanes, fanout,
  flags, matrix) + `docs/purple-hole.md` (feature decisions plus folded
  purple history: sources, cadence, gotchas, dropped options).
- Day-by-day work logs (2026-09-17/18 spikes, proofs, review rounds) lived in
  `docs/ledger/` until the 2026-09-18 fold deleted those files — full text
  recoverable from git history (e.g. `git log -- docs/ledger/server-push.md`).
  Nothing in code referenced them, so deletion changed no behavior.
- Incidents: §10 is the 2026-10-12 usage-drain write-up (recognition, the
  diagnosis commands, the response order, and the two facts that cost time).
  Its mechanism lives in `docs/item-icons.md` § The fallback rule; the guard it
  produced is §7.
- Notifications: §11 is how Vercel events reach Discord (the Worker relay) and
  why Vercel's own notification settings could not carry them.

## 10. When usage drains (the 2026-10-12 incident, and the runbook it left)

The mechanism is documented where the bug was (`docs/item-icons.md` § The
fallback rule: an `onError` that assigned `img.src` to a URL a deploy had
deleted). This section is the operational half: how it looked, how to diagnose a
repeat on either plan, and the order to respond in.

### What it looked like

From the provider's own numbers:

| Time (UTC) | Edge requests | What was happening |
|---|---|---|
| Oct 11 baseline | 12-25k/day (400-1,000/hour) | normal traffic |
| Oct 11 17:00 | 25,018 in the hour | a deploy: clients refetch the shell |
| Oct 11 21:00 | 3,847 | a loop ignites as overnight tabs wake |
| Oct 11 22:00 - Oct 12 06:00 | 265k-332k per HOUR, flat | nine hours of drain |
| Oct 12 06:58:29 | paused | Hobby's 1M/month cap: `softBlock: FAIR_USE_LIMITS_EXCEEDED`, `blockedDueToOverageType: "edgeRequest"` |
| Oct 12 07:00-12:30 | 28-50k/hour | the same tabs hammering 402s while the deployment was disabled |
| Oct 12 12:33 | fix deployed | the shim's 200 ended it: the next 5-minute bucket read 51, against 3,200-4,400 before |

2.81M requests against a 1M cap. One path named the culprit: `/npc/placeholder.png`
took 11,099 requests in a single 15-minute bucket. It was **not an attack**: Web
Analytics was flat and organic (171-527 visitors/day, TW/HK, no spike) and
pageviews stopped exactly at the block.

### Diagnosing a spike

- **On Pro**: `vercel metrics vercel.request.count --project mabiroutine --since 6h -g 5m --group-by request_path --json` is the fastest read, and is what named the path above. Add `--all` for the whole team. `vercel alerts` and `vercel firewall overview` exist but answer nothing until rules are configured.
- **On Hobby**: `vercel metrics` is `payment_required` (Observability Plus), `vercel usage` 404s, `vercel firewall overview` 402s, and runtime logs keep 1 hour instead of 1 day. Only the dashboard usage page and Web Analytics remain, which is why the incident took hours to reconstruct.
- Either way, compare against the yardstick: this app's normal is 400-1,000 requests/hour. 200k+/hour is a loop, not traffic. The team shares one budget across nine projects, but the other eight are dormant (~52k/month), so a spike is always `mabiroutine`. §1 carries the plan arithmetic behind that yardstick.

### Responding, in order

1. Name the path (`--group-by request_path`). One asset taking thousands of requests is a client loop.
2. **Ship the shim before the fix** when a deploy renamed or deleted a URL that live clients still reference: restoring the old path (e.g. `public/npc/placeholder.png`) ends a loop in tabs you cannot reload. The code fix alone never reaches an already-open tab.
3. Ship the fix and its gate in the same push (`test:fallbacks`, `test:budget`), changelog entry included, saying what the meter cost.
4. Only then decide the plan: upgrading lifts the block, waiting ~30 days lets the window roll off. Upgrading does NOT deploy work a blocked push parked (ours produced no deployment at all until the upgrade landed).
5. After the block lifts, deploy and verify by observation: the shim returns 200, art carries `max-age=86400`, and the served `/sw.js` imports `sw-budget.js`.
6. Watch the daily total, not hourly noise, and expect a deploy wave (25k requests in the hour before the art cache headers existed, far less now).

Two facts that cost time: the metrics pipeline lags a few minutes, so the newest
bucket can read 0 while the window is merely young; and a paused deployment
answers 402 to everything, including the shim, so a "still broken" check taken
during the pause proves nothing.

## 11. Notifications (what pings where)

Vercel's own notification settings reach the dashboard, email, push, and (spend
alerts only) SMS. Slack is its only chat integration, so Discord and Telegram
cannot be selected in the UI. The way around that is generic: Vercel will POST
any of its events to a URL we own, so `POST /hooks/vercel` on the Worker is a
short relay (Vercel → Worker → Discord).

- **Signature**: Vercel signs the raw body in `x-vercel-signature` (SHA1 HMAC
  with the webhook's secret). The route verifies it before anything else and
  answers 401 otherwise, so the public URL is useless without the secret.
- **Two streams, both configured in the Vercel dashboard**: Settings →
  **Webhooks** (account webhook; `deployment.succeeded`, `deployment.error`,
  `deployment.rollback`, …) and Settings → **Alerts** → Add Webhook (alert
  events; `alerts.triggered` carries usage anomalies, including the
  `edge_requests` metric that drained §10). The alert webhook is team-level;
  the account webhook caps at 20 per team.
- **Messages**: one short message per event (emoji, project, state or severity,
  commit or metric numbers, inspection link). Types with no formatter are
  skipped rather than guessed at, and the post disables mentions because commit
  messages are user content.
- **Failures**: a Discord error answers 502 on purpose. Vercel retries a
  non-2xx delivery, so a blip costs a retry instead of the event.
- **The email half, which works on any plan**: Vercel also emails its account
  address, and a Cloudflare zone with Email Routing already enabled can hand a
  copy to the same Discord channel with no Vercel feature involved. The zone,
  the alert address and the Worker URL are kept outside the repository (the
  Discord URL and the Worker URL already live in the local
  `.env.worker.local`), not in this document. Two switches, in this order: (1) Cloudflare, one Email
  Routing rule for the alert address → action **Send to a Worker** → this
  Worker (the `email()` handler posts the subject plus the links it finds in
  the body: no MIME library, RFC 2047 encoded subjects decoded, mentions
  disabled); (2) Gmail, a filter for `from:vercel.com` that forwards to the
  same address. Do them in that order: Gmail requires verifying the forwarding
  address once, and that verification mail reaches Discord (link and all) only
  if the rule and the deployed handler already exist. A literal address rule
  wins over the zone's catch-all, so the rest of the zone's mail is untouched.
  `EMAIL_FORWARD_TO` (optional, a verified Email Routing destination)
  additionally keeps a mailbox copy.

Secrets: `VERCEL_ACCOUNT_WEBHOOK_SECRET` and `VERCEL_ALERTS_WEBHOOK_SECRET` (each
shown once when its own Vercel-side webhook is created; they are different
secrets and the route accepts either, so one webhook can be wired before the
other) plus `DISCORD_WEBHOOK_URL` (Discord channel → Integrations → New
Webhook). Keep all three in the local, gitignored `.env.worker.local` and
install with
`pnpm wrangler secret put NAME --config workers/mabiroutine-worker/wrangler.jsonc`,
piping each value from that file; never as an argument. The same file also
carries `WORKER_URL` and the alert address used by the smoke test below, which
is what keeps this document free of the deployment's own names. Rotation is
platform-side first (Vercel regenerates the secret, or Discord a fresh URL),
then a re-put. Nothing in the repo changes.

**Plan requirement (read before the Hobby downgrade)**: the relay is ours and
plan-agnostic, but both webhook feeds are Pro features — account webhooks are
"available on Enterprise and Pro plans", and alert rules with their webhooks
are "available on Enterprise and Pro plans with Observability Plus". On Hobby
the webhook feeds sit idle, and the email half above is the replacement: deploy
failures and usage warnings reach Discord through Gmail + Email Routing
instead. A second, narrower fallback for deploy failures is a cron on this
Worker polling `GET /v6/deployments` with a token (the deployments endpoints are
not among the gated ones). What Hobby still cannot replace is the pre-pause
warning: `vercel metrics` (the §10 diagnosis command) is `payment_required`
there, so the §7 device budget and the dashboard are what bound a runaway.

To prove the wiring end to end without waiting for a real event, sign a sample
body and post it (the secret is read from the local file, never printed):

```powershell
node --env-file=.env.worker.local -e "const c=require('crypto');const b=JSON.stringify({type:'deployment.succeeded',payload:{target:'production',deployment:{name:'smoke-test',meta:{githubCommitSha:'0000000',githubCommitMessage:'relay smoke test'}}}});fetch(process.env.WORKER_URL.replace(/\/+$/,'')+'/hooks/vercel',{method:'POST',headers:{'content-type':'application/json','x-vercel-signature':c.createHmac('sha1',process.env.VERCEL_ACCOUNT_WEBHOOK_SECRET).update(b).digest('hex')},body:b}).then(r=>console.log(r.status))"
```

A 200 means Discord accepted it and the channel shows the message; 401 means the
secret differs; 503 means a secret is unset. Either webhook secret is accepted
(the command above signs with the account one). `pnpm test:worker` covers the
same contract offline, including the rejections.
