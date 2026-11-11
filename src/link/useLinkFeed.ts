import { useCallback, useEffect, useRef } from "react";
import { useAppStore } from "@/store/useAppStore";
import { applyLinkRows } from "@/lib/link/apply";
import { activeCid, planIdentities } from "@/lib/link/identity";
import { loadLinkDevice, saveLinkDevice } from "@/lib/link/device";
import type { LinkHello, LinkMessage } from "@/lib/link/protocol";
import { LinkClient } from "@/link/client";
import { setLinkStatus } from "@/link/status";
import type { LinkPhase } from "@/link/status";

export function useLinkFeed(): void {
  const client = useRef<LinkClient | null>(null);

  useEffect(() => {
    return () => {
      client.current?.stop();
      client.current = null;
    };
  }, []);

  const apply = useCallback((message: LinkMessage) => {
    if (message.type !== "snapshot" && message.type !== "delta") return;
    let current = loadLinkDevice();
    let state = useAppStore.getState();

    if (message.type === "snapshot" && message.characters.length) {
      const plan = planIdentities(state.characters, message.characters, current.match);
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
  }, []);

  const onPhase = useCallback((phase: LinkPhase) => {
    setLinkStatus({ phase });
  }, []);

  const onHello = useCallback((producer: LinkHello["producer"]) => {
    console.info("[link] connected", producer.version, producer.id, producer.mode);
  }, []);

  useEffect(() => {
    if (client.current) return;
    const current = loadLinkDevice();
    const id = window.setTimeout(() => {
      if (client.current) return;
      client.current = new LinkClient(current.token, {
        onMessage: apply,
        onPhase,
        onHello,
      });
      client.current.start();
    }, 0);
    return () => window.clearTimeout(id);
  }, [apply, onPhase, onHello]);
}
