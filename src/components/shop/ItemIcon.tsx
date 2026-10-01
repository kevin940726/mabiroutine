import { useState } from "react";
import { cn } from "@/lib/utils";
import { itemIconPath } from "@/lib/itemIcon";

/**
 * An item's art, with the yield's count on its bottom-right corner.
 *
 * The frame is `rounded-xl` rather than a circle: the art is a 128px square with
 * transparency drawn for a square (blades, blueprints and tablets all lose their
 * corners to a circle), and the tile already speaks `rounded-xl` for item-shaped
 * things. There is no border or fill on the frame — the art carries its own edges,
 * and a box around every icon read as a chip rather than as the item.
 *
 * THE FRAME IS A FIXED SIZE WHETHER OR NOT ART EXISTS. Nine names have no icon yet
 * and nine more appear only in barter give-lines, so a missing one is a normal
 * state, and a size that changed between an item with art and one without would
 * break the row alignment the whole grid depends on (`docs/npc-shop.md`: a
 * conditional row pulled two tiles up 23px and they read as different layouts). The
 * wrapper reserves the box either way and only the contents differ.
 *
 * `onError` is the existence check. There is no manifest on either side of this app
 * (`/npc/` works the same way), and the browser cannot know a file is absent without
 * requesting it, so a miss is discovered by the request failing and is then
 * remembered in state (NpcFace.tsx:11-25 established the pattern).
 */
export function ItemIcon({
  name,
  size = "size-12",
  className,
  badge,
}: {
  /** The item name as the DATA spells it — half-width parens, `+` kept, and NO
   *  quantity (` ×N`). See lib/itemIcon.ts: folding the parens loses 9 blueprints. */
  name: string | undefined | null;
  /** Frame size classes. */
  size?: string;
  className?: string;
  /** The yield's quantity, shown on the frame's bottom-right corner as the game
   *  does. 1 renders nothing: a ×1 mark is noise on most rows. */
  badge?: number;
}) {
  const [failed, setFailed] = useState(false);
  const src = itemIconPath(name);
  const showCount = badge != null && badge > 1;

  return (
    // `relative` and NOT `overflow-hidden`: the count sits ON the frame's corner,
    // and clipping it inside the frame would eat it.
    <span className={cn("relative inline-grid shrink-0", className)}>
      <span className={cn("grid place-items-center overflow-hidden rounded-xl", size)}>
        {src && !failed ? (
          <img
            src={src}
            alt=""
            aria-hidden
            loading="lazy"
            onError={() => setFailed(true)}
            className="h-full w-full object-contain"
          />
        ) : (
          // The placeholder carries its own plate, since the frame has no background:
          // a missing icon must still occupy a visible box so the tile keeps its
          // shape. Deliberately quiet — it marks "art is coming", not an error.
          <span className="grid h-full w-full place-items-center rounded-xl border border-dashed border-border bg-muted/40" aria-hidden>
            <span className="h-1/2 w-1/2 rounded-[3px] border border-muted-foreground/25" />
          </span>
        )}
      </span>
      {showCount && (
        <span
          aria-label={`數量 ${badge}`}
          // White with a dark halo, not the game's plain white: the halo is what keeps
          // the count legible over light art as well as dark, and the count overlays
          // whatever the icon happens to be.
          className="absolute bottom-0 right-0 text-[16px] font-bold leading-none tabular-nums text-white [text-shadow:0_0_4px_rgba(0,0,0,0.95),0_1px_3px_rgba(0,0,0,0.8)]"
        >
          {badge}
        </span>
      )}
    </span>
  );
}
