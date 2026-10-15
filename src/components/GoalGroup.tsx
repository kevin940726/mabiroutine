// The 定期委託 quest row: a repeatable weekly quest (weekly-goals) that renders
// its three sub-counters inside itself, folded on demand. It mirrors PinnedGroups'
// barter parents (row shells, ticker box, bottom strip, tinted body, full-row
// click target, lib/pinGroup's tile states) with two deliberate differences: the
// tile labels the recorded count (`N 次`) instead of −/✓, and the child write that
// brings all three to max AUTO-turns the round in (parent +1, children to 0) with
// the app's toast as the only recovery UI.
//
// Children are REAL tracker rows (own ids, values, buckets, sync keys) that never
// render top-level: App's section lists, the overall denominator and the
// celebration roster all drop them via lib/subTasks. The body keeps a NORMAL row's
// title treatment (`text-sm font-medium`) — this is a built-in tracker task, not a
// pin parent, so don't "fix" it toward PinnedGroups' bold title.
import { useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Eye, EyeOff, GripVertical } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useGrabCounter, type CounterWrites } from "@/hooks/useGrabCounter";
import { useIsMobile } from "@/hooks/useIsMobile";
import { parentFillPct, parentState } from "@/lib/pinGroup";
import { resolveSubTasks, subTaskLabel } from "@/lib/subTasks";
import { cn } from "@/lib/utils";
import { COUNTER_SANITY_MAX, useAppStore } from "@/store/useAppStore";
import { toastAction } from "@/sync/session";
import type { Task } from "@/lib/types";
import { ROW_SHELL_DESKTOP, ROW_SHELL_MOBILE, TICKER_BOX_DESKTOP, TICKER_BOX_MOBILE, VIOLET_SHEET, VIOLET_STRIP } from "@/components/rowStyle";

/** Drag-scale only: px-per-step uses this instead of a real max (the tile has
 *  none). The write range itself comes from `CounterWrites.clamp`. */
const PARENT_STEP_MAX = 20;
/** Stored value read as a count (a check-era boolean can still arrive from a
 *  peer; true = one recorded round). */
function numOf(v: number | boolean | undefined): number {
  return typeof v === "number" ? v : v === true ? 1 : 0;
}

type Props = {
  task: Task;
  value: number | boolean | undefined;
  isAccount: boolean;
};

