# Tracker data — TW-only source & filtering guide

This repo clones `https://mabinogimobile.nipponhashi.com/tracker/` + `/barter/` but **only 台服 (TW) data**. 韓服 (KR) is preview/not yet live and must never be seeded into `src/data/*`.

## Sources (canonical + cross-ref)

1. **nipponhashi Tracker (primary — tracker only):** `https://mabinogimobile.nipponhashi.com/tracker/` — `server-switch-block [data-server-aware]`, `button[data-server-set="tw"]` active default, hint `預設只顯示台服現在拿得到的內容。切到「韓服」可以看到台服尚未實裝的部分`. This is the **tracker** seeding source; default `tw` view is TW.
2. **Meowka Notebook (primary golden for barter, per user):** `https://mabinogi-mobile-notebook.vercel.app/` + `barter-data.js` — 88 rows, `verified: "tw"|"kr"` (70 tw / 18 kr), `rec: 必換/推薦/首次必換/視需求`. **This is the barter gold set** — do not use nipponhashi for barter seeding.
3. **yenyen DB (primary golden for barter, per user):** `https://mabi.yenyen.dev/` — 86 rows, `地區` (tir/dugald/dunbarton/colhen/ice/dungeon) + `推薦度 必換/首次必換/推薦/視需求`. All shown are TW. Use with notebook 70 as union (70 + 16 extra).
4. **nipponhashi Barter (cross-ref only, demoted per user):** `https://mabinogimobile.nipponhashi.com/barter/` — 226 rows `每角色獨立計算`. **Not golden** — only diff to find rows notebook/yenyen miss; never seed from it.
5. **mabitw Daily:** `https://mabitw.com/daily` —韓服前輩 initial KR frame, now **逐項校正為台版實裝**, but still carries `黑洞/結界` weekly counts as 玩家實測 非官方.
6. **bobogameguides Checklist (official-vs-community arbiter):** `https://bobogameguides.com/mabinogi-mobile/checklist/daily/` — Only `專注遊玩活動/公會任務/格里斯貝恩` etc are `官方已確認` (counts+reset+range all明文). `兼職/黑洞/結界/狩獵場頭目` are `社群整理／待核` — **not counted in completion** there, even though they exist in TW.

KO mirrors for diff only: `/ko/tracker/`, `/ko/barter/` — never seed, only diff to find `krOnly`.

## Item Inventory — Reviewed 2026-09-04, cross-ref 6 sources, TW-only (hardcode per user)

**Rule for ambiguous counts:** `召喚結界 7次` and `黑色坑洞 每日1+每週7=14` are **hardcoded as TW per user confirmation** (`confirmed 結界 7次 and 黑色坑洞 7+7次. you can hardcode`), even though bobogameguides still marks them 待核. Descriptions below are stripped of `韓服社群數值` wording and state TW rule as fact. If TW official later publishes different, bump this doc and `tracker.json`.

### ☀️ 每日 (per-char, 06:00 Asia/Taipei)
| id | name | type | max | desc (TW-only) | cross-ref |
|---|---|---|---|---|---|
| daily-dungeon | 週幾地下城 | check | - | 每日 1 次。一／四 閃耀洞穴（金幣）・二／五 璀璨宅邸（寶石）・三／六 燦爛遺跡（催化劑）・日 自選。需先接每週兼職。 | nipponhashi |
| daily-challenge | 每日挑戰 | counter | 8 | 每日 8 個挑戰，會員有另外 2 個專屬挑戰，6 次拿滿額外獎勵。06:00 重置。 | user hand-added 2026-09-04; max 10→8, store v11→v12 caps over-max |
| deep-dungeon | 深層地下城 | counter | 2 | 消耗魔族貢品進入（Lv55+）。貢品每 12 小時 +1、上限 10——別讓它積滿停止恢復。 | nipponhashi; bobogameguides 深淵指南 |
| parttime | 兼職 | check | - | 18:00 刷新 1 個 | nipponhashi; bobogameguides 已確認 週一06:00重置 + 每日18:00 |
| tower | 亡靈之塔 | counter | 20 | 每日 20 次挑戰機會（06:00 重置） | nipponhashi — flipped check→counter back 2026-09-05 now that grab-adjust exists; store v10→v11 carries checked `true` as 20 |

