import { useRef, useState } from "react";
import { useAppStore } from "@/store/useAppStore";
import type { Task } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EyeOff, Eye, GripVertical, Trash2, Pencil } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type Props = {
  task: Task;
  value: boolean | number | undefined;
  isAccount: boolean;
  onEdit?: () => void;
};

export function TaskRow({ task, value, isAccount, onEdit }: Props) {
  const toggleCheck = useAppStore((s) => s.toggleCheck);
  const toggleHidden = useAppStore((s) => s.toggleHidden);
  const removeCustom = useAppStore((s) => s.removeCustomTask);
  const char = useAppStore((s) => s.getActiveChar());
  const isHidden = char?.hiddenTaskIds.includes(task.id) ?? false;
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: task.id });
  const style: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition };

  const isCheck = task.type === "check";
  const checked = isCheck ? Boolean(value) : false;
  const count = !isCheck ? (typeof value === "number" ? value : 0) : 0;
  const isDone = isCheck ? checked : count >= (task.max ?? 0) && (task.max ?? 0) > 0;

  const isCustom = task.source === "custom";
  const isBarter = task.source === "barter";
  const [npcImgError, setNpcImgError] = useState(false);
  const showNpc = isBarter && task.npc && !npcImgError;
  const getRes = isBarter ? (task.barterMeta?.get ?? "").replace(/ ×\d+$/, "") : "";
  return (
    <div
      ref={setNodeRef}
      style={style}
      data-task-row="true"
      className={cn(
        // compact: progress lives inside the action tile, so no reserved bar height
        "group relative flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors min-h-[88px]",
        isCustom ? "pr-20" : "pr-14",
        isDone ? "bg-muted/50 border-muted" : "bg-card hover:bg-accent/50",
        isHidden ? "opacity-50" : ""
      )}
     >
      <button {...attributes} {...listeners} className="cursor-grab p-1 opacity-40 hover:opacity-100 touch-none" aria-label="drag">
        <GripVertical className="h-4 w-4" />
      </button>
      {showNpc ? (
        <img
          src={`/npc/${encodeURIComponent(task.npc!)}.png`}
          alt={task.npc!}
          className="h-[50px] w-[50px] rounded-full object-cover shrink-0 border border-border/50 bg-muted"
          loading="lazy"
          onError={(e) => {
            (e.target as HTMLImageElement).src = "/npc/placeholder.png";
            setNpcImgError(false);
          }}
        />
      ) : (
        <span className="h-[50px] w-[50px] shrink-0 grid place-items-center text-2xl leading-none select-none" aria-hidden>
          {task.icon}
        </span>
      )}
      {isBarter ? (
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={cn("text-sm font-bold text-primary truncate", isDone && "line-through decoration-muted-foreground/50")}>{getRes}</span>
            {task.priority === "must" && <span className="rounded bg-red-100 text-red-700 dark:bg-red-900/30 px-1.5 py-0.5 text-[10px] shrink-0">一定要換</span>}
            <span className="ml-auto flex items-center gap-1 text-xs shrink-0 min-w-0">
              <span className="font-medium truncate">{task.npc}</span>
              <span className="text-muted-foreground truncate">· {task.town}</span>
            </span>
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground min-w-0">
            <span className="truncate">
              你給 {task.barterMeta?.give} → 你拿 {task.barterMeta?.get}
            </span>
            <span className="ml-auto shrink-0">{task.barterMeta?.limit}</span>
          </div>
          {task.notes && <p className="text-xs text-amber-700 dark:text-amber-300 mt-1 italic line-clamp-1">📝 {task.notes}</p>}
        </div>
      ) : (
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={cn("text-sm font-medium truncate", isDone && "line-through decoration-muted-foreground/50")}>{task.name}</span>
          {task.timeGated && <span className="rounded bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 px-1.5 py-0.5 text-[10px]">{task.timeGated}</span>}
          {task.priority === "must" && <span className="rounded bg-red-100 text-red-700 dark:bg-red-900/30 px-1.5 py-0.5 text-[10px]">必做</span>}
          {task.source === "custom" && <span className="rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 px-1.5 py-0.5 text-[10px]">自訂</span>}
          {isBarter && <span className="rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 px-1.5 py-0.5 text-[10px]">{task.town}</span>}
        </div>
        <p className="text-xs text-muted-foreground leading-snug break-words whitespace-pre-wrap mt-0.5 line-clamp-2 min-h-[32px] md:min-h-[32px] md:line-clamp-2">
          {task.desc || "\u00A0"}
        </p>
        {task.notes && <p className="text-xs text-amber-700 dark:text-amber-300 mt-1 italic line-clamp-1">📝 {task.notes}</p>}
      </div>
      )}

      {/* fixed-width action slot — identical width for check and counter so text never shifts */}
      <div className="flex items-center justify-center shrink-0 w-[64px]">
        {isCheck ? (
          <button
            className={cn(
              "h-14 w-14 rounded-xl border grid place-items-center transition-colors",
              checked ? "bg-emerald-600 border-emerald-600 text-white" : "bg-card hover:border-primary"
            )}
            onClick={() => toggleCheck(task.id, isAccount)}
            aria-label={task.name}
            role="checkbox"
            aria-checked={checked}
          >
            <span className="text-xl leading-none">{checked ? "✓" : ""}</span>
          </button>
        ) : (
          <CounterTile taskId={task.id} count={count} max={task.max ?? 0} isAccount={isAccount} />
        )}
      </div>

      {/* A) always-faint in gutter — balances ≡ left weight, no overlap, reserved pr-24 */}
      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5 rounded-md border bg-card/95 backdrop-blur shadow-sm p-0.5 opacity-20 pointer-events-auto group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
        {task.source === "custom" && onEdit && (
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onEdit} aria-label="edit">
            <Pencil className="h-3 w-3" />
          </Button>
        )}
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => toggleHidden(task.id)} aria-label={isHidden ? "show" : "hide"}>
          {isHidden ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
        </Button>
        {task.source === "custom" && (
          <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive" onClick={() => removeCustom(task.id)} aria-label="delete">
            <Trash2 className="h-3 w-3" />
          </Button>
        )}
      </div>
    </div>
  );
}

