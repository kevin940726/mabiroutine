# Plan — The guardrail layer: enforcement, triggers, and what AGENTS.md carries

Status: PARTLY LANDED 2026-10-19 — §9 records what shipped and what is still open;
§3 holds the choices that remain.

Read §1 (the three leaks) and §3 (the choices) before touching anything.

The other two retro findings are deliberately out of scope: §8 says why.

## 1. The problem: the gate layer leaks in three places

`pnpm check` is fifteen gates and AGENTS.md says all must pass before a push.
Three separate things stop that from being true on its own.

### 1.1 Nothing runs the suite except an agent deciding to

- No `.github/` — there is no CI.
- No pre-commit hook (`.git/hooks/` holds only `.sample` files).
- `.git/hooks/pre-push` exists but is uncommitted by design and only *filters
  refs* (`main`, `fix/*`, `feat/*`, `prototype/*`). It runs no checks.
- `vercel.json` sets no `buildCommand`, so a deploy enforces `tsc -b && vite
  build` and nothing else. Lint and the twelve `test:*` gates are not covered.

`main` deploys on push, and AGENTS.md calls several gates' failure modes "silent
in the app" (a broken `subTasks` link renders no child; a `src` assignment loops
the error handler; a moved `importScripts` disarms the request budget). So the
suite is a habit, not a guardrail: the one actor that always runs it is the agent
that already chose to.

### 1.2 The live-sync trigger is a judgement call

AGENTS.md: "If you touch sync, reset, or merge code, these must pass for real —
not skipped." The black-hole diff added a store action that writes task values
(`writeBlackHole`) and a `checkResets()` call, so "did this touch reset code?" had
no answer in the rule: the agent skipped the live legs and flagged the skip for
you. The rule exists because suppression and marker bugs are invisible, which is
the worst place to leave a coin flip.

### 1.3 AGENTS.md carries rationale that the implementer does not need every turn

Measured today: AGENTS.md is 111 lines / 2,544 words, and **1,317 of those words
(52%) are the gate section**. `docs/development.md` describes the same rules in
1,428 words — the two files say the same things twice, and one copy is in every
turn while the other is a lookup. The duplicate copy is also the one that goes
stale: the black-hole rework's stale facts lived in AGENTS.md's neighbours, not
in the JSON.

## 2. The three changes

### 2.1 Enforcement — pick what actually protects

Three options, and what each one really buys:

- **A. The local pre-push hook runs `pnpm check`.** Protects this machine. Cost:
  the suite measures ~35-45s (build 9-19s, `test:sync` ~8s), acceptable for a
  push. Limits: the hook is uncommitted, so another clone gets nothing, and
  `--no-verify` skips it. It makes the AGENTS.md rule mechanical and composes with
  `scripts/check-all.mjs`'s verdict line (the hook's output ends on
  `check: 15/15 gates passed` or a named failure).
- **B. A GitHub Actions workflow (`pnpm install && pnpm check`).** Protects the
  repo: any clone, any contributor, any `--no-verify`. Limit, and it is the one
  that matters: **on `main` it runs after the push that already deployed.** It
  detects, it does not prevent. Prevention needs a PR gate plus branch protection,
  and this repo pushes to `main` directly today — that is a workflow change, not a
  YAML file. `test:sync`'s live legs need `pnpm dev:api` and a database, so they
  skip in CI; the hermetic legs run, which is exactly the coverage the agent had.
- **C. Both.** A as the fast local mirror, B as the durable record.

Recommendation: **A now, B when PRs are on the table.** If only one: A — it is
cheap, immediate, and it is the only option that can stop a push.

Also decide: `test:shop-e2e` is not in `check` (it needs `pnpm dev` + the pinned
Chromium, and `docs/development.md` argues a browser suite needing a dev server
does not belong in the offline gate). Either CI grows a second job for it or it
stays the pre-release manual gate it is today.

### 2.2 The live-sync trigger becomes a condition

Replace the judgement call with a list, and make the list checkable:

- `src/sync/**`, `api/**`, `src/lib/reset.ts`;
- any store action that **writes persisted values** — the case the current wording
  missed, because `writeBlackHole` is not "sync code" by path but is a new write
  path into the flat-key protocol;
