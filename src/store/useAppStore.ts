import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import trackerJson from "@/data/tracker.json";
import { CURATED_ORDER } from "@/data/curatedOrder";
import { DEFAULT_PINS } from "@/data/defaultPins";
import type { AppState, Character, Task } from "@/lib/types";
import { loadShopNpcs, shopDeals, shopDealsByPinId, shopPinIds, costText, getText, barterTaskForPin, type ShopDeal } from "@/lib/shops";
import { shouldDailyReset, shouldWeeklyReset, getTaipeiWeekKey, currentDailyBucket } from "@/lib/reset";
import { carriesOverCycle, cycleBucketFor, isWeeklyTask } from "@/lib/cycle";
import { subTaskIds } from "@/lib/subTasks";
import { BLACK_HOLE_BANK_MAX, BLACK_HOLE_DAILY_ID, BLACK_HOLE_ID } from "@/lib/blackHole";
import { flushStorage, idleStorage } from "@/lib/storage";

const BUILTIN_TASKS = trackerJson as Task[];

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

  const expectedOf = (tid: string): string => cycleBucketFor(tid, state.customTasks, now);
  const keep = (tid: string): boolean => {
    const b = state.taskBuckets[tid];
    return b === undefined || b === expectedOf(tid) || carriesOverCycle(tid);
  };
  const changedChars = state.characters.some(
    (c) => Object.keys(c.taskValues).some((tid) => !keep(tid))
  );
  const changedAcc = Object.keys(state.accountValues).some((tid) => !keep(tid));
  const hasValue = (tid: string): boolean =>
    state.accountValues[tid] !== undefined || state.characters.some((c) => c.taskValues[tid] !== undefined);

  // Bucket entries: a stale one goes with its value — except a carried-over row's
  // (a grouped parent's sub-counter), which is RE-STAMPED into the cycle it is
  // being carried into. The stamp is the wire tag, and a peer adopts only
  // current-bucket keys, so a carried value left under last week's bucket would
  // be local-only (see carriesOverCycle).
  const taskBuckets = { ...state.taskBuckets };
  let bucketsChanged = false;
  for (const tid of Object.keys(taskBuckets)) {
    if (taskBuckets[tid] === expectedOf(tid)) continue;
    if (carriesOverCycle(tid) && hasValue(tid)) taskBuckets[tid] = expectedOf(tid);
    else delete taskBuckets[tid];
    bucketsChanged = true;
  }
  if (bucketsChanged) patch.taskBuckets = taskBuckets;

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
  if (
    !changedChars &&
    !changedAcc &&
    !bucketsChanged &&
    !patch.lastDailyReset &&
    !patch.lastWeeklyReset
  ) {
    return {};
  }
  return patch;
}

/** Pre-write values of one 定期委託 turn-in (parent + sub-counters) for the
 *  toast's undo. Absent values are carried as 0 (an undo restores "cleared"). */
export type GoalUndo = { id: string; value: number }[];

type Store = AppState & {  // actions
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
  reorderCharacters: (orderedIds: string[]) => void;

  toggleCheck: (taskId: string, isAccount: boolean) => void;
  setCounter: (taskId: string, value: number, isAccount: boolean) => void;
  incCounter: (taskId: string, delta: number, isAccount: boolean) => void;
  /** One write for the 黑色坑洞 pair (the weekly bank + today's daily) in ONE
   *  set: the two rows sit in different cycles (week bucket + day bucket), so
   *  no render can see one half without the other. Absent fields are left
   *  alone. */
  writeBlackHole: (patch: { bank?: number; today?: boolean }, isAccount: boolean) => void;
  /** One completed 定期委託 round in ONE write: the parent's count +1 and its
   *  sub-counters back to 0, so no render can see the children consumed without
   *  the round. `childBefore` is the caller's snapshot of the children from
   *  BEFORE the write that completed the round, so the undo can put the row back
   *  as it was before that tap (undoing the turn-in alone would leave every leg
   *  ticked with nothing recorded). Returns the values for the undo, or null when
   *  the id has no live sub-tasks. */
  recordGoalRound: (taskId: string, isAccount: boolean, childBefore: number[]) => GoalUndo | null;
  /** The toast undo: write a `recordGoalRound` snapshot back, bucket-stamped. */
  restoreGoalValues: (undo: GoalUndo, isAccount: boolean) => void;

  clearSection: (section: "daily" | "weekly" | "account") => void;

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
  // Event (:00 Taipei fire) reminder subscription toggle. Local-only, never synced.
  toggleHourlyReminder: (taskId: string) => void;
  isHourlyReminded: (taskId: string) => boolean;
  // Purple-hole (15-min-early fire) subscription toggle. Separate lane,
  // same local-only rule.
  togglePurpleReminder: (taskId: string) => void;
  isPurpleReminded: (taskId: string) => boolean;

  // Changelog nudge acknowledgement: the newest feature release whose dot has
  // been seen. Synced, unlike the reminder lanes above.
  setWhatsNewNudged: (release: string) => void;

  exportJson: () => string;
  importJson: (json: string) => void;
  resetAll: () => void;
};

// Server-shared barter: deals with scopeAccount (today 11 rows) share one value
// across every character — checking
// on any character checks all of them, like 帳號共通. They keep rendering in
// the daily/weekly pinned subsections (NOT moved to the account section, so
// no cycle grouping is introduced there); only their value + hide scope is
// account-wide. Single source of truth: the deal's structured scope (the row
// strings carried the same perChar, parity-gated in test:shops).
export function isServerSharedBarterId(id: string): boolean {
  return SHOP_DEALS_BY_PIN.get(id)?.scopeAccount === true;
}

// One resolver for both pin namespaces. barterPins holds curated exchange ids
// and shops.json ids, so every consumer that used to reach straight for
// row-finding silently skipped the shop half — including clearSection,
// which is why a gold counter would never have been clearable. Deal data is
// resolved once here instead of at each of those call sites.
const SHOP_DEALS_BY_PIN = shopDealsByPinId();

/** Reset cycle of a pinned row, from either namespace. */
export function pinCycleOf(id: string): "daily" | "weekly" | null {
  const deal = SHOP_DEALS_BY_PIN.get(id);
  if (deal) return deal.limitPeriod === "weekly" ? "weekly" : "daily";
  return null;
}

/** True when the row's value and hide live in the account scope. */
export function isServerSharedPinId(id: string): boolean {
  const deal = SHOP_DEALS_BY_PIN.get(id);
  if (deal) return deal.scopeAccount;
  return isServerSharedBarterId(id);
}

