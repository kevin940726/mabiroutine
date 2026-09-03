# AGENTS — Data Source & 台服 Filtering Guide

This repo clones `https://mabinogimobile.nipponhashi.com/tracker/` + `/barter/` but **only 台服 (TW) data**. 韓服 (KR) is preview/not yet live and must never be seeded into `src/data/*`. Use this guide so any agent or script grabs only TW.

## Sources (canonical + cross-ref)

1. **nipponhashi Tracker (primary — tracker only):** `https://mabinogimobile.nipponhashi.com/tracker/` — `server-switch-block [data-server-aware]`, `button[data-server-set="tw"]` active default, hint `預設只顯示台服現在拿得到的內容。切到「韓服」可以看到台服尚未實裝的部分`. This is the **tracker** seeding source; default `tw` view is TW.
2. **Meowka Notebook (primary golden for barter, per user):** `https://mabinogi-mobile-notebook.vercel.app/` + `barter-data.js` — 88 rows, `verified: "tw"|"kr"` (70 tw / 18 kr), `rec: 必換/推薦/首次必換/視需求`. **This is the barter gold set** — do not use nipponhashi for barter seeding.
3. **yenyen DB (primary golden for barter, per user):** `https://mabi.yenyen.dev/` — 86 rows, `地區` (tir/dugald/dunbarton/colhen/ice/dungeon) + `推薦度 必換/首次必換/推薦/視需求`. All shown are TW. Use with notebook 70 as union (70 + 16 extra).
4. **nipponhashi Barter (cross-ref only, demoted per user):** `https://mabinogimobile.nipponhashi.com/barter/` — 226 rows `每角色獨立計算`. **Not golden** — only diff to find rows notebook/yenyen miss; never seed from it.
5. **mabitw Daily:** `https://mabitw.com/daily` —韓服前輩 initial KR frame, now **逐項校正為台版實裝**, but still carries `黑洞/結界` weekly counts as 玩家實測 非官方.
6. **巴哈 2077:** `https://forum.gamer.com.tw/C.php?bsn=32564&snA=2077` — 玩家實測整理 (black hole daily1+weekly7=14/week, 結界 weekly7).
7. **bobogameguides Checklist (official-vs-community arbiter):** `https://bobogameguides.com/mabinogi-mobile/checklist/daily/` — Only `專注遊玩活動/公會任務/格里斯貝恩` etc are `官方已確認` (counts+reset+range all明文). `兼職/黑洞/結界/狩獵場頭目` are `社群整理／待核` — **not counted in completion** there, even though they exist in TW.

KO mirrors for diff only: `/ko/tracker/`, `/ko/barter/` — never seed, only diff to find `krOnly`.

## Item Inventory — Reviewed 2026-09-02, cross-ref 7 sources, TW-only (hardcode per user)

**Rule for ambiguous counts:** `召喚結界 7次` and `黑色坑洞 每日1+每週7=14` are **hardcoded as TW per user confirmation** (`confirmed 結界 7次 and 黑色坑洞 7+7次. you can hardcode`), even though bobogameguides still marks them 待核. Descriptions below are stripped of `韓服社群數值` wording and state TW rule as fact. If TW official later publishes different, bump `AGENTS.md` and `tracker.json`.

### ☀️ 每日 (per-char, 06:00 Asia/Taipei)
| id | name | type | max | desc (TW-only) | cross-ref |
|---|---|---|---|---|---|
| hunt | 狩獵場探險 | check | - | 每日探險次數 1 次（當天不用、隔天 06:00 消失）＋每週超額 7 次（週一 06:00 重置） | nipponhashi TW; mabitw 校正; bobogameguides 部分待核 but kept as TW |
| daily-dungeon | 週幾地下城 | check | - | 每日 1 次。一／四 閃耀洞穴（金幣）・二／五 璀璨宅邸（寶石）・三／六 燦爛遺跡（催化劑）・日 自選。需先接每週兼職。 | nipponhashi; gamer 2077 (每個周幾都不一樣) |
| black-hole | 黑色坑洞 | counter | 7 | 狩獵場隨機出現。每日 1 次 + 每週額外 7 次，獎勵次數每週一 06:00 重置，開箱時扣次數（無主戰利品也扣）。每週最多 14 次。 | **hardcoded per user**; nipponhashi prior "無上限" outdated; gamer 2077 + mabitw 7+7 agree; yenyen/notebook not applicable |
| barter | 以物易物 | check | - | NPC 以物換物——每角色每日上限，分身也要跑 | nipponhashi TW; yenyen 86 / notebook 70 tw |
| deep-dungeon | 深層地下城 | counter | 2 | 消耗魔族貢品進入（Lv55+）。貢品每 12 小時 +1、上限 10 | nipponhashi; gamer (愛心幣叫NPC); bobogameguides 深淵指南 |
| tower | 亡靈之塔 | counter | 20 | 每日 20 次挑戰機會（06:00 重置） | nipponhashi; gamer (每日20次, 獎勵1次) |
| parttime | 兼職 | counter | 2 | 06:00 與 18:00 各刷新 1 個（每週一 06:00 全重置） | nipponhashi; bobogameguides 已確認 週一06:00重置 + 每日06:00/18:00 |

