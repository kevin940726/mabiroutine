// Flush-ordering gate (docs/sync.md decision 17): the persisted store state
// must land before the sync base it describes, in one flush, and a queued
// write must be readable before it reaches localStorage. Real
// src/lib/storage.ts and the real saveBase (src/sync/flat.ts); a logging
// localStorage stands in for the browser.
import { flushStorage, queueStorageWrite, idleStorage } from "@/lib/storage";
import { saveBase } from "@/sync/flat";

type Entry = [string, string];

class LogStorage {
  writes: Entry[] = [];
  private m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.writes.push([k, String(v)]);
    this.m.set(k, String(v));
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
}

const ls = new LogStorage();
Object.defineProperty(globalThis, "localStorage", { value: ls, configurable: true, writable: true });
// Capture idle callbacks instead of running them (the test flushes explicitly).
Object.defineProperty(globalThis, "window", {
  value: { requestIdleCallback: () => 1 },
  configurable: true,
  writable: true,
});

let failures = 0;
function ok(name: string, cond: boolean, extra?: unknown): void {
  if (!cond) {
    failures += 1;
    console.log(`FAIL: ${name}`, extra === undefined ? "" : JSON.stringify(extra).slice(0, 300));
  } else {
    console.log(`ok: ${name}`);
  }
}

const STATE_KEY = "mabiroutine:v2";
const BASE_KEY = "mabiroutine:flatbase";

// Queued writes stay in memory (never touch localStorage) until a flush...
idleStorage.setItem(STATE_KEY, "STATE1");
queueStorageWrite(BASE_KEY, "BASE1");
ok("flush deferred: nothing persisted yet", ls.writes.length === 0, ls.writes);
ok("read-through serves the queued state", idleStorage.getItem(STATE_KEY) === "STATE1");
ok("read-through falls back to localStorage", idleStorage.getItem("absent") === null);

// ...and then land state first, base second (the ordering the sync base needs).
flushStorage();
ok(
  "one flush writes state then base",
  ls.writes.map(([k]) => k).join(",") === `${STATE_KEY},${BASE_KEY}`,
  ls.writes
);
ok("values landed", ls.getItem(STATE_KEY) === "STATE1" && ls.getItem(BASE_KEY) === "BASE1");

// A later state write must still precede a base write queued after it.
idleStorage.setItem(STATE_KEY, "STATE2");
queueStorageWrite(BASE_KEY, "BASE2");
flushStorage();
ok(
  "second flush keeps state-first order",
  ls.writes.slice(2).map(([k]) => k).join(",") === `${STATE_KEY},${BASE_KEY}`,
  ls.writes.slice(2)
);
ok("latest values win", ls.getItem(STATE_KEY) === "STATE2" && ls.getItem(BASE_KEY) === "BASE2");

// removeItem clears a queued value and deletes the persisted one.
idleStorage.removeItem(STATE_KEY);
flushStorage();
ok("remove clears queue and storage", idleStorage.getItem(STATE_KEY) === null && ls.getItem(STATE_KEY) === null);

// The engine's own saveBase must route through the queue: a direct
// localStorage write (the pre-fix bug) would land the base without the
// pending state in the same pass, leaving a base fresher than memory.
idleStorage.setItem(STATE_KEY, "STATE3");
saveBase("sid-test", { k: 1 }, 123);
ok(
  "saveBase flushes state then base in one pass",
  ls.writes.slice(-2).map(([k]) => k).join(",") === `${STATE_KEY},${BASE_KEY}`,
  ls.writes.slice(-2)
);
const doc = JSON.parse(ls.getItem(BASE_KEY) ?? "null") as {
  sessionId?: string;
  ts?: number;
  flat?: Record<string, unknown>;
} | null;
ok("saveBase persists the doc with its ts", doc?.sessionId === "sid-test" && doc?.ts === 123 && doc?.flat?.k === 1, doc);

console.log(failures === 0 ? "ALL FLUSH CHECKS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
