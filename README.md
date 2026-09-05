# MabiRoutine — 瑪奇 Mobile 日課追蹤

Heavily inspired by https://mabinogimobile.nipponhashi.com/tracker/ + https://mabinogimobile.nipponhashi.com/barter/. TW only. Full source credits: 出處與授權 below (same links as the in-app footer).

- **Stack:** TypeScript + React 19 + Vite 8 + Tailwind v4 + shadcn/ui + Zustand (persist) + @dnd-kit + workbox (PWA) + Upstash Redis (sync, via Vercel functions)
- **Storage:** progress lives in your browser (`localStorage` key `mabiroutine:v2`, schema `version: 12`, see below) with optional cloud sync (see Sync). `Asia/Taipei` 06:00 daily / Mon 06:00 weekly auto-reset, live countdown.
- **UX:** Fresh shadcn, light/dark, mobile-first, ≤6 characters, battle-tested drag reorder.

## Features

### Tracker (mirrors original, TW-only, 21 rows)
- **☀️ 每日 (daily, per-char):** 週幾地下城 / 每日挑戰 0/8 / 深層地下城 0/2 / 兼職 (18:00 刷新勾選) / 亡靈之塔 0/20
- **🗓️ 每週 (Mon 06:00, per-char):** 召喚結界 0/7 / 黑色坑洞 0/14 / 冒險家工會定期委託 / 深淵 0/3 / 格里斯貝恩 0/1 / 野外首領 0/1 / 每週挑戰 0/9
- **👥 帳號共通 (shared):** Stella Pick / 銀幣箱 / 碎裂寶石箱 0/10 / 商店免費禮包 / 每日簽到 / 會員每日領取 (daily) + 公會挑戰 / 野外首領尾刀 / 好友共同挑戰 (weekly)
- Types: `check` (✓), `counter -0/N+` with progress bars, `countdown` 倒數 (tile shows remaining 剩 N/M); `hideCompleted` toggle is visual-only (progress unaffected); `清除本區` per section; overall `done/total · %`

### Characters
- Tabs, rename (`✎`), add/remove (cap 6 → `CharacterTabs.tsx:81` disables), per-char `taskValues` isolation, daily/weekly resets per char.

### Barter Merge — Both surfaces

**Data:** `src/data/barter.json` checked-in snapshot (98 rows: notebook TW 70 + yenyen union; KR rows never seeded). Skill chart (伐木/釣魚/挖礦…) + `priority` (`must`/`extra`/`once`/`situational`/`skip` → `一定要換` etc) + `town` + `gatherSkill`.

**1) Daily expanded group** `🔄 以物易物` in `TrackerSection.tsx:122` — shows effective pins for active char, expand to list pinned barter `TaskRow`s.

**2) Full Explorer** `BarterExplorer.tsx:1` — search `我有/我缺 (give/get)`, filters `優先度/城鎮/採集技能`, quick chips, `只看 已釘選` (active char), skill counts chart.

**Pin model — one global list:** `barterPins` in the store; tap toggles for every character, no per-character pins. Pinned rows appear in the tracker 每日 sub-category for all characters.

### Custom Tasks
- `+ 新增自訂` (`AddTaskDialog.tsx:1`) — any section, `check`/`counter`/`countdown`, `notes`, icon picker; edit via pencil, hide via `EyeOff` (per-char `hiddenTaskIds`), delete (confirm); drag reorder via `@dnd-kit` for **all** items (built-ins + barter pins + custom) using `SortableContext`.

### Other
- Theme toggle (`ThemeToggle.tsx:1`) persisted `theme` + `prefers-color-scheme`; sticky header with `每日重置 / 每週重置` countdown `hooks/useCountdown.ts:1`.
- Export/import JSON, `重置所有資料`, auto-migrate on update (`store/useAppStore.ts` `migratePersisted`, current schema `v12`).

