# AGENTS — repo runbook for agents

Data knowledge lives in `docs/` (read it before touching data or sync):
- `docs/tracker-data.md` — TW-only sources, item inventory, filtering rules.
  Hard rule: **never seed KR rows into `src/data/*`**.
- `docs/sync.md` — sync protocol, key space, decisions, quota.

## Store Version Bumps (persist schema `useAppStore.ts`, current `v13`)

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
- Newest first: add bullets under the top `## … — Unreleased batch` section; once the hash is known, give the batch its own dated section (`## 2026-09-03 (\`abc1234\`)`) so each entry links its commit.
- User-facing changes → `### Features` / `### Fixes`; internal/agent-only changes → `### Chores`.
- If you spot a past commit with no entry, backfill it in the next commit — never let the gap grow.

## Pre-push Gate (agents: run this before every push)

`pnpm check` = `lint` + `test:migrations` + `test:sync` + `build`. All four must pass:
- `test:migrations` bundles the real `migratePersisted` and runs fixtures in `scripts/migration-check.entry.ts` (versionless save, synthetic barter ids, removed-id prune, passthrough, filter sanitize). If you add a migrate step, add a fixture block (A/B/C/D/E/F pattern) proving old data survives.
- `test:sync` runs `scripts/check-sync.mjs`: hermetic engine/property/tab suites (real store+sync code, always) plus live API + real-Edge E2E (SKIP loudly without `pnpm dev:api`/Edge). If you touch sync, reset, or merge code, these must pass for real — not skipped. Sabotage standard: a suppression/marker change must fail T3 (proven 2026-09-06).
- Fixture premises (`hunt` removed, `acc-silver` exists) are tied to live data — if the premise line fails, update the fixture, not the data.
- `suggestions/` is gitignored (review scratch only); `src/data/*.json` is hand-edited and needs human review — fetcher scripts stay private-local (gitignored, never committed).
