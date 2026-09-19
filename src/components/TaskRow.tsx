import { useEffect, useReducer, useRef, useState } from "react";
import { useAppStore } from "@/store/useAppStore";
import { useGrabCounter } from "@/hooks/useGrabCounter";
import type { Task } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { confirmRemoveTask, confirmReenableReminder, confirmSubscribeReminder } from "@/components/ConfirmDialog";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/useIsMobile";
import { EyeOff, Eye, MoreHorizontal, Trash2, Pencil, GripVertical, Bell, BellRing } from "lucide-react";
import { isEligibleReminderId, reminderPermission, requestReminderPermission, waitForReminderGrant } from "@/lib/hourlyReminders";
import { isServerPushMode, isIOSWithoutPWA, reconcileServerPush, refreshServerRoster, serverPushOn, subscribeServerPush, unsubscribeServerPush } from "@/lib/serverPush";
import { PURPLE_HOLE_ID, formatTaipei, purpleLive } from "@/lib/purpleHole";
import { formatCountdown } from "@/lib/reset";
import { useNow } from "@/hooks/useNow";
import { SchedulePopover } from "@/components/SchedulePopover";

/**
 * Purple-hole spawn badges, live: a 1s ticker recomputes countdown text, so
 * the row crosses spawn/fresh/stale boundaries with no refresh. Exact
 * datetimes live in the calendar popover — the row answers "how long until".
 */
function ScheduleBadges() {
  const now = useNow(1000);
  const live = purpleLive(now);
  if (!live) return null;
  // Fresh spawn (within 15 min): the window is happening now.
  if (live.kind === "live") {
    return (
      <span className="text-xs whitespace-nowrap shrink-0 font-medium tabular-nums text-emerald-600 dark:text-emerald-400">
        進行中 {formatCountdown(live.endsMs - now)}
      </span>
    );
  }
  const next = (
    <Tooltip content={formatTaipei(live.nextMs)}>
      <span className="text-xs whitespace-nowrap shrink-0 font-medium tabular-nums text-violet-600 dark:text-violet-400">
        下次 {formatCountdown(live.nextMs - now)}
      </span>
    </Tooltip>
  );
  if (live.kind === "upcoming") return next;
  // Static timestamp: a ticking elapsed clock here felt noisy, and 上次
  // pairs with 下次.
  return (
    <>
      <span className="text-xs whitespace-nowrap shrink-0 text-muted-foreground">
        上次 {formatTaipei(live.pastMs)}
      </span>
      {next}
    </>
  );
}
import { PermissionCoachMark, type CoachMarkKind } from "@/components/PermissionCoachMark";
import { Tooltip } from "@/components/ui/tooltip";
import { MaterialHoverCard } from "@/components/MaterialHoverCard";
import { dealTimes, parseItemQty } from "@/lib/materials";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type Props = {
  task: Task;
  value: boolean | number | undefined;
  isAccount: boolean;
  onEdit?: () => void;
};

export function TaskRow(props: Props) {
  const isMobile = useIsMobile();
  return isMobile ? <TaskRowMobile {...props} /> : <TaskRowDesktop {...props} />;
}

/**
 * Event reminder toggle. Permission is requested from this tap — the only
 * user gesture browsers accept. Both lanes stay armed per bell (local entry
 * + server subscription; visibility decides who fires), so the two backends
 * can't double-card. The permission machinery is identical across lanes;
 * only the subscribe end differs (hourly names names via opt-in linkage,
 * purple names zones).
 */
export type ReminderLane = "hourly" | "purple";

const PURPLE_SOFT_ASK =
  "出沒前 15 分鐘提醒一次，App 沒開就不會響。時間是預測值，僅供參考。設定只留在這台裝置，隨時點鈴鐺就能取消。按下訂閱後，瀏覽器會再確認一次（Chrome 的提示在左上角），請選允許。";

// Server-mode soft-ask: App-closed delivery + the linkage disclosure (the
// opt-in moment for D1a — tapping 訂閱 after reading this is the consent)
// + deletion assurance. Replaces the default copy, whose "App 沒開就不會響"
// would lie here.
const SERVER_SOFT_ASK =
  "整點推播到這台裝置，App 沒開也會響。若有同步連結，卡片會顯示未完成角色的名字（提醒時只讀取當日結界狀態）；沒有連結就是通用提醒。取消訂閱會同時刪除伺服器上的資料。按下訂閱後，瀏覽器會再確認一次，請選允許。";

