# Server push + purple phase 2 — plan & work ledger

Branch: `feat/push-fanout` (cut 2026-09-17 from main post-release; `feat/server-push` merged + deleted). Status: real fanout build, unstarted.
Companion docs: `docs/push-notifications.md` (why), `docs/purple-hole.md` + `docs/ledger/` (purple phases).
Conventions: log newest-first, one line per fact, no commit hashes (history gets rewritten).

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
- 2026-09-17: new branch `feat/push-fanout` for the real fanout (Turso subs + subscribe API + client wiring + scheduled-tick fanout, then delete `/spike-send`). Old branch merged + deleted.
- 2026-09-17: **real card confirmed on Brave** — post-deploy SW reload + `/spike-send` re-fire rendered `測試通知 — mabiroutine-worker` with body text. Full loop proven: worker crypto → FCM 201 → device → rendered card. Spike A closed; `/spike-send` stays until the real fanout replaces it. Also confirmed to user: regular users receive nothing (flag-gated local lanes, no server fanout, no stored subscriptions, inert SW listener).

## 0. What you need (checklist)

Cloudflare side (all free tier, $0):

- [ ] Cloudflare account (email signup, no card for free plan).
- [ ] A `*.workers.dev` subdomain (claimed at first deploy; our only public surface besides API routes — no custom domain needed).
- [ ] `wrangler` (CLI; `pnpm add -D wrangler`, or npx — repo has no wrangler yet).
- [ ] One Worker: `mabiroutine-worker` (decided 2026-09-17 — `-cron` would lie once it serves `/purple-schedule` + `/admin`; bare `mabiroutine` collides with the app itself) — cron + `/purple-schedule` + `/admin` + watcher, all in one worker per the combined architecture.
- [ ] One KV namespace: `PURPLE` (keys `purple:schedule`, `purple:candidates`). Day-one editing happens in the dashboard, no code.
- [ ] Three secrets, set via `wrangler secret put` (never committed, never in Vercel):
  `CRON_SECRET` (worker→Vercel bearer), `ADMIN_SECRET` (admin page bearer), VAPID private key only if fanout moves into the worker (alt A below decides this).

Vercel/Turso side (existing infra):

- [ ] `npx web-push generate-vapid-keys` once — private key to Vercel env, public key inlined client-side.
- [ ] Turso migration: `push_subscriptions(endpoint PK, p256dh, auth, platform, created_at, last_sent_at)` via `api/_db` patterns (additive, idempotent, like `schema.ts`).
- [ ] Vercel env: `CRON_SECRET`, `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT` (mailto:). Preview + Production.
- [ ] GitHub repo secrets for CI deploys: `CLOUDFLARE_API_TOKEN` (Workers deploy-scoped token) + `CLOUDFLARE_ACCOUNT_ID`.

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
   a. Dumb hourly tick: `scheduled()` on `0 * * * *` → `POST https://<app>/api/push/fanout` with `Authorization: Bearer CRON_SECRET`. ~10 lines, the current plan's D3/D4.
   b. `GET /purple-schedule` (public, CORS `*`, `max-age=60`) serving the KV doc.
   c. Purple 15-min tick: import `src/lib/purpleHole.ts` directly (DOM-free pure math — one module, two runtimes) → spawn within 15 min → purple fanout.
   d. Watcher cron → fetch Bahamut search URL → regex windows into `purple:candidates` (never auto-truth).
   e. `/admin` routes per `docs/ledger/purple-hole-admin-page.md` (verify/state/publish/promote, native datetime-local form).
