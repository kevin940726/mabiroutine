# Item icons

Item art lives in `public/items/`, one file per item named after its Traditional
Chinese item name: `public/items/鹽.webp`. There is no manifest to update — the
filename is the lookup. The art is 128×128 WebP with transparency kept.

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

`displayName` (`src/lib/materials.ts`) narrows full-width `（` to `(` for reading, and the files
keep the data's own spelling: `public/items/武器製作台設計圖(3級).webp`. The rule
holds for every distinct name the app looks up (`items[].name` with each row's
`icon` override substituted, plus the barter `give` and `get` lines):

| | result |
|---|---|
| match on the raw form only | every `(3級)` blueprint |
| match on the folded form only | none |

So folding before the lookup loses every blueprint match and gains nothing. This is the same rule
`materials.ts` already states for the route table — fold at the render expression,
never a string about to be looked up. `PinnedGroups.tsx` keeps `itemName` (folded,
for the eye) and `itemArtName` (raw, for the filesystem) side by side for exactly
this reason.

Two places had broken this and were fixed by carrying the raw spelling alongside the
display one, rather than by remembering not to fold:

- `ShopRow.rawName` — the tile's title is `getText(deal)`, already folded, and the
  icon was built from it. The `(3級)` blueprint rows (`皮革加工設備設計圖(3級)` and friends) asked for
  `…%EF%BC%883%E7%B4%9A%EF%BC%89.webp` against a half-width file on disk. `rawName` is
  `deal.name`, the data's spelling.
- `shopMeta.rawName` — the same trap for a pinned row, whose `Task.name` is also
  `getText`. `itemArtName` prefers `shopMeta.rawName` and falls back to `t.name` so a
  save written before the field existed still renders.

### The second trap: encode the `+`, fix the dev server instead

`itemIconPath` percent-encodes the name, and `encodeURIComponent` escapes `+` as
`%2B`. That is the form the URL must carry, and production is the authority: Vercel
resolves `%2B` to `public/items/皮革+.webp`, and a literal `+` in the path does not
resolve (404; measured against the deployed preview, 2026-10-02, along with `%20`,
which also 404s). The
names that carry one — `布料+`, `皮革+`, `高級布料+`, `高級木材+`, `高級生皮+` — all
go out as `%2B`.

The parens are the opposite case. `(` and `)` are RFC 3986 sub-delims like `+`, but
unlike `+` the servers
`+` was measured against do resolve them: Vercel serves `…設計圖(3級).webp` to the
file (measured 2026-10-02), so the builder leaves them literal. Escaping them to
`%28`/`%29` would be a different, unverified path, and `pnpm test:icons` pins the
literal form rather than "tidying" it.

Vite's DEV static layer is the outlier, not the reference: it leaves `%2B` encoded,
so the path misses and the SPA fallback answers `index.html` at **200** with a
`text/html` content type. That is the trap `vite.config.ts` handles, with a dev-only
middleware that rewrites `%2B` back to `+` before the static middleware. App code
stays server-agnostic and the files keep their literal `+` on disk; only the URL
spelling is encoded.

Both traps share the failure mode worth remembering on this page: **the miss is
silent.** There is no manifest, so a wrong name is discovered only by the request
failing, and the two environments fail differently — Vite's dev server returns the
app's own HTML at 200, production 404s. Either way the browser learns it from the
`<img>`, not from a check the app can run.

## Art coverage

The set lags the data, so `ItemIcon` ALWAYS renders a frame and swaps only the
contents: the art, or a quiet dashed placeholder box. A tile with art and one
without must keep the same height, or the grid's row alignment breaks — the same
invariant that made a conditional verdict row pull two tiles up 23px once. The grid
does not hide a violation: it lays its tiles out with `items-start`, so a tile is its
own content height and a conditional frame would simply make that tile shorter instead
of being stretched to look right. The fixed frame is what keeps the heights equal.