// Server-mode soft-ask for the purple lane: App-closed delivery, no linkage
// (cards name zones, never people), deletion assurance. Replaces the default
// copy, whose "App 沒開就不會響" would lie here.
const PURPLE_SERVER_SOFT_ASK =
  "出沒 15 分鐘前推播到這台裝置，App 沒開也會響。時間是預測值，僅供參考。取消訂閱會同時刪除伺服器上的資料。按下訂閱後，瀏覽器會再確認一次，請選允許。";

function useReminderToggle(taskId: string, taskName: string, lane: ReminderLane) {
  const hourlyOn = useAppStore((s) => (s.hourlyReminders ?? []).includes(taskId));
  const purpleOn = useAppStore((s) => (s.purpleHoleReminders ?? []).includes(taskId));
  const toggleHourly = useAppStore((s) => s.toggleHourlyReminder);
  const togglePurple = useAppStore((s) => s.togglePurpleReminder);
  // Server mode per lane (flagged): bell state reads the device endpoint
  // map. Both lanes stay armed — visibility decides who fires (visible →
  // local with live done-state, hidden → server), so the two never stack
  // without deleting anything (replaces the D6 heal).
  const serverMode = isServerPushMode(lane);
  // The endpoint map is localStorage, not reactive — bump to re-render it.
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const on = serverMode ? serverPushOn(taskId, lane) : lane === "purple" ? purpleOn : hourlyOn;
  const toggle = lane === "purple" ? togglePurple : toggleHourly;
  const [coach, setCoach] = useState<CoachMarkKind | null>(null);
  const waiterRef = useRef<AbortController | null>(null);
  // Row unmount (filter/hide/reorder) mid-wait must not leave the 120s poll
  // + permission listener running until timeout.
  useEffect(() => () => waiterRef.current?.abort(), []);
  // Server-mode mount reconciliation: drop map claims whose live
  // subscription is gone (the fanout couldn't reach them anyway). Local
  // entries are KEPT — visibility split, not deletion, prevents doubles.
  useEffect(() => {
    if (!serverMode) return;
    void reconcileServerPush(taskId, lane).then((changed) => {
      if (changed) bump();
      // Healthy claims refresh the roster snapshot (renames / new chars)
      // and pick up a session linked after subscribing — silent by design,
      // the soft-ask already disclosed both. Hourly only: the purple lane
      // is unlinked, there is nothing to refresh.
      else if (lane === "hourly" && serverPushOn(taskId, lane)) void refreshServerRoster(taskId);
    });
  }, [serverMode, taskId, lane]);
  // Idempotent: the permission watcher and the direct path can both land.
  const subscribe = () => {
    const s = useAppStore.getState();
    if (lane === "purple") {
      if (!(s.purpleHoleReminders ?? []).includes(taskId)) s.togglePurpleReminder(taskId);
    } else {
      if (!(s.hourlyReminders ?? []).includes(taskId)) s.toggleHourlyReminder(taskId);
    }
  };
  // Server subscribe end: device sub + registry POST (rolls back on POST
  // failure), then arm the local lane too + re-render. Both lanes stay
  // armed (visibility decides who fires); failures leave the bell off,
  // never half-subscribed. Alerts stay plain-worded like the rest of
  // this flow.
  const finalizeServerSubscribe = async (): Promise<void> => {
    const armLocal = () => {
      const s = useAppStore.getState();
      if (lane === "purple") {
        if (!(s.purpleHoleReminders ?? []).includes(taskId)) s.togglePurpleReminder(taskId);
      } else {
        if (!(s.hourlyReminders ?? []).includes(taskId)) s.toggleHourlyReminder(taskId);
      }
    };
    const r = await subscribeServerPush(taskId, lane);
    if (r === "ok") {
      armLocal();
      bump();
    } else if (r === "need-sw") {
      // No Service Worker here (dev preview, SW-less browsers): the server
      // lane is unreachable, but the local timer works fine — arm it instead
      // of leaving the user with nothing. The bell still reads the server
      // map (off), so a re-tap is a harmless no-op re-arm.
      armLocal();
      bump();
    } else {
      alert("訂閱失敗，請再試一次。");
    }
  };
  // Dismissing the coach mark means "leave me alone": stop the watcher so
  // nothing subscribes behind the user's back.
  const dismissCoach = () => {
    waiterRef.current?.abort();
    setCoach(null);
  };
  // Arm a fresh watcher (aborting any orphan first: a rapid re-tap must not
  // leave one whose grant-subscribe fires after the user asked to be alone).
  // Resolves true when the grant lands (already subscribed by then).
  const armWatcher = () => {
    waiterRef.current?.abort();
    const waiter = new AbortController();
    waiterRef.current = waiter;
    const watch = waitForReminderGrant(120_000, waiter.signal).then((granted) => {
      if (granted) {
        if (serverMode) void finalizeServerSubscribe();
        else subscribe();
      }
      return granted;
    });
    return { waiter, watch };
  };
  // Denied with no prompt to show: point at the settings path, then keep
  // retrying silently. The dialog is single-button (關閉 = "got it"), so
  // there is no explicit "later" to honor — the waiting pill (dismissible
  // via X, which aborts) is the only opt-out, and flipping the switch in
  // settings auto-completes.
  const guideReenable = async (waiter: AbortController, watch: Promise<boolean>) => {
    await confirmReenableReminder();
    if (reminderPermission() === "granted") {
      if (serverMode) await finalizeServerSubscribe();
      else subscribe();
      waiter.abort();
      return;
    }
    setCoach("waiting");
    await watch;
    setCoach(null);
  };
  const onToggle = async () => {
    if (on) {
      if (serverMode) {
        await unsubscribeServerPush(taskId, lane);
        // Symmetric with subscribe: both lanes disarm, or the orphan local
        // timer keeps firing after the bell goes off.
        const s = useAppStore.getState();
        if (lane === "purple") {
          if ((s.purpleHoleReminders ?? []).includes(taskId)) s.togglePurpleReminder(taskId);
        } else {
          if ((s.hourlyReminders ?? []).includes(taskId)) s.toggleHourlyReminder(taskId);
        }
        bump();
        return;
      }
      toggle(taskId);
      return;
    }
    // iOS Safari tabs (not installed) can never subscribe — no native prompt,
    // no settings switch. Say so up front instead of failing into retries.
    if (serverMode && isIOSWithoutPWA()) {
      alert("iOS 的推播只能從主畫面的 App 使用：先用分享 → 加入主畫面安裝，再從主畫面開啟本站點鈴鐺訂閱。");
      return;
    }
    const perm = reminderPermission();
    if (perm === "unsupported") {
      alert("此瀏覽器不支援系統通知，無法使用開場提醒。");
      return;
    }
    if (perm === "granted") {
      // Already allowed: one tap subscribes, no dialogs at all.
      if (serverMode) {
        await finalizeServerSubscribe();
        return;
      }
      subscribe();
      return;
    }
    // Arm BEFORE prompting: if the grant lands via browser UI (the Chrome
    // address-bar chip, site settings) instead of our prompt, subscribing
    // completes on its own — no reload, no second bell tap, no re-confirm.
    const { waiter, watch } = armWatcher();
    if (perm === "denied") {
      // No prompt will ever show again: say exactly where the switch is.
      await guideReenable(waiter, watch);
      return;
    }
    // Soft-ask before the browser prompt: cold prompts get reflex-denied.
    // The dialog tap keeps the user gesture alive for requestPermission.
    const softAsk =
      lane === "purple"
        ? serverMode
          ? PURPLE_SERVER_SOFT_ASK
          : PURPLE_SOFT_ASK
        : serverMode
          ? SERVER_SOFT_ASK
          : undefined;
    if (!(await confirmSubscribeReminder(taskName, softAsk))) {
      waiter.abort();
      await watch;
      return;
    }
    // Coach mark while the native prompt is live: dimmed page + "look up"
    // card, both pointer-transparent so the Allow tap always lands.
    setCoach("prompt");
    const p = await requestReminderPermission();
    setCoach(null);
    if (p === "granted") {
      if (serverMode) await finalizeServerSubscribe();
      else subscribe();
      waiter.abort();
    } else if (p === "denied") {
      await guideReenable(waiter, watch);
    } else {
      // dismissed prompt (stays "default"): the chip is the likely story.
      // A quiet pill replaces the old blocking alert; the watcher finishes
      // the job if they allow from browser UI.
      setCoach("waiting");
      const granted = await watch;
      setCoach(null);
      if (!granted && reminderPermission() === "denied") {
        // Flipped to denied while waiting (chip Block / settings): the pill
        // vanishing with no word is the dead end — route to guidance with a
        // fresh watcher instead.
        const re = armWatcher();
        await guideReenable(re.waiter, re.watch);
      }
      // timeout (still "default"): nothing to say, stay unsubscribed
    }
  };
  return { on, onToggle, coach, dismissCoach };
}