// Tap tile for counters: tap = +1, full tile taps back to 0 (like unchecking),
// right-click / 550ms long-press = −1. Progress is the fill rising inside the tile.
function CounterTile({ taskId, count, max, isAccount }: { taskId: string; count: number; max: number; isAccount: boolean }) {
  const incCounter = useAppStore((s) => s.incCounter);
  const setCounter = useAppStore((s) => s.setCounter);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longFired = useRef(false);
  const pct = max ? Math.min(100, (count / max) * 100) : 0;
  const done = max > 0 && count >= max;
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  return (
    <button
      className={cn(
        "relative h-14 w-14 rounded-xl border overflow-hidden select-none transition-colors",
        done ? "bg-emerald-600 border-emerald-600 text-white" : "bg-card hover:border-primary"
      )}
      title={done ? "已完成，再點一下歸零" : "點一下 +1，右鍵/長按 −1"}
      onClick={() => {
        if (longFired.current) {
          longFired.current = false;
          return;
        }
        if (done) setCounter(taskId, 0, isAccount);
        else incCounter(taskId, 1, isAccount);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        incCounter(taskId, -1, isAccount);
      }}
      onPointerDown={() => {
        longFired.current = false;
        clear();
        timer.current = setTimeout(() => {
          longFired.current = true;
          incCounter(taskId, -1, isAccount);
        }, 550);
      }}
      onPointerUp={clear}
      onPointerLeave={clear}
      aria-label={`${count} / ${max}，點一下加一`}
    >
      {!done && <span className="absolute bottom-0 left-0 right-0 bg-emerald-500/25 transition-all" style={{ height: `${pct}%` }} />}
      <span className="absolute inset-0 grid place-items-center">
        {done ? (
          <span className="text-xl leading-none">✓</span>
        ) : (
          <span className="font-mono leading-none">
            <span className="text-lg font-bold">{count}</span>
            <span className="text-[10px] text-muted-foreground">/{max}</span>
          </span>
        )}
      </span>
    </button>
  );
}
