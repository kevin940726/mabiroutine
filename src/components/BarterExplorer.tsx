import { useMemo, useState } from "react";
import barterJson from "@/data/barter.json";
import { useAppStore } from "@/store/useAppStore";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MaterialBreakdown, giveHasBreakdown } from "@/components/MaterialBreakdown";
import { parseItemQty, twinTradeLeg, dealTimes } from "@/lib/materials";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ChevronDown, Pin } from "lucide-react";
import type { BarterPriority } from "@/lib/types";

const PRIORITY_LABEL: Record<BarterPriority, string> = {
  must: "必換",
  extra: "推薦",
  once: "一次性",
  situational: "看情況",
  skip: "別換",
};

export type BarterJsonRow = (typeof barterJson)[number];

/** Cap text from the shops.json twin leg (SSOT); falls back to the
 *  barter.json display string when no exact twin exists. A matched leg
 *  with no limit means uncapped — the barter string is not consulted. */
function capText(b: BarterJsonRow): string | undefined {
  const { name, qty } = parseItemQty(b.get);
  const twin = twinTradeLeg(b.npc, name, qty);
  return twin ? twin.limit : b.limit;
}

type BarterPinProps = {
  id: string;
  pinned?: boolean;
  onTogglePin?: (id: string) => void;
};

type BarterRowProps = {
  b: BarterJsonRow;
  pinned?: boolean;
  onTogglePin?: (barterId: string) => void;
  /** Makes the portrait a link to that NPC, e.g. the merchant panel. */
  onSelectNpc?: (npc: string) => void;
};

export function BarterPinButton({ id, pinned: pinnedProp, onTogglePin }: BarterPinProps) {
  const storePinned = useAppStore((s) => s.barterPins.includes(id));
  const storeToggle = useAppStore((s) => s.toggleBarterPin);
  const pinned = pinnedProp ?? storePinned;
  const toggle = onTogglePin ?? storeToggle;

  return (
    <div className="flex flex-col items-end gap-1 shrink-0">
      <Tooltip content={pinned ? "已釘選 — 點擊取消（所有角色共用）" : "點擊釘選（所有角色共用）"}>
        <Button
          size="sm"
          variant={pinned ? "default" : "outline"}
          className={cn(
            "shrink-0 select-none min-w-[105px]",
            pinned
              ? "bg-emerald-600 hover:bg-emerald-700 border-emerald-600 text-white"
              : "border-0 outline outline-1 outline-input"
          )}
          onClick={() => toggle(id)}
        >
          <span className="flex w-full items-center gap-1.5">
            <Pin className="shrink-0" />
            <span className="flex-1 text-center">{pinned ? "已釘選" : "釘選"}</span>
          </span>
        </Button>
      </Tooltip>
    </div>
  );
}

function MobilePinButton({ id, pinned: pinnedProp, onTogglePin }: BarterPinProps) {
  const storePinned = useAppStore((s) => s.barterPins.includes(id));
  const storeToggle = useAppStore((s) => s.toggleBarterPin);
  const pinned = pinnedProp ?? storePinned;
  const toggle = onTogglePin ?? storeToggle;
  return (
    <button
      aria-label={pinned ? "取消釘選" : "釘選"}
      onClick={() => toggle(id)}
      className={cn(
        "grid h-11 w-11 shrink-0 place-items-center rounded-full",
        pinned ? "bg-emerald-600 text-white" : "text-muted-foreground hover:bg-accent"
      )}
    >
      <Pin className="h-5 w-5" fill={pinned ? "currentColor" : "none"} />
    </button>
  );
}