function ReminderBell({ taskId, taskName, lane, className }: { taskId: string; taskName: string; lane: ReminderLane; className?: string }) {
  const { on, onToggle, coach, dismissCoach } = useReminderToggle(taskId, taskName, lane);
  const noun = lane === "purple" ? "出沒提醒" : "開場提醒";
  return (
    <>
      <Tooltip content={on ? "取消訂閱通知" : "訂閱通知"}>
        <button
          onClick={() => void onToggle()}
          // Ring, not just bg: the row itself hovers to bg-accent, so a
          // bg-only hover would be invisible against it. Solid ring + text
          // shift read on both card and hovered-row backgrounds (and stay
          // stable under Chrome forced-dark: no blur, translucency, or fade).
          className={className ?? "h-6 w-6 grid place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground hover:ring-1 hover:ring-ring"}
          aria-label={`${on ? "取消" : "訂閱"}${noun}：${taskName}`}
          aria-pressed={on}
        >
          {on ? <BellRing className="h-3.5 w-3.5 text-amber-500" /> : <Bell className="h-3.5 w-3.5" />}
        </button>
      </Tooltip>
      {coach && <PermissionCoachMark kind={coach} taskName={taskName} onClose={dismissCoach} />}
    </>
  );
}

/** Whole-deal multiplier for a tracker barter row's hover card (twin leg's
 *  limit.times, else the row limit string, else 1). */
