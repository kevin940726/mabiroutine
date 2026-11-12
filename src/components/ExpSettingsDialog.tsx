import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { linkEnabled, setLinkEnabled } from "@/lib/link/flag";
import { startLinkFeed, stopLinkFeed } from "@/link/feed";

function ExpRow({
  on,
  title,
  desc,
  descId,
  onToggle,
}: {
  on: boolean;
  title: string;
  desc: string;
  descId: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-describedby={descId}
      onClick={onToggle}
      className="flex w-full items-center gap-3 rounded-xl border bg-card px-3 py-2.5 text-left transition-colors hover:border-primary"
    >
      <span
        aria-hidden="true"
        className={cn(
          "grid h-6 w-6 shrink-0 place-items-center rounded-md border transition-colors",
          on ? "border-emerald-600 bg-emerald-600 text-white" : "bg-card"
        )}
      >
        <span className="text-sm leading-none">{on ? "✓" : ""}</span>
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        <span id={descId} className="block text-xs text-muted-foreground">
          {desc}
        </span>
      </span>
    </button>
  );
}

type ExpToggle = {
  id: string;
  title: string;
  desc: string;
  read: () => boolean;
  write: (on: boolean) => boolean;
};

const EXPERIMENTAL_TOGGLES: ExpToggle[] = [
  {
    id: "link",
    title: "即時連結（MabiRoutine Link）",
    desc: "從遊戲電腦上的 MabiRoutine Link 讀取日課與副本進度，開啟後自動連上。需要先在遊戲電腦安裝並執行 Link；只影響這台裝置。",
    read: linkEnabled,
    write: (on) => {
      if (!setLinkEnabled(on)) return false;
      if (on) startLinkFeed();
      else stopLinkFeed();
      return true;
    },
  },
];

export function ExpSettingsDialog() {
  const [open, setOpen] = useState(false);
  const [vals, setVals] = useState<Record<string, boolean>>({});
  const refresh = () => {
    const v: Record<string, boolean> = {};
    for (const t of EXPERIMENTAL_TOGGLES) v[t.id] = t.read();
    setVals(v);
  };
  const flip = (id: string) => {
    const t = EXPERIMENTAL_TOGGLES.find((x) => x.id === id);
    if (!t) return;
    const next = !vals[id];
    if (t.write(next)) setVals({ ...vals, [id]: next });
  };
  if (EXPERIMENTAL_TOGGLES.length === 0) return null;
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) refresh();
      }}
    >
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground"
        onClick={() => {
          refresh();
          setOpen(true);
        }}
      >
        實驗性功能
      </Button>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>實驗性功能</DialogTitle>
          <DialogDescription>
            測試中的功能，可能不穩定或隨時移除。只影響這台裝置，不會同步，開啟後立即生效。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          {EXPERIMENTAL_TOGGLES.map((t) => (
            <ExpRow
              key={t.id}
              on={vals[t.id] ?? false}
              title={t.title}
              desc={t.desc}
              descId={`exp-row-${t.id}-desc`}
              onToggle={() => flip(t.id)}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
