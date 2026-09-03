export type ResetKind = "daily" | "weekly" | "account-daily" | "account-weekly";
export type TaskSection = "daily" | "weekly" | "account";
export type TaskType = "check" | "counter";
export type TaskSource = "builtin" | "barter" | "custom";
export type BarterPriority = "must" | "extra" | "once" | "situational" | "skip";

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
  // barter pins: shared base (pre-fork) + per-char after auto-fork
  barterPins: string[]; // shared base, kept for migration
  barterPinsByChar?: Record<string, string[]>; // present after fork → per-char
  isBarterForked?: boolean;
  customTasks: Task[];
  lastDailyReset: string | null; // ISO
  lastWeeklyReset: string | null;
  prefs: {
    hideCompleted: boolean;
    // future: server toggle, etc
  };
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
