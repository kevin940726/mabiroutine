// Material breakdown (settled 2026-09-09 — variant B 照店採買, folded out of
// the throwaway A/B/C prototype): action view grouped by store, base leaves
// only (no intermediates, no craft queue). Shop leaves semibold
// (plan-needed), gather one muted line. Leaf-root gives (the give IS the
// leaf) render source-first with no item echo — the row already names it,
// and "X — 換NPC" reads backwards.
import { useMemo } from "react";
import {
  flattenBreakdown,
  parseItemQty,
  routeLabel,
  sortByPlanNeed,
  squashTree,
  sumLeaves,
  type RouteKind,
  type SquashNode,
  type SummedLeaf,
} from "@/lib/materials";

/** No toggle when the breakdown would just echo the give (trivial self-only
 *  leaf) — or when gather-preference leaves a lone 自採 group (vacuous:
 *  make-roots always keep theirs for the 製作 queue). */
export function giveHasBreakdown(give: string): boolean {
  const { name, qty } = parseItemQty(give);
  const t = squashTree(name, qty);
  if (t.status !== "ok") return false;
  if (t.children.length === 0 && t.route && t.route.kind !== "make") {
    const kinds = new Set([t.route.kind, ...t.siblings.map((s) => s.kind)]);
    if (kinds.has("gather")) return false;
  }
  return t.children.length > 0 || t.alternatives > 0;
}

function StatusLine({ node }: { node: SquashNode }) {
  const text =
    node.status === "missing"
      ? `${node.name}：目前沒有來源資料，先略過`
      : node.status === "unknown"
        ? `${node.name}：找不到資料`
        : `${node.name}：循環引用，停止展開`;
  return <div className="text-xs text-muted-foreground break-words">{text}</div>;
}

/** Shared squash: summed leaves in plan-need order + make queue + problem nodes. */
function useBreakdown(give: string) {
  return useMemo(() => {
    const { name, qty } = parseItemQty(give);
    const { leaves, makes } = flattenBreakdown(squashTree(name, qty));
    return {
      summed: sortByPlanNeed(sumLeaves(leaves)),
      makes,
      problems: leaves.filter((l) => l.status !== "ok"),
    };
  }, [give]);
}

const SHORT_KIND: Record<RouteKind, string> = {
  shop: "買",
  barter: "換",
  gather: "採",
  quest: "任務獎勵",
  drop: "打怪掉落",
  disassemble: "分解裝備",
  make: "製作",
};

/** Tiny text-sized NPC face with placeholder fallback. */
function NpcFace({ npc }: { npc: string }) {
  return (
    <img
      src={`/npc/${encodeURIComponent(npc)}.png`}
      alt=""
      aria-hidden
      loading="lazy"
      onError={(e) => {
        const img = e.target as HTMLImageElement;
        if (!img.src.endsWith("/npc/placeholder.png")) img.src = "/npc/placeholder.png";
      }}
      className="h-4 w-4 shrink-0 rounded-full border border-border/50 bg-muted object-cover"
    />
  );
}

