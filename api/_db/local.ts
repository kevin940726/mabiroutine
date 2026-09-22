// Local SQLite driver (node:sqlite, built into Node 24). This is the offline
// dev backend: `pnpm dev:api` needs no cloud credentials. The remote driver
// (@libsql/client/web for Turso) lands in P2 behind the same Db interface.
//
// Semantics mirror the old Redis storage exactly except for one deliberate
// change (docs/sql-migration.md decision 3): a null value for a cycle key is a
// physical DELETE, not a retained tombstone, so expired buckets stop counting
// against the field budget. Nulls for non-cycle keys stay as tombstone rows.

import { DatabaseSync } from "node:sqlite";
import type { ApplyResult, Db, HashState, Probe, PushSubscription, RosterEntry } from "./types.js";

function parseRoster(raw: string | null): RosterEntry[] | null {
  if (raw == null) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return null;
    const out: RosterEntry[] = [];
    for (const e of v) {
      if (e && typeof e === "object" && typeof (e as RosterEntry).cid === "string") {
        out.push({ cid: (e as RosterEntry).cid, name: typeof (e as RosterEntry).name === "string" ? (e as RosterEntry).name : "" });
      }
    }
    return out;
  } catch {
    return null;
  }
}
import { MIGRATIONS, VERSION_TABLE } from "./schema.js";

function ensureSchema(db: DatabaseSync): void {
  db.exec(VERSION_TABLE);
  const row = db.prepare("SELECT version FROM _schema_version LIMIT 1").get() as unknown as
    | { version: number }
    | undefined;
  if (!row) db.prepare("INSERT INTO _schema_version (version) VALUES (0)").run();
  const from = row ? Number(row.version) : 0;
  for (let i = from; i < MIGRATIONS.length; i += 1) {
    for (const sql of MIGRATIONS[i]) db.exec(sql);
    db.prepare("UPDATE _schema_version SET version = ?").run(i + 1);
  }
}

function toPath(url: string): string {
  return url.startsWith("file:") ? url.slice("file:".length) : url;
}

type SessionRow = {
  updated_at: number;
  seq: number;
  field_count: number;
  meta: string | null;
  legacy: string | null;
  expires_at: number;
};

class LocalDb implements Db {
  db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  private tx<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  async probe(id: string, now: number): Promise<Probe | null> {
    const row = this.db
      .prepare("SELECT updated_at, seq, meta, legacy, expires_at FROM sessions WHERE id = ?")
      .get(id) as unknown as SessionRow | undefined;
    if (!row) return null;
    // Lazy TTL: an expired read is a 404, and the row is reclaimed here.
    if (row.expires_at <= now) {
      await this.delete(id);
      return null;
    }
    return {
      updatedAt: row.updated_at,
      seq: row.seq,
      hasHash: row.meta != null,
      hasLegacy: row.legacy != null,
    };
  }

  async readHash(id: string, now: number): Promise<HashState | null> {
    const s = this.db
      .prepare("SELECT meta FROM sessions WHERE id = ? AND expires_at > ?")
      .get(id, now) as unknown as { meta: string | null } | undefined;
    if (!s || s.meta == null) return null;
    const rows = this.db
      .prepare("SELECT key, value FROM kv WHERE session_id = ?")
      .all(id) as unknown as { key: string; value: string }[];
    const fields: Record<string, string> = {};
    for (const r of rows) fields[r.key] = r.value;
    return { meta: s.meta, fields };
  }

  async readLegacy(id: string, now: number): Promise<string | null> {
    const s = this.db
      .prepare("SELECT legacy FROM sessions WHERE id = ? AND expires_at > ?")
      .get(id, now) as unknown as { legacy: string | null } | undefined;
    return s?.legacy ?? null;
  }

  async create(
    id: string,
    fields: Record<string, string>,
    metaRaw: string,
    updatedAt: number,
    expiresAt: number
  ): Promise<void> {
    this.tx(() => {
      this.db
        .prepare(
          "INSERT INTO sessions (id, updated_at, seq, expires_at, field_count, meta, legacy) VALUES (?, ?, ?, ?, ?, ?, NULL)"
        )
        .run(id, updatedAt, Object.keys(fields).length, expiresAt, Object.keys(fields).length, metaRaw);
      const ins = this.db.prepare("INSERT INTO kv (session_id, key, value) VALUES (?, ?, ?)");
      for (const [k, v] of Object.entries(fields)) ins.run(id, k, v);
    });
  }

