// The sub-quest link (Task.subTasks) resolved from the shipped data, apart from
// the components that draw it. Pure, like pinGroup.ts: no store, no React.
//
// A sub-task is a REAL tracker row (own id, value, max, bucket, sync key) and the
// parent's `subTasks` array is the single link. The list-dropping callers
// (section lists, the overall denominator, the celebration roster) and the rows
// that render children all read the same set from here.
import trackerJson from "@/data/tracker.json";
import type { Task } from "@/lib/types";

const BUILTINS = trackerJson as Task[];

const BY_ID = new Map(BUILTINS.map((t) => [t.id, t]));
const CHILDREN_OF = new Map<string, string[]>();
const PARENT_OF = new Map<string, string>();
for (const t of BUILTINS) {
  for (const child of t.subTasks ?? []) {
    CHILDREN_OF.set(t.id, [...(CHILDREN_OF.get(t.id) ?? []), child]);
    PARENT_OF.set(child, t.id);
  }
}

/** The child ids of a task, in data order (empty for everything else). */
export function subTaskIds(taskId: string): string[] {
  return CHILDREN_OF.get(taskId) ?? [];
}

/** True when the id is a task that renders INSIDE another row, never on its own. */
export function isSubTaskId(id: string): boolean {
  return PARENT_OF.has(id);
}

/** Drop every sub-task from a list of rows (section lists / denominators). */
export function topLevelTasks(tasks: Task[]): Task[] {
  return tasks.filter((t) => !isSubTaskId(t.id));
}

/** The child rows themselves, in data order (unknown ids are skipped). */
export function resolveSubTasks(task: Task): Task[] {
  return subTaskIds(task.id)
    .map((id) => BY_ID.get(id))
    .filter((t): t is Task => t !== undefined);
}

/** How a sub-task is labelled inside its parent's body: the row's own name with
 *  the 通關 verb dropped (`通關深層地下城` → `深層地下城`). Display-only, like
 *  `displayName` in materials.ts: nothing is looked up by this string, and the
 *  full name stays on the row (and in the tile's aria-label). */
export function subTaskLabel(task: Task): string {
  return task.name.replace(/^通關/, "");
}
