// Canonical town order for barter display + data-file order (town → npc →
// shops). Hand-owned per user (game-region order, not collation):
// barter.json rows and the explorer sort both follow this list. Unknown
// towns (future data) sort after known ones, zh-Hant between themselves.
export const TOWN_ORDER = [
  "堤爾克那",
  "杜加德走廊",
  "杜巴頓",
  "冰霜峽谷臨時哨所",
  "庫漢",
  "萊爾特丘陵",
  "班克爾",
  "地下城、狩獵場",
] as const;

const TOWN_RANK = new Map<string, number>(TOWN_ORDER.map((t, i) => [t, i]));

export function townRank(town: string): number {
  return TOWN_RANK.get(town) ?? Number.MAX_SAFE_INTEGER;
}

export function compareTowns(a: string, b: string): number {
  return townRank(a) - townRank(b) || a.localeCompare(b, "zh-Hant");
}
