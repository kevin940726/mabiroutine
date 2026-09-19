# Push notifications — plan

Status: SHIPPED — Phase 0 (local timer), Phase 1 (server push, hourly lane),
Phases 2–3 (mobile / iOS PWA, same flow), and the purple lane are live in prod
as of 2026-09-18, all behind the 實驗性功能 flags. This doc records
constraints, decisions, and phase scope — the *why*; code maps live with the
code; day-by-day work history is in git history (the `docs/ledger/` files
were folded away 2026-09-18); runbooks in `docs/operations.md`.

## 1. Goal / non-goals

Goal: remind the user about 不祥的召喚結界 (`barrier`) ahead of the verified
in-game start at **XX:02:30 Taipei**, even when the app is closed.

Non-goals: done-state personalization (the game itself pings everyone — we do
the same), multi-task timers (eligibility list stays length 1 until proven
otherwise), quiet hours, rich media cards.

## 2. Where we are (both lanes shipped)

Local-only page timer (`src/lib/hourlyReminders.ts`,
`src/hooks/useHourlyReminders.ts`): bell on the `barrier` row → soft-ask
dialog → browser permission (with a dimmed-page "look up" coach mark, `PermissionCoachMark`, while the native prompt is live) → one collapsed card at **:00:00 Taipei**
(`EVENT_SEC_PAST_HOUR = 150`, `FIRE_LEAD_SEC = 150`), catch-up for late
opens, silence inside 30s of the start (`CATCHUP_MIN_SEC`), tap deep-links to
the row with a flash. Subscribe UX: already-granted skips all dialogs (one
tap); otherwise a 2-minute permission watcher (`waitForReminderGrant`) is
armed before prompting, so a grant landing via browser UI (Chrome
address-bar chip, site settings) auto-completes with no reload, re-tap, or
re-confirm. Subscriptions never leave the device (store v18, absent from the
sync key space). Proven limitation: closed tab = no timer.

A second lane covers 深淵的黑色坑洞 (`purple-hole`, behind its own
experimental flag — §6, full spec in `docs/purple-hole.md`, runbook in
`docs/operations.md`):
separate local subscription list (store v19 `purpleHoleReminders`), separate
card tag (`mabi-purple`, never collapses with hourly cards), 15-minute lead
before each predicted 36h15m spawn, catch-up allowed, and — unlike the hourly
lane — no silence cutoff (the card stays truthful until the spawn passes; the
hole persists, so there is no startle boundary). Since 2026-09-18 the purple
bell also subscribes a server lane (`lane=purple` rows, same triple opt-in):
unfiltered zone cards (no D1a linkage — zones, never people), skip-past-spawns
cutoff, KV fire-once guard; visibility split and bell/flag-off parity match
the hourly lane exactly.
Permission machinery (soft-ask, coach mark, watcher, denied dialog) is
shared; only the store slice and copy differ. Card names no one: title
`深淵的黑色坑洞即將出現`, body names the three zones with live minutes.

## 3. Hard constraints

### 3a. Timing — the useful window is 2 minutes

- Event XX:02:30, soft in-game ping :00, walk time ~1 min (all verified).
- Fire at :00:00 sharp to pair with the soft ping. A card landing after
  :02:00 is not "late" — it is *misleading* (sends the user to a finished
  event). Hence every server design carries a **staleness guard**: the fanout
  checks Taipei wall time and sends nothing past :02:00 (clean miss > wrong
  ping). Server clocks are UTC; Taipei is UTC+8, no DST, whole-hour offset —
  so UTC minute 0 == Taipei minute 0 and cron alignment is trivial.
- Correction (2026-09-16): an earlier draft claimed a "2.5-hour window".
  Wrong — :00 → :02:30 is 150 seconds. This single correction is why the
  trigger decision (§5 D3) favors punctuality over convenience.

### 3b. Platform — free tiers only, Hobby limits verified 2026-09

- **Vercel Hobby**: 1M fn invocations/mo, 4 CPU-hrs active CPU, 360 GB-hrs
  provisioned memory, 300s max duration, 100 GB bandwidth. Hourly cron
  expressions are **rejected on Hobby** (daily only, ±59 min jitter) — an
  external trigger is mandatory, not a preference.
- **Turso free** (per `docs/sync.md` quota §): 500M rows read / 10M rows
  written / mo. Push fanout at 1000 subs costs ~720K reads/mo (0.14%).
- **Cloudflare Workers free**: cron triggers available, 1-min granularity,
  100K req/day (we need 24). Dashboard keeps last 100 cron events;
  schedule edits take up to 15 min to propagate.
