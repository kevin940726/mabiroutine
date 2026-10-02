/* eslint-disable no-console */
// The item-icon path: exactly what `itemIconPath` emits for every name shape the
// data actually contains. Pure string test (no DOM, no store), run in the pnpm
// check gate like the other entry scripts.
//
// Why this exists: the encoding is a correctness detail with a SILENT failure
// mode in TWO directions, so it must not be left to a comment.
//
//   - The `+`: five item names end in `+` (布料+, 皮革+, 高級布料+, 高級木材+,
//     高級生皮+), and the URL must spell it `%2B`. Vercel 404s a literal `+`,
//     while Vite's dev static layer does the reverse and answers its SPA fallback
//     with HTML at 200, so a wrong spelling renders the placeholder with no
//     error in either environment. `vite.config.ts` has a dev-only middleware for
//     this; the assertions below are what keep the emitted spelling fixed.
//   - The parens: `encodeURIComponent` leaves `(` and `)` LITERAL (they are RFC
//     3986 sub-delims, like `+`, but unlike `+` they are not normalized away —
//     Vercel resolves `…設計圖(3級).webp` to the file, measured 2026-10-02). So
//     the eleven `(3級)` names must stay with literal parens: escaping them to
//     `%28`/`%29` is a DIFFERENT and unverified path against the real server, and
//     would be a fix for a bug that does not exist. Asserting the literal parens
//     is what stops someone "tidying" them into percent-escapes.
//
// The rule a failure here enforces: percent-encode the RAW data spelling
// (`stripQty` first, never a `displayName`-folded form — see docs/item-icons.md),
// and do not hand-rewrite the result.
import { itemIconPath, stripQty } from "@/lib/itemIcon";

let bad = 0;
const ok = (msg: string) => console.log(`ok: ${msg}`);
const fail = (msg: string) => {
  bad += 1;
  console.log(`FAIL: ${msg}`);
};
/** Assert the path for `name` is EXACTLY `expected` (not a substring match). */
const expectPath = (name: string, expected: string, msg: string) =>
  itemIconPath(name) === expected ? ok(msg) : fail(`${msg} — got ${JSON.stringify(itemIconPath(name))}, want ${JSON.stringify(expected)}`);

// --- the `+` refinement suffix -------------------------------------------------
// The regression this gate is built around: the path must carry `%2B`, and the
// five files keep a literal `+` on disk (only the URL is encoded).
expectPath("皮革+", "/items/%E7%9A%AE%E9%9D%A9%2B.webp", "a `+` name is `%2B` in the URL, not a literal `+`");
expectPath("高級木材+", "/items/%E9%AB%98%E7%B4%9A%E6%9C%A8%E6%9D%90%2B.webp", "高級木材+ keeps its `%2B`");
expectPath("布料+", "/items/%E5%B8%83%E6%96%99%2B.webp", "布料+ keeps its `%2B`");
expectPath("高級生皮+", "/items/%E9%AB%98%E7%B4%9A%E7%94%9F%E7%9A%AE%2B.webp", "高級生皮+ keeps its `%2B`");
expectPath("高級布料+", "/items/%E9%AB%98%E7%B4%9A%E5%B8%83%E6%96%99%2B.webp", "高級布料+ keeps its `%2B`");
// Guard the exact mechanism, not just the output: `.replace(/%2B/g, "+")` would
// satisfy a naive check on the disk spelling, so assert the emitted string has no
// bare plus left in it.
const plus = itemIconPath("皮革+");
if (plus !== null && plus.includes("+")) {
  fail(`a raw path may not contain a bare '+': ${JSON.stringify(plus)}`);
} else {
  ok("the emitted `+` name path has no bare plus (it is `%2B`)");
}

// --- the other text the data carries: parens, spaces, slashes, non-ASCII ------
// Parens stay literal (Vercel resolves them; `%28` is unverified and untested).
expectPath(
  "武器製作台設計圖(3級)",
  "/items/%E6%AD%A6%E5%99%A8%E8%A3%BD%E4%BD%9C%E5%8F%B0%E8%A8%AD%E8%A8%88%E5%9C%96(3%E7%B4%9A).webp",
  "half-width `(3級)` parens stay literal, not `%28`/`%29`",
);
expectPath(
  "皮革加工設備設計圖(3級)",
  "/items/%E7%9A%AE%E9%9D%A9%E5%8A%A0%E5%B7%A5%E8%A8%AD%E5%82%99%E8%A8%AD%E8%A8%88%E5%9C%96(3%E7%B4%9A).webp",
  "皮革加工設備設計圖(3級) keeps literal parens",
);
// CJK is percent-encoded (UTF-8), the case every name shares.
expectPath("鹽", "/items/%E9%B9%BD.webp", "a pure-CJK name is percent-encoded");
// A space inside a name is not a filename character today, but must still encode
// as `%20` rather than be left raw if the data ever grows one.
expectPath("a b", "/items/a%20b.webp", "a space encodes to `%20`");
// A slash must NOT stay raw: it would change the URL structure (a path segment
// is a filename, not a route). `encodeURIComponent` handles this, unlike
// `encodeURI`, which is the naive choice this pins against.
expectPath("a/b", "/items/a%2Fb.webp", "a slash encodes to `%2F`, never a raw separator");
// `#` and `?` must be encoded too, or the name would truncate the URL.
expectPath("a#b", "/items/a%23b.webp", "a `#` encodes, so it cannot start a fragment");
expectPath("a?b", "/items/a%3Fb.webp", "a `?` encodes, so it cannot start a query");

// --- the shape rules around the encoding --------------------------------------
expectPath("聖水 ×10", "/items/%E8%81%96%E6%B0%B4.webp", "a trailing ` ×N` is stripped before encoding");
expectPath("  皮革+  ", "/items/%E7%9A%AE%E9%9D%A9%2B.webp", "surrounding whitespace is trimmed");
if (itemIconPath("") === null && itemIconPath("   ") === null && itemIconPath(undefined) === null && itemIconPath(null) === null) {
  ok("an empty, blank, undefined or null name yields null");
} else {
  fail("an empty, blank, undefined or null name must yield null");
}
expectPath("尚無圖示的項目", "/items/%E5%B0%9A%E7%84%A1%E5%9C%96%E7%A4%BA%E7%9A%84%E9%A0%85%E7%9B%AE.webp", "an item with no art still yields a path (the `<img>` decides existence)");
// stripQty is exported for the callers; assert it too so the rule is stated once.
if (stripQty("聖水 ×10") === "聖水" && stripQty("聖水") === "聖水" && stripQty("聖水 ×100") === "聖水") {
  ok("stripQty removes only a trailing ` ×N`");
} else {
  fail("stripQty must remove only a trailing ` ×N`");
}

console.log(bad === 0 ? "item icon paths: all pass" : `item icon paths: ${bad} FAILED`);
process.exit(bad === 0 ? 0 : 1);
