import { useMemo } from 'react';
import { groupBounds, type Sizes } from '../../engine/flow/arrange';
import { countNotices, type CableNotice, type GraphNotice, type PortNotice } from '../../engine/flow/notices';
import { NODE_WIDTH, runsGeneration } from '../../engine/flow/graph';
import type { Asset, Generation, Graph } from '../../engine/types';
import { flowEdges } from './LinkBar';
import { NOTICE_IN, NOTICE_OUT } from './CanvasNotices';
import { omniWidth } from '../omni/RefNode';
import type { FlowNode } from './nodes';
import type { GroupFlowNode } from './Operations';

export function canvasGroups(graph: Graph, measured: Sizes, sessionId: string, closed: ReadonlySet<string>,
  notices: GraphNotice[], toggle: (groupId: string) => void): { frames: GroupFlowNode[]; hidden: Set<string> } {
  const hidden = new Set<string>();
  const frames = (graph.groups ?? []).flatMap((group): GroupFlowNode[] => {
    const b = groupBounds(graph, group, measured);
    if (!b) return [];
    const collapsed = closed.has(group.id);
    if (collapsed) group.nodeIds.forEach(id => hidden.add(id));
    const width = collapsed ? 200 : b.width;
    const height = collapsed ? 32 : b.height;
    return [{
      id: group.id,
      type: 'group',
      position: { x: b.x, y: b.y },
      data: { group, sessionId, collapsed, problems: collapsed ? countNotices(notices, group.nodeIds) : 0, toggle },
      width,
      height,
      measured: { width, height },
      zIndex: collapsed ? 1 : -1,
      draggable: true,
      selectable: !collapsed,
      connectable: false,
      style: { width, height },
    }];
  });
  return { frames, hidden };
}

interface CanvasElements {
  graph: Graph;
  assets: Record<string, Asset>;
  generations: Record<string, Generation>;
  selected: Set<string>;
  selectedEdges: Set<string>;
  measured: Map<string, { width: number; height: number }>;
  frames: GroupFlowNode[];
  hidden: Set<string>;
  byPort: Map<string, PortNotice[]>;
  byCable: Map<string, CableNotice>;
  spaceProblems: number;
  sessionId: string;
  omni: boolean;
  embedded: boolean;
}

export function useCanvasElements({ graph, assets, generations, selected, selectedEdges, measured, frames, hidden,
  byPort, byCable, spaceProblems, sessionId, omni, embedded }: CanvasElements) {
  const edges = useMemo(() => {
    const running = new Set(graph.nodes.filter(n => runsGeneration(n.data) && n.data.generationId &&
      ['running', 'queued'].includes(generations[n.data.generationId]?.status)).map(n => n.id));
    return flowEdges(graph, assets, running, selectedEdges, byCable, sessionId, hidden);
  }, [graph, generations, assets, selectedEdges, byCable, sessionId, hidden]);

  const nodes = useMemo(() => {
    const solo = graph.nodes.filter(n => selected.has(n.id) && !hidden.has(n.id)).length === 1;
    const noticeIn = new Set(edges.filter(e => e.targetHandle === NOTICE_IN).map(e => e.target));
    const noticeOut = new Set(edges.filter(e => e.sourceHandle === NOTICE_OUT).map(e => e.source));
    const cards: FlowNode[] = graph.nodes.map(n => ({
      id: n.id,
      type: 'studio',
      position: n.position,
      data: { node: n, solo, panel: !embedded, missing: byPort.get(n.id),
        noticeIn: noticeIn.has(n.id), noticeOut: noticeOut.has(n.id),
        spaceProblems: n.data.kind === 'ref' && n.data.type === 'space' ? spaceProblems : undefined },
      selected: selected.has(n.id) && !hidden.has(n.id),
      hidden: hidden.has(n.id),
      width: omni ? omniWidth(n.data, NODE_WIDTH) : NODE_WIDTH,
      measured: measured.get(n.id),
    }));
    return [...(frames as unknown as FlowNode[]), ...cards];
  }, [graph.nodes, frames, hidden, edges, selected, measured, byPort, spaceProblems, omni, embedded]);
  return { nodes, edges };
}
