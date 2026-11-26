import { BLACK_HOLE_BANK_MAX } from "@/lib/blackHole";
import { carriesOverCycle, cycleBucketFor } from "@/lib/cycle";
import type { Character, Task } from "@/lib/types";
import type { LinkRow } from "@/lib/link/protocol";
import {
  isGuarded,
  linkKey,
  type LinkBlackHole,
  type LinkDeviceState,
  type LinkStamp,
} from "@/lib/link/device";
import {
  BLACK_HOLE,
  normalizeValue,
  resolveTarget,
  targetBucket,
} from "@/lib/link/tasks";

export type LinkWrite = {
  taskId: string;
  scope: "character" | "account";
  charId?: string;
  value: number | boolean;
  bucket: string;
  at: number;
  op: number;
  finished?: boolean;
};

export type LinkUnresolved = {
  taskId: string;
  op: number;
  reason: "unknown-task" | "no-character" | "ambiguous-character" | "stale-match";
  gameId?: number;
  name?: string;
};

export type LinkOffer = {
  taskId: string;
  charId: string;
  name: string;
  value: number;
  at: number;
};

export type LinkApplyInput = {
  rows: LinkRow[];
  characters: Character[];
  accountValues: Record<string, number | boolean>;
  taskBuckets: Record<string, string>;
  customTasks: Task[];
  barterPins: string[];
  device: LinkDeviceState;
  nowSeconds?: number;
};

export type LinkGuard = {
  key: string;
  tapAt: number;
  rowAt: number;
};

export type LinkApplyResult = {
  writes: LinkWrite[];
  device: LinkDeviceState;
  unresolved: LinkUnresolved[];
  offers: LinkOffer[];
  guarded: LinkGuard[];
  older: string[];
  oldCycle: string[];
};

function ownerFor(
  row: LinkRow,
  characters: Character[],
  device: LinkDeviceState
): { cid: string } | { reason: LinkUnresolved["reason"] } {
  const gid = String(row.character.gameId);
  const saved = device.match[gid];
  if (saved) {
    return characters.some((c) => c.id === saved) ? { cid: saved } : { reason: "stale-match" };
  }
  const hits = characters.filter((c) => c.name.trim() === row.character.name.trim());
  if (hits.length === 1) return { cid: hits[0].id };
  return { reason: hits.length === 0 ? "no-character" : "ambiguous-character" };
}

function stampOk(watermark: LinkStamp | undefined, at: number): boolean {
  return watermark === undefined || at > watermark.at;
}

function inputWatermarkKey(key: string): string {
  return `${key}#src`;
}

function blackHoleBucket(customTasks: Task[], at: number): string {
  const target = resolveTarget(BLACK_HOLE, customTasks);
  return targetBucket(target, customTasks, at) ?? "";
}

function blackHoleWrites(
  cid: string,
  device: LinkDeviceState,
  customTasks: Task[],
  nowMs: number
):
  | { write: LinkWrite; key: string }
  | { guard: LinkGuard }
  | { repeat: { key: string; at: number; op?: number } }
  | null {
  const weekly = device.blackHole[cid]?.weekly;
  if (!weekly) return null;
  const at = weekly.at;
  const bucket = blackHoleBucket(customTasks, at);
  if (!bucket) return null;
  if (bucket !== cycleBucketFor(BLACK_HOLE, customTasks, new Date(nowMs))) return null;
  const key = linkKey("character", cid, BLACK_HOLE, bucket);
  if (isGuarded(device, key, at)) {
    return { guard: { key, tapAt: device.localWrites[key], rowAt: at } };
  }
  if (!stampOk(device.watermarks[key], at)) return null;

  const weeklyValue = typeof weekly.value === "number" ? weekly.value : Number(weekly.value);
  if (!Number.isFinite(weeklyValue) || weeklyValue > BLACK_HOLE_BANK_MAX) return null;
  const bank = Math.max(
    0,
    Math.min(BLACK_HOLE_BANK_MAX, BLACK_HOLE_BANK_MAX - weeklyValue)
  );
  const watermark = device.watermarks[key];
  if (
    watermark !== undefined &&
    bank === watermark.value &&
    weekly.changed === false
  ) {
    return { repeat: { key, at, op: weekly.op } };
  }
  return {
    key,
    write: {
      taskId: BLACK_HOLE,
      scope: "character",
      charId: cid,
      value: bank,
      bucket,
      at,
      op: weekly.op ?? 0,
    },
  };
}

