// The shop tile.
//
// Vertical stack, in the game's own reading order:
//   name → icon → limit → cost → merchant
// The first three are the game's (name, art, its 購入N/M limit). The merchant band
// and the verdict are this app's additions: the merchant closes the card, and the
// verdict is overlaid on the tile's top-LEFT corner rather than taking a band, since
// it is a judgement ABOUT the item and not one of its facts.
//
// The art is the SUBJECT: a 72px frame with the yield's count on its bottom-right
// corner, and the name as a muted 13px caption above it. That is inverted from the
// pre-icon cut, where the name was a 15px bold heading and the merchant's face was
// the only image — in the game's tile the art carries recognition and the name
// labels it, so the weight follows.
//
// Rules that hold it together:
//
//   1. One spacing scale, applied by the parent: `flex flex-col gap-2`. Every row used
//      to carry its own `mt-*`, which spread the rhythm across five class lists and
//      made it impossible to read or change in one place.
//   2. Nothing is bottom-pinned. An earlier cut used `mt-auto` on the price and
//      measured a 23.5px hole between the limit and the cost when a row was stretched
//      by a two-line neighbour: the price floated down and read as detached from its
//      own label.
//   3. The name band reserves two lines from `xl` (`min-h-[2lh]`). Two rules meet here
//      and they used to conflict: nothing should reserve height it does not use, but
//      the bands below must stay aligned across a row. At four columns the longest
//      real names wrap, and an unreserved name pushed its tile's limit and cost 18px
//      below its neighbours — measured. `2lh` rather than an em value because a first
//      attempt at `2.6em` was a hair under a real second line and left 2px.
//   4. The verdict takes NO band. It was a reserved row below the limit; it is now
//      absolutely positioned at the top-left, mirroring the pin at the top-right, so
//      the item's own bands run unbroken and the tile is shorter for it. It cannot
//      collide with the name (measured), because the name sits below the 28px band the
//      pin and verdict share.
//   5. Padding is 28px top, because the 24px pin plus its 4px offset needs a band the
//      name never reaches. 20px left clears the 4px priority stripe, 16px right and
//      bottom match each other.
import { cn } from "@/lib/utils";
import { parseItemQty } from "@/lib/materials";
import { NpcFace } from "./NpcFace";
import { ItemIcon } from "./ItemIcon";
import { Cost, TradeLine, limitOf, pinButton, priorityChip, priorityEdge, priorityText } from "./shared";
import type { ShopRow } from "./types";

/** The tile's vertical rhythm: one value for every gap between rows. */
const STACK = "flex flex-col gap-2";

/** The merchant band: portrait, name and town on one line, as a FOOTER.
 *
 *  A footer rather than the old header so the item's own facts stay contiguous
 *  (name → icon → limit → verdict → cost) and the merchant closes the card. It
 *  draws its one rule on the TOP edge, since that is the side separating it from
 *  the item. The two facts still share a line with a `·`: the earlier two-line
 *  version measured 40.3px of tile height for the same information. */
function MerchantBand({ item, onOpen }: { item: ShopRow; onOpen?: (npc: string) => void }) {
  const inner = (
    <>
      <NpcFace npc={item.npc} size="size-5" />
      <span className="min-w-0 truncate text-[13px] leading-tight">
        <span className="font-semibold text-foreground">{item.npc}</span>
        <span className="text-muted-foreground"> · {item.town}</span>
      </span>
    </>
  );
  if (!onOpen) return <div className="flex items-center gap-1.5 border-t pt-1.5">{inner}</div>;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen(item.npc);
      }}
      aria-label={`開啟 ${item.npc} 的商店`}
      className="-mx-1 flex items-center gap-1.5 rounded border-t px-1 pt-1.5 text-left transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {inner}
    </button>
  );
}

/** The cost band.
 *
 *  Gold is a bare coin amount; barter is the whole `你給 X → 你拿 Y` trade line,
 *  whose hover card is the tile's only way into the material breakdown. A barter row
 *  priced in 喵幣 or 愛心幣 is drawn as that coin's art by `TradeLine` (see there). */
function Price({ item, onViewInShop }: { item: ShopRow; onViewInShop?: (npc: string, giveName: string) => void }) {
  if (item.kind === "shop") {
    return (
      <span className="text-[14px] font-semibold tabular-nums text-foreground">
        <Cost currency={item.costCurrency} amount={item.costAmount} />
      </span>
    );
  }
  return (
    <div className="break-words">
      <TradeLine item={item} onViewInShop={onViewInShop} />
    </div>
  );
}

