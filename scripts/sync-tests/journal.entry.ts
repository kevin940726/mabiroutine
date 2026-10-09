// Journal diagnostics gate (docs/sync.md): the local sync journal must
// round-trip, cap its ring and lists (by bytes, CJK included), recover from
// corruption, and record what the real planRound decided — it is the only
// witness when a device's round needs reconstructing after the fact (the
// server keeps end state only). Real src/sync/journal.ts and src/sync/round.ts,
// stubbed localStorage.
import { appendJournal, readJournal, clearJournal, journalPush, journalRound } from "@/sync/journal";
import { planRound } from "@/sync/round";

class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v));
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
}

const ls = new MemStorage();
Object.defineProperty(globalThis, "localStorage", { value: ls, configurable: true, writable: true });

let failures = 0;
function ok(name: string, cond: boolean, extra?: unknown): void {
  if (!cond) {
    failures += 1;
    console.log(`FAIL: ${name}`, extra === undefined ? "" : JSON.stringify(extra).slice(0, 300));
  } else {
    console.log(`ok: ${name}`);
  }
}

// J1: append/read round-trip.
clearJournal();
appendJournal({
  kind: "push",
  sid: "abcd1234",
  remoteTs: 5,
  pushed: [{ key: "v:c1:x@2026-10-10", value: true }],
  dropped: [],
  adopted: [],
});
const one = readJournal();
ok("J1 round-trips one event", one.length === 1 && one[0]?.kind === "push" && one[0]?.sid === "abcd1234", one);
ok("J1 keeps pushed values", one[0]?.pushed[0]?.value === true, one[0]?.pushed);

// J2: the journal records exactly what planRound decided (adopted now comes
// from the decision core, not a second walk of the maps).
clearJournal();
const base = { a: 1, b: 2, d: 4 };
const changes = { a: 9, b: 3 }; // a contested (remote moved too), b uncontested, d untouched
const remote = { a: 5, b: 2, c: 7 }; // c adopted (remote changed, no local change)
const plan = planRound(base, changes, remote);
ok("J2 planRound adopts remote-only changes", JSON.stringify(plan.adopted) === JSON.stringify(["c"]), plan.adopted);
ok("J2 planRound pushes uncontested", JSON.stringify(Object.keys(plan.push)) === JSON.stringify(["b"]), plan.push);
ok("J2 planRound drops contested", JSON.stringify(plan.dropped) === JSON.stringify(["a"]), plan.dropped);
journalRound({
  sessionId: "abcd1234-full-id",
  remoteTs: 9,
  base,
  changes,
  remote,
  pushed: plan.push,
  dropped: plan.dropped,
  adopted: plan.adopted,
});
const two = readJournal();
ok("J2 one round event with the id prefix", two.length === 1 && two[0]?.kind === "round" && two[0]?.sid === "abcd1234" && two[0]?.remoteTs === 9, two);
ok("J2 pushed recorded", two[0]?.pushed.length === 1 && two[0]?.pushed[0]?.key === "b", two[0]?.pushed);
ok(
  "J2 dropped carries local/base/remote",
  two[0]?.dropped[0]?.local === 9 && two[0]?.dropped[0]?.base === 1 && two[0]?.dropped[0]?.remote === 5,
  two[0]?.dropped
);
ok(
  "J2 adopted lists remote changes",
  two[0]?.adopted.length === 1 && two[0]?.adopted[0]?.key === "c" && two[0]?.adopted[0]?.remote === 7,
  two[0]?.adopted
);

// J3: empty rounds are not journalled (idle polls must not evict signal).
clearJournal();
journalRound({ sessionId: "s", remoteTs: 1, base: { a: 1 }, changes: {}, remote: { a: 1 }, pushed: {}, dropped: [], adopted: [] });
ok("J3 empty round skipped", readJournal().length === 0);

