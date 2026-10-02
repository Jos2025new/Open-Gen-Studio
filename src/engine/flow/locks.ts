import type { Graph } from '../types';

/*
 * A node run holds the nodes it writes (the nodes it runs) and the nodes it reads (their inputs, up the graph).
 * Writing is exclusive; reading is shared: two runs may read the same input (a node and its duplicate share their
 * sources), but a node being written is never written or read by another run. Editing any held node waits.
 */
interface Held { writes: Set<string>; reads: Set<string> }
const locks = new Map<string, Held[]>();

/** Every node a run holds (read or written): these cannot be edited until it ends. */
export function lockedNodes(sessionId: string): Set<string> {
  return new Set((locks.get(sessionId) ?? []).flatMap(h => [...h.writes, ...h.reads]));
}
/** Nodes some run is writing (generating now). */
export function writingNodes(sessionId: string): Set<string> {
  return new Set((locks.get(sessionId) ?? []).flatMap(h => [...h.writes]));
}
export function lockNodes(sessionId: string, writes: string[], reads: string[] = writes): () => void {
  const all = lockedNodes(sessionId), writing = writingNodes(sessionId);
  if (writes.some(id => all.has(id)) || reads.some(id => writing.has(id))) throw new Error('These nodes or their inputs are already running.');
  const held: Held = { writes: new Set(writes), reads: new Set(reads.filter(id => !writes.includes(id))) };
  locks.set(sessionId, [...(locks.get(sessionId) ?? []), held]);
  return () => { locks.set(sessionId, (locks.get(sessionId) ?? []).filter(h => h !== held)); };
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
