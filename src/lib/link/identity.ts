import type { Character } from "@/lib/types";

export type LinkGameCharacter = { gameId: number; name: string };

export type IdentityPlan = {
  bindings: { gameId: number; cid: string; name: string }[];
  renames: { gameId: number; cid: string; name: string }[];
  creates: { gameId: number; name: string }[];
  unmatched: { gameId: number; name: string; reason: "no-match" | "full" }[];
};

const DEFAULT_NAME = /^角色 \d+$/;
const MAX_CHARACTERS = 6;

export function isDefaultCharacter(c: Character): boolean {
  return (
    DEFAULT_NAME.test(c.name.trim()) &&
    Object.keys(c.taskValues).length === 0 &&
    c.hiddenTaskIds.length === 0 &&
    Object.keys(c.taskOrder ?? {}).length === 0
  );
}

function slotOf(gameId: number): number {
  return gameId & 0xffff;
}

export function activeCid(
  active: { gameId: number; at: number } | null,
  match: Record<string, string>,
  characters: { id: string }[]
): string | null {
  if (!active) return null;
  const cid = match[String(active.gameId)];
  return cid && characters.some((c) => c.id === cid) ? cid : null;
}

export function planIdentities(
  local: Character[],
  game: LinkGameCharacter[],
  match: Record<string, string>
): IdentityPlan {
  const plan: IdentityPlan = { bindings: [], renames: [], creates: [], unmatched: [] };
  const used = new Set<string>();
  const allPlaceholders = local.length > 0 && local.every(isDefaultCharacter);
  const ordered = [...game].sort(
    (a, b) => slotOf(a.gameId) - slotOf(b.gameId) || a.gameId - b.gameId
  );

  for (const g of ordered) {
    const saved = match[String(g.gameId)];
    const savedChar = saved ? local.find((c) => c.id === saved) : undefined;
    if (savedChar && !used.has(savedChar.id)) {
      used.add(savedChar.id);
      plan.bindings.push({ gameId: g.gameId, cid: savedChar.id, name: savedChar.name });
      continue;
    }

    const exact = local.find((c) => !used.has(c.id) && c.name.trim() === g.name.trim());
    if (exact) {
      used.add(exact.id);
      plan.bindings.push({ gameId: g.gameId, cid: exact.id, name: exact.name });
      continue;
    }

    const placeholder = local.find((c) => !used.has(c.id) && isDefaultCharacter(c));
    if (placeholder) {
      used.add(placeholder.id);
      plan.renames.push({ gameId: g.gameId, cid: placeholder.id, name: g.name });
      plan.bindings.push({ gameId: g.gameId, cid: placeholder.id, name: g.name });
      continue;
    }

    if (ordered.length === 1 && local.length === 1 && !used.has(local[0].id)) {
      used.add(local[0].id);
      plan.bindings.push({ gameId: g.gameId, cid: local[0].id, name: local[0].name });
      continue;
    }

    if (allPlaceholders && local.length + plan.creates.length < MAX_CHARACTERS) {
      plan.creates.push({ gameId: g.gameId, name: g.name });
      continue;
    }

    plan.unmatched.push({
      gameId: g.gameId,
      name: g.name,
      reason: allPlaceholders ? "full" : "no-match",
    });
  }

  return plan;
}
