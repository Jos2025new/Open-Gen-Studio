import { parseRef } from '../plan';
import { descriptorOf } from './registry';
import type { Graph, GraphNode } from '../types';

/*
 * Dependencies, invalidation and cycles (ADR 0031 point 4). Which inputs affect a node's output is declared by its
 * descriptor (`affects`); the edges below are the evaluable ones: data links and the step references of subject
 * bindings. Ref/control links are declarative and may be bidirectional, so they never count as a cycle, but they do
 * invalidate (a changed referred thing makes its consumer stale: freshness.ts links).
 */
export interface Dep { from: string; to: string; via: 'data' | 'subject' | 'link' }

export function subjectSources(node: GraphNode): string[] {
  return 'subjects' in node.data ? (node.data.subjects ?? []).flatMap((s) => { const p = parseRef(s.from); return p?.type === 'step' ? [p.id] : []; }) : [];
}

/** Evaluable dependency edges: `from` feeds `to`. */
export function evaluableDeps(graph: Graph): Dep[] {
  return [
    ...graph.edges.filter((e) => (e.kind ?? 'data') === 'data').map((e): Dep => ({ from: e.source, to: e.target, via: 'data' })),
    ...graph.nodes.flatMap((n) => subjectSources(n).map((from): Dep => ({ from, to: n.id, via: 'subject' }))),
  ];
}

function affectsNothing(graph: Graph, e: Graph['edges'][number]): boolean {
  const target = graph.nodes.find((n) => n.id === e.target);
  return target ? descriptorOf(target.data.kind)?.affects[e.targetHandle] === false : false;
}

/** Invalidation edges: evaluable ones plus ref/control links (both directions when `both`). */
export function invalidationDeps(graph: Graph): Dep[] {
  return [
    // A port the descriptor says does not affect the output (`affects[port] === false`) does not invalidate it.
    ...graph.edges.filter((e) => (e.kind ?? 'data') === 'data' && !affectsNothing(graph, e)).map((e): Dep => ({ from: e.source, to: e.target, via: 'data' })),
    ...evaluableDeps(graph).filter((d) => d.via === 'subject'),
    ...graph.edges.filter((e) => (e.kind ?? 'data') !== 'data').flatMap((e): Dep[] => [{ from: e.source, to: e.target, via: 'link' }, ...(e.both ? [{ from: e.target, to: e.source, via: 'link' as const }] : [])]),
  ];
}

/** A cycle in the evaluable dependencies as a node-id path (first id repeated at the end), or null. */
export function findCycle(graph: Graph): string[] | null {
  const next = new Map<string, string[]>();
  for (const d of evaluableDeps(graph)) next.set(d.from, [...(next.get(d.from) ?? []), d.to]);
  const state = new Map<string, 1 | 2>();
  const path: string[] = [];
  const visit = (id: string): string[] | null => {
    if (state.get(id) === 2) return null;
    if (state.get(id) === 1) return [...path.slice(path.indexOf(id)), id];
    state.set(id, 1); path.push(id);
    for (const to of next.get(id) ?? []) { const c = visit(to); if (c) return c; }
    path.pop(); state.set(id, 2);
    return null;
  };
  for (const n of graph.nodes) { const c = visit(n.id); if (c) return c; }
  return null;
}

/** Every node downstream of `ids`, through invalidation edges: what a change to them makes stale. */
export function consumersOf(graph: Graph, ids: string[]): string[] {
  const next = new Map<string, string[]>();
  for (const d of invalidationDeps(graph)) next.set(d.from, [...(next.get(d.from) ?? []), d.to]);
  const seen = new Set<string>();
  const stack = [...ids];
  while (stack.length) for (const to of next.get(stack.pop()!) ?? []) if (!seen.has(to) && !ids.includes(to)) { seen.add(to); stack.push(to); }
  return [...seen];
}

/** What changed between two graphs, as the node ids whose parameters or incident links differ. */
export function changedNodes(before: Graph, after: Graph, revOf: (g: Graph, id: string) => string): string[] {
  const ids = new Set([...before.nodes.map((n) => n.id), ...after.nodes.map((n) => n.id)]);
  return [...ids].filter((id) => revOf(before, id) !== revOf(after, id));
}
