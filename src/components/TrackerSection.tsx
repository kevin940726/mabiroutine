import { useCallback, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TaskRow } from "@/components/TaskRow";
import { Tooltip } from "@/components/ui/tooltip";
import type { Task, TaskSection } from "@/lib/types";
import { summarizeProgress } from "@/lib/progress";
import { useAppStore, barterToTask, shopDealToTask, canonicalBarterOrder } from "@/store/useAppStore";
import { shopDealsByPinId } from "@/lib/shops";
import { PURPLE_HOLE_ID, isScheduledToday, nextBadgeLabel } from "@/lib/purpleHole";
import barterJson from "@/data/barter.json";
import { DndContext, closestCenter, type DragEndEvent, type Modifier } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { decideDrop, bandId, clampToRange, type DropTarget } from "@/lib/dragRules";
import { ChevronDown, ChevronUp, Plus } from "lucide-react";
import { useNow } from "@/hooks/useNow";
import { toastAction } from "@/sync/session";
import { PinnedGroups } from "@/components/PinnedGroups";

// Batched drag-undo: rapid successive drops coalesce into one toast
// (已移動 A、B、C) whose undo replays every snapshot in order — so the
// list returns to its pre-first-drag state. The batch resets after 5s
// quiet; each drop re-fires the toast with the accumulated label (the bus
// shows one toast at a time, so the visible one is always the latest).
// Snapshots are whole order slices; restores are disjoint per list, and a
// superseded toast's button is unreachable once replaced.
type DragUndoBatch = { names: string[]; restores: Array<() => void> };
let dragUndoBatch: DragUndoBatch | null = null;
let dragUndoTimer = 0;

/**
 * Run order restores with a FLIP glide: snapshot row tops, apply, then play
 * each moved row from its old top to its new one. Rows identify by the
 * data-task-id both row variants already render; unmounted rows (collapsed
 * sections) are simply skipped. Inline styles are scrubbed after so dnd-kit
 * never fights them. Honors prefers-reduced-motion (plain restore).
 */
function flipRestore(restore: () => void): void {
  if (
    typeof window === "undefined" ||
    typeof document === "undefined" ||
    (typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches)
  ) {
    restore();
    return;
  }
  const before = new Map<string, number>();
  document.querySelectorAll<HTMLElement>('[data-task-row="true"][data-task-id]').forEach((el) => {
    const id = el.dataset.taskId;
    if (id) before.set(id, el.getBoundingClientRect().top);
  });
  restore();
  // Two frames: let React commit the restored order before measuring.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      document
        .querySelectorAll<HTMLElement>('[data-task-row="true"][data-task-id]')
        .forEach((el) => {
          const id = el.dataset.taskId;
          const from = id ? before.get(id) : undefined;
          if (from === undefined) return;
          const delta = from - el.getBoundingClientRect().top;
          if (!delta) return;
          el.style.transition = "none";
          el.style.transform = `translateY(${delta}px)`;
          requestAnimationFrame(() => {
            el.style.transition = "transform 300ms ease";
            el.style.transform = "";
            let done = false;
            const clear = () => {
              if (done) return;
              done = true;
              el.style.transition = "";
              el.style.transform = "";
              el.removeEventListener("transitionend", clear);
            };
            el.addEventListener("transitionend", clear);
            window.setTimeout(clear, 400);
          });
        });
    })
  );
}

/** A dnd-kit modifier that stops the dragged chip at the edge of its own list, so
 *  a top-level row cannot be dragged visually over the pinned block below it.
 *
 *  The drop was already correct without this — `over` cannot resolve outside the
 *  active context, so the row lands at the end of its own list — but the chip
 *  following the pointer down past the boundary read as "this will land down
 *  there". This makes the gesture match the outcome.
 *
 *  Bounds come from the list's LAST ROW, not the wrapper's padding box: the
 *  wrapper's bottom sits a gap below the final row (the rows are spaced), so
 *  clamping to it let the chip travel one gap past where it could actually land,
 *  which measured 10px short of the pinned block — legal, but visually it still
 *  read as reaching for the pins. Reading the last row's bottom puts the limit
 *  exactly at the last place the chip can land.
 *
 *  The bound is FROZEN at drag start via `bounds.current`. Reading the last row's
 *  live rect every frame made the clamp fight the sort strategy: the strategy
 *  displaces that very row while you drag, so the clamp's ceiling moved as the
 *  chip approached it, the chip snapped back, the strategy re-measured — a
 *  feedback loop that showed up as a flicker near the END of the list, where the
 *  last row has been displaced the most. A bound that does not move cannot chase
 *  itself. */
