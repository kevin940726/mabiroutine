import type { FlatMap } from "@/sync/flat";

// Local-only sync journal (diagnostics): the last rounds and auto-pushes this
// device performed, with the keys it pushed, the contested keys it dropped
// (local/base/remote side by side), and the remote keys it adopted. It exists
// to reconstruct a future "it overwrote my progress" after the fact: the
// server keeps end state only, Vercel request logs carry no bodies, so the
// only witness is the device itself. Never sent anywhere, no UI, no toast.
// Read it in DevTools: __mabiSyncJournal() (wired in main.tsx).
//
// Storage is best-effort, same rule as stats.ts: a corrupt doc or a blocked
// localStorage degrades to an empty journal and never breaks sync.
const JOURNAL_KEY = "mabiroutine:syncjournal";
const KEEP_EVENTS = 50;
const MAX_LIST = 200; // entries per pushed/dropped/adopted list
const MAX_DOC_BYTES = 128 * 1024;

export type JournalChange = { key: string; value: unknown };
export type JournalDrop = { key: string; local: unknown; base: unknown; remote: unknown };
export type JournalAdopt = { key: string; remote: unknown };

export type JournalEvent = {
  at: number;
  kind: "round" | "push";
  /**
   * Session id prefix. The journal is per-device by construction (it lives in
   * that device's localStorage), so the prefix only groups entries by session.
   */
  sid: string;
  /** Server `updatedAt` the round read; for a push event, the PATCH ack. */
  remoteTs: number;
  pushed: JournalChange[];
  dropped: JournalDrop[];
  adopted: JournalAdopt[];
  /** The round was interrupted by a mid-flight edit (no merge happened). */
  aborted?: true;
};

function sidOf(sessionId: string): string {
  return sessionId.slice(0, 8);
}

function trim<T>(list: T[]): T[] {
  return list.length > MAX_LIST ? list.slice(0, MAX_LIST) : list;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export function readJournal(): JournalEvent[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(JOURNAL_KEY);
    if (!raw) return [];
    const doc = JSON.parse(raw) as unknown;
    if (!Array.isArray(doc)) return [];
    return doc
      .filter((e): e is Record<string, unknown> => !!e && typeof e === "object" && typeof e.at === "number")
      .map((e) => ({
        at: e.at as number,
        kind: e.kind === "push" ? ("push" as const) : ("round" as const),
        sid: typeof e.sid === "string" ? e.sid : "",
        remoteTs: typeof e.remoteTs === "number" ? e.remoteTs : 0,
        pushed: asArray(e.pushed) as JournalChange[],
        dropped: asArray(e.dropped) as JournalDrop[],
        adopted: asArray(e.adopted) as JournalAdopt[],
        ...(e.aborted === true ? { aborted: true as const } : {}),
      }));
  } catch {
    return [];
  }
}

export function appendJournal(event: Omit<JournalEvent, "at"> & { at?: number }): void {
  try {
    if (typeof localStorage === "undefined") return;
    const full: JournalEvent = {
      at: event.at ?? Date.now(),
      kind: event.kind,
      sid: event.sid,
      remoteTs: event.remoteTs,
      pushed: trim(event.pushed),
      dropped: trim(event.dropped),
      adopted: trim(event.adopted),
      ...(event.aborted ? { aborted: true as const } : {}),
    };
    let doc = [...readJournal(), full];
    if (doc.length > KEEP_EVENTS) doc = doc.slice(doc.length - KEEP_EVENTS);
    let raw = JSON.stringify(doc);
    // Real bytes, not UTF-16 units: CJK values would otherwise run ~3x the cap.
    const bytes = () => new TextEncoder().encode(raw).length;
    while (bytes() > MAX_DOC_BYTES && doc.length > 1) {
      doc = doc.slice(1); // drop the oldest until the doc fits
      raw = JSON.stringify(doc);
    }
    localStorage.setItem(JOURNAL_KEY, raw);
  } catch {
    // diagnostics never break sync
  }
}

export function clearJournal(): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(JOURNAL_KEY);
  } catch {
    // ignore
  }
}

// One landed auto-push: the key set and the ack's `updatedAt`.
export function journalPush(args: { sessionId: string; remoteTs: number; pushed: FlatMap }): void {
  const pushed: JournalChange[] = Object.entries(args.pushed).map(([key, value]) => ({ key, value }));
  if (pushed.length === 0) return;
  appendJournal({
    kind: "push",
    sid: sidOf(args.sessionId),
    remoteTs: args.remoteTs,
    pushed,
    dropped: [],
    adopted: [],
  });
}

// One completed round, as the engine saw it. `pushed` is the accepted key set,
// `dropped` the contested keys (their local/base/remote values), `adopted` the
// remote changes the merge took. Empty rounds (nothing pushed, dropped or
// adopted) are not journalled, so the ring holds signal, not idle polls.
export function journalRound(args: {
  sessionId: string;
  remoteTs: number;
  base: FlatMap;
  changes: FlatMap;
  remote: FlatMap;
  pushed: FlatMap;
  dropped: string[];
  adopted: string[];
  aborted?: boolean;
}): void {
  const pushed: JournalChange[] = Object.entries(args.pushed).map(([key, value]) => ({ key, value }));
  const dropped: JournalDrop[] = args.dropped.map((key) => ({
    key,
    local: args.changes[key],
    base: args.base[key],
    remote: args.remote[key],
  }));
  const adopted: JournalAdopt[] = args.aborted ? [] : args.adopted.map((key) => ({ key, remote: args.remote[key] }));
  if (pushed.length === 0 && dropped.length === 0 && adopted.length === 0) return;
  appendJournal({
    kind: "round",
    sid: sidOf(args.sessionId),
    remoteTs: args.remoteTs,
    pushed,
    dropped,
    adopted,
    ...(args.aborted ? { aborted: true as const } : {}),
  });
}
