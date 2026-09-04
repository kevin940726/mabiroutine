export type ResetKind = "daily" | "weekly" | "account-daily" | "account-weekly";
export type TaskSection = "daily" | "weekly" | "account";
export type TaskType = "check" | "counter";
export type TaskSource = "builtin" | "barter" | "custom";
export type BarterPriority = "must" | "extra" | "once" | "situational" | "skip";

export type BarterFilters = {
  priority: BarterPriority | "all";
  town: string;
  skill: string;
  onlyPinned: boolean;
};

export type Task = {
  id: string;
  name: string;
  icon: string;
  desc?: string;
  section: TaskSection;
  kind: ResetKind;
  type: TaskType;
  max?: number;
  source: TaskSource;
  // barter only
  town?: string;
  priority?: BarterPriority;
  npc?: string;
  barterMeta?: { give: string; get: string; gatherSkill?: string; limit?: string };
  // custom extras
  notes?: string;
  timeGated?: string; // e.g. "06:00,18:00"
  // counters only: tile shows remaining (剩 N / M) instead of used (N / M);
  // fill still rises with used progress. e.g. barrier / black-hole.
  remaining?: boolean;
  // ordering
  order: number;
  // hidden globally? per-char hidden handled in store
};

export type Character = {
  id: string;
  name: string;
  // taskId -> value (boolean for check, number for counter)
  taskValues: Record<string, number | boolean>;
  // hidden tasks per character (ids)
  hiddenTaskIds: string[];
  // custom order overrides per character: taskId -> order
  taskOrder?: Record<string, number>;
};

export type AppState = {
  version: number;
  characters: Character[];
  activeCharId: string;
  // account-wide tasks (not per char)
  accountValues: Record<string, number | boolean>;
  // hidden account-section tasks: global (one tap hides for every character)
  hiddenAccountTaskIds: string[];
  // barter pins: single global list, applies to every character
  barterPins: string[];
  customTasks: Task[];
  lastDailyReset: string | null; // ISO
  lastWeeklyReset: string | null;
  prefs: {
    hideCompleted: boolean;
    // future: server toggle, etc
  };
  barterFilters: BarterFilters;
  // for reorder: global order for builtins + custom
  globalTaskOrder?: Record<string, number>;
};

export type BarterItem = {
  id: string;
  name: string;
  give: string;
  get: string;
  town: string;
  priority: BarterPriority;
  gatherSkill: string;
  perChar: boolean;
  desc?: string;
  npc?: string;
  limit?: string;
};

export const TAIPEI_TZ = "Asia/Taipei";