- the reset/merge symbols: `applyResets`, `normalizeTaskBuckets`, `checkResets`;
- the Worker's reminder and reset lanes (`workers/**`).

Two shapes, pick one or both:

- **A. Reword the AGENTS.md bullet** to that list, so the rule reads as a
  condition rather than a vibe.
- **B. Add `scripts/needs-live-sync.mjs`**: reads `git diff --name-only
  origin/main...HEAD` (and `--cached`), matches the list, and prints
  `live sync: REQUIRED (src/store/useAppStore.ts)` or `live sync: not needed`,
  naming every path it matched. Advisory, so a false positive is visible rather
  than silent. Wires into the pre-push flow next to `check`.

Recommendation: A + B. C (always run the live legs) is rejected as a default: it
needs a running `pnpm dev:api` and the Playwright Chromium, so it cannot be the
gate on a machine without them.

### 2.3 AGENTS.md keeps the trigger, `docs/development.md` keeps the why

The split rule, per gate bullet:

- **Stays inline**: what the gate checks (one clause), when to run it, and its
  failure mode — the consequence is the part that makes an agent actually run it.
- **Moves out**: the incident history and measurements (the 2026-10-12 request
  loop, the measured tap regression, the `importScripts` ordering), which
  `docs/development.md` already carries for several rules (§ Tap rule, the
  fallback rationale). AGENTS.md links `§ <rule>`.

Target: the gate section from 1,317 words to ≤ ~450 (triggers and consequences),
AGENTS.md to ≤ ~1,700 words. Every gate name must still appear in AGENTS.md — the
pointer's wording is what makes a gate fire, so a name that moves out of the file
is a gate that stops running.

De-duplicate while doing it: `docs/development.md` re-lists all fifteen gate names
(line 94). One file should own the list. Recommend AGENTS.md owns names + triggers
(the always-loaded one, so the trigger cannot be missed) and development.md owns
the rationale and stops re-listing.

Note: the `test:docs` bullet added in `8120c2b` is written in the current
rationale-heavy style on purpose — it is one of the paragraphs this section moves.

## 3. Decisions to make

1. **Enforcement**: A, B, or both? If B: does a PR gate plus branch protection
   enter the workflow (the only form that prevents rather than detects), and does
   CI get a `test:shop-e2e` job?
