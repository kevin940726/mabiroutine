// The visual language of a task row, as class strings.
//
// One source of truth for the chrome that every row-shaped thing shares: the
// card shell and the ticker box. TaskRow imports these, and so does anything else
// that wants to look like a row without being one — the grouped-pins parent, which
// is a container of trades rather than a trade.
//
// Why strings rather than a shared component: the parent's BODY is not a row's
// body (it summarizes N children instead of showing one trade), so a component
// would need a body slot that only one caller ever uses. Sharing the classes gets
// the same guarantee — a change here moves both — without inventing production
// surface for a single consumer.
//
// The failure this prevents is real and happened: a hand-copied shell drifted
// within one session, rendering the desktop tile size (h-14) inside the mobile
// row (whose tiles are h-11). Nothing here can drift, because there is only one
// copy.

/** The row card, mobile. Padding and radius are what the eye reads as "a row".
 *
 *  `min-h-[100px]` is a FLOOR, not a fixed height: mobile rows size to content and
 *  came out at 76 / 83 / 87 / 100 / 105 / 130 — six heights in one list, because a
 *  desc line or a badge line each add one. A spread that wide destabilises the
 *  sort strategy, which assumes comparable items, so drags near a boundary
 *  flickered. 100 is the value that absorbs the common cases (the title-only rows
 *  at 76-87 and the two-line rows at 100) and leaves the genuinely taller ones
 *  (a barter row at 105, the schedule row at 130) alone rather than padding every
 *  row to the worst case. */
export const ROW_SHELL_MOBILE = "rounded-lg border bg-card p-3 relative min-h-[100px] hover:bg-accent";

/** The row card, desktop. Taller and wider, with its own control order.
 *  Carries `flex` and the background: a caller that re-declares the display mode
 *  still gets the card's own look, which a stripped constant lost once already. */
export const ROW_SHELL_DESKTOP =
  "group relative flex items-center gap-3 rounded-lg border px-3 py-2.5 min-h-[88px] bg-card hover:bg-accent";

/** The right-hand column that owns the ticker, mobile. Declares `--tile`. */
export const TICKER_BOX_MOBILE = "w-11 shrink-0 self-stretch flex items-center justify-center [--tile:2.75rem]";

/** The same column, desktop. */
export const TICKER_BOX_DESKTOP = "flex items-center justify-center shrink-0 w-14 self-center [--tile:3.5rem]";

/** The ticker box a caller renders inside: fills whatever `--tile` is, so it can
 *  never come out the wrong size for the variant it landed in. */
export const TICKER_FILL = "h-[var(--tile)] w-[var(--tile)]";

/** Portrait sizes, per variant. Mobile keeps a small inline pfp on the title
 *  line; desktop puts a large one in the leading cluster. Sharing these keeps a
 *  group's pfp the same weight as the rows it sits among, which a bare `h-5 w-5`
 *  did not: the desktop group had no portrait at all. */
export const PFP_MOBILE = "h-5 w-5 shrink-0 rounded-full object-cover border border-border/50 bg-muted";
export const PFP_DESKTOP = "h-[50px] w-[50px] rounded-full object-cover shrink-0 border border-border/50 bg-muted";

/** Item-art sizes for the same two slots, WITHOUT a radius or a fill.
 *
 *  Separate from PFP_* because the two are different shapes: a face is a circle, an
 *  item icon is a rounded rectangle (`ItemIcon` owns its radius). Passing PFP_* into
 *  ItemIcon put `rounded-full` on the frame, and Tailwind's later class won, so the
 *  item came out a circle in the tracker while the grid showed a rounded square —
 *  the same dimensions, two shapes, from one shared string.
 *  20px mobile matches PFP_MOBILE; desktop uses 40px rather than PFP_DESKTOP's 50px
 *  because the art is a square whose corners are cut, so the same nominal box reads
 *  heavier than a circle does. */
export const ITEM_ART_MOBILE = "h-5 w-5 shrink-0";
export const ITEM_ART_DESKTOP = "h-10 w-10 shrink-0";
