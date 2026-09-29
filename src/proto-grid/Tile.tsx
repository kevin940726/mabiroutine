// PROTOTYPE (throwaway). The shop tile — the only design left, now that A/D/E/F
// are dropped.
//
// Vertical stack: the pin alone in its own band, then the name, then the priority
// verdict, then the limit, then the price. Rules that hold it together:
//
//   1. One spacing scale, applied by the parent: `flex flex-col gap-2`. Every row
//      used to carry its own `mt-*`, which spread the rhythm across five class
//      lists and made it impossible to read or change in one place. The tile owns
//      the gap now; the rows carry none.
//   2. The name always reserves two lines, whether or not it uses them. The
//      alternative — reserving one and letting long names grow — was measured at
//      118 / 125 / 138px rows on the same grid, so a row holding a 13-character
//      name sat 10 to 30px taller and its neighbours floated off the baseline. The
//      empty line is the price of every tile agreeing on where its rows start.
//   3. The priority verdict is a reserved row, not a conditional one. Only two
//      tiers ever render a word (see priorityText), but the row is always present,
//      so the limit and price below it sit at the same y on every tile. Same
//      reasoning as rule 2 applied to a second row: dropping the row entirely when
//      a tile has no verdict would un-align the tiles without one against the ones
//      that have one.
//   4. Nothing is bottom-pinned. An earlier cut used `mt-auto` on the price and
//      measured a 23.5px hole between the limit and the cost when a row was
//      stretched by a two-line neighbour — the price floated down and read as
//      detached from its own label.
//   5. Nothing reserves height it does not use. The same cut put `min-h-[2.1em]`
//      on the price, which resolves against the inherited 16px root rather than the
//      12px text, so a one-line gold price silently held 33.6px.
//   6. Padding: 28px top, because the 24px pin plus its 4px offset needs a band the
//      title never reaches. 20px left clears the 4px priority stripe with room to
//      spare, and 16px right and bottom match each other so the last row has the
//      same breathing room as the sides.
//
// VARIANT B adds a merchant band above the trade content, so a flat grid of all
// 194 rows still says who each row belongs to. The band is a separate row rather
// than part of the limit line: measured, the limit line is already 91.5px of a
// 144px content box (每週 30 次 is 55.5px plus 伺服器 at 36px), and an NPC name runs
// up to 44px, so sharing that line would overflow. The band costs height instead of
// width, which matters because the longest material name already wraps.
import { cn } from "@/lib/utils";
import { parseItemQty } from "@/lib/materials";
import { NpcFace } from "@/components/MerchantPanel";
import { NpcBlocks, FlatGrid, limitOf, pinButton, priorityEdge, priorityText, priorityTint, type ProtoItem, type ProtoProps } from "./shared";

export const COLUMNS = "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4";

/** The tile's vertical rhythm: one value for every gap between rows. */
const STACK = "flex flex-col gap-2";

/**
 * The price. Gold is a single coin value on one line.
 *
 * Barter is "name xN", with x1 dropped — that is 41 of the 100 barter rows, where
 * a trailing x1 is pure noise. Fixed 14px, no shrink, no clipping.
 *
 * The size is `text-[14px]`, not `text-sm`. `text-sm` is rem-based, so it resolves
 * against the ROOT font size and a reader with a larger browser default font saw it
 * render at 17.5px: measured, `text-sm` is 14px at root 16px and 17.5px at root
 * 20px. Hardcoding px pins it, which is also what pretext would need if this ever
 * moves to measured fit-to-width.
 *
 * HOUSE RULE: never truncate, always wrap. An earlier cut forced the name to one
 * line, which turned a 10-character material name into an ellipsis. A wrapped
 * second line costs height but hides nothing.
 *
 * The cost line is deliberately NOT height-reserved: reserving two lines would put
 * every barter tile back to a fixed taller height for the sake of a handful of rows.
 * Cost is the lowest-priority content on the tile, so a wrapped cost pushes that one
 * card taller rather than being cut.
 */
function Price({ item }: { item: ProtoItem }) {
  if (item.kind === "shop") {
    return <span className="text-[14px] font-semibold tabular-nums text-foreground">{item.cost}</span>;
  }
  return <BarterPrice item={item} />;
}

function BarterPrice({ item }: { item: ProtoItem }) {
  const { name, qty } = parseItemQty(item.give);
  return (
    <div className="text-[14px] leading-tight break-words">
      <span className="font-semibold text-foreground">{name}</span>
      {qty > 1 && <span className="ml-1 text-[11px] whitespace-nowrap tabular-nums text-muted-foreground">×{qty}</span>}
    </div>
  );
}