**Every name the app looks up has art**: 蜂蠟 and 砂紙 joined `shops.json` on
2026-10-21 and their files landed the same day, straight from the catalog source.
The placeholder stays as the designed fallback for the next name a data update
adds before its file lands, which is why the frame is sized unconditionally above.

Counted over the names themselves: `items[].name` is fewer names than rows once an
option's `icon` override collapses rows onto a shared file (the quest-board scrolls
all use `任務卷軸`), and the barter legs add their `barter.give` / `barter.get`
names with the ` ×N` suffix stripped as `parseItemQty` does. Every name in that
union is covered; the directory also holds spare art, so its file count is larger
than the name count.

One spare file is not an item name at all: `public/items/金幣.webp` is the
coin a gold PRICE is drawn with (`Cost` in `src/components/shop/Cost.tsx`). It lives
here because that is where the currency art does — 喵幣 and 愛心幣 are looked up by
their own names, while gold's currency token is `gold`, so its file is the single
lookup `Cost` maps by hand. Named after the coin (金幣) rather than the token so the
currency files read as one set.

Two coverage facts matter: only names in `shops.json` reach a tile, and
a name inside barter deal text renders as plain text, so a gap there has no visible
placeholder until a trade line gains art.

The three `(3級)` blueprints were the leftover end of the raw-name trap above: the
data spells them with half-width parens like the nine that DO have files, so they
were simply absent rather than mismatched. They have files now.

There is no runtime existence check beyond the `<img>`'s own `onError`, which is
how `/npc/<name>.webp` has always worked: the browser cannot know a file is absent
without requesting it, so the miss is discovered by the request failing (Vite's dev
server answers an unmatched path with `index.html` at **200**, so the failure is a
decode failure, not a 404 — `onError` still fires).

## The fallback rule

An art load that fails must be TERMINAL: render the designed fallback from
component state, never assign `src`. `ArtImg` (`src/components/ArtImg.tsx`) is
the shared shape (a failure latch keyed by `src`, and the fallback render
carries no handler at all); `NpcFace` and `ItemIcon` are the same idea
specialised to their own frames.

This is not a style preference. An `onError` that assigns `src` re-runs the
load when the fallback target is missing too, and that second failure re-enters
the same handler, so the pair loops for as long as the tab is open and the
network answers. Measured in Chromium on 2026-10-12 with the edge's RTT
simulated: 161 loads in 10s at 50ms and 64 in 10s at 150ms, from ONE `<img>`,
with no cap and nothing louder than the 404s in the console.

It cost the team its whole quota once. The WebP rename above deleted
`/npc/placeholder.png`, the exact URL `TaskRow`'s desktop portraits assigned
from `onError`; one image across the 13.5 hours between that deploy and the
pause is 300k-800k requests, and the Hobby plan's Edge Requests cap is 1M/month,
after which every project on the team is paused. `MaterialBreakdown` survived
only because it happened to guard the assignment. `TaskRow` did not, and the
guard is the kind of detail that drifts when the URL either side of it changes.

Two consequences for anything that touches art:

- **The fallback target must ship in the same deploy as the code that names
  it.** `public/npc/placeholder.png` stays as a compat shim for pre-rename
  clients; `/npc/placeholder.webp` is the one current code uses.
- **Renaming an art path poisons clients that are already rendered.** Keep the
  old path resolvable (a shim, or a redirect) instead of assuming every client
  reloads: the Service Worker hands an open tab new caches WITHOUT reloading
  it, so old code keeps running against the new tree.

Two more, about how the path itself is built:

- **One builder, one placeholder.** `src/lib/npcIcon.ts` owns `npcIconPath()`
  and `NPC_PLACEHOLDER_SRC`, the way `lib/itemIcon.ts` owns the item side and
  for the same reason. Four call sites used to hand-build `/npc/<name>.webp`,
  and that is how one of them kept naming the old placeholder after the rename.
- **A latched failure belongs to the URL, not the component.** `ArtImg` keys
  its latch by `src` so a reused element (the breakdown hover card renders one
  per trigger) still tries a healthy portrait, while the URL that failed is
  never retried.

