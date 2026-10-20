import { useState } from "react";
import { Download, Menu, Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InstallDialog } from "@/components/InstallDialog";
import { WhatsNewDrawer } from "@/components/WhatsNewDrawer";
import { acceptUpdate, useUpdateReady } from "@/lib/updatePrompt";
import { useWhatsNew, dotFor, taipeiDate } from "@/lib/whatsNew";
import { useInstall } from "@/hooks/useInstall";
import { useSyncStatus, type SyncStatus } from "@/sync/status";
import type { ThemeMode } from "@/hooks/useTheme";

const THEME_CHOICES: { value: ThemeMode; label: string; Icon: typeof Sun }[] = [
  { value: "system", label: "跟隨系統", Icon: Monitor },
  { value: "light", label: "淺色", Icon: Sun },
  { value: "dark", label: "深色", Icon: Moon },
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
  const install = useInstall();
  const [installOpen, setInstallOpen] = useState(false);
  const installable = install.status === "prompt" || install.status === "ios" || install.status === "samsung";
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
            <DropdownMenuItem onSelect={acceptUpdate} className="items-baseline gap-2">
              <span>有新版本</span>
              <span className="ml-auto text-xs text-muted-foreground">重新載入</span>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={whatsNew.openDrawer} className="items-baseline gap-2">
            <span>更新記錄</span>
            <span className="ml-auto text-xs text-muted-foreground tabular-nums">
              {whatsNew.summary.label}
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onSync} className="items-baseline gap-2">
            <span>同步</span>
            <span className="ml-auto text-xs text-muted-foreground tabular-nums">
              {syncLabel(status, now)}
            </span>
          </DropdownMenuItem>
          <div className="flex items-center justify-between gap-3 px-2 py-1.5">
            <span className="text-sm leading-none">外觀</span>
            {/* Radio items, not buttons: the menu swallows Tab. Segments stay
                inline; Radix closes on select unless the event is cancelled. */}
            <DropdownMenuRadioGroup
              value={mode}
              onValueChange={(v) => {
                if (v === "system" || v === "light" || v === "dark") setMode(v);
              }}
              aria-label="外觀"
              className="flex items-center gap-0.5 rounded-md bg-muted p-0.5"
            >
              {THEME_CHOICES.map(({ value, label, Icon }) => (
                <DropdownMenuRadioItem
                  key={value}
                  value={value}
                  onSelect={(e) => e.preventDefault()}
                  aria-label={label}
                  title={label}
                  className="grid h-6 w-7 place-items-center rounded-[5px] p-0 text-muted-foreground transition-colors focus:bg-transparent focus:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[highlighted]:bg-transparent data-[highlighted]:text-foreground data-[state=checked]:bg-background data-[state=checked]:text-foreground data-[state=checked]:shadow-sm [&>span]:hidden"
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </div>

          {installable && (
            <DropdownMenuItem
              onSelect={() => {
                if (install.status === "prompt") install.promptInstall();
                else setInstallOpen(true);
              }}
              className="gap-2"
            >
              <Download className="h-4 w-4 text-muted-foreground" />
              安裝 App
            </DropdownMenuItem>
          )}
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
      <InstallDialog open={installOpen} onOpenChange={setInstallOpen} status={install.status} />
      <WhatsNewDrawer
        open={whatsNew.open}
        onOpenChange={whatsNew.onOpenChange}
        view={whatsNew.view}
      />
    </>
  );
}
