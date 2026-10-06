import { useState } from "react";
import { cn } from "@/lib/utils";
import { shopNpcIcon } from "@/lib/shops";

/**
 * An NPC's portrait, falling back to their initial when the image is missing.
 *
 * Lives here rather than in MerchantPanel so the shop grid can use it without
 * importing the panel — that import was half of a module cycle (panel → grid →
 * panel).
 *
 * `town` scopes the portrait to one same-name NPC: the NPC object's `icon`
 * override wins when present, else the /npc/<name>.png convention (shared
 * names share the file until an override says otherwise).
 */
export function NpcFace({ npc, town, size = "size-10" }: { npc: string; town?: string; size?: string }) {
  const [failed, setFailed] = useState(false);
  const src = (town && shopNpcIcon(npc, town)) || `/npc/${encodeURIComponent(npc)}.png`;
  if (failed) {
    return <span className={cn("grid shrink-0 place-items-center rounded-full border bg-muted text-sm font-semibold", size)}>{npc.slice(0, 1)}</span>;
  }
  return (
    <img
      src={src}
      alt=""
      aria-hidden
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn("shrink-0 rounded-full border bg-muted object-cover", size)}
    />
  );
}
