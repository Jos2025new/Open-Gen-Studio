import type { Graph } from '../types';

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
  return JSON.stringify({ nodes: g.nodes.map(n => { const data = { ...n.data }; if ('generationId' in data) delete data.generationId; return { ...n, data }; }), edges: g.edges });
}
export function recordGraph(id: string, before: Graph, after: Graph) {
  const s = stack(id);
  after.nodes.forEach(n => s.latest.set(n.id, n));
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
  const edges = JSON.stringify(before.edges) !== JSON.stringify(after.edges);
  const moved = changed.length > 0 && changed.every(n => JSON.stringify(n.data) === JSON.stringify(before.nodes.find(p => p.id === n.id)!.data));
  const label = added.length ? `Add ${added.map(n => n.data.title).join(', ')}` : removed.length ? `Delete ${removed.map(n => n.data.title).join(', ')}` : edges ? 'Change connections' : `${moved ? 'Move' : 'Edit'} ${changed.map(n => n.data.title).join(', ')}`;
  const key = `${moved ? 'move' : 'edit'}:${changed.map(n => n.id).join(',')}`;
  const time = Date.now();
  const last = s.past.at(-1);
  if (!added.length && !removed.length && !edges && last?.key === key && time - last.time < 700 && !s.future.length) {
    last.after = structuredClone(after); last.time = time;
  } else {
    s.past.push({ before: structuredClone(before), after: structuredClone(after), label, key, time });
    if (s.past.length > 40) s.past.shift();
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
  try { if (!apply(graph)) return false; } finally { replay = false; }
  for (let i = 0; i < count; i++) to.push(from.pop()!);
  notify();
  return true;
}