`pnpm test:fallbacks` is the gate: it fails on ANY `src` assignment under
`src/`, `api/` or `workers/`, on an NPC `shops.json` names without a portrait,
on a hardcoded `/npc/` or `/items/` filename with no file, and on a missing (or
untracked) `placeholder.png` shim. The operational half of that incident, how it
was diagnosed from the provider's own metrics and the order to respond in, is
`docs/operations.md` §10.

### Caching: why art is not revalidated on every render

Vercel's default for a non-hashed static file is `public, max-age=0,
must-revalidate`, so the BROWSER revalidates every render at the edge, and an
edge request is counted whether it answers 200 or 304. With this app's traffic
(roughly 10k pageviews a month, a few dozen art files per view) that default
alone walks the account toward the 1M cap. `vercel.json` therefore sets
`Cache-Control: public, max-age=86400, stale-while-revalidate=604800` on
`/items/` and `/npc/`: art is a new URL when it is added, so it appears at once,
and an in-place correction lands within a day.

Art is deliberately NOT in the Service Worker precache (`webp` is outside
`globPatterns`, and the shim is in `globIgnores`): precaching would make every
deploy refetch the whole set, which is the same quota spend from the other
direction. `/npc/` has a StaleWhileRevalidate runtime route; `/items/` rides the
HTTP cache.

## Adding an icon

Drop `<TW name>.webp` into `public/items/` and rebuild. WebP, 128×128,
transparency kept; match the existing files. Nothing else to update.

When a name has no clean source at all, capture it in-game and turn that capture
into the file: `python scripts/clean-item-icon.py <capture.png>` writes
`public/items/<capture name>.webp`, stripping the rarity glow/backdrop behind the
item and the stack count printed over its corner, then feathering and scaling to
128. Name the capture after the item, since its filename is the lookup. It is
optional dev tooling like `scripts/crop-npc.py` — not part of the build or any
gate — and needs Pillow, numpy, scipy and opencv-python. `--out` overrides the
destination, and `--number-x/--number-y` move the count's search box if a capture
places it elsewhere: the gold coin's capture prints its amount (`476.5萬`) across
the bottom CENTRE, not the lower right, so it needed `--number-x 0.05` — the
default `0.34` left the leading digits behind.

A count that covers the item's whole lower arc also needs the script's ROUND path
(see its docstring). The default repair closes the bite the count left with the
item's convex hull; that hull is a straight chord when the count spans the item, so
a coin came out flat and ragged. If the outline the count did not touch is a circle
to sub-pixel accuracy, the script uses that circle as the silhouette and paints the
count's area from the item's own colours. The guard is strict — a tight fit AND the
circle must enclose the item — so the hexagonal token captures (喵幣, 愛心幣,
魔物討伐證明) stay on the hull path, and `--no-round` opts out.

An image model can also be used to repair a capture instead of masking it: hand it
the capture plus an edit instruction ("erase the amount, rebuild the coin's hidden
bottom edge"), and it returns a clean coin with the count gone. Two conditions make
that output drop straight into the script — the background must be TRANSPARENT or a
flat dark one (the script's backdrop rule strips exactly those; a mid-grey or
coloured backdrop would survive as part of the item), and the coin must not be
cropped at the edges. The script then does the flatten, crop, feather and 128px
WebP as usual. `金幣.webp` came this way.

Shared art is a data fact, not a lookup rule: an option whose art lives under
another name carries `"icon": "<that name>"` (resolved through `itemIconPath`,
so encoding stays centralized). Every 卷軸 row points at 任務卷軸 rather than
duplicating the paper file per name, and `pnpm test:shops` fails a scroll
without one plus an `icon` whose file is missing.

## Licensing

These are third-party game artwork (© NEXON Korea) used under fan-content
convention. If the rights holder objects, they will be removed — do not
redistribute them outside this project. The designed placeholder is what every
surface degrades to, which is why it is a real state rather than an afterthought.
