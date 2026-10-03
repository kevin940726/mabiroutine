# Plan — floating switch bar: character pill in tracker, filter/search pill in barter

Status: IN BUILD. Branch `feat/barter-filter-pill`. T1–T6 built; T5 (final polish
and the remaining search-path check) is what is left. The design below is the
original plan; section 0 is the live handoff.

**Read section 0 first.** It is the handoff: where the branch stands, what is
next, and the traps that cost time getting here. Everything after it is the
design of the change.

---

## 0. Handoff — start here

### Where things stand

- **Branch:** `feat/barter-filter-pill`, rebased onto `main` at `38ea130`. Local
  only: **not pushed**, no PR.
- **Built:** T1 (character pill gated on `tab === "tracker"`), T2 (empty
  `<FilterPill>` in `MerchantPanel`), T3 (search icon + expanding input), T4 (the
  four compact filters and 清除), T6 (tracker context block moved into the
  tracker tab). Each is a commit on this branch.
- **The pill's filters split by width.** Below 1024px (`PILL_DRAWER_MAX_WIDTH` in
  `MerchantPanel`) the four dropdowns sit behind one 篩選 trigger and a drawer;
  from 1024px up they lay out inline with 清除. The drawer was the original design
  for every width, but on desktop it costs an extra click and hides four controls
  that have room to show. The boundary is 1024 rather than `sm` because the inline
  row scales with the root font (535px at 16px, 794px at 24px, 927px at 28px):
  below ~1024 an enlarged font overflowed, which is exactly what the drawer was
  for. `useNarrowerThan` is local to the panel — `useIsMobile` (639px) still
  drives the app-wide layout variants and was left alone.
- **The phone pill hugs.** It was pinned full-width on a phone while the four
  dropdowns were inline (a long value needed a definite width for `shrink`), but
  once those moved into the drawer the row held only three fixed-width items and
  full width just left a gap. Now `w-max` + `max-w-[calc(100svw-2rem)]`: 154px at
  rest, widening to the row only when the search field opens.
