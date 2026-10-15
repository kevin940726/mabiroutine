// tracker.json gate (bundled + run by scripts/check-tracker.mjs).
//
// tracker.json is hand-edited (docs/tracker-data.md), so the failure mode is a
// typo or a half-applied edit — and it is SILENT in the app: a broken `subTasks`
// link simply renders no child row, a duplicate id steals another row's progress,
// a check with a max reads as an unbounded counter. These assertions are the
// structural half of that data contract; the store's version steps are the other
// half (scripts/migration-check.entry.ts).
import trackerJson from "@/data/tracker.json";
import { isSubTaskId, resolveSubTasks, subTaskIds, subTaskLabel } from "@/lib/subTasks";
import type { Task } from "@/lib/types";

const rows = trackerJson as Task[];

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`ok: ${msg}`);
}

const byId = new Map<string, Task>();
const seen = new Map<string, number>();
for (const r of rows) {
  seen.set(r.id, (seen.get(r.id) ?? 0) + 1);
  byId.set(r.id, r);
}
const dupes = [...seen].filter(([, n]) => n > 1).map(([id]) => id);
assert(rows.length > 0, "tracker.json is not empty");
assert(dupes.length === 0, `ids unique file-wide (dupes: ${dupes.join(", ") || "none"})`);

const SECTIONS = ["daily", "weekly", "account"];
const KINDS = ["daily", "weekly", "account-daily", "account-weekly"];
const TYPES = ["check", "counter", "countdown"];
const SOURCES = ["builtin", "barter", "shop", "custom"];

// 1. row shape + the max rules (no max on a check; a counter/countdown max is >= 1
//    when present; a counter may omit it = unbounded, only weekly-goals does).
for (const r of rows) {
  assert(typeof r.id === "string" && r.id.length > 0, "row id is a non-empty string");
  assert(typeof r.name === "string" && r.name.length > 0, `${r.id}: name`);
  assert(typeof r.icon === "string" && r.icon.length > 0, `${r.id}: icon`);
  assert(SECTIONS.includes(r.section), `${r.id}: section`);
  assert(KINDS.includes(r.kind), `${r.id}: kind`);
  assert(TYPES.includes(r.type), `${r.id}: type`);
  assert(SOURCES.includes(r.source), `${r.id}: source`);
  assert(typeof r.order === "number" && Number.isFinite(r.order), `${r.id}: order`);
  if (r.type === "check") {
    assert(r.max === undefined, `${r.id}: a check carries no max`);
  } else if (r.max !== undefined) {
    assert(typeof r.max === "number" && Number.isFinite(r.max) && r.max >= 1, `${r.id}: max >= 1 when present`);
  } else {
    assert(r.type === "counter", `${r.id}: only a counter may omit max (unbounded)`);
  }
}

// 2. sub-task links: every child exists, keeps the parent's prefix, matches the
//    parent's section/kind, is a bounded counter whose in-body label (name minus
//    the 通關 verb) is non-empty and unique among its siblings, and has exactly
//    one parent.
const parentCount = new Map<string, number>();
for (const r of rows) {
  const kids = r.subTasks ?? [];
  if (kids.length === 0) continue;
  assert(r.type === "counter", `${r.id}: a grouped parent is a counter`);
  assert(r.max === undefined, `${r.id}: a grouped parent is unbounded (no max)`);
  assert(new Set(kids).size === kids.length, `${r.id}: subTasks has no duplicate ids`);
  const labels = new Set<string>();
  for (const childId of kids) {
    const child = byId.get(childId);
    assert(child !== undefined, `${r.id}: subTasks id exists: ${childId}`);
    if (!child) continue;
    assert(child.section === r.section, `${childId}: child section matches its parent`);
    assert(child.kind === r.kind, `${childId}: child kind matches its parent`);
    assert(child.type === "counter" && typeof child.max === "number" && child.max >= 1, `${childId}: a sub-counter is a bounded counter`);
    assert(childId.startsWith(`${r.id}-`), `${childId}: child id keeps the parent's prefix`);
    const label = subTaskLabel(child);
    assert(label.length > 0, `${childId}: label is non-empty`);
    assert(!labels.has(label), `${childId}: label is unique among its siblings`);
    labels.add(label);
    parentCount.set(childId, (parentCount.get(childId) ?? 0) + 1);
  }
}
for (const [id, n] of parentCount) assert(n === 1, `${id}: exactly one parent`);
for (const id of parentCount.keys()) {
  assert((byId.get(id)?.subTasks ?? []).length === 0, `${id}: a sub-task has no sub-tasks of its own`);
}

// 3. the helpers the UI/store read must agree with the file.
for (const r of rows) {
  assert(subTaskIds(r.id).length === (r.subTasks ?? []).length, `${r.id}: subTaskIds agrees`);
  assert(resolveSubTasks(r).length === (r.subTasks ?? []).length, `${r.id}: resolveSubTasks resolves every link`);
  assert(isSubTaskId(r.id) === parentCount.has(r.id), `${r.id}: isSubTaskId agrees`);
}

// 4. the feature that introduced the link (weekly-goals): the ids the store's v22
//    step and GoalGroup name exist, and the parent has exactly its three kids.
const wg = byId.get("weekly-goals");
assert(wg !== undefined, "weekly-goals exists (the store's v22 step names it)");
assert(subTaskIds("weekly-goals").length === 3, "weekly-goals has its three sub-counters");

console.log("\ntracker.json gate passed.");
