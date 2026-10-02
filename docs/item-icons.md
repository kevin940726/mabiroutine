# Item icons

Item art lives in `public/items/`, one file per item named after its Traditional
Chinese item name: `public/items/鹽.webp`. There is no manifest to update — the
filename is the lookup. 182 files today (128×128 WebP, transparency kept).

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
over the 181 distinct names in `shops.json` plus the barter `give` and `get` lines:

| | count |
|---|---|
| match on the raw form only | **9** (every `(3級)` blueprint) |
| match on the folded form only | **0** |

So folding before the lookup loses all 9 and gains nothing. This is the same rule
`materials.ts` already states for the route table — fold at the render expression,
never a string about to be looked up. `PinnedGroups.tsx` keeps `itemName` (folded,
for the eye) and `itemArtName` (raw, for the filesystem) side by side for exactly
this reason.

Two places had broken this and were fixed by carrying the raw spelling alongside the
display one, rather than by remembering not to fold:

- `ShopRow.rawName` — the tile's title is `getText(deal)`, already folded, and the
  icon was built from it. Nine rows (`皮革加工設備設計圖(3級)` and friends) asked for
  `…%EF%BC%883%E7%B4%9A%EF%BC%89.webp` against a half-width file on disk. `rawName` is
  `deal.name`, the data's spelling.
- `shopMeta.rawName` — the same trap for a pinned row, whose `Task.name` is also
  `getText`. `itemArtName` prefers `shopMeta.rawName` and falls back to `t.name` so a
  save written before the field existed still renders.

### The second trap: encode the `+`, fix the dev server instead

`itemIconPath` percent-encodes the name, and `encodeURIComponent` escapes `+` as
`%2B`. That is the form the URL must carry, and production is the authority: Vercel
resolves `%2B` to `public/items/皮革+.webp`, while a literal `+` in the path is
normalized to a space and 404s (measured against the PR preview, 2026-10-02). Five
names carry one — `布料+`, `皮革+`, `高級布料+`, `高級木材+`, `高級生皮+` — and all
five go out as `%2B`.

The parens are the opposite case, and the reason this section is worth reading
twice. `(` and `)` are RFC 3986 sub-delims like `+`, but unlike `+` the servers
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

**Every name the app looks up now has art**, so the placeholder is a state the
current data no longer reaches. It stays as the designed fallback for the next
name a data update adds before its file lands, which is why the frame is sized
unconditionally above.

Counted over the names themselves: `items[].name` in `shops.json` (126 distinct)
plus `give` / `get` in `barter.json` with the ` ×N` suffix stripped as
`parseItemQty` does (81 + 89). Union 181 names, 181 covered. There is one spare
file beyond that union, so the directory holds 182.

This section used to list sixteen names as missing. That list went stale in two
steps — 26 icons landed in one batch, then the remainder arrived — and the count
below the line is now zero rather than fourteen. The history is worth keeping
because the two facts it shows are still live: only names in `shops.json` reach a
tile, and a name inside barter deal text renders as plain text, so a gap there has
no visible placeholder until a trade line gains art.

The three `(3級)` blueprints were the leftover end of the raw-name trap above: the
data spells them with half-width parens like the nine that DO have files, so they
were simply absent rather than mismatched. They have files now.

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
