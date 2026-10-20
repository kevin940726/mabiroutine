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
 *  store and opens its dialog. */
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
  /** App's slow clock (`useNow`), used only for the sync row's relative time. */
  now: number;
}) {
  // Read on mount: the store is live while the menu is open (a pull can land
  // mid-menu) and correct on the next open, which is what the row needs.
  const status = useSyncStatus();
  return (
    // Not modal, like the character switcher: Radix's scroll lock would shift
    // the fixed character pill.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="選單">
          <Menu className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        aria-label="選單"
        className="min-w-[12rem]"
        // The sync row and the reset confirm both open a dialog, and Radix
        // returns focus to the trigger as the menu closes — which lands after
        // the dialog mounted and yanks focus back out of it. Keep focus where
        // the dialog puts it.
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
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
  );
}
