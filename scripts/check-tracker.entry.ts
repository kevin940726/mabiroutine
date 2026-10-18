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
import {
  BLACK_HOLE_DAILY_ID,
  BLACK_HOLE_ID,
  blackHoleDec,
  blackHolePairForResolved,
  blackHoleState,
  blackHoleTap,
  blackHoleX,
} from "@/lib/blackHole";
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

// 5. the 黑色坑洞 pair + its state math. The week row stores the carryable bank
//    (max 7); the daily row is the nudge; the derived state puts the game's one
//    combined number on the tile and only completes on Sunday. Fixtures are the
//    plan's §2.2 worked examples (docs/plans/black-hole-row.md).
const bh = byId.get(BLACK_HOLE_ID);
const bhd = byId.get(BLACK_HOLE_DAILY_ID);
assert(bh?.section === "weekly" && bh.type === "countdown" && bh.max === 7, "black-hole is the weekly countdown with max 7 (the stored bank)");
assert(bhd?.section === "daily" && bhd.kind === "daily" && bhd.type === "check", "black-hole-daily is the daily check");

// Taipei wall time → UTC ms (UTC+8, no DST).
const tw = (y: number, mo: number, d: number, h: number, mi = 0) => Date.UTC(y, mo - 1, d, h - 8, mi, 0);
const MON = tw(2026, 10, 19, 6); // Mon 06:00
const MON_EVE = tw(2026, 10, 19, 5, 59); // still the old week
const TUE = tw(2026, 10, 20, 6);
const SUN_EVE = tw(2026, 10, 25, 5, 59); // Saturday's daily still live
const SUN = tw(2026, 10, 25, 6);

const st = (bank: number, today: number, now: number) => blackHoleState(bank, today, new Date(now));
{
  const s = st(0, 0, MON);
  assert(s.x === 6 && s.elapsed === 0 && s.resolved === 0 && s.remaining === 8 && !s.done, "Mon 06:00, nothing used: x 6, resolved 0, R 8, not done");
}
{
  const s = st(7, 1, MON);
  assert(s.resolved === 8 && s.remaining === 0 && !s.done, "Mon, all 8 available used: resolved 8/14, R 0, not done");
}
{
  const s = st(7, 0, TUE);
  assert(s.x === 5 && s.elapsed === 1 && s.resolved === 8 && s.remaining === 1, "Tue 06:00: the passed daily adds elapsed, R 1");
}
{
  const s = st(7, 1, TUE);
  assert(s.resolved === 9 && s.remaining === 0, "Tue's daily logged: resolved 9");
}
{
  const s = st(7, 1, SUN);
  assert(s.x === 0 && s.elapsed === 6 && s.resolved === 14 && s.remaining === 0 && s.done, "Sun, bank 7 + today: resolved 14/14, done");
}
{
  const s = st(0, 1, SUN);
  assert(s.resolved === 7 && !s.done, "a daily-only week ends at 7/14 and never completes");
}
{
  const s = st(0, 0, SUN);
  assert(s.resolved === 6 && s.remaining === 8 && !s.done, "nothing logged all week: the date supplies 6/14");
}
{
  const s = st(0, 0, MON_EVE);
  assert(s.x === 0 && s.elapsed === 6, "before Monday 06:00 the old week's last daily is still live (x 0)");
}
{
  const s = st(0, 0, SUN_EVE);
  assert(s.x === 1 && s.elapsed === 5, "Sunday before 06:00 still has the Sunday reset ahead (x 1)");
}
{
  const s = st(14, 0, MON);
  assert(s.bank === 7 && s.resolved === 7 && s.remaining === 1, "an old raw 14 clamps to bank 7 (content-only max)");
}
// the tile's clamp is the resolved axis [elapsed, elapsed + 8]
{
  const mon = st(0, 0, MON);
  const sun = st(0, 0, SUN);
  assert(mon.resolvedMin === 0 && mon.resolvedMax === 8, "Monday's resolved bounds are 0..8");
  assert(sun.resolvedMin === 6 && sun.resolvedMax === 14, "Sunday's resolved bounds are 6..14");
}
// the sync round-trip: every R lands a pair whose R is that R, bank in 0..7
for (const now of [MON_EVE, MON, TUE, SUN_EVE, SUN]) {
  const x = blackHoleX(new Date(now));
  for (let r = 0; r <= 8; r++) {
    const p = blackHolePairForResolved(14 - x - r, false, new Date(now));
    const s = blackHoleState(p.bank, p.today, new Date(now));
    assert(s.remaining === r, `sync round-trip: R ${r} (x ${x}) lands R ${s.remaining}`);
    assert(p.bank >= 0 && p.bank <= 7, `sync pair bank stays in 0..7 (R ${r}: ${p.bank})`);
  }
}
// …and with the daily already logged the pair keeps it (a sync must not move a
// daily the user has ticked). used = 8 - r >= 1 → r 1..7.
for (const now of [MON_EVE, MON, TUE, SUN_EVE, SUN]) {
  const x = blackHoleX(new Date(now));
  for (let r = 1; r <= 7; r++) {
    const p = blackHolePairForResolved(14 - x - r, true, new Date(now));
    assert(p.today === true, `sync with a logged daily keeps today (R ${r}, x ${x})`);
    assert(blackHoleState(p.bank, p.today, new Date(now)).remaining === r, `…and still lands R ${r}`);
    assert(p.bank >= 0 && p.bank <= 7, `…with bank in 0..7 (R ${r}: ${p.bank})`);
  }
}
// a target below the day's floor clamps to the floor (elapsed only)
{
  const p = blackHolePairForResolved(0, true, MON);
  assert(p.bank === 0 && p.today === false, "a below-floor target on Monday lands 0/14");
  const q = blackHolePairForResolved(0, true, SUN);
  const s = blackHoleState(q.bank, q.today, new Date(SUN));
  assert(s.resolved === 6 && q.today === false, "a below-floor target on Sunday lands 6/14 (elapsed only)");
}
// done only at resolved = 14
for (const now of [MON, TUE, SUN]) {
  for (let bank = 0; bank <= 7; bank++) {
    for (const today of [0, 1]) {
      const s = st(bank, today, now);
      assert(s.done === (s.resolved === 14), `done only at 14 (bank ${bank}, today ${today}, resolved ${s.resolved})`);
      assert(s.resolved >= s.resolvedMin && s.resolved <= s.resolvedMax, `resolved inside its bounds (${s.resolved} in ${s.resolvedMin}..${s.resolvedMax})`);
    }
  }
}
// the tap / dec rules (daily first, then the bank)
assert(blackHoleTap(0, 0)?.today === true, "a tap on an unused day uses the daily first");
assert(blackHoleTap(3, 1)?.bank === 4, "a tap after the daily uses the bank");
assert(blackHoleTap(7, 1) === null, "a tap at bank 7 + daily used is a no-op, never a reset");
assert(blackHoleDec(2, 1)?.bank === 1, "a −1 correction undoes the bank first");
assert(blackHoleDec(0, 1)?.today === false, "a −1 correction at bank 0 clears the daily");
assert(blackHoleDec(0, 0) === null, "a −1 correction at zero is a no-op");

console.log("\ntracker.json gate passed.");
