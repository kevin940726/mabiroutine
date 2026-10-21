# Development — getting started & contributor guide

Audience: future-you, contributors, AI agents. Get productive in ~15 minutes.
User-facing story lives in `README.md` / `README-zh_TW.md`; sync user stories
in `docs/stories.md` (read these before `docs/sync.md` — acceptance first,
mechanism second); protocol details in `docs/sync.md`; data rules in
`docs/tracker-data.md`; saved-progress behavior in `docs/storage.md`.

## Prerequisites

- Node 24 + `pnpm` (repo pins `pnpm@11.8.0` via `packageManager` — Corepack or
  `npm i -g pnpm` works).
- Playwright's pinned Chromium, only for the browser suites:
  `pnpm exec playwright install chromium`. `pnpm install` does not fetch it
  (the package ships no postinstall), and both browser suites SKIP loudly
  without it. UI work needs no browser.
- No other services needed for UI work. Cloud sync runs on SQL: a local
  `file:` database in dev, Turso in deployed environments (`api/_db/`). Local
  work needs no credentials (see Full stack below).

## First run (2 min)

```bash
pnpm install
pnpm dev              # plain Vite (no API routes) — UI work starts here
```

Need sync (`跨裝置同步`) or any `/api/*` route? That needs the full stack:

```bash
pnpm dev:api          # vercel dev + Vite on :52608, API routes live
```

`pnpm dev` is plain Vite on **:5173** (UI only — `/api/*` 404s); `pnpm dev:api`
serves the same UI through `vercel dev` on **:52608** with serverless functions
attached. If sync behaves differently between the two, you're probably hitting the
missing-API case — switch to `dev:api`.

Those two ports are the ones to assume when something is already listening: the
user starts them, and `:5173` belongs to the MAIN worktree — a second worktree's
Vite takes the next free port (`:5174`), so check which checkout a port serves
before trusting a measurement (AGENTS.md § The dev loop: never start a dev server
unasked).

## Agent skills

The zh-TW writing skill is committed canonically at
`.agents/skills/tech-doc-zh-tw`; `skills-lock.json` pins its source and hash.
Claude Code does not scan `.agents`, so materialize its link once per clone:

```bash
npx skills add kevin940726/agent-skills -s tech-doc-zh-tw -a claude-code
```

`.claude/skills/` is generated and ignored; `.agents/skills/` is the copy to
commit. OpenCode reads it directly.

## Five-minute tour

- **Game data is hand-owned JSON** — `src/data/tracker.json` (26 rows) +
  `src/data/shops.json` (NPC → purchase/exchange options incl. the 117 curated legs, each with a stable `id`, schema'd by
  `shops.schema.json`) +
  `src/data/curatedOrder.ts` + `src/data/defaultPins.ts` +
  `src/data/recipes.json` (make/gather/quest/drop routes per item — shop/barter legs live in `shops.json`). No codegen, no
  fetchers in this tree (maintainer-only scripts live on your own disk,
  gitignored, never committed). Rules: `docs/tracker-data.md`. Row `id`s are
  stable — saved progress keys off them, so never rename casually. Shopping
  options merge by key (npc+item) at load — file order is display-only
  (town-grouped for in-game checking); a leg's carried display limit must match
  its structured cap (`test:shops` twin parity enforces it).
- **State is one Zustand store** — `src/store/useAppStore.ts`, persisted to
  `localStorage` key `mabiroutine:v2` (schema `v23`, migrated on load — see the
  store checklist in `AGENTS.md` before changing persisted shape).
- **Resets are Taipei wall-clock** — `src/lib/reset.ts`: daily 06:00 /
  Monday 06:00 `Asia/Taipei`, evaluated lazily + on focus/visibility + 60s tick.
- **Sync is conflict-free flat keys** — `src/sync/` client (`api.ts`,
  `session.ts`, `flat.ts`) + `api/session.ts` (SQL over Vercel functions;
  `api/_db/` holds the DB-agnostic `Db` seam with Turso and local `file:`
  drivers). Read `docs/sync.md` before touching any of it; the short version:
  every mutation is an absolute set of flat keys, server stamps arrival order,
  no conflict UI exists by design.
