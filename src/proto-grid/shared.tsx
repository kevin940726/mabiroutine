// PROTOTYPE (throwaway). Props and the small pieces the shop grid shares: the
// pin button, the priority colours, the 金幣 / 以物易物 sections.
//
// The tile itself lives in Tile.tsx. This file is deliberately only the things
// that are not the design question.
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
};

export type ProtoProps = {
  items: ProtoItem[];
  pinned: Set<string>;
  onTogglePin: (id: string) => void;
  /** NPC list order, so merchant blocks match the dropdown. */
  order: string[];
  /** false when the view already holds a single merchant, so a header per block
   *  would repeat one name down the whole page. */
  showHeader?: boolean;
};

/**
 * Priority reads once, on the two tiers worth acting on: the stripe down the left
 * edge of the tile, and the word above the limit. They share a colour so the stripe
 * stops being decoration — once you have seen 必換 against red a few times the edge
 * alone tells you, and the word is there the first time you meet it.
 *
 * 視需求, 一次性 and no-priority rows get the normal border, not a colour. Measured:
 * 94 rows have no priority, 53 are 視需求 and 8 are 一次性, so 155 of 194 (80%) were
 * carrying one of five stripe colours that said nothing. Decoding five colours to
 * find the two that matter is what made a grid of tiles read as noise. The colours
 * now mark 39 rows instead of 194.
 */
const PRIORITY = {
  must: { edge: "bg-red-500", text: "text-red-600 dark:text-red-400", label: "必換" },
  extra: { edge: "bg-amber-500", text: "text-amber-600 dark:text-amber-400", label: "推薦" },
  once: { edge: "bg-border", text: "text-sky-600 dark:text-sky-400", label: "一次性" },
  situational: { edge: "bg-border", text: "text-zinc-500 dark:text-zinc-400", label: "視需求" },
} as const;

/** Only 必換 and 推薦 render a word. 視需求 is the true default (53 rows) so naming
 *  it says nothing, and 一次性 reads as a warning but behaves like 推薦 for planning.
 *  Labels stay on the tiers that never render, so the map is total and a future
 *  caller can opt back in without re-deriving them. */
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
    isPinned,
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
 * the scope inside it. The tile renders scope separately as the 伺服器 badge, and
 * the parenthetical said the same thing a second time in the same line — the badge
 * sits directly beside the limit. Stripping here is display-only; the value the
 * tracker and the store see still has it.
 *
 * This mirrors MerchantPanel.tsx:252, which does the same strip for the production
 * row (and both should go away together if limitText ever stops embedding scope).
 */
export const limitOf = (i: ProtoItem) => (i.limitText ?? "不限次數").replace("（伺服器）", "");

/**
 * One flat grid of every row, no merchant sections and no 金幣 / 以物易物 split.
 *
 * This is variant B. Everything the reader needs to tell two similar rows apart
 * lives inside the tile instead (the merchant band), so the grid is a single run of
 * cards.
 *
 * No sorting happens here on purpose. `items` already arrives in the authored
 * order: `ALL_SHOP_ITEMS` in MerchantPanel sorts curated barter rows by
 * `curatedIndex` (their position in barter.json), then any remaining barter rows,
 * then the gold rows. Re-sorting would be a second, competing definition of the
 * same order.
 */
export function FlatGrid({
  items,
  columns,
  renderTile,
}: {
  items: ProtoItem[];
  columns: string;
  renderTile: (item: ProtoItem) => React.ReactNode;
}) {
  return <div className={`grid gap-2 ${columns}`}>{items.map(renderTile)}</div>;
}

/**
 * The trades, grouped into one block per merchant.
 *
 * This is the NPC view repeated for every NPC: a merchant header (portrait, name,
 * town, that merchant's row count) followed by their tiles, one block after
 * another. The 金幣 / 以物易物 split is kept but scoped to the merchant, so its
 * counts are that merchant's own rather than page totals.
 *
 * Two structures were measured against the data and only one survives: of the 37
 * merchants, 13 have both kinds and 24 have barter only. A merchant with a single
 * kind therefore gets no split labels at all — labelling a lone grid 以物易物 when
 * there is nothing to distinguish it from would be a heading that says nothing.
 * All 94 gold rows belong to just 13 merchants, so 金幣 only ever appears alongside
 * a 以物易物 sibling.
 *
 * `order` is the NPC list's own order, so scanning this matches scanning the
 * dropdown. Merchants absent from it (a pinned row from a merchant no longer
 * listed) fall to the end rather than being dropped.
 */
export function NpcBlocks({
  items,
  order,
  columns,
  renderTile,
  showHeader = true,
}: {
  items: ProtoItem[];
  order: string[];
  columns: string;
  renderTile: (item: ProtoItem) => React.ReactNode;
  showHeader?: boolean;
}) {
  const byNpc = new Map<string, ProtoItem[]>();
  for (const i of items) {
    const bucket = byNpc.get(i.npc);
    if (bucket) bucket.push(i);
    else byNpc.set(i.npc, [i]);
  }
  const rank = (npc: string) => {
    const i = order.indexOf(npc);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  const merchants = [...byNpc.entries()].sort((a, b) => rank(a[0]) - rank(b[0]));

  const group = (list: ProtoItem[], kind: ProtoItem["kind"]) => {
    const rows = list.filter((i) => i.kind === kind);
    if (rows.length === 0) return null;
    return (
      <div key={kind}>
        <h4 className="mb-1.5 flex items-baseline gap-1.5 text-[11px] font-semibold text-muted-foreground">
          <span>{kind === "shop" ? "金幣" : "以物易物"}</span>
          <span className="tabular-nums">{rows.length}</span>
        </h4>
        <div className={`grid gap-2 ${columns}`}>{rows.map(renderTile)}</div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      {merchants.map(([npc, rows]) => {
        const kinds = new Set(rows.map((r) => r.kind));
        const town = rows[0]?.town ?? "";
        return (
          <section key={npc}>
            {showHeader && (
              <div className="mb-3 flex items-center gap-3 border-b pb-2">
                <NpcFace npc={npc} size="size-10" />
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-base font-semibold text-foreground">{npc}</h3>
                  <p className="text-[11px] text-muted-foreground">
                    {town} · {rows.length} 筆
                  </p>
                </div>
              </div>
            )}
            <div className="flex flex-col gap-4">
              {kinds.size > 1 ? [group(rows, "shop"), group(rows, "barter")] : <div className={`grid gap-2 ${columns}`}>{rows.map(renderTile)}</div>}
            </div>
          </section>
        );
      })}
    </div>
  );
}
