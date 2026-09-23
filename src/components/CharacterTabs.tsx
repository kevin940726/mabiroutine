import { useState } from "react";
import { createPortal } from "react-dom";
import { useAppStore } from "@/store/useAppStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { confirmRemoveCharacter } from "@/components/ConfirmDialog";
import { batchedDragUndo } from "@/components/TrackerSection";
import { cn, focusSelectOnMount } from "@/lib/utils";
import { useIsMobile } from "@/hooks/useIsMobile";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Pencil, Trash2, Plus, ChevronDown, GripVertical, Check } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

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
  const reorder = useAppStore((s) => s.reorderCharacters);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const activeChar = chars.find((c) => c.id === active);
  return { chars, active, setActive, addChar, removeChar, rename, reorder, editing, setEditing, draft, setDraft, activeChar };
}

// Shared drop commit factory (pure — not a hook): splice ids, queue a
// batched undo (same 5s-batch semantics as task drags) restoring the
// pre-drop order. Guards stale ids: a mid-drag remove would otherwise make
// arrayMove(-1, …) silently move the last element.
function makeDropCommit(
  chars: { id: string; name: string }[],
  reorder: (ids: string[]) => void
) {
  return (activeId: string, overId: string) => {
    const ids = chars.map((c) => c.id);
    const from = ids.indexOf(activeId);
    const to = ids.indexOf(overId);
    if (from < 0 || to < 0 || from === to) return;
    const next = arrayMove(ids, from, to);
    const moved = chars[from];
    reorder(next);
    if (moved) batchedDragUndo(moved.name, () => reorder(ids));
  };
}