### 🗓️ 每週 (Mon 06:00)
| id | name | type | max | desc (TW-only) | cross-ref |
|---|---|---|---|---|---|
| barrier | 召喚結界 | counter | 7 | 每小時整點出現（約 10 分鐘）。戰利品次數每週 7 次，週一 06:00 重置，開箱時扣次數。 | **hardcoded per user**; nipponhashi prior "7次為韓服社群" stripped; gamer 2077 (每週7次); mabitw 整點出現; bobogameguides 待核 but user hardcodes |
| abyss | 深淵 | counter | 3 | 每週通關獎勵 3 次，入場次數無限制；週一 06:00 重置。 | nipponhashi 官方原文; gamer (每週3次) |
| raid-gris | 團隊副本格里斯貝恩 | counter | 1 | 每個首領每週 1 次獎勵，入門與困難共用。週一 06:00 重置。 | nipponhashi; bobogameguides 已確認 65級+困難已開放; gamer |
| field-boss | 野外首領 | counter | 1 | 每週 1 次討伐戰利品，週一 06:00 重置。之後仍有 100金+100證明。每日 12/18/20/22 時出現。 | nipponhashi; gamer (每週首次7.5萬金+720證明) |
| life-weekly | 生活技能週任務 | check | - | 生活內容週間目標 | nipponhashi TW only |

### 👥 帳號共通
| id | name | kind | desc (TW-only) | cross-ref |
|---|---|---|---|---|
| acc-stella | Stella Pick | account-daily | 每日 1 次免費抽選（06:00 重置） | nipponhashi TW |
| acc-silver | 銀幣箱採買 | account-daily | 商城德卡商店每日銀幣箱 | nipponhashi; gamer (每日1次能買10個, 上限100) |
| acc-gem | 碎裂寶石箱 ×10 | account-daily counter 0/10 | 金幣商店每日 10 個 | nipponhashi; gamer (40k金/10) |
| acc-shopfree | 商店免費禮包 | account-daily | 商城每日免費物品領取 | nipponhashi; gamer (精選商店免費商品) |
| acc-attendance | 每日簽到 | account-daily | 出席獎勵領取 | nipponhashi |
| acc-member | 會員每日領取 | account-daily | 會員每日道具會寄到伺服器信箱（06:00 發放） | nipponhashi |
| acc-guild-weekly | 公會任務 | account-weekly | 公會週間任務（每週 6 個，伺服器計算，週一 06:00 重置） | nipponhashi; bobogameguides 已確認 6個/伺服器/週一06:00 |
| acc-field-last | 野外首領尾刀 | account-weekly | 每週首領最後一擊稱號挑戰 | nipponhashi |

**Result: `src/data/tracker.json` now 20 TW rows, `black-hole` changed check→counter 0/7 and stripped `官方無每日次數限制` + `韓服社群` text, `barrier` stripped KR wording and hardcoded 7. No KR rows.**

### Barter — TW-only guidance

- **Primary TW gold set:** `notebook 70 tw` (`verified:"tw"`). These are TW-verified; use as `priority=must` defaults.
- **Secondary:** `yenyen 86` (all TW) — overlaps notebook 70 + 16 extra TW rows.
- **Full:** `nipponhashi 226` — currently all 226 appear in TW mode, but treat as TW *unless* row has `verified:"kr"` in notebook or `data-available="kr-only"` / hidden when `tw` active.
- Demo `src/data/barter.json` 30 rows sample the `must` (TW) slice. Full seed should be notebook 70 tw as base, optionally extended to yenyen 86 after diff, never include notebook 18 kr.
- `perChar` / `limit` / `rec` / `region` come from notebook/yenyen, not invented.

