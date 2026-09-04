import { useDeferredValue, useMemo, useState } from "react";
import barterJson from "@/data/barter.json";
import { useAppStore } from "@/store/useAppStore";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/useIsMobile";
import { Pin, PinOff, Search, ChevronDown } from "lucide-react";
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
const SKILLS = [...new Set((barterJson as unknown as typeof barterJson).map((b) => b.gatherSkill))];

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
            <p className="text-xs text-amber-700 dark:text-amber-300 mt-1 italic break-words">📝 {b.note}</p>
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
  const { priority, town, skill, onlyPinned } = filters;
  const setPriority = (v: BarterPriority | "all") => setBarterFilters({ priority: v });
  const setTown = (v: string) => setBarterFilters({ town: v });
  const setSkill = (v: string) => setBarterFilters({ skill: v });
  const setOnlyPinned = (v: boolean) => setBarterFilters({ onlyPinned: v });

  const filtered = useMemo(() => {
    return (barterJson as unknown as typeof barterJson).filter((b) => {
      if (priority !== "all" && b.priority !== priority) return false;
      if (town !== "all" && b.town !== town) return false;
      if (skill !== "all" && b.gatherSkill !== skill) return false;
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
  }, [deferredQ, priority, town, skill, onlyPinned, barterPins]);

  // chart data for skills — counts the filtered rows so town/priority/search/pin filters are reflected
  const skillCountMap = useMemo(() => {
    const m = new Map<string, number>();
    filtered.forEach((b) => m.set(b.gatherSkill, (m.get(b.gatherSkill) ?? 0) + 1));
    return m;
  }, [filtered]);
  // stable full-data order: every skill always renders (0 = empty track), so the
  // chart block never changes height when filters change — no layout jump
  const allSkillOrder = useMemo(() => {
    const m = new Map<string, number>();
    (barterJson as unknown as typeof barterJson).forEach((b) => m.set(b.gatherSkill, (m.get(b.gatherSkill) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  }, []);
  const maxCount = Math.max(...[...skillCountMap.values()], 1);

  // filter controls below are rendered twice from these consts (pure RWD, no
  // JS split): once inside a mobile-only <details>, once in the desktop flow.
  const filterSelects = (
    <div className="flex flex-wrap gap-2">
      <Select value={priority} onValueChange={(v) => setPriority(v as BarterPriority | "all")}>
        <SelectTrigger className="w-auto">
          <SelectValue placeholder="全部優先度" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部優先度</SelectItem>
          {PRIORITY_ORDER.map((p) => <SelectItem key={p} value={p}>{PRIORITY_LABEL[p]}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={town} onValueChange={(v) => setTown(v)}>
        <SelectTrigger className="w-auto">
          <SelectValue placeholder="全部城鎮" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部城鎮</SelectItem>
          {TOWNS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={skill} onValueChange={(v) => setSkill(v)}>
        <SelectTrigger className="w-auto">
          <SelectValue placeholder="全部採集技能" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部採集技能</SelectItem>
          {SKILLS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
        </SelectContent>
      </Select>
      <span className="text-xs text-muted-foreground self-center">
        顯示 {filtered.length} / {barterJson.length} 筆 · 已釘選 {barterPins.length}
      </span>
    </div>
  );

  const filterPills = (
    <div className="flex flex-wrap gap-1.5">
      {PRIORITY_ORDER.map((p) => (
        <button
          key={p}
          onClick={() => setPriority(priority === p ? "all" : p)}
          className={cn("rounded-full border px-3 py-1 text-xs", priority === p ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-accent")}
        >
          {PRIORITY_LABEL[p]}
        </button>
      ))}
    </div>
  );

  const filterLegend = (
    <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
      <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-600" /> 已釘選（綠）會出現在追蹤頁每日區</span>
    </div>
  );

  const skillChart = (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">各採集技能的換物需求（次）</p>
      <div className="grid gap-1">
        {allSkillOrder.map((name) => {
          const n = skillCountMap.get(name) ?? 0;
          return (
            <div key={name} className="flex items-center gap-2 text-xs">
              <span className="w-20 shrink-0 text-right">{name}</span>
              <div className="flex-1 h-3 rounded bg-muted overflow-hidden">
                <div className="h-full bg-primary transition-all" style={{ width: `${(n / maxCount) * 100}%` }} />
              </div>
              <span className="w-8 font-mono">{n}</span>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            🔄 以物易物 · 代幣 <Badge variant="secondary">{barterJson.length} 筆</Badge>
            <span className="text-xs font-normal text-muted-foreground">
              已釘選 {barterPins.length} 項 · 點擊切換，所有角色共用
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

          {/* mobile-only collapse (pure RWD: the whole <details> hides on sm+) */}
          <details className="sm:hidden group">
            <summary className="flex w-full cursor-pointer list-none items-center justify-between py-1 text-xs text-muted-foreground [&::-webkit-details-marker]:hidden">
              <span>展開篩選</span>
              <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
            </summary>
            <div className="space-y-4 pt-3">
              {filterSelects}
              {filterPills}
            </div>
          </details>

          {/* desktop filters — same boxes as before, hidden below sm */}
          <div className="hidden sm:block">
            <div className="space-y-4">
              {filterSelects}
              {filterPills}
            </div>
          </div>

          {/* legend — always visible, inside and outside the collapse */}
          {filterLegend}

          {/* skill chart — desktop only (pure RWD) */}
          <div className="hidden sm:block">
            {skillChart}
          </div>
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
