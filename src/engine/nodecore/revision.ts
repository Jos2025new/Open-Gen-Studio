import type { Graph, GraphNode } from '../types';
import { digest } from './address';

/** Stable JSON: sorted keys, no undefined. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) => v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => a.localeCompare(b))) : v);
}

/** What a node's owner-side revision ignores: where it sits, its result bookkeeping (a finished run is not an edit). */
const IGNORED = new Set(['generationId', 'sketchAssetId']);

/**
 * The owner revision (ADR 0031 point 5): a digest of the node's parameters and every link touching it. Computed, so
 * nothing is stored and saved sessions need no migration. An edit that carries the revision it was drawn from is
 * refused with a conflict when it no longer matches.
 */
export function ownerRev(graph: Graph, nodeId: string): string {
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node) return 'gone';
  const data = Object.fromEntries(Object.entries(node.data).filter(([k]) => !IGNORED.has(k)));
  const edges = graph.edges.filter((e) => e.source === nodeId || e.target === nodeId)
    .map((e) => ({ id: e.id, s: e.source, t: e.target, sh: e.sourceHandle, th: e.targetHandle, o: e.outputIndex, k: e.kind, b: e.both, p: e.pin })).sort((a, b) => a.id.localeCompare(b.id));
  return digest(stableJson({ data, edges }));
}

export const nodeOf = (graph: Graph, id: string): GraphNode | undefined => graph.nodes.find((n) => n.id === id);