2. **Live-sync trigger**: is "a store action that writes persisted values" in the
   list? (I think yes — it is this session's case.) And the helper script, or
   wording only?
3. **AGENTS.md**: is ≤ ~1,700 words the right target, and does
   `docs/development.md` own the rationale outright (i.e. is one always-loaded
   list enough)?
4. None of this touches the persisted store shape, so there is no schema bump and
   no migration work in any of the three.

## 4. Shape of the change

| File | Change |
| --- | --- |
| `AGENTS.md` | Reword the live-sync rule to a condition; trim the gate section to triggers + consequences, linking `§ <rule>` in `docs/development.md`. |
| `docs/development.md` | Absorb the moved rationale; stop re-listing the gate names; keep the runner's description (`check-all.mjs`) as the place the mechanics live. |
| `scripts/needs-live-sync.mjs` | New. Diff → `live sync: REQUIRED / not needed`, naming matched paths. |
| `scripts/check-doc-facts.mjs` | Extend (or add to `check-all.mjs`): every gate name in the runner's list must appear in `AGENTS.md`. |
| `.github/workflows/check.yml` | New, only if B. |
| `.git/hooks/pre-push` | Local, uncommitted by design: add the `pnpm check` run, only if A. Never commit it. |
| `CHANGELOG.md` | A `### Chores` bullet per commit, per the standing rule. |

## 5. Task breakdown

Cheap and safe first, and the guard before the surgery it protects:

1. **Reword the live-sync rule + add `scripts/needs-live-sync.mjs`.** No
   infrastructure, no behaviour change. One commit.
2. **Extend `test:docs` with the gate-name guard** (every `--list` name appears in
   `AGENTS.md`). One commit. Sabotage it by deleting a name.
3. **Trim AGENTS.md, expand `docs/development.md`.** Review-heavy, no behaviour
   change; the guard from 2 makes a lost trigger a failure rather than a hope.
   One commit.
4. **CI workflow (if B) and/or the local hook (if A).** One commit. If A, the hook
   edit stays out of the commit (it lives in `.git/`).

## 6. Verification

- **1**: `node scripts/needs-live-sync.mjs` prints `REQUIRED` for a diff touching
  `src/store/useAppStore.ts` and `not needed` for a docs-only diff; then run
  `pnpm dev:api` + `pnpm test:sync` for real once and confirm the live legs do not
  skip.
- **2**: delete a gate name from AGENTS.md and the check fails naming that gate.
- **3**: `AGENTS.md` word count at or under target; every `--list` name present
  (guard 2); every moved paragraph greps in `docs/development.md`; a read-through
  of the trim for a lost *why*.
- **4**: the workflow goes green on a clean PR and red on one with an
  intentionally broken `tracker.json` (a duplicated row id is the cheapest red);
  a local pre-push run blocks a push with a failing gate.

## 7. Traps

- **CI on `main` cannot prevent a deploy** — it detects one. Only the local hook
  or a PR gate prevents. Do not sell B as prevention.
- **A green `test:sync` in CI is not evidence the live path works**: the live legs
  skip loudly (exit 0) without `pnpm dev:api` and a database. Keep the real local
  run for anything the trigger matches.
- **Trimming AGENTS.md can delete the reason a gate fires.** Move measurements and
  incident history; keep the consequence ("a broken link renders no child"). The
  consequence is the load-bearing half.
- **The pre-push hook is uncommitted by design** (public history stays filtered).
  Running checks in it does not change that, and the hook file must not be
  committed.
- **`pnpm check` stops at the first failure now**, so a hook or CI run reports one
  gate at a time; a red push may need a second run to reveal the next failure.
  That is the deliberate trade for a verdict-shaped output.

## 8. Not in this plan

- **A behavior window is written as reset boundaries, not a weekday name**
  ("Sun 06:00 → Mon 06:00", never "only on Sunday"). A reviewer-side writing
  convention, no code — the 2026-10-19 plan's "hides only on Sunday" wording cost
  a user round trip by describing a window the code did not implement.
- **A dev-only clock.** You declined the `?clock=` form once; the console
  `Date.now` override works for a one-off weekday check.
- **Moving the store-version-bump checklist out of AGENTS.md.** Same family as
  §2.3, but judgement-heavy per step; worth its own pass once the gate section has
  moved.

## 9. Landed so far (2026-10-19)

- **§2.3, the AGENTS.md split — done.** The gate section went from 1,317 words to
  499 (a trigger plus what its silence costs; the check lists, incidents and
  sabotage standards now live in § Gates above), and the file from 2,544 words to
  1,903. It is over the 1,700-word target because the same rewrite added
  `## The dev loop` (~150 words: UI verification is the user's, and never start a
  dev server unasked) — a new rule, not a moved one. All fifteen names from
  `node scripts/check-all.mjs --list` still appear in AGENTS.md; that was checked
  by hand, and §5.2's guard is what would make it a gate.
- **§2.1, enforcement — option A done, B open.** `.git/hooks/pre-push` (still
  uncommitted, still filtering refs) now calls `scripts/pre-push-gate.mjs`, which
  runs `pnpm check` and the changelog rules, stopping before the suite when the
  changelog fails. Verified by hand: an unlabelled `## Unreleased` blocks a `main`
  push before the suite runs, a clean ref runs 15/15, and a `wip/*` ref is still
  filtered. CI (B) is untouched.
- **The changelog model changed with it.** The `chore: date the changelog` commit
  is gone: the release label is folded into the tip commit (`git commit --amend
  --no-edit`), and the hook enforces both halves — a `CHANGELOG.md` change in every
  pushed commit, and an empty `## Unreleased` on a `main` push. That was not in
  this plan; it came out of the same rethink and is recorded in `AGENTS.md`
  § Changelog.
- **Still open**: §2.2 (the live-sync trigger still reads "sync, reset, or merge
  code" — §3.2's question stands), §2.1 option B (CI), and §5.2 (the gate-name
  guard, the mechanical form of what was checked by hand here).
