import { useEffect, useState } from "react";
import { useAppStore } from "@/store/useAppStore";
import { BUILTIN_TASKS } from "@/data/builtin";
import { CharacterTabs } from "@/components/CharacterTabs";
import { TrackerSection } from "@/components/TrackerSection";
import { BarterExplorer } from "@/components/BarterExplorer";
import { AddTaskDialog } from "@/components/AddTaskDialog";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useCountdown } from "@/hooks/useCountdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import type { Task } from "@/lib/types";
import { Download, Upload, Plus, Pencil, Check, X, Trash2 } from "lucide-react";

export default function App() {
  const checkResets = useAppStore((s) => s.checkResets);
  const chars = useAppStore((s) => s.characters);
  const active = useAppStore((s) => s.getActiveChar());
  const accountValues = useAppStore((s) => s.accountValues);
  const prefs = useAppStore((s) => s.prefs);
  const hasHydrated = useAppStore((s) => s._hasHydrated);
  const exportJson = useAppStore((s) => s.exportJson);
  const importJson = useAppStore((s) => s.importJson);
  const resetAll = useAppStore((s) => s.resetAll);
  const [tab, setTab] = useState<"tracker" | "barter">("tracker");
  const [addOpen, setAddOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const { dailyText, weeklyText } = useCountdown();
  const [compact, setCompact] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  // periodic reset check
  useEffect(() => {
    if (!hasHydrated) return;
    const id = setInterval(() => checkResets(), 60_000);
    // also on focus
    const onFocus = () => checkResets();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [hasHydrated, checkResets]);

  // compact pill toggles at a simple scroll threshold
  useEffect(() => {
    const onScroll = () => setCompact(window.scrollY > 200);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const handleExport = () => {
    const blob = new Blob([exportJson()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mabiroutine-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const handleImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      const txt = await f.text();
      importJson(txt);
    };
    input.click();
  };

  // overall progress for active char + account
  const overall = (() => {
    if (!active) return { pct: 0, done: 0, total: 0 };
    const all = [...BUILTIN_TASKS];
    // include custom + barter pins? simplified: use builtin total for header
    let done = 0;
    for (const t of all) {
      const isAccount = t.section === "account";
      const v = isAccount ? accountValues[t.id] : active.taskValues[t.id];
      if (t.type === "check") {
        if (v) done++;
      } else {
        const n = typeof v === "number" ? v : 0;
        if (n >= (t.max ?? 1)) done++;
      }
    }
    const total = all.length;
    return { pct: total ? Math.round((done / total) * 100) : 0, done, total };
  })();

  const dailyTasks = BUILTIN_TASKS.filter((t) => t.section === "daily");
  const weeklyTasks = BUILTIN_TASKS.filter((t) => t.section === "weekly");
  const accountTasks = BUILTIN_TASKS.filter((t) => t.section === "account");
  const customTasks = useAppStore((s) => s.customTasks);
  const dailyWithCustom = [...dailyTasks, ...customTasks.filter((t) => t.section === "daily")];
  const weeklyWithCustom = [...weeklyTasks, ...customTasks.filter((t) => t.section === "weekly")];
  const accountWithCustom = [...accountTasks, ...customTasks.filter((t) => t.section === "account")];

  const openEdit = (t: Task) => {
    setEditingTask(t);
    setAddOpen(true);
  };
  const openAdd = () => {
    setEditingTask(null);
    setAddOpen(true);
  };

  if (!hasHydrated) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">載入中...</div>;
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
        <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto max-w-3xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-primary text-primary-foreground grid place-items-center font-bold text-sm">M</div>
            <div>
              <h1 className="text-base font-semibold leading-none">MabiRoutine</h1>
              <p className="text-xs text-muted-foreground">瑪奇 Mobile 日課追蹤 · 06:00 重置 (Asia/Taipei)</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-3 text-xs font-mono border rounded-full px-3 py-1.5 bg-card">
              <span>每日重置 <b>{dailyText}</b></span>
              <Separator orientation="vertical" className="h-4" />
              <span>每週重置 <b>{weeklyText}</b></span>
            </div>
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* nav bar — plain in-flow, scrolls away naturally, no sticky needed */}
      <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto max-w-3xl px-4 py-2.5">
          {/* row 1: progress + hide */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{overall.pct}%</span>
              <div className="h-2 w-28 rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-primary transition-all" style={{ width: `${overall.pct}%` }} />
              </div>
              <span className="text-xs text-muted-foreground">
                {active?.name} {overall.done}/{overall.total}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Label htmlFor="hideDone" className="text-xs whitespace-nowrap">
                隱藏已完成
              </Label>
              <Switch
                checked={prefs.hideCompleted}
                onCheckedChange={(v) => useAppStore.setState((s) => ({ prefs: { ...s.prefs, hideCompleted: v } }))}
              />
            </div>
          </div>
          {/* row 2: character tabs — full width */}
          <div className="mt-2">
            <CharacterTabs />
          </div>
        </div>
      </div>

      {/* compact pill — fixed overlay below header (76px) + margin, fades in sliding down */}
      <div
        className={`fixed left-1/2 -translate-x-1/2 z-30 transition-all duration-300 ${compact ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2 pointer-events-none"}`}
        style={{ top: 88 }}
      >
        <div className="flex items-center gap-2 rounded-full border bg-card shadow-md px-3.5 py-1.5 w-max max-w-[calc(100vw-2rem)] flex-wrap justify-center text-xs">
          <span className="font-bold shrink-0 text-xs">{overall.pct}%</span>
          <div className="h-1.5 w-14 shrink-0 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${overall.pct}%` }} />
          </div>
          <div className="h-4 w-px bg-border shrink-0" />
          {renamingId === active?.id ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (active) useAppStore.getState().renameCharacter(active.id, renameDraft);
                setRenamingId(null);
              }}
              className="flex items-center gap-1"
            >
              <Input autoFocus value={renameDraft} onChange={(e) => setRenameDraft(e.target.value)} className="h-7 w-24 rounded-full text-xs px-2.5" placeholder="名稱" />
              <button type="submit" className="h-7 w-7 shrink-0 grid place-items-center rounded-full bg-primary text-primary-foreground" aria-label="save rename">
                <Check className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={() => setRenamingId(null)} className="h-7 w-7 shrink-0 grid place-items-center rounded-full border hover:bg-accent" aria-label="cancel rename">
                <X className="h-3.5 w-3.5" />
              </button>
            </form>
          ) : (
            <>
              <Select
                value={active?.id ?? ""}
                onValueChange={(v) => useAppStore.getState().setActiveChar(v)}
              >
                <SelectTrigger className="h-7 w-auto min-w-[120px] rounded-full text-xs px-2.5">
                  <SelectValue placeholder="選擇角色" />
                </SelectTrigger>
                <SelectContent>
                  {chars.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 rounded-full"
                onClick={() => {
                  if (!active) return;
                  setRenamingId(active.id);
                  setRenameDraft(active.name);
                }}
                aria-label="rename character"
              >
                <Pencil className="h-3 w-3" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 rounded-full"
                onClick={() => useAppStore.getState().addCharacter()}
                disabled={chars.length >= 6}
                aria-label="add character"
              >
                <Plus className="h-3 w-3" />
              </Button>
            </>
          )}
          <div className="h-4 w-px bg-border shrink-0" />
          <label className="flex items-center gap-1.5 text-xs shrink-0">
            <span>隱藏已完成</span>
            <Switch
              checked={prefs.hideCompleted}
              onCheckedChange={(v) => useAppStore.setState((s) => ({ prefs: { ...s.prefs, hideCompleted: v } }))}
            />
          </label>
        </div>
      </div>

      <main className="mx-auto max-w-3xl px-4 py-6 space-y-6">

        {/* tabs */}
        <div className="flex items-center gap-2 border-b">
          <button onClick={() => setTab("tracker")} className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === "tracker" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            任務追蹤
          </button>
          <button onClick={() => setTab("barter")} className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === "barter" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            以物易物
          </button>
          <div className="ml-auto flex items-center gap-1 pb-1">
            <Button size="sm" onClick={openAdd}>
              <Plus className="h-4 w-4" />
              新增自訂
            </Button>
          </div>
        </div>

        {tab === "tracker" ? (
          <div className="grid gap-6 grid-cols-1">
            <TrackerSection title="每日任務" icon="☀️" tasks={dailyWithCustom} isAccount={false} onEditTask={openEdit} />
            <TrackerSection title="每週任務" icon="🗓️" tasks={weeklyWithCustom} isAccount={false} onEditTask={openEdit} />
            <TrackerSection title="帳號共通" icon="👥" tasks={accountWithCustom} isAccount={true} onEditTask={openEdit} />
          </div>
        ) : (
          <BarterExplorer />
        )}

        {/* footer actions */}
        <Separator />
        <div className="flex flex-wrap gap-2 items-center justify-between">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="h-4 w-4" />
              匯出 JSON
            </Button>
            <Button variant="outline" size="sm" onClick={handleImport}>
              <Upload className="h-4 w-4" />
              匯入 JSON
            </Button>
            <Button variant="ghost" size="sm" onClick={resetAll} className="text-destructive hover:text-destructive">
              <Trash2 className="h-4 w-4" />
              重置所有資料
            </Button>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>角色數 {chars.length} · 靈感來自 nipponhashi.com/tracker</span>
            <a href="https://github.com" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">
              專案
            </a>
          </div>
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed">
          ℹ️ 重置時間 06:00 已依台服官方公告驗證。資料為本地儲存，無後端。<br />
          釘選：<span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-600 inline-block" /> 共用綠</span> = 點擊釘選至所有角色（最多6隻）；
          <span className="inline-flex items-center gap-1 ml-2"><span className="h-2 w-2 rounded-full bg-sky-600 inline-block" /> 個人藍</span> = 長按/右鍵僅此角色，長按550ms自動切換為個人模式。懸停看提示，桌面右鍵與手機長按等價。
          <span className="ml-2">個人模式下可在以物易物頁按「合併回共用」還原。</span>
        </p>
      </main>

      <AddTaskDialog open={addOpen} onOpenChange={(v) => { setAddOpen(v); if (!v) setEditingTask(null); }} editing={editingTask} />
    </div>
  );
}
