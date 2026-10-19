// Default barter pins: the rows a save starts with, in the order a fresh pin list
// keeps them (rendering follows the canonical curated order, not this array).
//
// HAND-OWNED, not derived from `priority === "must"`. Nineteen rows carry that
// tier and only some earn a permanent slot on the default checklist, so adding or
// dropping one is a hand decision — and a new `must` row is a cue to review this
// list, the same drift check `curatedOrder.ts` gets (docs/tracker-data.md).
//
// Ids are curated exchange ids (the `shops.json` option `id`, which is also the
// pin/sync key): never rename one. `DEFAULT_MUST_PINS` in the store filters out
// an id that no longer resolves, so removing a trade from the data is safe — but
// a stale line here still misleads the next reader, so delete it here too.
//
// New entries reach an existing save only through `seedMissingDefaultPins` on a
// linked pull (never migration, never boot): an unlinked save keeps its own pins.
// Comments name the trade, its limit, and why it earns the slot.
export const DEFAULT_PINS: string[] = [
  // Steel chain, one row per hop: 鋼錠 → 合金鋼錠 → 特殊鋼錠 → 銀合金錠.
  "tir-f3", // 佛格斯 合金鋼錠 ← 鋼錠 ×2 · 每日 4 次 · 堤爾克那 (feeds 特殊鋼錠)
  "tir-c1", // 凱琳 凱琳特製全麥麵包 ×3 ← 牛奶 ×10 · 每日 1 次 · 堤爾克那 (the bread 安黛莉's 聖水 trade spends)
  // 麗莎's two catalyst offers are SEPARATE rows, each with its own 每日 1
  // （伺服器）limit in the data; different give-sides (a craft, then a drop),
  // same output.
  "tir-l1", // 麗莎 高級鍊金術再燃燒催化劑 ← 蘋果汁 ×1 · 每日 1 次（伺服器） · 堤爾克那
  "tir-l2", // 麗莎 高級鍊金術再燃燒催化劑 ← 鍊金術碎屑 ×3 · 每日 1 次（伺服器） · 堤爾克那
  // Leather chain: 原木 → 生皮/高級生皮 → 皮革/高級皮革.
  "dug-t2", // 特蕾西 生皮 ← 原木 ×1 · 每日 10 次 · 杜加德走廊 (feeds 皮革)
  "dug-t3", // 特蕾西 高級生皮 ← 原木 ×10 · 每日 10 次 · 杜加德走廊 (feeds 高級皮革)
  "yen-奈麗絲合金鋼錠2特殊鋼錠-3", // 奈麗絲 特殊鋼錠 ← 合金鋼錠 ×2 · 每日 4 次 · 杜巴頓 (feeds 銀合金錠)
  "yen-奈麗絲銅礦石高級生皮-7", // 奈麗絲 高級生皮 ← 銅礦石 ×1 · 每日 10 次 · 杜巴頓 (the 銅礦石 route to 高級生皮)
  // Weekly sinks: spend a pile you already farm, once or twice a week.
  "dun-i6", // 伊文 遙遠的星辰印章 ← 魔物討伐證明 ×200 · 每週 1 次 · 杜巴頓
  "dun-m1", // 茉莉 赤紅深淵的化石 ×60 ← 深淵的化石 ×100 · 每週 2 次 · 杜巴頓
  "seumas-finest-bandage", // 休馬斯 卓越繃帶 ×5 ← 沙威瑪 ×1 · 每日 3 次 · 萊爾特丘陵 (the bandage consumable)
  "edern-silver-alloy-ingot", // 艾頓 銀合金錠 ×10 ← 鱸魚辣魚湯 ×1 · 每週 1 次 · 班克爾 (the big weekly silver)
  "jennifer-lean-meat", // 珍妮佛 清淡的肉 ×15 ← 黃豆 ×10 · 每日 1 次 · 班克爾 (feeds 沙威瑪)
];
