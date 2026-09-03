import { useMemo, useState } from "react";
import barterJson from "@/data/barter.json";
import { useAppStore } from "@/store/useAppStore";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Tooltip } from "@/components/ui/tooltip";
import { useLongPress } from "@/hooks/useLongPress";
import { cn } from "@/lib/utils";
import { Pin, PinOff, Search, Users, User } from "lucide-react";
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
  const activeChar = useAppStore((s) => s.getActiveChar());
  const getScope = useAppStore((s) => s.getPinScope);
  const toggleAll = useAppStore((s) => s.toggleBarterPin);
  const toggleForChar = useAppStore((s) => s.toggleBarterPinForChar);
  const scope = getScope(barterId); // shared / personal / none for active char
  const shared = scope === "shared";
  const personal = scope === "personal";
  const pinned = shared || personal;

  // long-press = per-char (hold), tap/click = per-acc (tap)
  const long = useLongPress(
    () => toggleForChar(barterId),
    () => toggleAll(barterId)
  );

  // right-click = per-char as well
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    toggleForChar(barterId);
  };

  return (
    <div className="flex flex-col items-end gap-1 shrink-0">
      <Tooltip
        content={
          pinned
            ? personal
              ? `僅 ${activeChar?.name} 已釘選（藍色）— 長按/右鍵切換個人，點擊切換所有角色`
              : `共用釘選（綠色）— 所有角色共享，長按/右鍵僅改此角色`
            : `點擊：釘選至所有角色（共用・綠） / 長按或右鍵：僅 ${activeChar?.name}（個人・藍）`
        }
      >
        <Button
          size="sm"
          variant={pinned ? "default" : "outline"}
          className={cn(
            "shrink-0 select-none touch-manipulation",
            shared && "bg-emerald-600 hover:bg-emerald-700 border-emerald-600 text-white",
            personal && "bg-sky-600 hover:bg-sky-700 border-sky-600 text-white",
            !pinned && ""
          )}
          onContextMenu={onContextMenu}
          {...long}
          style={{ touchAction: "none" } as React.CSSProperties}
        >
          {pinned ? (
            <>
              {personal ? <User className="h-3 w-3" /> : <Users className="h-3 w-3" />}
              {personal ? "僅此角色" : "共用中"}
            </>
          ) : (
            <>
              <Pin className="h-3 w-3" /> 釘選
            </>
          )}
        </Button>
      </Tooltip>
      <span className="text-[10px] text-muted-foreground hidden sm:block">點擊共用 · 長按/右鍵個人</span>
    </div>
  );
}

