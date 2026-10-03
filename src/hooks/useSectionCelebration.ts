// Fires the section-completion celebration on live incomplete → complete
// transitions only: arming silently on first sight means reloads, character
// switches onto already-done sections, and post-reset states never fire.
// State is keyed per character (daily/weekly) plus one shared account key,
// and nothing persists — a reset or clear disarms by dropping done below all.
import { useEffect, useMemo, useRef } from "react";
import { useAppStore } from "@/store/useAppStore";
import {
  celebrateSection,
  isSectionComplete,
  noteCelebrationPointer,
  type CelebrationSnapshot,
} from "@/lib/confetti";
import type { TaskSection } from "@/lib/types";

const SCOPES: TaskSection[] = ["daily", "weekly", "account"];

export function useSectionCelebration(enabled: boolean): void {
  const customTasks = useAppStore((s) => s.customTasks);
  const barterPins = useAppStore((s) => s.barterPins);
  const characters = useAppStore((s) => s.characters);
  const activeCharId = useAppStore((s) => s.activeCharId);
  const accountValues = useAppStore((s) => s.accountValues);
  const hiddenAccountTaskIds = useAppStore((s) => s.hiddenAccountTaskIds);

  const snapshot: CelebrationSnapshot = useMemo(
    () => ({
      customTasks,
      barterPins,
      characters,
      activeCharId,
      accountValues,
      hiddenAccountTaskIds,
    }),
    [customTasks, barterPins, characters, activeCharId, accountValues, hiddenAccountTaskIds]
  );

  const complete = useMemo(() => {
    if (!enabled) return null;
    const char = characters.find((c) => c.id === activeCharId) ?? characters[0];
    const out: Record<string, boolean> = { account: isSectionComplete("account", snapshot) };
    for (const scope of SCOPES) {
      if (scope === "account") continue;
      out[`${char?.id ?? "none"}:${scope}`] = isSectionComplete(scope, snapshot);
    }
    return out;
  }, [enabled, snapshot, characters, activeCharId]);

  const prev = useRef<Record<string, boolean> | null>(null);
  useEffect(() => {
    if (complete === null) {
      prev.current = null;
      return;
    }
    if (prev.current === null) {
      prev.current = complete;
      return;
    }
    for (const [key, done] of Object.entries(complete)) {
      if (done && !prev.current[key]) {
        celebrateSection(key === "account" ? "account" : (key.split(":")[1] as TaskSection), snapshot);
      }
    }
    prev.current = complete;
  }, [complete, snapshot]);

  useEffect(() => {
    const onUp = (e: PointerEvent) => noteCelebrationPointer(e.clientX, e.clientY);
    window.addEventListener("pointerup", onUp);
    return () => window.removeEventListener("pointerup", onUp);
  }, []);
}
