// Migration fixture test (bundled + run by scripts/check-migrations.mjs).
// Feeds synthetic old payloads through the REAL migratePersisted and asserts.
// Storage stub must exist before the store module loads (zustand persist
// rehydrates on import), hence dynamic import below.
const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
};

import trackerJson from "@/data/tracker.json";
import barterJson from "@/data/barter.json";
import defaultPinsJson from "@/data/defaultPins.json";
const { migratePersisted } = await import("@/store/useAppStore");

type AnyRec = Record<string, unknown>;
function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`ok: ${msg}`);
}

const trackerIds = new Set((trackerJson as { id: string }[]).map((t) => t.id));
// default pins come from the hand-owned defaultPins.json (sanitized like the store)
const mustIds = [...new Set((defaultPinsJson.pins ?? []) as string[])].filter((id) =>
  (barterJson as { id: string }[]).some((b) => b.id === id)
);
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

// A: versionless ancient save -> full chain to v9 with seeded defaults
{
  const out = migratePersisted({}, 0) as AnyRec;
  assert(out.version === 12, "A: versionless reaches v12");
  const chars = out.characters as AnyRec[];
  assert(chars.length === 1 && typeof chars[0].id === "string", "A: one default character");
  assert(sameSet(out.barterPins as string[], mustIds), "A: must pins seeded");
  assert((out.prefs as AnyRec).hideCompleted === false, "A: prefs defaulted");
  assert(JSON.stringify(out.barterFilters) === JSON.stringify({ priority: "all", town: "all", skill: "all", onlyPinned: false }), "A: filters defaulted");
}

// B: v4-era save with synthetic barter- ids + removed tracker id
{
  assert(!trackerIds.has("hunt"), "B premise: hunt removed from tracker.json (update fixture if re-added)");
  const out = migratePersisted(
    {
      version: 4,
      characters: [{ id: "c1", name: "A", taskValues: { tower: 5, hunt: true }, hiddenTaskIds: ["hunt"] }],
      activeCharId: "c1",
      barterPins: ["barter-001"],
      isBarterForked: false,
    },
    4
  ) as AnyRec;
  assert(out.version === 12, "B: reaches v12");
  assert(!(out.barterPins as string[]).some((id) => id.startsWith("barter-")), "B: synthetic pins gone");
  assert(sameSet(out.barterPins as string[], mustIds), "B: pins reseeded to must");
  const c = (out.characters as AnyRec[])[0] as AnyRec;
  assert((c.taskValues as AnyRec).tower === 5, "B: surviving counter value kept");
  assert(!("hunt" in (c.taskValues as AnyRec)), "B: removed id pruned from taskValues");
  assert(!(c.hiddenTaskIds as string[]).includes("hunt"), "B: removed id pruned from hiddenTaskIds");
}

// C: current-shape v9 payload passes through with values intact
{
  const input = {
    version: 9,
    characters: [{ id: "c9", name: "Z", taskValues: { barrier: 7, custom1: true }, hiddenTaskIds: ["custom1"] }],
    activeCharId: "c9",
    accountValues: { "acc-silver": true },
    barterPins: [...mustIds],
    isBarterForked: false,
    customTasks: [{ id: "custom1" }],
    prefs: { hideCompleted: true },
  };
  const out = migratePersisted(structuredClone(input), 9) as AnyRec;
  assert(out.version === 12, "C: reaches v12");
  const c = (out.characters as AnyRec[])[0] as AnyRec;
  assert((c.taskValues as AnyRec).barrier === 7, "C: counter kept");
  assert((c.hiddenTaskIds as string[]).includes("custom1"), "C: custom hidden kept (custom ids are valid)");
  assert((out.accountValues as AnyRec)["acc-silver"] === true, "C: account value kept");
  assert((out.prefs as AnyRec).hideCompleted === true, "C: prefs kept");
  assert(sameSet(out.barterPins as string[], mustIds), "C: pins kept");
}

// D: dangling account/global-order keys pruned, live ones kept
{
  assert(trackerIds.has("acc-silver"), "D premise: acc-silver exists (update fixture if removed)");
  const out = migratePersisted(
    {
      version: 5,
      characters: [{ id: "c1", name: "A", taskValues: {}, hiddenTaskIds: [] }],
      activeCharId: "c1",
      accountValues: { "acc-silver": true, "gone-xyz": true },
      globalTaskOrder: { "acc-silver": 1, "gone-xyz": 2 },
    },
    5
  ) as AnyRec;
  assert((out.accountValues as AnyRec)["acc-silver"] === true, "D: live account key kept");
  assert(!("gone-xyz" in (out.accountValues as AnyRec)), "D: dangling account key pruned");
  assert(!("gone-xyz" in (out.globalTaskOrder as AnyRec)), "D: dangling order key pruned");
}

// E: v6 forked save -> fork model gone, pins reset to must, progress kept
{
  const out = migratePersisted(
    {
      version: 6,
      characters: [{ id: "c1", name: "A", taskValues: { tower: 3 }, hiddenTaskIds: [] }],
      activeCharId: "c1",
      barterPins: ["tir-e1"],
      barterPinsByChar: { c1: ["tir-e1", "dug-x1"] },
      isBarterForked: true,
    },
    6
  ) as AnyRec;
  assert(out.version === 12, "E: reaches v12");
  assert(sameSet(out.barterPins as string[], mustIds), "E: pins reset to must defaults");
  assert(!("barterPinsByChar" in out), "E: fork container dropped");
  assert(!("isBarterForked" in out), "E: fork flag dropped");
  const c = (out.characters as AnyRec[])[0] as AnyRec;
  assert((c.taskValues as AnyRec).tower === 3, "E: progress values untouched");
}

