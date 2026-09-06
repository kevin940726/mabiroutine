import { useDeferredValue, useMemo, useState } from "react";
import barterJson from "@/data/barter.json";
import { useAppStore } from "@/store/useAppStore";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MenuSelect } from "@/components/MenuSelect";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/useIsMobile";
import { Pin, PinOff, Search } from "lucide-react";
import type { BarterPriority } from "@/lib/types";

const PRIORITY_LABEL: Record<BarterPriority, string> = {
  must: "一定要換",
  extra: "有多就換",
  once: "一次性",
  situational: "看情況",
  skip: "別換",
};
const PRIORITY_ORDER: BarterPriority[] = ["must", "extra", "once", "situational", "skip"];
const TOWNS = [...new Set((barterJson as unknown as typeof barterJson).map((b) => b.town))];

type BarterRow = (typeof barterJson)[number];

function PinButton({ barterId }: { barterId: string }) {
  const toggle = useAppStore((s) => s.toggleBarterPin);
  const pinned = useAppStore((s) => s.barterPins.includes(barterId));

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
          onClick={() => toggle(barterId)}
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

function MobilePinButton({ barterId }: { barterId: string }) {
  const toggle = useAppStore((s) => s.toggleBarterPin);
  const pinned = useAppStore((s) => s.barterPins.includes(barterId));
  return (
    <button
      aria-label={pinned ? "取消釘選" : "釘選"}
      onClick={() => toggle(barterId)}
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
function BarterRowDesktop({ b }: { b: BarterRow }) {
  const pinned = useAppStore((s) => s.barterPins.includes(b.id));
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5 transition-colors",
        // Off-screen rows skip layout/paint; intrinsic size holds scroll height.
        "[content-visibility:auto] [contain-intrinsic-size:auto_80px]",
        pinned && "border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20"
      )}
    >
      <img
        src={`/npc/${encodeURIComponent(b.npc)}.png`}
        alt={b.npc}
        className="h-10 w-10 shrink-0 rounded-full object-cover border border-border/50 bg-muted"
        loading="lazy"
        onError={(e) => ((e.target as HTMLImageElement).src = "/npc/placeholder.png")}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-primary truncate">{b.get.replace(/ ×\d+$/, "")}</span>
          <Badge variant={b.priority === "must" ? "default" : b.priority === "skip" ? "outline" : "secondary"} className={cn("text-[10px] shrink-0", b.priority === "must" && "bg-red-600 hover:bg-red-700")}>
            {PRIORITY_LABEL[b.priority as BarterPriority]}
          </Badge>
          <span className="ml-auto flex items-center gap-1 text-xs shrink-0 min-w-0">
            <span className="font-medium truncate">{b.npc}</span>
            <span className="text-muted-foreground truncate">· {b.town}</span>
          </span>
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground min-w-0">
          <span className="truncate">
            你給 {b.give} → 你拿 {b.get}
          </span>
          <span className="ml-auto shrink-0">{b.limit}</span>
        </div>
        {b.note && (
          <p className="text-xs leading-snug text-muted-foreground/80 mt-1 italic truncate border-l-2 border-muted pl-1.5">📝 {b.note}</p>
        )}
      </div>
      <PinButton barterId={b.id} />
    </div>
  );
}