- **PWA via `vite-plugin-pwa` `generateSW`** — silent-fresh: navigations are
  NetworkFirst (every online load renders the current build), SW updates only
  refresh caches (prompt mode acked silently, client reload suppressed), and a
  return after 6h+ away reloads once iff online, no dialog open, and an update
  is pending. A deploy that lands mid-session is the one thing announced: it
  raises one 8s toast (有新版本可用 + 重新載入) and the ☰ row 有新版本 · 重新載入,
  and accepting either reloads into the new bundle and says 已更新到最新版 once.
  A worker already waiting at boot is not announced — that page just rendered
  fresh HTML — and the 6h path reloads with no receipt. Offline revisits fall
  back to the runtime `pages` cache (index.html is out of the precache by
  design — a precached NavigationRoute/directoryIndex would shadow
  NetworkFirst). Service worker is disabled in dev; test install / offline
  against `pnpm build && pnpm preview`.
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
- **Change sync behavior:** `docs/stories.md` first (write/adjust the story +
  acceptance criteria), then `docs/sync.md`, including the quota budget.
  `/api/*` responses are never cached by the SW — keep it that way.
- **Change reset/count rules:** `src/lib/reset.ts` + data `max` + docs; remember
  countdown tiles, header countdown, and per-character isolation in tests-by-eye.
  A counter with NO `max` is unbounded (today only `weekly-goals`): done at >= 1,
  its tile never shows a ✓, and every `max ?? 0` done-check must read `?? 1`
  (`isTaskDone`, TaskRow's `isDone`, TrackerSection's hideCompleted filter).

## Gates (run before every push)

`pnpm check` runs all seventeen gates; `AGENTS.md` § Pre-push Gate is the
always-loaded copy of which gate fires on what. `scripts/check-all.mjs` is the
runner: one line per gate (`ok <gate> 1.2s` / `FAIL <gate> <ms>`), stopping at the
first failure, so the last lines of a run are the verdict — the old `&&` chain
ended on the Vite build, so a truncated tail hid every gate result. `--verbose`
streams a gate's own output; `node scripts/check-all.mjs test:tracker test:tap`
runs a subset while iterating; `--list` prints the names.

The local pre-push hook (`.git/hooks/pre-push`, uncommitted by design — it also
filters refs) calls `scripts/pre-push-gate.mjs`, which runs this suite plus the
changelog rules: every non-merge commit in the pushed range must touch
`CHANGELOG.md`, and a `main` push must leave `## Unreleased` empty (the release
label was folded into the tip commit — `AGENTS.md` § Changelog). A changelog
failure stops before the suite. `git push --no-verify` skips the hook.

There is no CI. The hook is the gate: a workflow on `main` would run after the
deploy that push already triggered, so it detects a break rather than preventing
one. It becomes worth adding with a PR workflow, where it can gate a merge.

