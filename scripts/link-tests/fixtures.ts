import type { LinkRow } from "@/lib/link/protocol";
import { currentDailyBucket } from "@/lib/reset";

export const T = Date.parse("2026-11-09T12:04:00+08:00") / 1000;

if (currentDailyBucket(new Date(T * 1000)) !== "2026-11-09") {
  throw new Error("fixture T left the 2026-11-09 daily bucket; the rows and now no longer share a day");
}

const A = { gameId: 1001, name: "角色A" };
const B = { gameId: 1002, name: "角色B" };

export const rows = {
  daily: {
    task: "daily-dungeon",
    character: A,
    value: 1,
    kind: "done",
    at: T,
    op: 170497,
    confidence: "proven",
  },
  abyssA: {
    task: "abyss",
    character: A,
    value: 2,
    kind: "count",
    at: T - 10,
    op: 170005,
    confidence: "proven",
  },
  abyssB: {
    task: "abyss",
    character: B,
    value: 1,
    kind: "count",
    at: T - 5,
    op: 170005,
    confidence: "proven",
  },
  shopfree: {
    task: "acc-shopfree",
    character: A,
    value: 1,
    kind: "done",
    at: T - 20,
    op: 20142,
    confidence: "proven",
  },
  gem: {
    task: "acc-gem",
    character: A,
    value: 10,
    kind: "count",
    at: T - 30,
    op: 170334,
    confidence: "proven",
  },
  barrier: {
    task: "barrier",
    character: A,
    value: 3,
    kind: "remaining",
    at: T - 40,
    op: 170302,
    confidence: "proven",
  },
  blackHole: {
    task: "black-hole",
    character: A,
    value: 11,
    kind: "remaining",
    at: T - 50,
    op: 170695,
    confidence: "proven",
  },
  blackHoleToday: {
    task: "black-hole-today",
    character: A,
    value: 5,
    kind: "remaining",
    at: T - 45,
    op: 170694,
    confidence: "observed",
  },
  blackHoleDaily: {
    task: "black-hole-daily",
    character: A,
    value: 0,
    kind: "done",
    at: T - 60,
    op: 170692,
    confidence: "observed",
  },
  weeklyGoalsHunt: {
    task: "weekly-goals-hunt",
    character: A,
    value: 4,
    kind: "count",
    at: T - 70,
    op: 170965,
    confidence: "proven",
  },
} satisfies Record<string, LinkRow>;

export const basicSnapshot = {
  protocol: "mabiroutine.link/1",
  type: "snapshot",
  seq: 42,
  generated: "2026-11-09T12:04:00+08:00",
  lastFrameAt: T,
  characters: [A, B],
  rows: [
    rows.daily,
    rows.abyssA,
    rows.abyssB,
    rows.shopfree,
    rows.gem,
    rows.barrier,
    rows.weeklyGoalsHunt,
  ],
  dropped: { unknownTask: 0, unresolvedCharacter: 0 },
};