export function Tile({
  item,
  pinned,
  onTogglePin,
  showMerchant,
  onViewInShop,
  onOpenNpc,
  focused,
}: {
  item: ShopRow;
  pinned: Set<string>;
  onTogglePin: (id: string) => void;
  showMerchant: boolean;
  onViewInShop?: (npc: string, giveName: string) => void;
  onOpenNpc?: (npc: string) => void;
  focused: boolean;
}) {
  // the pin button carries its own state; destructuring only what the tile uses
  const { button } = pinButton(item, pinned, onTogglePin);
  const verdict = priorityText(item.priority);
  // The title carries the yield inline (`聖水 ×10`) and the tile wants the name and
  // the count apart, so split once with the shared parser (materials.ts:154, already
  // used by TradeLine).
  //
  // `name` is for the CAPTION and is NOT the icon key. It comes from `item.title`,
  // which `getText` already folded to full-width parens, so the icon must use
  // `item.rawName` instead — that field exists precisely because a path built from the
  // folded name misses every `設計圖(3級)` file (measured: nine rows asked for
  // `...%EF%BC%883%E7%B4%9A%EF%BC%89.webp` against a half-width `(3級)` on disk). The
  // count still comes from the title, since that is where the yield lives on both paths.
  const { name, qty } = parseItemQty(item.title);
  return (
    <div
      data-shop-tile
      // the scroll target for a jump: keyed by pinId, the same id the flash uses.
      // data-*, not an id: 194 tiles would flood the id namespace for a lookup that
      // is always a querySelector against a handful of rows.
      data-tile-key={item.pinId}
      // no pinned-specific styling: the pin button carries that state on its own. An
      // emerald border plus a bottom rule read as a second, louder signal for something
      // the filled pin already says, and the tile's edges were competing with the
      // priority stripe on the left.
      className={cn(
        "relative flex flex-col overflow-hidden rounded-lg border bg-card pt-7 pr-4 pb-4 pl-5 transition-colors hover:bg-accent/40",
        // the landed-on tile: a ring, not a border colour, so the priority stripe on
        // the left edge and the pin's own state both stay readable underneath. The
        // transition is on the base class, so it fades both in and out.
        focused && "ring-2 ring-primary ring-offset-2 ring-offset-background"
      )}
    >
      <span className={cn("absolute inset-y-0 left-0 w-1", priorityEdge(item.priority))} aria-hidden />
      {/* 28px of top padding is exactly the 24px button plus its 4px offset, so the pin
          keeps a band to itself and never meets the name */}
      <span className="absolute right-1 top-1">{button}</span>
      {/* The verdict, as a chip on the top-LEFT, aligned with the tile's own content.
          `left-5 top-2.5` are the spacing scale's 20px/10px — the same token the tile's
          `pl-5` uses, so the chip starts on the line the name and art below it share
          rather than outboard of them (at `left-3` it hung 8px over the padding, and at
          `left-2` it read as stuck to the edge).
          The stripe marks the same fact in colour; the chip's WORD carries it without
          colour vision — see the colour-blind note in CHANGELOG. */}
      {verdict && (
        <span
          className={cn(
            "absolute left-5 top-2.5 rounded px-1.5 py-px text-[10px] font-semibold leading-none ring-1 ring-inset",
            priorityChip(item.priority)
          )}
        >
          {verdict}
        </span>
      )}

      <div className={STACK}>
        {/* Block-level <p> rows rather than <span>s: these are lines of a description,
            not inline runs, so the block form gets the line boxes right with no extra
            wrappers.
            The TWO-LINE RESERVATION is what keeps the bands below it aligned: at 4
            columns a 169px tile wraps the longest real names (11-13 characters, 8 rows
            of 194) to a second line, which without a reservation pushes that tile's
            limit and cost below its row-mates — measured at 18px before this, and 2px
            when the reservation was set too low to cover a real second line.
            The value is `2lh` (two line boxes) rather than an em guess: `leading-snug`
            is 1.375, so two lines of 13px text are 35.75px while `2.6em` is 33.8px —
            a hair short, which is exactly the 2px that showed up. `lh` tracks the
            leading, so the reservation cannot drift from it if the size changes.
            Applied only from `xl`, where the fourth column starts: at 1-3 columns every
            name already fits on one line, so the reservation would be empty height on
            186 rows to fix 8. `break-words` is not needed — CJK wraps between
            characters with nothing to break. */}
        <p className="line-clamp-2 text-center text-[13px] font-semibold leading-snug text-muted-foreground xl:min-h-[2lh]">{name}</p>

        {/* The art, and the tile's subject. `self-center` is required: as a flex
            column child the frame shrinks to its 72px and sits at the left content
            edge (measured 71px off the tile's centre line without it). The count
            rides the frame's bottom-right corner. */}
        <ItemIcon name={item.rawName} size="size-[72px]" className="self-center" badge={qty} />

        <p className="flex items-center justify-center gap-1.5 text-[12px] leading-tight">
          <span className="text-muted-foreground">{limitOf(item)}</span>
          {item.scopeAccount && (
            // plain text, not a chip: `limitOf` strips the （伺服器） suffix that
            // limitText embeds, so this is the only place the scope is named on the
            // tile. 12px matches the limit it annotates, so the two read as one fact.
            <span className="shrink-0 text-[12px] font-medium text-sky-700 dark:text-sky-300">伺服器</span>
          )}
        </p>

        {/* Verdict removed from the flow — it is now the absolutely-positioned
            top-left mark below, so no band is reserved here any more. The band order
            is therefore name → icon → limit → cost → merchant, with the verdict
            overlaid on the tile's free top-left corner exactly as the pin is on its
            top-right. */}

        {/* Centring lives on the wrapper, not in Price, so a barter trade line keeps
            reading left to right as `你給 X → 你拿 Y`.
            NO HEIGHT RESERVATION HERE, deliberately — unlike the name band one line up.
            Four trade lines do wrap to a second line at 4 columns (`凱琳特製全麥麵包 ×10`,
            `格莉娜的蘋果奶茶 ×2`, `特蕾西的原木音樂盒 ×1`, `檸檬橄欖油義大利麵`), which makes
            those tiles 265px against 248px. The grid handles that instead: see `GRID`'s
            `items-start`, which is why the 20px of second-line air on the other 35 tiles is
            not worth reserving. Reserving it was tried and measured: it makes every row
            268px, but it buys that with 20px of empty band on 35 of 39 tiles to tidy 4, and
            the four wrapping rows are legible on their own — a second line of cost text is
            not what a scan is looking for. The name band reserves because a two-line NAME
            shifts the artifact below it and the icon is what the eye lands on; a two-line
            COST changes only its own row's height. */}
        <div className="text-center leading-tight">
          <Price item={item} onViewInShop={onViewInShop} />
        </div>

        {showMerchant && <MerchantBand item={item} onOpen={onOpenNpc} />}
      </div>
    </div>
  );
}
