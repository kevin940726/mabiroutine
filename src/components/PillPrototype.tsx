// PROTOTYPE — PillPrototype ?variant=m1|m2|m3 (DEV-only takeover in App).
// Next loop: single-line compact pill + mobile countdown + ONE character switcher.
// Current prod problems: pill wraps to 2 lines, duplicates char select + hide
// toggle, fixed top:88 misaligns with wrapped mobile header, countdown hidden
// on mobile entirely.
import { useState } from "react";
import { useAppStore } from "@/store/useAppStore";
import { useCountdown } from "@/hooks/useCountdown";
import trackerJson from "@/data/tracker.json";
import type { Task } from "@/lib/types";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Plus, Pencil, Trash2, Check, X, MoreHorizontal } from "lucide-react";

export type PillVariant = "m1" | "m2" | "m3" | "n1" | "n2" | "n3";

const BUILTIN = trackerJson as Task[];

function useOverall() {
  const active = useAppStore((s) => s.getActiveChar());
  const accountValues = useAppStore((s) => s.accountValues);
  if (!active) return { pct: 0 };
  const hidden = new Set(active.hiddenTaskIds);
  const all = BUILTIN.filter((t) => !hidden.has(t.id));
  let done = 0;
  for (const t of all) {
    const v = t.section === "account" ? accountValues[t.id] : active.taskValues[t.id];
    if (t.type === "check") {
      if (v) done++;
    } else if (typeof v === "number" && v >= (t.max ?? 1)) done++;
  }
  return { pct: all.length ? Math.round((done / all.length) * 100) : 0 };
}

function Pct({ pct }: { pct: number }) {
  return (
    <>
      <span className="font-bold shrink-0 text-xs">{pct}%</span>
      <span className="h-1.5 w-14 shrink-0 rounded-full bg-muted overflow-hidden">
        <span className="block h-full bg-primary" style={{ width: `${pct}%` }} />
      </span>
    </>
  );
}

