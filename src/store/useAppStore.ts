import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import trackerJson from "@/data/tracker.json";
import barterJson from "@/data/barter.json";
import defaultPinsJson from "@/data/defaultPins.json";
import type { AppState, BarterFilters, Character, Task, BarterPriority } from "@/lib/types";
import { shouldDailyReset, shouldWeeklyReset, getTaipeiWeekKey, currentDailyBucket } from "@/lib/reset";
import { cycleBucketFor } from "@/lib/cycle";
import { idleStorage } from "@/lib/storage";

const BUILTIN_TASKS = trackerJson as Task[];

type BarterJsonItem = (typeof barterJson)[number];

// Account-section tasks are shared state (accountValues), so hiding one hides
// it for every character. Everything else hides per character.
function isAccountTaskId(id: string, customTasks: Task[]): boolean {
  const t = [...BUILTIN_TASKS, ...customTasks].find((x) => x.id === id);
  return t?.section === "account";
}

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function defaultChar(name: string): Character {
  return { id: uid(), name, taskValues: {}, hiddenTaskIds: [] };
}

// Local memory expiry: drop values whose cycle bucket rolled over.
// MEMORY-ONLY by design — bucketed sync keys expire at read time and are
// GC'd server-side; these deletions never propagate (no tombstones, no
// markers, no suppression). Runs on every checkResets tick (idempotent,
// cheap) — a device waking at any hour prunes exactly its stale values.
function applyResets(state: AppState): Partial<AppState> {
  const now = new Date();
  const patch: Partial<AppState> = {};
  if (shouldDailyReset(state.lastDailyReset, now)) patch.lastDailyReset = currentDailyBucket(now);
  if (shouldWeeklyReset(state.lastWeeklyReset, now)) patch.lastWeeklyReset = getTaipeiWeekKey(now);

  const keep = (tid: string): boolean => {
    const b = state.taskBuckets[tid];
    return b === undefined || b === cycleBucketFor(tid, state.customTasks, now);
  };
  const changedChars = state.characters.some(
    (c) => Object.keys(c.taskValues).some((tid) => !keep(tid))
  );
  const changedAcc = Object.keys(state.accountValues).some((tid) => !keep(tid));
  const staleBucketTids = Object.keys(state.taskBuckets).filter((tid) => !keep(tid));
  if (changedChars) {
    patch.characters = state.characters.map((c) => ({
      ...c,
      taskValues: Object.fromEntries(Object.entries(c.taskValues).filter(([tid]) => keep(tid))),
    }));
  }
  if (changedAcc) {
    patch.accountValues = Object.fromEntries(
      Object.entries(state.accountValues).filter(([tid]) => keep(tid))
    );
  }
  if (staleBucketTids.length) {
    const taskBuckets = { ...state.taskBuckets };
    for (const tid of staleBucketTids) delete taskBuckets[tid];
    patch.taskBuckets = taskBuckets;
  }
  if (
    !changedChars &&
    !changedAcc &&
    !staleBucketTids.length &&
    !patch.lastDailyReset &&
    !patch.lastWeeklyReset
  ) {
    return {};
  }
  return patch;
}

