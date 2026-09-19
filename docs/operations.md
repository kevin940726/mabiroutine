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
| `*/15 * * * *` | :00/:15/:30/:45 | purple tick → fanout when a spawn is within 15 min | `purple fanout … fanned-out` / `no-spawn` / `fired-already` |
| `17 3,15 * * *` | 11:17 / 23:17 daily | Bahamut watcher → candidates → auto-apply | `purple watch … {"windows": N, "applied": bool}` |

Cron edits take ~15 min to propagate (CF-documented). Tail with
`pnpm wrangler tail --config workers/mabiroutine-worker/wrangler.jsonc`.

## 3. KV inventory (`PURPLE`, id `2c35b0732c9a4ebd8d3088824fdc9401`)

| Key | Shape | Writer |
|---|---|---|
| `purple:schedule` | `{anchorMs, windows[{startMs,endMs}], updatedAt, updatedBy, auto}` | watcher (auto, `updatedBy: "watcher"`), admin publish/promote/resume (`"admin"`), dashboard hand-edit |
| `purple:candidates` | `{windows[], observedAt, sources[]}` | watcher only, every run |
| `purple:overrides` | `{overrides[], tombstones[], updatedAt, updatedBy}` | `/admin` overrides save only |
| `purple:last-fire` | `{spawnMs}` | purple fanout (stamped only on real sends) |

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
no linkage). First purple card lands in the first 15-min tick inside the
lead window — e.g. spawn 14:38 → card 14:30 reading 預計 8 分鐘後出現
(never exactly 15: tick granularity, documented).

## 6. Admin workflows (`/admin`, helpers welcome — the page teaches itself)

1. **Verify**: open each candidate against the Bahamut search page (date,
   AM/PM, minutes) + newest replies for 延長; routine is Wednesday ~06:00.
2. **Fix one window / add / ignore**: candidate 修正/忽略 stages into
   手動覆寫 → 儲存覆寫. Routine case, no freeze.
3. **Accept all**: 採用候選 (keeps auto on).
4. **Rewrite everything**: the flap under 已發佈 (locks auto; resume to undo).
5. **Anchor drift**: edit 錨點, publish — no code push, all devices follow.

Rules of thumb on the page: unsure → don't publish; overstated windows skew
predictions LATE (miss), understated skew EARLY (wait) — err short.

## 7. Client behavior contracts (for debugging reports)

- Feed chain: live fetch > localStorage cache > hardcoded; `__mabiPurpleFeed()`
  reports `{source, updatedAt, fetchedAtMs}` in DevTools.
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
- [ ] 9/23 predicted window: dropped from verified by auto-apply until the
  announcement is parsed (accepted 2026-09-18). Why it's bounded: auto-apply
  resolves from candidates + overrides and never consults verified, so the
  hand-seeded 9/23 window vanishes at the next watcher fire — but legs tile
  forward from the anchor, so only spawns whose leg crosses 9/23 morning
  shift (the 9/24 one; 9/19–9/22 don't overlap it), and the announcement
  lands 9/22 at the latest fire before it. If hand-held future windows become
  routine, teach auto-apply to preserve published not-yet-passed windows
  candidates don't contradict.
- [ ] Freshness label (`預測更新於 …`) in the purple popover — `updatedAt`
  already travels on the feed; UI not built.
- [ ] Phase-3C crowd reports — needs frequent drift AND an active reporter
  base plus a privacy review. Not this year on current information.
- [ ] README privacy bullets (EN + zh_TW) — at official release, not before
  (endpoints + session linkage + roster snapshot are the delta over
  "progress lives in your browser").

## 9. History & rationale (read when revisiting a decision)

- Decisions and constraints: `docs/push-notifications.md` (push lanes, fanout,
  flags, matrix) + `docs/purple-hole.md` (feature decisions plus folded
  purple history: sources, cadence, gotchas, dropped options).
- Day-by-day work logs (2026-09-17/18 spikes, proofs, review rounds) lived in
  `docs/ledger/` until the 2026-09-18 fold deleted those files — full text
  recoverable from git history (e.g. `git log -- docs/ledger/server-push.md`).
  Nothing in code referenced them, so deletion changed no behavior.
