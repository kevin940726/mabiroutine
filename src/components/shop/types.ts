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
  title: string;
  /** Exactly as authored: a gold row carries the coin glyph here, a barter row
   *  carries "name ×N". The tile shows a stripped name plus qty instead. */
  give: string;
  /** What the trade yields, i.e. "what you get". Barter only: a gold purchase has
   *  no get, and the field is "" for it rather than optional, so the type stays
   *  total and every row is assignable wherever a row is expected. */
  get: string;
  /** Display cost: the coin for gold purchases, the material for barter. */
  cost: string;
  limitText: string | null;
  /** Account-wide rather than per character, i.e. the in-game 伺服器 badge. */
  scopeAccount: boolean;
  priority: CuratedPriority | null;
  note: string | null;
  kind: "shop" | "barter";
  /** Position in barter.json, or -1 when the deal is not curated. */
  curatedIndex: number;
  /** barter.json id when this deal is curated. */
  barterId: string | null;
  /** The id a pin on this row uses — barterId when curated, else a shop:: id. */
  pinId: string;
};
