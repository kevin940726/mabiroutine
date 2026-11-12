import { useAppStore } from "@/store/useAppStore";
import { applyLinkRows } from "@/lib/link/apply";
import { activeCid, planIdentities } from "@/lib/link/identity";
import { loadLinkDevice, saveLinkDevice } from "@/lib/link/device";
import type { LinkHello, LinkMessage } from "@/lib/link/protocol";
import { LinkClient } from "@/link/client";
import { setLinkStatus } from "@/link/status";
import type { LinkPhase } from "@/link/status";
import { watchLinkPermission, type BlockedPermission } from "@/link/permission";

let client: LinkClient | null = null;
let unwatch: (() => void) | null = null;
let watching = false;

function onMessage(message: LinkMessage): void {
  if (message.type !== "snapshot" && message.type !== "delta") return;
  let current = loadLinkDevice();
  let state = useAppStore.getState();

  if (message.type === "snapshot" && message.characters.length) {
    const plan = planIdentities(
      state.characters,
      message.characters,
      current.match,
      message.active?.gameId
    );
    let created: { cid: string; name: string }[] = [];
    if (plan.renames.length || plan.creates.length) {
      created = state.adoptLinkIdentities({
        renames: plan.renames.map((r) => ({ cid: r.cid, name: r.name })),
        creates: plan.creates.map((c) => ({ name: c.name })),
      }).created;
    }
    const match = { ...current.match };
    for (const b of plan.bindings) match[String(b.gameId)] = b.cid;
    plan.creates.forEach((c, i) => {
      const made = created[i];
      if (made) match[String(c.gameId)] = made.cid;
    });
    if (JSON.stringify(match) !== JSON.stringify(current.match)) {
      current = { ...current, match };
      saveLinkDevice(current);
    }
    state = useAppStore.getState();
  }

  const result = applyLinkRows({
    rows: message.rows,
    characters: state.characters,
    accountValues: state.accountValues,
    taskBuckets: state.taskBuckets,
    customTasks: state.customTasks,
    barterPins: state.barterPins,
    device: current,
  });
  if (result.writes.length) state.applyLinkWrites(result.writes);
  saveLinkDevice(result.device);
  setLinkStatus({ lastFrameAt: message.lastFrameAt });

  if (result.unresolved.length || result.oldCycle.length) {
    console.info("[link] refused", {
      unresolved: result.unresolved,
      oldCycle: result.oldCycle,
    });
  }

  if (message.active) {
    const now = useAppStore.getState();
    const cid = activeCid(message.active, result.device.match, now.characters);
    if (cid && cid !== now.activeCharId) now.setActiveChar(cid);
  }
}

function onPhase(phase: LinkPhase): void {
  setLinkStatus({ phase, permission: null });
}

function onPermission(permission: BlockedPermission): void {
  setLinkStatus({ phase: "permission", permission });
  if (watching) return;
  watching = true;
  void watchLinkPermission((state) => {
    if (state === "denied") {
      setLinkStatus({ phase: "permission", permission: "denied" });
      return;
    }
    if (state !== "granted") return;
    unwatch?.();
    unwatch = null;
    watching = false;
    restartLinkFeed();
  }).then((stop) => {
    if (!watching) {
      stop();
      return;
    }
    unwatch = stop;
  });
}

function onHello(producer: LinkHello["producer"]): void {
  console.info("[link] connected", producer.version, producer.id, producer.mode);
}

export function startLinkFeed(): void {
  if (client) return;
  client = new LinkClient(loadLinkDevice().token, {
    onMessage,
    onPhase,
    onPermission,
    onHello,
  });
  client.start();
}

export function restartLinkFeed(): void {
  if (client) client.start();
  else startLinkFeed();
}

export function stopLinkFeed(): void {
  unwatch?.();
  unwatch = null;
  watching = false;
  client?.stop();
  client = null;
}