export function applyLinkRows(input: LinkApplyInput): LinkApplyResult {
  const device: LinkDeviceState = {
    ...input.device,
    match: { ...input.device.match },
    localWrites: { ...input.device.localWrites },
    watermarks: { ...input.device.watermarks },
    blackHole: Object.fromEntries(
      Object.entries(input.device.blackHole).map(([cid, parts]) => [cid, { ...parts }])
    ),
  };
  const writes = new Map<string, LinkWrite>();
  const unresolved: LinkUnresolved[] = [];
  const offers: LinkOffer[] = [];
  const guarded: LinkGuard[] = [];
  const older: string[] = [];
  const oldCycle: string[] = [];
  const touchedBh = new Set<string>();
  const blockedBh = new Set<string>();
  const nowMs = (input.nowSeconds ?? Date.now() / 1000) * 1000;
  let newest = device.lastFrameAt ?? 0;

  const push = (write: LinkWrite) => {
    const key = `${write.scope}:${write.charId ?? "account"}:${write.taskId}@${write.bucket}`;
    writes.set(key, write);
  };

  for (const row of input.rows) {
    newest = Math.max(newest, row.at);
    const target = resolveTarget(row.task, input.customTasks);
    if (target.kind === "unknown") {
      unresolved.push({ taskId: row.task, op: row.op, reason: "unknown-task" });
      continue;
    }

    // An account row's character is provenance, not the storage key, so only a
    // character-scoped row needs the local identity match.
    const needsIdentity = target.kind === "aux" || target.scope === "character";
    const owner = needsIdentity ? ownerFor(row, input.characters, device) : null;
    if (owner && "reason" in owner) {
      unresolved.push({
        taskId: row.task,
        op: row.op,
        reason: owner.reason,
        gameId: row.character.gameId,
        name: row.character.name,
      });
      continue;
    }
    const cid = owner?.cid ?? null;
    if (cid) device.match[String(row.character.gameId)] = cid;

    if (target.kind === "aux") continue;

    let bucket = targetBucket(target, input.customTasks, row.at);
    if (!bucket) {
      unresolved.push({ taskId: row.task, op: row.op, reason: "unknown-task" });
      continue;
    }
    const currentBucket = cycleBucketFor(
      target.kind === "task" ? target.task.id : target.taskId,
      input.customTasks,
      new Date(nowMs)
    );
    if (bucket !== currentBucket) {
      if (carriesOverCycle(row.task)) bucket = currentBucket;
      else {
        oldCycle.push(`${cid ?? "account"}:${row.task}@${bucket}`);
        continue;
      }
    }
    const scope = target.scope;
    const key = linkKey(scope, cid, row.task, bucket);
    if (isGuarded(device, key, row.at)) {
      guarded.push({ key, tapAt: device.localWrites[key], rowAt: row.at });
      if (row.task === BLACK_HOLE && cid) blockedBh.add(cid);
      continue;
    }

    if (target.kind === "shop" && !input.barterPins.includes(row.task)) {
      offers.push({
        taskId: row.task,
        charId: cid ?? "",
        name: row.character.name,
        value: row.value,
        at: row.at,
      });
      continue;
    }

    if (row.task === BLACK_HOLE && cid) {
      const inputKey = inputWatermarkKey(key);
      if (!stampOk(device.watermarks[inputKey], row.at)) {
        older.push(inputKey);
        continue;
      }
      const parts: LinkBlackHole = { ...(device.blackHole[cid] ?? {}) };
      parts.weekly = {
        at: row.at,
        value: row.value,
        op: row.op,
        changed: row.changed,
      };
      device.blackHole[cid] = parts;
      device.watermarks[inputKey] = { at: row.at, value: row.value, op: row.op };
      touchedBh.add(cid);
      continue;
    }

    if (!stampOk(device.watermarks[key], row.at)) {
      older.push(key);
      continue;
    }
    const value = normalizeValue(target, row.value, row.kind);
    if (value === null) {
      unresolved.push({ taskId: row.task, op: row.op, reason: "unknown-task" });
      continue;
    }
    const watermark = device.watermarks[key];
    if (
      row.changed === false &&
      row.finished !== true &&
      watermark !== undefined &&
      value === watermark.value
    ) {
      device.watermarks[key] = { ...watermark, at: row.at, op: row.op };
      continue;
    }
    push({
      taskId: row.task,
      scope,
      ...(scope === "character" && cid ? { charId: cid } : {}),
      value,
      bucket,
      at: row.at,
      op: row.op,
      finished: row.finished,
    });
    delete device.localWrites[key];
    device.watermarks[key] = { at: row.at, value };
  }

  for (const cid of touchedBh) {
    if (blockedBh.has(cid)) continue;
    const composite = blackHoleWrites(
      cid,
      device,
      input.customTasks,
      nowMs
    );
    if (!composite) continue;
    if ("guard" in composite) {
      guarded.push(composite.guard);
      continue;
    }
    if ("repeat" in composite) {
      const prev = device.watermarks[composite.repeat.key];
      if (prev) {
        device.watermarks[composite.repeat.key] = {
          ...prev,
          at: composite.repeat.at,
          ...(composite.repeat.op !== undefined
            ? { op: composite.repeat.op }
            : {}),
        };
      }
      continue;
    }
    push(composite.write);
    delete device.localWrites[composite.key];
    device.watermarks[composite.key] = {
      at: composite.write.at,
      value: composite.write.value,
    };
  }

  device.lastFrameAt = newest || null;
  return {
    writes: [...writes.values()].sort((a, b) => a.at - b.at),
    device,
    unresolved,
    offers,
    guarded,
    older,
    oldCycle,
  };
}
