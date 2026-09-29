export type ResetKind = "daily" | "weekly" | "account-daily" | "account-weekly";
export type TaskSection = "daily" | "weekly" | "account";
export type TaskType = "check" | "counter" | "countdown";
export type TaskSource = "builtin" | "barter" | "shop" | "custom";
export type BarterPriority = "must" | "extra" | "once" | "situational" | "skip";

export type Task = {
  id: string;
  name: string;
  icon: string;
  desc?: string;
  section: TaskSection;
  kind: ResetKind;
  // countdown = counter for progress/resets, but the tile shows remaining
  // (剩 N / M) instead of used (N / M). e.g. barrier / black-hole.
  type: TaskType;
  max?: number;
  source: TaskSource;
  // barter and shop
  town?: string;
  // barter only
  priority?: BarterPriority;
  npc?: string;
  // true when the barter row is server-shared (barter.json perChar === false),
  // or the shop row is account-scoped (shops.json scope === "account"): value +
  // hide live in the account scope even though the row renders in the
  // daily/weekly pinned subsections.
  serverShared?: boolean;
  barterMeta?: { give: string; get: string; gatherSkill?: string; limit?: string };
  // a pin on a shops.json row with no barter.json entry, so there is no
  // give → get chain to show. Reused by the 8 uncurated barter rows too, which
  // is why it carries both the cost side and the item.
  shopMeta?: { cost: string; costCurrency: string; outQty: number; npc: string; town: string; limit?: string };
  // custom extras
  notes?: string;
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
  // barter display order override: null follows the canonical barter.json
  // order (priority → town → npc → shops). Set on first drag-reorder; new
  // pins append. Local-only, never synced (like globalTaskOrder).
  barterCustomOrder: string[] | null;
  customTasks: Task[];
  lastDailyReset: string | null; // ISO
  lastWeeklyReset: string | null;
  prefs: {
    hideCompleted: boolean;
    // future: server toggle, etc
  };
  // for reorder: global order for builtins + custom
  globalTaskOrder?: Record<string, number>;
  // Cycle provenance: taskId -> the Taipei bucket the value was set in
  // (shared by taskValues + accountValues; buckets are per-task-cycle, so
  // one global map is enough). Values whose bucket != current read as unset
  // and are pruned locally — resets never delete from the sync layer.
  taskBuckets: Record<string, string>;
  // Event (:00 Taipei fire) reminder subscriptions, per task id. LOCAL-ONLY by
  // design: never synced (like ordering), never sent to any server — the MVP
  // fires from a page timer while the app is open.
  hourlyReminders: string[];
  // Purple-hole (36h15m cycle, 15-min-early fire) subscriptions, per task id.
  // Separate lane from hourlyReminders: different cadence, different card tag.
  // Same local-only rule — absent from the sync key space.
  purpleHoleReminders: string[];
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
