# Item icons

Item art lives in `public/items/`, one file per item named after its Traditional
Chinese item name: `public/items/鹽.webp`. There is no manifest to update — the
filename is the lookup. 191 files today (128×128 WebP, transparency kept).

## Resolving a name to a path

Two modules own this, and nothing else should build an `/items/` URL by hand:

- `src/lib/itemIcon.ts` — `itemIconPath(name)` → `/items/<percent-encoded>.webp`,
  or `null` for an empty name. It also exports `stripQty`, because the tile and row
  strings carry the yield inline (`聖水 ×10`) and that suffix is in no filename.
- `src/components/shop/ItemIcon.tsx` — the component: a fixed frame, the art, a
  count on the frame's bottom-right, and a designed placeholder when art is absent.

### The trap: look up the RAW name

Use the name as the DATA spells it — half-width parens, `+` refinement kept — and
never a `displayName`-folded string.

`displayName` (`src/lib/materials.ts`) folds `(` to `（` for reading, and the files
keep the data's own spelling: `public/items/武器製作台設計圖(3級).webp`. Measured
over the 133 distinct names in `shops.json` plus the barter `get` lines:

| | count |
|---|---|
| match on the raw form only | **9** (every `(3級)` blueprint) |
| match on the folded form only | **0** |

So folding before the lookup loses all 9 and gains nothing. This is the same rule
`materials.ts` already states for the route table — fold at the render expression,
never a string about to be looked up. `PinnedGroups.tsx` keeps `itemName` (folded,
for the eye) and `itemArtName` (raw, for the filesystem) side by side for exactly
this reason.

## Missing art is a normal state

The set lags the data, so `ItemIcon` ALWAYS renders a frame and swaps only the
contents: the art, or a quiet dashed placeholder box. A tile with art and one
without must keep the same height, or the grid's row alignment breaks — the same
invariant that made a conditional verdict row pull two tiles up 23px once.

Nine names have no art today, and they are the ones to add first:

| name | why it has no file |
|---|---|
| `愛心幣`, `絕招秘藥`, `精靈的痕跡` | appear as `shops.json` item names |
| `高級羊毛`, `空白樂譜`, `染色劑基底` | appear only in barter give-lines |
| `木材加工設備設計圖(3級)`, `布料加工設備設計圖(3級)`, `防具製作台設計圖(3級)` | the three blueprints of the 9 that are missing |

There is no runtime existence check beyond the `<img>`'s own `onError`, which is
how `/npc/<name>.png` has always worked: the browser cannot know a file is absent
without requesting it, so the miss is discovered by the request failing (Vite's dev
server answers an unmatched path with `index.html` at **200**, so the failure is a
decode failure, not a 404 — `onError` still fires).

## Adding an icon

Drop `<TW name>.webp` into `public/items/` and rebuild. WebP, 128×128,
transparency kept; match the existing files. Nothing else to update.

## Licensing

These are third-party game artwork (© NEXON Korea) used under fan-content
convention. If the rights holder objects, they will be removed — do not
redistribute them outside this project. The designed placeholder is what every
surface degrades to, which is why it is a real state rather than an afterthought.
