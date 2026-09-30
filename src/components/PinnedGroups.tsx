// Grouped pinned 已釘選 rows: one parent per NPC holding all that NPC's pins, a
// lone pin left as a plain row.
//
// THE RULE, as the user stated it: the parent must be LAYOUT-IDENTICAL to a normal
// pinned row — same shell, same columns, same tile, same typography, same badges —
// with ONE clear sign that it expands. Every earlier cut broke this by inventing
// extra chrome: a violet wrapper, a violet ring, a coloured N/M pill, a bold name, a
// dash in the tile. Those all read as "a different component", which is the
// complaint. The parent IS a row; what marks it out is the bottom strip, plus a
// violet tint that lives on the strip and the expanded body — NOT on the parent
// card, which stays the row's own neutral shell.
//
// WHY THE STRIP. The row's grid is [rail 28][body flex-1][tile 44/56] and the tile
// alone owns the right end. Anything added inline (a chip, a chevron column, a
// second button) either steals width from the body or pushes past the row's right
// edge — that was the "8px past every row" bug. So the expand control is placed
// OUT of the grid entirely: an absolutely-positioned full-width strip sitting on
// the parent card's BOTTOM BORDER. It costs zero layout width, so it cannot break
// alignment no matter the viewport, and it is the parent's own bottom edge, so it
// reads as "this row opens downward" — which is also the direction the children
// appear.
//
// LIVE. Writes go through the store's existing per-row actions, so the parent
// completes/clears its children for real. The parent stores NOTHING: its state is
// derived on render, so there is no new persisted shape.
import { useState } from "react";
import { displayName } from "@/lib/materials";
import { TaskRow } from "@/components/TaskRow";
import { ROW_SHELL_DESKTOP, ROW_SHELL_MOBILE, TICKER_BOX_DESKTOP, TICKER_BOX_MOBILE, PFP_DESKTOP, PFP_MOBILE } from "@/components/rowStyle";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useAppStore } from "@/store/useAppStore";
import { useIsMobile } from "@/hooks/useIsMobile";
import { cn } from "@/lib/utils";
import { parentState, parentFillPct, progressOf, type PinRow } from "@/lib/pinGroup";
import { ChevronDown, Eye, EyeOff, GripVertical } from "lucide-react";
import type { Task } from "@/lib/types";

/** What the parent's tap does, as calls to the EXISTING per-row actions. No store
 *  change. setCounter is called with 0 rather than a delete, so an explicit clear
 *  is a PRESENT 0 on the wire — the propagation-bit rule at useAppStore.ts:856. */
function useGroupToggle() {
  const toggleCheck = useAppStore((s) => s.toggleCheck);
  const setCounter = useAppStore((s) => s.setCounter);
  return (rows: PinRow[]) => {
    const complete = parentState(rows) !== "full";
    for (const r of rows) {
      if (r.task.type === "check") {
        if (Boolean(r.value) !== complete) toggleCheck(r.task.id, r.isAccount);
      } else {
        setCounter(r.task.id, complete ? (r.task.max ?? 0) : 0, r.isAccount);
      }
    }
  };
}

/** The parent's colour, in ONE pair of class strings. Dark is not a hue swap here:
 *  the dark card is oklch(0.205 0 0), so a light-mode violet at a real alpha lands
 *  on near-black as a bright patch and glares. Dark therefore uses a far lower
 *  alpha of a lighter step, the convention the repo already uses for dark tints.
 *
 *  - `strip` is the bottom capsule, where the colour is most visible.
 *  - `body` is the expanded children block. Tinting it is what makes an open group
 *    read as one unit instead of a parent with loose rows hanging off it.
 *
 *  The parent CARD is deliberately not tinted: it keeps the row's own neutral shell
 *  so the two read as the same component, with violet as a section marker only. */
const VIOLET_STRIP = "bg-violet-500/15 text-violet-700 dark:bg-violet-400/[0.10] dark:text-violet-300";
const VIOLET_BODY = "bg-violet-50/50 dark:bg-violet-400/[0.04]";