export function GoalGroup({ task, value, isAccount }: Props) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const children = useMemo(() => resolveSubTasks(task), [task]);
  const char = useAppStore((s) => s.getActiveChar());
  const accountValues = useAppStore((s) => s.accountValues);
  const isHidden = useAppStore((s) => s.isTaskHidden(task.id));
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  const style: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition };

  const count = numOf(value);
  const done = count >= 1;
  const childValues = children.map((c) => numOf(isAccount ? accountValues[c.id] : char?.taskValues[c.id]));
  const rows = children.map((c, i) => ({ task: c, value: childValues[i], isAccount }));
  const state = parentState(rows);
  // "full" cannot rest (the completing write turns in), so it takes the partial
  // look defensively: this row must never show a ✓ on its tile.
  const partial = state === "partial" || state === "full";
  const fillPct = parentFillPct(rows);

  const liveCount = (): number => {
    const s = useAppStore.getState();
    return numOf(isAccount ? s.accountValues[task.id] : s.getActiveChar()?.taskValues[task.id]);
  };
  const setRound = (next: number): void => {
    useAppStore.getState().setCounter(task.id, Math.min(COUNTER_SANITY_MAX, Math.max(0, next)), isAccount);
  };
  const liveChild = (i: number): number => {
    const s = useAppStore.getState();
    return numOf(isAccount ? s.accountValues[children[i].id] : s.getActiveChar()?.taskValues[children[i].id]);
  };

  // A turn-in fires at most once per write gesture: a drag that overshoots the
  // last stop keeps writing the same child and would re-fill one it just consumed.
  const consumedRef = useRef(false);
  const beginGesture = (): void => {
    consumedRef.current = false;
  };

  /** Child write; the write that makes all three complete consumes the round. */
  const writeChild = (i: number, next: number): void => {
    if (consumedRef.current) return;
    const child = children[i];
    const max = child.max ?? 1;
    // Snapshot before the write: the undo puts the row back where it was before
    // this tap, the tick included.
    const before = children.map((_, j) => liveChild(j));
    useAppStore.getState().setCounter(child.id, Math.min(max, Math.max(0, next)), isAccount);
    // setCounter is synchronous; read the post-write state for the completion check
    const after = useAppStore.getState();
    const values = children.map((c) => numOf(isAccount ? after.accountValues[c.id] : after.getActiveChar()?.taskValues[c.id]));
    if (!values.every((v, j) => v >= (children[j].max ?? 1))) return;
    const undo = useAppStore.getState().recordGoalRound(task.id, isAccount, before);
    if (!undo) return;
    consumedRef.current = true;
    toastAction("三項完成：自動回報 1 次，子項已歸零", "復原", () =>
      useAppStore.getState().restoreGoalValues(undo, isAccount)
    );
  };

  const parentWrites: CounterWrites = {
    set: setRound,
    inc: () => setRound(liveCount() + 1),
    dec: () => setRound(liveCount() - 1),
    // Unbounded: a tap never resets, the drag clamps at 0 only.
    done: false,
    clamp: (v) => Math.max(0, v),
    onWriteStart: beginGesture,
  };
  const childWrites = (i: number): CounterWrites => {
    const max = children[i].max ?? 1;
    return {
      set: (v) => writeChild(i, v),
      inc: () => writeChild(i, liveChild(i) + 1),
      dec: () => writeChild(i, liveChild(i) - 1),
      done: liveChild(i) >= max,
      clamp: (v) => Math.min(max, Math.max(0, v)),
      onWriteStart: beginGesture,
    };
  };

  // Same hide shape as a row (undo toast on the hide direction). The parent hides
  // alone and takes its children with it; sub-tasks have no hide of their own.
  const onHide = (): void => {
    useAppStore.getState().toggleHidden(task.id);
    if (!isHidden) {
      toastAction(`已隱藏「${task.name}」`, "復原", () => useAppStore.getState().toggleHidden(task.id));
    }
  };

  const grip = (
    <button
      {...attributes}
      {...listeners}
      aria-label="drag"
      className={cn(
        "relative z-20 cursor-grab opacity-40 hover:opacity-100 touch-none",
        isMobile ? "flex flex-1 items-center justify-center py-1" : "p-1"
      )}
    >
      <GripVertical className="h-4 w-4" />
    </button>
  );
  const eye = isMobile ? (
    <button
      type="button"
      onClick={onHide}
      aria-label={isHidden ? "顯示" : "隱藏"}
      className="relative z-20 h-6 w-6 grid place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      {isHidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
    </button>
  ) : (
    <div className="relative z-20 flex h-7 w-7 items-center justify-center rounded-md border bg-card shadow-sm opacity-20 group-hover:opacity-100 group-focus-within:opacity-100">
      <button
        type="button"
        onClick={onHide}
        aria-label={isHidden ? "show" : "hide"}
        className="h-6 w-6 shrink-0 rounded-md grid place-items-center"
      >
        {isHidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
      </button>
    </div>
  );
  // Past the first round the title carries the index: (2), (3), …
  const titleText = count >= 2 ? `${task.name} (${count})` : task.name;

  // pointer-events-none: the body is not a control, so a click anywhere on it
  // falls through to the full-row overlay (the barter parent's rule).
  const body = (
    <div className="pointer-events-none relative z-0 min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
        {isMobile && (
          <span className="shrink-0" aria-hidden>
            {task.icon}
          </span>
        )}
        <span className="min-w-0 flex-1 break-words">{titleText}</span>
      </div>
      <p className="mt-1 whitespace-pre-wrap text-xs leading-snug text-muted-foreground sm:mt-0.5">{task.desc || "\u00A0"}</p>
    </div>
  );

  return (
    <div data-goal-group={task.id}>
      <div
        ref={setNodeRef}
        style={style}
        data-task-row="true"
        data-task-id={task.id}
        className={cn(
          isMobile ? ROW_SHELL_MOBILE : ROW_SHELL_DESKTOP,
          // No strip lane: the capsule overlays the row's own bottom padding,
          // which keeps the row at the standard height in both fold states (the
          // body is a sibling below, so opening it cannot move the parent).
          done ? "bg-muted/50 border-muted" : "",
          isHidden ? "opacity-50" : "",
          // Open: square the bottom edge so the sheet below plugs in.
          open && "rounded-b-none",
          isDragging && "pointer-events-none"
        )}
      >
        {/* Full-row click target, exactly the barter parent's: clicking anywhere
            on the row toggles the fold; controls ride above it at z-20. Pointer
            convenience only — the strip is the announced disclosure control. */}
        <button
          type="button"
          aria-hidden
          tabIndex={-1}
          onClick={() => setOpen((v) => !v)}
          className={cn("absolute inset-0 z-10", open ? "rounded-t-lg" : "rounded-lg")}
        />
        {isMobile ? (
          <div className="flex items-start gap-2">
            <div className="flex w-7 shrink-0 flex-col items-center self-stretch pt-0.5">
              {eye}
              {grip}
            </div>
            {body}
            <GoalParentTile
              task={task}
              isAccount={isAccount}
              isMobile
              count={count}
              done={done}
              partial={partial}
              fillPct={fillPct}
              writes={parentWrites}
            />
          </div>
        ) : (
          <>
            <div className="flex items-center gap-1.5 shrink-0">
              {grip}
              {eye}
              <span className="h-[50px] w-[50px] shrink-0 grid place-items-center text-2xl leading-none select-none" aria-hidden>
                {task.icon}
              </span>
            </div>
            {body}
            <GoalParentTile
              task={task}
              isAccount={isAccount}
              isMobile={false}
              count={count}
              done={done}
              partial={partial}
              fillPct={fillPct}
              writes={parentWrites}
            />
          </>
        )}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={`${open ? "收合" : "展開"} ${task.name} 的 ${children.length} 項進度`}
          onClick={() => setOpen((v) => !v)}
          style={{ touchAction: "manipulation" }}
          className={cn(
            VIOLET_STRIP,
            open && "rounded-b-none",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          )}
        >
          <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold leading-none">
            <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")} />
            {open ? "收合" : `展開 ${children.length} 項`}
          </span>
        </button>
      </div>
      {open && !isDragging && (
        <div id={bodyId} role="group" aria-label={`${task.name} 的進度`} className={VIOLET_SHEET}>
          {/* ONE row: the three legs as equal-width bordered chips */}
          <div className="grid grid-cols-3 gap-2">
            {children.map((c, i) => (
              <GoalLeg
                key={c.id}
                task={c}
                value={childValues[i]}
                isAccount={isAccount}
                writes={childWrites(i)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Coach / drag bubbles, the same two a row tile shows. */
function TileHints({ grabbed, coach }: { grabbed: boolean; coach: boolean }) {
  return (
    <>
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
    </>
  );
}

/** The parent tile: a counter tile carrying the children's aggregate fill, like a
 *  barter parent's (same geometry, partial-state border, bottom-up fill). `n >= 1`
 *  takes the checked fill. The `次` unit stays in BOTH states — white on the
 *  emerald fill, which is under the small-text AA contrast floor, a deliberate
 *  call so the unit never disappears. */
function GoalParentTile({
  task,
  isAccount,
  isMobile,
  count,
  done,
  partial,
  fillPct,
  writes,
}: {
  task: Task;
  isAccount: boolean;
  isMobile: boolean;
  count: number;
  done: boolean;
  partial: boolean;
  fillPct: number;
  writes: CounterWrites;
}) {
  const { grabbed, coach, wrapRef, handlers } = useGrabCounter(
    task.id,
    count,
    PARENT_STEP_MAX,
    isAccount,
    task.section,
    writes
  );
  return (
    // The real ticker box, as a row and as PinnedGroups' parent use it:
    // `self-stretch` + centering is what vertically centers the tile on the row's
    // content, so this row's tile sits where every other row's does.
    <div className={cn("relative z-20", isMobile ? TICKER_BOX_MOBILE : TICKER_BOX_DESKTOP)}>
      <span ref={wrapRef} className="relative inline-block">
        <button
          {...handlers}
          type="button"
          style={{ touchAction: "none" }}
          aria-label={`已回報 ${count} 次，點一下加一，長按拖曳快速調整`}
          className={cn(
            "relative block h-11 w-11 rounded-xl border overflow-hidden select-none transition-colors",
            isMobile ? "" : "h-14 w-14",
            done
              ? "bg-emerald-600 border-emerald-600 text-white"
              : partial
                ? "border-emerald-600 text-emerald-600 dark:text-emerald-400"
                : "bg-card hover:border-primary",
            grabbed && "ring-2 ring-primary scale-105 cursor-ns-resize border-primary"
          )}
        >
          {partial && !done && (
            <span
              className="absolute bottom-0 left-0 right-0 bg-emerald-500/25 transition-[height]"
              style={{ height: `${fillPct}%` }}
            />
          )}
          <span className="absolute inset-0 grid place-items-center">
            <span className="font-mono leading-none">
              <span className={cn("font-semibold", isMobile ? "text-base" : "text-lg")}>{count}</span>
              <span className={cn("ml-0.5 text-[10px]", done ? "text-white" : "text-muted-foreground")}>次</span>
            </span>
          </span>
        </button>
        <TileHints grabbed={grabbed} coach={coach} />
      </span>
    </div>
  );
}

/** One leg of the round, in its own card-radius bordered chip, filling an equal
 *  third of the sheet: emoji + tile always, the leg's full label from `sm` up (a
 *  phone's third is ~110px, where emoji + label + tile would need ~140px, so the
 *  label is dropped rather than abbreviated — the tile's aria-label names it). */
function GoalLeg({
  task,
  value,
  isAccount,
  writes,
}: {
  task: Task;
  value: number;
  isAccount: boolean;
  writes: CounterWrites;
}) {
  return (
    // Fixed chip height per width (70px desktop / 58px mobile) around the app's
    // smaller 44px square, the surplus absorbed as padding: a leg's control stays
    // subordinate to the parent's 56px tile without the chip shrinking.
    <div className="flex min-w-0 items-center justify-between gap-1.5 rounded-lg border bg-card px-2 py-1.5 sm:px-4 sm:py-3">
      <span className="inline-flex min-w-0 items-center gap-1">
        <span className="shrink-0 text-sm leading-none" aria-hidden>
          {task.icon}
        </span>
        <span className="hidden min-w-0 truncate text-xs leading-none sm:inline-block">{subTaskLabel(task)}</span>
      </span>
      <GoalChildTile task={task} value={value} isAccount={isAccount} writes={writes} />
    </div>
  );
}

/** A sub-counter's tile: `N/max`, fill, ✓ at max, tap-at-full → 0. 44px at both
 *  widths — the app's mobile tile size, and the touch-target floor. */
function GoalChildTile({
  task,
  value,
  isAccount,
  writes,
}: {
  task: Task;
  value: number;
  isAccount: boolean;
  writes: CounterWrites;
}) {
  const max = task.max ?? 1;
  const done = value >= max;
  const { grabbed, coach, wrapRef, handlers } = useGrabCounter(task.id, value, max, isAccount, task.section, writes);
  const pct = Math.min(100, (value / max) * 100);
  return (
    <span ref={wrapRef} className="relative inline-block">
      <button
        {...handlers}
        type="button"
        style={{ touchAction: "none" }}
        aria-label={`${task.name} ${value} / ${max}，點一下加一，長按拖曳快速調整`}
        className={cn(
          "relative block h-11 w-11 rounded-xl border overflow-hidden select-none transition-colors",
          done ? "bg-emerald-600 border-emerald-600 text-white" : "bg-card hover:border-primary",
          grabbed && "ring-2 ring-primary scale-105 cursor-ns-resize border-primary"
        )}
      >
        <span className="absolute bottom-0 left-0 right-0 bg-emerald-500/25 transition-[height]" style={{ height: `${pct}%` }} />
        <span className="absolute inset-0 grid place-items-center">
          {done ? (
            <span className="text-lg leading-none text-white">✓</span>
          ) : (
            <span className="font-mono leading-none">
              <span className="text-base font-semibold">{value}</span>
              <span className="text-[10px] text-muted-foreground">/{max}</span>
            </span>
          )}
        </span>
      </button>
      <TileHints grabbed={grabbed} coach={coach} />
    </span>
  );
}

export default GoalGroup;
