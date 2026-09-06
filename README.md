# MabiRoutine 🎯 — Mabinogi Mobile (TW) daily tracker

**[繁體中文版](README-zh_TW.md)**

Log in, stare at twenty things to do, forget half of them. MabiRoutine fixes
that: a fast, private checklist for 瑪奇 Mobile (TW server) covering dailies,
weeklies and 以物易物 (barter) trades — per character, with Taipei-time resets
handled for you.

👉 **Try it: https://mabiroutine.vercel.app/** — no account needed.

## Why you'll keep it open

- ☀️ **Dailies, weeklies, account chores — one page.** 週幾地下城, 每日挑戰,
  深層地下城, 兼職, 亡靈之塔… plus 召喚結界, 黑色坑洞, 深淵,
  格里斯貝恩… plus account-wide Stella Pick, shop freebies, guild and friend
  challenges. Tap to check off, watch the bar fill.
- ⏰ **Resets handled for you.** Daily 06:00 / Monday 06:00 (Asia/Taipei), with
  a live countdown in the header. Done items reset on their own — just come
  back and play.
- 👥 **Up to 6 characters, fully separated.** One tab per character, renameable;
  each keeps its own progress.
- 🔄 **A barter explorer that answers "what do I trade today".** 92 以物易物
  trades with must/extra/once/situational guidance, search by what you have or
  what you need, filter by town and priority. Pin the good ones and they
  show up in your dailies.
- ✏️ **Make it yours.** Custom tasks, drag-to-reorder everything, hide what you
  never do, dark mode.
- 🔗 **Optional sync across devices.** No account, no password — one link joins
  your phone and desktop, edits merge themselves. Or skip it: everything works
  offline-first in your browser either way.
- 📲 **Installs like an app.** Android/desktop install button, iOS home-screen
  ready, works offline.
- 🔒 **Private by default.** Your progress lives in your browser
  (localStorage), not in our database. No tracking, no ads.

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
