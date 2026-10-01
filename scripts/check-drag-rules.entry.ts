/* eslint-disable no-console */
// The drag rules: the section boundary, the band id, and the chip clamp.
// Pure function tests (no DOM, no store, no dnd-kit), so this runs in the pnpm
// check gate like the other entry scripts.
//
// Most of the hierarchy is NOT tested here because it is structural rather than
// decision: a drag's reach is bounded by its DndContext, so a top-level row
// cannot reach a pinned row, nothing can reach 已隱藏, and a pinned child cannot
// reach another merchant's group (each open group renders its own nested
// context). Those are enforced by what is rendered, not by a function.
//
// What IS a decision, and tested below:
//   1. a row cannot cross sections (每日 ↔ 每週 shares one context)
//   2. a band has its own id, so it cannot collide with a child's row id
//   3. the dragged chip is clamped to its own list's vertical range
import { decideDrop, groupKey, bandId, bandNpc, clampToRange, type DropTarget } from "@/lib/dragRules";

let bad = 0;
const ok = (msg: string) => console.log(`ok: ${msg}`);
const fail = (msg: string) => {
  bad += 1;
  console.log(`FAIL: ${msg}`);
};
const expect = (cond: boolean, msg: string) => (cond ? ok(msg) : fail(msg));

const t = (id: string, section: string): DropTarget => ({ id, section });

// --- 1. sections are sealed --------------------------------------------------
{
  const d = decideDrop(t("d1", "daily"), t("w1", "weekly"));
  expect(d.kind === "reject" && d.reason === "cross-section", "a daily row dropped on a weekly row is refused");

  const same = decideDrop(t("d1", "daily"), t("d2", "daily"));
  expect(same.kind === "reorder", "a daily row on another daily row reorders");

  const account = decideDrop(t("a1", "account"), t("a2", "account"));
  expect(account.kind === "reorder", "account rows reorder among themselves");

  const self = decideDrop(t("d1", "daily"), t("d1", "daily"));
  expect(self.kind === "reject" && self.reason === "same-row", "a row dropped on itself is a no-op");
}

// --- 2. the band id is its own, never a child's ------------------------------
{
  expect(bandId("凱琳") === "pin-group::凱琳", "bandId is namespaced");
  expect(bandNpc("pin-group::凱琳") === "凱琳", "bandNpc round-trips");
  expect(bandNpc("yen-凱琳合金鋼錠2特殊鋼錠-3") === null, "a real pin id is not a band");
  // The regression: the band used to drag as `first.id`, i.e. a real pin id, so
  // the band and that child's row registered ONE id between them.
  const realPinIds = ["tir-f3", "dug-t2", "yen-奈麗絲銅礦石高級生皮-7"];
  expect(
    realPinIds.every((id) => bandNpc(id) === null && id !== bandId("凱琳")),
    "a band id can never equal a real pin id",
  );
}

// --- 3. the chip is clamped to its own list ---------------------------------
{
  // A list spanning y 100..400, dragging a 60px row that starts at y 150.
  const LIST_TOP = 100;
  const LIST_BOTTOM = 400;
  const ROW_TOP = 150;
  const ROW_H = 60;

  // Dragging above the list: the chip stops at the top edge.
  expect(clampToRange(-500, LIST_TOP, LIST_BOTTOM, ROW_TOP, ROW_H) === -50, "a chip dragged above stops at the list top");
  // Dragging below: it stops with the row's BOTTOM at the list's bottom, so the
  // chip cannot float past the last row.
  expect(clampToRange(9999, LIST_TOP, LIST_BOTTOM, ROW_TOP, ROW_H) === 190, "a chip dragged below stops at the list bottom");
  // Inside the range, the value passes through untouched.
  expect(clampToRange(80, LIST_TOP, LIST_BOTTOM, ROW_TOP, ROW_H) === 80, "a chip inside its list moves freely");

  // A list shorter than the row cannot clamp; the value is left alone rather
  // than producing an inverted range.
  expect(clampToRange(42, 100, 120, 150, 60) === 42, "a too-short list leaves the value alone");

  // The clamp is exactly the boundary case: the chip can reach the last row.
  const atEnd = clampToRange(190, LIST_TOP, LIST_BOTTOM, ROW_TOP, ROW_H);
  expect(atEnd === 190, "a chip can still reach the end of its own list");
}

console.log(bad === 0 ? "drag rules: all pass" : `drag rules: ${bad} FAILED`);
process.exit(bad === 0 ? 0 : 1);
