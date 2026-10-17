# AGENTS — repo runbook for agents

Data knowledge lives in `docs/` (read it before touching data or sync):
- `docs/tracker-data.md` — TW-only sources, item inventory, filtering rules.
  Hard rule: **never seed KR rows into `src/data/*`**.
- `docs/sync.md` — sync protocol, key space, decisions, quota.

## Store Version Bumps (persist schema `useAppStore.ts`, current `v22`)

Key `mabiroutine:v2` is the storage slot name (stable); `version` is the schema number (bumps).
User progress always wins — migrate only fills defaults and prunes dangling keys, never overwrites values.

Checklist when persisted shape changes (new/renamed/removed field, removed row ids):
1. Bump `version` in **two** places: `initial.version` and persist config `version`.
2. Append `if (from < N) { ...; s.version = N; }` in `migratePersisted` — chain from the previous number, keep old steps forever (users may skip releases). `normalizePersisted` runs before steps on every load, so steps can assume full shape.
3. Removing row ids → extend the v6 prune pattern (add the new dangling container, or it generalizes already via the `valid` set from `validPinnableIds` (tracker + curated + custom + `shop::` ids)).
4. Renaming a row id → add an explicit id-remap in the new step (prune would drop the old progress otherwise); tell the user first.
5. `pnpm build` must pass; user-facing impact goes in `CHANGELOG.md` + READMEs (`README.md` / `README-zh_TW.md`) or `docs/storage.md` as appropriate.

**Fold a bump that has not shipped — do not stack one.** `main` is what users have, so compare against it before spending a number: `git show main:src/store/useAppStore.ts | rg 'version: '`. If the current version was bumped only on your unmerged branch, no save exists at it, so two unreleased changes belong in **one** step at the same number. Add to the existing step rather than adding `N → N+1`, and say in the comment why the changes share a version. Bumping anyway is not fatal, it is just a step that can never run for anyone, kept forever by rule 2.

The reverse also holds: never fold away a number that **did** ship, because a real user's save carries it.

## Changelog + docs — pre-commit rule (agents: update before every commit)

- Every commit must update `CHANGELOG.md` **in the same commit** — no code/data/docs commit lands without a changelog entry.
- Same commit must also keep user-facing docs truthful: if the change alters
  behavior described in `README.md` / `README-zh_TW.md` (features, storage, deploy —
  update BOTH, same facts, each in its own voice) or design recorded in `docs/`,
  update those files too — never let README/docs describe a previous version.
  Code comments for internal-only changes. Dev-only details (commands, project
  structure, verification) live in `docs/development.md`, never in the READMEs.
