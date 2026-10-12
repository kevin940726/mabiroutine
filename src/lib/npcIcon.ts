// NPC portrait: an NPC name → the public path of its portrait.
//
// The twin of `lib/itemIcon.ts`, and for the same reason: four surfaces ask the
// same question (the pinned rows, the shop grid, the material-breakdown faces,
// the merchant header) and the answer has a trap that must not be re-derived at
// each call site. It was re-derived, and one of the four drifted: the desktop
// pinned rows and the breakdown faces both hand-built the path, the WebP rename
// moved the file and the placeholder together, and the desktop rows' `onError`
// kept assigning the DELETED old placeholder — an unbounded retry that drained
// the account's edge requests and paused every project on 2026-10-12
// (`docs/item-icons.md` § The fallback rule).
//
// `NPC_PLACEHOLDER_SRC` exists so the fallback target is named in exactly one
// place too: the pair (the path builder, the fallback) is what has to move
// together, and a rename that moves one without the other is the failure mode.
// `pnpm test:fallbacks` asserts this literal resolves to a file on disk.
//
// The name is taken as the DATA spells it, exactly like item art. Trimming is
// the only normalization: `encodeURIComponent` keeps `(` and `)` literal and
// percent-encodes `+`, which is the spelling Vercel resolves (see
// `lib/itemIcon.ts` for the measurements).
export const NPC_PLACEHOLDER_SRC = "/npc/placeholder.webp";

export function npcIconPath(name: string): string {
  return `/npc/${encodeURIComponent(name.trim())}.webp`;
}