### 🗓️ 每週 (Mon 06:00)
| id | name | type | max | desc (TW-only) | cross-ref |
|---|---|---|---|---|---|
| barrier | 召喚結界 | countdown | 7 | 每小時整點出現（約 10 分鐘）。戰利品次數每週 7 次，週一 06:00 重置，開箱時扣次數。Tile 顯示剩餘（剩 N / 7）。 | **hardcoded per user**; nipponhashi prior "7次為韓服社群" stripped; mabitw 整點出現; bobogameguides 待核 but user hardcodes |
| black-hole | 黑色坑洞 | countdown | 14 | 狩獵場隨機出現。每日 1 次 + 每週額外 7 次，獎勵次數每週一 06:00 重置，開箱時扣次數（無主戰利品也扣）。每週最多 14 次。Tile 顯示剩餘（剩 N / 14）。 | **hardcoded per user**; moved daily→weekly 2026-09-04; max 7→14 2026-09-05; mabitw 7+7 agrees |
| weekly-goals | 冒險家工會的定期委託 | check | - | 每周完成冒險家工會的定期委託任務至少一次，通關深層地下城 3 次，通關地下城 5 次，通關狩獵場 5 次，週一 06:00 重置。 | user hand-added |
| abyss | 深淵 | counter | 3 | 每週通關獎勵 3 次，入場次數無限制；週一 06:00 重置。 | nipponhashi 官方原文 |
| raid-gris | 團隊副本（格里斯貝恩） | counter | 1 | 每個首領每週 1 次獎勵，入門與困難共用同一次。週一 06:00 重置。 | nipponhashi; bobogameguides 已確認 65級+困難已開放 |
| field-boss | 野外首領 | counter | 1 | 每週 1 次討伐戰利品，週一 06:00 重置。之後仍有基本獎勵。每日 12/18/20/22 時出現。 | nipponhashi |
| weekly-challenge | 每週挑戰 | counter | 9 | 每週 9 個挑戰，會員有另外 2 個專屬挑戰，7 次拿滿額外獎勵。週一 06:00 重置。 | user hand-added 2026-09-04; max 11→9, store v11→v12 caps over-max |

### 👥 帳號共通
| id | name | kind | desc (TW-only) | cross-ref |
|---|---|---|---|---|
| acc-stella | Stella Pick | account-daily | 每日 1 次免費抽選（06:00 重置） | nipponhashi TW |
| acc-silver | 銀幣箱採買 | account-daily | 商城德卡商店每日銀幣箱——銀幣是副本入場瓶頸，必買 | nipponhashi |
| acc-gem | 碎裂寶石箱 ×10 | account-daily counter 0/10 | 金幣商店每日 10 個——餵星稜鏡製作 | nipponhashi |
| acc-shopfree | 商店免費禮包 | account-daily | 商城每日免費物品領取 | nipponhashi |
| acc-attendance | 每日簽到 | account-daily | 出席獎勵領取 | nipponhashi |
| acc-member | 會員每日領取 | account-daily | 會員每日道具會寄到伺服器信箱（06:00 發放），記得收。 | nipponhashi |
| guild-challenges | 公會挑戰 | account-weekly | 每週全公會完成 80 次公會挑戰，週一 06:00 重置。 | user hand-added (replaces acc-guild-weekly) |
| acc-field-last | 野外首領尾刀 | account-weekly | 每週首領最後一擊稱號挑戰 | nipponhashi |
| friend-challenges | 好友共同挑戰 | account-weekly | 每週與好友共同完成挑戰，週一 06:00 重置。 | user hand-added |

**Result: `src/data/tracker.json` now 21 TW rows (5 daily + 7 weekly + 9 account). 2026-09-04: added `daily-challenge` + `weekly-challenge`, `tower` counter→check, `black-hole` daily→weekly (prior hunt / barter-check / life-weekly / acc-guild-weekly removals already landed). `barrier` + `black-hole` are type `countdown` (倒數: counter semantics, tile shows 剩餘, mobile + desktop; fill still rises with used). No store bump: additions need no backfill, old `tower` numbers degrade to truthy checks, `black-hole` values carry as weekly progress. No KR rows.**

### Barter — TW-only guidance