export function MaterialBreakdown({ give, bare }: { give: string; bare?: boolean }) {
  const { summed, problems } = useBreakdown(give);
  // Leaf-root source groups (null for make-roots, which use the rows below).
  const leafGroups = useMemo(() => {
    const { name, qty } = parseItemQty(give);
    const root = squashTree(name, qty);
    if (!root.route || root.route.kind === "make") return null;
    const all = [root.route, ...root.siblings];
    const groups: {
      key: string; kind: RouteKind; npc?: string; town?: string; limit?: string;
      opts: { name: string; qty: number }[]; exchanges: number;
    }[] = [];
    for (const r of all) {
      const ex = Math.ceil(qty / (r.outQty ?? 1));
      const costs = (r.components ?? []).map((c) => ({ name: c.name, qty: c.qty * ex }));
      const key = `${r.kind}|${r.npc ?? ""}`;
      const g = groups.find((g) => g.key === key);
      if (g) {
        g.opts.push(...costs);
        if (ex > g.exchanges) g.exchanges = ex;
      } else {
        groups.push({ key, kind: r.kind, npc: r.npc, town: r.town, limit: r.limit, opts: costs, exchanges: ex });
      }
    }
    // Gather-preferred: when the item itself is gatherable, the capped
    // shop/barter alternatives are noise next to unlimited gathering —
    // show the 自採 group only.
    if (groups.some((g) => g.kind === "gather")) {
      return groups.filter((g) => g.kind === "gather");
    }
    return groups;
  }, [give]);
  // First line = the ×1 (single-batch) direct recipe, plain ingredients only.
  // Leaf gives have no recipe — their detail lines below are the whole story.
  const { title, directs, showRecipe } = useMemo(() => {
    const { name, qty } = parseItemQty(give);
    const root = squashTree(name, qty);
    if (root.route?.kind === "make") {
      return { title: `材料 · 以${name}一份計`, directs: root.route.components ?? [], showRecipe: true };
    }
    return { title: "", directs: [], showRecipe: false };
  }, [give]);
  const { shops, other, gather } = useMemo(() => {
    const byNpc = new Map<string, { npc: string; town?: string; items: SummedLeaf[] }>();
    const other: SummedLeaf[] = [];
    const gather: SummedLeaf[] = [];
    for (const l of summed) {
      if (l.route.kind === "shop" && l.route.npc) {
        const g = byNpc.get(l.route.npc) ?? { npc: l.route.npc, town: l.route.town, items: [] };
        g.items.push(l);
        byNpc.set(l.route.npc, g);
      } else if (l.route.kind === "gather") gather.push(l);
      else other.push(l);
    }
    return { shops: [...byNpc.values()], other, gather };
  }, [summed]);
  // Boxed (default): the muted panel separates the breakdown from a
  // surrounding row (explorer). Bare: inside the hover card, which is
  // already a distinct panel — a box-in-a-box adds nothing.
  const body = (
    <div className="space-y-1 break-words">
      {leafGroups ? (
        <div className="space-y-1">
          {leafGroups.map((g) => (
            <div key={g.key} className="text-xs">
              {g.kind === "gather" ? (
                <span>
                  自採{g.opts.length > 0 && (
                    <span className="text-muted-foreground">（{g.opts.map((c) => `${c.name}×${c.qty}`).join("、")}）</span>
                  )}
                </span>
              ) : g.kind === "shop" && g.npc ? (
                <span className="flex flex-wrap items-center gap-x-1">
                  <NpcFace npc={g.npc} />
                  <span className="text-muted-foreground">{g.npc}{g.town ? ` · ${g.town}` : ""}</span>
                  {g.limit && <span className="text-muted-foreground">（{g.limit}）</span>}
                </span>
              ) : g.kind === "barter" && g.npc ? (
                <div className="space-y-0.5">
                  <div className="flex flex-wrap items-center gap-x-1">
                    <NpcFace npc={g.npc} />
                    <span>{g.npc}{g.town ? ` · ${g.town}` : ""}</span>
                    {g.limit && <span className="text-muted-foreground">（{g.limit}）</span>}
                  </div>
                  {g.opts.length > 0 && (
                    <div className="ml-5 text-[11px] text-muted-foreground">
                      → 換{g.exchanges}次：{g.opts.map((c) => `${c.name}×${c.qty}`).join(" 或 ")}
                    </div>
                  )}
                </div>
              ) : (
                <span className="text-muted-foreground">{SHORT_KIND[g.kind] ?? g.kind}{g.limit ? `（${g.limit}）` : ""}</span>
              )}
            </div>
          ))}
          {problems.map((p) => (
            <StatusLine key={p.name} node={p} />
          ))}
        </div>
      ) : (
      <>
      {showRecipe && (
        <div className="text-[11px] leading-relaxed break-words">
          <span className="font-semibold text-muted-foreground">{title} </span>
          {directs.map((d, i) => (
            <span key={d.name} className="text-muted-foreground">
              {i > 0 && " "}
              {d.name}×{d.qty}
            </span>
          ))}
        </div>
      )}
      {shops.map((s) => (
        <div key={s.npc} className="flex flex-wrap items-center gap-x-1 text-xs">
          <NpcFace npc={s.npc} />
          <span className="text-muted-foreground">
            {s.npc}{s.town ? ` · ${s.town}` : ""}：
          </span>
          <span className="font-semibold">{s.items.map((l) => `${l.name}×${l.qty}`).join("、")}</span>
          {s.items[0]?.route.limit && (
            <span className="text-muted-foreground">（{s.items[0].route.limit}）</span>
          )}
        </div>
      ))}
      {other.map((l) => {
        // Multi-exchange barter/shop: show scaled cost options (no day estimates —
        // assume other sources unless the item is flagged single-source).
        const costOpts =
          l.exchanges > 1
            ? [l.route, ...l.siblings.filter((s) => s.kind === l.route!.kind)]
                .filter((r) => (r?.components?.length ?? 0) > 0)
                .map((r) => (r!.components ?? []).map((c) => `${c.name}×${c.qty * l.exchanges}`).join("、"))
            : [];
        const verb = l.route.kind === "shop" ? "買" : "換";
        return (
          <div key={l.name}>
            <div className="text-xs">
              <span className="font-semibold">{l.name}×{l.qty}</span>
              {l.route.npc ? (
                // flex-wrap: a long "— 換NPC · town（limit）" run must wrap
                // inside narrow cards; plain inline-flex overflows instead.
                <span className="inline-flex flex-wrap items-center gap-1 align-middle text-muted-foreground">
                  {" "}— {SHORT_KIND[l.route.kind] ?? l.route.kind} <NpcFace npc={l.route.npc} />
                  {l.route.npc}{l.route.town ? ` · ${l.route.town}` : ""}{l.route.limit ? `（${l.route.limit}）` : ""}
                </span>
              ) : (
                <span className="text-muted-foreground"> — {routeLabel(l.route)}</span>
              )}
            </div>
            {costOpts.length > 0 && (
              <div className="ml-2 text-[11px] text-muted-foreground">
                → {verb}{l.exchanges}次：{costOpts.join(" 或 ")}
              </div>
            )}
          </div>
        );
      })}
      {gather.length > 0 && (
        <div className="text-xs text-muted-foreground">自採：{gather.map((l) => `${l.name}×${l.qty}`).join("、")}</div>
      )}
      {problems.map((p) => (
        <StatusLine key={p.name} node={p} />
      ))}
      </>
      )}
    </div>
  );
  if (bare) return body;
  return <div className="mt-2 rounded-md bg-muted/50 px-2.5 py-2">{body}</div>;
}
