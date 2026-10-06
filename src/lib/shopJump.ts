/** The tracker jump's URL convention: the merchant (plus its town, so same-name
 *  NPCs in different towns land exactly), plus the exact row for a single pin,
 *  plus `from=tracker` marking the origin. Two writers share it —
 *  MerchantPanel's in-app jump and App's cold-start fallback (shop chunk not
 *  yet loaded) — and the panel's one-shot landing honors all three on mount:
 *  `from` is what arms the way back (see below), so a copied link keeps it.
 *  Lives here rather than in either component so neither chunk pays for the
 *  other: App must stay light (MerchantPanel is lazy), and the panel must not
 *  import App. */
export function writeShopJumpParams(npc: string, town: string | undefined, pinIds: string[]) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("npc", npc);
  if (town) url.searchParams.set("town", town);
  else url.searchParams.delete("town");
  if (pinIds.length === 1) url.searchParams.set("item", pinIds[0]);
  else url.searchParams.delete("item");
  url.searchParams.set("from", "tracker");
  window.history.replaceState(null, "", url.toString());
}