### Sync (Upstash Redis + Vercel functions, free tier)
- Header 跨裝置同步 button (emerald when linked): one dialog with live URL (tap-to-copy), 複製, paste-import row, 重新產生連結 / 取消同步. Binding reflected in `?s=` (`replaceState`, no history spam).
- Conflict-free per-key LWW: every mutation is an absolute set of flat keys, server stamps arrival order (PATCH), client diffs + pull-merges in background (mount / tab-visible / focus / 60s repoll). No conflict UI exists by design. Full spec: `docs/sync.md`.
- Buckets are per-browser(-partition): same browser for install + links advised; iOS home-screen apps and mismatched Android browsers need the paste row.

### PWA
- Installable (`manifest.webmanifest`, standalone, maskable icon): Android/desktop install button via `beforeinstallprompt`, iOS/Samsung footer hints, nothing when standalone. Offline shell via `generateSW` default (navigations precached, `/api/*` never cached); new builds take over all tabs with a 已更新到新版本 toast.

## Commands (pnpm)

```bash
pnpm install
pnpm dev              # plain Vite (no API routes)
pnpm dev:api          # full stack: vercel dev + Vite on :52608 (API routes live)
pnpm build            # tsc -b && vite build → dist/ (+ sw.js)
pnpm preview          # vite preview
pnpm check            # gate: lint + migration fixtures + build
```

## Data Updates (manual-only)

`src/data/tracker.json` (21 rows) and `src/data/barter.json` (98 rows) are hand-owned sources of truth.
No fetcher scripts in this tree — check sources in a browser by hand, see `skills/update-tracker/SKILL.md`.
Edit the JSON by hand (`id` must stay stable — progress keys off it), then `pnpm build`.

## 出處與授權 (Sources & licenses)

Fan-made, non-commercial, TW-only tracker. Not affiliated with NEXON / devCAT; game names, NPCs, items and art belong to their owners (NPC avatars are self-taken screenshots). Values are community-verified — in-game wins. Rights concern? Open a GitHub issue and the content comes down.

- **瑪奇Mobile Wiki DB** (`mabinogimobile.nipponhashi.com/tracker/`) — tracker structure + reset-time cross-check. Its barter page is diff-only, never seeded. That site states its data is hand-compiled with no datamining; no reprint grant to us, credited by link.
- **Meowka 以物易物記事本** (`mabinogi-mobile-notebook.vercel.app`) — barter skeleton (70 TW rows). Its `rec`/`note` commentary is rewritten in our own voice.
- **yenyen 繁中資料庫** (`mabi.yenyen.dev`, incl. `/sources` + `/privacy`) — 16-row supplement + region/recommendation cross-check. Its notebook reprint grant covers that site only, not us. Its chain also credits Femiwiki (CC BY-SA 4.0) and Inven forum authors — credited here in turn.
- **mabitw** (`mabitw.com/daily`) — daily-list cross-check as it converges to TW implementation.
- **bobogameguides** (`bobogameguides.com/mabinogi-mobile/checklist/daily/`) — official-vs-community arbiter (only 專注遊玩活動/公會任務/格里斯貝恩 are 官方已確認 there).
- Day-one forum posts (e.g. Bahamut) informed initial counts but are treated as public knowledge, not cited sources.
- Code is MIT (`LICENSE`); data text (`tracker.json`/`barter.json`/`defaultPins.json`) is CC BY-NC 4.0 (`DATA_LICENSE`), NPC art excluded (NEXON fan-use, takedown on request).

## 資料、版本更新與 localStorage 衝突處理

**兩層資料，兩個主人：**
- 靜態 rows（`tracker.json` / `barter.json`）跟著 app 發布走，你的瀏覽器不快取它們：改名、改敘述、改 `max` 下次部署即生效。
- 你的進度（勾選、計次、釘選、自訂任務、隱藏、排序、偏好、以物易物篩選）只存在你的瀏覽器：`localStorage` key `mabiroutine:v2`，用 row `id` 當 key 參照靜態 rows。寫入是 idle-deferred（連打不卡），切換分頁/關閉時強制 flush；極端情況下最多丟失約 1.5 秒內的操作。

