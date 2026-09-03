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

### Fixes
- Tracker rows: dropped hunt / 以物易物-check / life-weekly / acc-guild-weekly; added weekly-goals / guild-challenges / friend-challenges
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

## 2026-09-03 (`37eb111`)

### Features
- Mobile-only layouts via `useIsMobile` (<640px); desktop UI frozen pixel-identical to the released build (`37eb111`)
- Mobile tracker rows go two-line with zero ellipsis: badges on their own line, 44px tap tiles, ghost eye / ⋯ menu, edge-hug drag grip, full-bleed sections (`37eb111`)
- Mobile compact pill goes single-line: progress + ‹ character › stepper + add + ⋯ menu with inline rename (`37eb111`)
- Mobile header goes single-line (O1): wordmark only + stacked daily/weekly countdown on the right (`37eb111`)

### Chores
- Pill / header throwaway prototypes (`?variant=`, DEV-only) stay wired for the next loop (`37eb111`)

## 2026-09-03 (`314509e`)

### Features
- Tap-tile counters: tap +1, full tile taps back to 0, right-click / long-press −1, progress fills inside the tile (`314509e`)
- Sub-group bleed bands: 以物易物 / 已隱藏 rows stay pixel-equal to top-level rows, band bleeds 8px past them (`314509e`)
- NPC portraits: 76×76 circle avatars on barter rows with placeholder fallback (`314509e`)
- Real Radix Select replaces native dropdowns across character tabs, filters, dialogs (`314509e`)
- Barter explorer card layout C: get-resource title + NPC·town, 你給→你拿 line with right-aligned limit (`314509e`)
- Tracker barter rows share the explorer card design at fixed 88px-min compact height (`314509e`)
- 每日 N 次 barter pins render a counter (max N); 每日 1 次 stays a checkbox (`314509e`)
- 50px emoji / NPC avatar alignment in tracker rows (`314509e`)

### Chores
- Crop script + ledger for NPC portraits; npc-raw excluded from git (`314509e`)

## 2026-09-02 (`8ca3cba`)

### Features
- Barter explorer list view with collapsible sections (`8ca3cba`)
- TW70 barter seed with 10 must-pins as defaults (`8ca3cba`)

### Fixes
- Square checkbox style on tracker rows (`8ca3cba`)

## 2026-09-02 (`46a6d6e`)

### Features
- Daily / weekly / account tracker with per-character isolation and 06:00 Asia/Taipei resets (`46a6d6e`)
- TW-only dataset: 20 builtin tasks, barter merge, hardcoded 黑色坑洞 7+7 and 召喚結界 7 (`46a6d6e`)
- Custom tasks with add / edit dialog, drag reorder, hide, JSON import/export (`46a6d6e`)
