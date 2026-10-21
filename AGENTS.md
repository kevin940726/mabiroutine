# AGENTS — repo runbook for agents

Data knowledge lives in `docs/` (read it before touching data or sync):
- `docs/tracker-data.md` — TW-only sources, item inventory, filtering rules.
  Hard rule: **never seed KR rows into `src/data/*`**.
- `docs/sync.md` — sync protocol, key space, decisions, quota.

## The dev loop (agents: the user verifies; ask before spending their resources)

- **UI verification is the user's.** In a rapid loop they run the app and report
  back — faster and more reliable than a browser run of yours. Report the diff and
  what you checked, then stop: no Playwright, no headless browser, no
  screenshot/vision pass for a small feature or a bug fix unless they ask for one
  ("keep testing" / "verify it yourself" is that ask). The standing browser suites
  stay where they are — `test:shop-e2e` before a release, `test:sync`'s live legs
  when its trigger fires — and `pnpm check` stays offline.
- **Never start a dev server unasked.** One is usually already up: plain Vite on
  `:5173` (UI only, no `/api/*`), or `vercel dev` on `:52608` when sync or an API
  route is in scope — check which checkout a port serves before trusting it
  (`docs/development.md` § First run). Otherwise ask them to start one in their own
  terminal (the default), or ask before a background one; a silent background
  server is never the choice. Say which you used, and stop the one you started.

## Store Version Bumps (persist schema `useAppStore.ts`, current `v23`)

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

- Every commit updates `CHANGELOG.md` **in the same commit** — no code/data/docs
  commit lands without an entry. The pre-push hook checks it, so a missing entry
  is a blocked push rather than a review comment.
- Same commit keeps user-facing docs truthful: a change to behavior described in
  `README.md` / `README-zh_TW.md` (features, storage, deploy — update BOTH, same
  facts, each in its own voice) or to design recorded in `docs/` updates those
  files too — never let README/docs describe a previous version. Code comments for
  internal-only changes; dev-only details (commands, structure, verification) live
  in `docs/development.md`, never in the READMEs.
- Write a time window as reset boundaries, not a weekday name: "Sun 06:00 → Mon
  06:00", never "only on Sunday" — the 2026-10-19 plan said the latter about a
  window the code did not implement, and the mismatch came back as a bug report.
- Bullets go newest-first under the top `## Unreleased`, grouped into
  `### Features` / `### Fixes` / `### Chores`. A user-facing change is Features or
  Fixes; an internal or agent-only change is Chores.
