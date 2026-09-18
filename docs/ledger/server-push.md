# Server push + purple phase 2 — plan & work ledger

Branch: `feat/push-fanout` merged into main 2026-09-17 and deleted (`feat/server-push` merged + deleted earlier). Status: Phase-1 server push proven end-to-end and fully closed on 2026-09-18 — spike routes dead live, `SPIKE_SECRET` gone, server-card tap flashes the row. Open: flag-off unsubscribe, README privacy bullets, purple feed/watcher/admin.
Companion docs: `docs/push-notifications.md` (why), `docs/purple-hole.md` + `docs/ledger/` (purple phases).
Conventions: log oldest-first (append at the end), one line per fact, no commit hashes (history gets rewritten).

## Log

- 2026-09-17: plan + ledger combined into this one file (`docs/server-push-plan.md` deleted) — they overlapped almost entirely.
- 2026-09-17: wrote the setup guide + six-alternative review (see §§0–3 below).
- 2026-09-17: branch cut from `main` (post purple-hole merge); account probed — zero Workers, greenfield.
- Pending user verdicts: (A) worker-side fanout spike before building Vercel fanout; (C) GH Actions backup promoted to Phase 1.5 after primary proves itself.
- 2026-09-17: worker named `mabiroutine-worker` (general, extensible; `-cron`/`-push` both go stale as routes grow).
- Next: spike A verdict → lock fanout location → scaffold `workers/push-cron`.
- 2026-09-17: wrangler committed as devDependency (`50842aa`); KV `PURPLE` created; `workers/mabiroutine-worker` scaffolded (fetch health + `POST /spike-send` bearer-guarded + scheduled stub) and deployed to `https://mabiroutine-worker.kaihao.workers.dev` with all 3 crons (`cc69ed1c`); verified `/` → ok, blind `/spike-send` → 401. Secrets in worker env only (never in repo): `VAPID_JWK`, `VAPID_SUBJECT`, `SPIKE_SECRET` (spike bearer, held locally, dies with the route).
- VAPID public key (client-side, safe to record): `BGaqwzh6mEVJXgQiaiYoejpOwhuaGThQl2uf1mIrGkPnzp7J9mv_j51jawf1PZPknuOVnezz6qNHLV2iojNuE2Y`. Private never leaves worker env.
- Spike A pending one user action: paste a real test subscription (snippet in the next log entry) → fire `/spike-send` → confirm the card.
- 2026-09-17: Brave diagnosed — `gcm-internals` showed GCM enabled but no connection; `brave://settings/privacy` → "Use Google services for push messaging" ON + restart fixed it. Brave joins the Phase-1 desktop matrix as primary (daily browser); matrix + onboarding note recorded in `docs/push-notifications.md` §3c/§7.
- 2026-09-17: spike A first fire failed — FCM 400, body 4182 > 4096 (86-byte header + 4096 record). Fixed RS 4096 → 4000 in `src/index.ts`. Second fire (after a self-inflicted mangled-key 500, resent with the exact subscription) → **FCM 201**. Verdict A: **ADOPT full-worker fanout** — VAPID + aes128gcm in WebCrypto proven against the real push service; the Vercel fanout route never gets built. Display caveat: prod SW has no `push` listener yet (only `notificationclick`), so this card renders as the browser's generic fallback until the Phase-1 client adds `showNotification` to `sw-push.js`.
- 2026-09-17: `push` listener added to `public/sw-push.js` (payload `{title, body, tag, url?, task?, chars?}` → `showNotification` with the Phase-0 contract: collapse tag, `renotify: true`, auto-dismiss, data passthrough for the existing deep-link click handler). Branch-only until merge + prod push updates the SW on-device.
- 2026-09-17: new branch `feat/push-fanout` for the real fanout (Turso subs + subscribe API + client wiring + scheduled-tick fanout, then delete `/spike-send`). Old branch merged + deleted. Stale `feat/hourly-reminders-mvp` + `feat/purple-hole` pruned.
- 2026-09-17: storage + API done, verified live against the user's `dev:api` (agent background launches don't survive tool calls — user runs it): migration v2 `push_subscriptions` (endpoint PK, lane, platform, timestamps), `Db` + both drivers + fallback delegation, `POST/DELETE /api/push/subscribe` (upsert, idempotent delete, https + key-shape + lane-allowlist 400s, per-IP budget). Matrix: valid → 200, repeat → 200 (same row), bad endpoint/lane/key → 400, delete ×2 → 200; row count 1 after POST, 0 after DELETE.
- 2026-09-17: **real card confirmed on Brave** — post-deploy SW reload + `/spike-send` re-fire rendered `測試通知 — mabiroutine-worker` with body text. Full loop proven: worker crypto → FCM 201 → device → rendered card. Spike A closed; `/spike-send` stays until the real fanout replaces it. Also confirmed to user: regular users receive nothing (flag-gated local lanes, no server fanout, no stored subscriptions, inert SW listener).
- 2026-09-17: worker fanout built + deployed: hourly tick reads Turso over raw `/v2/pipeline`, `:02:00` staleness guard → clean miss, concurrency-20 sends with per-origin JWT cache, 404/410 prune + `last_sent_at` in one write batch. Timing/tag imported from `src/lib/hourlyReminders.ts` (`secIntoHour` newly exported — one module, two runtimes). Server card copy: title unchanged, body carries the start time derived from `EVENT_SEC_PAST_HOUR` (no names — D1). `POST /fanout-test` (bearer, temporary) exercises the path on demand. Plan §4 + secrets table updated for verdict A.
- 2026-09-17: prod Turso seeded by hand (throwaway script, deleted after): exact v2 DDL + the user's Brave sub as one hourly row — provable before the migration code deploys (`ensureSchema` converges via `IF NOT EXISTS` + version bump, no conflict). Live proof left to the clock: the deployed cron fires ~16:00, real card expected. Verdict pending what the user sees.
- 2026-09-17 CORRECTION — the 16:00 "proof" was contaminated, three bugs behind it: (1) `TURSO_AUTH_TOKEN` was stored with surrounding quotes (pwsh captured the `.env.local` quoting) → every worker→Turso call died with `JWT error: Base64 error: Invalid symbol 34` — the fanout NEVER read Turso, so it could not have sent; (2) pipeline args must be explicitly tagged (bare strings 400; the bare `now` would have killed the write batch next); (3) the success response type is `"execute"`, not `"execution"` (my strict check would have thrown on success). Fixed 2+3 in code, re-put the token stripped, `/db-test` now stamps + reads back equal — worker↔Turso proven both directions. The 16:00 card the user saw was most likely the LOCAL lane (same title + same icon, page presumably open; body text never confirmed). Clean re-test at 17:00: user closes ALL site tabs (dead local timer — SW push still arrives) and checks the BODY (`結界開場了，02:30 開始。` = server, names = local). Standing rule learned: masked statuses (`turso ${status}`) cost an hour — worker now throws sqld's own error text.
- 2026-09-17: tap-through diagnosed — the page hook consumes `?task=`/`?chars=` only on mount, so a tap that merely focuses an open window (the usual desktop case) silently does nothing; likely why taps "never worked" on the user's machine. Fixed with a postMessage second channel (SW tells every open client; page listener resolves + flashes, no reload needed). Test: reload site (new SW), tap any reminder card with the site open.
- 2026-09-17: D1 overturned on user directive (generic copy rejected) → D1a: opt-in session linkage for named cards. Built, uncommitted: migration v3 (`link_session`, `roster_json`; ALTER-no-retry documented), `Db` + both drivers + fallback, subscribe API (UUID + roster-shape 400s, created/last-sent preserved across upserts), client (link + roster snapshot at subscribe, silent boot refresh, server soft-ask with linkage disclosure), worker `resolveNamedCard` (live session read, max-bucket rule instead of ported reset math, local-identical cap/format, all-done silence, any-failure → generic). v3 API verified live (linked 200 persisted, bad link/roster 400, test row cleaned).
- 2026-09-17: prod row linked for the 18:00 named proof (user-supplied session + 5-char roster). Hand-applied v3 ALTERs hit the documented hazard in reverse — prod `_schema_version` was still 1, so deploy-time ensureSchema would have re-run the ALTERs into duplicate-column errors. Fixed by bumping the marker 1→3 by hand (truthful: v2 table + v3 columns both exist; verified all 9 columns). All hand-SQL via throwaway scripts, deleted after each use; working tree kept clean.
- 2026-09-17: iOS PWA opt-in investigated — `?push=1` is a dead end inside the installed app (no URL bar to type it; Safari-set localStorage may not transfer to the PWA store), so Phase 3 needs an in-app toggle on the existing prefs surface (D7's "premature UI" rejection is stale once push is proven). Vercel Flags evaluated and rejected: Next.js/SvelteKit-only SDK + toolbar QA overrides solve rollouts, not PWA entry — and Edge Config would just reduplicate what KV already does. No new infra; the toggle writes the same localStorage keys the query param does.
- 2026-09-17: built on `feat/exp-settings` — 實驗性功能 dialog in the footer next to 重置所有資料 (`ExpSettingsDialog.tsx`, Radix dialog like the sync dialogs): two tracker-style checkbox rows (開場提醒 / 紫洞追蹤) with an experimental-only warning line, toggling writes the same flag slots via new `setPushFlag` / `setPurpleHoleFlag` setters then reloads (flags are read-once gates — reload is the honest apply). Build green.
- 2026-09-17: query-string entry removed entirely (dialog replaces it): `is*Enabled()` drop the URLSearchParams sync (also removes a render-time storage write), alert + comments repointed at the dialog, §6 rewritten around the dialog gate, purple-hole/tracker-data/ledger-guide references updated. History (CHANGELOG past entries, ledger log lines) left alone. Existing opt-ins carry over — same slots. — user left prod + dev tabs open: names card (local lane, same title+icon as suspected for 16:00) AND `結界開場了` card (server fanout, first true server send). Server path fully proven: cron → Turso read → guard → send → display. Bonus: D6 stacking observed live (double banner) — exactly what the client heal prevents once it ships. Phase-1 gate: 1 of 3 consecutive :00s; tap-through on the server card still untested.

- 2026-09-17: 18:00 named proof CONFIRMED — server card body carried the 3 undone chars' names, full with no truncation (5-char roster, 2 done). D1a linkage proven end-to-end: subscribe snapshot → live session read → resolveNamedCard → named body on device. Phase-1 gate: 2 of 3 consecutive :00s; tap-through still untested.

- 2026-09-17: desktop UA gate lifted (`isServerPushMode` drops `isDesktop`; `HOURLY_MOBILE_NOTE` + dead branch removed). User approved early open — path is triple opt-in so the gate added no consent. iPhone PWA re-taps the bell → real `ios` row → next :00 proves closed-app card on iOS. Server needed zero changes (ios/android already allowlisted, fanout has no platform filter).

- 2026-09-17: 19:00 iOS proof CONFIRMED — server card arrived on the installed iPhone PWA AND desktop in the same fire. Gate-lift → bell re-tap → real `ios` row → closed/open-app delivery, all in one hour. Phase-1 gate: 3 of 3 consecutive :00s (17:00 generic, 18:00 named, 19:00 cross-device). Remaining before fanout merge: tap-through test (either device), then delete `/spike-send` + `/fanout-test` + `/db-test` and `SPIKE_SECRET`.

- 2026-09-17: tap "focus but no flash" root-caused — worker nested deep-link fields under `data`, SW contract reads them top-level (`sw-push.js:3`), so `notification.data` carried all-undefined on every server card: no params, message dropped, focus only. Fixed worker-side (flattened, contract comment added); SW untouched. Retest at 20:00 fire. Note: `/fanout-test` can't prove this off-hour (the staleness guard inside `runBarrierFanout` clean-misses past :02), so the :00 fire is the test.

- 2026-09-17: night-noise decided — no in-app quiet-hours scheduler (per-user gaming schedules; night owls need night alerts). OS-level per-app control verified (iOS PWA own entry + Focus, Android per-site, PWA auto-revoke exempt); user-facing copy deferred to official release, not README yet. Recorded in `docs/push-notifications.md` §8.

- 2026-09-17: purple 15-min cadence challenged and kept — tick teaches nothing (deterministic math), frequency buys only lead precision in (L, L+I]; 13-min despawn bounds lateness, not lead; 96 ticks/day is free-tier dust. Locked 15/15 in the phase-2 doc; revisit on evidence only.

- 2026-09-17: purple 2A built (taipeiWall + predicted 9/23 06:00–08:30 entry, errs short); 2D override designed then dropped per user correction — announcement read is canonical, emergencies go code-edit + push. Recorded in the phase-2 ledger.

- 2026-09-17: spike routes deleted from code (`/spike-send` + `/fanout-test` + `/db-test`, `bearerOk`, `SPIKE_SECRET` env field — fetch is health + scheduled only). NOT yet live: worker redeploy + `SPIKE_SECRET` env delete pending the next push. Push track closes then.

- 2026-09-17: visibility split replaces the D6 heal — both lanes stay armed, visible → local fires (SW suppresses on positive `visibilityState === "visible"`), hidden → local skips (page guards on positive `"hidden"`), server delivers; unsubscribe now disarms both. D6 rewritten, WebKit `visibilityState` recorded unverified (safe fallback both sides: missing API degrades to tag-collapse doubles, never silence). Found while building: flag-off leaves the server sub live (tracked §8, fix parked). Generic body drops the MM:SS (`02:30` read as 2:30 AM); unlinked copy decided as `JJ！` (結界 initials, in-joke).

- 2026-09-17: `feat/push-fanout` merged to main and deleted — subscribe API (v2 table + v3 linkage columns), server bell, D1a named cards, postMessage tap channel all on main. Desktop gate already gone, so mobile rides the same flow with zero server changes.
- 2026-09-17: spike routes deleted in code (fetch is health + scheduled only). Live redeploy + `SPIKE_SECRET` env delete are unverifiable from the repo — confirm via `wrangler secret list` + dashboard before closing the push track.
- 2026-09-17: 20:00 tap-retest (flattened top-level `url`/`task`/`chars`) was named as the test — its outcome was never recorded in this ledger. Code on main matches the SW contract; treat the retest as unconfirmed until a :00 server-card tap flashes the row.
- 2026-09-18: code-verified on main — zero references to `/spike-send`, `/fanout-test`, `/db-test`, `SPIKE_SECRET`, `bearerOk`; worker carries the staleness guard, tagged pipeline args, `resolveNamedCard` (live session read, all-done silence, failure → generic), 404/410 prune + `last_sent_at` batch, per-origin JWT cache; subscribe API allowlists one lane (`hourly`) + six platforms with UUID/roster-shape 400s; SW has the `push` listener (visible-suppress + postMessage second channel); `isServerPushMode` is flag-only (`HOURLY_MOBILE_NOTE` gone); 實驗性功能 dialog mounted in the footer. Still open: redeploy liveness, 20:00 outcome, Phase-1.5 Actions backup (no `.github/` in repo), flag-off unsubscribe (parked), README privacy bullets (deferred to release per §8), purple `/purple-schedule` + watcher + `/admin` (worker non-hourly crons still stub).
- 2026-09-18: push track CLOSED — live probe confirmed the spike routes dead (`/spike-send`, `/fanout-test`, `/db-test` all 404, `GET /` healthy) and `SPIKE_SECRET` absent from the worker env. Fetch is health + scheduled only, in code and live.
- 2026-09-18: server-card tap retest PASSED — :00 fire tapped with the app open focuses the window and flashes the barrier row. Flattened top-level `url`/`task`/`chars` proven on device; the focus-without-flash bug is gone.
- 2026-09-18: GH Actions backup DROPPED — the CF worker is the entire trigger story (no second trigger, no CI deploy pipeline). §§2C/3.5 struck accordingly; `CLOUDFLARE_API_TOKEN` never needed.
- 2026-09-18: phase-3A recalibrate button DROPPED — anchor fixes go through the admin feed only (B-if-burden, C-on-evidence); per-device override judged unnecessary complexity. Phase-3 doc + `purple-hole.md` + phase-2 backstop updated.
- 2026-09-18: flag-off unsubscribe BUILT — `ExpSettingsDialog` disarms both lanes on push flag-off (server row DELETE + device unsubscribe + local `barrier` entry clear, bell-off semantics; fired at toggle, awaited at close so a fast reload can't cancel the DELETE). §8 parked-fix closed.
- 2026-09-18: purple feed + watcher BUILT in code (not yet live): timetable parameterized behind an active snapshot (anchor + windows, all callers follow with no changes), `GET /purple-schedule` (KV doc, CORS *, 60s cache, hardcoded fallback), client chain (boot cache + async refresh, timer re-arm on change, `__mabiPurpleFeed()`), watcher cron parsing the live Bahamut page (8 mentions → 7 unique windows, 0.35ms; probe caught a group-index slip first — every end read 12:00 — fixed, 15/15). Pending: CF-egress proof only (client proven on dev 2026-09-18 — `__mabiPurpleFeed()` reads live with the seed timestamp; deploy after the 03:17 UTC fire, so the first watcher run under the new bundle is 15:17 UTC — `purple:candidates` absent until then, expected).
- 2026-09-18: `/admin` editor + purple server lane BUILT in code (not yet live, same deploy): all five admin routes (verify/state/publish/promote, bearer `ADMIN_SECRET`, strict-gate publish, promote preserves anchor) + purple bell server-subscribe (`lane=purple` rows, unfiltered zone cards, skip-past-spawns cutoff, KV fire-once guard) + bell/flag-off parity for the purple lane (reconcile, soft-ask copy, bell-off + flag-off disarm both lanes). Also fixed: subscribe API stored `lane: "hourly"` always (validated lane now stored). Probed 16/16 (admin auth/validation/promote, fanout send → fired-already → no-spawn, real WebCrypto encrypt; `subtle.timingSafeEqual` shimmed — node lacks it, deploy-time check: wrong secret 401s). Pending with the same deploy: `ADMIN_SECRET` put + admin round-trip proof + a purple bell re-tap proving the first server card.
- 2026-09-18: review fixes on the lane commit (all in code): composite `(endpoint, lane)` key via v4 rebuild migration (endpoint-only PK let one lane steal the other's row; legacy rows converge, no hand-SQL — ensureSchema upgrades prod on next deploy, unlike the v3 marker incident) + scoped upsert/delete/stamp in both drivers, API, and both fanouts; bell-off keeps the shared device sub while the other lane references it; `/admin` absolute API paths (relative resolved to `/api/*` → every call 404); fire-once guard stamps only on real sends (transient failures retry next tick). Probed: v4 migration 5/5, worker 19/19, API dual-lane live (two rows coexist, scoped delete keeps purple, legacy delete clears all, test rows cleaned).
- 2026-09-18: watcher auto-apply + admin restyle (in code): each watcher run overwrites verified windows when candidates are non-empty (reverses never-auto-truth; anchor stays manual, empty never wipes); manual publish locks auto (extension fixes persist), promote keeps it, new resume endpoint re-resolves immediately; admin page shows auto/locked badge. Admin page restyled (shadcn-look, Taipei previews per input, candidate cards, two-tap publish). Probed 26/26.
- 2026-09-18: per-window overrides (in code, answers the lock-freeze challenge): KV `purple:overrides` (overrides + tombstones) resolved per run — replace-by-startMs, unmatched append, tombstone suppress, past + unobserved records expire. One `resolveAndStore` path serves watcher/overrides-save/resume; new `POST /admin/api/overrides` (full-replace, strict) + 手動覆寫 card with per-candidate 修正/忽略 staging. Also corrected: spent candidate windows are NOT inert (legs tile from anchor — pruning un-does real pauses); only pre-anchor windows are. Probed 34/34.
- 2026-09-18: review fixes round 2 (all in code): promote routes through the shared resolve (it wrote raw candidates, so a curated override silently dropped out of verified and flip-flopped back next run); lane-less DELETE stays full-endpoint — a stale pre-lane tab's bell-off clears both lanes, which matches its "stop everything" intent and self-heals via reconcile + re-tap.

## 0. What you need (checklist)

Cloudflare side (all free tier, $0):

- [x] Cloudflare account (email signup, no card for free plan).
- [x] A `*.workers.dev` subdomain (claimed at first deploy — `mabiroutine-worker.kaihao.workers.dev`; our only public surface besides API routes — no custom domain needed).
- [x] `wrangler` (devDependency, committed 2026-09-17).
- [x] One Worker: `mabiroutine-worker` (decided 2026-09-17 — `-cron`/`-push` both go stale as routes grow) — hourly barrier fanout live; `/purple-schedule` + watcher + `/admin` + purple fanout built in code 2026-09-18, deploy + `ADMIN_SECRET` + KV seed pending.
- [x] One KV namespace: `PURPLE` (keys `purple:schedule`, `purple:candidates`). Created; seeding waits on the purple feed (day-one editing in the dashboard, no code).
- [x] Secrets, set via `wrangler secret put` (never committed, never in Vercel): `VAPID_JWK` + `VAPID_SUBJECT` + `TURSO_DB_URL`/`TURSO_AUTH_TOKEN` live in the worker env (`CRON_SECRET` died with verdict A — no worker→Vercel hop; `ADMIN_SECRET` waits on the `/admin` page; `SPIKE_SECRET` dies with the routes — env deletion to confirm).

Vercel/Turso side (existing infra):

- [x] VAPID pair generated once — private key as `VAPID_JWK` in the worker env only (never committed); public key inlined client-side (recorded in the log above).
- [x] Turso migration: `push_subscriptions(endpoint PK, p256dh, auth, platform, lane, created_at, last_sent_at)` v2 + `link_session`/`roster_json` v3 via `api/_db` patterns (additive, idempotent).
- [x] Subscribe door: `POST/DELETE /api/push/subscribe` (upsert, idempotent delete, shape 400s, per-IP budget). No Vercel fanout route, no `CRON_SECRET` hop — verdict A.
- ~~[ ] GitHub repo secrets for CI deploys: `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` (no `.github/` in repo — deploys are manual `wrangler deploy` for now).~~ Dropped 2026-09-18 with the backup — deploys stay manual (`pnpm worker:deploy`), no CI, no token.

Local machine: Node + pnpm (already have), `wrangler login` (browser OAuth once), `openssl rand -hex 32` for secret generation.

## 1. Full setup guide (Cloudflare, step by step)

1. **Account.** Sign up at cloudflare.com, verify email. No plan selection needed — Workers Free is default.
2. **Wrangler.** `pnpm add -D wrangler`, then `pnpm wrangler login` (opens browser, stores OAuth token locally — never commit `~/.wrangler`).
3. **Scaffold.** `workers/push-cron/` in-repo: `src/index.ts` (`export default { fetch, scheduled }`), `wrangler.jsonc`:
   ```jsonc
   {
     "name": "mabiroutine-worker",
     "main": "src/index.ts",
     "compatibility_date": "2026-09-01",
     "observability": { "enabled": true },
     "triggers": { "crons": ["0 * * * *", "*/15 * * * *", "17 3,15 * * *"] },
     "kv_namespaces": [{ "binding": "PURPLE", "id": "<kv-id>" }]
   }
   ```
   Cron meanings (UTC == Taipei minute, +8 fixed, no DST): `0 * * * *` hourly barrier tick, `*/15 * * * *` purple spawn check (flat 15-min + arithmetic covers the 36h15m cycle — no irregular crons), `17 3,15 * * *` Bahamut watcher 2×/day. Expect up to ~15 min propagation on cron edits (CF-documented).
4. **KV.** `pnpm wrangler kv namespace create PURPLE` → paste `id` into `wrangler.jsonc`. Seed `purple:schedule` once via dashboard (anchor + empty windows) so `/purple-schedule` serves from minute one.
5. **Secrets.** `pnpm wrangler secret put CRON_SECRET`, `ADMIN_SECRET` (generate with `openssl rand -hex 32`). Verify with `wrangler secret list`.
6. **Implement (order matters — each step deploys independently):**
   a. ~~Dumb hourly tick: `scheduled()` on `0 * * * *` → `POST https://<app>/api/push/fanout` with `Authorization: Bearer CRON_SECRET`.~~ SUPERSEDED by verdict A (never built) — the worker's own `scheduled()` on `0 * * * *` runs `runBarrierFanout` directly (staleness guard → Turso read → concurrent send → prune + stamp).
   b. `GET /purple-schedule` (public, CORS `*`, `max-age=60`) serving the KV doc.
   c. Purple 15-min tick: import `src/lib/purpleHole.ts` directly (DOM-free pure math — one module, two runtimes) → spawn within 15 min → purple fanout.
   d. Watcher cron → fetch Bahamut search URL → regex windows into `purple:candidates` (never auto-truth).
   e. `/admin` routes per `docs/ledger/purple-hole-admin-page.md` (verify/state/publish/promote, native datetime-local form).
7. **Deploy.** `pnpm wrangler deploy` from repo root (versioned deploys; never dashboard-edit code — CF's own warning). Claim the `workers.dev` subdomain on first deploy.
8. ~~**CI.** GitHub Actions: `wrangler deploy` on push to main with `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`. Pin wrangler version; deploys only from main (branch pushes preview nothing — workers have no preview env unless configured).~~ Dropped 2026-09-18 — manual deploys only.
9. **Verify.** Dashboard → Workers → Triggers shows next run; `wrangler tail` streams live logs; local cron testing via `wrangler dev --test-scheduled` (exposes `/__scheduled`). (No `/api/push/fanout` manual-test route was ever built — verdict A; the temporary `/fanout-test` died with the spike routes.)
10. **Vercel side (built).** `/api/push/subscribe` (POST rate-limited, DELETE on bell-off; no fanout route — verdict A). Client: 實驗性功能 dialog gate + subscribe wiring preserving the gesture chain (§3e). (Desktop gate removed 2026-09-17 — mobile rides the same flow.)
11. **Dashboard hygiene.** Cron dashboard keeps last 100 events only — keep a local log of manual test fires (date, result) in this doc's appendix while proving Phase 1.

## 2. Plan review — alternatives considered

Verdict up front: **the recorded plan stands, with two amendments** (A-spike, C-backup). Update 2026-09-18: **A decided — full-worker fanout adopted** (FCM 201 + rendered card + 3/3 :00s; `CRON_SECRET` and the Vercel fanout route never existed); **C dropped 2026-09-18 — CF worker entirely, no backup trigger, no CI pipeline.** Detail:

### A. Fanout location: Vercel Node fn (recorded) vs full-Worker fanout (challenger) — SPIKE FIRST

- Recorded (§4): Worker is a dumb scheduler → Vercel Node fn does VAPID + aes128gcm via `web-push`, because "hand-rolling SubtleCrypto in the Worker is risk for zero gain".
- Challenger: do the send inside the Worker. WebCrypto has everything needed (ECDH + HKDF + AES-GCM + ES256 signing), and maintained CF-compatible senders exist — so it's integration work, not crypto hand-rolling. Payoff is real: it removes one network hop + one cold start from inside the **2-minute useful window**, plus the `CRON_SECRET` hop entirely; the staleness guard then lives next to the trigger.
- Cost of challenger: subscription storage must be Worker-readable. Turso-over-HTTP (`@libsql/client/web` is fetch-based — works from Workers) keeps the recorded D5; or colocate subs in D1/KV for lower read latency (KV: 100k reads/day free = ~4k subs at 24 ticks/day; D1: 5M rows read/day — both headroom-ample).
- **Recommendation: 1-afternoon spike before Phase 1 code** — worker-side send to one real test subscription (proves Bahamut-egress-style unknowns don't apply to push endpoints, proves CPU fits in the 10ms budget; cron invocations allow up to 15 min CPU on paid, 30s default — plenty either way). If the spike passes, adopt full-Worker fanout and delete the Vercel fanout route from the plan; if it fights back, fall back to the recorded split with no shame — it's proven boring.

### B. Subscription storage: Turso (recorded) vs KV/D1 — KEEP TURSO unless A wins

- Turso `push_subscriptions` reuses region, driver, and migration patterns already in `api/_db`. No second database, no new dashboard. At 100–1000 subs the quota cost is noise either way.
- KV would force `list()` pagination in fanout and eventual-consistency reads after subscribe (a user subscribing at :59 might miss :00 — real UX edge); D1 is nicer than KV but is still a second store. Neither beats "the store we already run" without the colocation argument from A.

### C. Trigger reliability: CF cron (recorded) vs GH Actions (rejected) — ~~ADD BACKUP, don't relitigate~~ DROPPED 2026-09-18, CF worker entirely

- D3's reasoning stands (Actions top-of-hour delays land inside the 2-min window; 60-day auto-disable fails silently). But new evidence cuts the other way too: **CF had a ~56h cron-degraded incident Sep 2026** (triggers delayed or dropped, config propagation slow). Single-trigger dependency either way is the actual risk.
- ~~**Recommendation: keep CF cron primary, promote the Phase-4 "GH Actions backup trigger" to Phase 1.5** — same `/api/push/fanout` adapter (10-line YAML, scheduled `:55` to dodge the herd per the recorded mitigation), staleness guard makes double-fires collapse into one card via tag. Cheap insurance against a recurrence; build it the week primary proves itself, not before.~~ **Dropped 2026-09-18** — CF worker is the entire trigger story; the Sep-2026 cron-degraded incident is accepted as residual risk, no second trigger.

### D. Push vendor: standard Web Push/VAPID (recorded) vs OneSignal/FCM wrapper — STANDS

- Wrappers add SDK weight, a third-party data share (worse §3d posture: endpoint + browsing behavior vs endpoint-only), and vendor lock for zero gain at our scale. Rejected, no spike needed.

### E. Purple feed + admin: KV + dashboard → `/admin` (recorded) vs gist/R2/Turso — STANDS

- Gist already dropped (third-party host for no reason); R2 is object storage for a 1KB doc; Turso would drag app-DB creds into the worker. KV's 1k writes/day vs our ~4/day is 250× headroom; the dashboard-is-the-day-one-CMS insight removes all CMS code. The only addition: document the **dashboard-edit JSON shape** next to the key names (already required by the admin spec's fallback clause) so a phone edit can't fat-finger the schema — the `/admin` form's validation fixes this permanently when it lands.

### F. Watcher placement: Worker cron (recorded) vs Vercel cron vs local script — STANDS (Worker)

- Vercel Hobby allows daily crons only — 2×/day is impossible without upgrade, killing Vercel placement outright. Local script works (matches fetcher discipline) but needs a human-run schedule; the worker cron is 2 extra lines once the worker exists. Bahamut-from-CF-egress is the one unverified bit — folded into the §1 step-6d spike (if blocked, watcher degrades to local script + dashboard paste, feed contract unchanged).

## 3. Build order on this branch

1. ~~Spike A (worker-side push to one test sub) → record verdict here, then lock fanout location.~~ Done 2026-09-17 — verdict A adopted.
2. ~~`workers/push-cron` scaffold + hourly tick + CI deploy (barrier Phase 1 infra).~~ Done 2026-09-17 except CI (`workers/mabiroutine-worker` + hourly tick live; deploys manual, no `.github/`).
3. Vercel: ~~VAPID + Turso table + subscribe/fanout (or subscribe-only if A wins) + client wiring + README privacy bullets.~~ Done except README privacy bullets (subscribe-only per A + client wiring shipped; bullets deferred to release per `push-notifications.md` §8).
4. Purple: `/purple-schedule` + KV seed → client fallback chain (KV > hardcoded) → 15-min tick + purple fanout → watcher + candidates → `/admin` (phase-2/3 feed pieces are independent and can interleave; per-device corrections dropped — D 2026-09-17, recalibrate A 2026-09-18 — admin publishes). — Unstarted (worker non-hourly crons still stub; specs in `docs/ledger/purple-hole-*.md`).
5. ~~Phase-1.5 Actions backup trigger (after primary proves 3 consecutive :00s). — Due now (3/3 proven 2026-09-17), unstarted.~~ Dropped 2026-09-18 — CF worker entirely.

## Appendix — secrets inventory

| Secret | Lives in | Sees it | Rotate by |
|---|---|---|---|
| ~~`CRON_SECRET`~~ | deleted with verdict A (no worker→Vercel hop left) | — | — |
| `ADMIN_SECRET` | CF worker env only | admin browser (sessionStorage) | `wrangler secret put` + re-login |
| VAPID private (`VAPID_JWK`) | CF worker env only | fanout sender | regen pair + resubscribe all |
| `VAPID_SUBJECT` | CF worker env only | push services (contact) | `wrangler secret put` |
| `TURSO_DB_URL` / `TURSO_AUTH_TOKEN` | CF worker env only (copied from `.env.local`, never committed) | worker fanout reads | re-copy + `wrangler secret put` (token is full-access — Turso issues no read-only tokens at our tier) |
| ~~`SPIKE_SECRET`~~ | deleted with the routes 2026-09-17 (code); env absence confirmed live 2026-09-18 — track closed | — | — |
| ~~`CLOUDFLARE_API_TOKEN`~~ | dropped 2026-09-18 with the backup — no CI, no token | — | — |
| Turso creds | Vercel env (existing) | subscribe route | existing rotation |
