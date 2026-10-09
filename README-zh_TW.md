# MabiRoutine 🎯 — 瑪奇 Mobile 日課追蹤

**[English version](README.md)**

每天上線，看著滿滿待辦發呆，最後還漏掉最重要的那個？MabiRoutine 就是來
解決這個的：台服專用的日課、週課、 以物易物 check 清單，分角色記錄
（伺服器限次的交換全角色共用），
06:00 自動重置，你只管打勾就好。

👉 **直接用：https://mabiroutine.vercel.app/** — 免註冊，開了就能勾。

## 功能

- ☀️ 每日、每週與帳號任務（地下城、挑戰、兼職、亡靈之塔、事件、公會與好友挑戰）都在同一頁，點一下打勾。
- ⏰ 每天 06:00、每週一 06:00（台北時間）自動重置，標頭有即時倒數。
- 👥 最多 6 隻角色，一人一個分頁，可改名、可拖曳排序，進度分開記錄。
- 🔄 225 筆金幣與以物易物交易，依城鎮和 NPC 瀏覽，可用「我有／我缺」搜尋、釘選到每日清單，並查看每筆交易的材料明細。
- ✏️ 自訂任務、拖曳排序、隱藏、深色模式；接上同步連結後，任務列與已釘選的排序會同步。
- 🔗 可選的跨裝置同步：一條連結、免帳號；不連也能離線使用。
- 📲 可安裝成 App（Android／桌機有安裝鈕、iPhone 加入主畫面），沒網路也能用。
- 🔔 可選的提醒鈴鐺（不祥的召喚結界、深淵的黑色坑洞）：App 開著用本地提醒，關閉時由伺服器推播；每台裝置各自訂閱，提醒不保證每次送達。
- 🔒 進度存在瀏覽器（localStorage），不在我們的資料庫；沒有追蹤或廣告。只有你自行開啟的推播訂閱會存在伺服器。

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