function CharSelect() {
  const chars = useAppStore((s) => s.characters);
  const active = useAppStore((s) => s.getActiveChar());
  const setActiveChar = useAppStore((s) => s.setActiveChar);
  return (
    <Select value={active?.id ?? ""} onValueChange={setActiveChar}>
      <SelectTrigger className="h-7 min-w-0 max-w-[104px] rounded-full text-xs px-2">
        <SelectValue placeholder="選擇角色" />
      </SelectTrigger>
      <SelectContent>
        {chars.map((c) => (
          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function CharStepper() {
  const chars = useAppStore((s) => s.characters);
  const active = useAppStore((s) => s.getActiveChar());
  const setActiveChar = useAppStore((s) => s.setActiveChar);
  const idx = Math.max(0, chars.findIndex((c) => c.id === active?.id));
  const step = (d: number) => {
    if (!chars.length) return;
    setActiveChar(chars[(idx + d + chars.length) % chars.length].id);
  };
  return (
    <span className="flex items-center shrink-0">
      <button onClick={() => step(-1)} className="h-7 w-6 grid place-items-center rounded-full hover:bg-accent" aria-label="prev character">
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="max-w-[72px] truncate text-xs font-medium">{active?.name}</span>
      <button onClick={() => step(1)} className="h-7 w-6 grid place-items-center rounded-full hover:bg-accent" aria-label="next character">
        <ChevronRight className="h-4 w-4" />
      </button>
    </span>
  );
}

function CountdownInline() {
  const { dailyText } = useCountdown();
  return (
    <span className="text-[11px] tabular-nums text-muted-foreground whitespace-nowrap shrink-0">
      重置 <b className="text-foreground font-semibold">{dailyText}</b>
    </span>
  );
}

function CountdownStrip() {
  const { dailyText, weeklyText } = useCountdown();
  return (
    <div className="border-b bg-background/95">
      <div className="mx-auto max-w-3xl px-4 py-1.5 flex items-center justify-center gap-2 text-[11px] tabular-nums text-muted-foreground">
        <span>每日重置 <b className="text-foreground font-semibold">{dailyText}</b></span>
        <span className="h-3 w-px bg-border" />
        <span>每週重置 <b className="text-foreground font-semibold">{weeklyText}</b></span>
      </div>
    </div>
  );
}

function HeaderCountdown() {
  const { dailyText, weeklyText } = useCountdown();
  return (
    <span className="text-[11px] tabular-nums leading-tight text-muted-foreground text-right shrink-0">
      每日重置 <b className="text-foreground font-semibold">{dailyText}</b>
      <br />
      每週重置 <b className="text-foreground font-semibold">{weeklyText}</b>
    </span>
  );
}

const BLURB: Record<PillVariant, string> = {
  m1: "M1 — 最小 pill（進度＋角色名，無控制）＋ header 下倒數 strip。切角需滑回頂部。",
  m2: "M2 — All-in-one 單行 pill：進度＋角色 select＋每日倒數。無 strip。",
  m3: "M3 — Stepper pill（‹ 角色 ›，免下拉）＋倒數放 header 右上。無 strip、無 select。",
  n1: "N1 — M3 ＋ ＋/✎/🗑 全部攤開（ghost icon）。",
  n2: "N2 — M3 ＋ 單一 ⋯ 選單（新增／重新命名／刪除）。",
  n3: "N3 — M3 ＋ ＋攤開＋ ⋯ 選單（重新命名／刪除）。",
};

function GhostBtn({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick?: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="h-7 w-7 shrink-0 grid place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
    >
      {children}
    </button>
  );
}

function RenameForm({ onDone }: { onDone: () => void }) {
  const active = useAppStore((s) => s.getActiveChar());
  const renameCharacter = useAppStore((s) => s.renameCharacter);
  const [draft, setDraft] = useState(active?.name ?? "");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (active && draft.trim()) renameCharacter(active.id, draft.trim());
        onDone();
      }}
      className="flex items-center gap-1"
    >
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.target.select()}
        className="h-7 w-24 rounded-full text-xs px-2.5 bg-background border border-input"
        placeholder="名稱"
      />
      <button type="submit" className="h-7 w-7 shrink-0 grid place-items-center rounded-full bg-primary text-primary-foreground" aria-label="save">
        <Check className="h-3.5 w-3.5" />
      </button>
      <button type="button" onClick={onDone} className="h-7 w-7 shrink-0 grid place-items-center rounded-full hover:bg-accent" aria-label="cancel">
        <X className="h-3.5 w-3.5" />
      </button>
    </form>
  );
}

function CharMgmt({ layout }: { layout: "n1" | "n2" | "n3" }) {
  const chars = useAppStore((s) => s.characters);
  const active = useAppStore((s) => s.getActiveChar());
  const addCharacter = useAppStore((s) => s.addCharacter);
  const removeCharacter = useAppStore((s) => s.removeCharacter);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const canDelete = chars.length > 1;
  const canAdd = chars.length < 6;
  const del = () => {
    if (active && canDelete) removeCharacter(active.id);
    setMenuOpen(false);
  };
  const menu = (items: React.ReactNode) => (
    <span className="relative shrink-0">
      <GhostBtn label="character actions" onClick={() => setMenuOpen((v) => !v)}>
        <MoreHorizontal className="h-4 w-4" />
      </GhostBtn>
      {menuOpen && (
        <span className="absolute right-0 top-8 z-10 block w-32 rounded-md border bg-popover p-1 shadow-md">{items}</span>
      )}
    </span>
  );
  const menuItem = (label: string, icon: React.ReactNode, fn: () => void, disabled?: boolean) => (
    <button
      key={label}
      onClick={fn}
      disabled={disabled}
      className="flex h-9 w-full items-center gap-2 rounded px-2 text-xs hover:bg-accent disabled:opacity-30 disabled:pointer-events-none"
    >
      {icon}{label}
    </button>
  );
  if (renaming) return <RenameForm onDone={() => setRenaming(false)} />;
  if (layout === "n1") {
    return (
      <>
        <GhostBtn label="add character" disabled={!canAdd} onClick={() => addCharacter()}>
          <Plus className="h-4 w-4" />
        </GhostBtn>
        <GhostBtn label="rename character" onClick={() => setRenaming(true)}>
          <Pencil className="h-3.5 w-3.5" />
        </GhostBtn>
        <GhostBtn label="delete character" disabled={!canDelete} onClick={del}>
          <Trash2 className="h-3.5 w-3.5" />
        </GhostBtn>
      </>
    );
  }
  if (layout === "n2") {
    return menu(
      <>
        {menuItem("新增角色", <Plus className="h-3.5 w-3.5" />, () => { if (canAdd) addCharacter(); setMenuOpen(false); }, !canAdd)}
        {menuItem("重新命名", <Pencil className="h-3.5 w-3.5" />, () => { setMenuOpen(false); setRenaming(true); })}
        {menuItem("刪除角色", <Trash2 className="h-3.5 w-3.5" />, del, !canDelete)}
      </>
    );
  }
  return (
    <>
      <GhostBtn label="add character" disabled={!canAdd} onClick={() => addCharacter()}>
        <Plus className="h-4 w-4" />
      </GhostBtn>
      {menu(
        <>
          {menuItem("重新命名", <Pencil className="h-3.5 w-3.5" />, () => { setMenuOpen(false); setRenaming(true); })}
          {menuItem("刪除角色", <Trash2 className="h-3.5 w-3.5" />, del, !canDelete)}
        </>
      )}
    </>
  );
}

export function PillPrototype({ variant }: { variant: PillVariant }) {
  const { pct } = useOverall();
  const active = useAppStore((s) => s.getActiveChar());
  return (
    <div className="min-h-screen bg-background">
      {/* mock sticky header (h-12) */}
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto max-w-3xl px-4 py-2 flex items-center gap-2">
          <img src="/logo-96.png" alt="MabiRoutine" className="h-8 w-8 object-contain" />
          <h1 className="text-base font-semibold leading-none">MabiRoutine</h1>
          <div className="ml-auto flex items-center gap-2">
            {variant === "m3" && <HeaderCountdown />}
            <span className="grid h-9 w-9 place-items-center rounded-md border" aria-hidden>🌙</span>
          </div>
        </div>
      </header>
      {variant === "m1" && <CountdownStrip />}
      <div className="mx-auto max-w-3xl px-4 py-4">
        <h2 className="text-base font-semibold">Pill prototype — variant {variant.toUpperCase()}</h2>
        <p className="text-xs text-muted-foreground mt-1">{BLURB[variant]}</p>
        <p className="text-xs text-muted-foreground mt-1">（pill 固定顯示方便判斷；正式版維持滑動 &gt;200px 才出現。隱藏已完成開關保留在 nav row，不再重複。）</p>
        {/* filler to allow scroll */}
        <div className="mt-4 space-y-2">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-24 rounded-lg border bg-card" />
          ))}
        </div>
      </div>
      {/* fixed pill, always visible for judgment */}
      <div className="fixed left-1/2 -translate-x-1/2 z-30" style={{ top: 56 }}>
        <div className="flex items-center gap-2 rounded-full border bg-card shadow-md px-3.5 py-1.5 whitespace-nowrap max-w-[calc(100vw-2rem)]">
          <Pct pct={pct} />
          <span className="h-4 w-px bg-border shrink-0" />
          {variant === "m1" && <span className="text-xs font-medium truncate max-w-[120px]">{active?.name}</span>}
          {variant === "m2" && (
            <>
              <CharSelect />
              <span className="h-4 w-px bg-border shrink-0" />
              <CountdownInline />
            </>
          )}
          {variant === "m3" && <CharStepper />}
          {(variant === "n1" || variant === "n2" || variant === "n3") && (
            <>
              <CharStepper />
              <span className="h-4 w-px bg-border shrink-0" />
              <CharMgmt layout={variant} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function PillSwitcher() {
  if (!import.meta.env.DEV) return null;
  const go = (x: string) => {
    const u = new URL(window.location.href);
    u.searchParams.set("variant", x);
    window.location.href = u.toString();
  };
  return (
    <div className="fixed bottom-4 right-4 z-50 flex gap-1 rounded-full border bg-card p-1 shadow-lg">
      {(["m1", "m2", "m3", "n1", "n2", "n3"] as const).map((x) => (
        <button key={x} onClick={() => go(x)} className="h-9 px-2.5 rounded-full text-sm font-bold hover:bg-accent">
          {x.toUpperCase()}
        </button>
      ))}
      <button onClick={() => { const u = new URL(window.location.href); u.searchParams.delete("variant"); window.location.href = u.toString(); }} className="h-9 w-9 rounded-full text-sm hover:bg-accent" aria-label="exit prototype">✕</button>
    </div>
  );
}
