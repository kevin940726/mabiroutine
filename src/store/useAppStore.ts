import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { BUILTIN_TASKS } from "@/data/builtin";
import barterJson from "@/data/barter.json";
import type { AppState, Character, Task, BarterPriority } from "@/lib/types";
import { shouldDailyReset, shouldWeeklyReset, getTaipeiDateKey, getTaipeiWeekKey } from "@/lib/reset";

type BarterJsonItem = (typeof barterJson)[number];

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function defaultChar(name: string): Character {
  return { id: uid(), name, taskValues: {}, hiddenTaskIds: [] };
}

function getEffectivePins(state: AppState, charId: string): string[] {
  if (state.isBarterForked && state.barterPinsByChar) return state.barterPinsByChar[charId] ?? [];
  return state.barterPins;
}

function applyResets(state: AppState): Partial<AppState> {
  const now = new Date();
  const patch: Partial<AppState> = {};
  // daily bucket for per-char daily tasks
  const pHour = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    hour12: false,
  }).format(now);
  // use helper
  const shouldDaily = shouldDailyReset(state.lastDailyReset, now);
  const shouldWeekly = shouldWeeklyReset(state.lastWeeklyReset, now);

  if (shouldDaily) {
    const p = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour12: false,
    }).format(now);
    // Compute bucket key
    const bucket = (() => {
      const hour = Number(pHour);
      if (hour >= 6) return getTaipeiDateKey(now);
      const y = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      return getTaipeiDateKey(y);
    })();
    patch.lastDailyReset = bucket;
    // reset daily tasks for all characters + account-daily
    state.characters.forEach((c) => {
      for (const t of [...BUILTIN_TASKS, ...state.customTasks]) {
        if (t.kind === "daily") delete c.taskValues[t.id];
        // also barter pinned tasks that are daily
        if (t.source === "barter" && t.kind === "daily") delete c.taskValues[t.id];
      }
      const pins = getEffectivePins(state, c.id);
      for (const pid of pins) delete c.taskValues[pid];
      // fallback for any barter json id
      for (const b of barterJson as BarterJsonItem[]) delete c.taskValues[b.id];
    });
    // account daily
    for (const t of [...BUILTIN_TASKS, ...state.customTasks]) {
      if (t.kind === "account-daily") delete state.accountValues[t.id];
    }
    void p;
  }
  if (shouldWeekly) {
    patch.lastWeeklyReset = getTaipeiWeekKey(now);
    state.characters.forEach((c) => {
      for (const t of [...BUILTIN_TASKS, ...state.customTasks]) {
        if (t.kind === "weekly") delete c.taskValues[t.id];
      }
    });
    for (const t of [...BUILTIN_TASKS, ...state.customTasks]) {
      if (t.kind === "account-weekly") delete state.accountValues[t.id];
    }
  }
  return Object.keys(patch).length ? patch : {};
}

type Store = AppState & {
  // actions
  _hasHydrated: boolean;
  setHasHydrated: (v: boolean) => void;
  checkResets: () => void;
  getActiveChar: () => Character | undefined;
  setActiveChar: (id: string) => void;
  addCharacter: (name?: string) => void;
  removeCharacter: (id: string) => void;
  renameCharacter: (id: string, name: string) => void;

  toggleCheck: (taskId: string, isAccount: boolean) => void;
  setCounter: (taskId: string, value: number, isAccount: boolean) => void;
  incCounter: (taskId: string, delta: number, isAccount: boolean) => void;

  clearSection: (section: "daily" | "weekly" | "account", kind?: string) => void;

  // barter pins: tap = per-acc (global), hold/right-click = per-char (fork auto)
  toggleBarterPin: (barterId: string) => void; // per-acc (tap)
  toggleBarterPinForChar: (barterId: string) => void; // per-char (hold/right-click)
  pinBarterToAll: (barterId: string) => void;
  unpinBarterFromAll: (barterId: string) => void;
  getEffectivePinsForActive: () => string[];
  getPinScope: (barterId: string) => "shared" | "personal" | "none";
  isForked: () => boolean;
  mergePinsToShared: () => void;
  addCustomTask: (task: Omit<Task, "id" | "order" | "source">) => void;
  updateCustomTask: (id: string, patch: Partial<Task>) => void;
  removeCustomTask: (id: string) => void;
  toggleHidden: (taskId: string) => void;
  reorderTasks: (orderedIds: string[]) => void;
  reorderBarterPins: (orderedIds: string[]) => void;

  exportJson: () => string;
  importJson: (json: string) => void;
  resetAll: () => void;
};

