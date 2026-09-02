# MabiRoutine — 瑪奇 Mobile 日課追蹤

Heavily inspired by https://mabinogimobile.nipponhashi.com/tracker/ + https://mabinogimobile.nipponhashi.com/barter/. TW only.

- **Stack:** TypeScript + React 19 + Vite 8 + Tailwind v4 + shadcn/ui + Zustand (persist) + @dnd-kit + date-fns
- **No backend.** `localStorage` key `mabiroutine:v2` (persist `v3`), `Asia/Taipei` 06:00 daily / Mon 06:00 weekly auto-reset, live countdown.
- **UX:** Fresh shadcn, light/dark, mobile-first, ≤6 characters, battle-tested drag reorder.

## Features

### Tracker (mirrors original)
- **☀️ 每日 (daily, per-char):** 狩獵場探險 / 週幾地下城 / 黑色坑洞 / 以物易物 / 深層地下城 0/2 / 亡靈之塔 20 / 兼職 0/2 (06:00,18:00 `timeGated` badge)
- **🗓️ 每週 (Mon 06:00, per-char):** 召喚結界 0/7 / 深淵 0/3 / 格里斯貝恩 0/1 / 野外首領 0/1 / 生活技能週任務
- **👥 帳號共通 (shared):** Stella Pick / 銀幣箱 / 碎裂寶石箱 0/10 / 商店免費禮包 / 每日簽到 / 會員每日領取 (daily) + 公會任務 / 野外首領尾刀 (weekly)
- Types: `check` (✓) and `counter -0/N+` with progress bars; `hideCompleted` toggle; `清除本區` per section; overall `done/total · %`

### Characters
- Tabs, rename (`✎`), add/remove (cap 6 → `CharacterTabs.tsx:81` disables), per-char `taskValues` isolation, daily/weekly resets per char.

### Barter Merge — Both surfaces (auto-fork)

**Data:** `src/data/barter.json` checked-in snapshot (30 demo rows; replace with 226 via `scripts/update-barter.mjs`). Skill chart (伐木/釣魚/挖礦…) + `priority` (`must`/`extra`/`once`/`situational`/`skip` → `一定要換` etc) + `town` + `gatherSkill`.

**1) Daily expanded group** `🔄 以物易物` in `TrackerSection.tsx:122` — shows effective pins for active char, expand to list pinned barter `TaskRow`s.

**2) Full Explorer** `BarterExplorer.tsx:1` — search `我有/我缺 (give/get)`, filters `優先度/城鎮/採集技能`, quick chips, `只看 已釘選` (active char), skill counts chart.

**Pin model — fixed mapping, auto-fork:**
- **Tap / click = per-acc (共用, emerald `bg-emerald-600`)** — `store: toggleBarterPin` mutates `barterPins` pre-fork or *all* chars' `barterPinsByChar` post-fork. Tooltip: `點擊：釘選至所有角色（共用・綠）`.
- **Long-press 550ms (mobile) or right-click (desktop) = per-char (個人, sky `bg-sky-600`)** — `toggleBarterPinForChar` auto-forks on first use: clones `barterPins` → `barterPinsByChar[eachChar]`, then toggles only `activeChar`. Hook `hooks/useLongPress.ts:1` (`pointerdown` timer, `move>10px` cancel, `touchAction:none`, `vibrate(30)`), `onContextMenu` same path. Tooltip: `長按或右鍵：僅 ${char}（個人・藍）` (`ui/tooltip.tsx:1`).
- **Colors:** `共用綠` vs `個人藍` badges/rings in tracker + explorer, plus `其他：角色A、角色B` hint when same pin exists on others post-fork.
- **Fork state header:** `共用模式` vs `個人模式 · 角色名` (`BarterExplorer.tsx:60`) + `合併回共用` (union → `barterPins`, clear `byChar`).

**Why auto-fork:** Keeps UI un-gutted (no extra button until needed); max 6 chars so manual check is trivial; deterministic `tap=所有 / hold=僅此角色`.

### Custom Tasks
- `+ 新增自訂` (`AddTaskDialog.tsx:1`) — any section, `check`/`counter`, `notes`/`timeGated (06:00,18:00)`, icon picker; edit via pencil, hide via `EyeOff` (per-char `hiddenTaskIds`), delete (confirm); drag reorder via `@dnd-kit` for **all** items (built-ins + barter pins + custom) using `SortableContext`.

### Other
- Theme toggle (`ThemeToggle.tsx:1`) persisted `theme` + `prefers-color-scheme`; sticky header with `每日重置 / 每週重置` countdown `hooks/useCountdown.ts:1`.
- Export/import JSON, `重置所有資料`, `migrate v2→v3` (`store/useAppStore.ts:390`).

## Commands (pnpm)

```bash
pnpm install
pnpm dev              # http://localhost:5173
pnpm build            # tsc -b && vite build → dist/
pnpm preview          # vite preview
pnpm update-barter:dry  # fetch https://mabinogimobile.nipponhashi.com/barter/ or print manual copy steps
pnpm update-barter      # attempt auto-extract
```

## Barter Data Updates (manual push at build time)

`src/data/barter.json` schema `{ id, name, give, get, town, priority: "must"|"extra"|"once"|"situational"|"skip", gatherSkill, perChar: boolean }`.

Site hydrates via Astro island → auto-extract is brittle; `scripts/update-barter.mjs:1` prints 2-min manual steps:
1. Open barter page → DevTools → Network → copy barter JSON array (or View Source search `barter-`)
2. Normalize fields and overwrite `src/data/barter.json`
3. Commit → deploy

## Deploy

- **Cloudflare Pages (free):** Build `pnpm build`, output `dist`, no functions. `wrangler.toml` included (`wrangler pages deploy dist`). Or connect GitHub → auto deploy on push.
- No env vars, static only.

## Project Structure

```
src/
  data/builtin.ts        # 7+5+8 builtins
  data/barter.json       # 30 demo → 226 prod
  lib/types.ts           # Task/Character/AppState (v3: barterPins + barterPinsByChar + isBarterForked)
  lib/reset.ts           # Asia/Taipei 06:00 daily / Mon 06:00 weekly (UTC+8 fixed)
  lib/utils.ts           # cn()
  store/useAppStore.ts   # Zustand persist v3, resets, char ops, barter fork, drag order
  hooks/useCountdown.ts / useLongPress.ts
  components/
    ui/*                 # button/card/badge/input/label/textarea/dialog/select/separator/switch/tooltip
    TrackerSection.tsx / TaskRow.tsx / CharacterTabs.tsx
    BarterExplorer.tsx / AddTaskDialog.tsx / ThemeToggle.tsx
  App.tsx / main.tsx / index.css
scripts/update-barter.mjs
wrangler.toml
```

## Verification

- `pnpm build` ✓ — `1855 modules`, `326.5kB JS (103kB gzip)`, `36.2kB CSS`
- Reset is `Asia/Taipei` fixed +8 (no DST), lazy + `focus/visibilitychange` + `60s` interval (`App.tsx:32`, `store:applyResets`)
- Forked pins persist `v3`, capped 6 chars, new char gets `[]` post-fork