function clampToOwnList(
  ref: React.RefObject<HTMLElement | null>,
  bounds: React.RefObject<{ top: number; bottom: number } | null>,
): Modifier {
  return ({ transform, activeNodeRect }) => {
    if (!activeNodeRect) return transform;
    const box = bounds.current ?? ref.current?.getBoundingClientRect();
    if (!box) return transform;
    return {
      ...transform,
      y: clampToRange(transform.y, box.top, box.bottom, activeNodeRect.top, activeNodeRect.height),
    };
  };
}

export function batchedDragUndo(name: string, restore: () => void): void {
  if (!dragUndoBatch) dragUndoBatch = { names: [], restores: [] };
  // Label dedupes (first-seen order); every restore still replays — a row
  // dropped twice needs both snapshots to walk back correctly.
  if (!dragUndoBatch.names.includes(name)) dragUndoBatch.names.push(name);
  dragUndoBatch.restores.push(restore);
  window.clearTimeout(dragUndoTimer);
  dragUndoTimer = window.setTimeout(() => {
    dragUndoBatch = null;
  }, 5000);
  const run = [...dragUndoBatch.restores];
  const names = dragUndoBatch.names;
  const shown = names.length <= 3 ? names.join("、") : `${names.slice(0, 3).join("、")}等${names.length}項`;
  toastAction(`已移動${shown}`, "復原", () =>
    flipRestore(() => {
      for (const r of run) r();
    })
  );
}

type Props = {
  title: string;
  icon: string;
  tasks: Task[];
  isAccount: boolean;
  /** The section this card renders. Passed rather than derived from `isAccount`,
   *  because "account" holds two schedules (daily and weekly resets), so the
   *  section alone does not name the schedule — the dialog's select still does. */
  section: TaskSection;
  onEditTask?: (t: Task) => void;
  /** Opens the add dialog pre-set to this section. Rendered in the header, so it
   *  stays reachable whether the section is open or folded. */
  onAdd?: (section: TaskSection) => void;
};