type Store = AppState & {
  // actions
  _hasHydrated: boolean;
  setHasHydrated: (v: boolean) => void;
  // Runs due local resets (memory-only expiry — see applyResets). Prefer
  // syncAndResets, which pulls first so a late wake adopts the peer's
  // current-bucket values before expiring stale local ones.
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

  // barter pins: single global list, one tap toggles for every character
  toggleBarterPin: (barterId: string) => void;
  isBarterPinned: (barterId: string) => boolean;
  addCustomTask: (task: Omit<Task, "id" | "order" | "source">) => void;
  updateCustomTask: (id: string, patch: Partial<Task>) => void;
  removeCustomTask: (id: string) => void;
  toggleHidden: (taskId: string) => void;
  // section-aware hide read: account-section ids consult the global list
  isTaskHidden: (taskId: string) => boolean;
  reorderTasks: (orderedIds: string[]) => void;
  reorderBarterPins: (orderedIds: string[]) => void;
  setBarterFilters: (patch: Partial<BarterFilters>) => void;

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

// Default pins are a hand-owned list (src/data/defaultPins.json), NOT derived
// from barter.json priorities — curate it by hand; watch for must-priority
// drift when checking sources by hand.
const DEFAULT_MUST_PINS: string[] = [...new Set((defaultPinsJson.pins ?? []) as string[])].filter((id) =>
  (barterJson as BarterJsonItem[]).some((b) => b.id === id)
);

const DEFAULT_BARTER_FILTERS: BarterFilters = { priority: "all", town: "all", skill: "all", onlyPinned: false };

// Drop stale select values (e.g. a town removed from barter.json) back to "all".
function sanitizeBarterFilters(f: unknown): BarterFilters {
  const r = (f ?? {}) as Partial<BarterFilters>;
  const prios = ["all", "must", "extra", "once", "situational", "skip"];
  const towns = new Set(["all", ...(barterJson as BarterJsonItem[]).map((b) => b.town)]);
  return {
    priority: (prios.includes(r.priority as string) ? r.priority : "all") as BarterFilters["priority"],
    town: towns.has(r.town as string) ? (r.town as string) : "all",
    // skill filter removed from UI (gatherSkill was source-copied noise):
    // pin stale saves to "all" so nobody is trapped in a filter with no control
    skill: "all",
    onlyPinned: r.onlyPinned === true,
  };
}

const initial: AppState = {
  version: 13,
  characters: [defaultChar("角色 1")],
  activeCharId: "",
  accountValues: {},
  hiddenAccountTaskIds: [],
  barterPins: [...DEFAULT_MUST_PINS],
  customTasks: [],
  lastDailyReset: null,
  lastWeeklyReset: null,
  prefs: { hideCompleted: false },
  barterFilters: { ...DEFAULT_BARTER_FILTERS },
  taskBuckets: {},
};

// Cycle provenance normalize: every existing value gets a bucket entry
// (current bucket — values without provenance are current-cycle by
// definition, e.g. v12 saves), stale-bucket values are pruned (memory-only
// reset — the sync layer never deletes cycle keys), orphan bucket entries
// dropped. Runs on every load AND import.
function normalizeTaskBuckets(
  chars: Character[],
  accountValues: Record<string, number | boolean>,
  customTasks: Task[],
  raw: unknown
): Record<string, string> {
  const inRaw = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: Record<string, string> = {};
  const now = new Date();
  const consider = (tid: string): void => {
    const expected = cycleBucketFor(tid, customTasks, now);
    const stored = typeof inRaw[tid] === "string" ? (inRaw[tid] as string) : undefined;
    if (stored === undefined) out[tid] = expected; // untagged (v12) → current
    else if (stored === expected) out[tid] = stored; // current → keep
    // else stale bucket → prune (value dropped by caller)
  };
  for (const c of chars) for (const tid of Object.keys(c.taskValues)) consider(tid);
  for (const tid of Object.keys(accountValues)) consider(tid);
  return out;
}

function pruneStaleValues(
  chars: Character[],
  accountValues: Record<string, number | boolean>,
  buckets: Record<string, string>
): void {
  for (const c of chars) {
    c.taskValues = Object.fromEntries(
      Object.entries(c.taskValues).filter(([tid]) => buckets[tid] !== undefined)
    );
  }
  const keep = accountValues as Record<string, number | boolean>;
  for (const tid of Object.keys(keep)) {
    if (buckets[tid] === undefined) delete keep[tid];
  }
}

// Backward-compat: fill structural defaults for data that bypassed migrate
// (versionless ancient saves, hand-edited storage, old import backups).
// Runs on every load AND on import — migrate version steps run after this.
function normalizePersisted(input: unknown): AppState {
  const d = (input ?? {}) as Partial<AppState>;
  const chars = Array.isArray(d.characters) && d.characters.length > 0 ? d.characters : [defaultChar("角色 1")];
  for (const c of chars) {
    c.id = typeof c.id === "string" && c.id ? c.id : uid();
    c.name = typeof c.name === "string" && c.name ? c.name : "角色";
    c.taskValues = c.taskValues && typeof c.taskValues === "object" ? c.taskValues : {};
    c.hiddenTaskIds = Array.isArray(c.hiddenTaskIds) ? c.hiddenTaskIds : [];
  }
  const activeOk = chars.some((c) => c.id === d.activeCharId);
  const customTasks: Task[] = Array.isArray(d.customTasks) ? d.customTasks : [];
  const accountValues = d.accountValues && typeof d.accountValues === "object" ? d.accountValues : {};
  const taskBuckets = normalizeTaskBuckets(chars, accountValues, customTasks, d.taskBuckets);
  pruneStaleValues(chars, accountValues, taskBuckets);
  return {
    ...initial,
    ...d,
    version: typeof d.version === "number" ? d.version : 0,
    characters: chars,
    activeCharId: activeOk ? (d.activeCharId as string) : chars[0].id,
    accountValues,
    hiddenAccountTaskIds: Array.isArray(d.hiddenAccountTaskIds) ? d.hiddenAccountTaskIds : [],
    barterPins: Array.isArray(d.barterPins) ? d.barterPins : [...DEFAULT_MUST_PINS],
    customTasks,
    lastDailyReset: d.lastDailyReset ?? null,
    lastWeeklyReset: d.lastWeeklyReset ?? null,
    prefs: { hideCompleted: d.prefs?.hideCompleted ?? false },
    barterFilters: sanitizeBarterFilters(d.barterFilters),
    taskBuckets,
  };
}

// Shared migration runner: normalize shape first (covers versionless ancient
// saves), then run every step newer than the stored version. Used by zustand
// persist on load AND by importJson on backup import — single source of truth.
// Exported for scripts/check-migrations.mjs (agent pre-push gate).
export function migratePersisted(persisted: unknown, version: number): AppState {
  const s = normalizePersisted(persisted) as AppState & { version?: number };
  const from = typeof version === "number" ? version : 0;
  if (from < 3) {
    // v2 → v3: fork fields existed back then; removed in v7 — just stamp.
    s.version = 3;
  }
  if (from < 4) {
    // v3 → v4: seed 每日必做 defaults (must) if empty
    if (!s.barterPins || s.barterPins.length === 0) {
      s.barterPins = [...DEFAULT_MUST_PINS];
    }
    s.version = 4;
  }
  if (from < 5) {
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
    // if still empty, seed must
    if (!s.barterPins || s.barterPins.length === 0) s.barterPins = [...DEFAULT_MUST_PINS];
    s.version = 5;
  }
  if (from < 6) {
    // v5 → v6: prune references to tracker/barter ids that no longer exist
    // (tracker.json/barter.json are hand-edited; rows can be removed).
    // User data always wins — only dangling keys are dropped, values untouched.
    const valid = new Set<string>([
      ...(trackerJson as Task[]).map((t) => t.id),
      ...(barterJson as BarterJsonItem[]).map((b) => b.id),
      ...(s.customTasks ?? []).map((t) => t.id),
    ]);
    const pruneArr = (arr?: string[]) => (arr ?? []).filter((id) => valid.has(id));
    const pruneRec = <T,>(rec?: Record<string, T>) =>
      Object.fromEntries(Object.entries(rec ?? {}).filter(([k]) => valid.has(k))) as Record<string, T>;
    for (const c of s.characters ?? []) {
      c.taskValues = pruneRec(c.taskValues);
      c.hiddenTaskIds = pruneArr(c.hiddenTaskIds);
    }
    s.accountValues = pruneRec(s.accountValues);
    s.hiddenAccountTaskIds = pruneArr(s.hiddenAccountTaskIds);
    s.barterPins = pruneArr(s.barterPins);
    if (s.globalTaskOrder) s.globalTaskOrder = pruneRec(s.globalTaskOrder);
    s.version = 6;
  }
  if (from < 7) {
    // v6 → v7: fork model removed — single global pin list. Reset to must
    // defaults (per human decision); drop legacy fork containers if present.
    s.barterPins = [...DEFAULT_MUST_PINS];
    delete (s as Record<string, unknown>).barterPinsByChar;
    delete (s as Record<string, unknown>).isBarterForked;
    s.version = 7;
  }
  if (from < 8) {
    // v7 → v8: barter explorer filters persisted (sanitized in normalize) — just stamp.
    s.barterFilters = sanitizeBarterFilters(s.barterFilters);
    s.version = 8;
  }
  if (from < 9) {
    // v8 → v9: search text no longer persisted (session-only) — sanitize drops it.
    s.barterFilters = sanitizeBarterFilters(s.barterFilters);
    s.version = 9;
  }
  if (from < 10) {
    // v9 → v10: account-section hide goes global. Move any account ids users
    // hid per-character into hiddenAccountTaskIds (union, progress untouched),
    // strip them from the per-char lists, prune the global list against live ids.
    const validAccount = new Set<string>([
      ...(trackerJson as Task[]).filter((t) => t.section === "account").map((t) => t.id),
      ...(s.customTasks ?? []).filter((t) => t.section === "account").map((t) => t.id),
    ]);
    const global = new Set(s.hiddenAccountTaskIds ?? []);
    for (const c of s.characters ?? []) {
      const keep: string[] = [];
      for (const id of c.hiddenTaskIds ?? []) {
        if (validAccount.has(id)) global.add(id);
        else keep.push(id);
      }
      c.hiddenTaskIds = keep;
    }
    s.hiddenAccountTaskIds = [...global].filter((id) => validAccount.has(id));
    s.version = 10;
  }
  if (from < 11) {
    // v10 → v11: tower flipped check → counter (max 20). A stored boolean
    // can't be read as a count (renders 0) — carry `true` as 20 (done),
    // per user decision. Numbers pass through untouched.
    for (const c of s.characters ?? []) {
      if (c.taskValues?.tower === true) c.taskValues.tower = 20;
    }
    s.version = 11;
  }
  if (from < 12) {
    // v11 → v12: timeGated retired (parttime is now a plain check). Strip the
    // field from custom tasks; carry parttime counts 1/2 as checked `true`
    // (any progress today counts), per user decision. 0 stays unchecked.
    // Also cap stored counts at the live max (daily/weekly-challenge maxes
    // shrank) — anything over the new max clamps down, rest untouched.
    for (const t of s.customTasks ?? []) {
      delete (t as Record<string, unknown>).timeGated;
    }
    const liveMax = new Map<string, number>();
    for (const t of trackerJson as Task[]) {
      if ((t.type === "counter" || t.type === "countdown") && typeof t.max === "number") {
        liveMax.set(t.id, t.max);
      }
    }
    for (const c of s.characters ?? []) {
      const v = c.taskValues?.parttime;
      if (typeof v === "number" && v > 0) c.taskValues.parttime = true;
      if (c.taskValues) {
        for (const [id, val] of Object.entries(c.taskValues)) {
          const m = liveMax.get(id);
          if (typeof val === "number" && m !== undefined && val > m) {
            c.taskValues[id] = m;
          }
        }
      }
    }
    s.version = 12;
  }
  if (from < 13) {
    // v12 → v13: cycle provenance (taskBuckets) for bucketed sync keys.
    // normalizePersisted already assigned the current bucket to every
    // existing value (v12 values are current-cycle by definition) and
    // pruned stale ones — here we only stamp. No values touched.
    s.version = 13;
  }
  return s as AppState;
}

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
          return { characters: [...s.characters, c], activeCharId: c.id };
        }),
      removeCharacter: (id) =>
        set((s) => {
          if (s.characters.length <= 1) return s;
          const chars = s.characters.filter((c) => c.id !== id);
          const active = s.activeCharId === id ? chars[0].id : s.activeCharId;
          return { characters: chars, activeCharId: active };
        }),
      renameCharacter: (id, name) =>
        set((s) => ({
          characters: s.characters.map((c) => (c.id === id ? { ...c, name: name.trim() || c.name } : c)),
        })),

      toggleCheck: (taskId, isAccount) =>
        set((s) => {
          const bucket = cycleBucketFor(taskId, s.customTasks, new Date());
          if (isAccount) {
            const cur = s.accountValues[taskId];
            const next = { ...s.accountValues };
            const nextBuckets = { ...s.taskBuckets };
            if (cur) {
              delete next[taskId];
              delete nextBuckets[taskId];
            } else {
              next[taskId] = true;
              nextBuckets[taskId] = bucket;
            }
            return { accountValues: next, taskBuckets: nextBuckets };
          }
          const char = s.characters.find((c) => c.id === s.activeCharId);
          if (!char) return s;
          const cur = char.taskValues[taskId];
          const nextVal = cur ? undefined : true;
          const nextBuckets = { ...s.taskBuckets };
          if (nextVal === undefined) delete nextBuckets[taskId];
          else nextBuckets[taskId] = bucket;
          return {
            taskBuckets: nextBuckets,
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
          const nextBuckets = { ...s.taskBuckets };
          if (clamped === 0) delete nextBuckets[taskId];
          else nextBuckets[taskId] = cycleBucketFor(taskId, s.customTasks, new Date());
          if (isAccount) {
            const next = { ...s.accountValues };
            if (clamped === 0) delete next[taskId];
            else next[taskId] = clamped;
            return { accountValues: next, taskBuckets: nextBuckets };
          }
          return {
            taskBuckets: nextBuckets,
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
            const nextBuckets = { ...s.taskBuckets };
            for (const t of [...BUILTIN_TASKS, ...s.customTasks]) {
              if (t.section !== "account") continue;
              if (kind && t.kind !== kind) continue;
              delete nextAcc[t.id];
              delete nextBuckets[t.id];
            }
            return { accountValues: nextAcc, taskBuckets: nextBuckets };
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
            for (const pid of s.barterPins) idsToClear.add(pid);
          }
          const nextBuckets = { ...s.taskBuckets };
          for (const id of idsToClear) delete nextBuckets[id];
          const nextChars = s.characters.map((c) =>
            c.id === s.activeCharId
              ? { ...c, taskValues: Object.fromEntries(Object.entries(c.taskValues).filter(([k]) => !idsToClear.has(k))) }
              : c
          );
          return { characters: nextChars, taskBuckets: nextBuckets };
        }),

      // single global list: one tap toggles for every character
      toggleBarterPin: (barterId) =>
        set((s) => ({
          barterPins: s.barterPins.includes(barterId) ? s.barterPins.filter((x) => x !== barterId) : [...s.barterPins, barterId],
        })),

      isBarterPinned: (barterId) => get().barterPins.includes(barterId),

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
          const nextBuckets = { ...s.taskBuckets };
          delete nextBuckets[id];
          return {
            customTasks: s.customTasks.filter((t) => t.id !== id),
            // also clean values
            characters: s.characters.map((c) => ({
              ...c,
              taskValues: Object.fromEntries(Object.entries(c.taskValues).filter(([k]) => k !== id)),
              hiddenTaskIds: c.hiddenTaskIds.filter((x) => x !== id),
            })),
            accountValues: Object.fromEntries(Object.entries(s.accountValues).filter(([k]) => k !== id)),
            hiddenAccountTaskIds: (s.hiddenAccountTaskIds ?? []).filter((x) => x !== id),
            barterPins: s.barterPins.filter((x) => x !== id),
            taskBuckets: nextBuckets,
          };
        }),
      toggleHidden: (taskId) =>
        set((s) => {
          // account-section tasks hide globally (shared state, like accountValues)
          if (isAccountTaskId(taskId, s.customTasks)) {
            const isHidden = (s.hiddenAccountTaskIds ?? []).includes(taskId);
            return {
              hiddenAccountTaskIds: isHidden
                ? s.hiddenAccountTaskIds.filter((x) => x !== taskId)
                : [...s.hiddenAccountTaskIds, taskId],
            };
          }
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
      isTaskHidden: (taskId) => {
        const s = get();
        if (isAccountTaskId(taskId, s.customTasks)) return (s.hiddenAccountTaskIds ?? []).includes(taskId);
        return s.getActiveChar()?.hiddenTaskIds.includes(taskId) ?? false;
      },
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
          const ordered = orderedIds.filter((id) => s.barterPins.includes(id));
          const missing = s.barterPins.filter((id) => !ordered.includes(id));
          return { barterPins: [...ordered, ...missing] };
        }),

      setBarterFilters: (patch) =>
        set((s) => ({ barterFilters: sanitizeBarterFilters({ ...s.barterFilters, ...patch }) })),

      exportJson: () => JSON.stringify(get(), null, 2),
      importJson: (json) => {
        try {
          const data = JSON.parse(json);
          // basic validation
          if (!data.characters || !Array.isArray(data.characters)) throw new Error("invalid");
          // same normalize + migrate path as load: old backups can't crash the app
          const migrated = migratePersisted(data, typeof data.version === "number" ? data.version : 0);
          // Treat imported state as current-bucket: ancient markers would wipe
          // the import on next tick and tombstone peers' same-bucket progress.
          const now = new Date();
          migrated.lastDailyReset = currentDailyBucket(now);
          migrated.lastWeeklyReset = getTaipeiWeekKey(now);
          set({ ...migrated, _hasHydrated: true });
        } catch (e) {
          alert("匯入失敗：JSON 格式錯誤");
          console.error(e);
        }
      },
      resetAll: () => {
        // confirmation lives in the UI (two-tap inline confirm); this is the point of no return
        const fresh = defaultChar("角色 1");
        set({
          ...initial,
          characters: [fresh],
          activeCharId: fresh.id,
          customTasks: [],
          barterPins: [...DEFAULT_MUST_PINS],
          accountValues: {},
          lastDailyReset: null,
          lastWeeklyReset: null,
          taskBuckets: {},
        });
      },
    }),
    {
      name: "mabiroutine:v2",
      storage: createJSONStorage(() => idleStorage),
      version: 13,
      migrate: (persisted: unknown, version: number) => migratePersisted(persisted, version),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
        // fix activeCharId if missing
        if (state && !state.characters.find((c) => c.id === state.activeCharId)) {
          state.activeCharId = state.characters[0]?.id ?? "";
        }
        // cap 6 chars
        if (state && state.characters.length > 6) state.characters = state.characters.slice(0, 6);
        // Reset check runs from App after hydration (syncAndResets pulls
        // first so a late wake adopts the peer's current-bucket values
        // before its local prune expires stale ones).
      },
      partialize: (s) => ({
        version: s.version,
        characters: s.characters,
        activeCharId: s.activeCharId,
        accountValues: s.accountValues,
        hiddenAccountTaskIds: s.hiddenAccountTaskIds,
        barterPins: s.barterPins,
        customTasks: s.customTasks,
        lastDailyReset: s.lastDailyReset,
        lastWeeklyReset: s.lastWeeklyReset,
        prefs: s.prefs,
        globalTaskOrder: s.globalTaskOrder,
        barterFilters: s.barterFilters,
        taskBuckets: s.taskBuckets,
      }),
    }
  )
);