- Cost at 100–1000 subs, hourly: $0 everywhere with 100–1000× headroom on
  every meter (Vercel active CPU <0.3% — I/O wait isn't billed; bandwidth
  <1%). Cost never enters any decision below.

### 3c. Browser matrix (2026)

- Desktop Chrome/Edge: full push, SW click handling works.
- Desktop Brave (user's daily browser, in-matrix from 2026-09-17): Chromium + FCM, identical to Chrome — but requires `brave://settings/privacy` → "Use Google services for push messaging" ON. Verified: with it off GCM never connects (`gcm-internals` shows INITIALIZED, no connection) and `subscribe()` throws `AbortError: push service error`; enabling + browser restart fixed it.
- Desktop Firefox/Safari: push works; tap-through fine.
- Android Chrome/Edge/Samsung: works; battery-saver may delay while the
  browser is inactive (system setting, not fixable).
- iOS/iPadOS 16.4+: **only via Home-Screen-installed PWA**, permission from
  an in-app gesture; `clients.openWindow`/`navigate` on tap is best-effort
  (may only foreground). No private-mode, no in-app webviews, anywhere.
- WebKit forbids silent push (`userVisibleOnly: true`) — every push shows.

### 3d. Privacy — first server-side user data

Today "progress lives in your browser" is absolute. A push endpoint (+keys)
stored server-side ends that era for one narrow table. Consequences: opt-in
only (technically enforced — `pushManager.subscribe()` throws without a
grant), toggle-off deletes the row, dead endpoints pruned on 404/410, and
the README privacy bullet gets revised when Phase 1 ships (progress stays
local; endpoints disclosed).

### 3e. Permission — the grant chain is fragile

Bell tap → soft-ask dialog → browser prompt must stay one unbroken gesture
chain (Safari especially). Denials can only be undone in browser settings —
hence the soft-ask exists, plus a denied-state dialog naming the exact
settings path and a permission watcher that auto-completes when the switch
flips. Any Phase 1 subscribe flow must preserve this ordering; never call
`subscribe()` cold.

## 4. Architecture (Phase 1+)

```
CF Worker cron (0 * * * * UTC == Taipei :00)
  → staleness guard (skip past :02:00 Taipei) → read subs from Turso
    (raw /v2/pipeline over fetch) → WebCrypto send, concurrency 20,
      VAPID JWT signed once per push origin per run
```

Full-worker fanout (amendment A1, proven 2026-09-17 — spike A landed FCM
201 against a real subscription, then a rendered card on Brave): WebCrypto
covers ECDH + HKDF + AES-GCM + ES256, so the send is integration, not
hand-rolled crypto. The Vercel fanout route was never built and the
`CRON_SECRET` hop is deleted — one fewer network hop and cold start inside
the 2-minute window. Vercel keeps only the subscribe door
(`POST/DELETE /api/push/subscribe`); the worker reads the same Turso table
straight. Server card copy differs from Phase 0 on purpose: no names (the
server knows no done-state, D1) — title unchanged, body carries the start
time derived from `EVENT_SEC_PAST_HOUR`.

## 5. Decisions

- **D1 — Unfiltered bell-only fanout (2026-09-16).** No done-state lookup.
  The game pings everyone; our card reads fine done or not. Rejected: session
  linkage (2–3 extra days + joins endpoints to progress data, breaking §3d
  harder). Revisit only on real noise complaints (Phase 4).
- **D1a — Names via opt-in session linkage (2026-09-17, user directive).**
  D1's generic copy (`結界開場了，02:30 開始。`) was rejected as content-free:
  the card names undone characters like the local one. How without breaking
  §3d open: subscribe attaches the device's sync session id (only if the
  device has one — knowledge = capability, same as sync links) plus a roster
  snapshot (order + fallback names, refreshed on boot while subscribed);
  the fanout reads that session's current-bucket barrier values live and
  prints undone names, capped 3 + 等N隻 exactly like the local card.
  All-done → silence (same as local); missing/expired session → generic
  copy. Unlinking (sync off) or bell-off ends it; no new sync keys, no
  session writes from the worker (read-only — it never deletes sessions).
  Privacy delta (README bullets at ship): endpoints + linked session id +
  roster snapshot server-side, done-state read live at fire time.
- **D2 — Single-task scope (2026-09-16).** `HOURLY_ELIGIBLE_IDS = ["barrier"]`.
  Expansion is a one-line allowlist change, not a refactor.
