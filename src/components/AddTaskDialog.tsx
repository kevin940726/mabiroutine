import { useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MenuSelect } from "@/components/MenuSelect";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";
import type { Task, ResetKind, TaskSection, TaskType } from "@/lib/types";
import { useAppStore } from "@/store/useAppStore";
import { focusSelectOnMount } from "@/lib/utils";

type Props = { open: boolean; onOpenChange: (v: boolean) => void; editing?: Task | null; defaultSection?: TaskSection };

// Which schedule a freshly opened dialog starts on. A section maps to one
// schedule except "account", which holds both the daily and weekly account
// resets (SCHEDULES above), so an account-section add starts on account-daily
// and the select still offers account-weekly. Editing ignores this: the task's
// own saved pair wins.
function initialSchedule(editing: Task | null | undefined, defaultSection: TaskSection | undefined): string {
  if (editing) return scheduleOf(editing);
  if (defaultSection === "weekly") return "weekly";
  if (defaultSection === "account") return "account-daily";
  return "daily";
}

// Curated quick picks fill the free input — the typed text is always the
// final value, the menu never owns it. No search/filter: 15 items fit.
const CURATED_ICONS = ["⭐","🎯","📦","🔧","🗡️","🛡️","💎","🍀","🔥","❄️","⚡","🌟","🎁","📌","✅"];
function firstGrapheme(s: string): string {
  if (!s) return "";
  if (typeof Intl.Segmenter === "function") {
    const it = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s)[Symbol.iterator]();
    const first = it.next();
    if (!first.done) return first.value.segment;
    return "";
  }
  return [...s].slice(0, 2).join("");
}

// The only coherent combos: home (每日/每週/帳號共通) × reset cycle, kind
// derived. Two free selects admitted unrenderable states (e.g. 每日區 +
// 每週重置), so the dialog offers just these four.
const SCHEDULES: { value: string; label: string; section: TaskSection; kind: ResetKind }[] = [
  { value: "daily", label: "☀️ 每日 · 06:00", section: "daily", kind: "daily" },
  { value: "weekly", label: "🗓️ 每週 · 週一 06:00", section: "weekly", kind: "weekly" },
  { value: "account-daily", label: "👥 帳號每日 · 06:00", section: "account", kind: "account-daily" },
  { value: "account-weekly", label: "👥 帳號每週 · 週一 06:00", section: "account", kind: "account-weekly" },
];

// Legacy customs saved with an incoherent section/kind pair (possible with
// the old free selects) heal to the section's home on next save — home wins
// because it's what the user sees every day.
function scheduleOf(t: { section: TaskSection; kind: ResetKind } | null | undefined): string {
  if (t?.section === "account") return t.kind === "account-weekly" ? "account-weekly" : "account-daily";
  if (t?.section === "weekly") return "weekly";
  return "daily";
}

// Which schedule options the dialog offers, given where it was opened from.
//
// On ADD the section is known from the per-section 新增 button, so the options
// narrow to that section's schedules — and when there is only one, the field is
// hidden entirely (a control with a single choice is just a label the user cannot
// act on). "account" is the one section with two schedules, so it keeps the field
// and shows just those two; the other three sections each collapse to one option
// and their field disappears.
//
// On EDIT every option stays: the select is also how an existing task moves
// between sections, which is a capability, not a presentation detail.
function scheduleOptions(editing: Task | null | undefined, defaultSection: TaskSection | undefined) {
  if (editing || !defaultSection) return SCHEDULES;
  if (defaultSection === "account") return SCHEDULES.filter((s) => s.section === "account");
  return SCHEDULES.filter((s) => s.section === defaultSection);
}