- **Primary TW gold set:** `notebook 70 tw` (`verified:"tw"`). These are TW-verified; use as `priority=must` defaults.
- **Secondary:** `yenyen 86` (all TW) — overlaps notebook 70 + 16 extra TW rows.
- **Full:** `nipponhashi 226` — currently all 226 appear in TW mode, but treat as TW *unless* row has `verified:"kr"` in notebook or `data-available="kr-only"` / hidden when `tw` active.
- `src/data/barter.json` (98 rows: notebook 70 + yenyen union) is hand-owned. Full seed is notebook 70 tw as base, extended to yenyen 86 after diff, never include notebook 18 kr.
- `perChar` / `limit` / `rec` / `region` come from notebook/yenyen, not invented.
- **Default pins are a hand-owned list:** `src/data/defaultPins.json` (`pins` array of barter ids) — NOT derived from `priority==="must"`. Curate it by hand; when checking sources by hand, watch for must-priority drift the same way. Store sanitizes the list against barter.json ids at load (unknown ids dropped, order kept).

## Filtering Rules — manual-only, no fetchers

**You own `src/data/tracker.json` and `src/data/barter.json` by hand. The
suggest/update fetcher scripts were removed from this tree on open-sourcing
(recoverable from git history); never re-add them. Check sources in a browser
by hand:**

1. Open `https://mabinogimobile.nipponhashi.com/tracker/` in TW view (default) for tracker; `https://mabinogi-mobile-notebook.vercel.app/barter-data.js` (`verified==="tw"`) + `https://mabi.yenyen.dev/` for barter ground truth; `https://mabinogimobile.nipponhashi.com/barter/` for eyeball diff only.
2. Take only TW-visible content: tracker TW tab active; exclude anything marked `韓服`/`KR預覽`/`台服未實裝`; barter excludes notebook `verified==="kr"`. For `barrier`/`black-hole`, use hardcoded 7 / 7+7 above, don't re-derive from KR text.
3. Never use `/ko/*` content for seeding.
4. `召喚結界` and `黑色坑洞` counts are **hardcoded TW** per user (7 and 7+7) — do not overwrite with `韓服社群` fallback.
5. Edit `src/data/tracker.json` and `src/data/barter.json` by hand with filtered rows only. Write `note` in our own voice (short facts stay; see DATA_LICENSE).

## Maintenance

- On source update, re-run filter, commit `src/data/*`, bump `store` version if schema changes (see AGENTS.md store checklist).
- Do not add `barrier`/`black-hole` back to `韓服社群數值` wording — keep TW hardcoded per this doc.
- This doc is the agent's source of truth for data — do not add KR data even if barter count >226 includes KR preview.

## Source terms (checked 2026-09-05, open-sourcing Phase 1)

Do not re-research from scratch; re-verify only if a source redesigns.

- **nipponhashi (`/about`, `/privacy`):** fan site, no reuse grant anywhere. Posture: 社群公開資訊人工整理, no datamining/packet-sniffing/client extraction; claims NEXON IP-guide compliance; carries the 非官方 disclaimer (NEXON/devCAT 無關, rights belong to owners, in-game wins). Our footer mirrors that disclaimer back.
- **yenyen (`/sources`, `/privacy`):** notebook → yenyen reprint is explicit (已取得作者轉載授權, 骨架從這裡來) but covers that site only, NOT us. Chain also credits Femiwiki (**CC BY-SA 4.0** — share-alike follows derivatives; our note rewrite must be genuinely ours, not a paraphrase hugging the original) and Inven forum authors (no license stated). yenyen ships **no game art** (不使用客戶端解析資料或遊戲美術資產, 物品一律以文字識別) — we ship self-taken NPC screenshots instead, excluded from any CC grant, takedown on request.
- **NEXON game IP guide (KR `m.nexon.com/terms/716` + EN equivalent):** UGC must credit NEXON + game title, non-commercial only, never imply official. Strict clause: non-profit digital contents (applications included) require **prior written consent** via customer center. Decision: disclaimer + takedown path, no pre-consent letter (same posture as the three fan sources). Never add monetization (ads, donations-for-content, paywalled features) without revisiting this.
- **Taiwan scraping law:** facts (NPC/give/get/counts) are low risk; creative expression (`note` commentary, `rec` curation, selection/arrangement as 編輯著作) is protected. Lawsnote precedent criminalized mass-scrape-into-competing-product. Mitigations decided: `note` rewrite in user's own voice (pending — blocks the CC BY-NC stamp), scraper scripts leave the public tree (Phase 2), fetchers stay suggest-only and maintainer-run.
- **Day-one forum posts (e.g. Bahamut 2077):** per user, one-time public knowledge — not cited in footer/README. Dropped from this doc 2026-09-05; do not re-add.
