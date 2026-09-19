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

// Experimental feature toggles, registry-driven. The dialog (and its footer
// button) render nothing while the registry is empty — the shell, row, and
// batch-apply-on-close pattern survive for the next flag. Toggling applies
// on close with one reload: flags are read-once gates everywhere, so
// batching + a single reload is the honest apply.

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

/**
 * Registry of experimental toggles. EMPTY right now — push + purple-hole
 * graduated, so the dialog (and its footer button) render nothing. The next
 * experiment registers here ({id, title, desc, read, write} plus whatever
 * teardown its flag-off needs) and the whole UI reappears on its own, with
 * batch-apply + single reload on close preserved.
 */
type ExpToggle = {
  id: string;
  title: string;
  desc: string;
  read: () => boolean;
  write: (on: boolean) => void;
};

const EXPERIMENTAL_TOGGLES: ExpToggle[] = [];

export function ExpSettingsDialog() {
  const [open, setOpen] = useState(false);
  const [vals, setVals] = useState<Record<string, boolean>>({});
  // Toggles apply to storage immediately but reload only once on close, and
  // only on a net change — flipping on-then-off in one visit reloads nothing.
  const [initial, setInitial] = useState<Record<string, boolean>>({});
  const refresh = () => {
    const v: Record<string, boolean> = {};
    for (const t of EXPERIMENTAL_TOGGLES) v[t.id] = t.read();
    setVals(v);
    setInitial(v);
  };
  const flip = (id: string) => {
    const t = EXPERIMENTAL_TOGGLES.find((x) => x.id === id);
    if (!t) return;
    const next = !vals[id];
    t.write(next);
    setVals({ ...vals, [id]: next });
  };
  // No experiments: no button, no dialog. The component stays mounted (and
  // this file stays the pattern) for the next flag.
  if (EXPERIMENTAL_TOGGLES.length === 0) return null;
  const dirty = EXPERIMENTAL_TOGGLES.some((t) => vals[t.id] !== initial[t.id]);
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) refresh();
        else if (dirty) window.location.reload();
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
            測試中的功能，可能不穩定或隨時移除。只影響這台裝置，不會同步。關閉後如有變更會重新載入一次套用。
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
