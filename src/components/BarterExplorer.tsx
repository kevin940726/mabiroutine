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
const SKILLS = [...new Set((barterJson as unknown as typeof barterJson).map((b) => b.gatherSkill))];

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

export function BarterExplorer() {
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
              <Input placeholder="搜尋：輸入你有的或想要的（例如：皮革、星光）" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <Button variant={onlyPinned ? "default" : "outline"} size="sm" onClick={() => setOnlyPinned(!onlyPinned)}>
              {onlyPinned ? <Pin className="h-3 w-3" /> : <PinOff className="h-3 w-3" />}
              {onlyPinned ? `只看已釘選` : "全部"}
            </Button>
          </div>

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

          {/* quick filters for must */}
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

          {/* legend */}
          <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-600" /> 已釘選（綠）會出現在追蹤頁每日區</span>
          </div>

          {/* skill chart — bottom of filter section, constant height: all skills always render */}
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
        </CardContent>
      </Card>

      {/* list view — compact single-line cards */}
      <div className="space-y-2">
        {filtered.map((b) => {
          const pinned = barterPins.includes(b.id);
          return (
            <div
              key={b.id}
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
        })}
      </div>
      {filtered.length === 0 && <p className="text-center text-sm text-muted-foreground py-8">沒有符合的項目</p>}
    </div>
  );
}
