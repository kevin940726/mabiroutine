// PROTOTYPE (throwaway). The shop tile.
//
// One design, kept from the reviewed set: the tight density (dense=all), which was
// the shortest of the five variants measured and the only one with three full grid
// rows visible in a 1100px viewport.
//
// Vertical stack: merchant band, name, priority verdict, limit, price. Rules that hold
// it together:
//
//   1. One spacing scale, applied by the parent: `flex flex-col gap-2`. Every row used
//      to carry its own `mt-*`, which spread the rhythm across five class lists and
//      made it impossible to read or change in one place.
//   2. Nothing is bottom-pinned. An earlier cut used `mt-auto` on the price and
//      measured a 23.5px hole between the limit and the cost when a row was stretched
//      by a two-line neighbour: the price floated down and read as detached from its
//      own label.
//   3. Nothing reserves height it does not use. That same cut put `min-h-[2.1em]` on
//      the price, which resolves against the inherited 16px root rather than the 12px
//      text, so a one-line gold price silently held 33.6px.
//   4. The verdict row is drawn only where there is a verdict. It used to be reserved
//      on all 194 tiles to align the rows below it; at the tight density that 15px on
//      the 155 rows without a verdict was the single largest piece of empty space in
//      the tile, measured at 38% whitespace overall.
//   5. Padding is 28px top, because the 24px pin plus its 4px offset needs a band the
//      title never reaches. 20px left clears the 4px priority stripe, 16px right and
//      bottom match each other.
import { cn } from "@/lib/utils";
import { NpcFace } from "@/components/MerchantPanel";
import { TradeGrid, TradeLine, limitOf, pinButton, priorityEdge, priorityText, priorityTint, type ProtoItem, type ProtoProps } from "./shared";

/** The tile's vertical rhythm: one value for every gap between rows. */
const STACK = "flex flex-col gap-2";

/** The merchant band: portrait, name and town on one line.
 *
 *  At the tight density the name and town share a line with a `·` separator. The
 *  earlier two-line version measured 40.3px of the tile's height for the same two
 *  facts, and reading `安黛莉 · 堤爾克那` as a subtitle is what lets the trade name
 *  stay the dominant element. */
function MerchantBand({ item }: { item: ProtoItem }) {
  return (
    <div className="flex items-center gap-1.5 border-b pb-1.5">
      <NpcFace npc={item.npc} size="size-5" />
      <p className="min-w-0 truncate text-[13px] leading-tight">
        <span className="font-semibold text-foreground">{item.npc}</span>
        <span className="text-muted-foreground"> · {item.town}</span>
      </p>
    </div>
  );
}

/**
 * The price. Gold is a single coin value on one line.
 *
 * Barter is "name xN", with x1 dropped — that is 41 of the 100 barter rows, where a
 * trailing x1 is pure noise. Fixed 14px, no shrink, no clipping.
 *
 * The size is `text-[14px]`, not `text-sm`. `text-sm` is rem-based, so it resolves
 * against the ROOT font size and a reader with a larger browser default font saw it
 * render at 17.5px: measured, `text-sm` is 14px at root 16px and 17.5px at root 20px.
 * Hardcoding px pins it, which is also what pretext would need if this ever moves to
 * measured fit-to-width.
 *
 * HOUSE RULE: never truncate, always wrap. An earlier cut forced the name to one line,
 * which turned a 10-character material name into an ellipsis. A wrapped second line
 * costs height but hides nothing.
 *
 * The cost line is deliberately NOT height-reserved, so 麗莎's two longest names push
 * their own tile taller rather than being cut.
 *
 * Barter goes through TradeLine, which renders the whole trade line — the give with
 * a dotted underline and a popover when there is a recipe, and the get after an
 * arrow. The tile therefore carries no separate qty suffix: `give` already has the
 * ×N and MaterialHoverCard prints it, so a suffix here would print it twice and
 * would also resurrect the ×1 that was dropped on purpose (41 of 100 barter rows).
 *
 * Gold stays a bare number: a price is a price, and a purchase has no material chain
 * to trace.
 */
function Price({ item }: { item: ProtoItem }) {
  if (item.kind === "shop") {
    return (
      <span className="text-[14px] font-semibold tabular-nums text-foreground">
        {item.cost}
      </span>
    );
  }
  return (
    <div className="break-words">
      <TradeLine item={item} />
    </div>
  );
}

function Tile({ item, pinned, onTogglePin, showMerchant }: { item: ProtoItem; pinned: Set<string>; onTogglePin: (id: string) => void; showMerchant: boolean }) {
  // the pin button carries its own state; destructuring only what the tile uses
  const { button } = pinButton(item, pinned, onTogglePin);
  const verdict = priorityText(item.priority);
  return (
    <div
      data-proto-tile
      // no pinned-specific styling: the pin button carries that state on its own. An
      // emerald border plus a bottom rule read as a second, louder signal for something
      // the filled pin already says, and the tile's edges were competing with the
      // priority stripe on the left.
      className="relative flex flex-col overflow-hidden rounded-lg border bg-card pt-7 pr-4 pb-4 pl-5 transition-colors hover:bg-accent/40"
    >
      <span className={cn("absolute inset-y-0 left-0 w-1", priorityEdge(item.priority))} aria-hidden />
      {/* 28px of top padding is exactly the 24px button plus its 4px offset, so the pin
          keeps a band to itself and never meets the name */}
      <span className="absolute right-1 top-1">{button}</span>

      <div className={STACK}>
        {showMerchant && <MerchantBand item={item} />}

        {/* Block-level <p> rows rather than <span>s: these are lines of a description,
            not inline runs, so the block form gets the line boxes right with no extra
            wrappers. */}
        <p className="line-clamp-2 text-[15px] font-bold leading-snug text-foreground">{item.title}</p>

        {/* drawn only where there is a verdict: 必換 and 推薦 only (see priorityText) */}
        {verdict && (
          <p className={cn("text-[12px] font-semibold leading-tight", priorityTint(item.priority))}>{verdict}</p>
        )}

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
    </div>
  );
}

export function ProtoShop({ items, pinned, onTogglePin, splitKind, byNpc }: ProtoProps) {
  return (
    <TradeGrid
      items={items}
      byNpc={byNpc}
      splitKind={splitKind}
      renderTile={(item, showBand) => (
        <Tile
          key={item.key}
          item={item}
          pinned={pinned}
          onTogglePin={onTogglePin}
          showMerchant={showBand}
        />
      )}
    />
  );
}