- **D3 — CF Worker cron over GitHub Actions (2026-09-16).** Actions' signature
  failure (documented top-of-hour delays of minutes, rare queue drops) lands
  directly inside our 2-minute window and produces misleading cards; its
  60-day auto-disable on quiet public repos fails silently. CF holds :00
  within ~a minute with no disable mode. Actions' wins (in-repo YAML,
  one-click `workflow_dispatch` test fires, familiar logs) are real but don't
   survive contact with §3a. ~~Mitigation if ever reconsidered: schedule `:55`
   (dodge the herd, surrender the pairing) + staleness guard.~~ (Backup-trigger idea dropped 2026-09-18 — CF worker entirely.) The trigger is a
   swappable 10-line adapter over `/api/push/fanout` either way.
- **D4 — Staleness guard in fanout, not in trigger (2026-09-16).** Any delay
  source (trigger, cold start, retry) degrades to a clean miss. Never send
  past :02:00 Taipei.
- **D5 — Reuse Turso for subscription storage (2026-09-16).** New
  `push_subscriptions` table next to sync sessions (same region, same driver,
  `@libsql/client` already vendored). No second database. Schema sketch:
  `endpoint PK, p256dh, auth, platform, created_at, last_sent_at`.
- **D6 — Visibility split, not mode split (2026-09-16, revised 2026-09-17).**
  Both cards share one tag with `renotify: true` — running both would
  double-banner every hour. Originally the flag selected exactly one backend
  per bell (server-mode healed the local entry on sight); revised: both
  lanes stay armed and visibility decides — page visible → local fires with
  live done-state while the SW suppresses the server card; hidden/closed →
  local skips, server delivers. Exclusivity without deleting user state.
  Suppress/skip only on positive visibility (`=== "visible"` /
  `=== "hidden"`); missing API degrades to today's double-absorbed-by-tag,
  never to silence. Known sliver: a visibility transition landing exactly
   on the fire second can skip both — accepted (was documented in the
   pre-fold ledger; history in git).
- **D7 — Phase 1 is desktop only (2026-09-16).** Bounds the test matrix
  (below) while the infra proves itself. Mobile follows with zero server
  changes (Phases 2–3 are client gates + device testing).
- **D8 — One lane per cadence (2026-09-17).** Hourly and purple subscriptions
  live in separate store lists with separate card tags because their timing,
  copy, and cutoff rules differ; sharing a list would couple unrelated
  behavior. The permission flow stays shared (one implementation, lane
  parameter). Server-side, both lanes ride one worker tick (flat 15-min cron
  + arithmetic covers the irregular purple spawns — no irregular crons), and
  the worker imports `src/lib/purpleHole.ts` directly: one math module, two
  runtimes. The purple maintenance watcher, `/purple-schedule` feed, and
  `/admin` page live in the same worker; runbook in `docs/operations.md`
  (day-by-day history in git history).

## 6. Experimental gate (Phase 1 gate)

The 實驗性功能 dialog (footer, next to 重置所有資料) flips two per-device
slots: `mabiroutine:push-flag` and `mabiroutine:purple-hole-flag` (helpers
`isPushEnabled()` / `isPurpleHoleEnabled()`; writers `setPushFlag()` /
`setPurpleHoleFlag()`; toggling reloads once on close to apply). The older
query-string entry (`?push=1` / `?purple_hole=1`) was removed 2026-09-17 —
it never worked inside an installed PWA (no URL bar), and the dialog covers
every entry path.

Behavior matrix:

| Flag | Platform | Bell does |
|---|---|---|
| off (default) | any | No bell, no scheduler (zero surface) |
| on | desktop | Server push subscribe (VAPID); local entry kept, visibility decides who fires (D6) |
| on | mobile (from 2026-09-17) | Server push subscribe (VAPID), same flow; iOS requires the installed PWA (16.4+), tap-through best-effort |

Purple has its own gate with identical mechanics; the bell,
scheduler, row, and timetable all hide when off. Since 2026-09-18 its bell
subscribes a server lane too (`lane=purple`, unfiltered — the linkage
disclosure in its soft-ask is replaced by a no-linkage note; roster refresh
stays hourly-only); flag-off disarms both lanes on both flags. The two flags
compose independently (either lane testable alone).

Desktop gate (Phase 1 scaffolding): non-mobile UA heuristics — REMOVED
2026-09-17. The whole path is opt-in (experimental flag → bell tap with
linkage disclosure → OS permission), so the UA gate added no consent, only
matrix delay; the user holds a real iPhone, the scarcest test device.
Rejected alternatives: env/build flag (redeploy per tester, no prod A/B),
remote config (no infra for it). The settings-screen toggle — rejected in
D7 as premature — is now THE gate (it ships with the dialog, post-proof).
iOS PWA entry needs it too (no query params there, ever).
Store note: push subscriptions per task imply a new persisted field (likely
store v19) with the usual migrate + fixture discipline from AGENTS.md.

## 7. Phases