// F: v7 save with filters incl. stale town + legacy search text -> sanitized
{
  const liveTown = (barterJson as AnyRec[])[0].town as string;
  assert(typeof liveTown === "string" && liveTown.length > 0, "F premise: barter.json has towns");
  const out = migratePersisted(
    {
      version: 7,
      characters: [{ id: "c1", name: "A", taskValues: {}, hiddenTaskIds: [] }],
      activeCharId: "c1",
      barterFilters: { q: "皮革", priority: "must", town: "不存在的城鎮", skill: "all", onlyPinned: true },
    },
    7
  ) as AnyRec;
  assert(out.version === 12, "F: reaches v12");
  const f = out.barterFilters as AnyRec;
  assert(f.priority === "must" && f.onlyPinned === true, "F: live filter values kept");
  assert(f.town === "all", "F: stale town reset to all");
  assert(!("q" in f), "F: search text dropped (session-only)");
}

// G: v9 save with an account id hidden per-char -> moved to the global list
{
  assert(trackerIds.has("acc-silver") && trackerIds.has("parttime"), "G premise: acc-silver + parttime exist (update fixture if removed)");
  const out = migratePersisted(
    {
      version: 9,
      characters: [
        { id: "c1", name: "A", taskValues: {}, hiddenTaskIds: ["acc-silver", "parttime"] },
        { id: "c2", name: "B", taskValues: {}, hiddenTaskIds: ["acc-silver"] },
      ],
      activeCharId: "c1",
    },
    9
  ) as AnyRec;
  assert(out.version === 12, "G: reaches v12");
  assert(sameSet(out.hiddenAccountTaskIds as string[], ["acc-silver"]), "G: account hide moved global");
  const [g1, g2] = out.characters as AnyRec[];
  assert(sameSet(g1.hiddenTaskIds as string[], ["parttime"]), "G: daily hide stays per-char");
  assert(sameSet(g2.hiddenTaskIds as string[], []), "G: account id stripped from char list");
}

// G2: v10 save (runs the v11 tower step as a no-op) with a global account hide passes through untouched
{
  const input = {
    version: 10, // v10 input: exercises the v11 step
    characters: [{ id: "c1", name: "A", taskValues: {}, hiddenTaskIds: [] }],
    activeCharId: "c1",
    hiddenAccountTaskIds: ["acc-silver"],
  };
  const out = migratePersisted(structuredClone(input), 10) as AnyRec;
  assert(out.version === 12, "G2: reaches v12");
  assert(sameSet(out.hiddenAccountTaskIds as string[], ["acc-silver"]), "G2: global hide kept");
}

// H: v10 save with boolean tower (check era) -> carried as 1, numbers kept
{
  const out = migratePersisted(
    {
      version: 10,
      characters: [
        { id: "c1", name: "A", taskValues: { tower: true }, hiddenTaskIds: [] },
        { id: "c2", name: "B", taskValues: { tower: 5 }, hiddenTaskIds: [] },
        { id: "c3", name: "C", taskValues: {}, hiddenTaskIds: [] },
      ],
      activeCharId: "c1",
    },
    10
  ) as AnyRec;
  assert(out.version === 12, "H: reaches v12");
  const [h1, h2, h3] = out.characters as AnyRec[];
  assert((h1.taskValues as AnyRec).tower === 20, "H: checked tower carried as 20");
  assert((h2.taskValues as AnyRec).tower === 5, "H: numeric tower untouched");
  assert(!("tower" in (h3.taskValues as AnyRec)), "H: missing tower stays missing");
}

// I: v11 save with timeGated custom + parttime counts -> retired cleanly
{
  const out = migratePersisted(
    {
      version: 11,
      characters: [
        { id: "c1", name: "A", taskValues: { parttime: 2, barrier: 3, "daily-challenge": 10, "weekly-challenge": 11 }, hiddenTaskIds: [] },
        { id: "c2", name: "B", taskValues: { parttime: 1 }, hiddenTaskIds: [] },
        { id: "c3", name: "C", taskValues: { parttime: 0 }, hiddenTaskIds: [] },
      ],
      activeCharId: "c1",
      customTasks: [{ id: "custom1", name: "X", timeGated: "06:00,18:00", notes: "keep" }],
    },
    11
  ) as AnyRec;
  assert(out.version === 12, "I: reaches v12");
  const customs = out.customTasks as AnyRec[];
  assert(!("timeGated" in customs[0]), "I: timeGated stripped from custom task");
  assert(customs[0].notes === "keep", "I: other custom fields kept");
  const [i1, i2, i3] = out.characters as AnyRec[];
  assert((i1.taskValues as AnyRec).parttime === true, "I: parttime 2 carried as checked");
  assert((i2.taskValues as AnyRec).parttime === true, "I: parttime 1 carried as checked");
  assert((i3.taskValues as AnyRec).parttime === 0, "I: parttime 0 stays unchecked");
  assert((i1.taskValues as AnyRec).barrier === 3, "I: unrelated progress kept");
  assert((i1.taskValues as AnyRec)["daily-challenge"] === 8, "I: over-max daily count capped");
  assert((i1.taskValues as AnyRec)["weekly-challenge"] === 9, "I: over-max weekly count capped");
}

console.log("\nAll migration fixtures passed.");