export function AddTaskDialog({ open, onOpenChange, editing, defaultSection }: Props) {
  const add = useAppStore((s) => s.addCustomTask);
  const update = useAppStore((s) => s.updateCustomTask);
  // Fresh mount per open/target (see key= at the call site) — initializers
  // replace the old reset-on-open effect; no setState-in-effect needed.
  const [name, setName] = useState(editing?.name ?? "");
  const [icon, setIcon] = useState(editing?.icon ?? "⭐");
  const [desc, setDesc] = useState(editing?.desc ?? "");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [schedule, setSchedule] = useState(() => initialSchedule(editing, defaultSection));
  // Icon selects all once on its FIRST focus (mount focus belongs to the
  // name field below). Per-open flag is enough: the dialog remounts on every
  // open/target via key= at the call site.
  const iconSelected = useRef(false);
  const [type, setType] = useState<TaskType>(editing?.type ?? "check");
  const [max, setMax] = useState(editing?.max ?? 1);

  const maxFor = (t: TaskType) => (t === "check" ? undefined : Math.max(1, max));
  // The section was already decided by the button that opened this dialog when
  // there is exactly one valid schedule, so the field would be a one-item control
  // with nothing to choose. Account keeps it (two schedules); edit keeps all four.
  const options = scheduleOptions(editing, defaultSection);
  const showSchedule = options.length > 1;
  const submit = () => {
    if (!name.trim()) return;
    const s = SCHEDULES.find((x) => x.value === schedule) ?? SCHEDULES[0];
    const safeIcon = firstGrapheme(icon.trim()) || "⭐";
    if (editing) {
      update(editing.id, { name: name.trim(), icon: safeIcon, desc: desc.trim()||undefined, notes: notes.trim()||undefined, section: s.section, kind: s.kind, type, max: maxFor(type) });
    } else {
      add({ name: name.trim(), icon: safeIcon, desc: desc.trim()||undefined, notes: notes.trim()||undefined, section: s.section, kind: s.kind, type, max: maxFor(type) });
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle asChild>
            <h2 className="text-lg font-semibold leading-none tracking-tight mb-2">{editing ? "編輯任務" : "新增自訂任務"}</h2>
          </DialogTitle>
          <DialogDescription>所有任務皆支援隱藏與拖曳排序。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <div className="grid gap-1.5">
              <Label>名稱 *</Label>
              <Input ref={focusSelectOnMount} value={name} onChange={(e) => setName(e.target.value)} placeholder="每週魔物印記商店" />
            </div>
            <div className="grid gap-1.5">
              <Label>圖示</Label>
              <div className="flex items-center">
                <Input
                  value={icon}
                  onChange={(e) => setIcon(firstGrapheme(e.target.value))}
                  onFocus={(e) => {
                    if (!iconSelected.current) {
                      iconSelected.current = true;
                      e.target.select();
                    }
                  }}
                  placeholder="⭐"
                  aria-label="圖示，輸入任意單一表情"
                  className="w-12 rounded-r-none text-center text-lg relative focus-visible:z-10"
                />
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon" className="h-9 w-7 shrink-0 rounded-l-none border-l-0" aria-label="選擇常用圖示">
                      <ChevronDown className="h-4 w-4 opacity-50" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="p-1.5">
                    <div className="grid grid-cols-5 gap-0.5" role="presentation">
                      {CURATED_ICONS.map((i) => (
                        <DropdownMenuItem
                          key={i}
                          onSelect={() => setIcon(i)}
                          className="h-9 justify-center px-0 text-lg"
                        >
                          {i}
                        </DropdownMenuItem>
                      ))}
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>描述</Label>
            <Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="村長、傭兵事務所" />
          </div>
          <div className="grid gap-1.5">
            <Label>備註 / 筆記</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="若缺印章可換（200 魔物印記的證明）" rows={2} />
          </div>
          {/* The 區段 / 重置 row and 類型 share a row when both are present. With the
              section field hidden (a single valid schedule) 類型 takes the full
              width, so hiding the field does not leave a half-empty row. */}
          <div className={showSchedule ? "grid grid-cols-1 sm:grid-cols-2 gap-3" : "grid grid-cols-1 gap-3"}>
            {showSchedule && (
              <div className="grid gap-1.5">
                <Label>區段 / 重置</Label>
                <MenuSelect
                  value={schedule}
                  options={options.map(({ value, label }) => ({ value, label }))}
                  onChange={(v) => setSchedule(v)}
                  triggerClassName="w-full"
                />
              </div>
            )}
            <div className="grid gap-1.5">
              <Label>類型</Label>
              <MenuSelect
                value={type}
                options={[
                  { value: "check", label: "勾選" },
                  { value: "counter", label: "計數" },
                  { value: "countdown", label: "倒數（顯示剩餘）" },
                ]}
                onChange={(v) => setType(v as TaskType)}
                triggerClassName="w-full"
              />
            </div>
          </div>
          {type!=="check" && (
            <div className="grid gap-1.5">
              <Label>次數上限</Label>
              <Input type="number" min={1} value={max} onChange={(e) => setMax(Number(e.target.value))} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={submit} disabled={!name.trim()}>{editing ? "儲存" : "新增"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
