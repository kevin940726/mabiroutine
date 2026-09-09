// PROTOTYPE (throwaway, dev-only): three material-breakdown variants for one question —
// "which compact style replaces the verbose tree?" Switch via ?variant=a|b|c or the
// floating bar. Winner gets folded into MaterialBreakdown.tsx; the rest is deleted.
import { useEffect, useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
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
import { cn } from "@/lib/utils";

export type BreakdownVariantKey = "a" | "b" | "c";
export const BREAKDOWN_VARIANTS: { key: BreakdownVariantKey; name: string }[] = [
  { key: "a", name: "一行全料" },
  { key: "b", name: "照店採買" },
  { key: "c", name: "工作檯排程" },
];

/** Shared variant default: ?variant=a|b|c, falls back to B (store-grouped). */
export function readBreakdownVariant(): BreakdownVariantKey {
  const v = new URLSearchParams(window.location.search).get("variant");
  return v === "a" || v === "c" ? v : "b";
}

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

function toolCost(l: SummedLeaf): string {
  return l.toolCosts.length > 0 ? `⁽${l.toolCosts.map((c) => `${c.name}×${c.qty}`).join("、")}⁾` : "";
}

const SHORT_KIND: Record<string, string> = {
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

function leafTag(l: SummedLeaf): string {
  const r = l.route;
  if (r.kind === "shop") return `⁽買·${r.npc}${r.limit ? `·${r.limit}` : ""}⁾`;
  if (r.kind === "barter") return `⁽換·${r.npc}⁾`;
  if (r.kind === "gather") return "";
  return `⁽${SHORT_KIND[r.kind] ?? r.kind}⁾`;
}

/** A — one-line full ingredients (gather muted), plan-needed block below. */
function VariantA({ give }: { give: string }) {
  const { summed, makes, problems } = useBreakdown(give);
  const plan = summed.filter((l) => l.route.kind !== "gather");
  return (
    <div className="space-y-1.5 break-words">
      <div className="text-xs leading-relaxed break-words">
        {summed.map((l, i) => (
          <span key={l.name} className={cn(l.route.kind === "gather" && "text-muted-foreground")}>
            {i > 0 && " "}
            {l.name}×{l.qty}
            {toolCost(l) && <span className="text-muted-foreground">{toolCost(l)}</span>}
            {leafTag(l) && <span className="font-medium">{leafTag(l)}</span>}
          </span>
        ))}
      </div>
      {plan.length > 0 && (
        <div className="space-y-0.5">
          <div className="text-[11px] font-semibold">需規劃</div>
          {plan.map((l) => (
            <div key={l.name} className="text-xs">
              {l.name}×{l.qty} — {routeLabel(l.route)}
            </div>
          ))}
        </div>
      )}
      {makes.length > 0 && (
        <div className="text-xs">
          製作：{makes.map((m) => `${m.name}（${m.station}${m.level ? ` Lv.${m.level}` : ""}${m.batches > 1 ? `×${m.batches}批` : ""}）`).join("、")}
        </div>
      )}
      {problems.map((p) => (
        <StatusLine key={p.name} node={p} />
      ))}
    </div>
  );
}

/** B — action view grouped by store: base leaves only (no intermediates, no
 *  craft queue). Shop leaves semibold (plan-needed), gather one muted line.
 *  Leaf-root gives (the give IS the leaf) render source-first with no item
 *  echo — the row already names it, and "X — 換NPC" reads backwards. */
function VariantB({ give }: { give: string }) {
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
  const { shops, rest, gather } = useMemo(() => {
    const byNpc = new Map<string, { npc: string; town?: string; items: SummedLeaf[] }>();
    const rest: SummedLeaf[] = [];
    const gather: SummedLeaf[] = [];
    for (const l of summed) {
      if (l.route.kind === "shop" && l.route.npc) {
        const g = byNpc.get(l.route.npc) ?? { npc: l.route.npc, town: l.route.town, items: [] };
        g.items.push(l);
        byNpc.set(l.route.npc, g);
      } else if (l.route.kind === "gather") gather.push(l);
      else rest.push(l);
    }
    return { shops: [...byNpc.values()], rest, gather };
  }, [summed]);
  return (
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
      {rest.map((l) => {
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
}

/** C — workbench schedule first: each make step with direct inputs, leaves summed at the bottom. */
function VariantC({ give }: { give: string }) {
  const root = useMemo(() => {
    const { name, qty } = parseItemQty(give);
    return squashTree(name, qty);
  }, [give]);
  const { summed, problems } = useMemo(() => {
    const { leaves } = flattenBreakdown(root);
    return { summed: sortByPlanNeed(sumLeaves(leaves)), problems: leaves.filter((l) => l.status !== "ok") };
  }, [root]);
  const steps = useMemo(() => {
    const out: { name: string; batches: number; station?: string; level?: string; inputs: { name: string; qty: number }[] }[] = [];
    const walk = (n: SquashNode) => {
      if (n.children.length > 0 && n.route?.kind === "make") {
        out.push({
          name: n.name, batches: n.batches, station: n.route.station, level: n.route.level,
          inputs: n.children.map((c) => ({ name: c.name, qty: c.qty })),
        });
        n.children.forEach(walk);
      }
    };
    walk(root);
    return out;
  }, [root]);
  if (steps.length === 0) {
    return (
      <div className="text-xs leading-relaxed break-words">
        <span className="text-muted-foreground">免製作 · </span>
        {summed.map((l, i) => (
          <span key={l.name}>
            {i > 0 && " "}
            {l.name}×{l.qty}
            {leafTag(l) && <span className="text-muted-foreground">{leafTag(l)}</span>}
          </span>
        ))}
        {problems.map((p) => (
          <StatusLine key={p.name} node={p} />
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-1.5 break-words">
      {steps.map((s, i) => (
        <div key={`${s.name}-${i}`} className="text-xs">
          <span className="font-semibold">{s.station}{s.level ? ` Lv.${s.level}` : ""}</span>
          <span>：{s.name}{s.batches > 1 ? `×${s.batches}批` : ""} ← {s.inputs.map((c) => `${c.name}×${c.qty}`).join("、")}</span>
        </div>
      ))}
      <div className="text-[11px] text-muted-foreground leading-relaxed break-words">
        合計：{summed.map((l) => `${l.name}×${l.qty}`).join("、")}
      </div>
      {problems.map((p) => (
        <StatusLine key={p.name} node={p} />
      ))}
    </div>
  );
}

export function BreakdownVariant({ give, variant, bare }: { give: string; variant: BreakdownVariantKey; bare?: boolean }) {
  // Boxed (default): the muted panel separates the breakdown from a surrounding
  // row (explorer). Bare: inside the hover card, which is already a distinct
  // panel — a box-in-a-box adds nothing.
  const body = (
    <>
      {variant !== "b" && (
        <div className="mb-1 text-[11px] font-semibold text-muted-foreground">材料 · 以{give}計</div>
      )}
      {variant === "a" && <VariantA give={give} />}
      {variant === "b" && <VariantB give={give} />}
      {variant === "c" && <VariantC give={give} />}
    </>
  );
  if (bare) return body;
  return <div className="mt-2 rounded-md bg-muted/50 px-2.5 py-2">{body}</div>;
}

/** Floating variant switcher — dev only, never ships. */
export function PrototypeSwitcher({
  variant,
  onChange,
}: {
  variant: BreakdownVariantKey;
  onChange: (v: BreakdownVariantKey) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const i = BREAKDOWN_VARIANTS.findIndex((v) => v.key === variant);
      if (e.key === "ArrowLeft") onChange(BREAKDOWN_VARIANTS[(i + BREAKDOWN_VARIANTS.length - 1) % BREAKDOWN_VARIANTS.length].key);
      if (e.key === "ArrowRight") onChange(BREAKDOWN_VARIANTS[(i + 1) % BREAKDOWN_VARIANTS.length].key);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [variant, onChange]);
  if (!import.meta.env.DEV) return null;
  const label = BREAKDOWN_VARIANTS.find((v) => v.key === variant)?.name ?? variant;
  const step = (d: number) => {
    const i = BREAKDOWN_VARIANTS.findIndex((v) => v.key === variant);
    onChange(BREAKDOWN_VARIANTS[(i + d + BREAKDOWN_VARIANTS.length) % BREAKDOWN_VARIANTS.length].key);
  };
  return (
    <div className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full border bg-black px-2 py-1.5 text-white shadow-lg">
      <button aria-label="上一個版本" onClick={() => step(-1)} className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/20">
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="min-w-[110px] text-center text-xs font-semibold">
        {variant.toUpperCase()} · {label}
      </span>
      <button aria-label="下一個版本" onClick={() => step(1)} className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/20">
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