7. **Deploy.** `pnpm wrangler deploy` from repo root (versioned deploys; never dashboard-edit code — CF's own warning). Claim the `workers.dev` subdomain on first deploy.
8. **CI.** GitHub Actions: `wrangler deploy` on push to main with `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`. Pin wrangler version; deploys only from main (branch pushes preview nothing — workers have no preview env unless configured).
9. **Verify.** Dashboard → Workers → Triggers shows next run; `wrangler tail` streams live logs; local cron testing via `wrangler dev --test-scheduled` (exposes `/__scheduled`). Manual fanout test: `curl -X POST /api/push/fanout -H "Authorization: Bearer $CRON_SECRET"`.
10. **Vercel side.** Add `/api/push/subscribe` (POST rate-limited like session POST, DELETE on bell-off), `/api/push/fanout` (bearer check → Taipei staleness guard, skip past :02:00 → batched `web-push` send, concurrency 20–50, JWT signed once per run). Client: `?push=1` gate + desktop gate + subscribe wiring preserving the gesture chain (§3e).
11. **Dashboard hygiene.** Cron dashboard keeps last 100 events only — keep a local log of manual test fires (date, result) in this doc's appendix while proving Phase 1.

## 2. Plan review — alternatives considered

Verdict up front: **the recorded plan stands, with two amendments** (A-spike, C-backup). Detail:

### A. Fanout location: Vercel Node fn (recorded) vs full-Worker fanout (challenger) — SPIKE FIRST

- Recorded (§4): Worker is a dumb scheduler → Vercel Node fn does VAPID + aes128gcm via `web-push`, because "hand-rolling SubtleCrypto in the Worker is risk for zero gain".
- Challenger: do the send inside the Worker. WebCrypto has everything needed (ECDH + HKDF + AES-GCM + ES256 signing), and maintained CF-compatible senders exist — so it's integration work, not crypto hand-rolling. Payoff is real: it removes one network hop + one cold start from inside the **2-minute useful window**, plus the `CRON_SECRET` hop entirely; the staleness guard then lives next to the trigger.
- Cost of challenger: subscription storage must be Worker-readable. Turso-over-HTTP (`@libsql/client/web` is fetch-based — works from Workers) keeps the recorded D5; or colocate subs in D1/KV for lower read latency (KV: 100k reads/day free = ~4k subs at 24 ticks/day; D1: 5M rows read/day — both headroom-ample).
- **Recommendation: 1-afternoon spike before Phase 1 code** — worker-side send to one real test subscription (proves Bahamut-egress-style unknowns don't apply to push endpoints, proves CPU fits in the 10ms budget; cron invocations allow up to 15 min CPU on paid, 30s default — plenty either way). If the spike passes, adopt full-Worker fanout and delete the Vercel fanout route from the plan; if it fights back, fall back to the recorded split with no shame — it's proven boring.

### B. Subscription storage: Turso (recorded) vs KV/D1 — KEEP TURSO unless A wins

- Turso `push_subscriptions` reuses region, driver, and migration patterns already in `api/_db`. No second database, no new dashboard. At 100–1000 subs the quota cost is noise either way.
- KV would force `list()` pagination in fanout and eventual-consistency reads after subscribe (a user subscribing at :59 might miss :00 — real UX edge); D1 is nicer than KV but is still a second store. Neither beats "the store we already run" without the colocation argument from A.

### C. Trigger reliability: CF cron (recorded) vs GH Actions (rejected) — ADD BACKUP, don't relitigate

- D3's reasoning stands (Actions top-of-hour delays land inside the 2-min window; 60-day auto-disable fails silently). But new evidence cuts the other way too: **CF had a ~56h cron-degraded incident Sep 2026** (triggers delayed or dropped, config propagation slow). Single-trigger dependency either way is the actual risk.
- **Recommendation: keep CF cron primary, promote the Phase-4 "GH Actions backup trigger" to Phase 1.5** — same `/api/push/fanout` adapter (10-line YAML, scheduled `:55` to dodge the herd per the recorded mitigation), staleness guard makes double-fires collapse into one card via tag. Cheap insurance against a recurrence; build it the week primary proves itself, not before.

### D. Push vendor: standard Web Push/VAPID (recorded) vs OneSignal/FCM wrapper — STANDS

- Wrappers add SDK weight, a third-party data share (worse §3d posture: endpoint + browsing behavior vs endpoint-only), and vendor lock for zero gain at our scale. Rejected, no spike needed.

### E. Purple feed + admin: KV + dashboard → `/admin` (recorded) vs gist/R2/Turso — STANDS

- Gist already dropped (third-party host for no reason); R2 is object storage for a 1KB doc; Turso would drag app-DB creds into the worker. KV's 1k writes/day vs our ~4/day is 250× headroom; the dashboard-is-the-day-one-CMS insight removes all CMS code. The only addition: document the **dashboard-edit JSON shape** next to the key names (already required by the admin spec's fallback clause) so a phone edit can't fat-finger the schema — the `/admin` form's validation fixes this permanently when it lands.

### F. Watcher placement: Worker cron (recorded) vs Vercel cron vs local script — STANDS (Worker)

- Vercel Hobby allows daily crons only — 2×/day is impossible without upgrade, killing Vercel placement outright. Local script works (matches fetcher discipline) but needs a human-run schedule; the worker cron is 2 extra lines once the worker exists. Bahamut-from-CF-egress is the one unverified bit — folded into the §1 step-6d spike (if blocked, watcher degrades to local script + dashboard paste, feed contract unchanged).

## 3. Build order on this branch

1. Spike A (worker-side push to one test sub) → record verdict here, then lock fanout location.
2. `workers/push-cron` scaffold + hourly tick + CI deploy (barrier Phase 1 infra).
3. Vercel: VAPID + Turso table + subscribe/fanout (or subscribe-only if A wins) + client wiring + README privacy bullets.
4. Purple: `/purple-schedule` + KV seed → client fallback chain (override > KV > hardcoded) → 15-min tick + purple fanout → watcher + candidates → `/admin` → in-app override D + recalibrate A (phase-2/3 client pieces are independent and can interleave).
5. Phase-1.5 Actions backup trigger (after primary proves 3 consecutive :00s).

## Appendix — secrets inventory

| Secret | Lives in | Sees it | Rotate by |
|---|---|---|---|
| `CRON_SECRET` | CF worker env + Vercel env | worker→fanout hop | `wrangler secret put` + Vercel redeploy |
| `ADMIN_SECRET` | CF worker env only | admin browser (sessionStorage) | `wrangler secret put` + re-login |
| VAPID private | Vercel env only (recorded) or CF worker env (if A wins) | fanout sender | regen pair + resubscribe all |
| `CLOUDFLARE_API_TOKEN` | GitHub repo secrets | CI deploy | CF dashboard token roll |
| Turso creds | Vercel env (existing) | subscribe/fanout routes | existing rotation |