- **One list, pins lead — the toggle is gone (revised 2026-10-03).** The `selectedOnly`
  mode is deleted: keeping it could not be made coherent (with the pin bypass, the
  優先度 control was dead in the pinned view since every row there is pinned;
  without it, the default must+extra hid pins inside the very view meant to show
  them — and the pinned list turned out to filter by search only, so its visible
  town / NPC / priority / kind controls acted on nothing). `items` is now the only
  list: pins lead their section in pinning order, then `compareRows` tier order
  below (the panel passes `preserveOrder` so the grid keeps the caller's order).
  The section count states the bypass exactly when it bites
  (`含 N 筆已釘選，不受優先度篩選`). "Only pins" is the tracker's pinned groups.
  Vocabulary stays 釘選 everywhere (store `barterPins`, tracker, tile buttons).
  Verified: `tir-f1` (視需求, pinned) leads its section in the 40-row default with
  the caption present; unpinning drops it (39 rows); pinning a must row moves it to
  its section top; no 已釘選 toggle or heading remains in the shop. A non-empty
  query suspends (never composes with) the priority filter — searching 糖 with one
  糖 row pinned returned just that pin while the other NPCs selling it hid behind
  the default, and now returns all three with a `搜尋時顯示所有優先度` caption
  (`搜尋中` sounded like loading; the conditional states the effect); town / NPC
  / kind still narrow a search and the ticks resume on clear. Verified end to
  end via the real pin path (UI-pin, reload, search, clear). List order is town
  first (canonical `TOWN_ORDER`, the dropdown's own order), then pins, then
  tiers, in browse and search alike: sorting pins first globally dragged a pinned
  town's whole section to the top, so the 糖 search read 地下城 before 堤爾克那.
- **CJK composition buffers locally (2026-10-03).** Both search fields own a
  `useSearchBox` instance (header + pill, synced through `query`): partial IME
  text stays in per-field `draft`, plain keystrokes commit live, `compositionend`
  commits, blur backstops, and Escape mid-composition is the IME's (ignored).
  Verified with synthetic composition events on both instances.
- **Tracker→shop deep-links (companion, 2026-10-03).** Tracker portraits are
  buttons: regular trade rows (NPC face), group parents (face, flashes ALL
  children via a `focusKeys` set under one timer) and group children (item art).
  One list, so the landing is the merchant's full section with every filter reset
  (`viewTaskInShop`: town/search/優先度/類型 cleared). App owns the tab switch and
  fires the panel through a render-assigned ref — NOT an effect registration, and
  NOT nulled on cleanup, because Activity tears down hidden-tab effects (the
  first implementation did both and the jump silently no-op'd: tab switched, no
  landing). The one-shot ?npc=/?item= effect carries a `landingDone` guard for
  the same reason: without it every tab show re-processed the URL, stripping a
  fresh jump link on arrival. Cold-start gap (chunk unloaded) falls back to the
  same params in the URL (`lib/shopJump.writeShopJumpParams`, incl.
  `from=tracker`), which the landing honors — and `from` arms 返回任務追蹤 with
  cold defaults, so even a copied link keeps its way back. Verified: regular /
  child / parent jumps flash 1 / 1 / N tiles, reset is visible (trigger reads
  全部優先度), back restores tracker + scroll, cold link lands + arms + strips.
- **Remaining:** T5 (final polish) and the search-path assertion (expand the pill's
  search, type, and compare the grid count against the header search).
- **Worktree layout.** Three dirs exist; two are git worktrees of the original
  clone at `C:/Users/User/work/mabiroutine`:
  - `C:/Users/User/work/mabiroutine` — the MAIN worktree, on `main`.
  - `C:/Users/User/work/mabiroutine-pill` — THIS one, on `feat/barter-filter-pill`.
  - `C:/Users/User/work/mabiroutine-main` — REMOVED (was the old `main` worktree).
  So `git checkout main` **fails** here ("already used by worktree"). Inspect
  `main` with `git log main`; do not try to switch to it.
- **T6 — move the tracker context block into the tracker tab, and add per section.**
  The progress row, 隱藏已完成 and `<CharacterTabs />` were page-level in a nav bar
  above `<main>`, so the shop tab carried controls it does not read. They now render
  INSIDE the tracker `<Activity>`: the shop tab's top is header → tabs → shop. This
  supersedes the old "gate the nav bar" idea; the block moved rather than being
  hidden in place.
  The single 新增自訂 button (tab row, then briefly its own line above the grid)
  was replaced by one per section header — 每日任務 / 每週任務 / 帳號共通 — each
  opening the dialog pre-set to its section via a new `defaultSection` prop. The
  區段 / 重置 select is hidden when the seed leaves only one valid schedule
  (daily, weekly), and narrowed to the two account options when opened from
  帳號共通 — it used to offer all four there, so an account add could silently move
  the task out of its section. Editing keeps all four options, because that select
  is also how a task moves between sections. The add
  button is a sibling of the section's collapse toggle, so it cannot fold the
  section, and it stays visible while the section is collapsed.
  The section headers also dropped their 收合 / 展開 text (the chevron plus the
  whole-bar hover already say it, and mobile never showed the label). The toggle
  gained `aria-expanded`, which it had lacked.
  **清除本區 was removed** from the section header (its destructive scope was not
  visible from where it sat). The `clearSection` store action stays — the sync case
  E9 pins it — so only the button, its handler, and the now-dead
  `ConfirmDialog.confirmClearSection` were deleted.


### What is next, in order

Build T1–T5 (below) in order, each ending in a working, verifiable state. Per
`AGENTS.md`: **commit only when asked**, one logical change per commit, changelog
entry in the same commit; **never push** without explicit approval. The user runs
Vite and iterates visually — prefer measured in-browser numbers over argument.

**Ports on this machine:** `:5173` serves the MAIN worktree (`mabiroutine`, on
`main`); `:5174` serves THIS worktree (`mabiroutine-pill`). Check the port's
checkout before trusting a measurement — measuring the other worktree's code
silently is a trap that has already cost time. Verify served code by structural
markers (class strings, JSX), never by comments: Vite strips comments from the
transformed module, so a comment can never appear in what the server returns.

1. **T1** — gate the character pill on `tab === "tracker"` (both variants).
2. **T2** — empty `<FilterPill>` in `MerchantPanel`, fixed in the pill slot,
   shown past a local scroll threshold. (Now visibility-driven; the threshold
   is recorded here as history.)
3. **T3** — search icon + expanding inline input, wired to the panel's `query`.
4. **T4** — the four compact filter buttons (城鎮 / NPC / 優先度 / 類型) and 清除.
   (The 已釘選 N toggle shipped with T4 and was removed in the 2026-10-03
   single-list revision — see the note above.)
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
  優先度 / 類型. 清除 and the 已釘選 count ride along.
- **Q3 replace/duplicate → duplicate.** The header keeps its controls; the pill
  appears only while the header controls are off screen (visibility, not the old
  scroll threshold — see the revision note), so only one surface is on screen at
  a time.
- **Q4 scope → both mobile and desktop.** The desktop pill is the same leftover.
- **Q5 隱藏已完成 and the progress ring leave the barter tab** with the character
  pill (they are tracker-scoped; `MerchantPanel` does not read them — grep
  confirms it does not read `prefs.hideCompleted`).
- **Q6 pins are global; treated as intended, not touched here.**
- **Q7 scroll flag → re-derive the threshold inside `MerchantPanel`** with a
  small local hook (`window.scrollY > 200`), rather than threading `compact` down
  from `App.tsx`. (Superseded: the threshold became `useControlsInView`, an
  IntersectionObserver on the controls — see the revision note.)
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
3. **Visibility.** An IntersectionObserver on the controls wrapper
   (`useControlsInView`) shows the pill only while none of the header is
   visible, with the same fade/translate transition the character pill uses.
   (Was a local scroll hook, `window.scrollY > 200` — replaced because a fixed
   offset left both surfaces visible on short viewports; see the revision note.)
4. **Contents.** Search icon button that expands an inline input (auto-focus,
   collapses on Escape, on blur when empty, or on X when already empty — the X
   clears text otherwise and keeps focus, so its outcome is identical at every
   scroll), then compact buttons for 城鎮 / NPC / 優先度 / 類型
   (each opening the same dropdown the header uses), then 清除. (已釘選 N rode
   along here originally; removed in the single-list revision.) Reuse
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
  header controls are present; scroll until the header controls leave the
  viewport and assert the filter pill appears, contains a search icon and the
  four filter buttons, and **no** character name; switch back to the tracker and
  assert the character pill returns with the progress ring.
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
- **T6** — Move the tracker context block (progress row, 隱藏已完成,
  `<CharacterTabs />`) and the 新增自訂 button out of the page-level nav bar / tab
  row and into the tracker `<Activity>`, so the shop tab carries none of them.
  Built as reported under section 0.
- **T2** — Stand up an empty `<FilterPill>` in `MerchantPanel`, fixed in the pill
  slot, shown past the local scroll threshold (now visibility-driven — recorded
  as history). Verify it appears/disappears on scroll and survives tab switches.
- **T3** — Put the search icon + expanding inline input in the pill; wire to the
  panel's `query`. Verify the grid narrows identically to the header search.
- **T4** — Put the four compact filter buttons in the pill, reusing the header
  dropdowns; add 清除 (已釘選 N was added here and later removed — see the
  revision note). Verify each control changes the grid the same
  way its header twin does.
- **T5** — Polish: only-one-surface check, mobile + desktop pass, changelog + docs.

Each task ends in a working, verifiable state; commit per task only when asked.

## Not in this plan

- Making pins per-character (Q6 is a product question, not a bug).
- Redesigning the header filter grid itself.
