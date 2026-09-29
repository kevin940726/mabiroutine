// PROTOTYPE (throwaway): mounts the shop grid on the real 以物易物 route behind
// ?gridproto=1. See Tile.tsx for the tile and shared.tsx for the sectioning.
//
// One design remains: the grid is the unfiltered view, sectioned by town, with the
// merchant inside each tile. A town or NPC filter switches the sections to merchants
// with a portrait header. The A/verdict/title/band alternatives were removed after
// review, so this file no longer takes a variant.
import type { MerchantItem } from "@/components/MerchantPanel";
import { ProtoShop } from "./Tile";

export function ProtoGrid({
  items,
  pinned,
  onTogglePin,
  splitKind,
  byNpc,
}: {
  items: MerchantItem[];
  pinned: Set<string>;
  onTogglePin: (id: string) => void;
  splitKind?: boolean;
  byNpc?: boolean;
}) {
  return <ProtoShop items={items} pinned={pinned} onTogglePin={onTogglePin} splitKind={splitKind} byNpc={byNpc} />;
}
