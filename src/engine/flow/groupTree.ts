import type { GraphGroup } from '../types';

/* The tree of groups: `parentId` is the group outside. */
/** Ancestor chain of `id` (self first); stops on missing parent or cycle (like objectGroupTree.ts). */
export function groupChain(groups: readonly GraphGroup[] | undefined, id: string | undefined): GraphGroup[] {
  if (!groups?.length || !id) return [];
  const byId = new Map(groups.map((g) => [g.id, g])), out: GraphGroup[] = [];
  for (let g = byId.get(id); g && !out.includes(g); g = g.parentId ? byId.get(g.parentId) : undefined) out.push(g);
  return out;
}

/** Group `id` and all descendant groups/nodes (cycle-safe; unknown parentId is ignored). */
export function groupSubtree(groups: readonly GraphGroup[] | undefined, id: string) {
  const groupIds = new Set<string>(), nodeIds = new Set<string>();
  const byId = new Map((groups ?? []).map((g) => [g.id, g]));
  const q = byId.has(id) ? [id] : [];
  for (const cur of q) {
    if (groupIds.has(cur)) continue;
    groupIds.add(cur);
    for (const nid of byId.get(cur)!.nodeIds) nodeIds.add(nid);
    for (const g of groups ?? []) if (g.parentId === cur && !groupIds.has(g.id)) q.push(g.id);
  }
  return { groupIds, nodeIds };
}
