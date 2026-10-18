import { displayName } from "@/lib/materials";
import { ItemIcon } from "./ItemIcon";

const CURRENCY_ART: Record<string, string> = {
  gold: "金幣",
  喵幣: "喵幣",
  愛心幣: "愛心幣",
  魔物討伐證明: "魔物討伐證明",
};

/** A price, as the shop shows it.
 *
 *  The `×` is dropped for the icon form. Gold never had one, and once the currency is a
 *  picture the count reads as the amount rather than as a multiplier of an invisible
 *  noun — `[喵幣]20,000`, not `[喵幣] ×20,000`. The text form keeps its `×` because
 *  there the word needs the separator (`生皮 ×3`).
 *
 *  Everything else is unchanged. The other non-gold cost currencies (生皮, 合金鋼錠,
 *  布料+ …) mostly DO have icon files, but a cost line drawn as art for all of them was
 *  more than was asked for, so only these currencies take this path.
 *
 *  `size` is small — a cost sits on a text line, not in a 72px frame, so it renders at
 *  the surrounding line's scale rather than the tile art's. */
export function Cost({
  currency,
  amount,
  size = "size-4",
}: {
  currency: string;
  amount: number | null;
  size?: string;
}) {
  const label = amount == null ? "價格未填" : amount.toLocaleString();
  const artName = CURRENCY_ART[currency];
  if (artName) {
    return (
      <span className="inline-flex items-center gap-1 tabular-nums">
        <ItemIcon name={artName} size={size} />
        {label}
      </span>
    );
  }
  // The word form, unchanged: `生皮 ×3`. displayName folds the parens of a currency
  // that has them (none today, but the rule is the project's).
  return (
    <span className="tabular-nums">
      {displayName(currency)}
      {amount != null && amount > 0 ? ` ×${label}` : ""}
    </span>
  );
}
