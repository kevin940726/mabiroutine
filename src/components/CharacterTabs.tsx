import { useState } from "react";
import { useAppStore } from "@/store/useAppStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Pencil, Trash2, Plus } from "lucide-react";

export function CharacterTabs() {
  const chars = useAppStore((s) => s.characters);
  const active = useAppStore((s) => s.activeCharId);
  const setActive = useAppStore((s) => s.setActiveChar);
  const addChar = useAppStore((s) => s.addCharacter);
  const removeChar = useAppStore((s) => s.removeCharacter);
  const rename = useAppStore((s) => s.renameCharacter);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const activeChar = chars.find((c) => c.id === active);

  return (
    <>
      {/* desktop: pill tabs */}
      <div className="hidden sm:flex items-center gap-2 overflow-x-auto pb-2 scrollbar-thin">
        <div className="flex gap-1.5 flex-nowrap">
          {chars.map((c) => (
            <div
              key={c.id}
              className={cn(
                "group flex items-center gap-1 rounded-full border px-2 py-1 text-sm transition-colors",
                editing === c.id
                  ? "bg-card text-foreground border-primary"
                  : active === c.id
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card hover:bg-accent"
              )}
            >
              {editing === c.id ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    rename(c.id, draft);
                    setEditing(null);
                  }}
                  className="flex items-center gap-1.5 pl-1"
                >
                  <Input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} className="h-7 w-28 px-2 text-sm bg-background" placeholder="名稱" />
                  <Button type="submit" size="sm" className="h-7 px-2.5 text-xs">
                    儲存
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="h-7 px-2.5 text-xs" onClick={() => setEditing(null)}>
                    取消
                  </Button>
                </form>
              ) : (
                <>
                  <button onClick={() => setActive(c.id)} className={cn("rounded-full px-3 py-1 text-sm font-medium", active === c.id ? "" : "")}>
                    {c.name}
                  </button>
                  <button
                    onClick={() => {
                      setEditing(c.id);
                      setDraft(c.name);
                    }}
                    className={cn("rounded-full p-1 opacity-60 hover:opacity-100", active === c.id ? "hover:bg-primary-foreground/20" : "hover:bg-accent")}
                    aria-label="rename"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  {chars.length > 1 && (
                    <button
                      onClick={() => removeChar(c.id)}
                      className={cn("rounded-full p-1 opacity-60 hover:opacity-100 hover:text-destructive", active === c.id ? "hover:bg-primary-foreground/20" : "")}
                      aria-label="delete"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
        <Button variant="outline" size="sm" className="shrink-0 rounded-full" onClick={() => addChar()} disabled={chars.length >= 6}>
          <Plus className="h-4 w-4" />
          新增角色 {chars.length}/6
        </Button>
      </div>

      {/* mobile: dropdown */}
      <div className="flex sm:hidden items-center gap-2">
        <Select value={active} onValueChange={(v) => setActive(v)}>
          <SelectTrigger className="flex-1 w-full">
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
        {activeChar && (
          <>
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9 shrink-0"
              onClick={() => {
                setEditing(activeChar.id);
                setDraft(activeChar.name);
              }}
              aria-label="rename"
            >
              <Pencil className="h-4 w-4" />
            </Button>
            {chars.length > 1 && (
              <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => removeChar(activeChar.id)} aria-label="delete">
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </>
        )}
        <Button variant="outline" size="sm" className="shrink-0 rounded-full" onClick={() => addChar()} disabled={chars.length >= 6}>
          <Plus className="h-4 w-4" />
          {chars.length}/6
        </Button>
      </div>
      {/* mobile inline rename */}
      {editing && activeChar && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            rename(activeChar.id, draft);
            setEditing(null);
          }}
          className="flex sm:hidden items-center gap-2 mt-2"
        >
          <Input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} className="h-9 flex-1" placeholder="名稱" />
          <Button type="submit" size="sm">
            儲存
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(null)}>
            取消
          </Button>
        </form>
      )}
    </>
  );
}
