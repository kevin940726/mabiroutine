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
  // Counter ceiling. ABSENT on a counter = UNBOUNDED: the tile shows the bare
  // count (never a ✓, the tap never resets), done is read at >= 1, and no upper
  // clamp applies (only a 999 sanity ceiling where a cap is unavoidable).
  // Today only weekly-goals (repeatable quest rounds) ships unbounded; the add
  // dialog still forces a max for custom counters.
  max?: number;
  // Sub-quests shown INSIDE this row (expanded on demand), not as rows of their
  // own. Child tasks are real tracker rows with their own ids/values/maxes, so
  // buckets, sync keys, clears and resets work unchanged; `subTasks` is the ONE
  // link (children carry no back-pointer). Data-only today (builtin rows). The
  // label inside the parent's body is derived (name minus the 通關 verb, see
  // `subTaskLabel`); no extra data field.
  subTasks?: string[];
  source: TaskSource;
  // barter and shop
  town?: string;
  // barter only
  priority?: BarterPriority;
  npc?: string;
  // true when the exchange is server-shared (structured scope: account), or
  // the shop row is account-scoped (shops.json scope === "account"): value +
  // hide live in the account scope even though the row renders in the
  // daily/weekly pinned subsections.
  serverShared?: boolean;
  barterMeta?: { give: string; get: string; limit?: string };
  // a pin on a shops.json row with no exchange chain to show (gold purchase).
  // Reused across both pin kinds, which is why it carries both the cost side
  // and the item.
  //
  // `rawName` is the item name as the DATA spells it, because `Task.name` is folded
  // for display (`getText`) and the icon files keep the half-width spelling. A pin
  // whose row is a `設計圖(3級)` needs this or its art misses the file — same trap
  // as `ShopRow.rawName` and `lib/itemIcon.ts`. */
  shopMeta?: {
    cost: string;
    costCurrency: string;
    outQty: number;
    npc: string;
    town: string;
    limit?: string;
    rawName?: string;
    /** Art override: a data-spelled item name whose file to show instead of the
     *  row's own (mirrors ShopRow.icon; named apart from Task.icon, which is
     *  the emoji glyph). Carried so pinned rows render the same art as tiles. */
    artName?: string | null;
    /** The cost's numeric amount, for the renderer that draws an icon: `shopMeta.cost`
     *  is the folded display string, which has the amount baked into text. */
    costAmount?: number | null;
  };
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
  // barter display order override: null follows the canonical curated order
  // (priority → town → npc → shops). Set on first drag-reorder; new
  // pins append. Synced as meta:pinorder (a rank map) since 2026-10-09.
  barterCustomOrder: string[] | null;
  customTasks: Task[];
  lastDailyReset: string | null; // ISO
  lastWeeklyReset: string | null;
  prefs: {
    hideCompleted: boolean;
    /** Whether each 商店 / 以物易物 已釘選 section is folded shut. Per section,
     *  per DEVICE: a fold is about how much room the screen has, and the pinned
     *  list itself is global, so this is deliberately NOT synced. Defaults
     *  open. */
    pinnedCollapsed: { daily: boolean; weekly: boolean };
  };
  // for reorder: order overrides for builtin rows plus custom row numbers.
  // Synced as meta:taskorder (a union map with the remote winning per id).
  globalTaskOrder?: Record<string, number>;
  // Cycle provenance: taskId -> the Taipei bucket the value was set in
  // (shared by taskValues + accountValues; buckets are per-task-cycle, so
  // one global map is enough). Values whose bucket != current read as unset
  // and are pruned locally — resets never delete from the sync layer.
  taskBuckets: Record<string, string>;
  // Event (:00 Taipei fire) reminder subscriptions, per task id. LOCAL-ONLY by
  // design: never synced (unlike the row/pin order keys), never sent to any server — the MVP
  // fires from a page timer while the app is open.
  hourlyReminders: string[];
  // Purple-hole (36h15m cycle, 15-min-early fire) subscriptions, per task id.
  // Separate lane from hourlyReminders: different cadence, different card tag.
  // Same local-only rule — absent from the sync key space.
  purpleHoleReminders: string[];
};

export const TAIPEI_TZ = "Asia/Taipei";
