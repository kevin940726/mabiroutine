# Plan — floating switch bar: character pill in tracker, filter/search pill in barter

Status: APPROVED for build. Branch `feat/barter-filter-pill`, cut from `main` at
`8c11235`. No code yet; T1–T5 below are the build order.

**Read section 0 first.** It is the handoff: where the branch stands, what is
next, and the traps that cost time getting here. Everything after it is the
design of the change.

---

## 0. Handoff — start here

### Where things stand

- **Branch:** `feat/barter-filter-pill`, cut from `main` at `8c11235`. Local
  only: **not pushed**, no PR, nothing committed on it yet. This doc is its
  first commit.
- **`main` is ahead of `origin/main`** and contains the merged shop-browser
  branch plus one later commit (`8c11235`, an unrelated hourly-barrier cron
  experiment from another session). The shop browser is already on local `main`
  but **not pushed**, so PR #2 (`wip/shop-browser` → `main`) is still open.
- **Worktree layout matters here.** This repo uses two worktrees:
  - `C:/Users/User/work/mabiroutine` — this one, on `feat/barter-filter-pill`.
  - `C:/Users/User/work/mabiroutine-main` — holds `main`.
  So `git checkout main` **fails** in this worktree ("already used by worktree").
  To inspect `main`, use `git -C C:/Users/User/work/mabiroutine-main …` or
  `git log main`; do not try to switch to it.
- **`docs/plans/` was untracked** on the branch; this commit makes it tracked for
  the first time. Nothing else in the tree is dirty.

### What is next, in order

Build T1–T5 (below) in order, each ending in a working, verifiable state. Per
`AGENTS.md`: **commit only when asked**, one logical change per commit, changelog
entry in the same commit; **never push** without explicit approval. The user runs
Vite on `http://localhost:5173` and iterates visually — prefer measured
in-browser numbers over argument.

1. **T1** — gate the character pill on `tab === "tracker"` (both variants).
2. **T2** — empty `<FilterPill>` in `MerchantPanel`, fixed in the pill slot,
   shown past a local scroll threshold.
3. **T3** — search icon + expanding inline input, wired to the panel's `query`.
4. **T4** — the four compact filter buttons (城鎮 / NPC / 優先度 / 類型), 清除,
   已選 N.
5. **T5** — polish, only-one-surface check, mobile + desktop, changelog + docs.

Each user-visible task needs a `CHANGELOG.md` `### Features` bullet in its own
commit; READMEs (`README.md` / `README-zh_TW.md`) only if the feature is described
there. No store version bump (Q1 keeps the filters in the panel).

### Traps that cost time (read before editing)

- **Worktrees.** See above: `main` cannot be checked out from here. Also, a
  `git stash`/fast-forward dance on `main` collided on `CHANGELOG.md` earlier
  because both sides edit the top `## Unreleased` — if you touch `main` again,
  expect that file to conflict.
- **CJK terminal output is a lie, the file is fine.** PowerShell pipes render
  Chinese as mojibake; that is the display, not corruption. Verify with the
  editor read tool or a `node -e` byte/line-ending check, never by "fixing" the
  file. Prefer the editor edit/write tools for any file with CJK.
- **Line endings are CRLF.** After editing a repo file, confirm no bare LF was
  introduced: `node -e "const s=require('fs').readFileSync('FILE').toString('utf8');console.log('CRLF:',(s.match(/\r\n/g)||[]).length,'bare LF:',(s.match(/(?<!\r)\n/g)||[]).length)"`.
- **The push guard.** A local `.git/hooks/pre-push` blocks pushing any ref
  except `main`. Publishing this branch will need `--no-verify`, which is a
  deliberate user decision, not a routine step.
- **Harnesses live outside the repo** under
  `C:/Users/User/AppData/Local/Temp/opencode/pwtest/`. Nothing test-related gets
  committed.
- **`pnpm check` is the gate** (lint + test:shops + test:drag + test:migrations +
  test:sync + build). Run it before reporting any task done.

### Deliberately not in this work

- Making pins per-character (Q6 is a product question, not a bug; the docs say
  pins are global).
- Redesigning the header filter grid itself.

---

## The finding

The mobile/desktop floating pill is rendered unconditionally in `App.tsx`
(mobile ~258–358, desktop ~362–458), independent of `tab`. It always carries
character state: progress ring (`overall.pct`), the character name/switcher,
rename, delete, add, and 隱藏已完成.

In the barter/shop tab that state is inert:

- `MerchantPanel` reads **no** `activeChar`. Its only store reads are
  `barterPins` and the pin actions.
- `barterPins` is a **single global list** (store lines 297/384/399…), shared by
  every character — the README already documents pins as shared, and the tracker
  footer says so on screen (`所有角色共用（商店 / 以物易物頁）`).
- So switching character in the barter tab changes nothing visible: same grid,
  same pins, same filters. Measured live: pill shows `角色 1  0/30` at `y=70`
  over the shop grid after scroll, and the grid is identical for every character.

Conclusion: the character pill is a leftover from when the shop explorer was
character-scoped. It is dead weight in that tab — it consumes the top-center of
the viewport to show a name that does not affect the screen.

## The proposal

