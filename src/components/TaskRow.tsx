import { useAppStore } from "@/store/useAppStore";
import type { Task } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Minus, Plus, EyeOff, Eye, GripVertical, Trash2, Pencil } from "lucide-react";
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
  const incCounter = useAppStore((s) => s.incCounter);
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
  const progressPct = !isCheck && task.max ? Math.min(100, (count / task.max) * 100) : 0;

  const isCustom = task.source === "custom";
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        // fixed height so check vs counter (progress) rows match — 116px covers 2-line desc + progress
        "group relative flex items-center gap-3 rounded-lg border px-3 py-3 transition-colors h-[116px] md:h-[116px]",
        isCustom ? "pr-20" : "pr-14",
        isDone ? "bg-muted/50 border-muted" : "bg-card hover:bg-accent/50",
        isHidden ? "opacity-50" : ""
      )}
    >
      <button {...attributes} {...listeners} className="cursor-grab p-1 opacity-40 hover:opacity-100 touch-none" aria-label="drag">
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="text-xl leading-none select-none" aria-hidden>
        {task.icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={cn("text-sm font-medium truncate", isDone && "line-through decoration-muted-foreground/50")}>{task.name}</span>
          {task.timeGated && <span className="rounded bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 px-1.5 py-0.5 text-[10px]">{task.timeGated}</span>}
          {task.priority === "must" && <span className="rounded bg-red-100 text-red-700 dark:bg-red-900/30 px-1.5 py-0.5 text-[10px]">必做</span>}
          {task.source === "custom" && <span className="rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 px-1.5 py-0.5 text-[10px]">自訂</span>}
          {task.source === "barter" && <span className="rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 px-1.5 py-0.5 text-[10px]">{task.town}</span>}
        </div>
        <p className="text-xs text-muted-foreground leading-snug break-words whitespace-pre-wrap mt-0.5 line-clamp-2 min-h-[32px] md:min-h-[32px] md:line-clamp-2">
          {task.desc || "\u00A0"}
        </p>
        {task.notes && <p className="text-xs text-amber-700 dark:text-amber-300 mt-1 italic line-clamp-1">📝 {task.notes}</p>}
        {/* reserve progress height for all rows so counter rows not taller */}
        <div className={cn("mt-1.5 h-1.5 w-full rounded-full overflow-hidden", isCheck || !task.max ? "invisible" : "bg-muted")}>
          {!isCheck && task.max ? <div className="h-full bg-primary transition-all" style={{ width: `${progressPct}%` }} /> : null}
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {isCheck ? (
          <Button
            variant={checked ? "default" : "outline"}
            size="icon"
            className={cn("h-8 w-8 rounded-full", checked && "bg-emerald-600 hover:bg-emerald-700 border-emerald-600")}
            onClick={() => toggleCheck(task.id, isAccount)}
            aria-label={task.name}
            role="checkbox"
            aria-checked={checked}
          >
            <span className="text-base leading-none">{checked ? "✓" : ""}</span>
          </Button>
        ) : (
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-7 w-7 rounded-full" disabled={count <= 0} onClick={() => incCounter(task.id, -1, isAccount)} aria-label="-1">
              <Minus className="h-3 w-3" />
            </Button>
            <span className="min-w-[48px] text-center text-sm font-mono">
              {count}
              <span className="text-muted-foreground"> / {task.max}</span>
            </span>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7 rounded-full"
              disabled={count >= (task.max ?? 999)}
              onClick={() => incCounter(task.id, 1, isAccount)}
              aria-label="+1"
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>
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
