import type { Graph, GraphNode } from '../types';

/*
 * Agent names. Every agent node carries its own `data.title`; a new one gets the smallest free «Agent N» and the
 * existing ones are never renumbered. A title the user chose is kept. Pure: no store, so loading can use it.
 */

const isAgent = (n: GraphNode) => n.data.kind === 'ref' && n.data.type === 'agent';

/** The next free «Agent N» for a graph (N counts from 1 and skips every title already taken, by any node). */
export function nextAgentTitle(graph: Pick<Graph, 'nodes'> | undefined): string {
  const taken = new Set((graph?.nodes ?? []).map((n) => n.data.title));
  let n = 1;
  while (taken.has(`Agent ${n}`)) n++;
  return `Agent ${n}`;
}

/**
 * A loaded graph where agents that all kept the default «Agent» (or an empty title) are told apart as «Agent N».
 * A lone default stays; titles already numbered or chosen are never touched. IDs, cables and the rest of the data are
 * the same. Idempotent: the same graph comes back when nothing needs it.
 */
export function normalizeAgentTitles(graph: Graph): Graph {
  if (!graph?.nodes) return graph;
  const bare = graph.nodes.filter((n) => isAgent(n) && (!n.data.title || n.data.title === 'Agent'));
  if (bare.length < 2) return graph;
  const rename = new Map<string, string>();
  const taken = new Set(graph.nodes.map((n) => n.data.title));
  let n = 1;
  for (const node of bare) {
    while (taken.has(`Agent ${n}`)) n++;
    rename.set(node.id, `Agent ${n}`);
    taken.add(`Agent ${n}`);
  }
  return { ...graph, nodes: graph.nodes.map((x) => (rename.has(x.id) ? { ...x, data: { ...x.data, title: rename.get(x.id)! } } : x)) };
}

/** The options of a picker: titles as they are, with the id appended only to the ones that repeat. */
export function distinctTitles<T extends { id: string; title: string }>(items: T[]): Array<T & { label: string }> {
  const count = new Map<string, number>();
  for (const i of items) count.set(i.title, (count.get(i.title) ?? 0) + 1);
  return items.map((i) => ({ ...i, label: (count.get(i.title) ?? 0) > 1 ? `${i.title} (${i.id})` : i.title }));
}
