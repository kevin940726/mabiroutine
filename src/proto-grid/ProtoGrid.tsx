// PROTOTYPE (throwaway): mounts the shop grid on the real 以物易物 route behind
// ?gridproto=a|b. See Tile.tsx for the tile and shared.tsx for the scaffolding.
//
//   a  merchant blocks: a header per merchant, 金幣 / 以物易物 sub-labels inside,
//      tiles carry no merchant of their own
//   b  one flat grid: no blocks, no split, merchant band inside each tile, rows in
//      authored order (barter.json, then gold)
import type { MerchantItem } from "@/components/MerchantPanel";
import { ProtoShop, ProtoFlat } from "./Tile";

export function ProtoGrid({
  variant,
  items,
  pinned,
  onTogglePin,
  order,
  showHeader,
}: {
  variant: "a" | "b";
  items: MerchantItem[];
  pinned: Set<string>;
  onTogglePin: (id: string) => void;
  order: string[];
  showHeader?: boolean;
}) {
  const props = { items, pinned, onTogglePin, order, showHeader };
  return variant === "b" ? <ProtoFlat {...props} /> : <ProtoShop {...props} />;
}