- **The release label rides in the commit you push — there is no cut commit.**
  Only `main` deploys, so the cut happens as part of an approved push to it, and
  the label is one edit that belongs to the tip: rename `## Unreleased` to
  `## <YYYY-MM-DD> — <label>` (label from the range's content) with a fresh empty
  `## Unreleased` above it, then fold that edit into the tip commit
  (`git commit --amend --no-edit` after staging) — the tip is unpushed by
  definition, which is exactly why the label can ride there. A separate
  `chore: date the changelog` commit said nothing the heading does not, so it is
  gone. Do not amend a tip the user made: make the label its own small commit and
  say so. Skip the cut when `Unreleased` is empty.
- A release with player-visible changes also writes its zh section in
  `CHANGELOG-zh_TW.md` and regenerates `src/data/whatsNew.generated.json`
  (`node scripts/whats-new.mjs --write`) in the same commit as the English
  heading; an internal-only release carries `<!-- whats-new: none -->` under
  that heading instead. `test:whatsnew` enforces it — the runbook is
  `docs/development.md` § Cutting a release.
- The zh-TW copy is gated by the committed `tech-doc-zh-tw` skill
  (`.agents/skills/tech-doc-zh-tw/SKILL.md`): load it before writing or
  reviewing `CHANGELOG-zh_TW.md`, `README-zh_TW.md`, or any player-facing UI
  string, and run its 最終檢查 before committing. `test:whatsnew` is the
  mechanical gate for structure, parity and code-free copy; it cannot judge
  voice. Game data names in `src/data/*.json` are data, not prose — leave them
  alone.
- Language: English always. Traditional Chinese only when quoting UI or copy text,
  or when a term has no English counterpart; `english (中文)` side by side when
  both help. (Older entries predate this — leave them.) No commit hashes in
  headings or bullets: they go stale when history is rewritten.
- A past commit with no entry: backfill it in the next commit.

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
  ships the push fanout the same way. NEVER `git push` / `worker:deploy` until the
  user has explicitly allowed it. "Commit this" never implies "push this"; they are
  separate decisions, every time.
- Ongoing feature work stays UNCOMMITTED in the working tree: the user iterates,
  and premature commits (even local) are noise to amend or unwind. Commit when a
  piece is done, reviewed, or requested — one logical change per commit, changelog
  entry included per the rule above.
- Especially for new features: report the diff + verification from the working
  tree, and wait. Review, then commit, then push — three separate user decisions,
  in that order.
- Name a branch for where it may go. The local pre-push hook
  (`.git/hooks/pre-push`, uncommitted by design) blocks every ref except `main`,
  `fix/*`, `feat/*` and `prototype/*`: `archive/*`, `backup/*`, `wip/*` and
  unfamiliar names stay local by design — public history is filtered, and a
  same-name branch in another clone may carry what this one must not publish. It
  also runs the gate below, so a push either passes it or takes
  `git push --no-verify`, consciously, never by habit. The hook covers `git push`
  only: `pnpm worker:deploy` is not hooked, so run `pnpm check` yourself first.

## Pre-push Gate (agents: run it before every push; the hook enforces it)

`pnpm check` = `node scripts/check-all.mjs` = `lint` + `test:shops` + `test:tracker` + `test:docs` + `test:prepush` + `test:icons` + `test:fallbacks` + `test:budget` + `test:worker` + `test:reminders` + `test:drag` + `test:tap` + `test:purple` + `test:migrations` + `test:sync` + `test:whatsnew` + `build`. All seventeen must pass. The runner prints one line per gate and stops at the first failure, so the last lines are the verdict — never truncate to a tail that could hide it (`--verbose` streams a gate's own output; `node scripts/check-all.mjs <gate>…` runs a subset while iterating).

Run it before you ask to push, and the hook will not have to tell you. The hook calls `scripts/pre-push-gate.mjs`, which adds the two changelog rules above: every pushed commit must touch `CHANGELOG.md`, and a `main` push must leave `## Unreleased` empty. `git push --no-verify` skips it.

Each line below is when the gate fires and what its silence costs. The check list, the incident behind it, and its sabotage standard are `docs/development.md` § Gates.

- `test:shops` — after any `src/data` file (recipes, shops, curated order). Wrong data ships silently.
- `test:tracker` — after `tracker.json`. Silent in the app: a broken `subTasks` link renders no child, a duplicate id steals another row's progress.
- `test:docs` — after the row set, a row's `max`, or any doc or skill quoting those numbers. A stale instruction misleads the next writer.
- `test:prepush` — after changing `scripts/pre-push-gate.mjs` or the changelog rules: its own outcomes, pinned in a throwaway repo (a commit with no changelog change, an unlabelled `## Unreleased` on `main` stopping before the suite, a `feat/*` ref skipping that rule, a dirty tree with a failing suite, a bad revision range). The hook blocks pushes on its say-so, so a silent regression here is a rule that stops being enforced.
- `test:icons` — after `src/lib/itemIcon.ts` or the item data. The emitted path fails silently in two directions.
- `test:fallbacks` — after any art `<img>`, its fallback, or an art path. An error handler reassigning a missing URL loops forever (2026-10-12).
- `test:budget` — after `public/sw-budget.js`, the workbox config, or anything changing what the SW intercepts. A disarmed guard spends the device request budget.
- `test:worker` — after `workers/` or a shared `src/lib` module. No tsconfig, so an aliased runtime import or a DOM-only dependency fails only at deploy.
- `test:reminders` — after `hourlyReminders.ts`, `useHourlyReminders.ts`, the SW push handler, or the barrier payload. The seam double-alerts.
- `test:drag` — after `dragRules.ts` or a drag handler. A row lands outside its own group or section.
- `test:tap` — after `tapGate.ts`, `useGrabCounter.ts`, or any tile's click handler. One tap writes two rows, or a counter clears itself — invisible in review.
- `test:purple` — after `purpleHole.ts`, the feed/admin doc shape, or a reminder lane. A correction rewrites the recorded past.
- `test:migrations` — after adding a `migratePersisted` step. A user's save loses progress; add a fixture block (A/B/C/D/E/F) proving it survives.
- `test:sync` — after any persisted-write path: `src/sync/**`, `api/**`, `src/lib/reset.ts`, a `useAppStore` action that writes values or buckets, `applyResets` / `normalizeTaskBuckets` / `checkResets`, or a reminder lane (`hourlyReminders.ts`, `useHourlyReminders.ts`, `public/sw-push.js`, `workers/`). `node scripts/needs-live-sync.mjs` reads the diff and answers this for you. The live legs must pass for real, not skip (they need `pnpm dev:api` and the Chromium); a suppression or marker bug wipes a device.
- `test:whatsnew` — after `CHANGELOG.md`, `CHANGELOG-zh_TW.md`, or `src/data/whatsNew.generated.json`. A release with no zh section is copy the player-facing record never wrote, a stale JSON is the drawer rendering the previous cut, and a reworded English heading orphans the marker the seen state keys on. It is the only reader of all three files.
- Fixture premises (`hunt` removed, `acc-silver` exists) are tied to live data — if a premise line fails, update the fixture, not the data.
- `suggestions/` is gitignored (review scratch); `src/data/*.json` is hand-edited and needs human review — except `whatsNew.generated.json`, which only `scripts/whats-new.mjs --write` produces — fetcher scripts stay private-local, never committed.

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
