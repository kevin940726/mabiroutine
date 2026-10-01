// Which drops a row may accept, and what a drop means.
//
// Pure, like pinGroup.ts: no store, no React, no dnd-kit. The drag handlers and
// the tests both call these, so the rules are stated once.
//
// MOST OF THE HIERARCHY IS STRUCTURE, NOT CODE HERE. A drag's reach is bounded by
// its DndContext: `over` can only resolve to a droppable in the ACTIVE context,
// so these are impossible by construction and need no check —
//   * a top-level row reaching a pinned row (separate contexts)
//   * anything reaching the 已隱藏 block (outside every context)
//   * a pinned child reaching another merchant's group (each OPEN group renders
//     its own nested context, holding only its own children)
//
// What is left for this module is the one boundary a context cannot express: a
// task's SECTION is a property of the task, not a position in a list, yet 每日 and
// 每週 rows share one context when a section renders both. So a cross-section drop
// has to be refused by a rule rather than prevented by a boundary.

/** A drag target as the handler sees it: the id dnd-kit resolved, plus enough
 *  context to say which section it belongs to. */
export type DropTarget = {
  id: string;
  /** The task's own section, from the data. */
  section: string;
};

export type DropDecision =
  /** Reorder within the same list. */
  | { kind: "reorder" }
  /** Not a legal drop; the row springs back. */
  | { kind: "reject"; reason: string };

/**
 * Decide what a drop from `active` onto `over` means.
 *
 * Both rows are already known to be in the same list, because dnd-kit resolved
 * `over` inside the active context.
 */
export function decideDrop(active: DropTarget, over: DropTarget): DropDecision {
  if (active.id === over.id) return { kind: "reject", reason: "same-row" };

  // A task's section is fixed, so a cross-section drop is refused rather than
  // reinterpreted.
  if (active.section !== over.section) {
    return { kind: "reject", reason: "cross-section" };
  }

  return { kind: "reorder" };
}

/**
 * The id a merchant group's BAND drags by.
 *
 * It must be its own id, NOT the first child's: the band used to drag as
 * `first.id`, which the first child's row registers too (both call useSortable
 * with that id), and one id on two nodes breaks the sort maths — the child
 * dragged the parent, and a drop snapped back.
 *
 * Namespaced so it can never collide with a real pin id.
 */
export function bandId(npc: string): string {
  return `pin-group::${npc}`;
}

/** The reverse: the merchant named by a band id, or null if the id is a real pin. */
export function bandNpc(id: string): string | null {
  return id.startsWith("pin-group::") ? id.slice("pin-group::".length) : null;
}

/**
 * Clamp a drag's vertical travel to the list it started in.
 *
 * The DROP was already right — `over` cannot resolve outside the active context,
 * so a row dragged past the pinned block lands at the end of its OWN list. What
 * was wrong is the visual: the chip followed the pointer down over the pinned
 * block, which reads as "this will land down there". Clamping makes the chip stop
 * at the boundary, so the gesture says what it does.
 *
 * Pure and dnd-kit-free, so it can be tested directly.
 */
export function clampToRange(
  y: number,
  listTop: number,
  listBottom: number,
  draggedTop: number,
  draggedHeight: number,
): number {
  const minY = listTop - draggedTop;
  const maxY = listBottom - (draggedTop + draggedHeight);
  // A list shorter than the dragged row cannot clamp meaningfully; leave the
  // value alone rather than return an inverted range.
  if (minY > maxY) return y;
  return Math.min(Math.max(y, minY), maxY);
}
