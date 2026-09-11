// Material breakdown: assumed-path 3-line plan (settled 2026-09-12,
// starmoon-inspired but item-led with zero user planning). L1 = the direct
// recipe (unchanged), L2 = one pill per ingredient with its assumed source
// only (faces for NPC alternatives, rendered side by side; skill text for
// gather; counts ignored), L3 = deeply flattened whole-deal terminal totals
// (共需， × the row's exchange limit — the explorer passes times).
// Rank: gather > free-craft > barter must/extra/untracked > shop >
// craft-fallback > quest/drop > barter once/situational; barter ties break by priority then
// barter.json order. NPC/town/limit names live only in face tooltips
// (mobile users know their NPCs).
import { useMemo } from "react";
import { assumedPlan, hasBreakdown, parseItemQty } from "@/lib/materials";
import { Tooltip } from "@/components/ui/tooltip";

/** No toggle when the breakdown would just echo the give (trivial self-only
 *  leaf) — or when the assumed path is gather-only (vacuous: a lone skill
 *  pill says nothing). Single non-gather legs stay shut too; make-roots
 *  always keep theirs for the 製作 queue). */
export function giveHasBreakdown(give: string): boolean {
  return hasBreakdown(parseItemQty(give).name);
}

function StatusLine({ name, status }: { name: string; status: string }) {
  const text =
    status === "missing"
      ? `${name}：目前沒有來源資料，先略過`
      : status === "unknown"
        ? `${name}：找不到資料`
        : `${name}：循環引用，停止展開`;
  return <div className="text-xs text-muted-foreground break-words">{text}</div>;
}

/** Avatar-as-identity: the face IS the source name. NPC · town · limit live
 *  only in the tooltip — the flow carries zero name text. Segments are atomic
 *  (whitespace-nowrap) so wrapping happens only between them: no mid-name
 *  breaks, no lone separator dangling at a line edge. */
function Pfp({ npc, town, limit, price }: { npc: string; town?: string; limit?: string; price?: number }) {
  return (
    <Tooltip
      content={
        <>
          <span className="whitespace-nowrap">{npc}</span>
          {town && (
            <>
              {" "}
              <span className="whitespace-nowrap">· {town}</span>
            </>
          )}
          {limit && (
            <>
              {" "}
              <span className="whitespace-nowrap">（{limit}）</span>
            </>
          )}
          {price != null && (
            <>
              {" "}
              <span className="whitespace-nowrap">· 🪙{price}</span>
            </>
          )}
        </>
      }
    >
      <img
        src={`/npc/${encodeURIComponent(npc)}.png`}
        alt={npc}
        loading="lazy"
        onError={(e) => {
          const img = e.target as HTMLImageElement;
          if (!img.src.endsWith("/npc/placeholder.png")) img.src = "/npc/placeholder.png";
        }}
        className="h-4 w-4 shrink-0 rounded-full border border-border/50 bg-muted object-cover"
      />
    </Tooltip>
  );
}

export function MaterialBreakdown({ give, bare, times }: { give: string; bare?: boolean; times?: number }) {
  const plan = useMemo(() => assumedPlan(give, times ?? 1), [give, times]);
  // Boxed (default): the muted panel separates the breakdown from a
  // surrounding row (explorer). Bare: inside the hover card, which is
  // already a distinct panel — a box-in-a-box adds nothing.
  const body = (
    <div className="space-y-1.5 break-words">
      {plan.showRecipe && (
        <div className="text-[11px] leading-relaxed break-words">
          <span className="font-semibold text-muted-foreground">{plan.title} </span>
          {plan.directs.map((d, i) => (
            <span key={d.name} className="text-muted-foreground">
              {i > 0 && " "}
              {d.name}×{d.qty}
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1">
        {plan.pills.map((p) => (
          <span
            key={p.item}
            className="inline-flex items-center gap-1 rounded-full border border-border/60 px-2 py-0.5 text-xs"
          >
            <span className="font-semibold">{p.item}</span>
            {p.pill.faces.length > 0 && (
              <span className="inline-flex items-center -space-x-0.5">
                {p.pill.faces.map((f) => (
                  <Pfp key={`${f.npc}|${f.town ?? ""}|${f.limit ?? ""}|${f.price ?? ""}`} npc={f.npc} town={f.town} limit={f.limit} price={f.price} />
                ))}
              </span>
            )}
            {p.pill.skills.map((s) => (
              <span key={s} className="text-muted-foreground">
                {s}
              </span>
            ))}
            {p.pill.labels.map((l) => (
              <span key={l} className="text-muted-foreground">
                {l}
              </span>
            ))}
          </span>
        ))}
      </div>
      <div className="text-xs">
        <span className="font-semibold">共需{(times ?? 1) > 1 ? `（${times}次）` : ""}：</span>
        <span className="text-muted-foreground">
          {plan.totals.map((t) => `${t.name}×${t.qty}`).join("、")}
          {plan.gold > 0 && `、🪙${plan.gold}`}
        </span>
      </div>
      {plan.problems.map((p) => (
        <StatusLine key={p.name} name={p.name} status={p.status} />
      ))}
    </div>
  );
  if (bare) return body;
  return <div className="mt-2 rounded-md bg-muted/50 px-2.5 py-2">{body}</div>;
}
