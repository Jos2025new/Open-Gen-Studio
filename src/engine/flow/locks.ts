import type { Graph } from '../types';

/*
 * A node run holds the nodes it writes (the nodes it runs) and the nodes it reads (their inputs, up the graph).
 * Writing is exclusive; reading is shared: two runs may read the same input (a node and its duplicate share their
 * sources), but a node being written is never written or read by another run. Editing is always allowed (runs use a
 * snapshot); deleting a node being written waits.
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
/** Runs work on the graph as it was when they started, so edits are free; only deleting a node being generated waits. */
export function graphEditProblem(sessionId: string, _before: Graph, after: Graph): string | null {
  for (const id of writingNodes(sessionId)) {
    if (!after.nodes.some(n => n.id === id)) return 'This node is generating. Wait for it to finish before deleting it.';
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
