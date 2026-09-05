import { useEffect, useState } from "react";
import { useAppStore, barterToTask } from "@/store/useAppStore";
import trackerJson from "@/data/tracker.json";
import barterJson from "@/data/barter.json";
import { summarizeProgress } from "@/lib/progress";
import { CharacterTabs } from "@/components/CharacterTabs";
import { TrackerSection } from "@/components/TrackerSection";
import { BarterExplorer } from "@/components/BarterExplorer";
import { AddTaskDialog } from "@/components/AddTaskDialog";
import { HeaderCountdown } from "@/components/HeaderCountdown";
import { SyncButton, SyncToasts } from "@/sync/SyncButton";
import { InstallButton } from "@/components/InstallButton";
import { ConfirmHost, confirmRemoveCharacter } from "@/components/ConfirmDialog";
import { PillProgress } from "@/components/PillProgress";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem } from "@/components/ui/dropdown-menu";
import { SyncImport } from "@/sync/SyncImport";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { Task } from "@/lib/types";
import { Download, Upload, Plus, Pencil, Check, X, Trash2, ChevronDown, MoreHorizontal } from "lucide-react";
import { Analytics } from "@vercel/analytics/react";

const BUILTIN_TASKS = trackerJson as Task[];

export default function App() {
  const checkResets = useAppStore((s) => s.checkResets);
  const chars = useAppStore((s) => s.characters);
  const active = useAppStore((s) => s.getActiveChar());
  const accountValues = useAppStore((s) => s.accountValues);
  const hiddenAccountTaskIds = useAppStore((s) => s.hiddenAccountTaskIds);
  const prefs = useAppStore((s) => s.prefs);
  const hasHydrated = useAppStore((s) => s._hasHydrated);
  const exportJson = useAppStore((s) => s.exportJson);
  const importJson = useAppStore((s) => s.importJson);
  const resetAll = useAppStore((s) => s.resetAll);
  const customTasks = useAppStore((s) => s.customTasks);
  const barterPins = useAppStore((s) => s.barterPins);
  const [tab, setTab] = useState<"tracker" | "barter">("tracker");
  const [addOpen, setAddOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [compact, setCompact] = useState(false);
  const [pillMenuOpen, setPillMenuOpen] = useState(false);
  const [pillRenaming, setPillRenaming] = useState(false);
  const [pillDraft, setPillDraft] = useState("");
  // desktop pill still uses its own rename state
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const isMobile = useIsMobile();

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

  // Build stamp: after an SW auto-update takeover (or plain redeploy) the page
  // reloads into a new build — announce it once. Child SyncToasts subscribes
  // before this parent effect runs, so the toast lands.
  useEffect(() => {
    try {
      const prev = localStorage.getItem("mabiroutine:build");
      if (prev && prev !== __BUILD_TIME__) {
        window.dispatchEvent(new CustomEvent("mabiroutine:toast", { detail: "已更新到新版本" }));
      }
      localStorage.setItem("mabiroutine:build", __BUILD_TIME__);
    } catch {
      // private mode — skip
    }
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

  // overall progress for active char + account (hidden tasks excluded):
  // builtins + custom + pinned barter, same ruler as the section badges.
  const overall = (() => {
    if (!active) return { pct: 0, done: 0, total: 0 };
    const hidden = new Set([...active.hiddenTaskIds, ...hiddenAccountTaskIds]);
    const pinnedBarter = barterPins
      .map((id) => {
        const b = (barterJson as unknown as Array<Parameters<typeof barterToTask>[0]>).find((x) => x.id === id);
        return b ? barterToTask(b) : null;
      })
      .filter((t): t is Task => !!t && !hidden.has(t.id));
    const all = [...BUILTIN_TASKS, ...customTasks, ...pinnedBarter].filter((t) => !hidden.has(t.id));
    const { done, total, percent } = summarizeProgress(all, (t) =>
      t.section === "account" ? accountValues[t.id] : active.taskValues[t.id]
    );
    return { pct: percent, done, total };
  })();

  const dailyTasks = BUILTIN_TASKS.filter((t) => t.section === "daily");
  const weeklyTasks = BUILTIN_TASKS.filter((t) => t.section === "weekly");
  const accountTasks = BUILTIN_TASKS.filter((t) => t.section === "account");
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
        <div className="mx-auto max-w-3xl px-3 sm:px-4 py-[10px] sm:py-3 flex items-center justify-between gap-2 sm:gap-3">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <img src="/logo-96.png" alt="MabiRoutine" className="h-7 w-7 sm:h-8 sm:w-8 object-contain shrink-0" />
            <div className="min-w-0">
              <h1 className="text-sm sm:text-base font-semibold leading-none truncate">MabiRoutine</h1>
              {isMobile ? null : (
                <p className="text-xs text-muted-foreground">瑪奇 Mobile 日課追蹤 · 06:00 重置</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <HeaderCountdown />
            <SyncButton />
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

      {isMobile ? (
      <>
      {/* compact pill — single line: progress + ‹ char › stepper + add + ⋯ menu */}
      <div
        className={`fixed left-1/2 -translate-x-1/2 z-30 transition-all duration-300 ${compact ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2 pointer-events-none"}`}
        style={{ top: 70 }}
      >
        <div className="flex items-center gap-2 rounded-full border bg-card shadow-md px-3.5 py-1.5 whitespace-nowrap max-w-[calc(100vw-2rem)] text-xs relative isolate overflow-hidden">
          <PillProgress pct={overall.pct} />
          <div className="h-4 w-px bg-border shrink-0" />
          {pillRenaming ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (active && pillDraft.trim()) useAppStore.getState().renameCharacter(active.id, pillDraft.trim());
                setPillRenaming(false);
              }}
              className="flex items-center gap-1"
            >
              <input
                autoFocus
                value={pillDraft}
                onChange={(e) => setPillDraft(e.target.value)}
                onFocus={(e) => e.target.select()}
                className="h-7 w-24 rounded-full text-xs px-2.5 bg-background border border-input"
                placeholder="名稱"
              />
              <button type="submit" className="h-7 w-7 shrink-0 grid place-items-center rounded-full bg-primary text-primary-foreground" aria-label="save rename">
                <Check className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={() => setPillRenaming(false)} className="h-7 w-7 shrink-0 grid place-items-center rounded-full hover:bg-accent" aria-label="cancel rename">
                <X className="h-3.5 w-3.5" />
              </button>
            </form>
          ) : (
            <>
              <span className="flex items-center shrink-0">
                {/* roster jump: name opens the non-modal radio list */}
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="flex max-w-[40vw] items-center gap-1 truncate rounded-full px-1 py-1 text-xs font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label="switch character"
                    >
                      <span className="truncate">{active?.name}</span>
                      <ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="center" className="min-w-[8rem]">
                    <DropdownMenuRadioGroup
                      value={active?.id ?? ""}
                      onValueChange={(v) => useAppStore.getState().setActiveChar(v)}
                    >
                      {chars.map((c) => (
                        <DropdownMenuRadioItem key={c.id} value={c.id} className="text-xs">
                          {c.name}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </span>
              <button
                type="button"
                className="h-7 w-7 shrink-0 grid place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
                onClick={() => useAppStore.getState().addCharacter()}
                disabled={chars.length >= 6}
                aria-label="add character"
              >
                <Plus className="h-4 w-4" />
              </button>
              <span className="relative shrink-0">
                <button
                  onClick={() => setPillMenuOpen((v) => !v)}
                  className="h-7 w-7 grid place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label="character actions"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
                {pillMenuOpen && (
                  <span className="absolute right-0 top-8 z-10 block w-32 rounded-md border bg-popover p-1 shadow-md">
                    <button
                      onClick={() => {
                        setPillMenuOpen(false);
                        if (active) setPillDraft(active.name);
                        setPillRenaming(true);
                      }}
                      className="flex h-9 w-full items-center gap-2 rounded px-2 text-xs hover:bg-accent"
                    >
                      重新命名
                    </button>
                      <button
                        onClick={() => {
                          setPillMenuOpen(false);
                          if (!active || chars.length <= 1) return;
                          void confirmRemoveCharacter(active.name).then((ok) => {
                            if (ok) useAppStore.getState().removeCharacter(active.id);
                          });
                        }}
                        disabled={chars.length <= 1}
                      className="flex h-9 w-full items-center gap-2 rounded px-2 text-xs hover:bg-accent disabled:opacity-30 disabled:pointer-events-none"
                    >
                      刪除角色
                    </button>
                  </span>
                )}
              </span>
            </>
          )}
        </div>
      </div>
      </>
      ) : (
      <>
      {/* desktop pill */}
      <div
        className={`fixed left-1/2 -translate-x-1/2 z-30 transition-all duration-300 ${compact ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2 pointer-events-none"}`}
        style={{ top: 88 }}
      >
        <div className="flex items-center gap-2 rounded-full border bg-card shadow-md px-3.5 py-1.5 w-max max-w-[calc(100vw-2rem)] flex-wrap justify-center text-xs relative isolate overflow-hidden">
          <PillProgress pct={overall.pct} />
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
              {/* character switcher: DropdownMenu (non-modal) instead of Select —
                  Radix Select always scroll-locks (scrollbar vanishes + body
                  padding shifts the fixed pill); this never touches the page. */}
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <button className="flex h-7 w-auto min-w-[120px] items-center justify-between gap-1 rounded-full border border-input bg-transparent px-2.5 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <span className="truncate">{active?.name ?? "選擇角色"}</span>
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="center">
                  <DropdownMenuRadioGroup
                    value={active?.id ?? ""}
                    onValueChange={(v) => useAppStore.getState().setActiveChar(v)}
                  >
                    {chars.map((c) => (
                      <DropdownMenuRadioItem key={c.id} value={c.id} className="text-xs">
                        {c.name}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
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
                className="h-7 w-7 shrink-0 rounded-full hover:text-destructive disabled:opacity-30 disabled:pointer-events-none"
                onClick={() => {
                  if (!active || chars.length <= 1) return;
                  void confirmRemoveCharacter(active.name).then((ok) => {
                    if (ok) useAppStore.getState().removeCharacter(active.id);
                  });
                }}
                disabled={chars.length <= 1}
                aria-label="remove character"
              >
                <Trash2 className="h-3 w-3" />
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
      </>
      )}

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
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="h-4 w-4" />
              匯出 JSON
            </Button>
            <Button variant="outline" size="sm" onClick={handleImport}>
              <Upload className="h-4 w-4" />
              匯入 JSON
            </Button>
            <InstallButton />
            {confirmingReset ? (
              <span className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 px-2.5 py-1.5">
                <span className="text-xs font-medium text-destructive">確定清除全部資料？無法復原。</span>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    resetAll();
                    setConfirmingReset(false);
                  }}
                >
                  確認清除
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmingReset(false)}>
                  取消
                </Button>
              </span>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setConfirmingReset(true)} className="text-destructive hover:text-destructive">
                <Trash2 className="h-4 w-4" />
                重置所有資料
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <a
              href="https://github.com/kevin940726/mabiroutine"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 underline underline-offset-2"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5" aria-hidden="true">
                <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
              </svg>
              GitHub
            </a>
            <span>角色數 {chars.length}</span>
          </div>
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed">
          ℹ️ 重置時間 06:00 已依台服官方公告驗證。資料為本地儲存，亦可選用跨裝置同步。<br />
          釘選：<span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-600 inline-block" /> 已釘選</span> = 點擊切換，所有角色共用（以物易物頁）。
        </p>

        <p className="text-xs text-muted-foreground leading-relaxed">
          資料來源：
          <a className="underline underline-offset-2" href="https://mabinogimobile.nipponhashi.com/tracker/" target="_blank" rel="noreferrer">瑪奇Mobile Wiki DB</a>
          （追蹤器；
          <a className="underline underline-offset-2" href="https://mabinogimobile.nipponhashi.com/barter/" target="_blank" rel="noreferrer">以物易物</a>
          僅對照）・
          <a className="underline underline-offset-2" href="https://mabinogi-mobile-notebook.vercel.app/" target="_blank" rel="noreferrer">Meowka 以物易物記事本</a>・
          <a className="underline underline-offset-2" href="https://mabi.yenyen.dev/" target="_blank" rel="noreferrer">yenyen 繁中資料庫</a>・
          <a className="underline underline-offset-2" href="https://mabitw.com/daily" target="_blank" rel="noreferrer">mabitw</a>・
          <a className="underline underline-offset-2" href="https://bobogameguides.com/mabinogi-mobile/checklist/daily/" target="_blank" rel="noreferrer">bobogameguides</a>
          <br />
          本站為非官方粉絲工具，與 NEXON / devCAT 無關；遊戲名稱、NPC、道具等權利歸原權利人所有（NPC 頭像自截自遊戲畫面），數值以遊戲內為準。權利疑慮請開{" "}
          <a className="underline underline-offset-2" href="https://github.com/kevin940726/mabiroutine/issues" target="_blank" rel="noreferrer">GitHub issue</a>，會下架相關內容。
        </p>
      </main>

      <AddTaskDialog
        key={`${addOpen}-${editingTask?.id ?? "new"}`}
        open={addOpen}
        onOpenChange={(v) => { setAddOpen(v); if (!v) setEditingTask(null); }}
        editing={editingTask}
      />
      <SyncToasts />
      <SyncImport />
      <ConfirmHost />
      <Analytics />
    </div>
  );
}
