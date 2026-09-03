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
  assert(out.version === 10, "A: versionless reaches v10");
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
  assert(out.version === 10, "B: reaches v10");
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
  assert(out.version === 10, "C: stays v10");
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
  assert(out.version === 10, "E: reaches v10");
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
  assert(out.version === 10, "F: reaches v10");
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
  assert(out.version === 10, "G: reaches v10");
  assert(sameSet(out.hiddenAccountTaskIds as string[], ["acc-silver"]), "G: account hide moved global");
  const [g1, g2] = out.characters as AnyRec[];
  assert(sameSet(g1.hiddenTaskIds as string[], ["parttime"]), "G: daily hide stays per-char");
  assert(sameSet(g2.hiddenTaskIds as string[], []), "G: account id stripped from char list");
}

// G2: v10 save with a global account hide passes through untouched
{
  const input = {
    version: 10,
    characters: [{ id: "c1", name: "A", taskValues: {}, hiddenTaskIds: [] }],
    activeCharId: "c1",
    hiddenAccountTaskIds: ["acc-silver"],
  };
  const out = migratePersisted(structuredClone(input), 10) as AnyRec;
  assert(out.version === 10, "G2: stays v10");
  assert(sameSet(out.hiddenAccountTaskIds as string[], ["acc-silver"]), "G2: global hide kept");
}

console.log("\nAll migration fixtures passed.");