- Newest first: add bullets under the top `## Unreleased` section, grouped into `### Features` / `### Fixes` / `### Chores`. Only `main` deploys to prod (the pre-push hook blocks every other ref), so the cut happens BEFORE a push to `main`, as part of it: when such a push is approved and `Unreleased` is non-empty, commit a `chore: date the changelog` cut first (`## <YYYY-MM-DD> — <short label>`, label from the range's content, fresh `## Unreleased` on top) and push everything together. Cutting pre-push ships one deploy per release instead of two, and the section covers exactly the pushed range — a post-push cut risks sweeping in someone else's intervening commits, and a failed push leaves the cut sitting locally where a retry ships it, never published against work that didn't go. Skip the cut when `Unreleased` is empty. No commit hashes in headings or bullets — they go stale when history is rewritten (amend/rebase).
- Changelog language: English always. Traditional Chinese appears only when quoting actual UI/copy text or when a term has no English counterpart; otherwise write `english (中文)` side-by-side if both help. (Older entries predate this rule — leave them.)
- User-facing changes → `### Features` / `### Fixes`; internal/agent-only changes → `### Chores`.
- If you spot a past commit with no entry, backfill it in the next commit — never let the gap grow.

## Editing CJK files (agents: PowerShell will lie to you, but mostly it will not corrupt)

Every source file here carries Chinese, so this applies to any edit, not just a shop one.
Measured on PowerShell 7.6.6, Windows:

- **Terminal output of CJK is unreadable through a pipe.** `"必換 推薦 優先度"` prints as
  `���� ���� �u����`, and a `rg`/`Get-Content` result containing CJK will look destroyed.
  **This is the display, not the file.** The file above round-tripped byte-identical (24
  bytes, no BOM, no `U+FFFD`) while displaying as garbage. So when output looks corrupted:
  confirm with the editor's own read tool or a `node -e` byte check, do not "fix" the file
  and do not repeat the mojibake as if it were content.
- **The genuinely destructive form is `Set-Content -NoNewline` on an ARRAY.** A 3-line file
  became the single line `必換0推薦1優先度2`. `Get-Content -Raw | Set-Content` (a string,
  not an array) was byte-identical. So: pass `-Raw`, or don't use `Set-Content` at all.
- **Prefer the editor's edit/write tools for any file with CJK.** They round-trip exactly.
  Reach for PowerShell only when a tool cannot do the job, and then never through the
  array-`-NoNewline` path.

## Push discipline (agents: never push without explicit approval)

- Every push to `main` deploys to prod immediately — and `pnpm worker:deploy`
  ships the push fanout the same way. NEVER `git push` / `worker:deploy`
  until the user has explicitly allowed it. "Commit this" never implies
  "push this"; they are separate decisions, every time.
- Ongoing feature work stays UNCOMMITTED in the working tree: the user
  iterates, and premature commits (even local) are noise to amend or unwind.
  Commit only when a piece is done, reviewed, or explicitly requested — one
  logical change per commit, changelog entry included per the rule below.
- Especially for new features: report the diff + verification from the
  working tree, and wait. Review, then commit, then push — three separate
  user decisions, in that order.
- Branch names follow the pushable convention, because the local pre-push hook
  (`.git/hooks/pre-push`, uncommitted by design) blocks every ref except
  `main`, `fix/*`, `feat/*` and `prototype/*`: name a branch for where it may
  go, so a push never dies on the hook. `archive/*`, `backup/*`, `wip/*` and
  unfamiliar names stay local by design — public history is filtered, and a
  same-name branch in another clone may carry what this one must not publish.
  One-off exception: `git push --no-verify`, consciously, never by habit.

## Pre-push Gate (agents: run this before every push)

`pnpm check` = `lint` + `test:shops` + `test:tracker` + `test:icons` + `test:fallbacks` + `test:budget` + `test:worker` + `test:reminders` + `test:drag` + `test:tap` + `test:purple` + `test:migrations` + `test:sync` + `build`. All fourteen must pass:
- `test:shops` bundles `scripts/check-shops.entry.ts` (real recipes/shops/curated-order data): strict shape, currency validity, dup options, no-trade-routes-in-recipes, shop-gold-only, twin probes, curated completeness, and order-list integrity. Run after touching any of the data files.
- `test:tracker` bundles `scripts/check-tracker.entry.ts` (real `tracker.json`): row shape + max rules (a check carries none; a counter/countdown max is >= 1 when present; only a counter may omit it = unbounded, done at >= 1) and `subTasks` link integrity (every child exists, keeps the parent's id prefix, matches the parent's section/kind, is a bounded counter, has exactly one parent, no nested groups). Run after touching `tracker.json`: the failure mode is silent in the app (a broken link renders no child, a duplicate id steals another row's progress).
- `test:migrations` bundles the real `migratePersisted` and runs fixtures in `scripts/migration-check.entry.ts` (versionless save, synthetic barter ids, removed-id prune, passthrough, filter sanitize). If you add a migrate step, add a fixture block (A/B/C/D/E/F pattern) proving old data survives.
- `test:drag` bundles `src/lib/dragRules.ts` and asserts the drag hierarchy in `scripts/check-drag-rules.entry.ts`: a pinned child reorders only inside its own merchant group (a drop outside it lands at the end of that group), a top-level row cannot cross sections, and a grouped pin cannot swap into the plain-row list. Cross-LIST moves need no rule — each list has its own drag context, so a drop cannot resolve outside it. Run after touching `dragRules.ts` or a drag handler.
- `test:tap` bundles `src/lib/tapGate.ts` and pins the tap gate in `scripts/check-tap-gate.entry.ts`: a tile writes only for its own pointer gesture — a tap's click writes once, the click the browser synthesizes for a gesture that ended on another control (the row that slid up when 隱藏已完成 removed the completed one) is refused, a grab/drag's trailing click is refused, and a pointerless activation (keyboard, screen reader, `detail === 0`) is honored. It then scans `src/components` + `src/hooks` for the two shapes that bring the bug back: a pointer-down/up handler that writes progress, and an `onClick` that writes progress with no `ownsClick` guard (sabotage-verified: deleting a tile's guard fails with that tile's file and line). Run after touching `tapGate.ts`, `useGrabCounter.ts`, or a tile's click handler: the failure mode is one tap writing two rows — or a counter clearing itself — and it is silent in the app (measured: the compat click is hit-tested after the reflow, which is why `setPointerCapture` cannot fix it; rationale and the regression's browser case are in `docs/development.md` § Tap rule).
- `test:purple` bundles `src/lib/purpleHole.ts` and pins the schedule's two rays in `scripts/check-purple.entry.ts`: a `next` correction leaves the record's past byte-identical (the 2026-10-14 rule: correcting the next spawn never rewrites the recorded past; only an explicit `anchor` moves it), a passed correction joins the past and re-phases onward, displaced lattice items never surface as future, the seam walk lands on the record, `prevMs` keeps the row behind a recorded spawn exact across a seam, the parse gate rejects a correction at/before the anchor and a previous point at/after it, and the supersede guard refuses a publish that would drop a passed, unrecorded correction (409, record first). Run after touching `purpleHole.ts`, the feed/admin doc shape, or a reminder lane.
- `test:sync` runs `scripts/check-sync.mjs`: hermetic engine/property/tab suites (real store+sync code, always) plus live API + real-Chromium (Playwright) E2E (SKIP loudly without `pnpm dev:api` or the Playwright Chromium — `pnpm install` does not fetch it; run `pnpm exec playwright install chromium` once). If you touch sync, reset, or merge code, these must pass for real — not skipped. Sabotage standard: a suppression/marker change must fail T3 (proven 2026-09-06).
- `test:fallbacks` runs `scripts/check-art-fallbacks.mjs` over `src/`, `api/` and `workers/` plus `public/`: no `src` assignment anywhere (an assignment to a URL that is missing re-enters the error handler forever — that is what drained the team's edge requests on 2026-10-12), every NPC name `shops.json` references has a portrait, every hardcoded `/npc/` or `/items/` filename literal resolves to a file, and the `public/npc/placeholder.png` compat shim is present AND tracked by git (untracked means the deploy 404s the fallback). Run after touching any art `<img>`, its fallback, or an art path. Rationale and measurements: `docs/item-icons.md` § The fallback rule.
- `test:budget` runs `scripts/check-budget.mjs`: the real `public/sw-budget.js` in a `node:vm` realm with a fake `self`/`caches`/`fetch`/clients. Asserts the device request budget never intercepts below its tiers, trips where it says (>400/min, >4,000/30min, >6,000/6h), and past a trip answers every same-origin class instead of fetching (`/api/` as 429, navigations from the preload or pages cache else the network, images from cache else a transparent pixel, everything else from cache else a 503 with Retry-After), with cross-origin never touched. The `importScripts` entry in `vite.config.ts` is load-bearing (the listener must register before the generated routes, or a Workbox route wins the fetch event and the guard is silently disarmed); run it after touching that config or the worker script. It also fails any network call under `src/` made outside the three sanctioned request sites (`sync/api.ts` for `/api/session`, `src/lib/net.ts` for the push registry, and `purpleHole.ts`, which keeps its own throttled feed fetch because that module is shared with the Worker and must stay free of aliased runtime imports), so a new request path cannot land uncounted. See `docs/operations.md` §7.
- `test:worker` runs `scripts/check-worker.mjs`, which bundles the Cloudflare Worker with `wrangler deploy --dry-run` (uploads nothing, needs no auth). The Worker shares pure client modules from `src/lib` by RELATIVE import (`purpleHole`, `hourlyReminders`, `reset`), and it has no tsconfig, so `tsc -b` never sees it and esbuild does not type-check: an aliased (`@/`) runtime import in one of those modules, or a DOM-only dependency, fails only at deploy time. Not hypothetical: an `@/lib/net` import added on 2026-10-12 broke the bundle and nothing else in `pnpm check` noticed. `import type` from an alias is fine, because it is stripped before resolution. Run after touching `workers/` or a shared `src/lib` module.
- `test:reminders` runs `scripts/check-reminders.mjs`: the real `fireHourlyReminder` and the real `public/sw-push.js` (vm realm, fake registration) pin the seam dedup. The local timer fires :00:00 and the CF cron tick lands :00:49-:00:55, so both lanes stamp the event slot (`eventHourOf`, shared with the Worker) into `notification.data.slot` and a same-tag + same-slot card already on screen is replaced with `renotify: false` (the card still shows; only the buzz drops). A previous-slot card, another tag, a missing or junk stamp, or a failed tray lookup all re-alert (fail-open), and a lane that stamps no slot (purple) never queries. Run after touching `hourlyReminders.ts`, `useHourlyReminders.ts`, the SW push handler, or the barrier payload.
- Fixture premises (`hunt` removed, `acc-silver` exists) are tied to live data — if the premise line fails, update the fixture, not the data.
- `suggestions/` is gitignored (review scratch only); `src/data/*.json` is hand-edited and needs human review — fetcher scripts stay private-local (gitignored, never committed).

## Purple schedule corrections (agents)

Timing fixes are live KV data on the worker, not code: use the `purple-schedule`
skill (`skills/purple-schedule/`, invoked as `/purple-fix`), which wraps the
`/admin` API with `MABI_ADMIN_SECRET` from the process environment. A
next-spawn correction is `next <t>`, never `anchor`: correcting the next spawn
must not rewrite the recorded past (the maintainer's 2026-10-14 rule), and
`anchor` is reserved for recording a spawn that was actually observed. A
correction that never happened is dropped with `forget <t>`, never with a false
record. Export the secret, or keep the gitignored `.env.admin.local` at the
repo root and load it per command with `node --env-file=.env.admin.local …`
(never commit, log, or pass it as an argument; not the root `.env.local`, which
`vercel env pull` overwrites). A schedule correction never needs `git push` or
`worker:deploy`. Runbook: `docs/operations.md` §6; the suppression-only window
model, why excluding a window errs safe, and the fixed 36h15m grid:
`docs/purple-hole.md`.
