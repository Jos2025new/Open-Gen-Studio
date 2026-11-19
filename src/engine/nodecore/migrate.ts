import { setLoadMigration } from '../../store/store';
import type { Graph, GraphNode, GraphNodeData } from '../types';
import { descriptorOf } from './registry';

/*
 * Descriptor migrations (ADR 0031 point 1). A node's data carries `v`, the descriptor version it was written at
 * (absent = 1). Loading upgrades it step by step with `migrate[n]` (n → n + 1); the check requires one per bump.
 */

/** The data at the descriptor's current version; the same object when it already is. */
export function migrateData(data: GraphNodeData): GraphNodeData {
  const d = descriptorOf(data.kind);
  if (!d) return data;
  let at = data.v ?? 1;
  if (at >= d.version) return data;
  let next: GraphNodeData = data;
  for (; at < d.version; at++) next = d.migrate?.[at]?.(next) ?? next;
  return { ...next, v: d.version };
}

/** Every node of a loaded graph at its descriptor's version; the same graph when nothing needed it. */
export function migrateGraph(graph: Graph): Graph {
  if (!graph?.nodes) return graph;
  let changed = false;
  const nodes = graph.nodes.map((n): GraphNode => {
    const data = migrateData(n.data);
    if (data === n.data) return n;
    changed = true;
    return { ...n, data };
  });
  return changed ? { ...graph, nodes } : graph;
}

/** A node written now (absent from `prev`) is born at the current version, so the next load does not migrate it again. */
export function stampNew(prev: Graph, next: Graph): Graph {
  const had = new Set(prev.nodes.map((n) => n.id));
  let changed = false;
  const nodes = next.nodes.map((n): GraphNode => {
    const version = descriptorOf(n.data.kind)?.version ?? 1;
    if (had.has(n.id) || n.data.v != null || version <= 1) return n;
    changed = true;
    return { ...n, data: { ...n.data, v: version } };
  });
  return changed ? { ...next, nodes } : next;
}

setLoadMigration(migrateGraph);

/** Saved sessions with the single `agent` (or `agentLanes`) load with one thread per agent (agent/threads.ts). */
export { migrateAgents } from '../agent/threads';
