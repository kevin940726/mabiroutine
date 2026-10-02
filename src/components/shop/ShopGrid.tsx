// The shop grid entry point: the panel mounts this and it renders one tile per row,
// sectioned by town or by merchant. See shared.tsx for the sectioning and Tile.tsx
// for the tile itself.
import { TradeGrid, type ShopProps } from "./shared";
import { Tile } from "./Tile";

export function ShopGrid({
  items,
  pinned,
  onTogglePin,
  splitKind,
  byNpc,
  onViewInShop,
  onOpenNpc,
  focusKey,
  preserveOrder,
}: ShopProps) {
  return (
    <TradeGrid
      items={items}
      byNpc={byNpc}
      splitKind={splitKind}
      preserveOrder={preserveOrder}
      renderTile={(item, showBand) => (
        <Tile
          key={item.key}
          item={item}
          pinned={pinned}
          onTogglePin={onTogglePin}
          showMerchant={showBand}
          onViewInShop={onViewInShop}
          onOpenNpc={onOpenNpc}
          focused={focusKey != null && item.pinId === focusKey}
        />
      )}
    />
  );
}
