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

const THEME_CHOICES: { value: ThemeMode; label: string }[] = [
  { value: "system", label: "跟隨系統" },
  { value: "light", label: "淺色" },
  { value: "dark", label: "深色" },
];

function syncLabel(status: SyncStatus, now: number): string {
  if (!status.linked) return "未連結";
  if (status.failing) return "同步失敗";
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
  onExport: () => void;
  onImport: () => void;
  onReset: () => void;
  now: number;
}) {
  const status = useSyncStatus();
  const updateReady = useUpdateReady();
  const whatsNew = useWhatsNew();
  const dot = dotFor(whatsNew.summary, taipeiDate(now));
  return (
    <>
      {/* Not modal, like the character switcher: Radix's scroll lock would shift
          the fixed character pill. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="選單" className="relative">
            <Menu className="h-4 w-4" />
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
          {updateReady && (
            <DropdownMenuItem onSelect={acceptUpdate} className="gap-2">
              <span>有新版本</span>
              <span className="ml-auto text-xs text-muted-foreground">重新載入</span>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={whatsNew.openDrawer} className="gap-2">
            <span>更新記錄</span>
            <span className="ml-auto text-xs text-muted-foreground tabular-nums">
              {whatsNew.summary.label}
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onSync} className="gap-2">
            <span>同步</span>
            <span className="ml-auto text-xs text-muted-foreground tabular-nums">
              {syncLabel(status, now)}
            </span>
          </DropdownMenuItem>
          {/* Radio items rather than buttons in a single item: the menu swallows
              Tab (`event.preventDefault()` in Radix's content), so a nested
              control would be pointer-only. */}
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
                // select unless the item's own event is cancelled.
                onSelect={(e) => e.preventDefault()}
              >
                {choice.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
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
      <WhatsNewDrawer
        open={whatsNew.open}
        onOpenChange={whatsNew.onOpenChange}
        view={whatsNew.view}
      />
    </>
  );
}
