import { useRef } from 'react';
import { useStore } from '../../store/store';
import type { Graph } from '../../engine/types';

/**
 * The ids of the cards that came with the saved graph (or once it is hydrated): they keep their saved position and are
 * never settled. Deleted ids drop out, so undoing a deletion settles the restored card like a new one.
 */
export function useLoadedIds(sessionId: string, graph: Graph): { current: { ids: Set<string> } | null } {
  const hydrated = useStore((s) => s.hydrated);
  const loadedRef = useRef<{ sessionId: string; hydrated: boolean; ids: Set<string> } | null>(null);
  if (loadedRef.current?.sessionId !== sessionId || (!loadedRef.current.hydrated && hydrated)) {
    loadedRef.current = { sessionId, hydrated, ids: new Set(graph.nodes.map((n) => n.id)) };
  } else if (loadedRef.current.ids.size) {
    const live = new Set(graph.nodes.map((n) => n.id));
    for (const id of loadedRef.current.ids) if (!live.has(id)) loadedRef.current.ids.delete(id);
  }
  return loadedRef;
}
