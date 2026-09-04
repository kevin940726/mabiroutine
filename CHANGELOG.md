# Changelog

Reader-facing log of user-visible changes. Newest first. Each entry links its commit.

## 2026-09-03 — Unreleased batch (pins, data, perf, branding)

### Features
- `tracker.json` replaces `builtin.ts`: both data files are hand-owned JSON sources of truth
- Single global pin list: fork/personal model removed, tap toggles for all characters (old saves reset to must defaults)
- Barter explorer filters persist across reloads (selects only; search stays session-only, stale towns reset to all)
- Idle-deferred localStorage writes with flush on tab hide/close; rapids taps never block the UI
- Hidden rows move to a bottom sub-category in every section and no longer count toward progress
- Explorer skill chart reacts to filters, sits below the controls, and never jumps (stable rows + animated widths)
- Deferred search input: keystrokes stay instant while the 98-row list updates in background
- Suggest-only fetchers (`suggest-tracker` / `suggest-barter`); `pnpm check` gate (lint + migration fixtures + build)
- Mobile barter rows: two-line layout with 20px NPC avatar in the title, priority chip on its own line, bare give → get with no truncation, and hidden `note` surfaced as a 📝 line (desktop rows unchanged)
- Mobile barter filter card: selects/pills collapse behind a native 展開篩選 disclosure and the skill chart is desktop-only (pure RWD, desktop pixel-identical); search placeholder shortens to 搜尋, pin toggle matches input height, and the pinned-notes legend stays visible outside the collapse
- Mobile v1 finalized: two-line task rows, single-line progress pill with character stepper, compact header, wrapping character tabs, two-line barter rows, collapsible barter filters (desktop unchanged throughout); all prototype rigs removed
- Default barter pins are a hand-owned list (`src/data/defaultPins.json`) instead of derived must-priorities; `pnpm suggest-barter` proposes list additions/removals/stale ids on source drift (matched by trade, not churny yenyen ids)
- Weekly counter tiles for 召喚結界 / 黑色坑洞 show remaining (剩 N / 7, mobile + desktop) with the fill still rising from the bottom with used progress; new first-class `countdown` (倒數) task type, also offered in 新增自訂 with 次數上限 kept (display-only, no save migration)
- Counter/countdown tiles support hold-to-grab quick-adjust: hold 0.3s (haptic) then drag up/down ±1 per 14px, release to end; tap +1 / full-tap-reset and desktop right-click −1 unchanged, mobile long-press popup suppressed; the gesture teaches itself on tap (touch) or hover (desktop) until the first successful grab, then retires it; keyboard arrows adjust a focused tile; no `title` tooltips

### Fixes
- Tracker rows: dropped hunt / 以物易物-check / life-weekly / acc-guild-weekly; added weekly-goals / guild-challenges / friend-challenges
- Tracker data: added 每日挑戰 (daily counter 0/10) and 每週挑戰 (weekly counter 0/11); 亡靈之塔 counter→check (old numbers show as done, next tap clears); 黑色坑洞 daily→weekly (existing progress carries over, now resets Mondays — no save migration needed)
- 黑色坑洞 countdown max 7→14 to match 每週最多 14 次 (existing counts carry over, just a higher ceiling)
- Barter rows: removed 需先換 suffixes
- Character rename form contrast and padding; footer credit/link removed; uniform 釘選/已釘選 button width
- Footer action buttons wrap on narrow viewports so 重置所有資料 no longer overflows
- 重置所有資料 uses an inline two-tap confirm (確認清除 / 取消) instead of the native blocking dialog
- Mobile top header padding-y tightened to 10px (desktop stays 12px)
- Desktop character tabs show rename/delete only on the active pill; inactive pills are name-only
- Desktop character tab row wraps instead of scrolling when it overflows
- Account-section hide is now global: one tap hides for every character (daily/weekly stay per-character); saves with per-char-hidden account ids migrate automatically (store v9→v10)

### Chores
- Agent rule: every commit must update this changelog in the same commit (AGENTS.md pre-commit gate)
- Vercel Analytics mounted at app root (`@vercel/analytics/react`)
- Retired the frozen-desktop rule: UI changes now consider both desktop and mobile variants (code comments updated; history entries left as-is)

## 2026-09-03 (`e036f45`)

### Features
- Mobile-only layouts via `useIsMobile` (<640px); desktop UI frozen pixel-identical to the released build (`e036f45`)
- Mobile tracker rows go two-line with zero ellipsis: badges on their own line, 44px tap tiles, ghost eye / ⋯ menu, edge-hug drag grip, full-bleed sections (`e036f45`)
- Mobile compact pill goes single-line: progress + ‹ character › stepper + add + ⋯ menu with inline rename (`e036f45`)
- Mobile header goes single-line (O1): wordmark only + stacked daily/weekly countdown on the right (`e036f45`)

### Chores
- Pill / header throwaway prototypes (`?variant=`, DEV-only) stay wired for the next loop (`e036f45`)

## 2026-09-03 (`a9d8c84`)

### Features
- Tap-tile counters: tap +1, full tile taps back to 0, right-click / long-press −1, progress fills inside the tile (`a9d8c84`)
- Sub-group bleed bands: 以物易物 / 已隱藏 rows stay pixel-equal to top-level rows, band bleeds 8px past them (`a9d8c84`)
- NPC portraits: 76×76 circle avatars on barter rows with placeholder fallback (`a9d8c84`)
- Real Radix Select replaces native dropdowns across character tabs, filters, dialogs (`a9d8c84`)
- Barter explorer card layout C: get-resource title + NPC·town, 你給→你拿 line with right-aligned limit (`a9d8c84`)
- Tracker barter rows share the explorer card design at fixed 88px-min compact height (`a9d8c84`)
- 每日 N 次 barter pins render a counter (max N); 每日 1 次 stays a checkbox (`a9d8c84`)
- 50px emoji / NPC avatar alignment in tracker rows (`a9d8c84`)

### Chores
- Crop script + ledger for NPC portraits; npc-raw excluded from git (`a9d8c84`)

## 2026-09-02 (`e4494aa`)

### Features
- Barter explorer list view with collapsible sections (`e4494aa`)
- TW70 barter seed with 10 must-pins as defaults (`e4494aa`)

### Fixes
- Square checkbox style on tracker rows (`e4494aa`)

## 2026-09-02 (`f0635e0`)

### Features
- Daily / weekly / account tracker with per-character isolation and 06:00 Asia/Taipei resets (`f0635e0`)
- TW-only dataset: 20 builtin tasks, barter merge, hardcoded 黑色坑洞 7+7 and 召喚結界 7 (`f0635e0`)
- Custom tasks with add / edit dialog, drag reorder, hide, JSON import/export (`f0635e0`)
