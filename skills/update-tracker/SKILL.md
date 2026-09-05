# Skill: update-tracker — manual-only, no fetchers

The human owns `src/data/*` by hand. The fetcher scripts are private-local
only (gitignored, never committed, never published) — the committed tree has
no scrapers. No agent step writes `tracker.json` / `barter.json` without an
explicit human "apply this" for the specific rows.

## When to use
- After `docs/tracker-data.md` item table changes (human edited it first).
- When the human asks "what changed upstream?" — answer by reading the source
  pages in a browser by hand and reporting the diff.

## Inputs (read first)
- `docs/tracker-data.md` — single source of truth for TW hardcodes (`barrier 7`, `black-hole 7+7`), sources, and filtering rules.
- `src/data/tracker.json` / `src/data/barter.json` — the hand-maintained files; diff target, never write target.

## Steps

1. **Check by hand, don't scrape** — open the source pages in a browser
   (nipponhashi tracker TW view, notebook `barter-data.js` `verified:"tw"`,
   yenyen list) and compare against the JSON rows. No `fetch`, no scripts,
   no bulk download.
2. **Report the diff** — added / removed / changed rows. If counts drift far
   from `docs/tracker-data.md` (21 tracker, 92 barter), flag for human review.
3. **Human applies by hand** — edit `src/data/tracker.json` / `src/data/barter.json`
   directly. Keep hardcodes: `barrier max 7`, `black-hole` max 14 (7+7) —
   do not re-derive from `韓服社群` fallback text.
   Do not invent `town`/`skill`; never add `verified:"kr"` rows.
   Write `note` in our own voice (see README 出處與授權 + DATA_LICENSE).
4. **Verify** — `pnpm build` must pass after hand edits.

## Non-goals
- Never use `/ko/*` content for seeding.
- Never overwrite `barrier`/`black-hole` with `韓服社群數值` without a human bump of `docs/tracker-data.md`.
- Never commit the private fetcher scripts or re-add them to the tree.

## References
- `docs/tracker-data.md` Filtering Rules + Source terms
- `src/data/tracker.json` (21 TW rows, hand-owned), `src/data/barter.json` (92 rows, hand-owned)