The rules below are the why: what each gate pins, the incident or measurement
behind it, and the sabotage standard.
Data rule: `pnpm test:shops` after touching `recipes.json`, `shops.json`, or
`curatedOrder.ts` (shape + currency + dup + no-trade-routes + shop-gold-only + twin probes + curated completeness).
Tracker rule: `pnpm test:tracker` after touching `tracker.json` (row shape +
max rules + `subTasks` link integrity — a broken link is silent in the app).
Doc-facts rule: `pnpm test:docs` after touching the row set, a row's `max`, or any
doc or skill that quotes those numbers. It checks that prose against
`tracker.json` — a quoted row total, the `N daily + N weekly + N account`
breakdown, a `Keep hardcodes:` `<id> max <n>` pair, and every row id in
`docs/tracker-data.md`'s inventory tables. `CHANGELOG.md` and `docs/plans/**` are
excluded: they record a point in time and may say what was true then. The failure
mode is a stale instruction — the 2026-10-19 rework left `skills/update-tracker/SKILL.md`
telling the next writer to keep `black-hole` max 14 (7+7) and quoting 25 rows —
and it recognizes only the phrasings above, so a doc quoting the total some other
way is still unchecked.
Migrations rule: `pnpm test:migrations` after adding or changing a
`migratePersisted` step (or the persisted shape itself — the store checklist is
`AGENTS.md` § Store Version Bumps). It bundles the real `migratePersisted` and runs
the fixtures in `scripts/migration-check.entry.ts` (versionless save, synthetic
barter ids, removed-id prune, passthrough, filter sanitize). A new step needs a
fixture block (A/B/C/D/E/F) proving old data survives: user progress always wins,
so a step fills defaults and prunes dangling keys, never overwrites a value.
Pre-push gate rule: `pnpm test:prepush` after changing `scripts/pre-push-gate.mjs`
or the changelog rules it enforces. It builds a throwaway repo in the temp dir and
pins the gate's outcomes: a commit with no `CHANGELOG.md` change fails naming the
commit, an unlabelled `## Unreleased` on `main` fails before the suite runs, a
`feat/*` ref skips that rule, a dirty tree with a failing suite names the dirty
tree, and a bad revision range reports git's message rather than a stack trace. The
stub `package.json` makes its `pnpm check` a no-op, so this never re-enters the
suite.
What's-new rule: `pnpm test:whatsnew` after touching `CHANGELOG.md`,
`CHANGELOG-zh_TW.md`, or `src/data/whatsNew.generated.json`. `CHANGELOG-zh_TW.md`
is the player-facing record and the app's source; the JSON is its committed
derivative, written by `node scripts/whats-new.mjs --write` at cut time. The
gate imports the parser and the `--check` comparison from that script, so it is
read-only and never writes, and adds the parity the parser cannot see: every
dated English release from the zh file's oldest section forward has a zh section
whose `<!-- release: … -->` marker matches the heading verbatim, or carries
`<!-- whats-new: none -->` directly under it; every marker resolves to a
heading; nothing is duplicated, reordered or written twice (a section plus a
`none` marker is a contradiction); a marker's date equals its zh heading's; and
no bullet carries a backtick, file name, path or commit hash. It also pins the
parser itself against fixtures — the accepted section shape and twelve
constructs it must reject with their line — because a parser that starts
ignoring what it does not understand deletes copy quietly. The failure mode is
silent: a skipped release ships with a drawer that omits it, a stale JSON shows
the previous cut, and a reworded heading quietly re-keys nothing, so the seen
state never advances. `## Unreleased` is exempt — its zh copy is written in the
same cut that labels it, and the pre-push hook already requires it empty on
`main`.
Icon rule: `pnpm test:icons` after touching `src/lib/itemIcon.ts` or the item
data (the emitted path per name shape — `+` → `%2B`, literal `(3級)` parens, CJK
→ percent-encoded). The encoding has a silent failure mode in two directions, so
it is pinned rather than left to a comment; see `docs/item-icons.md`.
Fallback rule: `pnpm test:fallbacks` after touching any art `<img>`, its
fallback, or an art path. It fails on ANY `src` assignment under `src/`, `api/`
or `workers/` (the unbounded-retry shape that drained the account's edge
requests on 2026-10-12: an assignment to a URL that is missing re-enters the
handler), on an NPC `shops.json` names without a portrait, on a hardcoded
`/npc/` or `/items/` filename with no file on disk, and on the
`public/npc/placeholder.png` shim missing or untracked by git; see
`docs/item-icons.md`.
Purple rule: `pnpm test:purple` after touching `src/lib/purpleHole.ts`, the
schedule doc shape (feed, `/admin`, `resolveAndStore`, the CLI publish bodies),
or a reminder lane (client timer, server fanout). It pins the two rays: a `next`
correction never moves the record's past, `prevMs` keeps the row behind a
recorded spawn exact across a seam, and the supersede guard refuses a publish
that would drop a passed, unrecorded correction (the CLI's `forget` / the page's
放棄 checkbox is the explicit bypass for a correction that never happened).
Publishing a doc that carries `nextMs`/`prevMs` also requires the deployed
Worker: the pre-rule worker parses them away on publish and on every resolve,
so a correction published early is erased while the CLI reports success; see
`docs/operations.md` §6.
Budget rule: `pnpm test:budget` after touching `public/sw-budget.js`, the
workbox `runtimeCaching`/`importScripts` config, or anything that changes what
the Service Worker intercepts. It runs the real worker script in a vm realm and
asserts the guard's contract (never intercepts below the tiers, trips where it
says, and past a trip gives every same-origin class a real or retryable answer:
`/api/` 429, navigations from the preload or pages cache else the network,
images from cache else a pixel, everything else from cache else a 503, with
cross-origin untouched). The `importScripts` entry is load-bearing: the budget
listener must register before the generated `registerRoute` calls, so a change
that moves it into a route, or into `injectManifest`'s generated worker,
silently hands the fetch event back to Workbox and disarms the guard. It also
fails any network call under `src/` made outside the three sanctioned request
sites (`sync/api.ts` for `/api/session`, `src/lib/net.ts` for the push registry,
`purpleHole.ts` for its own throttled feed fetch), so a new request path cannot
land uncounted. See `docs/operations.md` §7.
Worker rule: `pnpm test:worker` after touching `workers/` or any `src/lib` module
the Worker imports. It bundles the Worker with `wrangler deploy --dry-run`
(uploads nothing, no auth) because the Worker has no tsconfig: `tsc -b` never
sees it, esbuild does not type-check, and the shared modules are pulled in by
relative path, so an aliased (`@/`) runtime import in one of them fails only at
deploy time. `import type` from an alias is safe (stripped before resolution).
Reminder rule: `pnpm test:reminders` after touching the reminder display path
(`hourlyReminders.ts`, `useHourlyReminders.ts`, `public/sw-push.js`, the
barrier payload) or the shared slot math `eventHourOf`. It bundles the real
module and runs the real `public/sw-push.js` in a vm realm: a same-tag +
same-slot card already on screen is replaced without re-alerting (the seam
dedup: the local fire lands :00:00, the CF cron tick :00:49–:00:55), a card
from the previous slot still alerts (an undismissed card must not eat the next
hour), and every missing stamp or failed tray lookup fails open to the alert,
with the existing skip paths (hidden page, denied permission, all-done
silence, visible-client stand-down) pinned unchanged.
Shop rule: `pnpm test:shop-e2e` before a release, and after touching the store's
migration, the shop grid, or the pinned-section fold. It drives the real app in
Playwright's pinned Chromium and asserts what the unit gates cannot: a real v19
save migrating on load (and an existing fold NOT being stomped), the grid
rendering 4 columns at a desktop width with the discriminating 1100px case that
tells the container rule apart from a viewport one, the pinned-section fold
surviving a reload, and S5 — the reported stray-click regression on a phone
viewport with real touch: completing a 4× counter with taps leaves the row below
it unchecked. Needs `pnpm dev` (default `:5173`, override with `APP_URL=`)
plus that Chromium, and SKIPs loudly without either, so it is NOT in `pnpm check`
— a browser suite that needs a dev server does not belong in the offline gate.
`APP_URL=http://localhost:5188 pnpm test:shop-e2e` points it at another port.
Drag rule: `pnpm test:drag` after touching `src/lib/dragRules.ts` or a drag
handler. It asserts the hierarchy (`scripts/check-drag-rules.entry.ts`, bundled
like the others): children reorder only within their own merchant group, rows
only within their own section, and a grouped pin cannot swap into the plain-row
list. Cross-list moves are enforced by structure instead — one drag context per
list — so they need no rule of their own.
Tap rule: `pnpm test:tap` after touching `src/lib/tapGate.ts`, the grab counter
or any tile's click handler. Two halves. The bundled pure suite
(`scripts/check-tap-gate.entry.ts`) pins the rule: a tile writes only for its own
pointer gesture — a tap's click writes once, a click with no tap of its own on
the control is refused, a grab/drag's trailing click is refused, and a
pointerless activation (`detail === 0`) is honored. The scan half then reads
every file under `src/components/` and `src/hooks/` and fails on the two shapes
that would bring the bug back: a pointer-down/up handler that writes progress,
and an `onClick` that writes progress with no `ownsClick` guard. Sabotage check:
deleting a tile's guard fails the scan with that tile's file and line.
Why it exists: a counter's tap wrote on the pointerup (`a8019d5`, 2026-09-04,
moved it off the `click` so a tap could be told from a hold), and 隱藏已完成
removes a completed row synchronously inside that same handler — so on a touch
device the rows below slid up BEFORE the browser dispatched the gesture's own
synthesized `click`, which was then hit-tested against whatever had moved under
the finger and wrote a second row. Measured at 390px against the real pinned
band: ONE tap on 佛格斯's 4×合金鋼錠 wrote 合金鋼錠 4/4 and 安黛莉's 聖水 ✓, and an
艾爾文 2× tap wrote the next 特蕾西 row. Touch-only: with a mouse, the mouseup
resolves against the removed row's parent and Chromium dispatches no click at
all. `setPointerCapture` cannot fix it either (measured: the compat mouse events
and the click still reached the row below), so the fix is the gate plus the tap
write moving onto the `click`. The reported symptom also has a browser-level
regression: `test:shop-e2e` S5 (phone viewport, real touch) completes that same
counter with four taps and asserts the row below stays unchecked and on screen.

