# Skill: update-tracker — TW-only deterministic seeder

Invoke via coding agent (not raw `pnpm update-barter`) when seeding `src/data/*`.

## When to use
- Any automated `tracker` or `barter` seeding, or after `AGENTS.md` item table changes.
- Before committing `src/data/builtin.ts` or `src/data/barter.json`.

## Inputs (read first)
- `AGENTS.md` — single source of truth for TW hardcodes (`barrier 7`, `black-hole 7+7`), sources, and filtering rules.
- `src/data/builtin.ts` / `src/data/barter.json` — current seed to diff against.

## Steps (deterministic, agent-verified)

1. **Fetch goldens (barter)** — `NOTEBOOK_URL=https://mabinogi-mobile-notebook.vercel.app/barter-data.js` and `YENYEN_URL=https://mabi.yenyen.dev/`. Parse `window.MABINOGI_BARTER_DATA`, take `verified==="tw"` (70) as seed. Do **not** seed `verified==="kr"` (18). Optionally union `yenyen 86` (log 16 extra). `nipponhashi/barter` 226 is diff-only, never seed.
2. **Fetch tracker TW** — `TW_URL=https://mabinogimobile.nipponhashi.com/tracker/` default `tw` (do not set `kr`). Verify `button[data-server-set="tw"].active` and `server-switch-hint`. If selector missing, stop and report site change.
3. **Filter** — Exclude any node with `data-server="kr"`, `hidden` when `tw` active, or text `韓服`/`KR預覽`/`台服未實裝`. For tracker, apply `AGENTS.md` hardcode: `barrier max 7` and `black-hole daily1+weekly7=14` (counter 0/7) — do not re-derive from `韓服社群` fallback.
4. **Diff & log** — `TW: ${tw.length} / SKIPPED_KR: ${kr.length} / yenyen_extra: ${extra}`. If counts drift >10 from `AGENTS.md` (20 tracker, ~70 barter), flag for human review.
5. **Write** — `src/data/barter.json` from `tw` set only (keep `priority=must` shape, preserve `perChar`/`limit`/`rec`), `src/data/builtin.ts` with 20 rows per `AGENTS.md` (keep hardcoded descs). Do not invent `town`/`skill`.
6. **Verify** — `pnpm build` must pass; `pnpm update-barter:dry` must show `TW70 must10 / KR18` style log.
7. **Commit gate** — Show diff and ask human to confirm `AGENTS.md` hardcode still valid before `git commit`.

## Commands
```bash
pnpm update-barter:dry   # barter dry-run (script only, deterministic)
pnpm update-barter       # barter write (script only)
# Full (agent): fetch tracker tw + notebook + yenyen, apply hardcode, build, confirm
```

## Non-goals
- Never fetch `/ko/*` for seeding.
- Never overwrite `barrier`/`black-hole` with `韓服社群數值` without human bump of `AGENTS.md`.

## References
- `AGENTS.md` Filtering Rules pseudo
- `scripts/update-barter.mjs` (barter goldens)
- `src/data/builtin.ts` (20 TW rows)