// desktop row — evolves together with the mobile row; every change considers both
export function BarterRowDesktop({ b, pinned: pinnedProp, onTogglePin, onSelectNpc }: BarterRowProps) {
  const storePinned = useAppStore((s) => s.barterPins.includes(b.id));
  const pinned = pinnedProp ?? storePinned;
  const [open, setOpen] = useState(false);
  // No toggle when the breakdown would just echo the give (trivial self-only leaf).
  const hasBreakdown = useMemo(() => giveHasBreakdown(b.give), [b.give]);
  const cap = capText(b);
  // Whole-deal multiplier for the breakdown's 共需 line (twin leg's
  // limit.times, else the row limit string, else 1).
  const get = parseItemQty(b.get);
  const times = dealTimes(b.npc, get.name, get.qty, b.limit);
  const portrait = (
    <img
      src={`/npc/${encodeURIComponent(b.npc)}.png`}
      alt={b.npc}
      className="h-10 w-10 shrink-0 rounded-full object-cover border border-border/50 bg-muted"
      loading="lazy"
      onError={(e) => ((e.target as HTMLImageElement).src = "/npc/placeholder.png")}
    />
  );
  return (
    <div
      className={cn(
        "rounded-lg border bg-card px-3 py-2.5",
        // Off-screen rows skip layout/paint; intrinsic size holds scroll height.
        "[content-visibility:auto] [contain-intrinsic-size:auto_80px]",
        pinned && "border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20"
      )}
    >
      <div className="flex items-center gap-3">
      {onSelectNpc ? (
        <button
          type="button"
          onClick={() => onSelectNpc(b.npc)}
          aria-label={`開啟 ${b.npc} 的商店`}
          className="shrink-0 rounded-full transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {portrait}
        </button>
      ) : (
        portrait
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-primary truncate">{b.get.replace(/ ×\d+$/, "")}</span>
          <Badge variant={b.priority === "must" ? "default" : b.priority === "skip" ? "outline" : "secondary"} className={cn("text-[10px] shrink-0", b.priority === "must" && "bg-red-600 hover:bg-red-700")}>
            {PRIORITY_LABEL[b.priority as BarterPriority]}
          </Badge>
          {b.perChar === false && (
            <Badge variant="secondary" className="text-[10px] shrink-0 bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300 hover:bg-sky-100">
              伺服器
            </Badge>
          )}
          <span className="ml-auto flex items-center gap-1 text-xs shrink-0 min-w-0">
            <span className="font-medium truncate">{b.npc}</span>
            <span className="text-muted-foreground truncate">· {b.town}</span>
          </span>
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground min-w-0">
          <span className="truncate">
            你給{" "}
            <button
              onClick={() => setOpen(!open)}
              aria-expanded={open}
              aria-label={open ? "收起材料" : "展開材料"}
              className="inline-flex max-w-[65%] items-center gap-0.5 align-bottom text-foreground disabled:cursor-default"
              disabled={!hasBreakdown}
            >
              <span className="truncate font-medium">{b.give}</span>
              {hasBreakdown && (
                <ChevronDown className={cn("h-3 w-3 shrink-0 transition-transform", open && "rotate-180")} />
              )}
            </button>{" "}
            → 你拿 {b.get}
          </span>
          <span className="ml-auto shrink-0">{cap}</span>
        </div>
        {b.note && (
          <p className="text-xs leading-snug text-muted-foreground/80 mt-1 italic truncate border-l-2 border-muted pl-1.5">📝 {b.note}</p>
        )}
      </div>
      <BarterPinButton id={b.id} pinned={pinned} onTogglePin={onTogglePin} />
      </div>
      {open && hasBreakdown && <MaterialBreakdown give={b.give} times={times} />}
    </div>
  );
}

// mobile row (B4): tracker TaskRowMobile language — 20px pfp in the title
// line, priority chip on its own wrapping line, bold NPC · town · limit,
// bare give → get with zero truncation, 📝 note line, 44px icon pin.
export function BarterRowMobile({ b, pinned: pinnedProp, onTogglePin, onSelectNpc }: BarterRowProps) {
  const storePinned = useAppStore((s) => s.barterPins.includes(b.id));
  const pinned = pinnedProp ?? storePinned;
  const [imgError, setImgError] = useState(false);
  const [open, setOpen] = useState(false);
  // No toggle when the breakdown would just echo the give (trivial self-only leaf).
  const hasBreakdown = useMemo(() => giveHasBreakdown(b.give), [b.give]);
  const cap = capText(b);
  const get = parseItemQty(b.get);
  const times = dealTimes(b.npc, get.name, get.qty, b.limit);
  const portrait = imgError ? (
    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-border/50 bg-muted text-[10px]">
      {b.npc.slice(0, 1)}
    </span>
  ) : (
    <img
      src={`/npc/${encodeURIComponent(b.npc)}.png`}
      alt=""
      aria-hidden
      className="h-5 w-5 shrink-0 rounded-full object-cover border border-border/50 bg-muted"
      loading="lazy"
      onError={() => setImgError(true)}
    />
  );
  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-3",
        // Off-screen rows skip layout/paint; intrinsic size holds scroll height.
        "[content-visibility:auto] [contain-intrinsic-size:auto_150px]",
        pinned && "border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20"
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-sm font-bold text-primary">
            {onSelectNpc ? (
              <button
                type="button"
                onClick={() => onSelectNpc(b.npc)}
                aria-label={`開啟 ${b.npc} 的商店`}
                className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {portrait}
              </button>
            ) : (
              portrait
            )}
            <span className="min-w-0 flex-1 break-words">{b.get.replace(/ ×\d+$/, "")}</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] whitespace-nowrap shrink-0",
                b.priority === "must"
                  ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {PRIORITY_LABEL[b.priority as BarterPriority]}
            </span>
            {b.perChar === false && (
              <span className="rounded px-1.5 py-0.5 text-[10px] whitespace-nowrap shrink-0 bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300">
                伺服器
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-muted-foreground break-words">
            <span className="font-semibold text-foreground">{b.npc}</span> · {b.town}{cap ? ` · ${cap}` : ""}
          </div>
          <div className="text-xs break-words">
            <button
              onClick={() => setOpen(!open)}
              aria-expanded={open}
              aria-label={open ? "收起材料" : "展開材料"}
              className="inline-flex max-w-full items-center gap-0.5 text-left font-medium disabled:cursor-default"
              disabled={!hasBreakdown}
            >
              <span className="break-words">{b.give}</span>
              {hasBreakdown && (
                <ChevronDown className={cn("h-3 w-3 shrink-0 transition-transform", open && "rotate-180")} />
              )}
            </button>{" "}
            → {b.get}
          </div>
          {b.note && (
            <p className="text-xs leading-snug text-muted-foreground/80 mt-1.5 italic break-words border-l-2 border-muted pl-1.5">📝 {b.note}</p>
          )}
        </div>
        <div className="w-11 shrink-0 flex justify-end">
          <MobilePinButton id={b.id} pinned={pinned} onTogglePin={onTogglePin} />
        </div>
      </div>
      {open && hasBreakdown && <MaterialBreakdown give={b.give} times={times} />}
    </div>
  );
}