## Cutting a release

The cut has no commit of its own: the release label rides in the tip commit you
push, because only `main` deploys (`AGENTS.md` § Changelog). Three files record
one release, and they move in that same commit.

1. Label the English section: `## Unreleased` → `## <YYYY-MM-DD> — <label>`,
   with a fresh empty `## Unreleased` above it. The label comes from the range's
   content.
2. Add the zh section to `CHANGELOG-zh_TW.md`: same date, 1–3 bullets in player
   voice, and a `<!-- release: … -->` marker naming the English heading
   **verbatim**. When nothing in the release is player-visible, write
   `<!-- whats-new: none -->` directly under the English heading instead —
   that is the only way to say "intentional" rather than "forgotten".
3. `node scripts/whats-new.mjs --write` — the only writer of
   `src/data/whatsNew.generated.json`.
4. Commit `CHANGELOG.md`, `CHANGELOG-zh_TW.md` and
   `src/data/whatsNew.generated.json` together.
5. Fold the label into the tip commit as usual (`git commit --amend --no-edit`
   once staged).

The three files are one record seen three ways, which is why they cannot land
apart: the zh file is the player-facing copy, and the JSON is the drawer's copy
of it. Regenerate the JSON before the zh section exists and the app renders the
*previous* cut; write the section and skip the regeneration and this cut is
missing from the drawer. Neither a build nor a type check notices, so
`test:whatsnew` is the only reader that sees it — it fails on a skipped step 2
or 3, and the pre-push hook turns that into a blocked push rather than a wrong
deploy. The same gate pins the marker to the English heading, so a reworded
heading fails instead of silently re-keying the release the seen state stores.

