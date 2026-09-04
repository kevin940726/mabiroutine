# MabiRoutine — 瑪奇 Mobile 日課追蹤

Heavily inspired by https://mabinogimobile.nipponhashi.com/tracker/ + https://mabinogimobile.nipponhashi.com/barter/. TW only.

- **Stack:** TypeScript + React 19 + Vite 8 + Tailwind v4 + shadcn/ui + Zustand (persist) + @dnd-kit + date-fns
- **No backend.** Progress lives only in your browser: `localStorage` key `mabiroutine:v2` (schema `version: 9`, see below). `Asia/Taipei` 06:00 daily / Mon 06:00 weekly auto-reset, live countdown.
- **UX:** Fresh shadcn, light/dark, mobile-first, ≤6 characters, battle-tested drag reorder.

## Features

### Tracker (mirrors original)
- **☀️ 每日 (daily, per-char):** 狩獵場探險 / 週幾地下城 / 黑色坑洞 / 以物易物 / 深層地下城 0/2 / 亡靈之塔 20 / 兼職 (18:00 刷新勾選)
- **🗓️ 每週 (Mon 06:00, per-char):** 召喚結界 0/7 / 深淵 0/3 / 格里斯貝恩 0/1 / 野外首領 0/1 / 生活技能週任務
- **👥 帳號共通 (shared):** Stella Pick / 銀幣箱 / 碎裂寶石箱 0/10 / 商店免費禮包 / 每日簽到 / 會員每日領取 (daily) + 公會任務 / 野外首領尾刀 (weekly)
- Types: `check` (✓) and `counter -0/N+` with progress bars; `hideCompleted` toggle; `清除本區` per section; overall `done/total · %`

### Characters
- Tabs, rename (`✎`), add/remove (cap 6 → `CharacterTabs.tsx:81` disables), per-char `taskValues` isolation, daily/weekly resets per char.

### Barter Merge — Both surfaces

**Data:** `src/data/barter.json` checked-in snapshot (30 demo rows; replace with 226 via `scripts/update-barter.mjs`). Skill chart (伐木/釣魚/挖礦…) + `priority` (`must`/`extra`/`once`/`situational`/`skip` → `一定要換` etc) + `town` + `gatherSkill`.

**1) Daily expanded group** `🔄 以物易物` in `TrackerSection.tsx:122` — shows effective pins for active char, expand to list pinned barter `TaskRow`s.

**2) Full Explorer** `BarterExplorer.tsx:1` — search `我有/我缺 (give/get)`, filters `優先度/城鎮/採集技能`, quick chips, `只看 已釘選` (active char), skill counts chart.

**Pin model — one global list:** `barterPins` in the store; tap toggles for every character, no per-character pins. Pinned rows appear in the tracker 每日 sub-category for all characters.

### Custom Tasks
- `+ 新增自訂` (`AddTaskDialog.tsx:1`) — any section, `check`/`counter`, `notes`, icon picker; edit via pencil, hide via `EyeOff` (per-char `hiddenTaskIds`), delete (confirm); drag reorder via `@dnd-kit` for **all** items (built-ins + barter pins + custom) using `SortableContext`.

### Other
- Theme toggle (`ThemeToggle.tsx:1`) persisted `theme` + `prefers-color-scheme`; sticky header with `每日重置 / 每週重置` countdown `hooks/useCountdown.ts:1`.
- Export/import JSON, `重置所有資料`, auto-migrate on update (`store/useAppStore.ts` `migratePersisted`, current schema `v9`).

## Commands (pnpm)

```bash
pnpm install
pnpm dev              # http://localhost:5173
pnpm build            # tsc -b && vite build → dist/
pnpm preview          # vite preview
pnpm suggest-tracker  # diff tracker.json vs TW tracker page → suggestions/ (reference only)
pnpm suggest-barter   # diff barter.json vs notebook70+yenyen → suggestions/ (reference only)
pnpm update-barter    # = --write: overwrite barter.json (escape hatch, wipes manual edits)
```

## Data Updates (manual-first)

`src/data/tracker.json` (20 rows) and `src/data/barter.json` (98 rows) are hand-owned sources of truth.
Fetchers only write `suggestions/` diffs (gitignored) for reference — see `skills/update-tracker/SKILL.md`.
Edit the JSON by hand (`id` must stay stable — progress keys off it), then `pnpm build`.

## 資料、版本更新與 localStorage 衝突處理

**兩層資料，兩個主人：**
- 靜態 rows（`tracker.json` / `barter.json`）跟著 app 發布走，你的瀏覽器不快取它們：改名、改敘述、改 `max` 下次部署即生效。
- 你的進度（勾選、計次、釘選、自訂任務、隱藏、排序、偏好、以物易物篩選）只存在你的瀏覽器：`localStorage` key `mabiroutine:v2`，用 row `id` 當 key 參照靜態 rows。寫入是 idle-deferred（連打不卡），切換分頁/關閉時強制 flush；極端情況下最多丟失約 1.5 秒內的操作。

**App 更新時（自動 migrate，不用動手）：**
1. 載入時先補結構預設值（無版本號的遠古存檔、手改過的存檔也會被修好，不會白屏），再比對存檔的 schema `version`，缺的步驟按順序補跑（`useAppStore.ts` `migratePersisted`），再蓋章。你的勾選/釘選/自訂任務永遠不會被覆寫——只補預設欄位、只清懸空 key。
2. 上游刪了某 row（例如 `id` 改名）：該 row 殘留的勾選/隱藏/排序會被清掉（v6）。改名 = 刪除+新增，舊進度不會繼承——重要進度先用頁尾 匯出 JSON 備份。
3. 只改內容（敘述、`max`）：即時生效；進行中的計次保留，下次點擊時按新 `max` 夾取。

**衝突與逃生門（你的資料你作主）：**
- 多裝置/多瀏覽器各自獨立，沒有同步。以最後寫入該瀏覽器的為準；跨裝置請用頁尾 匯出 JSON → 另一台 匯入 JSON。匯入是整包取代，先匯出備份。
- 匯入舊版備份：照常匯入——匯入走同一條 normalize + migrate，缺欄位當場補、懸空 key 當場清；備份裡的多餘欄位會在下次存檔時丟棄。
- 壞掉/想重來：頁尾 重置所有資料（二次確認後回到預設：1 角色 + 必換釘選）。
- 手動開刀：DevTools → Application → Local Storage → `mabiroutine:v2`（`state.characters[].taskValues`…）；改壞了就匯入備份或重置。

## Deploy

- **Vercel Hobby (free):** import the GitHub repo, framework preset Vite (build `pnpm build`, output `dist` auto-detected) → auto deploy on push. Free URL is `<project-name>.vercel.app` (name it `mabiroutine`). No `vercel.json` needed: single-page app with no router, so no rewrites required.
- No env vars, static only.

## Project Structure

```
src/
  data/tracker.json      # 20 tracker rows (hand-owned source of truth)
  data/barter.json       # 98 barter rows (hand-owned source of truth)
  lib/types.ts           # Task/Character/AppState (persist schema v9)
  lib/reset.ts           # Asia/Taipei 06:00 daily / Mon 06:00 weekly (UTC+8 fixed)
  lib/utils.ts           # cn()
  store/useAppStore.ts   # Zustand persist (key mabiroutine:v2, schema v9 + migrate), resets, char ops, barter pins, drag order
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
- Pins persist as one global list (schema v9; v6 fork saves reset to must defaults on update)
