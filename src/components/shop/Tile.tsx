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
//   3. The name band reserves two lines at 4 columns (`min-h-[2lh]`, gated on
//      the grid's container width) and on phones (`max-sm:`, viewport-gated).
//      Two rules meet here and they used to conflict: nothing should reserve
//      height it does not use, but the bands below must stay aligned across a
//      row. At four columns the longest real names wrap, and an unreserved name
//      pushed its tile's limit and cost 18px below its neighbours. `2lh`
//      rather than an em value because it tracks the leading, where an em
//      guess came up under a real second line. The phone reservation is the
//      same alignment for the same reason: at two ~158px columns even
//      medium names wrap, so a one-line tile sat its icon and cost a line
//      above its two-line neighbour. Between the two (sm to 4-column widths)
//      every name fits one line, so no height is reserved there. `max-sm:`
//      and `@min-[880px]` can never both match (a ≥880px container implies a
//      viewport above `sm`), so the two gates do not collide.
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

/** The tile's vertical rhythm: one value for every gap between rows.
 *
 *  4px on a phone, 8px from `sm`. The stack has five bands and therefore four gaps, so
 *  the tighter value takes 16px off every tile at once — measured across all 194 rows,
 *  which is a bigger saving than it sounds: the grid drops from 5139px to 4667px at
 *  360px on top of the town being hidden. The 8px value stays from `sm`, where there is
 *  room for the bands to breathe and the tile is not the scarce resource. */
const STACK = "flex flex-col gap-1 sm:gap-2";

/** The merchant band: portrait and the merchant's name as a FOOTER.
 *
 *  A footer rather than the old header so the item's own facts stay contiguous
 *  (name → icon → limit → verdict → cost) and the merchant closes the card. It
 *  draws its one rule on the TOP edge, since that is the side separating it from
 *  the item.
 *
 *  THE BAND NAMES NO TOWN AT ANY WIDTH, and that is what keeps the tile one
 *  uniform height everywhere. At two columns the band's text box is 90px at
 *  360px, and the common label `安黛莉 · 堤爾克那` needs 101px — the +11px
 *  overflow repeated across 46 of the 194 rows, which wrapped them to a second
 *  line and left the grid with ten distinct tile heights. The NPC name alone
 *  fits comfortably (`安黛莉` is 39px), so dropping the town takes the wraps to
 *  ZERO and the distinct heights from ten to six. Shrinking the font was
 *  measured as the alternative and does nothing once the town is gone, so the
 *  text keeps its 13px.
 *
 *  Nothing is lost: the town is on the section heading in the default view, on
 *  the selected-merchant header (portrait + MapPin line) in a single-merchant
 *  view, on each `NpcHeader` in a town-filtered view, and in the material
 *  popover's `npc · town` line. The merchant is still identified here — by
 *  name and by portrait — while the row stops paying 17px of height for a town
 *  that is already named above it. */