/**
 * Every id a pin, value, hide or order entry may reference: tracker rows,
 * curated barter rows, custom tasks, and shops.json pins. One place, because
 * the prune steps below rebuild this on every version upgrade and a copy that
 * forgets the shop namespace deletes every gold pin the first time an older
 * save is loaded.
 */
function validPinnableIds(customTaskIds: string[]): Set<string> {
  return new Set<string>([
    ...(trackerJson as Task[]).map((t) => t.id),
    ...shopDeals(loadShopNpcs()).filter((d) => d.id).map((d) => d.id as string),
    ...customTaskIds,
    ...shopPinIds(),
  ]);
}

// Canonical pin order = the curated order list (priority → town → npc →
// shops), then shops.json rows in shops.json order. Both spaces sink unknown
// ids to the end instead of interleaving, so a stale id cannot push a real one
// out of place. Array.sort is stable, so unknown ids keep their input order.
const BARTER_FILE_INDEX = new Map<string, number>(
  (CURATED_ORDER as string[]).map((id, i) => [id, i])
);
const SHOP_FILE_INDEX = new Map<string, number>(shopDeals(loadShopNpcs()).map((d, i) => [d.pinId, i]));

function pinSortRank(id: string): readonly [number, number] {
  const barter = BARTER_FILE_INDEX.get(id);
  if (barter !== undefined) return [0, barter] as const;
  const shop = SHOP_FILE_INDEX.get(id);
  if (shop !== undefined) return [1, shop] as const;
  return [2, 0] as const;
}

export function canonicalBarterOrder(ids: string[]): string[] {
  return [...ids].sort((a, b) => {
    const [spaceA, indexA] = pinSortRank(a);
    const [spaceB, indexB] = pinSortRank(b);
    return spaceA - spaceB || indexA - indexB;
  });
}

// Position in the curated order list (unknown ids sink last). Explorer tiebreak:
// priority → town → file index reproduces the canonical order exactly, so
// the two views cannot diverge no matter how the input is ordered.
export function barterFileIndex(id: string): number {
  return BARTER_FILE_INDEX.get(id) ?? Number.MAX_SAFE_INTEGER;
}

// A pin on a shops.json row. The mirror of dealToBarterTask for a purchase rather
// than a recipe: no give → get chain exists, so shopMeta carries the cost side
// and the yield instead of barterMeta, and TaskRow skips the material
// breakdown hover card. Account-scoped gold (shops.json scope "account", the
// 伺服器 badge) mirrors barter's perChar: false — the value and hide live in
// the account scope while the row renders in the daily/weekly pinned
// subsection. Order numbers match the barter convention (daily 80, weekly 150)
// so the two kinds of pin interleave predictably.
export function shopDealToTask(deal: ShopDeal): Task {
  const weekly = deal.limitPeriod === "weekly";
  const times = deal.limitTimes ?? 0;
  const isCounter = times > 1;
  return {
    id: deal.pinId,
    name: getText(deal),
    icon: deal.kind === "barter" ? "🔄" : "🪙",
    desc: `${costText(deal)} · ${deal.town} · ${deal.npc}`,
    section: weekly ? "weekly" : "daily",
    kind: weekly ? "weekly" : "daily",
    type: isCounter ? "counter" : "check",
    max: isCounter ? times : undefined,
    source: "shop",
    town: deal.town,
    npc: deal.npc,
    serverShared: deal.scopeAccount,
    shopMeta: {
      cost: costText(deal),
      costCurrency: deal.costCurrency,
      outQty: deal.outQty,
      npc: deal.npc,
      town: deal.town,
      limit: deal.limitText ?? undefined,
      // `name` above is `getText(deal)`, folded for reading; the icon needs the
      // data's own spelling, so carry it alongside.
      rawName: deal.name,
      artName: deal.icon,
      costAmount: deal.costAmount ?? null,
    },
    order: weekly ? 150 : 80,
  };
}

export const DEFAULT_MUST_PINS: string[] = [...new Set(DEFAULT_PINS)].filter((id) =>
  shopDeals(loadShopNpcs()).some((d) => d.id === id)
);

// Pull-aware default seeding (2026-10-06, supersedes the removed v15
// migrate-time seed). New defaults reach an existing save only for keys the
// server never saw: local-missing + wire-absent. A retained tombstone
// (`pin:<id>: null`) means somebody — this device or a peer — unpinned on
// purpose, and it is respected. Returns the added ids (usually none).
//
// Linked pulls only — never migration (a stale save cannot tell "never saw
// this row" from "a peer unpinned it", but the server can: tombstone retained
// vs key absent), and never boot (an unlinked save has no wire to consult, so
// boot seeding would re-add deliberate local unpins every load; unlinked
// upgraders pin new rows by hand once). Like a sync adoption it touches
// barterPins only, never the custom drag order.
export function seedMissingDefaultPins(serverFlat: Record<string, unknown>): string[] {
  const st = useAppStore.getState();
  const missing = DEFAULT_MUST_PINS.filter(
    (id) => !(st.barterPins ?? []).includes(id) && !(`pin:${id}` in serverFlat)
  );
  if (missing.length) {
    useAppStore.setState((s) => ({ barterPins: [...s.barterPins, ...missing] }));
  }
  return missing;
}

/** Sanity ceiling for a counter with no `max`: one value, so a drag, the store
 *  and the quest row cannot disagree. */
export const COUNTER_SANITY_MAX = 999;

const initial: AppState = {
  version: 23,
  characters: [defaultChar("角色 1")],
  activeCharId: "",
  accountValues: {},
  hiddenAccountTaskIds: [],
  barterPins: [...DEFAULT_MUST_PINS],
  barterCustomOrder: null,
  customTasks: [],
  lastDailyReset: null,
  lastWeeklyReset: null,
  prefs: { hideCompleted: false, pinnedCollapsed: { daily: false, weekly: false } },
  taskBuckets: {},
  hourlyReminders: [],
  purpleHoleReminders: [],
  whatsNewNudged: "",
};

