# Changelog

Reader-facing log of user-visible changes. Newest first. Each entry links its commit.

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
