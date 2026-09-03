import { useState } from "react";
import { useAppStore } from "@/store/useAppStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-thin">
      <div className="flex gap-1.5 flex-nowrap">
        {chars.map((c) => (
          <div
            key={c.id}
            className={cn(
              "group flex items-center gap-1 rounded-full border px-1 py-1 text-sm transition-colors",
              active === c.id ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-accent"
            )}
          >
            {editing === c.id ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  rename(c.id, draft);
                  setEditing(null);
                }}
                className="flex items-center gap-1"
              >
                <Input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  className="h-7 w-24 px-2 text-sm"
                  placeholder="名稱"
                />
                <Button type="submit" size="sm" className="h-7 px-2 text-xs">
                  儲存
                </Button>
                <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={() => setEditing(null)}>
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
  );
}
