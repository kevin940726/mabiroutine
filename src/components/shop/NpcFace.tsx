import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * An NPC's portrait, falling back to their initial when the image is missing.
 *
 * Lives here rather than in MerchantPanel so the shop grid can use it without
 * importing the panel — that import was half of a module cycle (panel → grid →
 * panel).
 */
export function NpcFace({ npc, size = "size-10" }: { npc: string; size?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <span className={cn("grid shrink-0 place-items-center rounded-full border bg-muted text-sm font-semibold", size)}>{npc.slice(0, 1)}</span>;
  }
  return (
    <img
      src={`/npc/${encodeURIComponent(npc)}.png`}
      alt=""
      aria-hidden
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn("shrink-0 rounded-full border bg-muted object-cover", size)}
    />
  );
}