**App 更新時（自動 migrate，不用動手）：**
1. 載入時先補結構預設值（無版本號的遠古存檔、手改過的存檔也會被修好，不會白屏），再比對存檔的 schema `version`，缺的步驟按順序補跑（`useAppStore.ts` `migratePersisted`），再蓋章。你的勾選/釘選/自訂任務永遠不會被覆寫——只補預設欄位、只清懸空 key。
2. 上游刪了某 row（例如 `id` 改名）：該 row 殘留的勾選/隱藏/排序會被清掉（v6）。改名 = 刪除+新增，舊進度不會繼承——重要進度先用頁尾 匯出 JSON 備份。
3. 只改內容（敘述、`max`）：即時生效；進行中的計次保留，下次點擊時按新 `max` 夾取。

**衝突與逃生門（你的資料你作主）：**
- 跨裝置請用跨裝置同步（自動合併，見上）或頁尾 匯出 JSON → 另一台 匯入 JSON（整包取代，先匯出備份）。
- 匯入舊版備份：照常匯入——匯入走同一條 normalize + migrate，缺欄位當場補、懸空 key 當場清；備份裡的多餘欄位會在下次存檔時丟棄。
- 壞掉/想重來：頁尾 重置所有資料（二次確認後回到預設：1 角色 + 必換釘選）。
- 手動開刀：DevTools → Application → Local Storage → `mabiroutine:v2`（`state.characters[].taskValues`…）；改壞了就匯入備份或重置。

## Deploy

- **Vercel Hobby (free):** import the GitHub repo, framework preset Vite (build `pnpm build`, output `dist` auto-detected) → auto deploy on push. Free URL is `<project-name>.vercel.app` (name it `mabiroutine`). No `vercel.json` needed: single-page app with no router, so no rewrites required.
- Env vars (Upstash Marketplace install auto-injects; `SYNC_KEY_PREFIX` is Development-only for dev/prod key isolation — prod uses the default namespace).

## Project Structure

```
src/
  data/tracker.json      # 21 tracker rows (hand-owned source of truth)
  data/barter.json       # 98 barter rows (hand-owned source of truth)
  lib/types.ts           # Task/Character/AppState (persist schema v12)
  lib/reset.ts           # Asia/Taipei 06:00 daily / Mon 06:00 weekly (UTC+8 fixed)
  lib/utils.ts           # cn()
  store/useAppStore.ts   # Zustand persist (key mabiroutine:v2, schema v12 + migrate), resets, char ops, barter pins, drag order
  hooks/useCountdown.ts
  sync/api.ts            # /api/session client (POST/GET/PATCH/DELETE)
  sync/session.ts        # binding, snapshots, import, toasts
  sync/flat.ts           # flat key codec + merge (see docs/sync.md)
  sync/SyncButton.tsx / SyncImport.tsx
  components/
    ui/*                 # button/card/badge/input/label/textarea/dialog/select/separator/switch/tooltip
    TrackerSection.tsx / TaskRow.tsx / CharacterTabs.tsx / HeaderCountdown.tsx
    BarterExplorer.tsx / AddTaskDialog.tsx / ThemeToggle.tsx / InstallButton.tsx
  App.tsx / main.tsx / index.css
api/session.ts           # sync API (Upstash Redis, per-key arrival order)
public/manifest.webmanifest
scripts/check-migrations.mjs (+ crop-npc.py local art tool)
docs/sync.md             # sync design record
```

## Verification

- `pnpm check` ✓ — lint + migration fixtures + build
- Reset is `Asia/Taipei` fixed +8 (no DST), lazy + `focus/visibilitychange` + `60s` interval
- Pins persist as one global list; sync merges per-key with no conflicts (`docs/sync.md`)
