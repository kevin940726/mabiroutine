// The shop grid, mounted on the real 以物易物 route. This is the shop view now, not
// a variant behind a param: the old row/tab UI is the one kept behind a dev-only
// ?rows=1 for comparison. See Tile.tsx for the tile and shared.tsx for the sectioning.
//
// The grid is the unfiltered view, sectioned by town, with the merchant inside each
// tile. A town or NPC filter switches the sections to merchants with a portrait
// header. The A/verdict/title/band alternatives were removed after review, so this
// file takes no variant. The Proto* naming and the ?rows=1 param go in the fold-in.
import type { MerchantItem } from "@/components/MerchantPanel";
import { ProtoShop } from "./Tile";

export function ProtoGrid({
  items,
  pinned,
  onTogglePin,
  splitKind,
  byNpc,
  onViewInShop,
  onOpenNpc,
  focusKey,
}: {
  items: MerchantItem[];
  pinned: Set<string>;
  onTogglePin: (id: string) => void;
  splitKind?: boolean;
  byNpc?: boolean;
  /** Targets the producing merchant for the give, plus the material name so the
   *  caller can flash the producing row. Typed to plain values for the same reason
   *  the tile callback is: the grid widens rows to ProtoItem, and this handler never
   *  needs the row itself. */
  onViewInShop?: (npc: string, giveName: string) => void;
  /** Opens a merchant's own shop from the tile's portrait band — same destination as
   *  onViewInShop but no row to flash. */
  onOpenNpc?: (npc: string) => void;
  focusKey?: string | null;
}) {
  return (
    <ProtoShop
      items={items}
      pinned={pinned}
      onTogglePin={onTogglePin}
      splitKind={splitKind}
      byNpc={byNpc}
      onViewInShop={onViewInShop}
      onOpenNpc={onOpenNpc}
      focusKey={focusKey}
    />
  );
}