function barterTimes(task: Task): number {
  const get = parseItemQty(task.barterMeta?.get ?? "");
  return dealTimes(task.npc ?? "", get.name, get.qty, task.barterMeta?.limit);
}

function TaskRowMobile({ task, value, isAccount, onEdit }: Props) {
  const toggleCheck = useAppStore((s) => s.toggleCheck);
  const toggleHidden = useAppStore((s) => s.toggleHidden);
  const removeCustom = useAppStore((s) => s.removeCustomTask);
  const isHidden = useAppStore((s) => s.isTaskHidden(task.id));
  const hideScope = task.section === "account" ? "（所有角色共用）" : task.serverShared === true ? "（伺服器共用）" : "";

  const isCheck = task.type === "check";
  const checked = isCheck ? Boolean(value) : false;
  const count = !isCheck ? (typeof value === "number" ? value : 0) : 0;
  const isDone = isCheck ? checked : count >= (task.max ?? 0) && (task.max ?? 0) > 0;

  const isCustom = task.source === "custom";
  const isBarter = task.source === "barter";
  // Event-reminder bell: only eligible tasks (today just 不祥的召喚結界).
  const reminderEligible = isEligibleReminderId(task.id);
  // Purple lane (timetable + 15-min-early bell): purple-hole only, on spawn
  // days. Same gate shape, separate subscription list.
  const scheduleEligible = task.id === PURPLE_HOLE_ID;
  const purpleReminderEligible = scheduleEligible;
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: task.id });
  const style: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition };
  const [npcImgError, setNpcImgError] = useState(false);
  const showNpc = isBarter && task.npc && !npcImgError;
  const getRes = isBarter ? (task.barterMeta?.get ?? "").replace(/ ×\d+$/, "") : "";

  // two-line row, no ellipsis: title line (name only, ⋯/👁 top-right) +
  // badge line (always its own line so long names never orphan) + body line
  // (desc block with 44px tile vertically centered). Right column is w-11.
  const badges = isBarter
    ? (<>
      {task.priority === "must" && (
        <span className="rounded bg-red-100 text-red-700 dark:bg-red-900/30 px-1.5 py-0.5 text-[10px] whitespace-nowrap shrink-0">必換</span>
      )}
      {task.serverShared === true && (
        <span className="rounded bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300 px-1.5 py-0.5 text-[10px] whitespace-nowrap shrink-0">伺服器</span>
      )}
    </>)
    : (<>
      {task.priority === "must" && <span className="rounded bg-red-100 text-red-700 dark:bg-red-900/30 px-1.5 py-0.5 text-[10px] whitespace-nowrap shrink-0">必做</span>}
      {task.source === "custom" && <span className="rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 px-1.5 py-0.5 text-[10px] whitespace-nowrap shrink-0">自訂</span>}
      {isBarter && <span className="rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 px-1.5 py-0.5 text-[10px] whitespace-nowrap shrink-0">{task.town}</span>}
    </>);

  const title = isBarter ? (
    <div>
      <div className="flex items-center gap-1.5 text-sm font-bold text-primary">
        {showNpc ? (
          <img
            src={`/npc/${encodeURIComponent(task.npc!)}.png`}
            alt=""
            aria-hidden
            className="h-5 w-5 shrink-0 rounded-full object-cover border border-border/50 bg-muted"
            loading="lazy"
            onError={() => setNpcImgError(true)}
          />
        ) : (
          <span className="shrink-0" aria-hidden>{task.icon}</span>
        )}
        <span className={cn("min-w-0 flex-1 break-words", isDone && "line-through decoration-muted-foreground/50")}>{getRes}</span>
        {reminderEligible && <ReminderBell lane="hourly" taskId={task.id} taskName={task.name} />}
      </div>
      {(task.priority === "must" || task.serverShared === true) && <div className="mt-1 flex flex-wrap gap-1">{badges}</div>}
    </div>
  ) : (
    <div>
      <div className="flex items-center gap-1.5 text-sm font-medium">
        <span className="shrink-0" aria-hidden>{task.icon}</span>
        <span className={cn("min-w-0 flex-1 break-words", isDone && "line-through decoration-muted-foreground/50")}>{task.name}</span>
        {reminderEligible && <ReminderBell lane="hourly" taskId={task.id} taskName={task.name} />}
        {purpleReminderEligible && <ReminderBell lane="purple" taskId={task.id} taskName={task.name} />}
      </div>
      {scheduleEligible && (
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2">
          <ScheduleBadges />
          <SchedulePopover taskName={task.name} />
        </div>
      )}
      {(task.priority === "must" || task.source === "custom" || isBarter) && (
        <div className="mt-1 flex flex-wrap gap-1">{badges}</div>
      )}
    </div>
  );

  const body = isBarter ? (
    <div className="min-w-0 flex-1">
      <div className="text-xs text-muted-foreground break-words">
        {task.npc} · {task.town} · {task.barterMeta?.limit}
      </div>
      <div className="text-xs text-muted-foreground break-words">
        <MaterialHoverCard
          give={task.barterMeta?.give ?? ""}
          get={task.barterMeta?.get ?? ""}
          times={barterTimes(task)}
        />
      </div>
      {task.notes && <p className="text-xs text-amber-700 dark:text-amber-300 mt-1 italic break-words">📝 {task.notes}</p>}
    </div>
  ) : (
    <div className="min-w-0 flex-1">
      <p className="text-xs text-muted-foreground leading-snug break-words whitespace-pre-wrap">
        {task.desc || "\u00A0"}
      </p>
      {task.notes && <p className="text-xs text-amber-700 dark:text-amber-300 mt-1 italic break-words">📝 {task.notes}</p>}
    </div>
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-task-row="true"
      data-task-id={task.id}
      className={cn(
        // No background transition: Chrome's "Auto Dark Mode for Web Contents"
        // re-darkens every painted frame, so an animated translucent hover
        // strobes. Solid hover without transition is stable there.
        "rounded-lg border bg-card p-3 relative",
        isDone ? "bg-muted/50 border-muted" : "hover:bg-accent",
        isHidden ? "opacity-50" : ""
      )}
     >
      <button {...attributes} {...listeners} className="cursor-grab w-5 py-1 opacity-40 hover:opacity-100 touch-none absolute left-1 top-1/2 -translate-y-1/2 flex justify-center" aria-label="drag">
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="min-w-0 pl-5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">{title}</div>
        <div className="w-11 shrink-0 flex justify-end">
          {isCustom ? (
            <RowMenu
              isHidden={isHidden}
              hideScope={hideScope}
              onEdit={onEdit}
              onToggleHidden={() => toggleHidden(task.id)}
              onRemove={() => {
                void confirmRemoveTask(task.name).then((ok) => {
                  if (ok) removeCustom(task.id);
                });
              }}
            />
          ) : (
            <button
              onClick={() => toggleHidden(task.id)}
              className="h-6 w-6 grid place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label={`${isHidden ? "顯示" : "隱藏"}${hideScope}`}
            >
              {isHidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 mt-1">
        {body}
        <div className="w-11 shrink-0 flex justify-center">
          {isCheck ? (
            <button
              className={cn(
                "h-11 w-11 rounded-xl border grid place-items-center transition-colors",
                checked ? "bg-emerald-600 border-emerald-600 text-white" : "bg-card hover:border-primary"
              )}
              onClick={() => toggleCheck(task.id, isAccount)}
              aria-label={task.name}
              role="checkbox"
              aria-checked={checked}
            >
              <span className="text-lg leading-none">{checked ? "✓" : ""}</span>
            </button>
          ) : (
            <CounterTileMobile taskId={task.id} count={count} max={task.max ?? 0} isAccount={isAccount} countdown={task.type === "countdown"} />
          )}
        </div>
      </div>
      </div>
    </div>
  );
}

function RowMenu({ isHidden, hideScope, onEdit, onToggleHidden, onRemove }: {
  isHidden: boolean;
  hideScope?: string;
  onEdit?: () => void;
  onToggleHidden: () => void;
  onRemove: () => void;
}) {
  // Radix portal escapes the section Card's overflow-hidden; collision
  // handling flips the menu automatically near viewport edges. Also gains
  // outside-click / Escape dismiss over the old hand-rolled absolute menu.
  // Non-modal: a row menu must not scroll-lock the page beneath it.
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          className="h-7 w-7 grid place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="row actions"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-28">
        {onEdit && (
          <DropdownMenuItem onSelect={onEdit} className="text-xs">
            <Pencil className="h-3.5 w-3.5" />編輯
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={onToggleHidden} className="text-xs">
          {isHidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}{isHidden ? "顯示" : "隱藏"}{hideScope}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onRemove} className="text-xs text-destructive focus:text-destructive">
          <Trash2 className="h-3.5 w-3.5" />刪除
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Tap tile for counters: tap = +1, full tile taps back to 0 (like unchecking),
// right-click / 550ms long-press = −1. Progress is the fill rising inside the tile.
// Tap tile for counters: tap = +1, full tile taps back to 0 (like unchecking),
// right-click = −1. Hold 0.3s → grab, drag vertically to adjust fast.
// Progress is the fill rising inside the tile.
function CounterTileMobile({ taskId, count, max, isAccount, countdown }: { taskId: string; count: number; max: number; isAccount: boolean; countdown?: boolean }) {
  const { grabbed, coach, wrapRef, handlers } = useGrabCounter(taskId, count, max, isAccount);
  const pct = max ? Math.min(100, (count / max) * 100) : 0;
  const done = max > 0 && count >= max;
  // countdown mode: big number counts down (剩 N), fill still rises with used
  const shown = countdown ? Math.max(0, max - count) : count;
  // done look lands only at rest; while grabbing, always numbers on unflipped tile
  const showCheck = done && !grabbed;
  return (
    <span ref={wrapRef} className="relative inline-block">
      <button
        className={cn(
          "relative block h-11 w-11 rounded-xl border overflow-hidden select-none transition-colors",
          showCheck ? "bg-emerald-600 border-emerald-600 text-white" : "bg-card hover:border-primary",
          grabbed && "ring-2 ring-primary scale-105 cursor-ns-resize border-primary"
        )}
        style={{ touchAction: "none" }}
        aria-label={countdown ? `剩餘 ${shown} 次，共 ${max} 次，點一下加一，長按拖曳快速調整` : `${count} / ${max}，點一下加一，長按拖曳快速調整`}
        {...handlers}
      >
        <span className="absolute bottom-0 left-0 right-0 bg-emerald-500/25 transition-all" style={{ height: `${pct}%` }} />
        <span className="absolute inset-0 grid place-items-center">
          {showCheck ? (
            <span className="text-lg leading-none text-white">✓</span>
          ) : (
            <span className="font-mono leading-none">
              {countdown && <span className="text-[10px] text-muted-foreground">剩</span>}
              <span className="text-base font-semibold">{shown}</span>
              <span className="text-[10px] text-muted-foreground">/{max}</span>
            </span>
          )}
        </span>
      </button>
      {grabbed && (
        <span className="absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground" aria-hidden>
          ↕ 拖曳調整中
        </span>
      )}
      {coach && !grabbed && (
        <span className="absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded border bg-popover px-1.5 py-0.5 text-[10px] text-popover-foreground shadow-md" aria-hidden>
          ↕ 長按拖曳快速加減
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Desktop variant. Desktop and mobile evolve together — every change considers
// both.
// ---------------------------------------------------------------------------

function TaskRowDesktop({ task, value, isAccount, onEdit }: Props) {
  const toggleCheck = useAppStore((s) => s.toggleCheck);
  const toggleHidden = useAppStore((s) => s.toggleHidden);
  const removeCustom = useAppStore((s) => s.removeCustomTask);
  const isHidden = useAppStore((s) => s.isTaskHidden(task.id));
  const reminderEligible = isEligibleReminderId(task.id);
  const scheduleEligible = task.id === PURPLE_HOLE_ID;
  const purpleReminderEligible = scheduleEligible;
  const hideScope = task.section === "account" ? "（所有角色共用）" : task.serverShared === true ? "（伺服器共用）" : "";
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: task.id });
  const style: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition };

  const isCheck = task.type === "check";
  const checked = isCheck ? Boolean(value) : false;
  const count = !isCheck ? (typeof value === "number" ? value : 0) : 0;
  const isDone = isCheck ? checked : count >= (task.max ?? 0) && (task.max ?? 0) > 0;

  const isBarter = task.source === "barter";
  const [npcImgError, setNpcImgError] = useState(false);
  const showNpc = isBarter && task.npc && !npcImgError;
  const getRes = isBarter ? (task.barterMeta?.get ?? "").replace(/ ×\d+$/, "") : "";
  return (
    <div
      ref={setNodeRef}
      style={style}
      data-task-row="true"
      data-task-id={task.id}
      className={cn(
        // compact: progress lives inside the action tile, so no reserved bar height.
        // No background transition + solid hover + solid floating eye button:
        // Chrome forced-dark repaints translucent/blurred/animating layers per
        // frame and flashes on hover otherwise.
        "group relative flex items-center gap-3 rounded-lg border px-3 py-2.5 min-h-[88px] pr-14",
        isDone ? "bg-muted/50 border-muted" : "bg-card hover:bg-accent",
        isHidden ? "opacity-50" : ""
      )}
     >
      <button {...attributes} {...listeners} className="cursor-grab p-1 opacity-40 hover:opacity-100 touch-none" aria-label="drag">
        <GripVertical className="h-4 w-4" />
      </button>
      {showNpc ? (
        <img
          src={`/npc/${encodeURIComponent(task.npc!)}.png`}
          alt={task.npc!}
          className="h-[50px] w-[50px] rounded-full object-cover shrink-0 border border-border/50 bg-muted"
          loading="lazy"
          onError={(e) => {
            (e.target as HTMLImageElement).src = "/npc/placeholder.png";
            setNpcImgError(false);
          }}
        />
      ) : (
        <span className="h-[50px] w-[50px] shrink-0 grid place-items-center text-2xl leading-none select-none" aria-hidden>
          {task.icon}
        </span>
      )}
      {isBarter ? (
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={cn("text-sm font-bold text-primary truncate", isDone && "line-through decoration-muted-foreground/50")}>{getRes}</span>
            {reminderEligible && <ReminderBell lane="hourly" taskId={task.id} taskName={task.name} />}
            {task.priority === "must" && <span className="rounded bg-red-100 text-red-700 dark:bg-red-900/30 px-1.5 py-0.5 text-[10px] shrink-0">必換</span>}
            {task.serverShared === true && <span className="rounded bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300 px-1.5 py-0.5 text-[10px] shrink-0">伺服器</span>}
            <span className="ml-auto flex items-center gap-1 text-xs shrink-0 min-w-0">
              <span className="font-medium truncate">{task.npc}</span>
              <span className="text-muted-foreground truncate">· {task.town}</span>
            </span>
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground min-w-0">
            <span className="truncate">
              <MaterialHoverCard
                give={task.barterMeta?.give ?? ""}
                get={task.barterMeta?.get ?? ""}
                compact
                times={barterTimes(task)}
              />
            </span>
            <span className="ml-auto shrink-0">{task.barterMeta?.limit}</span>
          </div>
          {task.notes && <p className="text-xs text-amber-700 dark:text-amber-300 mt-1 italic line-clamp-1">📝 {task.notes}</p>}
        </div>
      ) : (
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={cn("text-sm font-medium truncate", isDone && "line-through decoration-muted-foreground/50")}>{task.name}</span>
          {reminderEligible && <ReminderBell lane="hourly" taskId={task.id} taskName={task.name} />}
          {purpleReminderEligible && <ReminderBell lane="purple" taskId={task.id} taskName={task.name} />}
          {task.priority === "must" && <span className="rounded bg-red-100 text-red-700 dark:bg-red-900/30 px-1.5 py-0.5 text-[10px]">必做</span>}
          {task.source === "custom" && <span className="rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 px-1.5 py-0.5 text-[10px]">自訂</span>}
          {isBarter && <span className="rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 px-1.5 py-0.5 text-[10px]">{task.town}</span>}
        </div>
        {scheduleEligible && (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2">
            <ScheduleBadges />
            <SchedulePopover taskName={task.name} />
          </div>
        )}
        <p className="text-xs text-muted-foreground leading-snug break-words whitespace-pre-wrap mt-0.5 line-clamp-2 min-h-[32px] md:min-h-[32px] md:line-clamp-2">
          {task.desc || "\u00A0"}
        </p>
        {task.notes && <p className="text-xs text-amber-700 dark:text-amber-300 mt-1 italic line-clamp-1">📝 {task.notes}</p>}
      </div>
      )}

      {/* action slot hugs the 56px tile — identical box for check and counter */}
      <div className="flex items-center justify-center shrink-0 w-14 self-center">
        {isCheck ? (
          <button
            className={cn(
              "h-14 w-14 rounded-xl border grid place-items-center transition-colors",
              checked ? "bg-emerald-600 border-emerald-600 text-white" : "bg-card hover:border-primary"
            )}
            onClick={() => toggleCheck(task.id, isAccount)}
            aria-label={task.name}
            role="checkbox"
            aria-checked={checked}
          >
            <span className="text-xl leading-none">{checked ? "✓" : ""}</span>
          </button>
        ) : (
          <CounterTileDesktop taskId={task.id} count={count} max={task.max ?? 0} isAccount={isAccount} countdown={task.type === "countdown"} />
        )}
      </div>

      {/* A) always-faint in gutter — balances ≡ left weight, no overlap.
          Custom rows: bare ⋯ at full opacity (hide lives inside the menu).
          Builtin rows keep the single faint hide icon. */}
      {task.source === "custom" ? (
        <div className="absolute right-2 top-1/2 -translate-y-1/2">
          <RowMenu
            isHidden={isHidden}
            hideScope={hideScope}
            onEdit={onEdit}
            onToggleHidden={() => toggleHidden(task.id)}
            onRemove={() => {
              void confirmRemoveTask(task.name).then((ok) => {
                if (ok) removeCustom(task.id);
              });
            }}
          />
        </div>
      ) : (
        <div className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md border bg-card shadow-sm opacity-20 pointer-events-auto group-hover:opacity-100 group-focus-within:opacity-100">
          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 rounded-md" onClick={() => toggleHidden(task.id)} aria-label={`${isHidden ? "show" : "hide"}${hideScope}`}>
            {isHidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          </Button>
        </div>
      )}
    </div>
  );
}

// Tap tile for counters: tap = +1, full tile taps back to 0 (like unchecking),
// right-click = −1. Hold 0.3s → grab, drag vertically to adjust fast.
// Progress is the fill rising inside the tile.
function CounterTileDesktop({ taskId, count, max, isAccount, countdown }: { taskId: string; count: number; max: number; isAccount: boolean; countdown?: boolean }) {
  const { grabbed, coach, wrapRef, handlers } = useGrabCounter(taskId, count, max, isAccount);
  const pct = max ? Math.min(100, (count / max) * 100) : 0;
  const done = max > 0 && count >= max;
  // countdown mode: big number counts down (剩 N), fill still rises with used
  const shown = countdown ? Math.max(0, max - count) : count;
  // done look lands only at rest; while grabbing, always numbers on unflipped tile
  const showCheck = done && !grabbed;
  return (
    <span ref={wrapRef} className="relative inline-block">
      <button
        className={cn(
          "relative block h-14 w-14 rounded-xl border overflow-hidden select-none transition-colors",
          showCheck ? "bg-emerald-600 border-emerald-600 text-white" : "bg-card hover:border-primary",
          grabbed && "ring-2 ring-primary scale-105 cursor-ns-resize border-primary"
        )}
        style={{ touchAction: "none" }}
        aria-label={countdown ? `剩餘 ${shown} 次，共 ${max} 次，點一下加一，長按拖曳快速調整` : `${count} / ${max}，點一下加一，長按拖曳快速調整`}
        {...handlers}
      >
        <span className="absolute bottom-0 left-0 right-0 bg-emerald-500/25 transition-all" style={{ height: `${pct}%` }} />
        <span className="absolute inset-0 grid place-items-center">
          {showCheck ? (
            <span className="text-xl leading-none text-white">✓</span>
          ) : (
            <span className="font-mono leading-none">
              {countdown && <span className="text-[10px] text-muted-foreground">剩</span>}
              <span className="text-lg font-semibold">{shown}</span>
              <span className="text-[10px] text-muted-foreground">/{max}</span>
            </span>
          )}
        </span>
      </button>
      {grabbed && (
        <span className="absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground" aria-hidden>
          ↕ 拖曳調整中
        </span>
      )}
      {coach && !grabbed && (
        <span className="absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded border bg-popover px-1.5 py-0.5 text-[10px] text-popover-foreground shadow-md" aria-hidden>
          ↕ 長按拖曳快速加減
        </span>
      )}
    </span>
  );
}
