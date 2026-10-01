// Item art: an item name → the public path of its icon.
//
// One function, because four surfaces ask the same question (the shop tile, the
// pinned group's child rows, the pinned gold rows, the material hover card) and
// the answer has a trap that must not be re-derived at each call site.
//
// THE TRAP: build the path from the RAW name, never a transformed one.
// `displayName` (materials.ts) rewrites the parens for reading, and the icon files on
// disk keep the data's own spelling: `public/items/武器製作台設計圖(3級).webp`. Measured
// over the distinct names in shops.json + barter.json get-lines, NINE names
// (every `(3級)` blueprint) matched on the raw form only and ZERO on the transformed
// form only — so transforming before the lookup silently lost all 9 and gained nothing.
//
// `displayName` now narrows `（` to `(` rather than widening the other way, which happens
// to make it a no-op on today's half-width data — but the rule is unchanged and NOT
// conditional on that: the lookup takes the name as the data spells it, because the
// files were named from the data and the display helper exists to reshape text for
// reading. `ShopRow.rawName` and `shopMeta.rawName` exist so no call site has to
// remember this. Same rule materials.ts states for the route table: transform at the
// render expression, never a string about to be looked up.
//
// EXISTENCE IS NOT CHECKED HERE. The set of icons is expected to lag the data (art is
// dropped in by hand), so "no art yet" is a normal state rather than an error. The name
// is turned into a URL and the `<img>` reports absence through `onError`, exactly as
// `/npc/<name>.png` has always worked (NpcFace.tsx:11-25) — there is no runtime manifest
// on either side, and the browser cannot stat a file before requesting it. Every caller
// therefore needs a DESIGNED fallback; see `ItemIcon`.

/** The public path for an item's icon.
 *
 *  Takes the name as the DATA spells it (half-width parens, any `+` refinement
 *  suffix) WITHOUT a quantity: the caller strips any ` ×N` first, because the
 *  tiles and rows carry the yield inline (`聖水 ×10`) and that suffix is not part
 *  of any filename. `stripQty` is exported so the rule is stated once rather than
 *  re-derived at each of the four call sites. */
export function stripQty(name: string): string {
  return name.replace(/ ×\d+$/, "");
}

export function itemIconPath(name: string | undefined | null): string | null {
  const trimmed = name ? stripQty(name).trim() : "";
  if (!trimmed) return null;
  // `encodeURIComponent` escapes `+` as `%2B`, which is correct for a QUERY
  // value but wrong for a PATH segment: the servers that resolve these files
  // (Vite dev included) do not decode `%2B` back to `+`, so an encoded plus
  // misses the file and the SPA fallback answers `index.html` at 200 with a
  // `text/html` content type. The `<img>` then fails to DECODE, `onError`
  // fires, and the icon renders as the placeholder — a silent miss, since the
  // request never 404s. A literal `+` is legal in a path (only its
  // query-string meaning is "space"), and that is how the five files are
  // spelled on disk: 布料+, 皮革+, 高級布料+, 高級木材+, 高級生皮+. So unescape
  // it again after encoding. `%2B` is the only sequence this produces for a
  // legal filename, and no name contains a literal `%`, so the substitution
  // cannot corrupt another character.
  return `/items/${encodeURIComponent(trimmed).replace(/%2B/g, "+")}.webp`;
}
