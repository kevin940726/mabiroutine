import { useCallback, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TaskRow } from "@/components/TaskRow";
import { Tooltip } from "@/components/ui/tooltip";
import type { Task } from "@/lib/types";
import { summarizeProgress } from "@/lib/progress";
import { useAppStore, barterToTask } from "@/store/useAppStore";
import barterJson from "@/data/barter.json";
import { DndContext, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ChevronDown, ChevronUp, RotateCcw } from "lucide-react";

type Props = {
  title: string;
  icon: string;
  tasks: Task[];
  isAccount: boolean;
  onEditTask?: (t: Task) => void;
};

export function TrackerSection({ title, icon, tasks, isAccount, onEditTask }: Props) {
  const char = useAppStore((s) => s.getActiveChar());
  const accountValues = useAppStore((s) => s.accountValues);
  const barterPins = useAppStore((s) => s.barterPins);
  const clearSection = useAppStore((s) => s.clearSection);
  const reorder = useAppStore((s) => s.reorderTasks);
  const reorderBarter = useAppStore((s) => s.reorderBarterPins);
  const globalOrder = useAppStore((s) => s.globalTaskOrder);
  const hideCompleted = useAppStore((s) => s.prefs.hideCompleted);
  // global account-hide list subscribed so the memos below recompute on toggle
  const hiddenAccountTaskIds = useAppStore((s) => s.hiddenAccountTaskIds);
  // account-section tasks hide globally, everything else per character
  const isHiddenFor = useCallback(
    (t: Task) =>
      t.section === "account" ? hiddenAccountTaskIds.includes(t.id) : (char?.hiddenTaskIds.includes(t.id) ?? false),
    [char, hiddenAccountTaskIds]
  );
  const [collapsed, setCollapsed] = useState(false);
  const [barterExpanded, setBarterExpanded] = useState(true);
  const [hiddenExpanded, setHiddenExpanded] = useState(false);

  // daily barter subtasks: global pins, rendered as collapsable sub-category (not flat)
  const barterSubtasks = useMemo(() => {
    if (tasks[0]?.section !== "daily") return [] as Task[];
    return barterPins
      .map((id) => {
        const b = (barterJson as unknown as Array<(typeof barterJson)[number]>).find((x) => x.id === id);
        return b ? barterToTask(b) : null;
      })
      .filter(Boolean) as Task[];
  }, [tasks, barterPins]);

  // barter base: manual-hide only. hideCompleted is render-only (below) —
  // progress must not move when the toggle flips.
  const barterBase = useMemo(() => {
    if (!char) return barterSubtasks;
    return barterSubtasks.filter((t) => !char.hiddenTaskIds.includes(t.id));
  }, [barterSubtasks, char]);

  const barterSubtasksFiltered = useMemo(() => {
    if (!char) return barterBase;
    let list = barterBase;
    if (hideCompleted) {
      list = list.filter((t) => {
        const v = char.taskValues[t.id];
        if (t.type === "check") return !v;
        const n = typeof v === "number" ? v : 0;
        return n < (t.max ?? 0);
      });
    }
    return list;
  }, [barterBase, char, hideCompleted]);

  // hidden: dimmed + moved to bottom sub-category (same primitive as 以物易物)
  const hiddenBarter = useMemo(() => {
    if (!char) return [] as Task[];
    return barterSubtasks.filter((t) => char.hiddenTaskIds.includes(t.id));
  }, [barterSubtasks, char]);

  const hiddenTasks = useMemo(() => {
    if (!char) return [] as Task[];
    let list = tasks.filter((t) => isHiddenFor(t));
    list.sort((a, b) => {
      const oa = globalOrder?.[a.id] ?? a.order;
      const ob = globalOrder?.[b.id] ?? b.order;
      return oa - ob;
    });
    return list;
  }, [tasks, char, globalOrder, isHiddenFor]);

  const hiddenAll = useMemo(() => [...hiddenTasks, ...hiddenBarter], [hiddenTasks, hiddenBarter]);

  // main tasks, manual-hide filtered only — the progress denominator.
  // hideCompleted applies on top (render-only) in allTasks below.
  const baseTasks = useMemo(() => {
    let list = [...tasks];
    // apply global order
    list.sort((a, b) => {
      const oa = globalOrder?.[a.id] ?? a.order;
      const ob = globalOrder?.[b.id] ?? b.order;
      return oa - ob;
    });
    // filter hidden: per character, except account-section tasks hide globally
    if (char) {
      list = list.filter((t) => !isHiddenFor(t));
    }
    return list;
  }, [tasks, globalOrder, char, isHiddenFor]);

  // render list: baseTasks + the hideCompleted visual filter (no progress impact)
  const allTasks = useMemo(() => {
    let list = baseTasks;
    if (hideCompleted) {
      list = list.filter((t) => {
        const v = isAccount ? accountValues[t.id] : char?.taskValues[t.id];
        if (t.type === "check") return !v;
        const n = typeof v === "number" ? v : 0;
        return n < (t.max ?? 0);
      });
    }
    return list;
  }, [baseTasks, char, accountValues, isAccount, hideCompleted]);

  const { done, total, percent } = useMemo(() => {
    // progress over the unfiltered-by-completion lists: flipping 隱藏已完成
    // only hides rows, never moves done/total. (Manual hides still exclude,
    // per the hidden-subcategory rule.) Shared ruler with the header overall.
    const combined = [...baseTasks, ...barterBase];
    return summarizeProgress(combined, (t) => (isAccount ? accountValues[t.id] : char?.taskValues[t.id]));
  }, [baseTasks, barterBase, char, accountValues, isAccount]);

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = allTasks.findIndex((t) => t.id === active.id);
    const newIndex = allTasks.findIndex((t) => t.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const newOrder = [...allTasks];
    const [moved] = newOrder.splice(oldIndex, 1);
    newOrder.splice(newIndex, 0, moved);
    reorder(newOrder.map((t) => t.id));
  };

  const handleBarterDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = barterSubtasksFiltered.findIndex((t) => t.id === active.id);
    const newIndex = barterSubtasksFiltered.findIndex((t) => t.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const newOrder = [...barterSubtasksFiltered];
    const [moved] = newOrder.splice(oldIndex, 1);
    newOrder.splice(newIndex, 0, moved);
    reorderBarter(newOrder.map((t) => t.id));
  };

  // section key for clear
  const sectionKey = tasks[0]?.section ?? "daily";
  const kind = tasks[0]?.kind;

  return (
    <Card className="overflow-hidden -mx-4 rounded-none border-x-0 sm:mx-0 sm:rounded-xl sm:border">
      <CardHeader className="pb-2 px-3 sm:px-6">
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="flex w-full items-center justify-between gap-2 text-left rounded-md -mx-1 px-1 py-1 hover:bg-accent/50 transition-colors"
        >
          <CardTitle className="flex items-center gap-2 text-base m-0">
            {collapsed ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronUp className="h-4 w-4 text-muted-foreground" />}
            <span className="text-lg">{icon}</span>
            {title}
            <Badge variant="secondary" className="ml-1 font-mono text-xs">
              {done}/{total} · {percent}%
            </Badge>
          </CardTitle>
          <span className="text-xs text-muted-foreground hidden sm:inline">{collapsed ? "展開" : "收合"}</span>
        </button>
        <div className="flex items-center gap-2 mt-2">
          <div className="h-2 flex-1 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} />
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              clearSection(sectionKey, kind);
            }}
          >
            <RotateCcw className="h-3 w-3" />
            清除本區
          </Button>
        </div>
      </CardHeader>
      {collapsed ? (
        <CardContent className="py-3">
          <p className="text-xs text-muted-foreground text-center">已收合 — 點擊上方展開</p>
        </CardContent>
      ) : (
        <CardContent className="space-y-2 px-3 sm:px-6">
        <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={allTasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
            {allTasks.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                value={isAccount ? accountValues[t.id] : char?.taskValues[t.id]}
                isAccount={isAccount}
                onEdit={t.source === "custom" ? () => onEditTask?.(t) : undefined}
              />
            ))}
          </SortableContext>
        </DndContext>

        {/* 以物易物 subtasks as collapsable sub-category under 每日 (only daily section) */}
        {tasks[0]?.section === "daily" && barterPins.length > 0 && (
          // bleed band: wrapper stretches past the rows (-mx-2) so rows stay
          // pixel-equal to top-level items; header is w-full in the same box
          <div className="-mx-2 rounded-xl px-2 py-2 bg-emerald-500/10 dark:bg-emerald-400/[0.12]">
            <button
              onClick={() => setBarterExpanded((v) => !v)}
              className="flex w-full items-center gap-2 px-[5px] py-2.5 text-left rounded-md hover:bg-accent/50 transition-colors"
            >
              <span className="h-4 w-1 rounded-full shrink-0 bg-emerald-500" />
              <span className="text-base">🔄</span>
              <span className="text-sm font-medium">以物易物 已釘選</span>
              <Tooltip content="釘選對所有角色生效">
                <Badge className="text-[10px] text-white bg-emerald-600">
                  {barterSubtasksFiltered.length}/{barterPins.length}
                </Badge>
              </Tooltip>
              <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                {barterExpanded ? "收合" : "展開"} {barterExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </span>
            </button>
            {barterExpanded && (
              <div className="space-y-2">
                {barterSubtasksFiltered.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-3">已全部完成或已隱藏</p>
                ) : (
                  <DndContext collisionDetection={closestCenter} onDragEnd={handleBarterDragEnd}>
                    <SortableContext items={barterSubtasksFiltered.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                      {barterSubtasksFiltered.map((bt) => (
                        <TaskRow key={bt.id} task={bt} value={char?.taskValues[bt.id]} isAccount={false} />
                      ))}
                    </SortableContext>
                  </DndContext>
                )}
                {barterSubtasks.length !== barterSubtasksFiltered.length && (
                  <p className="text-[11px] text-muted-foreground text-center">
                    已隱藏 {barterSubtasks.length - barterSubtasksFiltered.length} 項（完成或手動隱藏）
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* 已隱藏項目 — same primitive, dimmed + bottom, undo via Eye */}
        {hiddenAll.length > 0 && (
          <div className="-mx-2 rounded-xl px-2 py-2 bg-zinc-500/10 dark:bg-zinc-400/10">
            <button
              onClick={() => setHiddenExpanded((v) => !v)}
              className="flex w-full items-center gap-2 px-[5px] py-2.5 text-left rounded-md hover:bg-accent/50 transition-colors"
            >
              <span className="h-4 w-1 rounded-full shrink-0 bg-muted-foreground/50" />
              <span className="text-base">🙈</span>
              <span className="text-sm font-medium">已隱藏項目</span>
              <Badge variant="secondary" className="text-[10px]">
                {hiddenAll.length}
              </Badge>
              <span className="text-[11px] text-muted-foreground hidden sm:inline">點擊 👁️ 可復原，會移回上方</span>
              <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                {hiddenExpanded ? "收合" : "展開"} {hiddenExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </span>
            </button>
            {hiddenExpanded && (
              <div className="space-y-2">
                {hiddenTasks.map((t) => (
                  <div key={t.id} className="opacity-60">
                    <TaskRow task={t} value={isAccount ? accountValues[t.id] : char?.taskValues[t.id]} isAccount={isAccount} onEdit={t.source === "custom" ? () => onEditTask?.(t) : undefined} />
                  </div>
                ))}
                {hiddenBarter.map((bt) => (
                  <div key={bt.id} className="opacity-60">
                    <TaskRow task={bt} value={char?.taskValues[bt.id]} isAccount={false} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {allTasks.length === 0 && barterSubtasksFiltered.length === 0 && hiddenAll.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-6">沒有任務（已隱藏或已完成）</p>
        )}
        </CardContent>
      )}
    </Card>
  );
}
