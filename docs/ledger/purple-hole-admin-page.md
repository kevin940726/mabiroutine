# Purple-hole `/admin` page — build spec

> **ARCHIVED 2026-09-18** — built, shipped, and live in prod. Runbook lives
> in `docs/operations.md` (§1, §6). Kept as history: routes, auth decisions,
> KV schema, probe record.

Status: LIVE in prod 2026-09-18 — deployed, `ADMIN_SECRET` set, login +
publish round trip done by the maintainer. Decided 2026-09-18: bearer
`ADMIN_SECRET` (single maintainer, no usernames, no passkeys, no IP
allowlist — see decisions below). Serves phases 2 (windows) and 3 (anchor)
on one form.

## What it is

A one-page admin UI served by the schedule worker itself: a plain-language
guide, then **candidates** (parsed Bahamut output) with per-row 修正/忽略
staging, the **手動覆寫** card (override + tombstone lists), a read-only
**已發佈** preview with the rarely-used whole-doc editor and auto/resume
behind a flap. Manual datetime inputs cover emergency entries and anchor
fixes; every input shows its resolved Taipei time live.

## Routes (same worker)

- `GET /admin` — the page. `noindex, nofollow`, `Cache-Control: no-store`.
  Serves a login form when unauthenticated, the editor when authed (auth
  checked client-side per request — see below; the HTML itself carries no
  data).
- `POST /admin/api/verify` — `{ secret }` → `{ ok: true }` or 401. The only
  endpoint that takes the secret in the body (once, at login).
- `GET /admin/api/state` — bearer authed. Returns
  `{ verified, candidates, overrides }` for rendering the form.
- `POST /admin/api/publish` — bearer authed. Body `{ anchorMs, windows[] }`.
  Validates (numbers, `start < end`; the strict gate rejects the whole doc on
  any bad entry), writes KV verified doc with `updatedAt: now,
  updatedBy: "admin"`, and **locks auto-apply** (`auto: false`). 400 on
  garbage. The rare whole-doc path (behind the 手動修改全部 flap).
- Inputs are **native `<input type="datetime-local">` only** — the browser's
  built-in picker, zero dependencies, no calendar library. Simple was the
  requirement; this is the simplest thing that qualifies.
- `POST /admin/api/promote` — bearer authed. Re-resolves `purple:candidates`
  through the override/tombstone records and writes verified (stamped admin,
  auto on) — the same resolve the watcher uses, so a curated correction can't
  be dropped by promoting. The one-tap path.
- `POST /admin/api/auto` — bearer authed. Body `{ auto: boolean }` (400
  otherwise). Lock (`false`) keeps the published values untouched; resume
  (`true`) re-resolves windows from the current candidates immediately when
  non-empty instead of waiting for the next cron.
- `POST /admin/api/overrides` — bearer authed. Body `{ overrides: [],
  tombstones: [] }` (full replacement; either list garbage → 400, records
  never half-apply). Immediate re-resolve when unlocked. The 手動覆寫 card
  edits both lists; each candidate row stages 修正 (prefilled override) or
  忽略 (prefilled tombstone) into it.
- `GET /purple-schedule` — public. Resolved doc + CORS `*`,
  `Cache-Control: public, max-age=60`.

## Auth

- `ADMIN_SECRET`: long random string, **Cloudflare worker env** (`wrangler
  secret put ADMIN_SECRET`) — secrets live where they're checked; Vercel
  never sees these requests. (Vercel keeps only the push plan's own secrets:
  `CRON_SECRET`, VAPID key, Turso creds.)
- Browser keeps the secret in **sessionStorage**, sent as
  `Authorization: Bearer` per API call. Re-entered once per session.
- Comparison via `crypto.subtle.timingSafeEqual` (length-check first to
  avoid the exception oracle).
- No rate-limiting built in (single form, nuisance-grade asset); Cloudflare's
  free basic rate rules are the fallback if probing ever shows up in logs.
- Rotation: new `wrangler secret put` + re-login. No code change, no
  redeploy of logic.

## KV schema

- `purple:schedule` — verified doc:
  `{anchorMs, windows: [{startMs, endMs}], updatedAt, updatedBy: "admin"}`.
- `purple:candidates` — watcher output:
  `{anchorMs?, windows[], observedAt, sources: [urls]}`. Never served
  publicly; admin page only.
- `purple:overrides` — per-window surgery:
  `{overrides: [{startMs, endMs}], tombstones: [{startMs, endMs}],
  updatedAt, updatedBy}`. Overrides replace by startMs (extension keeps the
  announced start, so corrections track re-parses); tombstones suppress;
  past + unobserved records expire on resolve. Never served publicly.
- Key names are the dashboard contract: if the worker is down, the same
  values are editable via dashboard → namespace → key (documented fallback,
  no code involved).

## Decisions (locked 2026-09-18)

- Bearer secret, not passkeys (lockout risk with one admin; threat model is
  nuisance-grade), not URL tokens (leak via history/logs), not Cloudflare
  Access (second product for one form), not IP allowlist (home IPs rotate).
- Worker auto-applies watcher candidates to verified windows while unlocked
  (reverses the earlier never-auto rule per user decision 2026-09-18);
  any manual publish locks it, promote keeps it, resume flips it back.
  `updatedBy: "watcher"` vs `"admin"` tells you who wrote what.
- Gist/hosted-file options dropped: KV + dashboard covers day one, this
  page covers graduation, no third party involved.

## Tests

- Wrong secret → 401, no state leak (verified doc never in the login HTML).
- Garbage payload (string anchor, `end < start`) → 400, KV untouched.
- Promote with empty candidates → no-op with message, verified untouched.
- Public `/purple-schedule` shape unchanged; CORS + cache headers present.
- Dashboard-edit path: hand-edit `purple:schedule`, confirm client picks it
  up within cache TTL.
- Auto state machine (probed): unlocked run overwrites windows; locked run
  writes candidates only; publish locks; promote/resume keep/set auto with
  immediate re-resolve; empty candidates never wipe verified.
- Inline `<script>` has no lint coverage (esbuild/oxlint don't parse HTML
  strings — this already hid one extra-`}` that blanked the page): after any
  edit, extract and `node --check` it:
  `node -e "const fs=require('fs');const s=fs.readFileSync('workers/mabiroutine-worker/src/index.ts','utf8');fs.writeFileSync('/tmp/admin-inline.js',s.match(/<script>([\s\S]*?)<\/script>/)[1])" && node --check /tmp/admin-inline.js`.

## Build log 2026-09-18 (LIVE)

- All five routes in the worker (`/admin` shell + verify/state/publish/
  promote) plus `auto` and `overrides`, probed against mocked KV/Turso/push
  with real WebCrypto encrypt (auth gate 401s + 200, publish 400s + 200,
  promote empty/copy/anchor-preserve, fanout fanned-out → fired-already →
  no-spawn, auto state machine, override replace/add/tombstone/expiry). Node
  lacks `subtle.timingSafeEqual`, so probes shim it.
- Prod verification: `GET /admin` → 200, `GET /robots.txt` → 200 (worker
  route added, plus `Disallow: /admin` in the app's `public/robots.txt`),
  wrong secret → 401 (armed, not 500), maintainer login + publish round trip
  done.
- Worker-side only: no Vercel route, no app deploy needed for admin changes.

## Effort

~Half day (routes + KV + validation) + ~1 hour (form + promote button).
Spike first with the phase-2 watcher items (10ms CPU fit, Bahamut egress).