function MerchantBand({ item, onOpen }: { item: ShopRow; onOpen?: (npc: string, town: string) => void }) {
  const inner = (
    <>
      <NpcFace npc={item.npc} town={item.town} size="size-5" />
      <span className="min-w-0 truncate text-[13px] font-semibold leading-tight text-foreground">
        {item.npc}
      </span>
    </>
  );
  if (!onOpen) return <div className="flex items-center justify-center gap-1.5 border-t border-transparent pt-1.5 sm:border-border">{inner}</div>;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen(item.npc, item.town);
      }}
      aria-label={`開啟 ${item.npc} 的商店`}
      // `justify-center` because every other band in the tile is centred — the name, the
      // art, the limit and the cost — and the merchant band was the one thing starting at
      // the tile's left content edge, so the portrait and name sat hard left while the
      // rest of the tile read down a centre line. The button stays `flex` and therefore
      // full-width, so the tap target is unchanged and only the CONTENT moves; `-mx-1
      // px-1` still bleeds the hover tint a little past the rule.
      // `text-left` is dropped with it: it would have no effect on a single non-wrapping
      // span, and leaving it on a centred row is the kind of contradiction that reads as
      // a bug later.
      // The rule is hidden on a phone and the footer keeps the plain 4px stack gap. The
      // separator was tried as the thing to keep (see the +4px version of this line) and
      // it read worse: a hairline drawn across an already-tight seam calls attention to
      // the tightness instead of resolving it, and the gap it was protecting is 4px
      // whether the line is there or not. So on a phone the cost and the merchant are
      // separated by space alone, the same 4px every other band pair gets, and the
      // border returns from `sm` where there is room for it to read as a rule rather
      // than a pinch. Nothing else depends on it: it was decorative, never a hit area.
      className="-mx-1 flex items-center justify-center gap-1.5 rounded border-t border-transparent px-1 pt-1.5 transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:border-border"
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
    // The barter trade line does not wrap: `nowrap` keeps its `×N` on the name's line
    // rather than orphaning it onto a second one. The cost band is the one place on a
    // tile that reverses the "always wrap, never truncate" rule, because the two facts
    // it carries read wrong split across lines.
    //
    // What happens past the band's width is TRUNCATION, not an overhang: the tile root
    // carries `overflow-hidden` (see the tile's own class list), so a line longer than
    // the tile is cut at the tile's edge regardless of this div's `overflow-visible`.
    // That is the deliberate trade against folding the count onto its own line; a give
    // name much longer than 15 CJK characters will lose its tail.
    <div className="overflow-visible whitespace-nowrap">
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
  onOpenNpc?: (npc: string, town: string) => void;
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
      // Padding. Below `sm` the sides are equal at `pl-4 pr-4`: the 20px left gutter exists
      // to clear the 4px priority stripe, and the stripe is hidden there (see below), so a
      // phone was paying 4px of dead gutter on a dead edge. From `sm` the stripe is drawn
      // and the two sides are ASYMMETRIC on purpose: `pl-4.5` (18px) leaves 4px for the
      // stripe plus 14px of content gutter, and `pr-3.25` (13px) is smaller so the content
      // box grows by 5px over the old `pl-5 pr-4` (20 + 16). That width goes to the bands
      // that wrap — most visibly the barter trade line, which is the longest text on a tile
      // (`稀有鍊金術再燃燒催化劑 ×50`).
      // Both values are on the 4px spacing scale (`pl-4.5` is 18px, `pr-3.25` is 13px), so
      // they are real Tailwind steps rather than arbitrary ones. The verdict chip below
      // tracks `pl-4.5` so it still starts on the content line.
      className={cn(
        "relative flex flex-col overflow-hidden rounded-lg border bg-card pt-7 pr-4 pb-4 pl-4 transition-colors hover:bg-accent/40 sm:pr-3.25 sm:pl-4.5",
        // the landed-on tile: a ring, not a border colour, so the priority stripe on
        // the left edge and the pin's own state both stay readable underneath. The
        // transition is on the base class, so it fades both in and out.
        focused && "ring-2 ring-primary ring-offset-2 ring-offset-background"
      )}
    >
      {/* The stripe: HIDDEN below `sm`, because on a phone the chip below already names
          the tier in words and the stripe is the same fact in colour only. Measured: the
          two appear on exactly the same 39 tiles, so the stripe never marks something the
          chip does not, and on a 158px phone tile a 4px edge is a smaller share of the
          border than on desktop. The chip's WORD is the accessible carrier anyway — see
          the colour-blind note on `priorityEdge`, where the stripe's lightness difference
          exists to survive scanning without reading, which a phone's shorter rows make
          less necessary. From `sm` the stripe is unchanged. */}
      <span className={cn("absolute inset-y-0 left-0 hidden w-1 sm:block", priorityEdge(item.priority))} aria-hidden />
      {/* 28px of top padding is exactly the 24px button plus its 4px offset, so the pin
          keeps a band to itself and never meets the name */}
      <span className="absolute right-1 top-1">{button}</span>
      {/* The verdict, as a chip on the top-LEFT, aligned with the tile's own content.
          `left-4 sm:left-4.5` tracks the tile's own `pl-4 sm:pl-4.5` so the chip starts on the
          line the name and art below it share rather than outboard of them. It matches the
          padding at BOTH breakpoints deliberately: the two used to be a single value and a
          change to one would silently put the chip 4px off the content line it is supposed
          to sit on. (At `left-3` it hung 8px over the padding, and at `left-2` it read as
          stuck to the edge.)
          The stripe marks the same fact in colour; the chip's WORD carries it without
          colour vision — see the colour-blind note in CHANGELOG. */}
      {verdict && (
        <span
          className={cn(
            "absolute left-4 top-2.5 rounded px-1.5 py-px text-[10px] font-semibold leading-none ring-1 ring-inset sm:left-4.5",
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
            The TWO-LINE RESERVATION keeps the bands below it aligned: at 4 columns the
            longest real names (11-13 characters, 8 of 194 rows) wrap to a second line,
            which without a reservation pushes that tile's limit and cost below its
            row-mates by 18px.
            `2lh` (two line boxes) rather than an em guess: `leading-snug` is 1.375, so
            two lines of 13px text are 35.75px, and `lh` tracks that leading rather than
            drifting from it if the size changes.
            Gated on the grid's own container width, so it engages exactly when a tile
            becomes 4 columns, at any browser font size. The threshold is deliberately
            NOT the grid's 4-column threshold: two container-query utilities at one
            width collide and the grid's rule loses, so keep the two apart and check the
            built CSS after moving either. At 1-3 columns every name fits on one line,
            so the reservation would be empty height on 186 rows to fix 8 — except on
            phones, where `max-sm:` reserves unconditionally: at two ~158px columns
            even medium names wrap, so the same misalignment the 4-column gate fixes
            shows up between one-line and two-line neighbours. */}
        <p className="line-clamp-2 text-center text-[13px] font-semibold leading-snug text-muted-foreground max-sm:min-h-[2lh] @min-[880px]:min-h-[2lh]">{name}</p>

        {/* The art, and the tile's subject. `self-center` is required: as a flex
            column child the frame shrinks to its 72px and sits at the left content
            edge (measured 71px off the tile's centre line without it). The count
            rides the frame's bottom-right corner. */}
        <ItemIcon name={item.rawName} icon={item.icon} size="size-[72px]" className="self-center" badge={qty} />

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
            A cost band that grows changes only its own row's height, where a two-line
            NAME shifts the artifact below it and the icon is what the eye lands on. The
            rare wrapped cost line is absorbed by `GRID`'s `items-start`, which lets each
            tile keep its own height instead of stretching the one-line tiles beside it. */}
        <div className="text-center leading-tight">
          <Price item={item} onViewInShop={onViewInShop} />
        </div>

        {showMerchant && <MerchantBand item={item} onOpen={onOpenNpc} />}
      </div>
    </div>
  );
}