  async apply(
    id: string,
    upserts: Record<string, string>,
    deletes: string[],
    metaRaw: string,
    now: number,
    maxFields: number,
    legacyBase?: Record<string, string>
  ): Promise<ApplyResult> {
    return this.tx((): ApplyResult => {
      const row = this.db
        .prepare("SELECT seq, field_count, meta, legacy FROM sessions WHERE id = ? AND expires_at > ?")
        .get(id, now) as unknown as SessionRow | undefined;
      if (!row) return { ok: false, reason: "not_found" };

      const upsertKeys = Object.keys(upserts);

      // Legacy upgrade: merge the caller-decoded base with the incoming
      // changes, then clear the legacy column in the same transaction.
      if (row.meta == null && row.legacy != null) {
        const merged: Record<string, string> = { ...(legacyBase ?? {}) };
        for (const k of deletes) delete merged[k];
        for (const k of upsertKeys) merged[k] = upserts[k];
        if (Object.keys(merged).length > maxFields) return { ok: false, reason: "too_large" };
        this.db.prepare("DELETE FROM kv WHERE session_id = ?").run(id);
        const ins = this.db.prepare("INSERT INTO kv (session_id, key, value) VALUES (?, ?, ?)");
        for (const [k, v] of Object.entries(merged)) ins.run(id, k, v);
        this.db
          .prepare("UPDATE sessions SET meta = ?, seq = seq + 1, updated_at = ?, field_count = ?, legacy = NULL WHERE id = ?")
          .run(metaRaw, now, Object.keys(merged).length, id);
        return { ok: true, seq: row.seq + 1 };
      }

      // Normal hash patch. One query answers both "which changes are fresh"
      // (budget) and "which deletes exist" (count) so the field budget stays
      // exact without scanning the whole session.
      const touched = upsertKeys.concat(deletes);
      let fresh = 0;
      let removed = 0;
      if (touched.length) {
        const ph = touched.map(() => "?").join(",");
        const found = this.db
          .prepare(`SELECT key FROM kv WHERE session_id = ? AND key IN (${ph})`)
          .all(id, ...touched) as unknown as { key: string }[];
        const existing = new Set(found.map((r) => r.key));
        fresh = upsertKeys.reduce((n, k) => (existing.has(k) ? n : n + 1), 0);
        removed = deletes.reduce((n, k) => (existing.has(k) ? n + 1 : n), 0);
      }
      if (row.field_count + fresh > maxFields) return { ok: false, reason: "too_large" };

      if (deletes.length) {
        const ph = deletes.map(() => "?").join(",");
        this.db.prepare(`DELETE FROM kv WHERE session_id = ? AND key IN (${ph})`).run(id, ...deletes);
      }
      if (upsertKeys.length) {
        const up = this.db.prepare(
          "INSERT INTO kv (session_id, key, value) VALUES (?, ?, ?) ON CONFLICT(session_id, key) DO UPDATE SET value = excluded.value"
        );
        for (const k of upsertKeys) up.run(id, k, upserts[k]);
      }
      const nextCount = row.field_count + fresh - removed;
      this.db
        .prepare("UPDATE sessions SET meta = ?, seq = seq + 1, updated_at = ?, field_count = ? WHERE id = ?")
        .run(metaRaw, now, nextCount, id);
      return { ok: true, seq: row.seq + 1 };
    });
  }

  async delete(id: string): Promise<void> {
    this.tx(() => {
      this.db.prepare("DELETE FROM kv WHERE session_id = ?").run(id);
      this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
    });
  }

  async upsertPushSub(sub: PushSubscription): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO push_subscriptions (endpoint, p256dh, auth, platform, lane, created_at, last_sent_at, link_session, roster_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(endpoint, lane) DO UPDATE SET
           p256dh = excluded.p256dh, auth = excluded.auth, platform = excluded.platform,
           link_session = excluded.link_session, roster_json = excluded.roster_json`
      )
      .run(
        sub.endpoint,
        sub.p256dh,
        sub.auth,
        sub.platform,
        sub.lane,
        sub.createdAt,
        sub.lastSentAt,
        sub.linkSession,
        sub.roster ? JSON.stringify(sub.roster) : null
      );
  }

  async deletePushSub(endpoint: string, lane?: string): Promise<void> {
    if (lane) {
      this.db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND lane = ?").run(endpoint, lane);
    } else {
      this.db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(endpoint);
    }
  }

  async listPushSubs(lane: string): Promise<PushSubscription[]> {
    const rows = this.db
      .prepare(
        "SELECT endpoint, p256dh, auth, platform, lane, created_at, last_sent_at, link_session, roster_json FROM push_subscriptions WHERE lane = ?"
      )
      .all(lane) as unknown as {
      endpoint: string;
      p256dh: string;
      auth: string;
      platform: string;
      lane: string;
      created_at: number;
      last_sent_at: number | null;
      link_session: string | null;
      roster_json: string | null;
    }[];
    return rows.map((r) => ({
      endpoint: r.endpoint,
      p256dh: r.p256dh,
      auth: r.auth,
      platform: r.platform,
      lane: r.lane,
      createdAt: r.created_at,
      lastSentAt: r.last_sent_at,
      linkSession: r.link_session,
      roster: parseRoster(r.roster_json),
    }));
  }

  async touch(id: string, expiresAt: number): Promise<void> {
    this.db.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").run(expiresAt, id);
  }
}

export function openLocalDb(url: string): Db {
  const db = new DatabaseSync(toPath(url));
  db.exec("PRAGMA journal_mode = WAL");
  // vercel dev serves concurrent invocations on separate connections: a
  // second writer between probe and apply fails BEGIN IMMEDIATE instantly at
  // the default busy timeout of 0 (SQLITE_BUSY, errcode 5 — killed dev:api
  // under api-live's 25-parallel-PATCH step on 2026-09-15). Retry in SQLite
  // instead of failing.
  db.exec("PRAGMA busy_timeout = 5000");
  ensureSchema(db);
  return new LocalDb(db);
}
