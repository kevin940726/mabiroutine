// Storage seam for the sync backend (see docs/sql-migration.md).
//
// The protocol above this layer is unchanged from the Redis era: one row per
// flat key, values stored as tagged strings ("j:" + JSON), per-field
// last-arrival-wins by the order `apply` commits. Swapping Redis for SQL must
// not change any observable behavior, so the driver deals in the same raw
// strings the old code did (`enc`/`dec` stay the single codec).

export type SessionMeta = {
  v: 2;
  updatedAt: number;
  writerId: string;
  seq: number;
};

// One `sessions` row: the `?meta=1` fast path. `hasHash` = a kv layout exists,
// `hasLegacy` = an un-upgraded pre-hash record still lives in `legacy`.
export type Probe = {
  updatedAt: number;
  seq: number;
  hasHash: boolean;
  hasLegacy: boolean;
};

export type ApplyResult =
  | { ok: true; seq: number }
  | { ok: false; reason: "not_found" | "too_large" };

// The hash layout as the handler sees it: the meta blob lives on the sessions
// row, every other tagged field is a kv row.
export type HashState = {
  meta: string | null;
  fields: Record<string, string>;
};

// One push subscription row. `lane` scopes a row to a cadence ("hourly"
// today; the purple lane reuses this table when its fanout lands).
// `linkSession` (nullable) is the device's sync session id for named cards
// (D1a); `roster` (nullable) is a [{cid, name}] snapshot for ordering +
// fallback names. Either null → the generic copy.
export type RosterEntry = { cid: string; name: string };
export type PushSubscription = {
  endpoint: string;
  p256dh: string;
  auth: string;
  platform: string;
  lane: string;
  createdAt: number;
  lastSentAt: number | null;
  linkSession: string | null;
  roster: RosterEntry[] | null;
};

// One session lifted out of the pre-SQL store, ready to insert verbatim. Used
// by the one-time migration fallback (docs/sql-migration.md P4).
export type SessionImport = {
  id: string;
  updatedAt: number;
  seq: number;
  expiresAt: number;
  metaRaw: string | null;
  legacyRaw: string | null;
  fields: Record<string, string>;
};

export interface Db {
  /**
   * Sessions row only (1 row read). Returns null when the session is missing
   * or past `expires_at` (lazy TTL: expired reads as absent).
   */
  probe(id: string, now: number): Promise<Probe | null>;

  /** Raw hash fields (without meta) plus the meta blob. null when no hash. */
  readHash(id: string, now: number): Promise<HashState | null>;

  /** Raw legacy JSON string (v1 blob or v2 keys map). null when absent. */
  readLegacy(id: string, now: number): Promise<string | null>;

  /** POST: mint the probe row + its fields atomically. */
  create(
    id: string,
    fields: Record<string, string>,
    metaRaw: string,
    updatedAt: number,
    expiresAt: number
  ): Promise<void>;

  /**
   * PATCH: one atomic unit. Upserts tagged values, physically deletes
   * `deletes` (cycle-key tombstones), updates the probe row. When the session
   * is still a legacy record, `legacyBase` (tagged) is merged in and the
   * legacy column is cleared in the same transaction. Enforces `maxFields` and
   * returns `too_large` without writing.
   */
  apply(
    id: string,
    upserts: Record<string, string>,
    deletes: string[],
    metaRaw: string,
    now: number,
    maxFields: number,
    legacyBase?: Record<string, string>
  ): Promise<ApplyResult>;

  /** Drop the session and all its fields (idempotent). */
  delete(id: string): Promise<void>;

  /**
   * Push subscriptions (server-push fanout). Upsert by endpoint: a repeat
   * subscribe refreshes keys/timestamps instead of growing the table.
   */
  upsertPushSub(sub: PushSubscription): Promise<void>;

  /** Bell-off / dead-endpoint removal (idempotent). */
  deletePushSub(endpoint: string): Promise<void>;

  /** All subscriptions for one lane (today only "hourly"). */
  listPushSubs(lane: string): Promise<PushSubscription[]>;

  /** Daily beacon: refresh the sliding TTL. */
  touch(id: string, expiresAt: number): Promise<void>;

  /**
   * Idempotent bulk insert of a session lifted from the pre-SQL store
   * (migration fallback). No-op when the id already exists, so racing imports
   * and repeated probes cannot duplicate or clobber.
   */
  importSession(rec: SessionImport): Promise<void>;
}
