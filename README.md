# MabiRoutine 🎯 — Mabinogi Mobile (TW) daily tracker

**[繁體中文版](README-zh_TW.md)**

Log in, stare at twenty things to do, forget half of them. MabiRoutine fixes
that: a fast, private checklist for 瑪奇 Mobile (TW server) covering dailies,
weeklies and 以物易物 (barter) trades — per character (server-capped trades
are shared across characters), with Taipei-time resets
handled for you.

👉 **Try it: https://mabiroutine.vercel.app/** — no account needed.

## Features

- ☀️ Dailies, weeklies, and account tasks on one page.
- ⏰ 06:00 Taipei resets, carrying unfinished 定期委託 over.
- 👥 Up to 6 characters with separate progress.
- 🔄 Every gold and barter trade, searchable and pinnable.
- ✏️ Custom tasks with hiding.
- 🔗 Optional cross-device sync by link, without an account.
- 🔔 Optional reminders for 不祥的召喚結界 and 深淵的黑色坑洞.
- 📲 Installable as an offline app.
- 🔒 Stored locally: no account, no tracking, no ads.

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