// Cycle provenance normalize: every existing value gets a bucket entry,
// stale-bucket values are pruned (memory-only reset — the sync layer never
// deletes cycle keys), orphan bucket entries dropped. Runs on every load
// AND import.
// Untagged values (v12 saves, ancient backups, hand edits) predate
// provenance, so stamping them "current" would launder pre-rollover checks
// into the new cycle (proven wipe: upgrade after a reset keeps last week's
// state, then sync adopts it everywhere). The last-reset markers disambiguate:
// v12 ran resets on the same tick, so a marker older than the current bucket
// proves the value predates the rollover and it drops instead of stamping.
// Null markers (versionless/imported) keep the old stamp-current behavior —
// with no witness, dropping would risk real data.
function normalizeTaskBuckets(
  chars: Character[],
  accountValues: Record<string, number | boolean>,
  customTasks: Task[],
  raw: unknown,
  lastDailyReset: string | null,
  lastWeeklyReset: string | null
): Record<string, string> {
  const inRaw = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: Record<string, string> = {};
  const now = new Date();
  const consider = (tid: string): void => {
    const expected = cycleBucketFor(tid, customTasks, now);
    const stored = typeof inRaw[tid] === "string" ? (inRaw[tid] as string) : undefined;
    // A carried-over row (a grouped parent's sub-counter) enters the current cycle
    // whatever bucket it was written under — re-stamped, never pruned, so the
    // caller keeps the value. Same rule as applyResets'; see carriesOverCycle.
    if (carriesOverCycle(tid)) {
      out[tid] = expected;
      return;
    }
    if (stored === undefined) {
      if (isWeeklyTask(tid, customTasks)) {
        if (lastWeeklyReset !== null && lastWeeklyReset !== getTaipeiWeekKey(now)) return; // pre-rollover → prune
      } else if (lastDailyReset !== null && lastDailyReset !== currentDailyBucket(now)) {
        return; // pre-rollover → prune
      }
      out[tid] = expected;
    } else if (stored === expected) out[tid] = stored; // current → keep
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

// Check-era booleans under a COUNTER-typed id read as counts: true = 1, false =
// absent. An old-build peer keeps pushing true/false for weekly-goals and the
// sync codec admits booleans for current buckets, so a raw boolean can enter
// state long after the v22 step ran. Called from the END of migratePersisted
// (after the steps, which need their own booleans) and from the persist `merge`
// (a same-version boot skips `migrate` entirely), so no reader has to guard one.
export function coerceCounterBooleans(state: {
  characters: Character[];
  accountValues: Record<string, number | boolean>;
  customTasks: Task[];
}): void {
  const ids = new Set<string>();
  for (const t of trackerJson as Task[]) if (t.type !== "check") ids.add(t.id);
  for (const t of state.customTasks ?? []) if (t.type !== "check") ids.add(t.id);
  const fix = (values: Record<string, number | boolean>): void => {
    for (const [id, v] of Object.entries(values)) {
      if (typeof v !== "boolean" || !ids.has(id)) continue;
      if (v) values[id] = 1;
      else delete values[id];
    }
  };
  for (const c of state.characters ?? []) fix(c.taskValues);
  fix(state.accountValues);
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
  // Custom order holds only pinned, live ids: unpins (toggle or sync-merge)
  // and removed rows fall out here on next load instead of lingering. Widen to
  // the shared valid set, not barter ids alone, or a shop:: pin would drop out
  // of the drag order on every load.
  const pinnedIds = new Set(Array.isArray(d.barterPins) ? d.barterPins : []);
  const validPinIds = validPinnableIds(customTasks.map((t) => t.id));
  const barterCustomOrder = Array.isArray(d.barterCustomOrder)
    ? (d.barterCustomOrder as string[]).filter((id) => validPinIds.has(id) && pinnedIds.has(id))
    : null;
  const taskBuckets = normalizeTaskBuckets(chars, accountValues, customTasks, d.taskBuckets, d.lastDailyReset ?? null, d.lastWeeklyReset ?? null);
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
    barterCustomOrder,
    customTasks,
    lastDailyReset: d.lastDailyReset ?? null,
    lastWeeklyReset: d.lastWeeklyReset ?? null,
    prefs: {
      hideCompleted: d.prefs?.hideCompleted ?? false,
      // Nested object: a save from before this field, or a hand-edited one, must
      // get both sections back rather than an undefined that the UI would read as
      // "expanded" for one cycle and then write back as missing.
      pinnedCollapsed: {
        daily: d.prefs?.pinnedCollapsed?.daily ?? false,
        weekly: d.prefs?.pinnedCollapsed?.weekly ?? false,
      },
    },
    taskBuckets,
    hourlyReminders: Array.isArray(d.hourlyReminders)
      ? [...new Set((d.hourlyReminders as unknown[]).filter((x): x is string => typeof x === "string"))]
      : [],
    purpleHoleReminders: Array.isArray(d.purpleHoleReminders)
      ? [...new Set((d.purpleHoleReminders as unknown[]).filter((x): x is string => typeof x === "string"))]
      : [],
    whatsNewNudged: typeof d.whatsNewNudged === "string" ? d.whatsNewNudged : "",
  };
}

// Device-local fields: real per-device choices that never ride the sync key
// space (flattenSnapshot/partialize keep them off the wire), so a merged
// snapshot or an old backup that lacks them cannot speak to them.
// normalizePersisted backfills an absent key to its default, so any path that
// replaces state from such a snapshot — a routine pull, an adopt, or a backup
// import — would silently reset them. Reported bug (2026-10-07): a pull turned
// the reminder bells off, so only the peer device still fired ("the hourly
// notification only fires on one device per sync"). Every such path restores
// these from the current device when the incoming payload does not explicitly
// set them. Extend this list when adding a local-only field; the guard in
// scripts/sync-tests/engine.entry.ts (E15) fails until the new field is
// classified as synced or device-local.
export const DEVICE_LOCAL_STATE_KEYS = ["hourlyReminders", "purpleHoleReminders"] as const;

/** See DEVICE_LOCAL_STATE_KEYS: restore absent device-local fields from the live store. */
export function preserveDeviceLocalState(next: AppState, incoming: unknown): AppState {
  const src = (incoming && typeof incoming === "object" ? incoming : {}) as Record<string, unknown>;
  const cur = useAppStore.getState() as unknown as Record<string, unknown>;
  const out = { ...next } as Record<string, unknown>;
  for (const k of DEVICE_LOCAL_STATE_KEYS) {
    if (!(k in src)) out[k] = cur[k];
  }
  return out as AppState;
}

// Server-shared barter (perChar === false) lives in accountValues (one
// shared pool: checks OR, counters max across chars capped at the live max).
// Per-char hides union to the global list. Provenance is per-tid (shared
// across chars), so buckets follow untouched. Old per-char wire keys age out
// server-side via GC, never read again (same pattern as the v13→v14
// weekly-challenge move). Values otherwise untouched.
function absorbSharedBarter(s: AppState): void {
  const shared = shopDeals(loadShopNpcs()).filter((d) => d.scopeAccount && d.barterText && d.id);
  const taskOf = new Map(shared.map((d) => [d.id!, barterTaskForPin(d.id!)]));
  const numOf = (v: unknown): number => (typeof v === "number" ? v : v === true ? 1 : 0);
  const acc = { ...(s.accountValues ?? {}) } as Record<string, number | boolean>;
  for (const d of shared) {
    const id = d.id!;
    let best = numOf(acc[id]);
    for (const c of s.characters ?? []) {
      best = Math.max(best, numOf(c.taskValues?.[id]));
      if (c.taskValues) delete c.taskValues[id];
    }
    if (best > 0) {
      const t = taskOf.get(id)!;
      acc[id] = t?.type === "check" ? true : Math.min(best, t?.max ?? best);
    } else {
      delete acc[id];
    }
  }
  s.accountValues = acc;
  const sharedIds = new Set(shared.map((d) => d.id!));
  const global = new Set(s.hiddenAccountTaskIds ?? []);
  for (const c of s.characters ?? []) {
    const keep: string[] = [];
    for (const id of c.hiddenTaskIds ?? []) {
      if (sharedIds.has(id)) global.add(id);
      else keep.push(id);
    }
    c.hiddenTaskIds = keep;
  }
  s.hiddenAccountTaskIds = [...global];
}

// Shared migration runner: normalize shape first (covers versionless ancient
// saves), then run every step newer than the stored version. Used by zustand
// persist on load AND by importJson on backup import — single source of truth.
// Exported for scripts/check-migrations.mjs (agent pre-push gate).
//
// TRAP: this only runs when the STORED version differs from the CONFIGURED one,
// because zustand persist skips `migrate` when the two are equal. Folding a new
// change into an unshipped step is right (see "Fold a bump that has not
// shipped" in AGENTS.md), but it means a save that already carries that version
// number skips the step entirely — which is routine on a dev machine, where an
// earlier revision of the same branch already wrote the new number. Editing an
// unshipped step therefore does NOT re-run it for those saves.
//
// The safety net is the persist `merge` option, which runs on EVERY rehydration:
// it repairs shape that a skipped step would have fixed (see the `prefs` merge
// below), so the UI is not left reading a key that never got backfilled.
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
    // Deliberately barter-only, NOT validPinnableIds: this step treats an
    // unrecognized id as corruption and reseeds the whole list. Widening it
    // would make a shop:: pin look "valid" to a v4 save and keep it, which is
    // the opposite of what the step is for. Nothing to protect here — a v4
    // save predates the shop browser, so it cannot hold one.
    const valid = new Set(shopDeals(loadShopNpcs()).filter((d) => d.id).map((d) => d.id as string));
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
    // v5 → v6: prune references to tracker/curated ids that no longer exist
    // (tracker.json/shops.json/curatedOrder.ts are hand-edited; rows can be removed).
    // User data always wins — only dangling keys are dropped, values untouched.
    const valid = validPinnableIds((s.customTasks ?? []).map((t) => t.id));
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
    // v7 → v8: barter explorer filters persisted — just stamp. The field itself is
    // gone as of v20, so there is nothing to sanitize; the step stays so the chain
    // is unbroken for a save that old.
    s.version = 8;
  }
  if (from < 9) {
    // v8 → v9: search text no longer persisted (session-only) — just stamp.
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
    // normalizePersisted already assigned buckets — current for fresh
    // untagged values, dropped for pre-rollover ones (markers witness) — and
    // pruned stale ones; here we only stamp. No values touched.
    s.version = 13;
  }
  if (from < 14) {
    // v13 → v14: tracker reshuffle — weekly-challenge moved weekly
    // (per-char) → account-weekly (shared); acc-field-last removed.
    // Move char-level progress into accountValues (max across chars, capped
    // at the live max; provenance follows — same week-bucket domain) and
    // union per-char hides into the global list, then re-run the v6
    // valid-set prune (now including taskBuckets) for removed ids.
    // Old per-char wire keys age out server-side via GC, never adopted
    // (prefix mismatch) — no tombstones needed.
    const liveMax = (trackerJson as Task[]).find((t) => t.id === "weekly-challenge")?.max ?? 9;
    const numOf = (v: unknown): number => (typeof v === "number" ? v : v === true ? liveMax : 0);
    // Buckets are per-tid (shared across chars): capture once, then clear.
    const buckets = (s.taskBuckets ?? {}) as Record<string, string>;
    let moved = numOf((s.accountValues ?? {} as Record<string, number | boolean>)["weekly-challenge"]);
    let movedBucket = buckets["weekly-challenge"] as string | undefined;
    let hideGlobally = (s.hiddenAccountTaskIds ?? []).includes("weekly-challenge");
    for (const c of s.characters ?? []) {
      if (c.taskValues && "weekly-challenge" in c.taskValues) {
        moved = Math.max(moved, numOf(c.taskValues["weekly-challenge"]));
        delete c.taskValues["weekly-challenge"];
      }
      if (c.hiddenTaskIds?.includes("weekly-challenge")) {
        c.hiddenTaskIds = c.hiddenTaskIds.filter((id) => id !== "weekly-challenge");
        hideGlobally = true;
      }
    }
    delete buckets["weekly-challenge"];
    if (moved > 0) {
      s.accountValues = { ...(s.accountValues ?? {}), "weekly-challenge": Math.min(moved, liveMax) };
      if (movedBucket !== undefined) s.taskBuckets = { ...(s.taskBuckets ?? {}), "weekly-challenge": movedBucket };
    } else {
      if (s.accountValues) delete s.accountValues["weekly-challenge"];
      if (s.taskBuckets) delete (s.taskBuckets as Record<string, string>)["weekly-challenge"];
    }
    if (hideGlobally && !(s.hiddenAccountTaskIds ?? []).includes("weekly-challenge")) {
      s.hiddenAccountTaskIds = [...(s.hiddenAccountTaskIds ?? []), "weekly-challenge"];
    }
    const valid = validPinnableIds((s.customTasks ?? []).map((t) => t.id));
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
    s.taskBuckets = pruneRec(s.taskBuckets);
    if (s.globalTaskOrder) s.globalTaskOrder = pruneRec(s.globalTaskOrder);
    s.version = 14;
  }
  if (from < 15) {
    // v14 → v15: 9/9 barter refresh. Dedupe — 4 `yen-` twins dropped
    // from barter.json (exact npc+give+get dupes of col-k1/dun-st6/dun-st7,
    // plus the dungeon-2 near-dupe). Rename-like: user state transfers to
    // the kept twin first (pins, values, hides, provenance — moved verbatim;
    // the twin's own state always wins), then the v6 valid-set prune drops
    // the removed ids. Stored order kept. Values otherwise untouched.
    //
    // NO new-default seeding here (the 9/9 pins used to append): an upgrade
    // that seeds pins volunteers them blind and resurrects a peer's unpin on
    // the next push — proven 2026-10-06 (desktop unpins seumas-finest-bandage,
    // a pre-refresh mobile upgrades on open, reseeds it, pushes pin:true, the
    // desktop row comes back). A stale save cannot tell "never saw this row"
    // from "a peer unpinned it", but the server can (tombstone retained vs
    // key absent) — so seeding is pull-aware in seedMissingDefaultPins, never
    // migration-time.
    const RENAMED_BARTER: Record<string, string> = {
      "yen-基利安毒囊3藥品加工設備-21": "col-k1",
      "yen-史帝華強化再燃燒催化劑5-80": "dun-st6",
      "yen-史帝華稀有鍊金術再燃燒催-81": "dun-st7",
      "yen-貓商人擠著吃的點心愛心幣-43": "dungeon-2",
    };
    const moveArr = (arr?: string[]) => {
      const out = [...(arr ?? [])];
      for (const [oldId, newId] of Object.entries(RENAMED_BARTER)) {
        if (out.includes(oldId) && !out.includes(newId)) out[out.indexOf(oldId)] = newId;
      }
      return out;
    };
    const moveRec = <T,>(rec?: Record<string, T>) => {
      const out = { ...(rec ?? {}) };
      for (const [oldId, newId] of Object.entries(RENAMED_BARTER)) {
        if (oldId in out && !(newId in out)) out[newId] = out[oldId];
      }
      return out;
    };
    for (const c of s.characters ?? []) {
      c.taskValues = moveRec(c.taskValues);
      c.hiddenTaskIds = moveArr(c.hiddenTaskIds);
    }
    s.accountValues = moveRec(s.accountValues);
    s.hiddenAccountTaskIds = moveArr(s.hiddenAccountTaskIds);
    s.barterPins = moveArr(s.barterPins);
    s.taskBuckets = moveRec(s.taskBuckets as Record<string, string>) as typeof s.taskBuckets;
    if (s.globalTaskOrder) s.globalTaskOrder = moveRec(s.globalTaskOrder);
    const valid = validPinnableIds((s.customTasks ?? []).map((t) => t.id));
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
    s.taskBuckets = pruneRec(s.taskBuckets);
    if (s.globalTaskOrder) s.globalTaskOrder = pruneRec(s.globalTaskOrder);
    s.version = 15;
  }
  if (from < 16) {
    // v15 → v16: server-shared barter (perChar === false, at the time 7 rows:
    // 麗莎×3, 阿爾米斯 銀合金錠, 康納 魔力石×2, 安黛莉 聖水) moves from
    // per-char taskValues to accountValues. See absorbSharedBarter.
    absorbSharedBarter(s);
    s.version = 16;
  }
  if (from < 17) {
    // v16 → v17: barter display order goes canonical (barter.json file order)
    // unless the user drags. No record of past drags exists, so every save
    // resets to canonical (null) — progress values untouched, only the
    // arrangement. normalizePersisted already pruned dangling ids above.
    s.barterCustomOrder = null;
    s.version = 17;
  }
  if (from < 18) {
    // v17 → v18: event (:00 fire) reminder subscriptions introduced, default off.
    // normalizePersisted already shaped the array — here only prune ids that
    // no longer exist (removed tracker/barter rows, deleted customs), same
    // v6 valid-set rule. Progress untouched. Reminders stay local-only.
    const valid = validPinnableIds((s.customTasks ?? []).map((t) => t.id));
    s.hourlyReminders = (s.hourlyReminders ?? []).filter((id) => valid.has(id));
    s.version = 18;
  }
  if (from < 19) {
    // v18 → v19: purple-hole (15-min-early fire) subscriptions introduced,
    // default off. Same valid-set prune as v18 — only dangling ids go — and
    // re-prune the hourly lane too (a v18 save loaded after a row removal
    // would otherwise keep the dangling hourly id; review catch). Progress
    // untouched. Reminders stay local-only.
    const valid = validPinnableIds((s.customTasks ?? []).map((t) => t.id));
    s.hourlyReminders = (s.hourlyReminders ?? []).filter((id) => valid.has(id));
    s.purpleHoleReminders = (s.purpleHoleReminders ?? []).filter((id) => valid.has(id));
    s.version = 19;
  }
  if (from < 20) {
    // v19 → v20: two changes that ship together, since neither is released —
    // this branch's work is unmerged, so no save exists at v20 and there is no
    // reason to spend a version on one of them.
    //
    // (a) barterFilters removed. It was the old barter explorer's filter state,
    // left persisted after that UI was deleted, and nothing has read it since.
    // Deleting it here (rather than only omitting it from the shape) means an old
    // save stops carrying the keys on the next write instead of leaving them in
    // the blob forever. Progress untouched, and the sync layer stops emitting and
    // reading its filter:* keys.
    delete (s as Record<string, unknown>).barterFilters;
    // (b) the 已釘選 sections became collapsible and the fold is remembered.
    // Additive: prefs.hideCompleted survives and an old save grows both sections
    // open, which is the previous behaviour exactly. No prune and no id remap —
    // this touches no task id and no progress value, so nothing can be dropped.
    s.prefs = {
      hideCompleted: s.prefs?.hideCompleted ?? false,
      pinnedCollapsed: {
        daily: s.prefs?.pinnedCollapsed?.daily ?? false,
        weekly: s.prefs?.pinnedCollapsed?.weekly ?? false,
      },
    };
    s.version = 20;
  }
  if (from < 21) {
    // v20 → v21: the duplicate 特蕾西 blueprint row (id 木材加工設計圖(3級),
    // situational twin of the once dug-t1) is deleted — one exchange, one pin.
    // Targeted, not a full valid-set re-prune: the sync E2 contract requires
    // adoption to stay namespace-agnostic (a dead pin rides the pull and dies
    // on load, never in the merge), and the harness exercises pulls at a
    // seeded old version, so a general re-prune here would eat adopted pins
    // and fail E2. Older saves already passed the v6/v14 full prunes, so the
    // only newly-dangling id is this one; the next row removal adds its own.
    const GONE = "木材加工設計圖(3級)";
    const dropId = (arr?: string[]) => (arr ?? []).filter((id) => id !== GONE);
    const dropRec = <T,>(rec?: Record<string, T>) =>
      Object.fromEntries(Object.entries(rec ?? {}).filter(([k]) => k !== GONE)) as Record<string, T>;
    for (const c of s.characters ?? []) {
      c.taskValues = dropRec(c.taskValues);
      c.hiddenTaskIds = dropId(c.hiddenTaskIds);
    }
    s.accountValues = dropRec(s.accountValues);
    s.hiddenAccountTaskIds = dropId(s.hiddenAccountTaskIds);
    s.barterPins = dropId(s.barterPins);
    if (s.globalTaskOrder) s.globalTaskOrder = dropRec(s.globalTaskOrder);
    if (s.taskBuckets) s.taskBuckets = dropRec(s.taskBuckets);
    s.hourlyReminders = dropId(s.hourlyReminders);
    s.purpleHoleReminders = dropId(s.purpleHoleReminders);
    s.version = 21;
  }
  if (from < 22) {
    // v21 → v22: weekly-goals flips check → counter (+ its three new sub-counter
    // rows). A checked row carries 1 (the v11 tower precedent: "done" survives as
    // one recorded round); an explicit false is dropped (no counter meaning, and
    // absence reads 0); numbers pass untouched.
    //
    // taskBuckets is ONE map shared by all characters, so the provenance entry is
    // dropped only when no character retains a value: dropping it while another
    // character's value survives would leave that value bucketless, and a later
    // load with stale reset markers would prune real progress.
    let keepsValue = false;
    for (const c of s.characters ?? []) {
      const v = c.taskValues?.["weekly-goals"];
      if (v === true) {
        c.taskValues["weekly-goals"] = 1;
        keepsValue = true;
      } else if (v === false) {
        delete c.taskValues["weekly-goals"];
      } else if (v !== undefined) {
        keepsValue = true;
      }
    }
    if (!keepsValue && s.taskBuckets) delete s.taskBuckets["weekly-goals"];
    s.version = 22;
  }
  if (from < 23) {
    // v22 → v23: the changelog nudge became a synced marker. Additive — the
    // field defaults to "" in normalizePersisted, so there is no data to
    // transform; the step only carries the version chain to the configured
    // number. No save exists at 23 yet, so this is the one bump for the marker.
    s.version = 23;
  }
  // AFTER the steps, never before: the steps interpret their own booleans (v11
  // reads tower: true as 20), so an ingest coercion running first would eat the
  // value they are looking for.
  coerceCounterBooleans({
    characters: s.characters ?? [],
    accountValues: s.accountValues ?? {},
    customTasks: s.customTasks ?? [],
  });
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
      reorderCharacters: (orderedIds) =>
        set((s) => {
          // Unknown ids dropped, missing ids appended in current order —
          // a racing remove/add must never lose a character or resurrect one.
          const byId = new Map(s.characters.map((c) => [c.id, c]));
          const ordered = orderedIds.map((id) => byId.get(id)).filter((c) => c !== undefined);
          const missing = s.characters.filter((c) => !orderedIds.includes(c.id));
          return { characters: [...ordered, ...missing] };
        }),

      toggleCheck: (taskId, isAccount) =>
        set((s) => {
          const bucket = cycleBucketFor(taskId, s.customTasks, new Date());
          // Explicit unchecked is a PRESENT false, not an absence: absence
          // means "reset pruned" and stays silent on the wire (rev 3), so
          // deleting here would never reach the server and the next pull
          // would resurrect the server's true. Presence is the propagation bit.
          if (isAccount) {
            const cur = s.accountValues[taskId];
            const next = { ...s.accountValues };
            const nextBuckets = { ...s.taskBuckets };
            if (cur) {
              next[taskId] = false;
              nextBuckets[taskId] = bucket;
            } else {
              next[taskId] = true;
              nextBuckets[taskId] = bucket;
            }
            return { accountValues: next, taskBuckets: nextBuckets };
          }
          const char = s.characters.find((c) => c.id === s.activeCharId);
          if (!char) return s;
          const cur = char.taskValues[taskId];
          const nextVal = cur ? false : true;
          const nextBuckets = { ...s.taskBuckets, [taskId]: bucket };
          return {
            taskBuckets: nextBuckets,
            characters: s.characters.map((c) =>
              c.id === s.activeCharId ? { ...c, taskValues: { ...c.taskValues, [taskId]: nextVal } } : c
            ),
          };
        }),

      setCounter: (taskId, value, isAccount) =>
        set((s) => {
          const clamped = Math.max(0, value);
          // Zero is a PRESENT 0 for the same reason as toggleCheck's false:
          // deleting would stay silent and the server's old count would
          // resurrect on the next pull. Stale-cycle zeros prune like the
          // values they zero (bucket goes stale with the cycle).
          const bucket = cycleBucketFor(taskId, s.customTasks, new Date());
          const nextBuckets = { ...s.taskBuckets, [taskId]: bucket };
          if (isAccount) {
            return { accountValues: { ...s.accountValues, [taskId]: clamped }, taskBuckets: nextBuckets };
          }
          return {
            taskBuckets: nextBuckets,
            characters: s.characters.map((c) =>
              c.id === s.activeCharId ? { ...c, taskValues: { ...c.taskValues, [taskId]: clamped } } : c
            ),
          };
        }),
      incCounter: (taskId, delta, isAccount) => {
        const s = get();
        const isAcc = isAccount;
        const raw = isAcc ? s.accountValues[taskId] : s.getActiveChar()?.taskValues[taskId];
        // Read (never cast): a check-era boolean can still arrive from an
        // old-build peer, and `true + 1` would record 2.
        const cur = typeof raw === "number" ? raw : raw === true ? 1 : 0;
        // need max
        const task = [...BUILTIN_TASKS, ...s.customTasks, barterTaskForPin(taskId)].find(
          (t) => t?.id === taskId
        );
        const max = task?.max ?? COUNTER_SANITY_MAX;
        const next = Math.min(max, Math.max(0, cur + delta));
        get().setCounter(taskId, next, isAcc);
      },

      writeBlackHole: (patch, isAccount) =>
        set((s) => {
          const now = new Date();
          const nextBuckets = { ...s.taskBuckets };
          // Stamp only the halves this write touches; each row's own cycle
          // decides its bucket (the weekly bank is a week key, today's daily a
          // day key). An absent half keeps its value AND its provenance.
          if (patch.bank !== undefined) {
            nextBuckets[BLACK_HOLE_ID] = cycleBucketFor(BLACK_HOLE_ID, s.customTasks, now);
          }
          if (patch.today !== undefined) {
            nextBuckets[BLACK_HOLE_DAILY_ID] = cycleBucketFor(BLACK_HOLE_DAILY_ID, s.customTasks, now);
          }
          const write = (target: Record<string, number | boolean>): Record<string, number | boolean> => {
            const next = { ...target };
            if (patch.bank !== undefined) {
              next[BLACK_HOLE_ID] = Math.max(0, Math.min(BLACK_HOLE_BANK_MAX, Math.round(patch.bank)));
            }
            if (patch.today !== undefined) next[BLACK_HOLE_DAILY_ID] = patch.today;
            return next;
          };
          if (isAccount) return { accountValues: write(s.accountValues), taskBuckets: nextBuckets };
          return {
            taskBuckets: nextBuckets,
            characters: s.characters.map((c) =>
              c.id === s.activeCharId ? { ...c, taskValues: write(c.taskValues) } : c
            ),
          };
        }),

      recordGoalRound: (taskId, isAccount, childBefore) => {
        const s = get();
        const children = subTaskIds(taskId);
        if (children.length === 0) return null;
        const char = s.getActiveChar();
        const numOf = (v: number | boolean | undefined): number =>
          typeof v === "number" ? v : v === true ? 1 : 0;
        const readOf = (id: string): number =>
          numOf(isAccount ? s.accountValues[id] : char?.taskValues[id]);
        // Snapshot BEFORE writing, the children's values as the CALLER saw them
        // before the completing write (the caller's own read is already post-write).
        const ids = [taskId, ...children];
        const undo: GoalUndo = ids.map((id, i) => ({ id, value: i === 0 ? readOf(id) : childBefore[i - 1] ?? 0 }));
        const now = new Date();
        const buckets = { ...s.taskBuckets };
        for (const id of ids) buckets[id] = cycleBucketFor(id, s.customTasks, now);
        const write = (target: Record<string, number | boolean>): Record<string, number | boolean> => {
          const next = { ...target };
          next[taskId] = Math.min(COUNTER_SANITY_MAX, readOf(taskId) + 1);
          for (const child of children) next[child] = 0; // explicit zeros: the propagation bit
          return next;
        };
        if (isAccount) {
          set({ accountValues: write(s.accountValues), taskBuckets: buckets });
          return undo;
        }
        set({
          characters: s.characters.map((c) =>
            c.id === s.activeCharId ? { ...c, taskValues: write(c.taskValues) } : c
          ),
          taskBuckets: buckets,
        });
        return undo;
      },

      restoreGoalValues: (undo, isAccount) => {
        const s = get();
        const now = new Date();
        const buckets = { ...s.taskBuckets };
        // Re-stamp the CURRENT bucket: an undo pressed after the weekly rollover
        // must land in this week, not replay last week's provenance.
        for (const { id } of undo) buckets[id] = cycleBucketFor(id, s.customTasks, now);
        const write = (target: Record<string, number | boolean>): Record<string, number | boolean> => {
          const next = { ...target };
          for (const { id, value } of undo) next[id] = value;
          return next;
        };
        if (isAccount) {
          set({ accountValues: write(s.accountValues), taskBuckets: buckets });
          return;
        }
        set({
          characters: s.characters.map((c) =>
            c.id === s.activeCharId ? { ...c, taskValues: write(c.taskValues) } : c
          ),
          taskBuckets: buckets,
        });
      },

      clearSection: (section) =>
        set((s) => {
          // User-initiated clear zeroes in place (false/0 by stored type)
          // instead of deleting — same propagation-bit rule as toggleCheck:
          // a deleted clear would stay silent and resurrect on next pull.
          // Tids with no stored value stay absent (nothing to propagate).
          const now = new Date();
          const zeroOut = (
            values: Record<string, number | boolean>,
            ids: Set<string> | ((id: string) => boolean)
          ): { values: Record<string, number | boolean>; touched: string[] } => {
            const next = { ...values };
            const touched: string[] = [];
            for (const [id, v] of Object.entries(values)) {
              const hit = typeof ids === "function" ? ids(id) : ids.has(id);
              if (!hit) continue;
              next[id] = typeof v === "number" ? 0 : false;
              touched.push(id);
            }
            return { values: next, touched };
          };
          const stamp = (base: Record<string, string>, touched: string[]): Record<string, string> => {
            const nextBuckets = { ...base };
            for (const id of touched) {
              nextBuckets[id] = cycleBucketFor(id, s.customTasks, now);
            }
            return nextBuckets;
          };
          // daily/weekly -> per char active; account -> accountValues.
          // The whole account section clears together (both account-daily
          // and account-weekly): the old kind filter always resolved to the
          // first row's kind and silently skipped the weekly half.
          if (section === "account") {
            const match = (id: string): boolean => {
              const t = [...BUILTIN_TASKS, ...s.customTasks].find((x) => x.id === id);
              return !!t && t.section === "account";
            };
            const { values: nextAcc, touched } = zeroOut(s.accountValues, match);
            return { accountValues: nextAcc, taskBuckets: stamp(s.taskBuckets, touched) };
          }
          const char = s.getActiveChar();
          if (!char) return s;
          const idsToClear = new Set<string>();
          for (const t of [...BUILTIN_TASKS, ...s.customTasks]) {
            if (t.section !== section) continue;
            idsToClear.add(t.id);
          }
          // barter pins clear with their own cycle (daily pins with 每日,
          // weekly pins with 每週) so a section clear never touches the other cycle.
          // pinCycleOf reads both namespaces, so a shop:: counter clears with
          // its cycle too instead of being skipped as an unknown id.
          if (section === "daily" || section === "weekly") {
            for (const pid of s.barterPins) {
              if (pinCycleOf(pid) === section) idsToClear.add(pid);
            }
          }
          const target = s.characters.find((c) => c.id === s.activeCharId) ?? char;
          const { values: nextVal, touched } = zeroOut(target.taskValues, idsToClear);
          const nextChars = s.characters.map((c) => (c.id === s.activeCharId ? { ...c, taskValues: nextVal } : c));
          // server-shared pins render in this cycle's subsection but live in
          // accountValues — a section clear clears them too (they belong to this
          // cycle's UI, and the pool is shared so one clear clears for all).
          const sharedIds = new Set(
            s.barterPins.filter((pid) => isServerSharedPinId(pid) && pinCycleOf(pid) === section)
          );
          const { values: nextAcc, touched: touchedAcc } = zeroOut(s.accountValues, sharedIds);
          return {
            characters: nextChars,
            accountValues: nextAcc,
            taskBuckets: stamp(stamp(s.taskBuckets, touched), touchedAcc),
          };
        }),

      // single global list: one tap toggles for every character. A custom
      // display order (if any) drops unpins and appends new pins at the end.
      toggleBarterPin: (barterId) =>
        set((s) => {
          const pinned = s.barterPins.includes(barterId);
          return {
            barterPins: pinned ? s.barterPins.filter((x) => x !== barterId) : [...s.barterPins, barterId],
            barterCustomOrder:
              s.barterCustomOrder == null
                ? null
                : pinned
                  ? s.barterCustomOrder.filter((x) => x !== barterId)
                  : [...s.barterCustomOrder, barterId],
          };
        }),

      isBarterPinned: (barterId) => get().barterPins.includes(barterId),

      addCustomTask: (task) =>
        set((s) => {
          const id = `custom-${uid()}`;
          const order = Math.max(0, ...BUILTIN_TASKS.map((t) => t.order), ...s.customTasks.map((t) => t.order)) + 10;
          const newTask: Task = { ...task, id, order, source: "custom" } as Task;
          return { customTasks: [...s.customTasks, newTask] };
        }),
      updateCustomTask: (id, patch) =>
        set((s) => {
          const nextCustoms = s.customTasks.map((t) => (t.id === id ? { ...t, ...patch } : t));
          const nextBuckets = { ...s.taskBuckets };
          // A kind change moves the value to a different cycle (day ↔ week):
          // the old bucket would read as stale and the next prune would eat
          // a check the user never cleared. Re-stamp current-bucket instead.
          const oldKind = s.customTasks.find((t) => t.id === id)?.kind;
          const newKind = (patch as Partial<Task>).kind;
          if (newKind !== undefined && oldKind !== undefined && newKind !== oldKind && nextBuckets[id] !== undefined) {
            nextBuckets[id] = cycleBucketFor(id, nextCustoms, new Date());
          }
          return { customTasks: nextCustoms, taskBuckets: nextBuckets };
        }),
      removeCustomTask: (id) =>
        set((s) => {
          const nextBuckets = { ...s.taskBuckets };
          delete nextBuckets[id];
          // Also drop the row's order entry: globalTaskOrder rides the wire
          // (meta:taskorder), so a stale number would keep resurfacing.
          const nextGlobalOrder = s.globalTaskOrder ? { ...s.globalTaskOrder } : undefined;
          if (nextGlobalOrder) delete nextGlobalOrder[id];
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
            globalTaskOrder: nextGlobalOrder,
          };
        }),
      toggleHidden: (taskId) =>
        set((s) => {
          // account-section tasks AND server-shared barter/shop hide globally
          // (shared state, like accountValues). isServerSharedPinId covers BOTH
          // pin namespaces: a `shop::` row can be scope "account" too, and the
          // barter-only predicate missed those, so their eye wrote per-character
          // hidden state while the row read the account list.
          if (isAccountTaskId(taskId, s.customTasks) || isServerSharedPinId(taskId)) {
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
        if (isAccountTaskId(taskId, s.customTasks) || isServerSharedPinId(taskId))
          return (s.hiddenAccountTaskIds ?? []).includes(taskId);
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
          // First drag snapshots the current display (canonical unless
          // already custom) as the custom order going forward.
          const base = s.barterCustomOrder ?? canonicalBarterOrder(s.barterPins);
          const ordered = orderedIds.filter((id) => base.includes(id));
          const missing = base.filter((id) => !ordered.includes(id));
          return { barterCustomOrder: [...ordered, ...missing] };
        }),

      // Local-only: toggling never touches the sync layer (never synced,
      // unlike the order keys).
      toggleHourlyReminder: (taskId) => {
        set((s) => ({
          hourlyReminders: (s.hourlyReminders ?? []).includes(taskId)
            ? (s.hourlyReminders ?? []).filter((x) => x !== taskId)
            : [...(s.hourlyReminders ?? []), taskId],
        }));
        // Subscriptions flip rarely (unlike rapid counter taps), so flush
        // synchronously: an instant reload must not lose the tap to the
        // ~1.5s idle-write window.
        flushStorage();
      },

      isHourlyReminded: (taskId) => (get().hourlyReminders ?? []).includes(taskId),

      // Local-only: same rule as the hourly toggle (absent from sync keys).
      togglePurpleReminder: (taskId) => {
        set((s) => ({
          purpleHoleReminders: (s.purpleHoleReminders ?? []).includes(taskId)
            ? (s.purpleHoleReminders ?? []).filter((x) => x !== taskId)
            : [...(s.purpleHoleReminders ?? []), taskId],
        }));
        flushStorage();
      },

      isPurpleReminded: (taskId) => (get().purpleHoleReminders ?? []).includes(taskId),

      setWhatsNewNudged: (release) => {
        if (get().whatsNewNudged === release) return;
        set({ whatsNewNudged: release });
        flushStorage();
      },

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
          set({ ...preserveDeviceLocalState(migrated, data), _hasHydrated: true });
        } catch (e) {
          alert("匯入失敗：JSON 格式錯誤");
          console.error(e);
        }
      },
      resetAll: () => {
        // confirmation lives in the UI (ConfirmDialog, 清除全部 / 取消); this is the point of no return
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
      version: 23,
      migrate: (persisted: unknown, version: number) => migratePersisted(persisted, version),
      // `merge` runs on EVERY rehydration, where `migrate` runs only when the
      // stored version differs from the configured one. That difference is the
      // whole reason this exists: `prefs` is persisted as one object, so any key
      // added to it after a save was written is absent from that save, and a save
      // already sitting at the current version skips the step that would have
      // backfilled it. Repairing here means `s.prefs` is never null and both keys
      // are always booleans, so components can read `s.prefs.hideCompleted` and
      // `s.prefs.pinnedCollapsed[cycle]` directly instead of guarding in four
      // places. Individual keys keep the persisted value where present.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState>;
        const pref = (p.prefs ?? {}) as Partial<AppState["prefs"]>;
        const merged = {
          ...current,
          ...p,
          prefs: {
            hideCompleted: pref.hideCompleted ?? current.prefs.hideCompleted,
            pinnedCollapsed: {
              daily: pref.pinnedCollapsed?.daily ?? current.prefs.pinnedCollapsed.daily,
              weekly: pref.pinnedCollapsed?.weekly ?? current.prefs.pinnedCollapsed.weekly,
            },
          },
        } as Store;
        // `migrate` only runs when the stored version differs, so the ingest
        // coercion it performs must also run here (see coerceCounterBooleans).
        coerceCounterBooleans({
          characters: merged.characters,
          accountValues: merged.accountValues,
          customTasks: merged.customTasks,
        });
        return merged;
      },
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
        barterCustomOrder: s.barterCustomOrder,
        customTasks: s.customTasks,
        lastDailyReset: s.lastDailyReset,
        lastWeeklyReset: s.lastWeeklyReset,
        prefs: s.prefs,
        globalTaskOrder: s.globalTaskOrder,
        taskBuckets: s.taskBuckets,
        hourlyReminders: s.hourlyReminders,
        purpleHoleReminders: s.purpleHoleReminders,
        whatsNewNudged: s.whatsNewNudged,
      }),
    }
  )
);
