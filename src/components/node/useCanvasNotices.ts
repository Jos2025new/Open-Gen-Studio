import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { countNotices, graphNotices, type CableNotice, type PortNotice } from '../../engine/flow/notices';
import { sessionChatText } from '../../engine/nodecore/resolver';
import { ordinaryGraph } from '../../engine/nodes/omniSpaces';
import type { Graph } from '../../engine/types';
import { useStore } from '../../store/store';

export function useCanvasNotices(fullGraph: Graph, visibleGraph: Graph) {
  const assets = useStore(s => s.assets);
  const generations = useStore(s => s.generations);
  const externalText = useStore(useShallow(() => fullGraph.nodes
    .filter(node => node.data.kind === 'ref')
    .map(node => sessionChatText(node))));
  return useMemo(() => {
    const refIds = fullGraph.nodes.filter(n => n.data.kind === 'ref').map(n => n.id);
    const text = new Map(refIds.map((id, i) => [id, externalText[i]]));
    const all = graphNotices(fullGraph, { assets, generations, chatText: node => text.get(node.id) });
    const nodeIds = new Set(visibleGraph.nodes.map(n => n.id));
    const edgeIds = new Set(visibleGraph.edges.map(e => e.id));
    const notices = all.filter(n => nodeIds.has(n.nodeId) && (n.kind === 'port' || edgeIds.has(n.edgeId)));
    const byPort = new Map<string, PortNotice[]>();
    const byCable = new Map<string, CableNotice>();
    for (const notice of notices) {
      if (notice.kind === 'port') byPort.set(notice.nodeId, [...(byPort.get(notice.nodeId) ?? []), notice]);
      else byCable.set(notice.edgeId, notice);
    }
    const ordinary = ordinaryGraph(fullGraph);
    const ordinaryEdges = new Set(ordinary.edges.map(e => e.id));
    const spaceProblems = countNotices(all.filter(n => n.kind === 'port' || ordinaryEdges.has(n.edgeId)), ordinary.nodes.map(n => n.id));
    return { notices, byPort, byCable, spaceProblems };
  }, [fullGraph, visibleGraph, assets, generations, externalText]);
}