// mobile row (B4): tracker TaskRowMobile language — 20px pfp in the title
// line, priority chip on its own wrapping line, bold NPC · town · limit,
// bare give → get with zero truncation, 📝 note line, 44px icon pin.
function BarterRowMobile({ b }: { b: BarterRow }) {
  const pinned = useAppStore((s) => s.barterPins.includes(b.id));
  const [imgError, setImgError] = useState(false);
  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-3 transition-colors",
        // Off-screen rows skip layout/paint; intrinsic size holds scroll height.
        "[content-visibility:auto] [contain-intrinsic-size:auto_150px]",
        pinned && "border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20"
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-sm font-bold text-primary">
            {imgError ? (
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
          </div>
          <div className="mt-1 text-xs text-muted-foreground break-words">
            <span className="font-semibold text-foreground">{b.npc}</span> · {b.town} · {b.limit}
          </div>
          <div className="text-xs break-words">
            {b.give} → {b.get}
          </div>
          {b.note && (
            <p className="text-xs leading-snug text-muted-foreground/80 mt-1.5 italic break-words border-l-2 border-muted pl-1.5">📝 {b.note}</p>
          )}
        </div>
        <div className="w-11 shrink-0 flex justify-end">
          <MobilePinButton barterId={b.id} />
        </div>
      </div>
    </div>
  );
}

export function BarterExplorer() {
  const isMobile = useIsMobile();
  const barterPins = useAppStore((s) => s.barterPins);
  // explorer select filters persist in localStorage via the store; search text stays session-only
  const filters = useAppStore((s) => s.barterFilters);
  const setBarterFilters = useAppStore((s) => s.setBarterFilters);
  const [q, setQ] = useState("");
  // React 19: keep keystrokes urgent, defer the 98-row filter + card re-render
  const deferredQ = useDeferredValue(q);
  const { priority, town, onlyPinned } = filters;
  const setPriority = (v: BarterPriority | "all") => setBarterFilters({ priority: v });
  const setTown = (v: string) => setBarterFilters({ town: v });
  const setOnlyPinned = (v: boolean) => setBarterFilters({ onlyPinned: v });

  const filtered = useMemo(() => {
    return (barterJson as unknown as typeof barterJson).filter((b) => {
      if (priority !== "all" && b.priority !== priority) return false;
      if (town !== "all" && b.town !== town) return false;
      if (onlyPinned) {
        if (!barterPins.includes(b.id)) return false;
      }
      if (deferredQ) {
        const hay = `${b.name} ${b.give} ${b.get} ${b.town} ${b.gatherSkill}`.toLowerCase();
        if (!hay.includes(deferredQ.toLowerCase())) return false;
      }
      return true;
    }).sort((a, b) => {
      const pa = PRIORITY_ORDER.indexOf(a.priority as BarterPriority);
      const pb = PRIORITY_ORDER.indexOf(b.priority as BarterPriority);
      if (pa !== pb) return pa - pb;
      return a.town.localeCompare(b.town);
    });
  }, [deferredQ, priority, town, onlyPinned, barterPins]);

  // filter controls are one shared const rendered inline on all screens
  const filterSelects = (
    <div className="flex flex-wrap gap-2">
      <MenuSelect
        value={priority}
        options={[{ value: "all", label: "全部優先度" }, ...PRIORITY_ORDER.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))]}
        onChange={(v) => setPriority(v as BarterPriority | "all")}
      />
      <MenuSelect
        value={town}
        options={[{ value: "all", label: "全部城鎮" }, ...TOWNS.map((t) => ({ value: t, label: t }))]}
        onChange={(v) => setTown(v)}
      />
      <span className="text-xs text-muted-foreground self-center">
        顯示 {filtered.length} / {barterJson.length} 筆 · 已釘選 {barterPins.length}
      </span>
    </div>
  );

  const filterLegend = (
    <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
      <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-600" /> 已釘選（綠）會出現在追蹤頁每日區</span>
    </div>
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            🔄 以物易物 <Badge variant="secondary">{barterJson.length} 筆</Badge>
            <span className="text-xs font-normal text-muted-foreground">
              已釘選 {barterPins.length} 項，所有角色共用
            </span>
          </CardTitle>
          <CardDescription>
            點擊釘選會套用到所有角色。追蹤頁每日區會列出已釘選項目。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="搜尋" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <Button variant={onlyPinned ? "default" : "outline"} size="sm" className="h-9" onClick={() => setOnlyPinned(!onlyPinned)}>
              {onlyPinned ? <Pin className="h-3 w-3" /> : <PinOff className="h-3 w-3" />}
              {onlyPinned ? `只看已釘選` : "全部"}
            </Button>
          </div>

          {/* filters — always visible on both mobile and desktop (two
              selects only; the old mobile collapse died with the pill row) */}
          {filterSelects}

          {/* legend — always visible, inside and outside the collapse */}
          {filterLegend}
        </CardContent>
      </Card>

      {/* list view — desktop: compact single-line cards; mobile: two-line B4 row */}
      <div className="space-y-2">
        {filtered.map((b) => (
          isMobile
            ? <BarterRowMobile key={b.id} b={b} />
            : <BarterRowDesktop key={b.id} b={b} />
        ))}
      </div>
      {filtered.length === 0 && <p className="text-center text-sm text-muted-foreground py-8">沒有符合的項目</p>}
    </div>
  );
}
