import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import type { Task, ResetKind, TaskSection } from "@/lib/types";
import { useAppStore } from "@/store/useAppStore";

type Props = { open: boolean; onOpenChange: (v: boolean) => void; editing?: Task | null; };

const ICONS = ["⭐","🎯","📦","🔧","🗡️","🛡️","💎","🍀","🔥","❄️","⚡","🌟","🎁","📌","✅"];

export function AddTaskDialog({ open, onOpenChange, editing }: Props) {
  const add = useAppStore((s) => s.addCustomTask);
  const update = useAppStore((s) => s.updateCustomTask);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("⭐");
  const [desc, setDesc] = useState("");
  const [notes, setNotes] = useState("");
  const [section, setSection] = useState<TaskSection>("daily");
  const [kind, setKind] = useState<ResetKind>("daily");
  const [type, setType] = useState<"check"|"counter">("check");
  const [max, setMax] = useState(1);
  const [timeGated, setTimeGated] = useState("");

  useEffect(() => {
    if (editing) {
      setName(editing.name); setIcon(editing.icon); setDesc(editing.desc ?? ""); setNotes(editing.notes ?? "");
      setSection(editing.section); setKind(editing.kind); setType(editing.type); setMax(editing.max ?? 1); setTimeGated(editing.timeGated ?? "");
    } else {
      setName(""); setIcon("⭐"); setDesc(""); setNotes(""); setSection("daily"); setKind("daily"); setType("check"); setMax(1); setTimeGated("");
    }
  }, [editing, open]);

  // auto sync kind when section changes if not editing
  useEffect(() => {
    if (editing) return;
    if (section === "daily") setKind("daily");
    else if (section === "weekly") setKind("weekly");
    else setKind("account-daily");
  }, [section, editing]);

  const submit = () => {
    if (!name.trim()) return;
    if (editing) {
      update(editing.id, { name: name.trim(), icon, desc: desc.trim()||undefined, notes: notes.trim()||undefined, section, kind, type, max: type==="counter"? Math.max(1, max): undefined, timeGated: timeGated.trim()||undefined });
    } else {
      add({ name: name.trim(), icon, desc: desc.trim()||undefined, notes: notes.trim()||undefined, section, kind, type, max: type==="counter"? Math.max(1, max): undefined, timeGated: timeGated.trim()||undefined });
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)} className="max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "編輯任務" : "新增自訂任務"}</DialogTitle>
          <DialogDescription>所有任務皆支援隱藏與拖曳排序。時間限制例如 06:00,18:00</DialogDescription>
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
              <Select value={section} onValueChange={(v) => setSection(v as TaskSection)}>
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
              <Select value={type} onValueChange={(v) => setType(v as "check"|"counter")}>
                <SelectTrigger>
                  <SelectValue placeholder="選擇類型" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="check">勾選</SelectItem>
                  <SelectItem value="counter">計數</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {type==="counter" && (
              <div>
                <Label>次數上限</Label>
                <Input type="number" min={1} value={max} onChange={(e) => setMax(Number(e.target.value))} />
              </div>
            )}
          </div>
          <div>
            <Label>時間限制（選填）</Label>
            <Input value={timeGated} onChange={(e) => setTimeGated(e.target.value)} placeholder="06:00,18:00" />
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