## Gotchas

- **Tailwind v4 scans source as TEXT, comments and stray files included**, so a
  class-shaped string written anywhere the build reads emits a real rule. Two ways
  that bites: a `@min-[…]` example in a comment, and a throwaway script left at the
  repo root (both happened, and both produce a silent CSS change rather than an
  error). Two utilities at the same container width also conflict — one is dropped —
  which is why `GRID` and the name band's reservation in `src/components/shop/` are
  deliberately 20px apart. Keep example class names in words, keep scratch files out
  of the tree, and read the built CSS after touching a container-query threshold.
- `vercel dev` does not forward custom keys from `.env.local` to functions, and
  the SQL driver keys on `VERCEL_ENV`: local `pnpm dev:api` always uses the
  throwaway `file:./dev.db`, while Preview/Production use Turso (which they
  share). `SYNC_KEY_PREFIX` now only signals the roomy test rate budget. See
  `docs/sync.md` and `docs/sql-migration.md`.
- Workbox packages must stay explicit in `package.json` (the PWA build needs
  them resolvable, not hoisted-by-luck).
- `suggestions/` is gitignored review scratch — never committed, never required.
- The worker's `/admin` page embeds its JS as an HTML string in
  `workers/mabiroutine-worker/src/index.ts`, which no linter parses
  (esbuild/oxlint see a string, not code — this already hid a stray brace
  that blanked the page). After any edit, extract and `node --check` it:
  ```powershell
  $s=[IO.File]::ReadAllText('workers/mabiroutine-worker/src/index.ts')
  $m=[regex]::Match($s,'<script>([\s\S]*?)</script>')
  if(-not $m.Success){throw 'no inline script found'}
  [IO.File]::WriteAllText("$env:TEMP\admin-inline.js",$m.Groups[1].Value)
  node --check $env:TEMP\admin-inline.js
  ```
