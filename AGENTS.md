# AGENTS — repo runbook for agents

Data knowledge lives in `docs/` (read it before touching data or sync):
- `docs/tracker-data.md` — TW-only sources, item inventory, filtering rules.
  Hard rule: **never seed KR rows into `src/data/*`**.
- `docs/sync.md` — sync protocol, key space, decisions, quota.

## Store Version Bumps (persist schema `useAppStore.ts`, current `v17`)

Key `mabiroutine:v2` is the storage slot name (stable); `version` is the schema number (bumps).
User progress always wins — migrate only fills defaults and prunes dangling keys, never overwrites values.

Checklist when persisted shape changes (new/renamed/removed field, removed row ids):
1. Bump `version` in **two** places: `initial.version` and persist config `version`.
2. Append `if (from < N) { ...; s.version = N; }` in `migratePersisted` — chain from the previous number, keep old steps forever (users may skip releases). `normalizePersisted` runs before steps on every load, so steps can assume full shape.
3. Removing row ids → extend the v6 prune pattern (add the new dangling container, or it generalizes already via the `valid` set of tracker+barter+custom ids).
4. Renaming a row id → add an explicit id-remap in the new step (prune would drop the old progress otherwise); tell the user first.
5. `pnpm build` must pass; user-facing impact goes in `CHANGELOG.md` + READMEs (`README.md` / `README-zh_TW.md`) or `docs/storage.md` as appropriate.

## Changelog + docs — pre-commit rule (agents: update before every commit)

- Every commit must update `CHANGELOG.md` **in the same commit** — no code/data/docs commit lands without a changelog entry.
- Same commit must also keep user-facing docs truthful: if the change alters
  behavior described in `README.md` / `README-zh_TW.md` (features, storage, deploy —
  update BOTH, same facts, each in its own voice) or design recorded in `docs/`,
  update those files too — never let README/docs describe a previous version.
  Code comments for internal-only changes. Dev-only details (commands, project
  structure, verification) live in `docs/development.md`, never in the READMEs.
- Newest first: add bullets under the top `## Unreleased — …` section, grouped into `### Features` / `### Fixes` / `### Chores`. Every push to `main` deploys to prod, so when you push, rename that section to `## <YYYY-MM-DD> — <short label>` and start a fresh `## Unreleased`. No commit hashes in headings or bullets — they go stale when history is rewritten (amend/rebase).
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

## Pre-push Gate (agents: run this before every push)

`pnpm check` = `lint` + `test:shops` + `test:migrations` + `test:sync` + `build`. All five must pass:
- `test:shops` bundles `scripts/check-shops.entry.ts` (real recipes/shops/barter data): strict shape, currency validity, dup options, no-trade-routes-in-recipes, shop-gold-only, twin cap parity, and every barter shop row curated in `barter.json`. Run after touching any of the three data files.
- `test:migrations` bundles the real `migratePersisted` and runs fixtures in `scripts/migration-check.entry.ts` (versionless save, synthetic barter ids, removed-id prune, passthrough, filter sanitize). If you add a migrate step, add a fixture block (A/B/C/D/E/F pattern) proving old data survives.
- `test:sync` runs `scripts/check-sync.mjs`: hermetic engine/property/tab suites (real store+sync code, always) plus live API + real-Edge E2E (SKIP loudly without `pnpm dev:api`/Edge). If you touch sync, reset, or merge code, these must pass for real — not skipped. Sabotage standard: a suppression/marker change must fail T3 (proven 2026-09-06).
- Fixture premises (`hunt` removed, `acc-silver` exists) are tied to live data — if the premise line fails, update the fixture, not the data.
- `suggestions/` is gitignored (review scratch only); `src/data/*.json` is hand-edited and needs human review — fetcher scripts stay private-local (gitignored, never committed).

## Purple schedule corrections (agents)

Timing fixes are live KV data on the worker, not code: use the `purple-schedule`
skill (`skills/purple-schedule/`, invoked as `/purple-fix`), which wraps the
`/admin` API with `MABI_ADMIN_SECRET` from the process environment. Export it,
or keep the gitignored `.env.admin.local` at the repo root and load it per
command with `node --env-file=.env.admin.local …` (never commit, log, or pass it
as an argument; not the root `.env.local`, which `vercel env pull` overwrites).
A schedule correction never needs `git push` or `worker:deploy`. Runbook:
`docs/operations.md` §6; the pause assumption and why excluding a window errs
safe: `docs/purple-hole.md`.