### Phase 0 — Local timer (SHIPPED)

### Phase 1 — Server push, desktop, flagged (SHIPPED 2026-09-18)
1. VAPID pair: `npx web-push generate-vapid-keys`, private key (JWK) to the
   worker env only (never committed); public key inlined client-side.
2. Turso `push_subscriptions` table + migration (follow `api/_db` patterns).
3. `POST /api/push/subscribe` (VAPID sub + platform; rate-limit like session
   POST), `DELETE` on bell-off; 404/410 prune inside fanout.
4. Worker hourly tick: staleness guard (§4, skip past :02:00) → Turso
   read → concurrent send (20, JWT cached per origin) → 404/410 prune +
   `last_sent_at` stamp, all in `workers/mabiroutine-worker` (imports
   timing/tag from `src/lib/hourlyReminders.ts` — one module, two runtimes).
5. `workers/mabiroutine-worker` (same repo, wrangler, `0 * * * *` + purple
   + watcher crons) deployed MANUALLY (`pnpm worker:deploy` — CI dropped
   2026-09-18; versioned deploys, never dashboard-edit per CF's own warning).
6. Client: flag gate (§6) + subscribe/unsubscribe wiring that
   preserves the §3e gesture chain; bell copy unchanged until proven.
   (Desktop UA gate removed 2026-09-17 — mobile joins the same flow.)
7. Copy: README privacy bullets (EN + zh_TW) revised per §3d — STILL OPEN,
   deferred to the official release (features remain flag-gated); CHANGELOG
   entries landed.
8. Test matrix: desktop Brave/Win (primary — daily browser), Chrome/Win, Edge/Win, Chrome/macOS — subscribe →
   wait for :00 (or trigger fanout manually with the secret) → card →
   tap → char priority + flash (§2 behavior, now via SW path). Firefox/Safari
   desktop best-effort.
- Success: 3 consecutive :00 hours, card + tap-through, zero double-fires,
  dead sub pruned on next run. Gate: manual matrix above (no harness yet).

### Phase 2 — Android push (SHIPPED — same flow, server untouched)

Server untouched (desktop gate removed 2026-09-17). Chrome Android rides the
same subscribe flow; battery-saver delays remain a system-level caveat and the
local timer is the unsupported-browser fallback.

### Phase 3 — iOS PWA push (SHIPPED 2026-09-18)

Server untouched. Permission from an in-app gesture inside the installed PWA
(16.4+), tap-through best-effort (§3c). Proven on a real iPhone: the 19:00
proof card arrived on the installed PWA and desktop in the same fire; a prod
`lane=purple` row for the iOS endpoint was confirmed 2026-09-18.

### Phase 4 — Optional hardening (only on evidence)
Done-state filtering (session linkage + consent copy per §3d), quiet hours,
~~GH Actions backup trigger,~~ eligibility-list expansion, fanout batching past
10K subs (sharding by endpoint hash, `maxDuration` bump). (Backup trigger dropped 2026-09-18 — CF worker entirely.)

## 8. Open risks (not questions — tracked, decided or deferred)

- **Night noise — decided 2026-09-17: no in-app scheduler, OS-level guidance at release.** Gaming schedules differ (night owls need night alerts), so quiet hours would be wrong per-user over-engineering. Verified: iOS installed PWA gets its own Notifications entry + Focus support (WebKit blog), Android has per-site toggles (Chrome site settings + OS app channels), installed PWAs are exempt from Chrome's 2025 notification auto-revoke. User-facing copy (per-PWA/Focus/Scheduled-Summary paths) lands in the READMEs only at official release — still experimental, not yet.
- **Flag-off leaves the server sub live** (found 2026-09-17 during the
  visibility split): turning the experiment flag off hides the bell but never
  unsubscribes — cards keep arriving (suppressed when visible, delivered when
  closed). Fixed 2026-09-18: flag-off disarms both lanes (server row DELETE +
  device unsubscribe + local entry clear, bell-off semantics; fired at toggle,
  awaited at dialog close so a fast reload can't cancel it).
- **CRON_SECRET leak/rotation**: env-only, rotate by redeploy; fanout 401s
  loudly (Vercel logs) rather than failing open.
- **Hobby fair-use**: personal-use project, traffic trivial — no action.
- **Endpoint table growth**: bounded by opt-in count; prune on 404/410 +
  180-day touch (mirror the session TTL philosophy).
- **Manual fanout double-send**: tag collapse makes redelivery idempotent-ish
  (one card, re-buzzed). Accepted.
- **Clock skew**: guard uses server clock → Taipei conversion, fixed +8.
  Vercel clock discipline is NTP-grade; non-issue, noted for completeness.