- Worker/lib logic without a harness (feed math, watcher parse, admin
  routes, fanout) is verified with throwaway esbuild-bundled node scripts
  against mocked KV/Turso/push with real WebCrypto — no test harness
  proposed for this code; `pnpm check` stays green regardless.
- Sync is the retention-critical path and has its own gate (`pnpm test:sync`,
  wired into `pnpm check`). Suites in `scripts/sync-tests/` (orchestrated by
  `scripts/check-sync.mjs`), all against REAL code — no unit tests:
  - `engine.entry.ts` — bucketed-key scenarios: local reset never
    tombstones, adoption filters by tag, legacy keys inert, delete split
    (cycle silent vs persistent tombstoned once), resetAll, GC, the
    production stale-evening-device scenario, contested-key arbitration
    (a stale device's unsynced leftovers lose to the peer, a fresh edit still
    wins, an empty base respects a peer tombstone, a laundered value cannot
    overwrite), and row/pin order keys (E21/E22); real store + real
    flat/session/reset functions and the real `planRound`, modeled server,
    stubbed storage.
  - `quota.entry.ts` — Q1–Q5: per-kind telemetry counting, the daily touch
    beacon, and the idle window.
  - `flush.entry.ts` — state-before-base ordering in one storage flush
    through the real `saveBase`, plus read-through and remove semantics.
  - `journal.entry.ts` — the local sync journal: round-trip, per-list and
    ring caps, corruption recovery, empty-round skip.
  - `prop-reset.ts` — 300 seeded-random prune runs: stale-bucket values
    removed, current kept, idempotent, non-value fields untouched.
  - `tabs.cjs` — poisoned-base stale tab + cap-overflow in vm-realm tabs
    running the real bundled `flat.ts` (fails on pre-fix code).
  - `sql-smoke.mjs` — the real `api/session.ts` handler against a local file
    SQL database: protocol parity plus the SQL-specific rules (cycle-key
    nulls delete, persistent tombstones retained, cap 413, legacy v1/v2
    upgrade, lazy TTL). A `--remote` mode runs the same against Turso.
  - `api-live.mjs` — dev-API concurrency (25 parallel PATCHes),
    same-key LWW, legacy upgrades, failure paths, no-store headers. Inspects
    the SQL backend via `backend.mjs` (Turso over HTTP, local file DB for dev
    servers).
  - `browser-e2e.mjs` — real Chromium (Playwright): tap→server→second-device
    render, wake-pull convergence. Needs `pnpm dev:api` + the Playwright
    Chromium (`pnpm exec playwright install chromium`).
  - Live suites SKIP loudly (exit 0) without their deps; hermetic suites
    always run. `pnpm test:sync --skip-live` for offline.
  - Whether a diff needs the live legs is not a judgement call:
    `node scripts/needs-live-sync.mjs` diffs against `origin/main` and prints
    `live sync: REQUIRED` with the paths it matched (advisory; the pre-push hook
    runs it, and it never fails a push).
  - `SYNC_TEST_BASE` points the live suites at another base (default local
    `:52608`): `SYNC_TEST_BASE=https://<preview>.vercel.app pnpm test:sync`
    verifies the deployed build. Protected previews also need
    `SYNC_TEST_BYPASS=<automation secret>` (Vercel Deployment Protection
    bypass): the API suites send it as a header, the browser E2E loads the page
    with it plus `x-vercel-set-bypass-cookie=true`. Preview and Production
    currently share one Turso database, so a preview run touches production rows
    (solo-maintainer trade-off; see `docs/sql-migration.md` Environments).
  - Sabotage standard: disabling suppression must fail T3 (verified — the
    sabotaged run emits the exact production wipe payload). A sync change
    whose suite still passes while broken is a suite bug; fix the suite.
- UI changes are verified by build + by-eye in dev (mobile + desktop variants).
