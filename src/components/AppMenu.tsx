import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { WhatsNewDrawer } from "@/components/WhatsNewDrawer";
import { acceptUpdate, useUpdateReady } from "@/lib/updatePrompt";
import { useWhatsNew, dotFor, taipeiDate } from "@/lib/whatsNew";
import { useSyncStatus, type SyncStatus } from "@/sync/status";
import type { ThemeMode } from "@/hooks/useTheme";

/** 外觀's three settings, in the order the row lists them. `system` first: it is
 *  the default, and putting the default first keeps the choice the user most
 *  often wants one click from the top of the group. */
const THEME_CHOICES: { value: ThemeMode; label: string }[] = [
  { value: "system", label: "跟隨系統" },
  { value: "light", label: "淺色" },
  { value: "dark", label: "深色" },
];

/** The sync row's subtitle: the state, in one sentence. The row is a doorway
 *  (the dialog owns link/unlink/paste/regenerate), so this is all the menu ever
 *  says about sync — no dot, and no count. `now` comes from App's existing slow
 *  clock rather than `Date.now()` here: render must stay pure, and the row is
 *  open for seconds, so a 30s ticker is plenty. */
function syncLabel(status: SyncStatus, now: number): string {
  if (status.failing) return "同步失敗";
  if (!status.linked) return "未連結";
  if (!status.lastSyncedAt) return "已連結";
  return `已連結 · ${relativeTime(status.lastSyncedAt, now)}`;
}

function relativeTime(ts: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - ts) / 60_000));
  if (minutes < 1) return "剛剛";
  if (minutes < 60) return `${minutes} 分鐘前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小時前`;
  return `${Math.floor(hours / 24)} 天前`;
}

/** The app menu: choices and actions, where the header holds state that changes
 *  on its own.
 *
 *  Theme state is NOT here — `App` owns `useTheme` and passes it down, because
 *  this menu unmounts on close and a hook mounted inside it would drop the
 *  `matchMedia` listener that keeps 跟隨系統 live. Same reason the sync engine
 *  is not here: `App` owns `useSyncEngine`, and this row only reads its status
 *  store and opens its dialog.
 *
 *  The changelog drawer is a sibling of the dropdown for the same unmount
 *  reason: selecting 更新記錄 closes the menu, so a drawer rendered inside the
 *  menu content would unmount the moment it opened. */
