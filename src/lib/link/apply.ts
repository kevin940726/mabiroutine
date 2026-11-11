import { blackHoleX } from "@/lib/blackHole";
import { carriesOverCycle, cycleBucketFor } from "@/lib/cycle";
import { currentDailyBucket } from "@/lib/reset";
import type { Character, Task } from "@/lib/types";
import type { LinkRow } from "@/lib/link/protocol";
import {
  isPinned,
  linkKey,
  type LinkBlackHole,
  type LinkDeviceState,
  type LinkStamp,
} from "@/lib/link/device";
import {
  BLACK_HOLE,
  BLACK_HOLE_DAILY,
  BLACK_HOLE_TODAY,
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

export type LinkApplyResult = {
  writes: LinkWrite[];
  device: LinkDeviceState;
  unresolved: LinkUnresolved[];
  offers: LinkOffer[];
  pinned: string[];
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
  characters: Character[],
  customTasks: Task[],
  nowMs: number
): { write: LinkWrite; key: string } | null {
  const parts = device.blackHole[cid];
  const weekly = parts?.weekly;
  if (!weekly) return null;
  const day = currentDailyBucket(new Date(nowMs));
  const stampedToday = (stamp: LinkStamp | undefined): boolean =>
    stamp !== undefined && currentDailyBucket(new Date(stamp.at * 1000)) === day;
  const daily = stampedToday(parts.daily) ? parts.daily : undefined;
  const today = stampedToday(parts.today) ? parts.today : undefined;
  const at = Math.max(weekly.at, today?.at ?? 0, daily?.at ?? 0);
  const bucket = blackHoleBucket(customTasks, at);
  if (!bucket) return null;
  if (bucket !== cycleBucketFor(BLACK_HOLE, customTasks, new Date(nowMs))) return null;
  const key = linkKey("character", cid, BLACK_HOLE, bucket);
  if (isPinned(device, key)) return null;
  if (!stampOk(device.watermarks[key], at)) return null;

  const elapsed = 6 - blackHoleX(new Date(at * 1000));
  const storedDaily = characters.find((c) => c.id === cid)?.taskValues[BLACK_HOLE_DAILY];
  const dailyValue = daily?.value ?? storedDaily;
  const todayUsed =
    dailyValue !== undefined
      ? dailyValue === true || Number(dailyValue) >= 1
        ? 1
        : 0
      : today !== undefined && Number(today.value) <= 0
        ? 1
        : 0;
  const weeklyValue = typeof weekly.value === "number" ? weekly.value : Number(weekly.value);
  const bank = Math.max(0, Math.min(7, 14 - weeklyValue - elapsed - todayUsed));
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
    watermarks: { ...input.device.watermarks },
    blackHole: Object.fromEntries(
      Object.entries(input.device.blackHole).map(([cid, parts]) => [cid, { ...parts }])
    ),
  };
  const writes = new Map<string, LinkWrite>();
  const unresolved: LinkUnresolved[] = [];
  const offers: LinkOffer[] = [];
  const pinned: string[] = [];
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

    if (target.kind === "aux") {
      if (!cid) continue;
      if (row.task === BLACK_HOLE_TODAY) {
        const inputKey = inputWatermarkKey(`${cid}:${row.task}`);
        if (!stampOk(device.watermarks[inputKey], row.at)) {
          older.push(inputKey);
          continue;
        }
        const parts: LinkBlackHole = { ...(device.blackHole[cid] ?? {}) };
        parts.today = { at: row.at, value: row.value, op: row.op };
        device.blackHole[cid] = parts;
        device.watermarks[inputKey] = { at: row.at, value: row.value, op: row.op };
        touchedBh.add(cid);
      }
      continue;
    }

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
    if (isPinned(device, key)) {
      pinned.push(key);
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
      parts.weekly = { at: row.at, value: row.value, op: row.op };
      device.blackHole[cid] = parts;
      device.watermarks[inputKey] = { at: row.at, value: row.value, op: row.op };
      touchedBh.add(cid);
      continue;
    }

    if (!stampOk(device.watermarks[key], row.at)) {
      older.push(key);
      continue;
    }
    if (row.task === BLACK_HOLE_DAILY && cid) {
      const parts: LinkBlackHole = { ...(device.blackHole[cid] ?? {}) };
      parts.daily = { at: row.at, value: row.value >= 1, op: row.op };
      device.blackHole[cid] = parts;
      touchedBh.add(cid);
    }
    const value = normalizeValue(target, row.value, row.kind);
    if (value === null) {
      unresolved.push({ taskId: row.task, op: row.op, reason: "unknown-task" });
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
    device.watermarks[key] = { at: row.at, value };
  }

  for (const cid of touchedBh) {
    if (blockedBh.has(cid)) continue;
    const composite = blackHoleWrites(
      cid,
      device,
      input.characters,
      input.customTasks,
      nowMs
    );
    if (!composite) continue;
    push(composite.write);
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
    pinned,
    older,
    oldCycle,
  };
}
