// Remote libSQL/Turso driver (@libsql/client/web, fetch-only, Vercel-safe).
// Semantics match the local driver (docs/sql-migration.md). Differences forced
// by HTTP: there is no interactive read-then-write transaction, so PATCH reads
// first (probe + which changed keys already exist) and then commits every write
// in ONE `batch(..., "write")` transaction, so the probe row and the kv rows
// can never diverge. The legacy->hash upgrade is claimed with a conditional
// UPDATE instead of a lock, so only one device can perform it.

import { createClient } from "@libsql/client/web";
import type { Client, InStatement } from "@libsql/client/web";
import type { ApplyResult, Db, HashState, Probe, PushSubscription, RosterEntry, SessionImport } from "./types.js";

function parseRoster(raw: unknown): RosterEntry[] | null {
  if (raw == null) return null;
  try {
    const v = JSON.parse(String(raw)) as unknown;
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

const UPSERT =
  "INSERT INTO kv (session_id, key, value) VALUES (?, ?, ?) ON CONFLICT(session_id, key) DO UPDATE SET value = excluded.value";

type Row = Record<string, unknown>;

async function ensureSchema(client: Client): Promise<void> {
  await client.batch([{ sql: VERSION_TABLE }], "write");
  const rs = await client.execute("SELECT version FROM _schema_version LIMIT 1");
  const row = rs.rows[0] as Row | undefined;
  if (!row) await client.execute("INSERT INTO _schema_version (version) VALUES (0)");
  const from = row ? Number(row.version) : 0;
  for (let i = from; i < MIGRATIONS.length; i += 1) {
    await client.batch(MIGRATIONS[i].map((sql) => ({ sql })), "write");
    await client.execute({ sql: "UPDATE _schema_version SET version = ?", args: [i + 1] });
  }
}

// @libsql/client/web speaks HTTP; libsql:// is the same endpoint over https.
function normalizeUrl(url: string): string {
  return url.startsWith("libsql://") ? `https://${url.slice("libsql://".length)}` : url;
}

class RemoteDb implements Db {
  client: Client;
  ready: Promise<unknown>;

  constructor(client: Client) {
    this.client = client;
    this.ready = ensureSchema(client);
  }

  async probe(id: string, now: number): Promise<Probe | null> {
    await this.ready;
    const rs = await this.client.execute({
      sql: "SELECT updated_at, seq, meta, legacy, expires_at FROM sessions WHERE id = ?",
      args: [id],
    });
    const row = rs.rows[0] as Row | undefined;
    if (!row) return null;
    // Lazy TTL: an expired read is a 404, and the row is reclaimed here.
    if (Number(row.expires_at) <= now) {
      await this.delete(id);
      return null;
    }
    return {
      updatedAt: Number(row.updated_at),
      seq: Number(row.seq),
      hasHash: row.meta != null,
      hasLegacy: row.legacy != null,
    };
  }

  async readHash(id: string, now: number): Promise<HashState | null> {
    await this.ready;
    const s = await this.client.execute({
      sql: "SELECT meta FROM sessions WHERE id = ? AND expires_at > ?",
      args: [id, now],
    });
    const row = s.rows[0] as Row | undefined;
    if (!row || row.meta == null) return null;
    const rs = await this.client.execute({
      sql: "SELECT key, value FROM kv WHERE session_id = ?",
      args: [id],
    });
    const fields: Record<string, string> = {};
    for (const r of rs.rows) fields[String((r as Row).key)] = String((r as Row).value);
    return { meta: String(row.meta), fields };
  }

  async readLegacy(id: string, now: number): Promise<string | null> {
    await this.ready;
    const rs = await this.client.execute({
      sql: "SELECT legacy FROM sessions WHERE id = ? AND expires_at > ?",
      args: [id, now],
    });
    const row = rs.rows[0] as Row | undefined;
    return row && row.legacy != null ? String(row.legacy) : null;
  }

  async create(
    id: string,
    fields: Record<string, string>,
    metaRaw: string,
    updatedAt: number,
    expiresAt: number
  ): Promise<void> {
    await this.ready;
    const count = Object.keys(fields).length;
    const stmts: InStatement[] = [
      {
        sql: "INSERT INTO sessions (id, updated_at, seq, expires_at, field_count, meta, legacy) VALUES (?, ?, ?, ?, ?, ?, NULL)",
        args: [id, updatedAt, count, expiresAt, count, metaRaw],
      },
    ];
    for (const [k, v] of Object.entries(fields)) {
      stmts.push({ sql: "INSERT INTO kv (session_id, key, value) VALUES (?, ?, ?)", args: [id, k, v] });
    }
    await this.client.batch(stmts, "write");
  }

  private async patchHash(
    id: string,
    upserts: Record<string, string>,
    deletes: string[],
    metaRaw: string,
    now: number,
    maxFields: number,
    fieldCount: number,
    seq: number
  ): Promise<ApplyResult> {
    const upsertKeys = Object.keys(upserts);
    const touched = upsertKeys.concat(deletes);
    let fresh = 0;
    let removed = 0;
    if (touched.length) {
      const ph = touched.map(() => "?").join(",");
      const rs = await this.client.execute({
        sql: `SELECT key FROM kv WHERE session_id = ? AND key IN (${ph})`,
        args: [id, ...touched],
      });
      const existing = new Set(rs.rows.map((r) => String((r as Row).key)));
      fresh = upsertKeys.reduce((n, k) => (existing.has(k) ? n : n + 1), 0);
      removed = deletes.reduce((n, k) => (existing.has(k) ? n + 1 : n), 0);
    }
    if (fieldCount + fresh > maxFields) return { ok: false, reason: "too_large" };

    const stmts: InStatement[] = [];
    for (const k of deletes) stmts.push({ sql: "DELETE FROM kv WHERE session_id = ? AND key = ?", args: [id, k] });
    for (const k of upsertKeys) stmts.push({ sql: UPSERT, args: [id, k, upserts[k]] });
    stmts.push({
      sql: "UPDATE sessions SET meta = ?, seq = seq + 1, updated_at = ?, field_count = field_count + ? WHERE id = ?",
      args: [metaRaw, now, fresh - removed, id],
    });
    await this.client.batch(stmts, "write");
    return { ok: true, seq: seq + 1 };
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
    await this.ready;
    const rs = await this.client.execute({
      sql: "SELECT seq, field_count, meta, legacy FROM sessions WHERE id = ? AND expires_at > ?",
      args: [id, now],
    });
    const row = rs.rows[0] as Row | undefined;
    if (!row) return { ok: false, reason: "not_found" };
    const seq = Number(row.seq);

    if (row.meta == null && row.legacy != null) {
      const merged: Record<string, string> = { ...(legacyBase ?? {}) };
      for (const k of deletes) delete merged[k];
      for (const k of Object.keys(upserts)) merged[k] = upserts[k];
      if (Object.keys(merged).length > maxFields) return { ok: false, reason: "too_large" };
      // One transaction clears the legacy marker AND writes the merged fields,
      // so a failure leaves the record exactly as it was (legacy still set,
      // still served) rather than cleared with no data. No DELETE: if another
      // device wins the upgrade concurrently, its kv rows must survive.
      const stmts: InStatement[] = [
        {
          sql: "UPDATE sessions SET legacy = NULL, meta = ?, seq = seq + 1, updated_at = ?, field_count = ? WHERE id = ? AND legacy IS NOT NULL",
          args: [metaRaw, now, Object.keys(merged).length, id],
        },
      ];
      for (const [k, v] of Object.entries(merged)) stmts.push({ sql: UPSERT, args: [id, k, v] });
      await this.client.batch(stmts, "write");
      return { ok: true, seq: seq + 1 };
    }

    return this.patchHash(id, upserts, deletes, metaRaw, now, maxFields, Number(row.field_count), seq);
  }

  async delete(id: string): Promise<void> {
    await this.ready;
    await this.client.batch(
      [
        { sql: "DELETE FROM kv WHERE session_id = ?", args: [id] },
        { sql: "DELETE FROM sessions WHERE id = ?", args: [id] },
      ],
      "write"
    );
  }

  async upsertPushSub(sub: PushSubscription): Promise<void> {
    await this.ready;
    await this.client.execute({
      sql: `INSERT INTO push_subscriptions (endpoint, p256dh, auth, platform, lane, created_at, last_sent_at, link_session, roster_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(endpoint) DO UPDATE SET
              p256dh = excluded.p256dh, auth = excluded.auth, platform = excluded.platform,
              lane = excluded.lane, link_session = excluded.link_session, roster_json = excluded.roster_json`,
      args: [
        sub.endpoint,
        sub.p256dh,
        sub.auth,
        sub.platform,
        sub.lane,
        sub.createdAt,
        sub.lastSentAt,
        sub.linkSession,
        sub.roster ? JSON.stringify(sub.roster) : null,
      ],
    });
  }

  async deletePushSub(endpoint: string): Promise<void> {
    await this.ready;
    await this.client.execute({ sql: "DELETE FROM push_subscriptions WHERE endpoint = ?", args: [endpoint] });
  }

  async listPushSubs(lane: string): Promise<PushSubscription[]> {
    await this.ready;
    const rs = await this.client.execute({
      sql: "SELECT endpoint, p256dh, auth, platform, lane, created_at, last_sent_at, link_session, roster_json FROM push_subscriptions WHERE lane = ?",
      args: [lane],
    });
    return rs.rows.map((r) => {
      const row = r as Row;
      return {
        endpoint: String(row.endpoint),
        p256dh: String(row.p256dh),
        auth: String(row.auth),
        platform: String(row.platform),
        lane: String(row.lane),
        createdAt: Number(row.created_at),
        lastSentAt: row.last_sent_at == null ? null : Number(row.last_sent_at),
        linkSession: row.link_session == null ? null : String(row.link_session),
        roster: parseRoster(row.roster_json),
      };
    });
  }

  async importSession(rec: SessionImport): Promise<void> {
    await this.ready;
    const stmts: InStatement[] = [
      {
        sql: "INSERT OR IGNORE INTO sessions (id, updated_at, seq, expires_at, field_count, meta, legacy) VALUES (?, ?, ?, ?, ?, ?, ?)",
        args: [rec.id, rec.updatedAt, rec.seq, rec.expiresAt, Object.keys(rec.fields).length, rec.metaRaw, rec.legacyRaw],
      },
    ];
    for (const [k, v] of Object.entries(rec.fields)) {
      stmts.push({ sql: "INSERT OR IGNORE INTO kv (session_id, key, value) VALUES (?, ?, ?)", args: [rec.id, k, v] });
    }
    await this.client.batch(stmts, "write");
  }

  async touch(id: string, expiresAt: number): Promise<void> {
    await this.ready;
    await this.client.execute({ sql: "UPDATE sessions SET expires_at = ? WHERE id = ?", args: [expiresAt, id] });
  }
}

export function openRemoteDb(url: string, authToken?: string): Db {
  if (!authToken) throw new Error("TURSO_AUTH_TOKEN is required for a remote database");
  return new RemoteDb(createClient({ url: normalizeUrl(url), authToken }));
}
