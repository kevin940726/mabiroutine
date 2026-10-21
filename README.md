# MabiRoutine 🎯 — Mabinogi Mobile (TW) daily tracker

**[繁體中文版](README-zh_TW.md)**

Log in, stare at twenty things to do, forget half of them. MabiRoutine fixes
that: a fast, private checklist for 瑪奇 Mobile (TW server) covering dailies,
weeklies and 以物易物 (barter) trades — per character (server-capped trades
are shared across characters), with Taipei-time resets
handled for you.

👉 **Try it: https://mabiroutine.vercel.app/** — no account needed.

## Features

- ☀️ Dailies, weeklies, and account-wide tasks (dungeons, challenges, jobs, tower, events, guild/friend) on one page; tap to check off.
- ⏰ Resets automatically daily and weekly at 06:00 Taipei, with a live countdown in the header; a half-finished 定期委託 round carries its three legs into the next week (only its recorded count resets).
- 👥 Up to 6 characters, one tab each, renameable and reorderable, with separate progress.
- 🔄 All 238 gold and barter trades, browsable by town and NPC, with have/need search, pinning to dailies, and a per-trade material breakdown.
- ✏️ Custom tasks, drag reordering, and hiding; a sync link also shares row and pinned order.
- 🎨 外觀 is a single row of three segments — 淺色 / 跟隨系統 / 深色 — and the default follows your system, so a phone or desktop switching to dark repaints live.
- ☰ The header menu is where choices live: 更新記錄, 同步 (its state, opening the same dialog), 外觀, 安裝 App, then 匯出 JSON / 匯入 JSON / 重置所有資料 under a divider. The footer keeps 實驗性功能, the GitHub link and the sources.
- 📝 更新記錄 opens the changelog: every release since the 2026-10-20 baseline, newest first, with the earlier history on GitHub. The amber dot on ☰ nudges once per feature release, clears when you open the menu — on any synced device — and expires after the release day and the next if you never do; a fresh install has none until the first menu open.
- 🔗 Optional cross-device sync by link, no account; the ☰ row says whether it is linked and how long ago it last synced. Everything still works offline without it.
- ⬆️ A tab left open across a deploy can tell you a new version is ready — one toast, and the 有新版本 · 重新載入 row that stays until you act on it — and taking it reloads into 已更新到最新版. Nothing opens by itself.
- 📲 Installable from ☰ — a native prompt on Android and desktop, a short steps dialog on iPhone and Samsung — and it works offline.
- 🔔 Optional reminder bells for 不祥的召喚結界 and 深淵的黑色坑洞, local while the app is open and server push while closed; per device, best-effort.
- 🔒 Progress stays in your browser (localStorage), not our database, with no tracking or ads; only push subscriptions you enable are stored server-side.

## Sources & licenses

Fan-made, non-commercial, TW-only. Not affiliated with NEXON / devCAT; game
names, NPCs, items and art belong to their owners (NPC avatars are self-taken
screenshots). Numbers are community-verified — the game client wins. Spot a
rights problem? Open a GitHub issue and it comes down.

- **瑪奇Mobile Wiki DB** (`mabinogimobile.nipponhashi.com/tracker/`) — tracker
  structure + reset-time cross-check (its barter page: comparison only, never
  copied).
- **Meowka 以物易物記事本** (`mabinogi-mobile-notebook.vercel.app`) — barter
  list skeleton; recommendations rewritten in our own voice.
- **yenyen 繁中資料庫** (`mabi.yenyen.dev`) — supplementary trades + region
  cross-check.
- **mabitw** (`mabitw.com/daily`), **bobogameguides** (`bobogameguides.com/…`)
  — cross-checks for counts and official-vs-community status.
- Code is MIT (`LICENSE`); data files are CC BY-NC 4.0 (`DATA_LICENSE`), game
  art excluded.

## Hack on it

- `pnpm install && pnpm dev` → details in `docs/development.md` (full-stack
  dev, deploys, project layout).
- Game data (`src/data/*.json`) is hand-maintained → read
  `docs/tracker-data.md` before touching it.
- How your progress and sync storage work → `docs/storage.md`.