// Build tasks from barter json for pinning: they become Tasks lazily
export function barterToTask(b: BarterJsonItem): Task {
  // 每日 N 次：N>1 → counter（每角色每天 N 次）；N=1 或 不限次數 → check
  const dayCount = Number((b.limit ?? "").match(/每日\s*(\d+)\s*次/)?.[1] ?? 0);
  const isCounter = dayCount > 1;
  return {
    id: b.id,
    name: b.name,
    icon: "🔄",
    desc: `${b.give} → ${b.get} · ${b.town} · ${b.gatherSkill}`,
    section: "daily",
    kind: "daily",
    type: isCounter ? "counter" : "check",
    max: isCounter ? dayCount : undefined,
    source: "barter",
    town: b.town,
    priority: b.priority as BarterPriority,
    npc: (b as unknown as { npc?: string }).npc,
    barterMeta: { give: b.give, get: b.get, gatherSkill: b.gatherSkill, limit: b.limit },
    order: 80, // after builtins daily but before weekly
  };
}

const DEFAULT_MUST_PINS: string[] = (barterJson as BarterJsonItem[]).filter((b) => b.priority === "must").map((b) => b.id);

const initial: AppState = {
  version: 5,
  characters: [defaultChar("角色 1")],
  activeCharId: "",
  accountValues: {},
  barterPins: [...DEFAULT_MUST_PINS],
  barterPinsByChar: undefined,
  isBarterForked: false,
  customTasks: [],
  lastDailyReset: null,
  lastWeeklyReset: null,
  prefs: { hideCompleted: false },
};