export function AppMenu({
  mode,
  setMode,
  onSync,
  onExport,
  onImport,
  onReset,
  now,
}: {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  onSync: () => void;
  /** The data actions App already owned in the footer: same handlers, no
   *  format change. `onReset` confirms before it wipes; the menu closes on
   *  select, so the dialog opens onto nothing. */
  onExport: () => void;
  onImport: () => void;
  onReset: () => void;
  /** App's slow clock (`useNow`): the sync row's relative time, and the day the
   *  dot's two-week window is measured against. */
  now: number;
}) {
  // Read on mount: the store is live while the menu is open (a pull can land
  // mid-menu) and correct on the next open, which is what the row needs.
  const status = useSyncStatus();
  // A waiting update: the durable half of the nudge. The toast is gone in
  // seconds and never queues; this row waits for as long as the tab lives.
  const updateReady = useUpdateReady();
  // The changelog row: unread releases from the device marker, plus the drawer
  // it opens. The hook's state outlives the menu because this component does.
  const whatsNew = useWhatsNew();
  // Derived from App's clock rather than captured on mount: the dot decays on a
  // Taipei calendar boundary, so a tab left open across midnight has to let go
  // of it without a reload. `taipeiDate` is pure, so render stays pure.
  const dot = dotFor(whatsNew.summary, taipeiDate(now));
  return (
    <>
      {/* Not modal, like the character switcher: Radix's scroll lock would shift
          the fixed character pill. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="選單" className="relative">
            <Menu className="h-4 w-4" />
            {/* The one pull the trigger carries: 6px of amber, no number (the
                row's sentence counts releases), `aria-hidden` because it says
                nothing the row does not. Absolutely positioned so appearing and
                decaying never move the icon, and ringed so it reads against the
                glyph instead of melting into it. Cleared by opening the drawer,
                which moves the marker. */}
            {dot && (
              <span
                aria-hidden
                className="pointer-events-none absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-amber-500 ring-2 ring-background"
              />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          aria-label="選單"
          className="min-w-[12rem]"
          // The changelog drawer, the sync row and the reset confirm all open a
          // dialog, and Radix returns focus to the trigger as the menu closes —
          // which lands after the dialog mounted and yanks focus back out of it.
          // Keep focus where the dialog puts it.
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          {/* 有新版本 is first and conditional: it disappears the moment it is
              acted on, and it is the one row that only gets staler while it
              waits. Selecting it runs the same accept path as the toast's
              button — the one-shot receipt, then the reload — because the
              worker was already taken over when this row appeared. */}
          {updateReady && (
            <DropdownMenuItem onSelect={acceptUpdate} className="gap-2">
              <span>有新版本</span>
              <span className="ml-auto text-xs text-muted-foreground">重新載入</span>
            </DropdownMenuItem>
          )}
          {/* 更新記錄 is the first permanent row: it is content, not an action,
              and it is the row most visits are for. Its subtitle is the whole
              status — a count of RELEASES (not bullets), or 最新 before this
              device has opened one, or 已讀到最新. The count lives in the
              sentence; the dot that carries the one-time pull is on the
              trigger, not here. */}
          <DropdownMenuItem onSelect={whatsNew.openDrawer} className="gap-2">
            <span>更新記錄</span>
            <span className="ml-auto text-xs text-muted-foreground tabular-nums">
              {whatsNew.summary.label}
            </span>
          </DropdownMenuItem>
          {/* 同步 is a doorway: the dialog owns link/unlink/paste/regenerate, so
              the row carries state and nothing else. */}
          <DropdownMenuItem onSelect={onSync} className="gap-2">
            <span>同步</span>
            <span className="ml-auto text-xs text-muted-foreground tabular-nums">
              {syncLabel(status, now)}
            </span>
          </DropdownMenuItem>
          {/* 外觀 is one row of the menu and three options of that row. Radio
              items rather than buttons in a single item: the menu swallows Tab
              (`event.preventDefault()` in Radix's content), so a nested control
              would be pointer-only, while these stay a `menuitemradio` group —
              arrows move, Enter/Space picks, `aria-checked` states the mode. */}
          <DropdownMenuLabel className="pb-0.5">外觀</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={mode}
            onValueChange={(v) => {
              if (v === "system" || v === "light" || v === "dark") setMode(v);
            }}
            aria-label="外觀"
          >
            {THEME_CHOICES.map((choice) => (
              <DropdownMenuRadioItem
                key={choice.value}
                value={choice.value}
                // Choosing is inline, so the menu stays open: Radix closes on
                // select unless the item's own event is cancelled, and the two
                // clicks of "dark, then back to system" should not need the
                // trigger twice.
                onSelect={(e) => e.preventDefault()}
              >
                {choice.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          {/* Data actions: the same three the footer used to carry, in the same
              order, with reset last and marked destructive. They close the menu
              on select (unlike 外觀 above), which is what the file picker and the
              confirm dialog want. */}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onExport}>匯出 JSON</DropdownMenuItem>
          <DropdownMenuItem onSelect={onImport}>匯入 JSON</DropdownMenuItem>
          <DropdownMenuItem
            onSelect={onReset}
            className="text-destructive focus:bg-destructive/10 focus:text-destructive"
          >
            重置所有資料
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {/* Portalled and controlled, outside the menu content: it must survive the
          click that closes the menu. `view` is the snapshot taken when the row
          was selected, so the list the click asked for is what renders even
          though the marker already moved. */}
      <WhatsNewDrawer
        open={whatsNew.open}
        onOpenChange={whatsNew.onOpenChange}
        view={whatsNew.view}
      />
    </>
  );
}
