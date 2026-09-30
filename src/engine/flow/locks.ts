import type { Graph } from '../types';
const locks = new Map<string, Set<string>[]>();
export function lockedNodes(sessionId: string): Set<string> {
  return new Set((locks.get(sessionId) ?? []).flatMap(s => [...s]));
}
export function lockNodes(sessionId: string, ids: string[]): () => void {
  const held = lockedNodes(sessionId);
  if (ids.some(id => held.has(id))) throw new Error('These nodes or their inputs are already running.');
  const set = new Set(ids);
  locks.set(sessionId, [...(locks.get(sessionId) ?? []), set]);
  return () => { locks.set(sessionId, (locks.get(sessionId) ?? []).filter(s => s !== set)); };
}
export function graphEditProblem(sessionId: string, before: Graph, after: Graph): string | null {
  const held = lockedNodes(sessionId);
  for (const id of held) {
    const a = before.nodes.find(n => n.id === id), b = after.nodes.find(n => n.id === id);
    const relevant = (n: typeof a) => {
      if (!n) return null;
      const { title: _title, ...data } = n.data;
      if ('generationId' in data) delete data.generationId;
      return data;
    };
    if (JSON.stringify(relevant(a)) !== JSON.stringify(relevant(b)) || JSON.stringify(before.edges.filter(e => e.target === id)) !== JSON.stringify(after.edges.filter(e => e.target === id))) {
      return 'This node or its inputs are in use by a running flow. Wait for it to finish.';
    }
  }
  return null;
}

const assetLocks = new Set<Set<string>>();
export function lockAssets(ids: string[]): () => void {
  const held = new Set(ids);
  assetLocks.add(held);
  return () => { assetLocks.delete(held); };
}
export function assetsInUse(ids: string[]): boolean {
  return [...assetLocks].some(held => ids.some(id => held.has(id)));
}