export function TrackerSection({ title, icon, tasks, isAccount, section, onEditTask, onAdd }: Props) {
  const char = useAppStore((s) => s.getActiveChar());
  const accountValues = useAppStore((s) => s.accountValues);
  const barterPins = useAppStore((s) => s.barterPins);
  const barterCustomOrder = useAppStore((s) => s.barterCustomOrder);
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
  // The pinned band's fold, per section, remembered per device: see the
  // pref's comment in types.ts for why this is not per character and not synced.
  // Read from the cycle later on; the setter writes both.
  const pinnedCollapsed = useAppStore((s) => s.prefs?.pinnedCollapsed);
  const setPinnedCollapsed = useCallback((cycleName: "daily" | "weekly", value: boolean) => {
    useAppStore.setState((s) => ({ prefs: { ...s.prefs, pinnedCollapsed: { ...s.prefs?.pinnedCollapsed, [cycleName]: value } } }));
  }, []);
  const [hiddenExpanded, setHiddenExpanded] = useState(false);
  // The top-level rows' container: the clamp modifier reads its rect so a chip
  // cannot be dragged visually past the pinned block below it.
  const topListRef = useRef<HTMLDivElement>(null);
  // Frozen at drag start. Must NOT be recomputed during the drag: the sort
  // strategy displaces the last row while the chip approaches it, so a live
  // measurement makes the clamp chase a moving ceiling and the chip snaps.
  const dragBounds = useRef<{ top: number; bottom: number } | null>(null);

  // pinned subtasks, split by cycle: daily-limit pins render under 每日,
  // weekly-limit pins (每週 N 次) under 每週. Either subsection hides
  // entirely when its cycle has no pins. Order is the user's drag order when
  // set, else the canonical order (barter.json file order, then shops.json
  // order, so new pins slot in).
  //
  // Two namespaces: a curated pin resolves through barter.json, a pin on a
  // shops.json row through the catalog. Resolving only the first was what made
  // the gold rows unpinnable — an unknown id was dropped here and rendered
  // nowhere, while still counting toward 已選.
  const barterSubtasks = useMemo(() => {
    const pinned = new Set(barterPins);
    const base = (barterCustomOrder ?? canonicalBarterOrder(barterPins)).filter((id) => pinned.has(id));
    const missing = canonicalBarterOrder(barterPins.filter((id) => !base.includes(id)));
    return [...base, ...missing]
      .map((id) => {
        const b = (barterJson as unknown as Array<(typeof barterJson)[number]>).find((x) => x.id === id);
        if (b) return barterToTask(b);
        const deal = shopDealsByPinId().get(id);
        return deal ? shopDealToTask(deal) : null;
      })
      .filter(Boolean) as Task[];
  }, [barterPins, barterCustomOrder]);

  // account section never shows barter (cycle null → empty list)
  const cycle = tasks[0]?.section === "weekly" ? "weekly" : tasks[0]?.section === "daily" ? "daily" : null;
  const cycleBarter = useMemo(
    () => (cycle === null ? [] as Task[] : barterSubtasks.filter((t) => t.section === cycle)),
    [barterSubtasks, cycle]
  );

  // barter base: manual-hide only. hideCompleted is render-only (below) —
  // progress must not move when the toggle flips. Server-shared rows hide
  // globally (hiddenAccountTaskIds), per-char rows hide per character.
  const barterBase = useMemo(() => {
    if (!char) return cycleBarter;
    return cycleBarter.filter((t) =>
      t.serverShared === true ? !hiddenAccountTaskIds.includes(t.id) : !char.hiddenTaskIds.includes(t.id)
    );
  }, [cycleBarter, char, hiddenAccountTaskIds]);

  const barterSubtasksFiltered = useMemo(() => {
    if (!char) return barterBase;
    let list = barterBase;
    if (hideCompleted) {
      list = list.filter((t) => {
        const v = t.serverShared === true ? accountValues[t.id] : char.taskValues[t.id];
        if (t.type === "check") return !v;
        const n = typeof v === "number" ? v : 0;
        return n < (t.max ?? 0);
      });
    }
    return list;
  }, [barterBase, char, accountValues, hideCompleted]);

  // hidden: dimmed + moved to bottom sub-category (same primitive as 以物易物)
  const hiddenBarter = useMemo(() => {
    if (!char) return [] as Task[];
    return cycleBarter.filter((t) =>
      t.serverShared === true ? hiddenAccountTaskIds.includes(t.id) : char.hiddenTaskIds.includes(t.id)
    );
  }, [cycleBarter, char, hiddenAccountTaskIds]);

  // purple-hole on an off-day parks itself here (render-only auto-hide:
  // no store write, so manual hide state is untouched and the row returns
  // on its own next spawn day). Manual unhide can't pull it back early —
  // the baseTasks filter below wins until isScheduledToday flips.
  // 30s ticker so off-day parking follows the 06:00 bucket rollover with
  // no refresh (same staleness class as the row badges had).
  const now = useNow(30_000);
  const purpleOffDay = useMemo(
    () => tasks.some((t) => t.id === PURPLE_HOLE_ID) && !isScheduledToday(now),
    [tasks, now]
  );
  // Next spawn for the off-day note (absolute date; the row badges carry the countdowns).
  const purpleNext = useMemo(() => (purpleOffDay ? nextBadgeLabel(now) : null), [purpleOffDay, now]);

  const hiddenTasks = useMemo(() => {
    if (!char) return [] as Task[];
    let list = tasks.filter((t) => isHiddenFor(t) || (purpleOffDay && t.id === PURPLE_HOLE_ID));
    list.sort((a, b) => {
      const oa = globalOrder?.[a.id] ?? a.order;
      const ob = globalOrder?.[b.id] ?? b.order;
      return oa - ob;
    });
    return list;
  }, [tasks, char, globalOrder, isHiddenFor, purpleOffDay]);

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
    // off-day purple-hole parks in the hidden bucket (stays out of progress)
    if (purpleOffDay) list = list.filter((t) => t.id !== PURPLE_HOLE_ID);
    return list;
  }, [tasks, globalOrder, char, isHiddenFor, purpleOffDay]);

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
    // Server-shared barter reads the shared pool, everything else the active char.
    const combined = [...baseTasks, ...barterBase];
    return summarizeProgress(combined, (t) =>
      t.serverShared === true ? accountValues[t.id] : (isAccount ? accountValues[t.id] : char?.taskValues[t.id])
    );
  }, [baseTasks, barterBase, char, accountValues, isAccount]);

  // Each list is its own DndContext, so `over` only ever names a row in the SAME
  // list as the dragged row: a top-level row cannot resolve to a pin and vice
  // versa. What the contexts cannot express is section and merchant-group
  // legality WITHIN a list, so that is what dragRules.ts decides.
  const dragTarget = useCallback((id: string): DropTarget | null => {
    const t = allTasks.find((x) => x.id === id);
    if (!t) return null;
    return { id, section: t.section };
  }, [allTasks]);

  const handleDragStart = () => {
    const rows = topListRef.current?.querySelectorAll("[data-task-row]");
    const box = topListRef.current?.getBoundingClientRect();
    if (!box) {
      dragBounds.current = null;
      return;
    }
    // Capture ONCE, before the strategy displaces anything, so the clamp has a
    // ceiling that cannot move with the very geometry it is bounding.
    const last = rows && rows.length > 0 ? rows[rows.length - 1].getBoundingClientRect() : null;
    dragBounds.current = { top: box.top, bottom: last ? last.bottom : box.bottom };
  };

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    dragBounds.current = null;
    if (!over || active.id === over.id) return;
    const a = dragTarget(String(active.id));
    const o = dragTarget(String(over.id));
    if (!a || !o) return;
    if (decideDrop(a, o).kind !== "reorder") return;
    const oldIndex = allTasks.findIndex((t) => t.id === active.id);
    const newIndex = allTasks.findIndex((t) => t.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const newOrder = [...allTasks];
    const [moved] = newOrder.splice(oldIndex, 1);
    newOrder.splice(newIndex, 0, moved);
    // Snapshot for undo: reorder merges into the live maps, so restore the
    // whole slices. Batched across rapid drops — one toast, pre-burst state.
    const s = useAppStore.getState();
    const prev = { customTasks: s.customTasks, globalTaskOrder: s.globalTaskOrder };
    reorder(newOrder.map((t) => t.id));
    batchedDragUndo(moved.name, () =>
      useAppStore.setState({ customTasks: prev.customTasks, globalTaskOrder: prev.globalTaskOrder })
    );
  };

  // The pinned list is a sequence of SLOTS: one band per multi-pin merchant, one
  // row per lone pin. Children live INSIDE a group, so they are not slots, and
  // registering them here let a child drag shift a neighbouring group — and made
  // the band collide with its first child, since both registered one id.
  const pinSlots = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of cycleBarter) {
      const npc = t.npc ?? "其他";
      counts.set(npc, (counts.get(npc) ?? 0) + 1);
    }
    const slotOf = (t: Task) => {
      const npc = t.npc ?? "其他";
      return (counts.get(npc) ?? 0) > 1 ? bandId(npc) : t.id;
    };
    // One entry per slot, in first-seen order, deduped.
    const seen = new Set<string>();
    const slots: string[] = [];
    for (const t of cycleBarter) {
      const s = slotOf(t);
      if (!seen.has(s)) {
        seen.add(s);
        slots.push(s);
      }
    }
    return { slots, slotOf };
  }, [cycleBarter]);

  // The ids ACTUALLY rendered, which is what `SortableContext` must declare. It has
  // to be derived from the FILTERED list, because hiding a pin changes the shape: a
  // two-pin merchant whose other pin is hidden collapses to a lone `TaskRow` (id is
  // the task id), and a fully-hidden merchant renders nothing. Declaring the
  // unfiltered `pinSlots.slots` left dnd-kit holding ids no node registered, so the
  // sorting strategy measured phantom slots. The DRAG WRITE still uses `pinSlots`:
  // the stored order is the full pin order, and flattening a filtered list back into
  // it would drop the hidden pins.
  const renderedSlots = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of barterSubtasksFiltered) {
      const npc = t.npc ?? "其他";
      counts.set(npc, (counts.get(npc) ?? 0) + 1);
    }
    const seen = new Set<string>();
    const slots: string[] = [];
    for (const t of barterSubtasksFiltered) {
      const npc = t.npc ?? "其他";
      const s = (counts.get(npc) ?? 0) > 1 ? bandId(npc) : t.id;
      if (!seen.has(s)) {
        seen.add(s);
        slots.push(s);
      }
    }
    return slots;
  }, [barterSubtasksFiltered]);

  const handleBarterDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    // Only SLOT drags reach this handler. A child drag is resolved inside its own
    // group's nested context (see PinnedGroups), which is what keeps a child in
    // its merchant — and why no cross-group rule is needed here.
    const order = [...pinSlots.slots];
    const from = order.indexOf(String(active.id));
    const to = order.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    const [moved] = order.splice(from, 1);
    order.splice(to, 0, moved);
    // Flatten back to the one flat pin order the rest of the app reads: slots in
    // their new sequence, each contributing its own pins in their existing order.
    const newOrder: Task[] = [];
    for (const slot of order) {
      for (const t of cycleBarter) if (pinSlots.slotOf(t) === slot) newOrder.push(t);
    }
    const prev = useAppStore.getState().barterCustomOrder;
    reorderBarter(newOrder.map((t) => t.id));
    batchedDragUndo("", () => useAppStore.setState({ barterCustomOrder: prev }));
  };

  return (
    <Card className="overflow-hidden -mx-4 rounded-none border-x-0 sm:mx-0 sm:rounded-xl sm:border">
      <CardHeader className="pb-2 px-3 sm:px-6">
        {/* Title row: the collapse toggle takes the space, the add action rides at
            its right. The add button is a SIBLING of the toggle, not inside it, so
            tapping it cannot also fold the section — and it stays visible when the
            section is collapsed, since this row always renders. */}
        <div className="flex items-center gap-2">
          {/* The whole row is the toggle, so the chevron plus the hover fill carry
              the affordance; the old 收合/展開 text was a third signal for the same
              thing and only appeared from `sm` up anyway (mobile never had it).
              `aria-expanded` replaces it where it matters: without it a screen
              reader heard the title and badge but not that this discloses a body. */}
          <button
            onClick={() => setCollapsed((v) => !v)}
            aria-expanded={!collapsed}
            className="flex flex-1 min-w-0 items-center justify-between gap-2 text-left rounded-md -mx-1 px-1 py-1 hover:bg-accent"
          >
            <CardTitle className="flex items-center gap-2 text-base m-0">
              {collapsed ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronUp className="h-4 w-4 text-muted-foreground" />}
              <span className="text-lg">{icon}</span>
              {title}
              <Badge variant="secondary" className="ml-1 font-mono text-xs">
                {done}/{total} · {percent}%
              </Badge>
            </CardTitle>
          </button>
          {onAdd && (
            // Filled primary, matching the original single 新增自訂 button (it used
            // the Button default variant). On a header row full of muted text and a
            // ghost chevron, a filled pill is what makes the action read as one.
            <Button
              size="sm"
              className="h-7 shrink-0 gap-1.5 px-2.5 sm:pr-3 text-xs"
              onClick={() => onAdd(section)}
              aria-label={`新增自訂任務到${title}`}
            >
              <Plus className="h-3 w-3" />
              <span className="hidden sm:inline">新增自訂</span>
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2 mt-2">
          <div className="h-2 flex-1 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} />
          </div>
        </div>
      </CardHeader>
      {collapsed ? (
        <CardContent className="py-3">
          <p className="text-xs text-muted-foreground text-center">已收合 — 點擊上方展開</p>
        </CardContent>
      ) : (
        <CardContent className="space-y-2 px-3 sm:px-6">
        {/* One DndContext per LIST, which is what bounds a drag: `over` can only
            resolve to a droppable inside the active context, so a top-level row
            has no way to reach a pinned row and vice versa — the restriction is
            structural rather than a check that could be forgotten. The 已隱藏
            block sits outside every context, so it is not a drop target at all
            (hiding is the 👁 button's job, not a drag).
            What the contexts do NOT separate is rows within one list, so
            dragRules.ts still decides section and merchant-group legality. */}
        <DndContext
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          modifiers={[clampToOwnList(topListRef, dragBounds)]}
        >
          {/* `space-y-2` lives HERE, on the rows' own wrapper, not only on the
              CardContent above it: this div became a direct child when the clamp
              modifier needed a ref around the rows, and CardContent's space-y-2
              only spaces its DIRECT children — so the rows inside this div lost
              their gap and stacked flush. */}
          <div ref={topListRef} className="space-y-2">
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
          </div>
        </DndContext>

        {/* 以物易物 subtasks as collapsable sub-category (only its own cycle; hides when empty) */}
        {cycle !== null && cycleBarter.length > 0 && (() => {
          // Two pinned sections (daily/weekly) fold independently, and the choice
          // is remembered: it used to be plain useState(true), so every reload
          // reopened a list the user had folded.
          //
          // Optional chain, deliberately: a save written before this field existed
          // carries `prefs` WITHOUT `pinnedCollapsed`, and the v20 step that
          // backfills it only runs when the stored version DIFFERS from the
          // configured one. A save already sitting at v20 skips `migrate`
          // entirely, so the field can still be undefined here and the plain
          // index threw. Reading it as missing degrades to "expanded", which is
          // what an absent pref means, instead of blanking the app.
          const barterExpanded = !pinnedCollapsed?.[cycle];
          return (
          // bleed band: wrapper stretches past the rows (-mx-2) so rows stay
          // pixel-equal to top-level items; header is w-full in the same box
          <div className="-mx-2 rounded-xl px-2 py-2 bg-emerald-500/10 dark:bg-emerald-400/[0.12]">
            <button
              onClick={() => setPinnedCollapsed(cycle, barterExpanded)}
              aria-expanded={barterExpanded}
              className="flex w-full items-center gap-2 px-[5px] py-2.5 text-left rounded-md hover:bg-accent"
            >
              <span className="h-4 w-1 rounded-full shrink-0 bg-emerald-500" />
              <span className="text-base">🔄</span>
              <span className="text-sm font-medium">{cycle === "weekly" ? "每週商店 / 以物易物 已釘選" : "商店 / 以物易物 已釘選"}</span>
              <Tooltip content="釘選對所有角色生效">
                <Badge className="text-[10px] text-white bg-emerald-600">
                  {barterSubtasksFiltered.length}/{cycleBarter.length}
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
                  // Pinned rows are grouped by merchant: one collapsible parent per
                  // NPC holding that NPC's pins, a lone pin left as a plain row. The
                  // group grip drags by its first child's id, so the existing
                  // reorder handler orders groups without change.
                  <DndContext collisionDetection={closestCenter} onDragEnd={handleBarterDragEnd}>
                    <SortableContext items={renderedSlots} strategy={verticalListSortingStrategy}>
                      <PinnedGroups
                        rows={barterSubtasksFiltered.map((bt) => ({
                          task: bt,
                          value: bt.serverShared === true ? accountValues[bt.id] : char?.taskValues[bt.id],
                          isAccount: bt.serverShared === true,
                        }))}
                      />
                    </SortableContext>
                  </DndContext>
                )}
                {cycleBarter.length !== barterSubtasksFiltered.length && (
                  <p className="text-[11px] text-muted-foreground text-center">
                    已隱藏 {cycleBarter.length - barterSubtasksFiltered.length} 項（完成或手動隱藏）
                  </p>
                )}
              </div>
            )}
          </div>
          );
        })()}

        {/* 已隱藏項目 — same primitive, dimmed + bottom, undo via Eye */}
        {hiddenAll.length > 0 && (
          <div className="-mx-2 rounded-xl px-2 py-2 bg-zinc-500/10 dark:bg-zinc-400/10">
            <button
              onClick={() => setHiddenExpanded((v) => !v)}
              className="flex w-full items-center gap-2 px-[5px] py-2.5 text-left rounded-md hover:bg-accent"
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
              // Deliberately NOT inside a SortableContext: a hidden row is out
              // of the reorderable list, so it is neither draggable nor a drop
              // target. Un-hiding is the 👁 button, which says so out loud.
              <div className="space-y-2">
                {hiddenTasks.map((t) => (
                  <div key={t.id} className="opacity-60">
                    {purpleOffDay && t.id === PURPLE_HOLE_ID && !isHiddenFor(t) && (
                      <p className="text-[11px] text-muted-foreground mb-1 px-1">非出沒日{purpleNext ? ` — 下次${purpleNext}` : ""}，出沒時會自動移回上方</p>
                    )}
                    <TaskRow task={t} value={isAccount ? accountValues[t.id] : char?.taskValues[t.id]} isAccount={isAccount} onEdit={t.source === "custom" ? () => onEditTask?.(t) : undefined} />
                  </div>
                ))}
                {hiddenBarter.map((bt) => (
                  <div key={bt.id} className="opacity-60">
                    <TaskRow
                      task={bt}
                      value={bt.serverShared === true ? accountValues[bt.id] : char?.taskValues[bt.id]}
                      isAccount={bt.serverShared === true}
                    />
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
