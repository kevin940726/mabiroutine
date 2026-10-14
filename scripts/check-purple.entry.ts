/* eslint-disable no-console */
// Purple-hole schedule math gate. Pure functions (no DOM, no store, no feed),
// so this runs in the pnpm check gate like the other entry scripts.
//
// What the feature promises (2026-10-14 rule): a correction of the NEXT spawn
// never moves the recorded past; only an explicit re-anchor does. The doc
// carries the two halves as `anchorMs` (the record) and `nextMs` (the
// correction); without a correction everything degenerates to the old single
// lattice, and the past is always the record's backward ray.
import {
  PURPLE_ANCHOR_MS,
  PURPLE_PERIOD_MS as P,
  bucketOccurrence,
  correctionSupersedeError,
  isScheduledToday,
  msUntilNextPurpleFire,
  msUntilPurpleFire,
  nextOccurrence,
  occurrencesAround,
  parseScheduleDoc,
  prevOccurrence,
  purpleBadge,
  purpleLive,
  resetPurpleTimetable,
  setPurpleTimetable,
} from "@/lib/purpleHole";

let bad = 0;
const ok = (msg: string) => console.log(`ok: ${msg}`);
const fail = (msg: string) => {
  bad += 1;
  console.log(`FAIL: ${msg}`);
};
const expect = (cond: boolean, msg: string) => (cond ? ok(msg) : fail(msg));
const eq = (actual: unknown, expected: unknown, msg: string) =>
  expect(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${msg}${JSON.stringify(actual) === JSON.stringify(expected) ? "" : ` (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`
  );

/** Taipei wall-clock. */
const T = (mo: number, d: number, h: number, mi: number, s = 0) =>
  Date.UTC(2026, mo - 1, d, h - 8, mi, s);
const f = (ms: number) => new Date(ms + 8 * 3600e3).toISOString().replace("T", " ").slice(0, 19);

// The three real docs: LIVE = published 2026-10-14 (pre-rule re-anchor, no
// correction), OLD = the doc before that correction, RESTORED = the planned
// restore (record moved to the endorsed latest entry + the correction).
const LIVE_A = T(10, 14, 14, 10, 9);
const OLD_A = T(10, 9, 2, 56, 2);
const REST_A = T(10, 13, 15, 41, 2);
const N_1410 = T(10, 14, 14, 10, 9);
const now = T(10, 14, 13, 30);

// --- 1. no correction: byte-identical to the legacy lattice ------------------
{
  const first = (function firstIndex(a: number) {
    return Math.floor((now - a) / P) + 1;
  })(LIVE_A);
  expect(
    prevOccurrence(now, 0, LIVE_A, null) === LIVE_A + (first - 1) * P &&
      nextOccurrence(now, LIVE_A, null) === LIVE_A + first * P,
    "a no-correction doc keeps the legacy prev/next"
  );
  eq(
    occurrencesAround(now, 2, 3, LIVE_A, null).map(f),
    ["2026-10-11 13:40:09", "2026-10-13 01:55:09", "2026-10-14 14:10:09", "2026-10-16 02:25:09", "2026-10-17 14:40:09"],
    "the live 2026-10-14 doc (future anchor) shows the deployed timetable"
  );
  expect(isScheduledToday(now, LIVE_A, null), "its spawn-day check matches the bucket");
  eq(purpleLive(now, LIVE_A, null), { kind: "upcoming", nextMs: LIVE_A }, "its live badge is upcoming");
}

// --- 2. a correction never moves the record ----------------------------------
{
  const rec0 = prevOccurrence(now, 0, REST_A, null);
  const rec1 = prevOccurrence(now, 1, REST_A, null);
  eq([rec0, rec1].map(f), ["2026-10-13 15:41:02", "2026-10-12 03:26:02"], "the record ray carries the endorsed past rows");
  eq(
    [prevOccurrence(now, 0, REST_A, N_1410), prevOccurrence(now, 1, REST_A, N_1410)].map(f),
    [f(rec0), f(rec1)],
    "adding the correction leaves those rows exactly where they were"
  );
  eq(f(nextOccurrence(now, REST_A, N_1410)), "2026-10-14 14:10:09", "the correction is the next spawn");
  eq(
    occurrencesAround(now, 2, 3, REST_A, N_1410).map(f),
    ["2026-10-12 03:26:02", "2026-10-13 15:41:02", "2026-10-14 14:10:09", "2026-10-16 02:25:09", "2026-10-17 14:40:09"],
    "the restored doc shows the pre-correction past + the corrected future"
  );
  // A record that lags the last implied spawn shows as-is: it moves on an
  // explicit re-anchor only, never as a side effect of a correction.
  eq(
    [prevOccurrence(now, 0, OLD_A, N_1410), prevOccurrence(now, 1, OLD_A, N_1410)].map(f),
    ["2026-10-09 02:56:02", "2026-10-07 14:41:02"],
    "a stale record is shown as-is, not extended by the correction"
  );
}

// --- 3. displaced lattice items never surface --------------------------------
{
  const before = T(10, 13, 10, 0);
  eq(f(nextOccurrence(before, REST_A, N_1410)), "2026-10-14 14:10:09", "the displaced lattice item is not the next");
  eq(
    [prevOccurrence(before, 0, REST_A, N_1410), prevOccurrence(before, 1, REST_A, N_1410)].map(f),
    ["2026-10-12 03:26:02", "2026-10-10 15:11:02"],
    "before the correction passes, the past is the record alone"
  );
  const far = T(11, 1, 9, 0);
  eq(f(nextOccurrence(now, OLD_A, far)), "2026-11-01 09:00:00", "a far correction is the next");
  expect(
    occurrencesAround(now, 2, 3, OLD_A, far).slice(2).every((t) => t >= far),
    "lattice predictions before a far correction do not surface as future"
  );
}

// --- 4. the seam walk: past the spawn, the row behind it is the record -------
{
  const after = T(10, 14, 15, 0);
  eq(
    [prevOccurrence(after, 0, REST_A, N_1410), prevOccurrence(after, 1, REST_A, N_1410)].map(f),
    ["2026-10-14 14:10:09", "2026-10-13 15:41:02"],
    "a passed correction joins the past, the record row behind it"
  );
  eq(f(nextOccurrence(after, REST_A, N_1410)), "2026-10-16 02:25:09", "later spawns follow the correction");
  eq(bucketOccurrence(after, REST_A, N_1410), N_1410, "the bucket prefers the spawn at/before now");
  eq(purpleLive(after, REST_A, N_1410), { kind: "stale", pastMs: N_1410, nextMs: T(10, 16, 2, 25, 9) }, "the stale badge pairs it with the next");
  eq(purpleBadge(after, REST_A, N_1410), { past: "10/14 14:10", next: "10/16 02:25" }, "the row pair renders it");
  const fresh = N_1410 + 10 * 60 * 1000;
  eq(purpleLive(fresh, REST_A, N_1410), { kind: "live", endsMs: N_1410 + 15 * 60 * 1000 }, "the fresh window is live");
}

// --- 5. fire arming + the card's spawn label (the active timetable, as the ---
// --- app reads it; REST_A's own lattice would say 10-15 03:56:02, so these ---
// --- only pass while the correction drives the arming AND the label) ---------
{
  setPurpleTimetable(REST_A, null, N_1410, null);
  expect(msUntilPurpleFire(T(10, 14, 13, 50)) === 5 * 60 * 1000 + 9000, "the page timer fires 15 min before the corrected spawn");
  expect(
    msUntilNextPurpleFire(T(10, 14, 13, 50)) === T(10, 16, 2, 25, 9) - 15 * 60 * 1000 - T(10, 14, 13, 50),
    "the re-arm skips to the spawn after and follows the correction"
  );
  expect(f(nextOccurrence(T(10, 14, 13, 50))) === "2026-10-14 14:10:09", "the card's spawn label is the corrected spawn");
  resetPurpleTimetable();
}

// --- 6. parse gate -----------------------------------------------------------
{
  const w = [{ startMs: T(10, 14, 6, 0), endMs: T(10, 14, 9, 30) }];
  const doc = (nextMs?: unknown) =>
    parseScheduleDoc({ anchorMs: OLD_A, ...(nextMs === undefined ? {} : { nextMs }), windows: w });
  expect(doc()?.nextMs === null, "an old doc (no nextMs) parses as no-correction");
  expect(doc(null)?.nextMs === null, "an explicit null parses as no-correction");
  expect(doc(OLD_A + P)?.nextMs === OLD_A + P, "a correction after the anchor parses");
  expect(doc(OLD_A) === null, "a correction at the anchor is rejected");
  expect(doc(OLD_A - 1) === null, "a correction before the anchor is rejected");
  expect(doc("soon") === null, "a garbage correction is rejected");
  expect(doc(Infinity) === null, "an infinite correction is rejected");
  expect(doc(OLD_A + P)?.windows.length === 1, "windows still ride through");
}

// --- 7. the recorded previous point (seam) and the supersede guard -----------
{
  const seam = T(10, 13, 15, 41, 2); // the record
  const prevRec = T(10, 12, 3, 26, 2); // the spawn recorded before it
  // Without prevMs the row behind the anchor derives as anchor − PERIOD.
  eq(
    [
      prevOccurrence(T(10, 14, 13, 30), 0, N_1410, null, null),
      prevOccurrence(T(10, 14, 13, 30), 1, N_1410, null, null),
    ].map(f),
    ["2026-10-13 01:55:09", "2026-10-11 13:40:09"],
    "without prevMs the record derives backward from the anchor"
  );
  // With it: the row behind a recorded spawn is exact across the seam, and the
  // deeper history follows the recorded point's own phase.
  const after = T(10, 14, 15, 0);
  eq(
    [prevOccurrence(after, 0, N_1410, null, seam), prevOccurrence(after, 1, N_1410, null, seam)].map(f),
    ["2026-10-14 14:10:09", "2026-10-13 15:41:02"],
    "prevMs keeps the seam row behind a recorded spawn"
  );
  eq(f(prevOccurrence(after, 2, N_1410, null, seam)), "2026-10-12 03:26:02", "deeper rows follow prevMs");
  eq(f(nextOccurrence(after, N_1410, null)), "2026-10-16 02:25:09", "the forward chain is unaffected by prevMs");
  // The pair is what the restored doc carries, and the past row pair still
  // matches the pre-correction display.
  eq(
    [prevOccurrence(now, 0, seam, N_1410, prevRec), prevOccurrence(now, 1, seam, N_1410, prevRec)].map(f),
    ["2026-10-13 15:41:02", "2026-10-12 03:26:02"],
    "the restored record with its previous point keeps the endorsed past"
  );

  // Supersede guard: refuse and record, never fold.
  const stored = { anchorMs: seam, nextMs: N_1410 };
  expect(
    correctionSupersedeError(stored, { anchorMs: seam, nextMs: T(10, 14, 20, 0) }, T(10, 14, 13, 0)) === null,
    "a correction still in the future is superseded freely"
  );
  expect(
    correctionSupersedeError(stored, { anchorMs: seam, nextMs: N_1410 }, T(10, 16, 12, 0)) === null,
    "an unchanged correction is not a supersede"
  );
  const refused = correctionSupersedeError(
    stored,
    { anchorMs: seam, nextMs: T(10, 16, 20, 0) },
    T(10, 16, 12, 0)
  );
  expect(refused !== null && refused.includes("10/16 02:25:09"), "a passed correction not covered by the record is refused, naming the spawn to record (with seconds)");
  expect(
    correctionSupersedeError(
      stored,
      { anchorMs: T(10, 16, 2, 25, 9), nextMs: T(10, 16, 20, 0) },
      T(10, 16, 12, 0)
    ) === null,
    "recording the latest passed spawn first lets the correction through"
  );
  expect(
    correctionSupersedeError(stored, { anchorMs: seam, nextMs: null }, T(10, 16, 12, 0)) !== null,
    "clearing a passed correction is refused too"
  );
  expect(
    correctionSupersedeError(stored, { anchorMs: seam, nextMs: null }, T(10, 16, 12, 0), true) === null,
    "an explicit discard bypasses the guard (a correction that never happened)"
  );
  expect(correctionSupersedeError(null, { anchorMs: seam, nextMs: null }, T(10, 16, 12, 0)) === null, "no stored correction, nothing to supersede");

  // Parse gate for the pair.
  const w = [{ startMs: T(10, 14, 6, 0), endMs: T(10, 14, 9, 30) }];
  expect(parseScheduleDoc({ anchorMs: N_1410, prevMs: seam, windows: w })?.prevMs === seam, "prevMs before the anchor parses");
  expect(parseScheduleDoc({ anchorMs: N_1410, prevMs: null, windows: w })?.prevMs === null, "an explicit null prevMs parses");
  expect(parseScheduleDoc({ anchorMs: N_1410, prevMs: N_1410, windows: w }) === null, "prevMs at the anchor is rejected");
  expect(parseScheduleDoc({ anchorMs: N_1410, prevMs: N_1410 + 1, windows: w }) === null, "prevMs after the anchor is rejected");
  expect(parseScheduleDoc({ anchorMs: N_1410, prevMs: "x", windows: w }) === null, "a garbage prevMs is rejected");
}

// --- 8. property sweep: the lattice formula, and the frozen record -----------
{
  let seed = 42;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  let badCases = 0;
  for (let i = 0; i < 1000; i++) {
    const a = T(1, 1, 0, 0) + Math.floor(rnd() * 400 * 24 * 3600e3);
    const at = a + Math.floor((rnd() - 0.5) * 40 * P);
    const first = Math.floor((at - a) / P) + 1;
    if (
      prevOccurrence(at, 0, a, null) !== a + (first - 1) * P ||
      nextOccurrence(at, a, null) !== a + first * P
    ) {
      badCases += 1;
    }
    const nx = at + Math.floor((rnd() - 0.2) * 10 * P);
    if (nx <= a) continue;
    const recordK = Math.min(0, Math.floor((at - a) / P));
    if (nx > at && prevOccurrence(at, 0, a, nx) !== a + recordK * P) badCases += 1;
    const walk = occurrencesAround(at, 2, 3, a, nx);
    for (let k = 1; k < walk.length; k++) if (walk[k] <= walk[k - 1]) badCases += 1;
    if (nextOccurrence(at, a, nx) <= at) badCases += 1;
  }
  expect(badCases === 0, "1000 random docs keep the lattice and the frozen record");
}

// The fallback still answers without any feed.
expect(
  Number.isFinite(prevOccurrence(Date.now(), 0, PURPLE_ANCHOR_MS, null)) &&
    Number.isFinite(nextOccurrence(Date.now(), PURPLE_ANCHOR_MS, null)),
  "the hardcoded fallback timetable stays usable"
);

if (bad > 0) {
  console.log(`\n${bad} purple schedule check(s) failed`);
  process.exit(1);
}
console.log("\npurple schedule: all checks passed");
