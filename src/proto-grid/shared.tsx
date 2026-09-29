// PROTOTYPE (throwaway). Props and the pieces the shop grid shares.
//
// There is one design now: variant B with the tight density. The A/verdict/title/band
// alternatives were removed after review, so nothing here branches on which one to
// use. The tile lives in Tile.tsx.
import { Pin } from "lucide-react";
import { cn } from "@/lib/utils";
import { NpcFace } from "@/components/MerchantPanel";

export type ProtoItem = {
  key: string;
  pinId: string;
  npc: string;
  town: string;
  title: string;
  give: string;
  cost: string;
  limitText: string | null;
  scopeAccount: boolean;
  priority: "must" | "extra" | "once" | "situational" | null;
  note: string | null;
  kind: "shop" | "barter";
  /** Position in barter.json, or -1 for a row with no curated entry (every gold
   *  row, plus barter rows the curation skipped). Used as the tiebreak inside a
   *  priority tier, so -1 sorts last rather than first. */
  curatedIndex: number;
};

export type ProtoProps = {
  items: ProtoItem[];
  pinned: Set<string>;
  onTogglePin: (id: string) => void;
  /** Show the 金幣 / 以物易物 split inside each section. Set when a town or NPC filter
   *  narrows the list, where two labelled groups carry information; the full 194-row
   *  view is left unsplit. */
  splitKind?: boolean;
  /** Section by NPC rather than town. Set when a town or NPC filter narrows the view,
   *  so a town heading would repeat a single value. */
  byNpc?: boolean;
};

/**
 * Priority reads once, on the two tiers worth acting on: the stripe down the left
 * edge of the tile, and the word above the limit. They share a colour so the stripe
 * stops being decoration.
 *
 * 視需求, 一次性 and no-priority rows get the normal border, not a colour. Measured:
 * 94 rows have no priority, 53 are 視需求 and 8 are 一次性, so 155 of 194 (80%) were
 * carrying one of five stripe colours that said nothing. Decoding five colours to
 * find the two that matter is what made a grid of tiles read as noise.
 */
const PRIORITY = {
  must: { edge: "bg-red-500", text: "text-red-600 dark:text-red-400", label: "必換" },
  extra: { edge: "bg-amber-500", text: "text-amber-600 dark:text-amber-400", label: "推薦" },
  once: { edge: "bg-border", text: "text-sky-600 dark:text-sky-400", label: "一次性" },
  situational: { edge: "bg-border", text: "text-zinc-500 dark:text-zinc-400", label: "視需求" },
} as const;

/** Only 必換 and 推薦 render a word. 視需求 is the true default (53 rows) so naming
 *  it says nothing, and 一次性 reads as a warning but behaves like 推薦 for planning.
 *  Labels stay on the tiers that never render, so the map is total. */
export const priorityEdge = (p: ProtoItem["priority"]) => (p ? PRIORITY[p].edge : "bg-border");
export const priorityText = (p: ProtoItem["priority"]) =>
  p === "must" || p === "extra" ? PRIORITY[p].label : null;
export const priorityTint = (p: ProtoItem["priority"]) => (p ? PRIORITY[p].text : "");

/** Not a hook — it reads a Set and returns JSX. Named as a plain function on
 *  purpose: it is called inside a .map, and a `use*` name there trips
 *  rules-of-hooks for no reason. */
export function pinButton(item: ProtoItem, pinned: Set<string>, onTogglePin: (id: string) => void) {
  const isPinned = pinned.has(item.pinId);
  return {
    button: (
      <button
        key="pin"
        type="button"
        aria-label={isPinned ? `取消選取 ${item.title}` : `選取 ${item.title}`}
        aria-pressed={isPinned}
        onClick={(e) => {
          e.stopPropagation();
          onTogglePin(item.pinId);
        }}
        className={cn(
          "grid size-6 shrink-0 place-items-center rounded-full transition-colors",
          isPinned ? "bg-emerald-600 text-white" : "text-muted-foreground/50 hover:bg-accent hover:text-foreground"
        )}
      >
        <Pin className="size-3.5" fill={isPinned ? "currentColor" : "none"} />
      </button>
    ),
  };
}

/**
 * The limit, with the （伺服器） suffix stripped.
 *
 * `limitText` is built in shops.ts:118 as `每日 N 次（伺服器）`, so the string carries
 * the scope inside it. The tile renders scope separately, and the parenthetical said
 * the same thing a second time in the same line. Stripping here is display-only; the
 * value the tracker and the store see still has it.
 *
 * This mirrors MerchantPanel.tsx, which does the same strip for the production row
 * (and both should go away together if limitText ever stops embedding scope).
 */
export const limitOf = (i: ProtoItem) => (i.limitText ?? "不限次數").replace("（伺服器）", "");

