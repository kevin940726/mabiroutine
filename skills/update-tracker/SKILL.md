# Skill: update-tracker — manual-first, fetch-as-suggestion

The human owns `src/data/*` by hand. Fetchers only produce reference diffs.
No script or agent step writes `tracker.json` / `barter.json` without an explicit
human "apply this" for the specific rows.

## When to use
- After `AGENTS.md` item table changes (human edited it first).
- When the human asks "what changed upstream?" — answer with a suggestion diff.

## Inputs (read first)
- `AGENTS.md` — single source of truth for TW hardcodes (`barrier 7`, `black-hole 7+7`), sources, and filtering rules.
- `src/data/tracker.json` / `src/data/barter.json` — the hand-maintained files; diff target, never write target.

## Steps

1. **Suggest, don't seed** — run the fetchers; they only write `suggestions/` (gitignored):
   ```bash
   pnpm suggest-tracker   # diff tracker.json rows vs TW tracker page -> suggestions/tracker.json
   pnpm suggest-barter    # diff barter.json vs notebook70+yenyen -> suggestions/barter.json
   ```
2. **Report the diff** — added / removed / changed rows, plus `twViewVerified` and
   `krMentions` from the tracker check. If counts drift >10 from `AGENTS.md`
   (20 tracker, ~98 barter), flag for human review.
3. **Human applies by hand** — edit `src/data/tracker.json` / `src/data/barter.json`
   directly. Keep `AGENTS.md` hardcodes: `barrier max 7`, `black-hole` counter
   0/7 with the 7+7 desc — do not re-derive from `韓服社群` fallback text.
   Do not invent `town`/`skill`; never add `verified:"kr"` rows.
4. **Verify** — `pnpm build` must pass after hand edits.

## Escape hatch (explicit human approval only)
- `pnpm update-barter` (= `--write`) overwrites `barter.json` and wipes manual
  edits. Use only when the human says so for a full reseed.

## Non-goals
- Never fetch `/ko/*` for seeding.
- Never overwrite `barrier`/`black-hole` with `韓服社群數值` without human bump of `AGENTS.md`.
- Never commit `suggestions/` (gitignored references).

## References
- `AGENTS.md` Filtering Rules pseudo
- `scripts/suggest-tracker.mjs`, `scripts/update-barter.mjs` (suggest by default)
- `src/data/tracker.json` (20 TW rows, hand-owned), `src/data/barter.json` (98 rows, hand-owned)
