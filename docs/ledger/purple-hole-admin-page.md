# Purple-hole `/admin` page — build spec

Status: planned, unstarted. Decided 2026-09-18: bearer `ADMIN_SECRET`
(single maintainer, no usernames, no passkeys, no IP allowlist — see
decisions below). Serves phases 2 (windows) and 3 (anchor) on one form.

## What it is

A one-page admin UI served by the schedule worker itself. One screen, three
blocks: **current verified values** (anchor datetime + windows list),
**watcher candidates** (parsed Bahamut output, if any), and a
**promote button** that copies candidates → verified in one tap. Manual
datetime inputs cover everything else (emergency entries, anchor fixes).

## Routes (same worker)

- `GET /admin` — the page. `noindex, nofollow`, `Cache-Control: no-store`.
  Serves a login form when unauthenticated, the editor when authed (auth
  checked client-side per request — see below; the HTML itself carries no
  data).
- `POST /admin/api/verify` — `{ secret }` → `{ ok: true }` or 401. The only
  endpoint that takes the secret in the body (once, at login).
- `GET /admin/api/state` — bearer authed. Returns `{ verified, candidates }`
  for rendering the form.
- `POST /admin/api/publish` — bearer authed. Body `{ anchorMs, windows[] }`.
  Validates (numbers, `start < end`, sorted, dropping spent entries is the
  caller's choice, not enforced), writes KV verified doc with
  `updatedAt: now, updatedBy: "admin"`. 400 on garbage.
- Inputs are **native `<input type="datetime-local">` only** — the browser's
  built-in picker, zero dependencies, no calendar library. Simple was the
  requirement; this is the simplest thing that qualifies.
- `POST /admin/api/promote` — bearer authed. Copies `purple:candidates` →
  verified doc (stamped admin). The one-tap path.
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
- Key names are the dashboard contract: if the worker is down, the same
  values are editable via dashboard → namespace → key (documented fallback,
  no code involved).

## Decisions (locked 2026-09-18)

- Bearer secret, not passkeys (lockout risk with one admin; threat model is
  nuisance-grade), not URL tokens (leak via history/logs), not Cloudflare
  Access (second product for one form), not IP allowlist (home IPs rotate).
- Worker never auto-publishes truth: candidates stay candidates until a
  promote/publish. `updatedBy: "admin"` wins over everything downstream.
- Gist/hosted-file options dropped: KV + dashboard covers day one, this
  page covers graduation, no third party involved.

## Tests

- Wrong secret → 401, no state leak (verified doc never in the login HTML).
- Garbage payload (string anchor, `end < start`) → 400, KV untouched.
- Promote with empty candidates → no-op with message, verified untouched.
- Public `/purple-schedule` shape unchanged; CORS + cache headers present.
- Dashboard-edit path: hand-edit `purple:schedule`, confirm client picks it
  up within cache TTL.

## Effort

~Half day (routes + KV + validation) + ~1 hour (form + promote button).
Spike first with the phase-2 watcher items (10ms CPU fit, Bahamut egress).
