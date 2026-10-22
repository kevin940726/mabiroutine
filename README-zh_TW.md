# MabiRoutine 🎯 — 瑪奇 Mobile 日課追蹤

**[English version](README.md)**

每天上線，看著滿滿待辦發呆，最後還漏掉最重要的那個？MabiRoutine 就是來
解決這個的：台服專用的日課、週課、 以物易物 check 清單，分角色記錄
（伺服器限次的交換全角色共用），
06:00 自動重置，你只管打勾就好。

👉 **直接用：https://mabiroutine.vercel.app/** — 免註冊，開了就能勾。

## 功能

- ☀️ 每日、每週與帳號任務都在同一頁。
- ⏰ 06:00（台北時間）重置，未完成的定期委託會帶到下一週。
- 👥 最多 6 隻角色，進度分開記錄。
- 🔄 所有金幣與以物易物交易，可搜尋與釘選。
- ✏️ 自訂任務，可隱藏。
- 🔗 可選的跨裝置同步，一條連結、免帳號。
- 🔔 可選提醒：不祥的召喚結界、深淵的黑色坑洞。
- 📲 可安裝成離線 App。
- 🔒 資料留在本機：免帳號、沒有追蹤或廣告。

## 出處與授權

非官方粉絲自製，非營利，台服限定。與 NEXON / devCAT 無關；遊戲名稱、NPC、
道具和美術的權利都歸原權利人（NPC 頭像是自己截的遊戲畫面）。數值是社群實測
整理，以遊戲內為準。如果有權利上的問題，開個 GitHub issue，我會下架相關內容。

- **瑪奇Mobile Wiki DB**（`mabinogimobile.nipponhashi.com/tracker/`）——追蹤器
  的結構和重置時間對照（以物易物頁只有拿來比對，沒有抄）。
- **Meowka 以物易物記事本**（`mabinogi-mobile-notebook.vercel.app`）——以物易物
  清單的骨架；推薦評語都用自己的話重寫過了。
- **yenyen 繁中資料庫**（`mabi.yenyen.dev`）——補上少數交換和地區對照。
- **mabitw**（`mabitw.com/daily`）、**bobogameguides**（`bobogameguides.com/…`）
  ——次數和官方/社群狀態的交叉比對。
- 程式碼 MIT（`LICENSE`），資料檔 CC BY-NC 4.0（`DATA_LICENSE`），遊戲美術除外。

## 一起來改

- `pnpm install && pnpm dev` 就能跑 → 細節在 `docs/development.md`（完整開發、
  部署、專案結構）。
- 遊戲資料（`src/data/*.json`）是手動維護的 → 動手前先看 `docs/tracker-data.md`。
- 進度和同步的存法 → `docs/storage.md`。
