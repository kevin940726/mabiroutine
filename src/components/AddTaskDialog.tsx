import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import type { Task, ResetKind, TaskSection, TaskType } from "@/lib/types";
import { useAppStore } from "@/store/useAppStore";

type Props = { open: boolean; onOpenChange: (v: boolean) => void; editing?: Task | null; };

const ICONS = ["⭐","🎯","📦","🔧","🗡️","🛡️","💎","🍀","🔥","❄️","⚡","🌟","🎁","📌","✅"];

export function AddTaskDialog({ open, onOpenChange, editing }: Props) {
  const add = useAppStore((s) => s.addCustomTask);
  const update = useAppStore((s) => s.updateCustomTask);
  // Fresh mount per open/target (see key= at the call site) — initializers
  // replace the old reset-on-open effect; no setState-in-effect needed.
  const [name, setName] = useState(editing?.name ?? "");
  const [icon, setIcon] = useState(editing?.icon ?? "⭐");
  const [desc, setDesc] = useState(editing?.desc ?? "");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [section, setSection] = useState<TaskSection>(editing?.section ?? "daily");
  const [kind, setKind] = useState<ResetKind>(editing?.kind ?? "daily");
  const [type, setType] = useState<TaskType>(editing?.type ?? "check");
  const [max, setMax] = useState(editing?.max ?? 1);

  // Kind follows section for new tasks (was an effect — now event-driven).
  const changeSection = (v: string) => {
    const s = v as TaskSection;
    setSection(s);
    if (!editing) setKind(s === "daily" ? "daily" : s === "weekly" ? "weekly" : "account-daily");
  };

  const maxFor = (t: TaskType) => (t === "check" ? undefined : Math.max(1, max));
  const submit = () => {
    if (!name.trim()) return;
    if (editing) {
      update(editing.id, { name: name.trim(), icon, desc: desc.trim()||undefined, notes: notes.trim()||undefined, section, kind, type, max: maxFor(type) });
    } else {
      add({ name: name.trim(), icon, desc: desc.trim()||undefined, notes: notes.trim()||undefined, section, kind, type, max: maxFor(type) });
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle asChild>
            <h1 className="text-lg font-semibold leading-none tracking-tight mb-2">{editing ? "編輯任務" : "新增自訂任務"}</h1>
          </DialogTitle>
          <DialogDescription>所有任務皆支援隱藏與拖曳排序。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <div>
              <Label>名稱 *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：每日懸賞" />
            </div>
            <div>
              <Label>圖示</Label>
              <Select value={icon} onValueChange={(v) => setIcon(v)}>
                <SelectTrigger>
                  <SelectValue placeholder="選擇圖示" />
                </SelectTrigger>
                <SelectContent>
                  {ICONS.map((i) => <SelectItem key={i} value={i}>{i}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>描述</Label>
            <Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="簡短說明" />
          </div>
          <div>
            <Label>備註 / 筆記</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="例如：需組隊、記得帶鑰匙" rows={2} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>區段</Label>
              <Select value={section} onValueChange={changeSection}>
                <SelectTrigger>
                  <SelectValue placeholder="選擇區段" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">☀️ 每日</SelectItem>
                  <SelectItem value="weekly">🗓️ 每週</SelectItem>
                  <SelectItem value="account">👥 帳號共通</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>重置</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as ResetKind)}>
                <SelectTrigger>
                  <SelectValue placeholder="選擇重置" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">每日 06:00</SelectItem>
                  <SelectItem value="weekly">每週 Mon 06:00</SelectItem>
                  <SelectItem value="account-daily">帳號每日</SelectItem>
                  <SelectItem value="account-weekly">帳號每週</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>類型</Label>
              <Select value={type} onValueChange={(v) => setType(v as TaskType)}>
                <SelectTrigger>
                  <SelectValue placeholder="選擇類型" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="check">勾選</SelectItem>
                  <SelectItem value="counter">計數</SelectItem>
                  <SelectItem value="countdown">倒數（顯示剩餘）</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {type!=="check" && (
              <div>
                <Label>次數上限</Label>
                <Input type="number" min={1} value={max} onChange={(e) => setMax(Number(e.target.value))} />
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={submit} disabled={!name.trim()}>{editing ? "儲存" : "新增"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
