import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../store/store';
import { groupBounds, type Sizes } from '../../engine/flow/arrange';
import { groupNotices, type NoticeSummary, type CableNotice, type GraphNotice, type PortNotice } from '../../engine/flow/notices';
import { NODE_WIDTH, runsGeneration } from '../../engine/flow/graph';
import type { Asset, Graph, GraphNode } from '../../engine/types';
import { flowEdges } from './LinkBar';
import { NOTICE_IN, NOTICE_OUT } from './CanvasNotices';
import { omniWidth } from '../omni/RefNode';
import type { FlowNode } from './nodes';
import type { GroupFlowNode } from './Operations';

export function closedGroupNotices(groups: Graph['groups'], closed: ReadonlySet<string>, notices: GraphNotice[]) {
  return new Map((groups ?? []).filter(group => closed.has(group.id)).map(group =>
    [group.id, groupNotices(notices, group.nodeIds)]));
}

export function canvasGroups(graph: Graph, measured: Sizes, sessionId: string, closed: ReadonlySet<string>,
  summaries: ReadonlyMap<string, NoticeSummary>, toggle: (groupId: string) => void): { frames: GroupFlowNode[]; hidden: Set<string> } {
  const hidden = new Set<string>();
  const frames = (graph.groups ?? []).flatMap((group): GroupFlowNode[] => {
    const b = groupBounds(graph, group, measured);
    if (!b) return [];
    const collapsed = closed.has(group.id);
    if (collapsed) group.nodeIds.forEach(id => hidden.add(id));
    const summary = summaries.get(group.id);
    const width = collapsed ? 200 : b.width;
    const height = collapsed ? 32 : b.height;
    return [{
      id: group.id,
      type: 'group',
      position: { x: b.x, y: b.y },
      data: { group, sessionId, collapsed, problems: summary?.count ?? 0, hasErrors: summary?.hasErrors, toggle },
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
  revision: Graph;
  selected: Set<string>;
  selectedEdges: Set<string>;
  measured: Map<string, { width: number; height: number }>;
  frames: GroupFlowNode[];
  hidden: Set<string>;
  byPort: Map<string, PortNotice[]>;
  byCable: Map<string, CableNotice>;
  spaceProblems: NoticeSummary;
  sessionId: string;
  omni: boolean;
  embedded: boolean;
}

const NO_IDS = new Set<string>();

export function useCanvasElements({ graph, revision, assets, selected, selectedEdges, measured, frames, hidden,
  byPort, byCable, spaceProblems, sessionId, omni, embedded }: CanvasElements) {
  const stableHidden = useShallow((ids: Set<string>) => ids)(hidden);
  const baseEdges = useMemo(() => flowEdges(revision, assets, NO_IDS, NO_IDS, byCable, sessionId, stableHidden),
    [revision, assets, byCable, sessionId, stableHidden]);
  const runningNodes = useMemo(() => revision.nodes.flatMap(({ id, data }) =>
    runsGeneration(data) && data.generationId ? [{ id, generationId: data.generationId }] : []), [revision]);
  const running = useStore(useShallow(s => runningNodes.flatMap(({ id, generationId }) => {
    const status = s.generations[generationId]?.status;
    return status === 'queued' || status === 'running' ? [id] : [];
  })));
  const edges = useMemo(() => {
    const busy = new Set(running);
    return baseEdges.map(edge => {
      const animated = edge.type !== 'notice' && busy.has(edge.target);
      const selected = selectedEdges.has(edge.id);
      return animated || selected ? { ...edge, animated, selected } : edge;
    });
  }, [baseEdges, running, selectedEdges]);

  const anchors = useMemo(() => {
    const inputs = new Set<string>();
    const outputs = new Set<string>();
    for (const edge of baseEdges) {
      if (edge.targetHandle === NOTICE_IN) inputs.add(edge.target);
      if (edge.sourceHandle === NOTICE_OUT) outputs.add(edge.source);
    }
    return { inputs, outputs };
  }, [baseEdges]);
  const noticeIn = useShallow((ids: Set<string>) => ids)(anchors.inputs);
  const noticeOut = useShallow((ids: Set<string>) => ids)(anchors.outputs);
  const soloId = useMemo(() => {
    let only: string | undefined;
    for (const n of revision.nodes) if (selected.has(n.id) && !stableHidden.has(n.id)) {
      if (only) return undefined;
      only = n.id;
    }
    return only;
  }, [revision, selected, stableHidden]);
  const cardCache = useMemo(() => new WeakMap<GraphNode, FlowNode>(), []);
  const nodes = useMemo(() => {
    const cards = graph.nodes.map(n => {
      const space = n.data.kind === 'ref' && n.data.type === 'space';
      const hidden = stableHidden.has(n.id);
      const selectedHere = selected.has(n.id) && !hidden;
      const solo = soloId === n.id;
      const missing = byPort.get(n.id);
      const input = noticeIn.has(n.id), output = noticeOut.has(n.id);
      const count = space ? spaceProblems.count : undefined;
      const hasErrors = space ? spaceProblems.hasErrors : undefined;
      const size = measured.get(n.id);
      const width = omni ? omniWidth(n.data, NODE_WIDTH) : NODE_WIDTH;
      const old = cardCache.get(n);
      if (old && old.selected === selectedHere && old.hidden === hidden && old.measured === size &&
          old.data.solo === solo && old.data.panel === !embedded && old.data.missing === missing &&
          old.data.noticeIn === input && old.data.noticeOut === output &&
          old.data.spaceProblems === count && old.data.spaceHasErrors === hasErrors &&
          old.width === width) return old;
      const card: FlowNode = {
        id: n.id,
        type: 'studio',
        position: n.position,
        data: { node: n, solo, panel: !embedded, missing, noticeIn: input, noticeOut: output,
          spaceProblems: count, spaceHasErrors: hasErrors },
        selected: selectedHere,
        hidden,
        width,
        measured: size,
      };
      cardCache.set(n, card);
      return card;
    });
    return [...(frames as unknown as FlowNode[]), ...cards];
  }, [graph.nodes, frames, stableHidden, noticeIn, noticeOut, selected, soloId, measured, byPort, spaceProblems, omni, embedded, cardCache]);
  return { nodes, edges };
}