export const useAppStore = create<Store>()(
  persist(
    (set, get) => ({
      ...initial,
      activeCharId: initial.characters[0].id,
      _hasHydrated: false,
      setHasHydrated: (v) => set({ _hasHydrated: v }),

      checkResets: () => {
        const state = get();
        const patch = applyResets(state);
        if (Object.keys(patch).length) set(patch);
      },

      getActiveChar: () => {
        const s = get();
        return s.characters.find((c) => c.id === s.activeCharId) ?? s.characters[0];
      },
      setActiveChar: (id) => set({ activeCharId: id }),
      addCharacter: (name) =>
        set((s) => {
          if (s.characters.length >= 6) return s;
          const n = name?.trim() || `角色 ${s.characters.length + 1}`;
          const c = defaultChar(n);
          // if forked, new char gets empty pins (clean), otherwise inherits shared
          let nextByChar = s.barterPinsByChar;
          if (s.isBarterForked) {
            nextByChar = { ...(s.barterPinsByChar ?? {}), [c.id]: [] };
          }
          return { characters: [...s.characters, c], activeCharId: c.id, barterPinsByChar: nextByChar };
        }),
      removeCharacter: (id) =>
        set((s) => {
          if (s.characters.length <= 1) return s;
          const chars = s.characters.filter((c) => c.id !== id);
          const active = s.activeCharId === id ? chars[0].id : s.activeCharId;
          const nextByChar = s.barterPinsByChar ? { ...s.barterPinsByChar } : undefined;
          if (nextByChar) delete nextByChar[id];
          return { characters: chars, activeCharId: active, barterPinsByChar: nextByChar };
        }),
      renameCharacter: (id, name) =>
        set((s) => ({
          characters: s.characters.map((c) => (c.id === id ? { ...c, name: name.trim() || c.name } : c)),
        })),

      toggleCheck: (taskId, isAccount) =>
        set((s) => {
          if (isAccount) {
            const cur = s.accountValues[taskId];
            const next = { ...s.accountValues };
            if (cur) delete next[taskId];
            else next[taskId] = true;
            return { accountValues: next };
          }
          const char = s.characters.find((c) => c.id === s.activeCharId);
          if (!char) return s;
          const cur = char.taskValues[taskId];
          const nextVal = cur ? undefined : true;
          return {
            characters: s.characters.map((c) =>
              c.id === s.activeCharId
                ? {
                    ...c,
                    taskValues: nextVal === undefined
                      ? Object.fromEntries(Object.entries(c.taskValues).filter(([k]) => k !== taskId))
                      : { ...c.taskValues, [taskId]: true },
                  }
                : c
            ),
          };
        }),

      setCounter: (taskId, value, isAccount) =>
        set((s) => {
          const clamped = Math.max(0, value);
          if (isAccount) {
            const next = { ...s.accountValues };
            if (clamped === 0) delete next[taskId];
            else next[taskId] = clamped;
            return { accountValues: next };
          }
          return {
            characters: s.characters.map((c) =>
              c.id === s.activeCharId
                ? {
                    ...c,
                    taskValues:
                      clamped === 0
                        ? Object.fromEntries(Object.entries(c.taskValues).filter(([k]) => k !== taskId))
                        : { ...c.taskValues, [taskId]: clamped },
                  }
                : c
            ),
          };
        }),
      incCounter: (taskId, delta, isAccount) => {
        const s = get();
        const isAcc = isAccount;
        const cur = isAcc ? (s.accountValues[taskId] as number) ?? 0 : ((s.getActiveChar()?.taskValues[taskId] as number) ?? 0);
        // need max
        const task = [...BUILTIN_TASKS, ...s.customTasks, ...(barterJson as BarterJsonItem[]).map(barterToTask)].find(
          (t) => t.id === taskId
        );
        const max = task?.max ?? 999;
        const next = Math.min(max, Math.max(0, cur + delta));
        get().setCounter(taskId, next, isAcc);
      },

      clearSection: (section, kind) =>
        set((s) => {
          // daily/weekly -> per char active; account -> accountValues
          if (section === "account") {
            const nextAcc = { ...s.accountValues };
            for (const t of [...BUILTIN_TASKS, ...s.customTasks]) {
              if (t.section !== "account") continue;
              if (kind && t.kind !== kind) continue;
              delete nextAcc[t.id];
            }
            return { accountValues: nextAcc };
          }
          const char = s.getActiveChar();
          if (!char) return s;
          const idsToClear = new Set<string>();
          for (const t of [...BUILTIN_TASKS, ...s.customTasks]) {
            if (t.section !== section) continue;
            idsToClear.add(t.id);
          }
          // also barter pins considered daily
          if (section === "daily") {
            const pins = getEffectivePins(s, char.id);
            for (const pid of pins) idsToClear.add(pid);
          }
          const nextChars = s.characters.map((c) =>
            c.id === s.activeCharId
              ? { ...c, taskValues: Object.fromEntries(Object.entries(c.taskValues).filter(([k]) => !idsToClear.has(k))) }
              : c
          );
          return { characters: nextChars };
        }),

      // tap = per-acc (global). Before fork mutates base, after fork adds/removes on every char
      toggleBarterPin: (barterId) =>
        set((s) => {
          if (s.isBarterForked && s.barterPinsByChar) {
            const hasOnAll = s.characters.every((c) => (s.barterPinsByChar![c.id] ?? []).includes(barterId));
            if (hasOnAll) {
              // remove from all
              const next: Record<string, string[]> = {};
              for (const c of s.characters) next[c.id] = (s.barterPinsByChar[c.id] ?? []).filter((x) => x !== barterId);
              return { barterPinsByChar: next };
            }
            // add to all where missing
            const next: Record<string, string[]> = {};
            for (const c of s.characters) {
              const list = s.barterPinsByChar[c.id] ?? [];
              next[c.id] = list.includes(barterId) ? list : [...list, barterId];
            }
            return { barterPinsByChar: next };
          }
          // not forked → mutate base
          return {
            barterPins: s.barterPins.includes(barterId) ? s.barterPins.filter((x) => x !== barterId) : [...s.barterPins, barterId],
          };
        }),

      // hold/right-click = per-char (personal). Auto-fork on first use: copy base to each char
      toggleBarterPinForChar: (barterId) =>
        set((s) => {
          const activeId = s.activeCharId;
          if (!s.isBarterForked || !s.barterPinsByChar) {
            // fork: clone base to each char
            const byChar: Record<string, string[]> = {};
            for (const c of s.characters) byChar[c.id] = [...s.barterPins];
            const list = byChar[activeId] ?? [];
            byChar[activeId] = list.includes(barterId) ? list.filter((x) => x !== barterId) : [...list, barterId];
            return { isBarterForked: true, barterPinsByChar: byChar };
          }
          const list = s.barterPinsByChar[activeId] ?? [];
          return {
            barterPinsByChar: {
              ...s.barterPinsByChar,
              [activeId]: list.includes(barterId) ? list.filter((x) => x !== barterId) : [...list, barterId],
            },
          };
        }),

      pinBarterToAll: (barterId) =>
        set((s) => {
          if (s.isBarterForked && s.barterPinsByChar) {
            const next: Record<string, string[]> = {};
            for (const c of s.characters) {
              const list = s.barterPinsByChar[c.id] ?? [];
              next[c.id] = list.includes(barterId) ? list : [...list, barterId];
            }
            return { barterPinsByChar: next };
          }
          if (!s.barterPins.includes(barterId)) return { barterPins: [...s.barterPins, barterId] };
          return s;
        }),

      unpinBarterFromAll: (barterId) =>
        set((s) => {
          if (s.isBarterForked && s.barterPinsByChar) {
            const next: Record<string, string[]> = {};
            for (const c of s.characters) next[c.id] = (s.barterPinsByChar[c.id] ?? []).filter((x) => x !== barterId);
            return { barterPinsByChar: next };
          }
          return { barterPins: s.barterPins.filter((x) => x !== barterId) };
        }),

      getEffectivePinsForActive: () => {
        const s = get();
        const activeId = s.activeCharId;
        return getEffectivePins(s, activeId);
      },

      getPinScope: (barterId) => {
        const s = get();
        if (s.isBarterForked && s.barterPinsByChar) {
          const list = s.barterPinsByChar[s.activeCharId] ?? [];
          if (!list.includes(barterId)) return "none";
          // check if pinned on all chars → could be considered shared even though forked, but show as personal
          return "personal";
        }
        return s.barterPins.includes(barterId) ? "shared" : "none";
      },

      isForked: () => !!get().isBarterForked,

      mergePinsToShared: () =>
        set((s) => {
          if (!s.isBarterForked || !s.barterPinsByChar) return s;
          // merge = union of all chars' pins → new base, def fork
          const union = [...new Set(Object.values(s.barterPinsByChar).flat())];
          return { barterPins: union, barterPinsByChar: undefined, isBarterForked: false };
        }),

      addCustomTask: (task) =>
        set((s) => {
          const id = `custom-${uid()}`;
          const order = Math.max(0, ...BUILTIN_TASKS.map((t) => t.order), ...s.customTasks.map((t) => t.order)) + 10;
          const newTask: Task = { ...task, id, order, source: "custom" } as Task;
          return { customTasks: [...s.customTasks, newTask] };
        }),
      updateCustomTask: (id, patch) =>
        set((s) => ({
          customTasks: s.customTasks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
        })),
      removeCustomTask: (id) =>
        set((s) => {
          const nextByChar = s.barterPinsByChar
            ? Object.fromEntries(Object.entries(s.barterPinsByChar).map(([k, v]) => [k, (v as string[]).filter((x) => x !== id)]))
            : undefined;
          return {
            customTasks: s.customTasks.filter((t) => t.id !== id),
            // also clean values
            characters: s.characters.map((c) => ({
              ...c,
              taskValues: Object.fromEntries(Object.entries(c.taskValues).filter(([k]) => k !== id)),
              hiddenTaskIds: c.hiddenTaskIds.filter((x) => x !== id),
            })),
            accountValues: Object.fromEntries(Object.entries(s.accountValues).filter(([k]) => k !== id)),
            barterPins: s.barterPins.filter((x) => x !== id),
            barterPinsByChar: nextByChar,
          };
        }),
      toggleHidden: (taskId) =>
        set((s) => {
          const char = s.getActiveChar();
          if (!char) return s;
          const isHidden = char.hiddenTaskIds.includes(taskId);
          return {
            characters: s.characters.map((c) =>
              c.id === s.activeCharId
                ? { ...c, hiddenTaskIds: isHidden ? c.hiddenTaskIds.filter((x) => x !== taskId) : [...c.hiddenTaskIds, taskId] }
                : c
            ),
          };
        }),
      reorderTasks: (orderedIds) =>
        set((s) => {
          const map: Record<string, number> = {};
          orderedIds.forEach((id, idx) => (map[id] = (idx + 1) * 10));
          // apply to customTasks order, and store global order for builtins
          return {
            customTasks: s.customTasks.map((t) => ({ ...t, order: map[t.id] ?? t.order })),
            globalTaskOrder: { ...(s.globalTaskOrder ?? {}), ...map },
          };
        }),

      reorderBarterPins: (orderedIds) =>
        set((s) => {
          if (s.isBarterForked && s.barterPinsByChar) {
            const activeId = s.activeCharId;
            const current = s.barterPinsByChar[activeId] ?? [];
            // keep only ids that are in orderedIds and preserve order, append any missing
            const ordered = orderedIds.filter((id) => current.includes(id));
            const missing = current.filter((id) => !ordered.includes(id));
            return {
              barterPinsByChar: { ...s.barterPinsByChar, [activeId]: [...ordered, ...missing] },
            };
          }
          const ordered = orderedIds.filter((id) => s.barterPins.includes(id));
          const missing = s.barterPins.filter((id) => !ordered.includes(id));
          return { barterPins: [...ordered, ...missing] };
        }),

      exportJson: () => JSON.stringify(get(), null, 2),
      importJson: (json) => {
        try {
          const data = JSON.parse(json);
          // basic validation
          if (!data.characters || !Array.isArray(data.characters)) throw new Error("invalid");
          set({ ...data, _hasHydrated: true });
        } catch (e) {
          alert("匯入失敗：JSON 格式錯誤");
          console.error(e);
        }
      },
      resetAll: () => {
        if (!confirm("確定重置所有資料？此動作無法復原。")) return;
        const fresh = defaultChar("角色 1");
        set({
          ...initial,
          characters: [fresh],
          activeCharId: fresh.id,
          customTasks: [],
          barterPins: [...DEFAULT_MUST_PINS],
          barterPinsByChar: undefined,
          isBarterForked: false,
          accountValues: {},
          lastDailyReset: null,
          lastWeeklyReset: null,
        });
      },
    }),
    {
      name: "mabiroutine:v2",
      storage: createJSONStorage(() => localStorage),
      version: 5,
      migrate: (persisted: unknown, version: number) => {
        const s = persisted as AppState & { version?: number };
        if (version < 3) {
          // v2 → v3: ensure new fields exist
          s.isBarterForked = s.isBarterForked ?? false;
          s.barterPinsByChar = s.barterPinsByChar ?? undefined;
          s.version = 3;
        }
        if (version < 4) {
          // v3 → v4: seed 每日必做 defaults (must) if empty and not forked
          const hasPins = (s.barterPins && s.barterPins.length > 0) || (s.barterPinsByChar && Object.values(s.barterPinsByChar).some((a) => (a as string[]).length > 0));
          if (!hasPins && !s.isBarterForked) {
            s.barterPins = [...DEFAULT_MUST_PINS];
          }
          s.version = 4;
        }
        if (version < 5) {
          // v4 → v5: barter.json switched from synthetic barter-001..030 (30 rows) to notebook TW 70 (tir-*/dug-*/dun-*).
          // Old synthetic ids are all stale (startWith barter-), reseed to new must (10) so 一定要換/必換 appears by default.
          const valid = new Set((barterJson as BarterJsonItem[]).map((b) => b.id));
          const hasSynthetic = (arr: string[]) => arr.some((id) => id.startsWith("barter-"));
          if (s.barterPins && (hasSynthetic(s.barterPins) || s.barterPins.some((id) => !valid.has(id)))) {
            const filtered = s.barterPins.filter((id) => valid.has(id));
            // if any synthetic or >50% invalid, reseed to must defaults
            if (hasSynthetic(s.barterPins) || filtered.length === 0 || filtered.length < s.barterPins.length / 2) {
              s.barterPins = [...DEFAULT_MUST_PINS];
            } else {
              s.barterPins = filtered;
            }
          }
          if (s.barterPinsByChar) {
            for (const [k, arr] of Object.entries(s.barterPinsByChar)) {
              const a = arr as string[];
              if (hasSynthetic(a) || a.some((id) => !valid.has(id))) {
                const filtered = a.filter((id) => valid.has(id));
                if (hasSynthetic(a) || filtered.length === 0 || filtered.length < a.length / 2) {
                  s.barterPinsByChar[k] = [...DEFAULT_MUST_PINS];
                } else {
                  s.barterPinsByChar[k] = filtered;
                }
              }
            }
          }
          // if still empty and not forked, seed must
          const hasPinsNow =
            (s.barterPins && s.barterPins.length > 0) ||
            (s.barterPinsByChar && Object.values(s.barterPinsByChar).some((a) => (a as string[]).length > 0));
          if (!hasPinsNow && !s.isBarterForked) s.barterPins = [...DEFAULT_MUST_PINS];
          s.version = 5;
        }
        return s as AppState;
      },
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
        // fix activeCharId if missing
        if (state && !state.characters.find((c) => c.id === state.activeCharId)) {
          state.activeCharId = state.characters[0]?.id ?? "";
        }
        // ensure forked map consistent with chars
        if (state?.isBarterForked && state.barterPinsByChar) {
          for (const c of state.characters) if (!(c.id in state.barterPinsByChar)) state.barterPinsByChar[c.id] = [];
          for (const k of Object.keys(state.barterPinsByChar)) if (!state.characters.find((c) => c.id === k)) delete state.barterPinsByChar[k];
        }
        // cap 6 chars
        if (state && state.characters.length > 6) state.characters = state.characters.slice(0, 6);
        // trigger reset check
        setTimeout(() => state?.checkResets(), 0);
      },
      partialize: (s) => ({
        version: s.version,
        characters: s.characters,
        activeCharId: s.activeCharId,
        accountValues: s.accountValues,
        barterPins: s.barterPins,
        barterPinsByChar: s.barterPinsByChar,
        isBarterForked: s.isBarterForked,
        customTasks: s.customTasks,
        lastDailyReset: s.lastDailyReset,
        lastWeeklyReset: s.lastWeeklyReset,
        prefs: s.prefs,
        globalTaskOrder: s.globalTaskOrder,
      }),
    }
  )
);