/** The merchant band. Only variant B uses it: variant A groups tiles under a
 *  merchant header instead, so repeating the name inside every tile there would say
 *  the same thing twice.
 *
 *  Name and portrait are 14px / size-7, up from 11px / size-5. At the smaller size
 *  the band read as a footnote to the tile rather than as the thing that tells two
 *  similar rows apart, which is the band's whole job in a flat grid. The town is a
 *  separate muted line: 地下城、狩獵場 alone measures 77px, so putting it beside the
 *  name would leave the name 60px of the 140px content box and truncate the longer
 *  NPC names. */
function MerchantBand({ item }: { item: ProtoItem }) {
  return (
    <div className="flex items-center gap-2 border-b pb-2">
      <NpcFace npc={item.npc} size="size-7" />
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate text-[14px] font-semibold text-foreground">{item.npc}</p>
        <p className="truncate text-[11px] text-muted-foreground">{item.town}</p>
      </div>
    </div>
  );
}

function Tile({
  item,
  pinned,
  onTogglePin,
  showMerchant,
}: {
  item: ProtoItem;
  pinned: Set<string>;
  onTogglePin: (id: string) => void;
  showMerchant: boolean;
}) {
  const { button, isPinned } = pinButton(item, pinned, onTogglePin);
  const verdict = priorityText(item.priority);
  return (
    <div
      data-proto-tile
      className={cn(
        "relative flex flex-col overflow-hidden rounded-lg border bg-card pt-7 pr-4 pb-4 pl-5 transition-colors hover:bg-accent/40",
        // a pinned card is legible at a glance across the grid, not only from its
        // own button; the emerald rule along the bottom does the rest
        isPinned && "border-emerald-500/60"
      )}
    >
      <span className={cn("absolute inset-y-0 left-0 w-1", priorityEdge(item.priority))} aria-hidden />
      {/* 28px of top padding is exactly the 24px button plus its 4px offset, so the
          pin keeps a band to itself and never meets the name */}
      <span className="absolute right-1 top-1">{button}</span>

      <div className={STACK}>
        {showMerchant && <MerchantBand item={item} />}

        {/* Block-level <p> rows rather than <span>s: these are lines of a
            description, not inline runs, so the block form gets the line boxes
            right with no extra wrappers. */}
        <p className="line-clamp-2 min-h-[2.7em] text-[15px] font-bold leading-snug text-foreground">{item.title}</p>

        {/* always in the tree, so the rows below it sit at the same y whether or not
            this tile has a verdict (rule 3). `invisible` keeps its box.
            12px rather than 11px: at 11px the word was fainter than the stripe that
            shares its meaning, so the tile read as "coloured edge plus a small
            smudge" instead of as the verdict. 12px matches the limit line below it,
            which stops it looking like a stray annotation. */}
        <p
          className={cn(
            "min-h-[1.2em] text-[12px] font-semibold leading-tight",
            verdict ? priorityTint(item.priority) : "invisible"
          )}
        >
          {verdict ?? "無"}
        </p>

        <p className="flex items-center gap-1.5 text-[12px] leading-tight">
          <span className="text-muted-foreground">{limitOf(item)}</span>
          {item.scopeAccount && (
            // plain text, not a chip: `limitOf` strips the （伺服器） suffix that
            // limitText embeds, so this is the only place the scope is named on the
            // tile. 12px matches the limit it annotates, so the two read as one fact.
            <span className="shrink-0 text-[12px] font-medium text-sky-700 dark:text-sky-300">伺服器</span>
          )}
        </p>

        <div className="leading-tight">
          <Price item={item} />
        </div>
      </div>

      {isPinned && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-emerald-500" aria-hidden />}
    </div>
  );
}

export function ProtoShop({ items, pinned, onTogglePin, order, showHeader }: ProtoProps) {
  return (
    <NpcBlocks
      items={items}
      order={order}
      columns={COLUMNS}
      showHeader={showHeader}
      renderTile={(item) => (
        <Tile key={item.key} item={item} pinned={pinned} onTogglePin={onTogglePin} showMerchant={false} />
      )}
    />
  );
}

/** Variant B: the same tiles, one flat grid, merchant identity inside each tile. */
export function ProtoFlat({ items, pinned, onTogglePin }: ProtoProps) {
  return (
    <FlatGrid
      items={items}
      columns={COLUMNS}
      renderTile={(item) => (
        <Tile key={item.key} item={item} pinned={pinned} onTogglePin={onTogglePin} showMerchant />
      )}
    />
  );
}
