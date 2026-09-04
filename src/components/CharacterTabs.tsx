import { useState } from "react";
import { useAppStore } from "@/store/useAppStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/useIsMobile";
import { Pencil, Trash2, Plus } from "lucide-react";

export function CharacterTabs() {
  const isMobile = useIsMobile();
  return isMobile ? <CharacterTabsMobile /> : <CharacterTabsDesktop />;
}

function useCharState() {
  const chars = useAppStore((s) => s.characters);
  const active = useAppStore((s) => s.activeCharId);
  const setActive = useAppStore((s) => s.setActiveChar);
  const addChar = useAppStore((s) => s.addCharacter);
  const removeChar = useAppStore((s) => s.removeCharacter);
  const rename = useAppStore((s) => s.renameCharacter);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const activeChar = chars.find((c) => c.id === active);
  return { chars, active, setActive, addChar, removeChar, rename, editing, setEditing, draft, setDraft, activeChar };
}

function CharacterTabsMobile() {
  const { chars, active, setActive, addChar, removeChar, rename, editing, setEditing, draft, setDraft, activeChar } = useCharState();
  return (
    <>
      <div className="flex items-center gap-2">
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
      {editing && activeChar && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            rename(activeChar.id, draft);
            setEditing(null);
          }}
          className="flex items-center gap-2 mt-2"
        >
          <Input autoFocus ref={(el) => el?.select()} value={draft} onChange={(e) => setDraft(e.target.value)} className="h-9 flex-1" placeholder="名稱" />
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

// ---------------------------------------------------------------------------
// Desktop variant. Desktop and mobile evolve together — every change considers
// both.
// ---------------------------------------------------------------------------

function CharacterTabsDesktop() {
  const { chars, active, setActive, addChar, removeChar, rename, editing, setEditing, draft, setDraft } = useCharState();
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-1.5 flex-wrap">
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
                {/* edit/remove live only on the active pill: inactive pills stay
                    name-only, which keeps the row narrow without wrapping */}
                {active === c.id && (
                  <button
                    onClick={() => {
                      setEditing(c.id);
                      setDraft(c.name);
                    }}
                    className="rounded-full p-1 opacity-60 hover:opacity-100 hover:bg-primary-foreground/20"
                    aria-label="rename"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                )}
                {chars.length > 1 && active === c.id && (
                  <button
                    onClick={() => removeChar(c.id)}
                    className="rounded-full p-1 opacity-60 hover:opacity-100 hover:text-destructive hover:bg-primary-foreground/20"
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