## Filtering Rules — manual-first, fetch is suggestion-only

**You own `src/data/tracker.json` and `src/data/barter.json` by hand. Fetchers never overwrite them — they only write `suggestions/` diffs (gitignored) for reference:**
- `pnpm suggest-tracker` → diff tracker rows vs TW tracker page → `suggestions/tracker.json`
- `pnpm suggest-barter` → diff barter.json vs notebook70+yenyen → `suggestions/barter.json`
- `pnpm update-barter` (= `--write`) overwrites `barter.json` — escape hatch only, wipes manual edits.

1. Fetch `https://mabinogimobile.nipponhashi.com/tracker/` **without** `kr` — default is TW for tracker. For barter, fetch `https://mabinogi-mobile-notebook.vercel.app/barter-data.js` (`verified==="tw"` 70) + `https://mabi.yenyen.dev/` (86) as ground truth; only fetch `https://mabinogimobile.nipponhashi.com/barter/` for diff.
2. Parse only TW-visible nodes:
   - **Tracker:** While `button[data-server-set="tw"].active`, select island content. Exclude any node with `data-server="kr"`, `hidden` when `tw` active, or text `韓服`/`KR預覽`/`台服未實裝`. For `barrier`/`black-hole`, use hardcoded 7 / 7+7 above, don't re-derive from KR text.
   - **Barter:** Seed from `notebook verified==="tw"` (70) + `yenyen` union; exclude `verified==="kr"` (18) even if present in nipponhashi 226. Never seed nipponhashi barter directly.
3. Never fetch `/ko/*` for seeding; only diff to log `TW: ${n} / skipped KR: ${m}`.
4. `召喚結界` and `黑色坑洞` counts are **hardcoded TW** per user (7 and 7+7) — script must not overwrite with `韓服社群` fallback.
5. Write `src/data/tracker.json` and `src/data/barter.json` only with filtered rows.

Pseudo:
```ts
const twHtml = await fetch(TW_URL).text(); // default tw
const notebook = await fetch(NOTEBOOK_URL).text(); // window.MABINOGI_BARTER_DATA
const twBarterIds = new Set(notebook.items.filter(i=>i.verified==="tw").map(i=>i.id)); // 70
// seed barter.json only with twBarterIds
```

## Maintenance

- On source update, re-run filter, commit `src/data/*`, bump `store` version if schema changes (see below).
- Do not add `barrier`/`black-hole` back to `韓服社群數值` wording — keep TW hardcoded per this file.
- This file is the agent’s source of truth — do not add KR data even if barter count >226 includes KR preview.

## Store Version Bumps (persist schema `useAppStore.ts`, current `v9`)

Key `mabiroutine:v2` is the storage slot name (stable); `version` is the schema number (bumps).
User progress always wins — migrate only fills defaults and prunes dangling keys, never overwrites values.

Checklist when persisted shape changes (new/renamed/removed field, removed row ids):
1. Bump `version` in **two** places: `initial.version` and persist config `version`.
2. Append `if (from < N) { ...; s.version = N; }` in `migratePersisted` — chain from the previous number, keep old steps forever (users may skip releases). `normalizePersisted` runs before steps on every load, so steps can assume full shape.
3. Removing row ids → extend the v6 prune pattern (add the new dangling container, or it generalizes already via the `valid` set of tracker+barter+custom ids).
4. Renaming a row id → add an explicit id-remap in the new step (prune would drop the old progress otherwise); tell the user first.
5. `pnpm build` must pass; user-facing impact goes in `CHANGELOG.md` + README storage section.

## Pre-push Gate (agents: run this before every push)

`pnpm check` = `lint` + `test:migrations` + `build`. All three must pass:
- `test:migrations` bundles the real `migratePersisted` and runs fixtures in `scripts/migration-check.entry.ts` (versionless save, synthetic barter ids, removed-id prune, passthrough, filter sanitize). If you add a migrate step, add a fixture block (A/B/C/D/E/F pattern) proving old data survives.
- Fixture premises (`hunt` removed, `acc-silver` exists) are tied to live data — if the premise line fails, update the fixture, not the data.
- `suggestions/` is gitignored; `src/data/*.json` diffs need human review — never auto-apply fetcher output.
