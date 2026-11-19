import type { Graph } from '../types';
import { GONE_HANDLE, NO_RESULT, resultHandle } from './results';

interface Entry { before: Graph; after: Graph; label: string; key: string; time: number }
interface Stack { past: Entry[]; future: Entry[]; latest: Map<string, Graph['nodes'][number]> }
const stacks = new Map<string, Stack>();
const listeners = new Set<() => void>();
let revision = 0;
let replay = false;
const stack = (id: string) => {
  if (!stacks.has(id)) stacks.set(id, { past: [], future: [], latest: new Map() });
  return stacks.get(id)!;
};
function notify() { revision++; queueMicrotask(() => listeners.forEach(fn => fn())); }
export const historyRevision = () => revision;
export function subscribeGraphHistory(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
export function graphHistory(id: string, direction: 'undo' | 'redo') { return [...(direction === 'undo' ? stack(id).past : stack(id).future)].reverse(); }
function logical(g: Graph) {
  return JSON.stringify({ nodes: g.nodes.map(n => { const data = { ...n.data }; if ('generationId' in data) delete data.generationId; return { ...n, data }; }), edges: g.edges, broken: g.broken ?? [] });
}
/** Open groups by session: the first `recordGraph` inside one is its undo step, the later ones add nothing (ADR 0030). */
const groups = new Map<string, { first: Entry | null }>();

/** Results deleted from a generation, in order (an index that moved, or -1: gone): travelling back must not give an old index to the wrong image (ADR 0031). */
const drops: Array<{ gen: string; to: number[]; len: number; at: number }> = [];
export function noteDropped(gen: string, to: number[], len: number): void {
  drops.push({ gen, to, len, at: Date.now() });
  if (drops.length > 200) drops.shift();
}
/** A graph from the past with its result indexes brought to the results that exist now. */
function reconciled(graph: Graph, since: number): Graph {
  const later = (gen: string) => drops.filter((d) => d.gen === gen && d.at >= since);
  const generation = new Map(graph.nodes.map((n) => [n.id, (n.data as { generationId?: string }).generationId]));
  const follow = (gen: string, index: number): number => later(gen).reduce((i, d) => (i < 0 ? i : d.to[i] ?? i), index);
  const nodes = graph.nodes.map((n) => {
    const d = n.data as { generationId?: string; outputIndex?: number };
    if (!d.generationId || d.outputIndex == null || !later(d.generationId).length) return n;
    const next = follow(d.generationId, d.outputIndex);
    const len = later(d.generationId).at(-1)!.len;
    const to = next >= 0 ? next : Math.max(0, Math.min(d.outputIndex, len - 1));
    return to === d.outputIndex ? n : { ...n, data: { ...n.data, outputIndex: to } } as typeof n;
  });
  const edges = graph.edges.map((e) => {
    const gen = generation.get(e.source);
    if (!gen || e.outputIndex == null || e.outputIndex === NO_RESULT || !later(gen).length) return e;
    const next = follow(gen, e.outputIndex);
    if (next === e.outputIndex) return e;
    return next < 0 ? { ...e, outputIndex: NO_RESULT, sourceHandle: GONE_HANDLE } : { ...e, outputIndex: next, sourceHandle: resultHandle(next) };
  });
  return { ...graph, nodes, edges };
}

/**
 * Makes every change to this graph until `close` one undo step: a command, or a sequence of them. `revert` puts the
 * graph back as it was at the first change, takes that step out and returns the graph of then (or null when nothing
 * was recorded); the caller stores it.
 */
export function openHistoryGroup(id: string): { close(): void; revert(): Graph | null } {
  const group = { first: null as Entry | null };
  groups.set(id, group);
  const end = () => { if (groups.get(id) === group) groups.delete(id); };
  return {
    close: end,
    revert() {
      end();
      const first = group.first;
      if (!first) return null;
      const s = stack(id), at = s.past.lastIndexOf(first);
      if (at >= 0) s.past.splice(at);
      notify();
      return first.before;
    },
  };
}

export function recordGraph(id: string, before: Graph, after: Graph) {
  const s = stack(id);
  after.nodes.forEach(n => s.latest.set(n.id, n));
  const group = groups.get(id);
  if (group?.first) {
    group.first.after = structuredClone(after);
    // A later edit within 700 ms must not merge into the command's step: it is already the user's own step.
    group.first.time = 0;
    notify();
    return;
  }
  const edits = { ...after, nodes: after.nodes.map(n => {
    const prev = before.nodes.find(p => p.id === n.id);
    if (prev && 'outputIndex' in prev.data && 'outputIndex' in n.data && prev.data.generationId !== n.data.generationId) {
      return { ...n, data: { ...n.data, outputIndex: prev.data.outputIndex, sketchAssetId: prev.data.sketchAssetId } };
    }
    return n;
  }) };
  if (replay || logical(before) === logical(edits)) return;
  const added = after.nodes.filter(n => !before.nodes.some(p => p.id === n.id));
  const removed = before.nodes.filter(n => !after.nodes.some(p => p.id === n.id));
  const changed = after.nodes.filter(n => { const prev = before.nodes.find(p => p.id === n.id); return prev && logical({ nodes: [prev], edges: [] }) !== logical({ nodes: [n], edges: [] }); });
  const edges = JSON.stringify([before.edges, before.broken ?? []]) !== JSON.stringify([after.edges, after.broken ?? []]);
  const moved = changed.length > 0 && changed.every(n => JSON.stringify(n.data) === JSON.stringify(before.nodes.find(p => p.id === n.id)!.data));
  const label = added.length ? `Add ${added.map(n => n.data.title).join(', ')}` : removed.length ? `Delete ${removed.map(n => n.data.title).join(', ')}` : edges ? 'Change connections' : `${moved ? 'Move' : 'Edit'} ${changed.map(n => n.data.title).join(', ')}`;
  const key = `${moved ? 'move' : 'edit'}:${changed.map(n => n.id).join(',')}`;
  const time = Date.now();
  const last = s.past.at(-1);
  if (!group && !added.length && !removed.length && !edges && last?.key === key && time - last.time < 700 && !s.future.length) {
    last.after = structuredClone(after); last.time = time;
  } else {
    s.past.push({ before: structuredClone(before), after: structuredClone(after), label, key, time });
    if (s.past.length > 40) s.past.shift();
    if (group) group.first = s.past[s.past.length - 1];
  }
  s.future = [];
  notify();
}
export function travelGraph(id: string, current: Graph, direction: 'undo' | 'redo', count: number, apply: (graph: Graph) => boolean): boolean {
  const s = stack(id);
  const from = direction === 'undo' ? s.past : s.future;
  const to = direction === 'undo' ? s.future : s.past;
  if (!Number.isInteger(count) || count < 1 || count > from.length) return false;
  const target = from[from.length - count];
  const saved = direction === 'undo' ? target.before : target.after;
  const graph = { ...structuredClone(saved), viewport: current.viewport, nodes: saved.nodes.map(n => {
    const live = current.nodes.find(p => p.id === n.id) ?? s.latest.get(n.id);
    if (live && live.data.kind === n.data.kind && 'outputIndex' in n.data && 'outputIndex' in live.data) {
      const newerOutput = n.data.generationId !== live.data.generationId;
      return { ...n, data: { ...n.data, generationId: live.data.generationId, ...(newerOutput ? { outputIndex: live.data.outputIndex, sketchAssetId: live.data.sketchAssetId } : {}) } };
    }
    return n;
  }) };
  replay = true;
  try { if (!apply(reconciled(graph, target.time))) return false; } finally { replay = false; }
  for (let i = 0; i < count; i++) to.push(from.pop()!);
  notify();
  return true;
}