// J4: aborted rounds keep pushed/dropped but skip adopted (no merge happened).
clearJournal();
journalRound({
  sessionId: "s",
  remoteTs: 2,
  base: { a: 1 },
  changes: { a: 9 },
  remote: { a: 5, c: 7 },
  pushed: {},
  dropped: ["a"],
  adopted: ["c"],
  aborted: true,
});
const four = readJournal();
ok("J4 aborted flagged", four[0]?.aborted === true, four[0]);
ok("J4 aborted skips adopted", (four[0]?.adopted.length ?? -1) === 0, four[0]?.adopted);

// J5: ring caps at the newest 50 events.
clearJournal();
for (let i = 0; i < 60; i += 1) {
  appendJournal({ kind: "push", sid: "s", remoteTs: i, pushed: [{ key: `k${i}`, value: i }], dropped: [], adopted: [] });
}
const five = readJournal();
ok(
  "J5 keeps the newest 50",
  five.length === 50 && five[0]?.remoteTs === 10 && five[49]?.remoteTs === 59,
  { len: five.length, first: five[0]?.remoteTs, last: five[49]?.remoteTs }
);

// J6: each list caps at 200 entries.
clearJournal();
appendJournal({
  kind: "push",
  sid: "s",
  remoteTs: 1,
  pushed: Array.from({ length: 205 }, (_, i) => ({ key: `k${i}`, value: i })),
  dropped: [],
  adopted: [],
});
ok("J6 pushed list capped", readJournal()[0]?.pushed.length === 200, readJournal()[0]?.pushed.length);

// J7: a corrupt doc reads empty, append recovers, clear empties.
ls.setItem("mabiroutine:syncjournal", "{not json");
ok("J7 corrupt doc reads empty", readJournal().length === 0);
appendJournal({ kind: "push", sid: "s", remoteTs: 1, pushed: [], dropped: [], adopted: [] });
ok("J7 append after corruption works", readJournal().length === 1);
clearJournal();
ok("J7 clear empties", readJournal().length === 0 && ls.getItem("mabiroutine:syncjournal") === null);

// J8: the byte cap is bytes, not UTF-16 units (CJK values would slip past a
// .length check), and it trims the ring to fit.
clearJournal();
const bigPushed = Array.from({ length: 200 }, (_, i) => ({
  key: `v:c1:任務${i}@2026-10-10`,
  value: "已完成".repeat(4),
}));
for (let i = 0; i < 20; i += 1) {
  appendJournal({ kind: "push", sid: "s", remoteTs: i, pushed: bigPushed, dropped: [], adopted: [] });
}
const rawBytes = new TextEncoder().encode(ls.getItem("mabiroutine:syncjournal") ?? "").length;
const kept = readJournal().length;
ok("J8 byte cap holds under CJK", rawBytes <= 128 * 1024 && kept > 0 && kept < 20, { rawBytes, kept });

// J9: the auto-push helper records the id prefix and the ack ts, skips empty.
clearJournal();
journalPush({ sessionId: "abcdefgh-rest", remoteTs: 7, pushed: { k: true } });
const nine = readJournal();
ok(
  "J9 journalPush records prefix + ack ts",
  nine.length === 1 && nine[0]?.kind === "push" && nine[0]?.sid === "abcdefgh" && nine[0]?.remoteTs === 7 && nine[0]?.pushed[0]?.value === true,
  nine
);
journalPush({ sessionId: "abcdefgh-rest", remoteTs: 8, pushed: {} });
ok("J9 empty push skipped", readJournal().length === 1);

// J10: a partial stored entry normalizes to empty arrays instead of throwing
// in the DevTools reader.
ls.setItem("mabiroutine:syncjournal", JSON.stringify([{ at: 5, kind: "round" }]));
const ten = readJournal();
ok(
  "J10 partial entry normalizes arrays",
  ten.length === 1 && Array.isArray(ten[0]?.pushed) && ten[0]?.pushed.length === 0 && ten[0]?.sid === "" && ten[0]?.remoteTs === 0,
  ten
);

console.log(failures === 0 ? "ALL JOURNAL CHECKS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
