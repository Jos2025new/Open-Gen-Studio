import type { Generation, Session } from '../types';
import { GONE_HANDLE, NO_RESULT, resultHandle } from './graph';

/**
 * Remove deleted assets from their generations AND move every Nodes index that points into them, so each node pick and
 * each fixed link keeps delivering the same image. A pick whose image is gone falls back to the nearest result; a link
 * whose image is gone is marked NO_RESULT (no output, for good) instead of jumping to another image, now or after a regeneration.
 */
export function dropResults<S extends { generations: Record<string, Generation>; sessions: Record<string, Session> }>(st: S, gone: Set<string>): { generations: Record<string, Generation>; sessions: Record<string, Session> } {
  const generations = { ...st.generations };
  const moved = new Map<string, { to: number[]; len: number }>();
  for (const g of Object.values(st.generations)) {
    if (!g.assetIds.some((a) => gone.has(a))) continue;
    const kept = g.assetIds.filter((a) => !gone.has(a));
    let n = 0;
    moved.set(g.id, { to: g.assetIds.map((a) => (gone.has(a) ? -1 : n++)), len: kept.length });
    generations[g.id] = { ...g, assetIds: kept };
  }
  if (!moved.size) return { generations, sessions: st.sessions };
  const sessions = { ...st.sessions };
  for (const [sid, s] of Object.entries(st.sessions)) {
    const graph = s.graph;
    if (!graph) continue;
    const gen = new Map<string, string>();
    let changed = false;
    const nodes = graph.nodes.map((n) => {
      const d = n.data as { generationId?: string; outputIndex?: number };
      const m = d.generationId ? moved.get(d.generationId) : undefined;
      if (!m || d.outputIndex == null) return n;
      gen.set(n.id, d.generationId!);
      const to = m.to[d.outputIndex];
      const next = to == null ? d.outputIndex : to >= 0 ? to : Math.max(0, Math.min(d.outputIndex, m.len - 1));
      if (next === d.outputIndex) return n;
      changed = true;
      return { ...n, data: { ...n.data, outputIndex: next } } as typeof n;
    });
    const edges = graph.edges.map((e) => {
      const m = gen.has(e.source) ? moved.get(gen.get(e.source)!) : undefined;
      if (!m || e.outputIndex == null || e.outputIndex === NO_RESULT) return e;
      const to = m.to[e.outputIndex];
      const next = to == null ? e.outputIndex : to >= 0 ? to : NO_RESULT;
      if (next === e.outputIndex) return e;
      changed = true;
      return { ...e, outputIndex: next, sourceHandle: next === NO_RESULT ? GONE_HANDLE : resultHandle(next) };
    });
    if (changed) sessions[sid] = { ...s, graph: { ...graph, nodes, edges } };
  }
  return { generations, sessions };
}
