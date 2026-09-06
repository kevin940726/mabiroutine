import { useState } from "react";
import { useAppStore } from "@/store/useAppStore";
import { useGrabCounter } from "@/hooks/useGrabCounter";
import type { Task } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { confirmRemoveTask } from "@/components/ConfirmDialog";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/useIsMobile";
import { EyeOff, Eye, MoreHorizontal, Trash2, Pencil, GripVertical } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type Props = {
  task: Task;
  value: boolean | number | undefined;
  isAccount: boolean;
  onEdit?: () => void;
};

export function TaskRow(props: Props) {
  const isMobile = useIsMobile();
  return isMobile ? <TaskRowMobile {...props} /> : <TaskRowDesktop {...props} />;
}

function TaskRowMobile({ task, value, isAccount, onEdit }: Props) {
  const toggleCheck = useAppStore((s) => s.toggleCheck);
  const toggleHidden = useAppStore((s) => s.toggleHidden);
  const removeCustom = useAppStore((s) => s.removeCustomTask);
  const isHidden = useAppStore((s) => s.isTaskHidden(task.id));
  const hideScope = task.section === "account" ? "（所有角色共用）" : "";

  const isCheck = task.type === "check";
  const checked = isCheck ? Boolean(value) : false;
  const count = !isCheck ? (typeof value === "number" ? value : 0) : 0;
  const isDone = isCheck ? checked : count >= (task.max ?? 0) && (task.max ?? 0) > 0;

  const isCustom = task.source === "custom";
  const isBarter = task.source === "barter";
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: task.id });
  const style: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition };
  const [npcImgError, setNpcImgError] = useState(false);
  const showNpc = isBarter && task.npc && !npcImgError;
  const getRes = isBarter ? (task.barterMeta?.get ?? "").replace(/ ×\d+$/, "") : "";

  // two-line row, no ellipsis: title line (name only, ⋯/👁 top-right) +
  // badge line (always its own line so long names never orphan) + body line
  // (desc block with 44px tile vertically centered). Right column is w-11.
  const badges = isBarter
    ? (task.priority === "must" ? (
      <span className="rounded bg-red-100 text-red-700 dark:bg-red-900/30 px-1.5 py-0.5 text-[10px] whitespace-nowrap shrink-0">一定要換</span>
    ) : null)
    : (<>
      {task.priority === "must" && <span className="rounded bg-red-100 text-red-700 dark:bg-red-900/30 px-1.5 py-0.5 text-[10px] whitespace-nowrap shrink-0">必做</span>}
      {task.source === "custom" && <span className="rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 px-1.5 py-0.5 text-[10px] whitespace-nowrap shrink-0">自訂</span>}
      {isBarter && <span className="rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 px-1.5 py-0.5 text-[10px] whitespace-nowrap shrink-0">{task.town}</span>}
    </>);

  const title = isBarter ? (
    <div>
      <div className="flex items-center gap-1.5 text-sm font-bold text-primary">
        {showNpc ? (
          <img
            src={`/npc/${encodeURIComponent(task.npc!)}.png`}
            alt=""
            aria-hidden
            className="h-5 w-5 shrink-0 rounded-full object-cover border border-border/50 bg-muted"
            loading="lazy"
            onError={() => setNpcImgError(true)}
          />
        ) : (
          <span className="shrink-0" aria-hidden>{task.icon}</span>
        )}
        <span className={cn("min-w-0 flex-1 break-words", isDone && "line-through decoration-muted-foreground/50")}>{getRes}</span>
      </div>
      {task.priority === "must" && <div className="mt-1 flex flex-wrap gap-1">{badges}</div>}
    </div>
  ) : (
    <div>
      <div className="flex items-center gap-1.5 text-sm font-medium">
        <span className="shrink-0" aria-hidden>{task.icon}</span>
        <span className={cn("min-w-0 flex-1 break-words", isDone && "line-through decoration-muted-foreground/50")}>{task.name}</span>
      </div>
      {(task.priority === "must" || task.source === "custom" || isBarter) && (
        <div className="mt-1 flex flex-wrap gap-1">{badges}</div>
      )}
    </div>
  );

  const body = isBarter ? (
    <div className="min-w-0 flex-1">
      <div className="text-xs text-muted-foreground break-words">
        {task.npc} · {task.town} · {task.barterMeta?.limit}
      </div>
      <div className="text-xs text-muted-foreground break-words">
        你給 {task.barterMeta?.give} → 你拿 {task.barterMeta?.get}
      </div>
      {task.notes && <p className="text-xs text-amber-700 dark:text-amber-300 mt-1 italic break-words">📝 {task.notes}</p>}
    </div>
  ) : (
    <div className="min-w-0 flex-1">
      <p className="text-xs text-muted-foreground leading-snug break-words whitespace-pre-wrap">
        {task.desc || "\u00A0"}
      </p>
      {task.notes && <p className="text-xs text-amber-700 dark:text-amber-300 mt-1 italic break-words">📝 {task.notes}</p>}
    </div>
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-task-row="true"
      data-task-id={task.id}
      className={cn(
        "rounded-lg border bg-card p-3 transition-colors relative",
        isDone ? "bg-muted/50 border-muted" : "hover:bg-accent/50",
        isHidden ? "opacity-50" : ""
      )}
     >
      <button {...attributes} {...listeners} className="cursor-grab w-5 py-1 opacity-40 hover:opacity-100 touch-none absolute left-1 top-1/2 -translate-y-1/2 flex justify-center" aria-label="drag">
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="min-w-0 pl-5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">{title}</div>
        <div className="w-11 shrink-0 flex justify-end">
          {isCustom ? (
            <RowMenu
              isHidden={isHidden}
              hideScope={hideScope}
              onEdit={onEdit}
              onToggleHidden={() => toggleHidden(task.id)}
              onRemove={() => {
                void confirmRemoveTask(task.name).then((ok) => {
                  if (ok) removeCustom(task.id);
                });
              }}
            />
          ) : (
            <button
              onClick={() => toggleHidden(task.id)}
              className="h-6 w-6 grid place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label={`${isHidden ? "顯示" : "隱藏"}${hideScope}`}
            >
              {isHidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 mt-1">
        {body}
        <div className="w-11 shrink-0 flex justify-center">
          {isCheck ? (
            <button
              className={cn(
                "h-11 w-11 rounded-xl border grid place-items-center transition-colors",
                checked ? "bg-emerald-600 border-emerald-600 text-white" : "bg-card hover:border-primary"
              )}
              onClick={() => toggleCheck(task.id, isAccount)}
              aria-label={task.name}
              role="checkbox"
              aria-checked={checked}
            >
              <span className="text-lg leading-none">{checked ? "✓" : ""}</span>
            </button>
          ) : (
            <CounterTileMobile taskId={task.id} count={count} max={task.max ?? 0} isAccount={isAccount} countdown={task.type === "countdown"} />
          )}
        </div>
      </div>
      </div>
    </div>
  );
}

function RowMenu({ isHidden, hideScope, onEdit, onToggleHidden, onRemove }: {
  isHidden: boolean;
  hideScope?: string;
  onEdit?: () => void;
  onToggleHidden: () => void;
  onRemove: () => void;
}) {
  // Radix portal escapes the section Card's overflow-hidden; collision
  // handling flips the menu automatically near viewport edges. Also gains
  // outside-click / Escape dismiss over the old hand-rolled absolute menu.
  // Non-modal: a row menu must not scroll-lock the page beneath it.
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          className="h-7 w-7 grid place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="row actions"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-28">
        {onEdit && (
          <DropdownMenuItem onSelect={onEdit} className="text-xs">
            <Pencil className="h-3.5 w-3.5" />編輯
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={onToggleHidden} className="text-xs">
          {isHidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}{isHidden ? "顯示" : "隱藏"}{hideScope}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onRemove} className="text-xs text-destructive focus:text-destructive">
          <Trash2 className="h-3.5 w-3.5" />刪除
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Tap tile for counters: tap = +1, full tile taps back to 0 (like unchecking),
// right-click / 550ms long-press = −1. Progress is the fill rising inside the tile.
// Tap tile for counters: tap = +1, full tile taps back to 0 (like unchecking),
// right-click = −1. Hold 0.3s → grab, drag vertically to adjust fast.
// Progress is the fill rising inside the tile.
function CounterTileMobile({ taskId, count, max, isAccount, countdown }: { taskId: string; count: number; max: number; isAccount: boolean; countdown?: boolean }) {
  const { grabbed, coach, wrapRef, handlers } = useGrabCounter(taskId, count, max, isAccount);
  const pct = max ? Math.min(100, (count / max) * 100) : 0;
  const done = max > 0 && count >= max;
  // countdown mode: big number counts down (剩 N), fill still rises with used
  const shown = countdown ? Math.max(0, max - count) : count;
  // done look lands only at rest; while grabbing, always numbers on unflipped tile
  const showCheck = done && !grabbed;
  return (
    <span ref={wrapRef} className="relative inline-block">
      <button
        className={cn(
          "relative block h-11 w-11 rounded-xl border overflow-hidden select-none transition-colors",
          showCheck ? "bg-emerald-600 border-emerald-600 text-white" : "bg-card hover:border-primary",
          grabbed && "ring-2 ring-primary scale-105 cursor-ns-resize border-primary"
        )}
        style={{ touchAction: "none" }}
        aria-label={countdown ? `剩餘 ${shown} 次，共 ${max} 次，點一下加一，長按拖曳快速調整` : `${count} / ${max}，點一下加一，長按拖曳快速調整`}
        {...handlers}
      >
        <span className="absolute bottom-0 left-0 right-0 bg-emerald-500/25 transition-all" style={{ height: `${pct}%` }} />
        <span className="absolute inset-0 grid place-items-center">
          {showCheck ? (
            <span className="text-lg leading-none text-white">✓</span>
          ) : (
            <span className="font-mono leading-none">
              {countdown && <span className="text-[10px] text-muted-foreground">剩</span>}
              <span className="text-base font-semibold">{shown}</span>
              <span className="text-[10px] text-muted-foreground">/{max}</span>
            </span>
          )}
        </span>
      </button>
      {grabbed && (
        <span className="absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground" aria-hidden>
          ↕ 拖曳調整中
        </span>
      )}
      {coach && !grabbed && (
        <span className="absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded border bg-popover px-1.5 py-0.5 text-[10px] text-popover-foreground shadow-md" aria-hidden>
          ↕ 長按拖曳快速加減
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Desktop variant. Desktop and mobile evolve together — every change considers
// both.
// ---------------------------------------------------------------------------

function TaskRowDesktop({ task, value, isAccount, onEdit }: Props) {
  const toggleCheck = useAppStore((s) => s.toggleCheck);
  const toggleHidden = useAppStore((s) => s.toggleHidden);
  const removeCustom = useAppStore((s) => s.removeCustomTask);
  const isHidden = useAppStore((s) => s.isTaskHidden(task.id));
  const hideScope = task.section === "account" ? "（所有角色共用）" : "";
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: task.id });
  const style: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition };

  const isCheck = task.type === "check";
  const checked = isCheck ? Boolean(value) : false;
  const count = !isCheck ? (typeof value === "number" ? value : 0) : 0;
  const isDone = isCheck ? checked : count >= (task.max ?? 0) && (task.max ?? 0) > 0;

  const isBarter = task.source === "barter";
  const [npcImgError, setNpcImgError] = useState(false);
  const showNpc = isBarter && task.npc && !npcImgError;
  const getRes = isBarter ? (task.barterMeta?.get ?? "").replace(/ ×\d+$/, "") : "";
  return (
    <div
      ref={setNodeRef}
      style={style}
      data-task-row="true"
      data-task-id={task.id}
      className={cn(
        // compact: progress lives inside the action tile, so no reserved bar height
        "group relative flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors min-h-[88px] pr-14",
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

      {/* action slot hugs the 56px tile — identical box for check and counter */}
      <div className="flex items-center justify-center shrink-0 w-14 self-center">
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
          <CounterTileDesktop taskId={task.id} count={count} max={task.max ?? 0} isAccount={isAccount} countdown={task.type === "countdown"} />
        )}
      </div>

      {/* A) always-faint in gutter — balances ≡ left weight, no overlap.
          Custom rows: bare ⋯ at full opacity (hide lives inside the menu).
          Builtin rows keep the single faint hide icon. */}
      {task.source === "custom" ? (
        <div className="absolute right-2 top-1/2 -translate-y-1/2">
          <RowMenu
            isHidden={isHidden}
            hideScope={hideScope}
            onEdit={onEdit}
            onToggleHidden={() => toggleHidden(task.id)}
            onRemove={() => {
              void confirmRemoveTask(task.name).then((ok) => {
                if (ok) removeCustom(task.id);
              });
            }}
          />
        </div>
      ) : (
        <div className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md border bg-card/95 backdrop-blur shadow-sm p-0.5 opacity-20 pointer-events-auto group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => toggleHidden(task.id)} aria-label={`${isHidden ? "show" : "hide"}${hideScope}`}>
            {isHidden ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
          </Button>
        </div>
      )}
    </div>
  );
}

// Tap tile for counters: tap = +1, full tile taps back to 0 (like unchecking),
// right-click = −1. Hold 0.3s → grab, drag vertically to adjust fast.
// Progress is the fill rising inside the tile.
function CounterTileDesktop({ taskId, count, max, isAccount, countdown }: { taskId: string; count: number; max: number; isAccount: boolean; countdown?: boolean }) {
  const { grabbed, coach, wrapRef, handlers } = useGrabCounter(taskId, count, max, isAccount);
  const pct = max ? Math.min(100, (count / max) * 100) : 0;
  const done = max > 0 && count >= max;
  // countdown mode: big number counts down (剩 N), fill still rises with used
  const shown = countdown ? Math.max(0, max - count) : count;
  // done look lands only at rest; while grabbing, always numbers on unflipped tile
  const showCheck = done && !grabbed;
  return (
    <span ref={wrapRef} className="relative inline-block">
      <button
        className={cn(
          "relative block h-14 w-14 rounded-xl border overflow-hidden select-none transition-colors",
          showCheck ? "bg-emerald-600 border-emerald-600 text-white" : "bg-card hover:border-primary",
          grabbed && "ring-2 ring-primary scale-105 cursor-ns-resize border-primary"
        )}
        style={{ touchAction: "none" }}
        aria-label={countdown ? `剩餘 ${shown} 次，共 ${max} 次，點一下加一，長按拖曳快速調整` : `${count} / ${max}，點一下加一，長按拖曳快速調整`}
        {...handlers}
      >
        <span className="absolute bottom-0 left-0 right-0 bg-emerald-500/25 transition-all" style={{ height: `${pct}%` }} />
        <span className="absolute inset-0 grid place-items-center">
          {showCheck ? (
            <span className="text-xl leading-none text-white">✓</span>
          ) : (
            <span className="font-mono leading-none">
              {countdown && <span className="text-[10px] text-muted-foreground">剩</span>}
              <span className="text-lg font-semibold">{shown}</span>
              <span className="text-[10px] text-muted-foreground">/{max}</span>
            </span>
          )}
        </span>
      </button>
      {grabbed && (
        <span className="absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground" aria-hidden>
          ↕ 拖曳調整中
        </span>
      )}
      {coach && !grabbed && (
        <span className="absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded border bg-popover px-1.5 py-0.5 text-[10px] text-popover-foreground shadow-md" aria-hidden>
          ↕ 長按拖曳快速加減
        </span>
      )}
    </span>
  );
}