/** The tightest limit in a group: the one that decides whether to act now. */
function tightestLimit(rows: PinRow[]): string {
  const limits = rows
    .map((r) => displayName((r.task.source === "shop" ? r.task.shopMeta?.limit : r.task.barterMeta?.limit) ?? ""))
    .filter(Boolean);
  return limits.sort((a, b) => Number(a.match(/(\d+)/)?.[1] ?? 1e9) - Number(b.match(/(\d+)/)?.[1] ?? 1e9))[0] ?? "";
}

/** The item a pin is about, in the row's own wording: a barter row titles with
 *  barterMeta.get (minus its ×N), a shop row with task.name. */
function itemName(t: Task): string {
  if (t.source === "barter") return displayName((t.barterMeta?.get ?? "").replace(/ ×\d+$/, ""));
  return displayName(t.name);
}

/** One parent, laid out as a normal row plus a centred expand strip on its bottom
 *  edge. The strip is always centred: the left-aligned placement was dropped. */
function Group({
  title,
  rows,
  open,
  onToggleOpen,
}: {
  title: string;
  rows: PinRow[];
  open: boolean;
  onToggleOpen: () => void;
}) {
  const state = parentState(rows);
  const toggleGroup = useGroupToggle();
  const isMobile = useIsMobile();
  const first = rows[0].task;
  const town = first.town;
  const limit = tightestLimit(rows);
  const hasServerShared = rows.some((r) => r.task.serverShared === true);
  // A row's sub-line is the trade detail; a parent summarizes its children the
  // same way: the item names, then the tightest limit, in the row's own style.
  const names = rows.map((r) => itemName(r.task));
  const summary = names.slice(0, 3).join("、") + (names.length > 3 ? ` 等 ${names.length} 筆` : "");

  // Hide: a group is not a task, so hiding it hides every child.
  const char = useAppStore((s) => s.getActiveChar());
  const hiddenAccountTaskIds = useAppStore((s) => s.hiddenAccountTaskIds);
  const isHiddenTask = (t: Task) =>
    t.serverShared === true ? hiddenAccountTaskIds.includes(t.id) : (char?.hiddenTaskIds.includes(t.id) ?? false);
  const allHidden = rows.every((r) => isHiddenTask(r.task));
  const toggleHidden = useAppStore((s) => s.toggleHidden);
  const hideGroup = () => {
    for (const r of rows) if (isHiddenTask(r.task) !== !allHidden) toggleHidden(r.task.id);
  };

  // Grip: the band reorders pins by id and its SortableContext lists the CHILD
  // ids, so dragging the header moves the whole group in the pin order.
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: first.id });
  const gripStyle: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition };

  // The tile: literally a row's tile. Empty box when untouched, a ✓ when every
  // child is done, and a − while some but not all are. The − is the standard
  // indeterminate mark a checkbox uses for exactly this state, so the three states
  // are told apart by glyph alone; the bottom-up fill (the same one a row's counter
  // draws, emerald-500/25 up to the fraction of children done) rides behind it as
  // the "how far along" cue.
  const fillPct = parentFillPct(rows);
  const tile = (
    <div className={cn("relative z-20", isMobile ? TICKER_BOX_MOBILE : TICKER_BOX_DESKTOP)}>
      <button
        type="button"
        role="checkbox"
        aria-checked={state === "full" ? true : state === "partial" ? "mixed" : false}
        aria-label={
          state === "full"
            ? `清除 ${title} 的所有交易（${rows.filter((r) => progressOf(r).done).length}/${rows.length} 完成）`
            : `完成 ${title} 的所有交易`
        }
        onClick={() => toggleGroup(rows)}
        className={cn(
          "relative block h-11 w-11 rounded-xl border overflow-hidden select-none transition-colors",
          isMobile ? "" : "h-14 w-14",
          state === "full"
            ? "bg-emerald-600 border-emerald-600 text-white"
            : state === "partial"
              ? "border-emerald-600 text-emerald-600 dark:text-emerald-400"
              : "bg-card hover:border-primary"
        )}
      >
        {/* Same fill as a row's counter tile (TaskRow.tsx:635). Only shown while the
            group is incomplete; at 100% the whole tile is emerald and the ✓ is enough. */}
        {state !== "empty" && state !== "full" && (
          <span className="absolute bottom-0 left-0 right-0 bg-emerald-500/25 transition-all" style={{ height: `${fillPct}%` }} />
        )}
        {state === "full" ? (
          <span className="absolute inset-0 grid place-items-center text-lg leading-none text-white">✓</span>
        ) : state === "partial" ? (
          <span className="absolute inset-0 grid place-items-center text-lg leading-none">−</span>
        ) : null}
      </button>
    </div>
  );

  // The expand strip: full width, on the card's bottom edge, out of the grid and
  // INSIDE the row's existing bottom padding. It must not add height: a row card
  // is 88px (min-h-[88px]) and an earlier pb-6 made the parent 92px, which alone
  // reads as "not the same layout". A row already has 10px of bottom padding, so
  // the strip overlays that band and the card stays 88px.
  //
  // Discoverability was the complaint, so the chevron is no longer a bare 12px
  // glyph in muted grey: it is 16px, at full weight, and rides a tinted capsule the
  // full width of the card's bottom band. The capsule is what makes it read as a
  // control rather than page furniture.
  //
  // Dark mode is TUNED SEPARATELY, not the light classes with a `dark:` hue swap:
  // the dark card is oklch(0.205 0 0), so the light amber at any real alpha lands
  // as a bright yellow patch on near-black and glares. Dark uses a much lower
  // alpha (8-10%) and amber-300 text, which is the convention the repo already uses
  // for dark amber (TaskRow's notes, shared.tsx's 推薦).
  const strip = (
    <button
      type="button"
      aria-expanded={open}
      aria-label={`${open ? "收合" : "展開"} ${title} 的 ${rows.length} 筆交易`}
      onClick={(e) => {
        // Stop the click reaching the full-row overlay: both would toggle, so the
        // strip and the overlay would cancel each other out.
        e.stopPropagation();
        onToggleOpen();
      }}
      className={cn(
        "absolute inset-x-px bottom-px z-20 flex h-[14px] items-center rounded-b-[7px] transition-colors hover:brightness-95 dark:hover:brightness-125",
        VIOLET_STRIP,
        "justify-center"
      )}
    >
      <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold leading-none">
        <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")} />
        {open ? "收合" : `展開 ${rows.length} 筆`}
      </span>
    </button>
  );

  // The full-row click target. The row cannot BE a <button>: it contains real
  // controls (grip, eye, checkbox, strip) and a button cannot nest a button. So the
  // whole card gets an absolutely-positioned overlay button, and every real control
  // rides ABOVE it on z-20. Clicking the body toggles; clicking a control does its
  // own thing and never reaches the overlay.
  //
  // aria-hidden + tabIndex -1 on purpose: the STRIP is the real, announced expand
  // control (it has the label and the chevron). If this overlay also carried
  // aria-expanded and a label, a screen reader would announce the same disclosure
  // twice for one row. It is a pointer convenience only.
  const fullRowTarget = (
    <button
      type="button"
      aria-hidden
      tabIndex={-1}
      onClick={onToggleOpen}
      className="absolute inset-0 z-10 rounded-lg"
    />
  );

  const railControl = "relative z-20 h-6 w-6 grid shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground";
  const leading = (
    <>
      <button {...attributes} {...listeners} className="relative z-20 cursor-grab p-1 opacity-40 hover:opacity-100 touch-none" aria-label={`拖曳 ${title} 的交易`}>
        <GripVertical className="h-4 w-4" />
      </button>
      <button type="button" onClick={hideGroup} className={cn("relative z-20", isMobile ? railControl : "flex h-7 w-7 items-center justify-center rounded-md border bg-card shadow-sm opacity-20 group-hover:opacity-100")} aria-label={allHidden ? `顯示 ${title} 的所有交易` : `隱藏 ${title} 的所有交易`}>
        {allHidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
      </button>
      <img
        src={`/npc/${encodeURIComponent(title)}.png`}
        alt=""
        aria-hidden
        loading="lazy"
        onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")}
        className={isMobile ? PFP_MOBILE : PFP_DESKTOP}
      />
    </>
  );

  const body = (
    <>
      <div className="flex items-center gap-2">
        <span className="truncate text-sm font-bold text-primary">
          {title}
        </span>
        {hasServerShared && <span className="shrink-0 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] text-sky-700 dark:bg-sky-900/30 dark:text-sky-300">伺服器</span>}
        <span className="ml-auto flex shrink-0 items-center gap-1 text-xs min-w-0">
          <span className="truncate text-muted-foreground">{town}</span>
        </span>
      </div>
      <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground min-w-0">
        <span className="truncate">{summary}</span>
        <span className="ml-auto shrink-0">{limit}</span>
      </div>
    </>
  );

  return (
    <div ref={setNodeRef} style={gripStyle} data-pin-group={title} data-pin-group-state={state}>
      {/* The parent IS a row: the row's own shell, untinted. Violet appears only on
          the strip and, when open, the children block — so a parent is
          indistinguishable from a row except for its bottom capsule. */}
      <div className={cn(isMobile ? ROW_SHELL_MOBILE : ROW_SHELL_DESKTOP)}>
        {fullRowTarget}
        {isMobile ? (
          <div className="flex items-start gap-2">
            <div className="flex w-7 shrink-0 flex-col items-center self-stretch pt-0.5">{leading}</div>
            {/* pointer-events-none: the body is not a control, so a click anywhere on
                it must fall through to the full-row overlay. The rail and the tile sit
                outside this wrapper and keep their own z-20 hit areas. */}
            <div className="pointer-events-none relative z-0 min-w-0 flex-1">{body}</div>
            {tile}
          </div>
        ) : (
          <>
            <div className="flex shrink-0 items-center gap-1.5">{leading}</div>
            <div className="pointer-events-none relative z-0 min-w-0 flex-1">{body}</div>
            {tile}
          </>
        )}
        {strip}
      </div>
      {/* children: plain rows, one step in, so the parent's own card stays a row.
          The block carries the violet tint so an OPEN group reads as one unit: the
          colour the parent card gave up lives here, wrapping the children. */}
      {open && (
        <div className={cn("mt-2 space-y-2 rounded-lg p-2 pl-3", VIOLET_BODY)}>
          {rows.map((r) => (
            <TaskRow key={r.task.id} task={r.task} value={r.value} isAccount={r.isAccount} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Bucket rows by a key, preserving first-seen order. */
function bucket(rows: PinRow[], keyOf: (r: PinRow) => string): [string, PinRow[]][] {
  const m = new Map<string, PinRow[]>();
  for (const r of rows) {
    const k = keyOf(r);
    m.set(k, [...(m.get(k) ?? []), r]);
  }
  return [...m.entries()];
}

function useOpenMap() {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return [open, (k: string) => setOpen((s) => ({ ...s, [k]: !(s[k] ?? false) }))] as const;
}

/** The grouped pinned layout: one parent per merchant, gold and barter together.
 *  Lone pins stay plain rows — a parent of one is just a row wearing a strip. */
export function PinnedGroups({ rows }: { rows: PinRow[] }) {
  const [open, toggle] = useOpenMap();
  return (
    <div className="space-y-2" data-pin-variant="D">
      {bucket(rows, (r) => r.task.npc ?? "其他").map(([npc, group]) =>
        group.length === 1 ? (
          <TaskRow key={group[0].task.id} task={group[0].task} value={group[0].value} isAccount={group[0].isAccount} />
        ) : (
          <Group key={npc} title={npc} rows={group} open={open[npc] ?? false} onToggleOpen={() => toggle(npc)} />
        )
      )}
    </div>
  );
}

/** Default export alongside the named one, so either import style works. */
export default PinnedGroups;
