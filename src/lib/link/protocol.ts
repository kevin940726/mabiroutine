export const LINK_PROTOCOL = "mabiroutine.link/1";

export type LinkRowKind = "done" | "count" | "remaining";
export type LinkConfidence = "proven" | "observed";

export type LinkCharacter = { gameId: number; name: string };
export type LinkActive = { gameId: number; at: number };

export type LinkRow = {
  task: string;
  character: LinkCharacter;
  value: number;
  kind: LinkRowKind;
  at: number;
  op: number;
  confidence: LinkConfidence;
  /** Optional: producers before this field existed omit it. */
  finished?: boolean;
};

export type LinkDropped = { unknownTask: number; unresolvedCharacter: number };

export type LinkHello = {
  protocol: typeof LINK_PROTOCOL;
  type: "hello";
  seq: 0;
  producer: { id: string; version: string; mode: string; pid: number; startedAt: string };
  generated: string;
};

export type LinkSnapshot = {
  protocol: typeof LINK_PROTOCOL;
  type: "snapshot";
  seq: number;
  generated: string;
  lastFrameAt: number | null;
  active: LinkActive | null;
  characters: LinkCharacter[];
  rows: LinkRow[];
  dropped: LinkDropped;
};

export type LinkDelta = {
  protocol: typeof LINK_PROTOCOL;
  type: "delta";
  seq: number;
  generated: string;
  lastFrameAt: number | null;
  active: LinkActive | null;
  rows: LinkRow[];
};

export type LinkPong = {
  protocol: typeof LINK_PROTOCOL;
  type: "pong";
  seq: 0;
  generated: string;
};

export type LinkError = {
  protocol: typeof LINK_PROTOCOL;
  type: "error";
  seq: 0;
  code: string;
  message: string;
};

export type LinkMessage = LinkHello | LinkSnapshot | LinkDelta | LinkPong | LinkError;

const KINDS = new Set<LinkRowKind>(["done", "count", "remaining"]);
const TYPES = new Set(["hello", "snapshot", "delta", "pong", "error"]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isInt(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && Number.isInteger(v);
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function activeOf(v: unknown): LinkActive | null {
  if (!isRecord(v)) return null;
  if (!isInt(v.gameId) || !isNum(v.at) || v.at <= 0) return null;
  return { gameId: v.gameId, at: v.at };
}

export function parseLinkRow(v: unknown): LinkRow | null {
  if (!isRecord(v)) return null;
  const character = v.character;
  if (!isRecord(character)) return null;
  if (typeof v.task !== "string" || !v.task) return null;
  if (!isInt(character.gameId)) return null;
  if (typeof character.name !== "string" || !character.name) return null;
  if (!isNum(v.value)) return null;
  if (typeof v.kind !== "string" || !KINDS.has(v.kind as LinkRowKind)) return null;
  if (!isNum(v.at) || v.at <= 0) return null;
  if (!isInt(v.op) || v.op < 0) return null;
  const confidence = v.confidence === "observed" ? "observed" : "proven";
  return {
    task: v.task,
    character: { gameId: character.gameId, name: character.name },
    value: v.value,
    kind: v.kind as LinkRowKind,
    at: v.at,
    op: v.op,
    confidence,
    finished: v.finished === true,
  };
}

function rowsOf(v: unknown): { rows: LinkRow[]; bad: number } {
  if (!Array.isArray(v)) return { rows: [], bad: 0 };
  const rows: LinkRow[] = [];
  let bad = 0;
  for (const item of v) {
    const row = parseLinkRow(item);
    if (row) rows.push(row);
    else bad += 1;
  }
  return { rows, bad };
}

export type ParsedMessage = { message: LinkMessage; badRows: number };

/** Parse one socket or SSE object. Null means "not a Link message". */
export function parseLinkMessage(raw: string): ParsedMessage | null {
  let blob: unknown;
  try {
    blob = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(blob)) return null;
  if (blob.protocol !== LINK_PROTOCOL) return null;
  if (typeof blob.type !== "string" || !TYPES.has(blob.type)) return null;

  if (blob.type === "pong") {
    return {
      message: {
        protocol: LINK_PROTOCOL,
        type: "pong",
        seq: 0,
        generated: typeof blob.generated === "string" ? blob.generated : "",
      },
      badRows: 0,
    };
  }
  if (blob.type === "error") {
    return {
      message: {
        protocol: LINK_PROTOCOL,
        type: "error",
        seq: 0,
        code: typeof blob.code === "string" ? blob.code : "internal",
        message: typeof blob.message === "string" ? blob.message : "",
      },
      badRows: 0,
    };
  }
  if (blob.type === "hello") {
    const producer = blob.producer;
    if (!isRecord(producer) || typeof producer.id !== "string") return null;
    return {
      message: {
        protocol: LINK_PROTOCOL,
        type: "hello",
        seq: 0,
        producer: {
          id: producer.id,
          version: typeof producer.version === "string" ? producer.version : "",
          mode: typeof producer.mode === "string" ? producer.mode : "",
          pid: isInt(producer.pid) ? producer.pid : 0,
          startedAt: typeof producer.startedAt === "string" ? producer.startedAt : "",
        },
        generated: typeof blob.generated === "string" ? blob.generated : "",
      },
      badRows: 0,
    };
  }

  const seq = blob.seq;
  if (!isInt(seq) || seq < 0) return null;
  const lastFrameAt =
    blob.lastFrameAt === null || blob.lastFrameAt === undefined
      ? null
      : isNum(blob.lastFrameAt)
        ? blob.lastFrameAt
        : null;
  const generated = typeof blob.generated === "string" ? blob.generated : "";
  const { rows, bad } = rowsOf(blob.rows);

  if (blob.type === "delta") {
    return {
      message: {
        protocol: LINK_PROTOCOL,
        type: "delta",
        seq,
        generated,
        lastFrameAt,
        active: activeOf(blob.active),
        rows,
      },
      badRows: bad,
    };
  }

  const characters = Array.isArray(blob.characters)
    ? blob.characters
        .filter(
          (c): c is LinkCharacter =>
            isRecord(c) && isInt(c.gameId) && typeof c.name === "string" && !!c.name
        )
        .map((c) => ({ gameId: c.gameId, name: c.name }))
    : [];
  const dropped = isRecord(blob.dropped)
    ? {
        unknownTask: isInt(blob.dropped.unknownTask) ? blob.dropped.unknownTask : 0,
        unresolvedCharacter: isInt(blob.dropped.unresolvedCharacter)
          ? blob.dropped.unresolvedCharacter
          : 0,
      }
    : { unknownTask: 0, unresolvedCharacter: 0 };
  return {
    message: {
      protocol: LINK_PROTOCOL,
      type: "snapshot",
      seq,
      generated,
      lastFrameAt,
      active: activeOf(blob.active),
      characters,
      rows,
      dropped,
    },
    badRows: bad,
  };
}

function withToken(base: string, token?: string): string {
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}

export function socketUrl(token?: string): string {
  return withToken("ws://127.0.0.1:6278/link/1/socket", token);
}

export function snapshotUrl(token?: string): string {
  return withToken("http://127.0.0.1:6278/link/1/snapshot", token);
}

export function healthUrl(token?: string): string {
  return withToken("http://127.0.0.1:6278/link/1/health", token);
}
