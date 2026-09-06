# Development — getting started & contributor guide

Audience: future-you, contributors, AI agents. Get productive in ~15 minutes.
User-facing story lives in `README.md` / `README-zh_TW.md`; protocol details in
`docs/sync.md`; data rules in `docs/tracker-data.md`; saved-progress behavior
in `docs/storage.md`.

## Prerequisites

- Node 24 + `pnpm` (repo pins `pnpm@11.8.0` via `packageManager` — Corepack or
  `npm i -g pnpm` works).
- No other services needed for UI work. Cloud sync needs Upstash credentials
  (see Full stack below).

## First run (2 min)

```bash
pnpm install
pnpm dev              # plain Vite (no API routes) — UI work starts here
```

Need sync (`跨裝置同步`) or any `/api/*` route? That needs the full stack:

```bash
pnpm dev:api          # vercel dev + Vite on :52608, API routes live
```

`pnpm dev` is plain Vite on Vite's default port; `pnpm dev:api` serves the same
UI through `vercel dev` on :52608 with serverless functions attached. If sync
behaves differently between the two, you're probably hitting the missing-API
case — switch to `dev:api`.

## Five-minute tour

- **Game data is hand-owned JSON** — `src/data/tracker.json` (21 rows) +
  `src/data/barter.json` (92 rows) + `src/data/defaultPins.json`. No codegen, no
  fetchers in this tree (maintainer-only scripts live on your own disk,
  gitignored, never committed). Rules: `docs/tracker-data.md`. Row `id`s are
  stable — saved progress keys off them, so never rename casually.
- **State is one Zustand store** — `src/store/useAppStore.ts`, persisted to
  `localStorage` key `mabiroutine:v2` (schema `v12`, migrated on load — see the
  store checklist in `AGENTS.md` before changing persisted shape).
- **Resets are Taipei wall-clock** — `src/lib/reset.ts`: daily 06:00 /
  Monday 06:00 `Asia/Taipei`, evaluated lazily + on focus/visibility + 60s tick.
- **Sync is conflict-free flat keys** — `src/sync/` client (`api.ts`,
  `session.ts`, `flat.ts`) + `api/session.ts` (Upstash Redis via Vercel
  functions). Read `docs/sync.md` before touching any of it; the short version:
  every mutation is an absolute set of flat keys, server stamps arrival order,
  no conflict UI exists by design.
- **PWA via `vite-plugin-pwa` `generateSW`** — precached shell, offline
  support, auto-update toast. Service worker is disabled in dev; test install /
  offline against `pnpm build && pnpm preview`.
- **UI** — React 19 + Tailwind v4 + shadcn/ui (Radix pattern) + `@dnd-kit` for
  drag reorder; `src/components/` for tracker, barter explorer, dialogs.

## Common tasks

- **Add/change a tracker or barter row:** edit the JSON by hand, keep `id`
  stable, follow `docs/tracker-data.md` (TW-only, hardcodes, no KR rows), write
  `note` in our own voice, `pnpm build`. User-visible change → `CHANGELOG.md`
  + both READMEs in the same commit (gate in `AGENTS.md`).
- **Change persisted store shape:** follow the store checklist in `AGENTS.md`
  (bump version twice, append a migrate step, extend fixtures) — then
  `pnpm check` must pass.
- **Change sync behavior:** `docs/sync.md` first, including the quota budget.
  `/api/*` responses are never cached by the SW — keep it that way.
- **Change reset/count rules:** `src/lib/reset.ts` + data `max` + docs; remember
  countdown tiles, header countdown, and per-character isolation in tests-by-eye.

## Gates (run before every push)

`pnpm check` = `lint` + `test:migrations` + `test:sync` + `build`. All four must pass.
Plus, per `AGENTS.md`: every commit updates `CHANGELOG.md` in the same commit
and keeps `README.md` / `README-zh_TW.md` / `docs/` truthful.

## Gotchas

- `vercel dev` does not forward custom keys from `.env.local` to functions —
  dev/prod sync isolation relies on project env vars (`SYNC_KEY_PREFIX`), not
  your local file. See `docs/sync.md`.
- Workbox packages must stay explicit in `package.json` (the PWA build needs
  them resolvable, not hoisted-by-luck).
- `suggestions/` is gitignored review scratch — never committed, never required.
- Sync is the retention-critical path and has its own gate (`pnpm test:sync`,
  wired into `pnpm check`). Suites in `scripts/sync-tests/` (orchestrated by
  `scripts/check-sync.mjs`), all against REAL code — no unit tests:
  - `engine.entry.ts` — T3 late-wake suppression, T3b early reset, T4 chain,
    T5 adopt/import stamping, T6 resetAll; real store + real
    flat/session/reset functions, modeled server, stubbed storage.
  - `prop-reset.ts` — 300 seeded-random `checkResets` runs asserting reported
    keys == removed keys exactly (the suppression load-bearer).
  - `tabs.cjs` — T1 stale-tab + T2 cap-overflow in vm-realm tabs running the
    real bundled `flat.ts` (fails on pre-fix code).
  - `api-live.mjs` — dev-API concurrency (25 parallel PATCHes),
    same-key LWW, legacy upgrades, failure paths, no-store headers.
  - `browser-e2e.mjs` — real Edge over CDP: E1 tap→server→second-device
    render, E2 wake-pull convergence. Needs `pnpm dev:api` + Edge.
  - Live suites SKIP loudly (exit 0) without their deps; hermetic suites
    always run. `pnpm test:sync --skip-live` for offline.
  - Sabotage standard: disabling suppression must fail T3 (verified — the
    sabotaged run emits the exact production wipe payload). A sync change
    whose suite still passes while broken is a suite bug; fix the suite.
- UI changes are verified by build + by-eye in dev (mobile + desktop variants).
