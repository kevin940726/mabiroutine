import type { CuratedPriority } from "@/lib/shops";

/**
 * One row of the shop: a gold purchase or a barter deal, widened to a single shape
 * so the grid has one row type to render.
 *
 * This lives here rather than in MerchantPanel because the grid reads it too, and
 * importing it from the panel made the grid depend on the panel while the panel
 * depended on the grid. Both now import this.
 */
export type ShopRow = {
  key: string;
  npc: string;
  town: string;
  /** The item name as the reader sees it, shaped by `getText` (which runs
   *  `displayName`), with any ` ×N` for a barter yield still inline. The ICON must not
   *  use this one — see `rawName`. */
  title: string;
  /** The item name exactly as the data spells it, no ` ×N`.
   *
   *  The icon lookup needs this and NOT `title`. The files are named from the data, and
   *  `displayName` rewrites the parens for reading, so a path built from the display
   *  title can miss the file — measured when it widened them: nine shop rows resolved to
   *  `/items/...%EF%BC%883%E7%B4%9A%EF%BC%89.webp` against a half-width `(3級)` on disk,
   *  which answers `index.html` at 200 and fails to decode. The direction `displayName`
   *  rewrites in is incidental to the rule: the lookup always takes the data's spelling.
   *  This is the trap `lib/itemIcon.ts` describes, kept
   *  here as a named field so no call site has to remember it. */
  rawName: string;
  /** Exactly as authored: a gold row carries the coin glyph here, a barter row
   *  carries "name ×N". The tile shows a stripped name plus qty instead. */
  give: string;
  /** What the trade yields, i.e. "what you get". Barter only: a gold purchase has
   *  no get, and the field is "" for it rather than optional, so the type stays
   *  total and every row is assignable wherever a row is expected. */
  get: string;
  /** Display cost: the coin for gold purchases, the material for barter. */
  cost: string;
  /** The cost's parts, for a renderer that shows an icon instead of a word. Gold,
   *  喵幣 and 愛心幣 take the icon form; every other currency keeps `cost`. */
  costCurrency: string;
  costAmount: number | null;
  limitText: string | null;
  /** Account-wide rather than per character, i.e. the in-game 伺服器 badge. */
  scopeAccount: boolean;
  priority: CuratedPriority | null;
  /** Art override from the option (`icon`): a data-spelled item name whose file
   *  to show instead of this row's own. Null follows the filename convention. */
  icon: string | null;
  kind: "shop" | "barter";
  /** Position in the curated order list, or -1 when the deal is not curated. */
  curatedIndex: number;
  /** Stable option id when this deal is curated. */
  barterId: string | null;
  /** The id a pin on this row uses — barterId when curated, else a shop:: id. */
  pinId: string;
};