// Sortable character menu rows — shared by the tab bar and both floating
// pills (mobile roster jump + desktop switcher). Grip drags, the item
// selects (and closes the menu, like the old radio rows). Pointer-only:
// menus own arrow keys for navigation (desktop pills carry the keyboard
// path instead).
export function SortableCharMenu({
  activeId,
  onSelect,
}: {
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const chars = useAppStore((s) => s.characters);
  const reorder = useAppStore((s) => s.reorderCharacters);
  const commit = makeDropCommit(chars, reorder);
  const [dragId, setDragId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const onEnd = (e: DragEndEvent) => {
    setDragId(null);
    const { active: a, over } = e;
    if (!over) return;
    commit(String(a.id), String(over.id));
  };
  const dragChar = chars.find((c) => c.id === dragId) ?? null;
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={(e: DragStartEvent) => setDragId(String(e.active.id))}
      onDragEnd={onEnd}
      onDragCancel={() => setDragId(null)}
    >
      <SortableContext items={chars.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        {chars.map((c) => (
          <SortableMenuRow key={c.id} id={c.id} name={c.name} isActive={c.id === activeId} onSelect={() => onSelect(c.id)} />
        ))}
      </SortableContext>
      {typeof document !== "undefined" &&
        createPortal(
          <DragOverlay dropAnimation={null}>
            {dragChar && (
              <div className="flex items-center gap-0.5 rounded bg-popover text-sm shadow-xl ring-1 ring-primary">
                <span className="rounded p-1.5 text-muted-foreground" aria-hidden>
                  <GripVertical className="h-4 w-4" />
                </span>
                <span className="flex flex-1 items-center gap-2 px-2 py-1.5">
                  <span className="flex-1">{dragChar.name}</span>
                  {dragChar.id === activeId && <Check className="h-4 w-4 opacity-60" />}
                </span>
              </div>
            )}
          </DragOverlay>,
          document.body
        )}
    </DndContext>
  );
}

function CharacterTabsMobile() {
  const { chars, active, setActive, addChar, removeChar, rename, editing, setEditing, draft, setDraft, activeChar } = useCharState();
  return (
    <>
      <div className="flex items-center gap-2">
        {/* same non-modal switcher as the floating pill: Radix Select would
            scroll-lock (scrollbar vanishes); this never touches the page */}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button className="flex h-9 flex-1 items-center justify-between gap-1 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className="truncate">{activeChar?.name ?? "選擇角色"}</span>
              <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[8rem]">
            <SortableCharMenu activeId={active} onSelect={setActive} />
          </DropdownMenuContent>
        </DropdownMenu>
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
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={() => {
                  if (!activeChar) return;
                  void confirmRemoveCharacter(activeChar.name).then((ok) => {
                    if (ok) removeChar(activeChar.id);
                  });
                }}
                aria-label="delete"
              >
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
          <Input ref={focusSelectOnMount} value={draft} onChange={(e) => setDraft(e.target.value)} className="h-9 flex-1" placeholder="名稱" />
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

// Sortable row inside the mobile dropdown: grip drags, the item selects
// (and closes the menu, like the old radio rows). Prod look preserved —
// plain left-aligned names, check marks the active one.
function SortableMenuRow({
  id,
  name,
  isActive,
  onSelect,
}: {
  id: string;
  name: string;
  isActive: boolean;
  onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("flex items-center gap-0.5 rounded", isDragging && "bg-accent opacity-60")}
    >
      <span
        {...attributes}
        {...listeners}
        aria-label={`拖動 ${name} 排序`}
        className="cursor-grab touch-none rounded p-1.5 text-muted-foreground active:cursor-grabbing"
      >
        <GripVertical className="h-4 w-4" />
      </span>
      <DropdownMenuItem onSelect={onSelect} className="flex flex-1 items-center gap-2 text-sm">
        <span className="flex-1">{name}</span>
        {isActive && <Check className="h-4 w-4 opacity-60" />}
      </DropdownMenuItem>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Desktop variant. Desktop and mobile evolve together — every change considers
// both.
// ---------------------------------------------------------------------------

function CharacterTabsDesktop() {
  const { chars, active, setActive, addChar, removeChar, rename, reorder, editing, setEditing, draft, setDraft } = useCharState();
  const commit = makeDropCommit(chars, reorder);
  const [dragId, setDragId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const onEnd = (e: DragEndEvent) => {
    setDragId(null);
    const { active: a, over } = e;
    if (!over) return;
    commit(String(a.id), String(over.id));
  };
  const dragChar = chars.find((c) => c.id === dragId) ?? null;
  return (
    <div className="flex items-center gap-2">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={(e: DragStartEvent) => setDragId(String(e.active.id))}
        onDragEnd={onEnd}
        onDragCancel={() => setDragId(null)}
      >
        {/* rect strategy: pills wrap to multiple rows, and the horizontal
            strategy piles them up mid-drag (slot math assumes one row) */}
        <SortableContext items={chars.map((c) => c.id)} strategy={rectSortingStrategy}>
          <div className="flex gap-1.5 flex-wrap">
            {chars.map((c) => (
              <SortablePill
                key={c.id}
                id={c.id}
                name={c.name}
                isActive={active === c.id}
                isEditing={editing === c.id}
                showControls={chars.length > 1 && active === c.id}
                onSelect={() => setActive(c.id)}
                onEdit={() => {
                  setEditing(c.id);
                  setDraft(c.name);
                }}
                onRemove={() => {
                  void confirmRemoveCharacter(c.name).then((ok) => {
                    if (ok) removeChar(c.id);
                  });
                }}
                onRename={(v) => {
                  rename(c.id, v);
                  setEditing(null);
                }}
                onCancelEdit={() => setEditing(null)}
                draft={draft}
                setDraft={setDraft}
              />
            ))}
          </div>
        </SortableContext>
        {typeof document !== "undefined" &&
          createPortal(
            <DragOverlay dropAnimation={null}>
              {dragChar && (
                <div
                  className={cn(
                    "relative flex items-center gap-1 rounded-full border py-1 pl-4 pr-2 text-sm shadow-lg",
                    dragChar.id === active
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-foreground"
                  )}
                >
                  <span
                    className="absolute left-0 top-1/2 -translate-y-1/2 p-1 text-muted-foreground opacity-40"
                    aria-hidden
                  >
                    <GripVertical className="block h-3.5 w-3.5" />
                  </span>
                  <span className="rounded-full px-3 py-1 font-medium">{dragChar.name}</span>
                  {dragChar.id === active && (
                    <span className="rounded-full p-1 opacity-60" aria-hidden>
                      <Pencil className="h-3 w-3" />
                    </span>
                  )}
                  {chars.length > 1 && dragChar.id === active && (
                    <span className="rounded-full p-1 opacity-60" aria-hidden>
                      <Trash2 className="h-3 w-3" />
                    </span>
                  )}
                </div>
              )}
            </DragOverlay>,
            document.body
          )}
      </DndContext>
      <Button variant="outline" size="sm" className="shrink-0 rounded-full" onClick={() => addChar()} disabled={chars.length >= 6}>
        <Plus className="h-4 w-4" />
        新增角色 {chars.length}/6
      </Button>
    </div>
  );
}

// Desktop pill: tap selects; the floating grip (H3 — zero flow width,
// persistent faint, token-native pl-4/pr-2) drags. 6px activation protects
// taps; KeyboardSensor gives the arrow-key path.
function SortablePill({
  id,
  name,
  isActive,
  isEditing,
  showControls,
  onSelect,
  onEdit,
  onRemove,
  onRename,
  onCancelEdit,
  draft,
  setDraft,
}: {
  id: string;
  name: string;
  isActive: boolean;
  isEditing: boolean;
  showControls: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onRename: (v: string) => void;
  onCancelEdit: () => void;
  draft: string;
  setDraft: (v: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: isEditing,
  });
  // Translate, NOT Transform: rectSortingStrategy outputs scaleX/scaleY to
  // stretch items into their target slot, and our pills are variable-width
  // (long names) — Transform skews the chip mid-transit, Translate just
  // slides it (maintainer prescription, dnd-kit #117).
  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group relative flex items-center gap-1 rounded-full border py-1 pl-4 pr-2 text-sm transition-colors",
        isDragging && "opacity-40",
        isEditing
          ? "bg-card text-foreground border-primary"
          : isActive
            ? "bg-primary text-primary-foreground border-primary"
            : "bg-card hover:bg-accent"
      )}
    >
      {!isEditing && (
        <span
          {...attributes}
          {...listeners}
          aria-label={`拖動 ${name} 排序`}
          title="拖動排序"
          className="absolute left-0 top-1/2 z-10 -translate-y-1/2 cursor-grab touch-none p-1 text-muted-foreground opacity-40 transition-opacity hover:opacity-100 focus-visible:opacity-100 active:cursor-grabbing active:opacity-100"
        >
          <GripVertical className="block h-3.5 w-3.5" />
        </span>
      )}
      {isEditing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onRename(draft);
          }}
          className="flex items-center gap-1.5 pl-1"
        >
          <Input ref={focusSelectOnMount} value={draft} onChange={(e) => setDraft(e.target.value)} className="h-7 w-28 px-2 text-sm bg-background" placeholder="名稱" />
          <Button type="submit" size="sm" className="h-7 px-2.5 text-xs">
            儲存
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2.5 text-xs" onClick={onCancelEdit}>
            取消
          </Button>
        </form>
      ) : (
        <>
          <button onClick={onSelect} className={cn("rounded-full px-3 py-1 text-sm font-medium", isActive ? "" : "")}>
            {name}
          </button>
          {/* edit/remove live only on the active pill: inactive pills stay
              name-only, which keeps the row narrow without wrapping */}
          {isActive && (
            <button
              onClick={onEdit}
              className="rounded-full p-1 opacity-60 hover:opacity-100 hover:bg-primary-foreground/20"
              aria-label="rename"
            >
              <Pencil className="h-3 w-3" />
            </button>
          )}
          {showControls && (
            <button
              onClick={onRemove}
              className="rounded-full p-1 opacity-60 hover:opacity-100 hover:text-destructive hover:bg-primary-foreground/20"
              aria-label="delete"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </>
      )}
    </div>
  );
}
