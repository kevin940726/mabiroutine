// PROTOTYPE shared bits: one deal row + NPC portrait. See data.ts header.
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { costText, getText, CURATED_LABEL, type ShopDeal } from "./data";

export function NpcFace({ npc, size = "h-10 w-10" }: { npc: string; size?: string }) {
  const [err, setErr] = useState(false);
  if (err) {
    return (
      <span className={cn("grid shrink-0 place-items-center rounded-full border border-border/50 bg-muted", size)}>
        {npc.slice(0, 1)}
      </span>
    );
  }
  return (
    <img
      src={`/npc/${encodeURIComponent(npc)}.png`}
      alt=""
      aria-hidden
      loading="lazy"
      onError={() => setErr(true)}
      className={cn("shrink-0 rounded-full border border-border/50 bg-muted object-cover", size)}
    />
  );
}

export type KindFilter = "all" | "barter" | "shop";

export const KIND_TABS: { value: KindFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "barter", label: "以物易物" },
  { value: "shop", label: "商店直購" },
];

/** Compact deal line: 你給 X → 你拿 Y · cap · 精選-marker · pin toggle. */
export function DealLine({
  deal,
  pinned,
  onTogglePin,
}: {
  deal: ShopDeal;
  pinned: boolean;
  onTogglePin: (key: string) => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg border bg-card px-2.5 py-1.5 text-xs",
        pinned && "border-emerald-300 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/20"
      )}
    >
      <span className="min-w-0 flex-1 truncate">
        <span className="text-muted-foreground">你給 </span>
        <span className="font-medium text-foreground">{costText(deal)}</span>
        <span className="text-muted-foreground"> → 你拿 </span>
        <span className="font-bold text-primary">{getText(deal)}</span>
      </span>
      {deal.priority && (
        <Badge
          variant="secondary"
          title="已收錄於精選（barter.json）"
          className={cn(
            "shrink-0 text-[10px]",
            deal.priority === "must" && "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
          )}
        >
          {CURATED_LABEL[deal.priority]}
        </Badge>
      )}
      {deal.limitText && <span className="shrink-0 text-muted-foreground">{deal.limitText}</span>}
      <button
        aria-label={pinned ? "取消選擇" : "選擇"}
        aria-pressed={pinned}
        onClick={() => onTogglePin(deal.key)}
        className={cn(
          "grid h-7 w-7 shrink-0 place-items-center rounded-full text-base leading-none",
          pinned ? "bg-emerald-600 text-white" : "text-muted-foreground hover:bg-accent"
        )}
      >
        {pinned ? "✓" : "+"}
      </button>
    </div>
  );
}