/**
 * The merchant header used by every NPC-sectioned view: portrait, name, town and that
 * merchant's row count.
 */
export function NpcHeader({ npc, town, count }: { npc: string; town: string; count: number }) {
  return (
    <div className="mb-3 flex items-center gap-3 border-b pb-2">
      <NpcFace npc={npc} size="size-10" />
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-base font-semibold text-foreground">{npc}</h3>
        <p className="text-[11px] text-muted-foreground">
          {town} · {count} 筆
        </p>
      </div>
    </div>
  );
}

/**
 * Sort inside a section: priority, then authored order, then NPC.
 *
 * Tier order puts 必換 first because it is the one you act on, then 推薦, then
 * 一次性, then 視需求, then unranked. Unranked last because a row with no verdict is
 * not competing for your attention. The authored order is `curatedIndex`, the row's
 * position in barter.json; -1 means no curated entry, so those sort after the ranked
 * rows in their tier rather than first.
 */
const PRIORITY_RANK: Record<string, number> = { must: 0, extra: 1, once: 2, situational: 3 };

export function compareRows(a: ProtoItem, b: ProtoItem) {
  const pa = a.priority ? (PRIORITY_RANK[a.priority] ?? 4) : 4;
  const pb = b.priority ? (PRIORITY_RANK[b.priority] ?? 4) : 4;
  if (pa !== pb) return pa - pb;

  const ca = a.curatedIndex < 0 ? Number.MAX_SAFE_INTEGER : a.curatedIndex;
  const cb = b.curatedIndex < 0 ? Number.MAX_SAFE_INTEGER : b.curatedIndex;
  if (ca !== cb) return ca - cb;

  return a.npc.localeCompare(b.npc, "zh-Hant");
}

/**
 * The trades, sectioned by town or by merchant, with the merchant inside each tile.
 *
 * Section key: NPC when a town or NPC filter narrows the view, otherwise town. With
 * one town selected there is exactly one town heading, which says nothing, and the
 * useful grouping is the merchants inside it.
 *
 * Header and tile band are alternatives and never both: a multi-merchant section gets
 * a portrait header and its tiles carry no band, while the unsectioned-by-merchant
 * view has no header above it so every tile carries its own band. A single-section view
 * has no header, so its bands come back.
 */
export function TradeGrid({
  items,
  byNpc,
  splitKind,
  renderTile,
}: {
  items: ProtoItem[];
  byNpc?: boolean;
  splitKind?: boolean;
  renderTile: (item: ProtoItem, showBand: boolean) => React.ReactNode;
}) {
  const sorted = [...items].sort(compareRows);

  const keyed = new Map<string, ProtoItem[]>();
  for (const i of sorted) {
    const key = byNpc ? i.npc : i.town;
    const bucket = keyed.get(key);
    if (bucket) bucket.push(i);
    else keyed.set(key, [i]);
  }

  const single = keyed.size === 1;
  const showBandInGroup = !byNpc || single;

  const kindGroup = (rows: ProtoItem[]) => {
    const gold = rows.filter((r) => r.kind === "shop");
    const barter = rows.filter((r) => r.kind === "barter");
    // a section with only one kind gets no labels: there is nothing to tell apart, and
    // a lone 金幣 heading above a whole section is a heading that says nothing
    if (!splitKind || gold.length === 0 || barter.length === 0) {
      return <div className={GRID}>{rows.map((r) => renderTile(r, showBandInGroup))}</div>;
    }
    const groups: { label: string; rows: ProtoItem[] }[] = [
      { label: "金幣", rows: gold },
      { label: "以物易物", rows: barter },
    ];
    return (
      <div className="flex flex-col gap-3">
        {groups.map((g) => (
          <div key={g.label}>
            <h4 className="mb-1.5 flex items-baseline gap-1.5 text-[11px] font-semibold text-muted-foreground">
              <span>{g.label}</span>
              <span className="tabular-nums">{g.rows.length}</span>
            </h4>
            <div className={GRID}>{g.rows.map((r) => renderTile(r, showBandInGroup))}</div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-5">
      {[...keyed.entries()].map(([key, rows]) => (
        <section key={key}>
          {/* a single-section view has no header, so its tiles' bands carry the name */}
          {single ? null : byNpc ? (
            <NpcHeader npc={key} town={rows[0]?.town ?? ""} count={rows.length} />
          ) : (
            <h3 className="mb-2 flex items-baseline gap-1.5 text-xs font-semibold text-muted-foreground">
              <span>{key}</span>
              <span className="tabular-nums">{rows.length}</span>
            </h3>
          )}
          {kindGroup(rows)}
        </section>
      ))}
    </div>
  );
}

/** 4 columns on desktop, 3 at the sm breakpoint, 2 on phones. */
export const GRID = "grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4";