export function BarterExplorer() {
  const activeChar = useAppStore((s) => s.getActiveChar());
  const chars = useAppStore((s) => s.characters);
  const isForked = useAppStore((s) => s.isForked());
  const getEffective = useAppStore((s) => s.getEffectivePinsForActive);
  const effective = getEffective();
  const barterPins = useAppStore((s) => s.barterPins);
  const barterByChar = useAppStore((s) => s.barterPinsByChar);
  const isForkedGetter = useAppStore((s) => s.isForked);
  const merge = useAppStore((s) => s.mergePinsToShared);

  const [q, setQ] = useState("");
  const [priority, setPriority] = useState<BarterPriority | "all">("all");
  const [town, setTown] = useState("all");
  const [skill, setSkill] = useState("all");
  const [onlyPinned, setOnlyPinned] = useState(false);

  const filtered = useMemo(() => {
    return (barterJson as unknown as typeof barterJson).filter((b) => {
      if (priority !== "all" && b.priority !== priority) return false;
      if (town !== "all" && b.town !== town) return false;
      if (skill !== "all" && b.gatherSkill !== skill) return false;
      if (onlyPinned) {
        const has = effective.includes(b.id);
        if (!has) return false;
      }
      if (q) {
        const hay = `${b.name} ${b.give} ${b.get} ${b.town} ${b.gatherSkill}`.toLowerCase();
        if (!hay.includes(q.toLowerCase())) return false;
      }
      return true;
    }).sort((a, b) => {
      const pa = PRIORITY_ORDER.indexOf(a.priority as BarterPriority);
      const pb = PRIORITY_ORDER.indexOf(b.priority as BarterPriority);
      if (pa !== pb) return pa - pb;
      return a.town.localeCompare(b.town);
    });
  }, [q, priority, town, skill, onlyPinned, effective]);

  // chart data for skills
  const skillCounts = useMemo(() => {
    const m = new Map<string, number>();
    (barterJson as unknown as typeof barterJson).forEach((b) => m.set(b.gatherSkill, (m.get(b.gatherSkill) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, []);
  const maxCount = Math.max(...skillCounts.map(([, n]) => n), 1);

  // count per mode for tooltip
  const sharedCount = isForked ? 0 : barterPins.length;
  const personalCount = isForked ? (barterByChar?.[activeChar?.id ?? ""]?.length ?? 0) : 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            🔄 以物易物 · 代幣 <Badge variant="secondary">{barterJson.length} 筆</Badge>
            {isForked ? (
              <Badge className="bg-sky-600 hover:bg-sky-700 text-white">個人模式 · {activeChar?.name}</Badge>
            ) : (
              <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white">共用模式</Badge>
            )}
            <span className="text-xs font-normal text-muted-foreground">
              {isForked ? `個人 ${personalCount} 項` : `共用 ${sharedCount} 項`} · 點擊共用 / 長按或右鍵個人
            </span>
          </CardTitle>
          <CardDescription>
            {isForked
              ? `已切換為個人模式：每個角色獨立（最多6隻）。點擊會改所有角色，長按/右鍵只改 ${activeChar?.name}。`
              : `共用模式：點擊釘選會套用到所有角色。長按或右鍵可僅改 ${activeChar?.name}，會自動切換為個人模式。`}
            {isForked && (
              <button onClick={merge} className="ml-2 underline decoration-dotted text-xs">
                合併回共用
              </button>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* skill chart */}
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">各採集技能的換物需求（次）</p>
            <div className="grid gap-1">
              {skillCounts.map(([name, n]) => (
                <div key={name} className="flex items-center gap-2 text-xs">
                  <span className="w-20 shrink-0 text-right">{name}</span>
                  <div className="flex-1 h-3 rounded bg-muted overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: `${(n / maxCount) * 100}%` }} />
                  </div>
                  <span className="w-8 font-mono">{n}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="搜尋：輸入你有的或想要的（例如：皮革、星光）" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <Button variant={onlyPinned ? "default" : "outline"} size="sm" onClick={() => setOnlyPinned((v) => !v)}>
              {onlyPinned ? <Pin className="h-3 w-3" /> : <PinOff className="h-3 w-3" />}
              {onlyPinned ? `只看 ${activeChar?.name} 已釘選` : "全部"}
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
              顯示 {filtered.length} / {barterJson.length} 筆 · {activeChar?.name} 有效 {effective.length}
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
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-600" /> 共用（綠）點擊切換所有角色</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-sky-600" /> 個人（藍）長按/右鍵僅此角色，桌面右鍵相同</span>
          </div>
        </CardContent>
      </Card>

      {/* list view — compact single-line cards */}
      <div className="space-y-2">
        {filtered.map((b) => {
          const scope = isForkedGetter() && barterByChar
            ? (barterByChar[activeChar?.id ?? ""] ?? []).includes(b.id) ? "personal" as const : "none" as const
            : barterPins.includes(b.id) ? "shared" as const : "none" as const;
          const otherChars = isForked
            ? chars.filter((c) => c.id !== activeChar?.id && (barterByChar?.[c.id] ?? []).includes(b.id)).map((c) => c.name)
            : [];
          return (
            <div
              key={b.id}
              className={cn(
                "flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5 transition-colors",
                scope === "shared" && "border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20",
                scope === "personal" && "border-sky-200 dark:border-sky-900 bg-sky-50/50 dark:bg-sky-950/20"
              )}
              onContextMenu={(e) => {
                e.preventDefault();
                useAppStore.getState().toggleBarterPinForChar(b.id);
              }}
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
                    {otherChars.length > 0 && isForked && <span className="ml-1 text-sky-700 dark:text-sky-300">· 其他：{otherChars.join("、")}</span>}
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