Keep the character pill on the **tracker** tab (it is live there). On the
**barter** tab, replace it with a floating **filter/search pill** carrying the
controls that actually matter in that tab, so a scrolled-down user can reach them
without scrolling back to the header.

This is the reuse the user proposed and it fits: `MerchantPanel` already owns the
filter state (`town`, `merchant`, `query`, `selectedOnly`, `priorityFilter`,
`kindFilter`) and already has a "return from a jump" chip pattern. The pill is
just another surface onto that state.

## Decisions

- **Q1 state home → render the pill inside `MerchantPanel`.** The panel owns the
  filter `useState`, so the pill owns no state of its own beyond the search
  expand/collapse. Avoids lifting state to `App.tsx` and avoids a store slice
  (the panel's filters are deliberately unpersisted — a store slice would imply
  they are not).
- **Q2 contents → four filter dropdown buttons + a search-icon button.** The
  search icon **expands an inline search field** inside the pill (focus it on
  expand; collapse on clear/blur). The four filter buttons **mirror the header
  dropdowns** as compact triggers, each opening the same dropdown: 城鎮 / NPC /
  優先度 / 類型. 清除 and the 已選 count ride along.
- **Q3 replace/duplicate → duplicate.** The header keeps its controls; the pill
  appears only past the scroll threshold, so only one surface is on screen at a
  time.
- **Q4 scope → both mobile and desktop.** The desktop pill is the same leftover.
- **Q5 隱藏已完成 and the progress ring leave the barter tab** with the character
  pill (they are tracker-scoped; `MerchantPanel` does not read them — grep
  confirms it does not read `prefs.hideCompleted`).
- **Q6 pins are global; treated as intended, not touched here.**
- **Q7 scroll flag → re-derive the threshold inside `MerchantPanel`** with a
  small local hook (`window.scrollY > 200`), rather than threading `compact` down
  from `App.tsx`. The pill is self-contained (Q1's premise), the threshold is a
  UI constant rather than shared state, and no prop has to cross the tab
  `Activity` boundary. `compact` in `App.tsx` keeps driving the character pill;
  the two are independent by design.

## Shape of the change

1. **Gate the character pill on the tab.** In `App.tsx`, the mobile pill
   (~258–358) and the desktop pill (~362–458) render only when
   `tab === "tracker"`. The barter tab gets neither. Smallest step (T1).
2. **Add `<FilterPill>` in `MerchantPanel`.** A component defined in that file
   (so it closes over the panel's `useState`), rendered near the top of the
   panel's tree and `position: fixed` in the same slot/`z` the character pill used
   (mobile `top: 70`, desktop `top: 88`, `left-1/2 -translate-x-1/2 z-30`) so the
   swap reads as the same object changing its contents.
3. **Visibility.** The local scroll hook (Q7) shows the pill past
   `window.scrollY > 200`, with the same fade/translate transition the character
   pill uses.
4. **Contents.** Search icon button that expands an inline input (auto-focus,
   collapses on clear/blur), then compact buttons for 城鎮 / NPC / 優先度 / 類型
   (each opening the same dropdown the header uses), then 清除 and 已選 N. Reuse
   `MenuSelect` / `MenuMultiSelect` as-is; add a compact `triggerClassName` so
   they fit a pill rather than the full-width header cell.
5. **No double surface.** Header rows stay mounted (they are above the fold at
   scroll 0); the pill only exists past the threshold. Verify at any scroll
   position that only one search input is reachable.
6. **返回 chip unaffected.** It lives in `MerchantPanel` and stays where it is.
7. **Theming.** Pill uses the same `rounded-full border bg-card shadow-md` shell
   as the character pill.

## Test / verify plan

- Harness: at scroll 0 in the barter tab, assert **no** floating pill and the
  header controls are present; scroll past 200 and assert the filter pill
  appears, contains a search icon and the four filter buttons, and **no**
  character name; switch back to the tracker and assert the character pill
  returns with the progress ring.
- Type into the pill's expanded search and assert the grid result count changes
  the same way the header search does (compare counts).
- Assert only one search input is reachable at a time (the other is either
  unmounted or off-screen).
- Both mobile (390) and desktop (1440).
- `pnpm check` green.
- No persisted-shape change → no store version bump (Q1 chose the in-panel
  route).

## Task breakdown (tracer bullets)

- **T1** — Gate the character pill on `tab === "tracker"` (both variants). Verify
  the barter tab is pill-free and the tracker pill still works. Smallest
  independently verifiable step.
- **T2** — Stand up an empty `<FilterPill>` in `MerchantPanel`, fixed in the pill
  slot, shown past the local scroll threshold. Verify it appears/disappears on
  scroll and survives tab switches.
- **T3** — Put the search icon + expanding inline input in the pill; wire to the
  panel's `query`. Verify the grid narrows identically to the header search.
- **T4** — Put the four compact filter buttons in the pill, reusing the header
  dropdowns; add 清除 and 已選 N. Verify each control changes the grid the same
  way its header twin does.
- **T5** — Polish: only-one-surface check, mobile + desktop pass, changelog + docs.

Each task ends in a working, verifiable state; commit per task only when asked.

## Not in this plan

- Making pins per-character (Q6 is a product question, not a bug).
- Redesigning the header filter grid itself.
