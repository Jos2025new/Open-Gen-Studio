// @vitest-environment jsdom
import { act, createElement, Fragment, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Edge, EdgeChange, Node, NodeChange, NodeTypes } from '@xyflow/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NodeWorkspace } from '../src/components/node/NodeWorkspace';
import { nodeGenerationHistory } from '../src/components/node/nodes';
import * as edit from '../src/engine/nodecore/edit';
import { ungroup } from '../src/engine/flow/arrange';
import { graphHistory, travelGraph } from '../src/engine/flow/history';
import { storeHooks } from '../src/engine/storeBindings';
import type { Generation, Graph, GraphNode } from '../src/engine/types';
import { createSession, useStore } from '../src/store/store';

const flow = vi.hoisted(() => ({
  props: null as null | {
    nodes: Node[];
    edges: Edge[];
    children: ReactNode;
    onNodesChange(changes: NodeChange[]): void;
    onEdgesChange(changes: EdgeChange[]): void;
  },
}));

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>();
  return {
    ...actual,
    ReactFlow(props: NonNullable<typeof flow.props> & { nodeTypes: NodeTypes }) {
      flow.props = props;
      return createElement(
        Fragment,
        null,
        props.children,
        ...props.nodes
          .filter((n) => !n.hidden)
          .map((n) =>
            createElement(props.nodeTypes[n.type!], {
              ...n,
              key: n.id,
              type: n.type!,
              selected: Boolean(n.selected),
              dragging: false,
              draggable: n.draggable ?? true,
              selectable: n.selectable ?? true,
              deletable: n.deletable ?? true,
              isConnectable: n.connectable ?? true,
              zIndex: n.zIndex ?? 0,
              positionAbsoluteX: n.position.x,
              positionAbsoluteY: n.position.y,
            }),
          ),
      );
    },
    useReactFlow: () => ({ fitView: vi.fn(), screenToFlowPosition: (p: { x: number; y: number }) => p, zoomIn: vi.fn(), zoomOut: vi.fn(), zoomTo: vi.fn() }),
    useViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    useConnection: () => false,
    useUpdateNodeInternals: () => () => {},
    useStore: (sel: (s: { transform: [number, number, number] }) => unknown) => sel({ transform: [0, 0, 1] }),
    Background: () => null,
    MiniMap: () => null,
    Panel: ({ children }: { children?: ReactNode }) => createElement('div', null, children),
    Handle: () => null,
    NodeToolbar: ({ children }: { children?: ReactNode }) => createElement('div', null, children),
  };
});

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  peekAssetUrl: () => undefined,
  loadAssetUrl: async () => undefined,
}));

function makeGraph(count: number): Graph {
  const nodes: GraphNode[] = Array.from({ length: count }, (_, i) => ({
    id: `n${i}`,
    position: { x: (i % 10) * 260, y: Math.floor(i / 10) * 180 },
    data: { kind: 'text', title: `Node ${i}`, text: `Prompt ${i}` },
  }));
  const edges = count > 1
    ? [{ id: 'e0', source: 'n0', sourceHandle: 'out', target: 'n1', targetHandle: 'in' }]
    : [];
  return {
    nodes,
    edges,
    groups: count >= 2 ? [{ id: 'g0', title: 'Group', nodeIds: ['n0', 'n1'] }] : undefined,
  };
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  vi.restoreAllMocks();
});

function mountWorkspace(count: number) {
  const session = createSession(`drag-${count}-${Math.random()}`);
  const initialGraph = makeGraph(count);
  useStore.setState((s) => ({
    activeSessionId: session.id,
    generations: {},
    assets: {},
    sessions: { ...s.sessions, [session.id]: { ...session, graph: initialGraph, feed: [] } },
  }));
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  act(() => root.render(createElement(NodeWorkspace)));
  return { sessionId: session.id, initialGraph };
}

describe('node drag publication counts', () => {
  it.each([20, 200])('publishes 0 graph writes during %i-node drag and 1 on drop, undone in one step', (count) => {
    const { sessionId } = mountWorkspace(count);
    let graphPublications = 0;
    let sessionPublications = 0;
    const unsub = useStore.subscribe((next, prev) => {
      const nSess = next.sessions[sessionId];
      const pSess = prev.sessions[sessionId];
      if (nSess !== pSess) sessionPublications++;
      if (nSess?.graph !== pSess?.graph) graphPublications++;
    });
    cleanups.push(unsub);
    const editSpy = vi.spyOn(edit, 'editPresentation');
    const recordSpy = vi.spyOn(storeHooks, 'recordGraph');

    // Simulate 15 drag frames across two selected nodes.
    for (let step = 1; step <= 15; step++) {
      act(() => {
        flow.props!.onNodesChange([
          { id: 'n0', type: 'position', position: { x: step * 5, y: step * 3 }, dragging: true },
          { id: 'n2', type: 'position', position: { x: 520 + step * 5, y: step * 3 }, dragging: true },
        ]);
      });
    }

    expect(graphPublications).toBe(0);
    expect(sessionPublications).toBe(0);
    expect(editSpy).not.toHaveBeenCalled();
    expect(recordSpy).not.toHaveBeenCalled();
    expect(flow.props!.nodes.find((n) => n.id === 'n0')?.position).toEqual({ x: 75, y: 45 });
    expect(flow.props!.nodes.find((n) => n.id === 'n2')?.position).toEqual({ x: 595, y: 45 });
    // Group frame follows dragged member during preview (n0 moved from x=0 to x=75, pad=28 -> frame x=47).
    expect(flow.props!.nodes.find((n) => n.id === 'g0' && n.type === 'group')?.position.x).toBe(47);

    // Drop commits exactly once.
    act(() => {
      flow.props!.onNodesChange([
        { id: 'n0', type: 'position', position: { x: 75, y: 45 }, dragging: false },
        { id: 'n2', type: 'position', position: { x: 595, y: 45 }, dragging: false },
      ]);
    });

    expect(graphPublications).toBe(1);
    expect(sessionPublications).toBe(1);
    expect(editSpy).toHaveBeenCalledTimes(1);
    expect(recordSpy).toHaveBeenCalledTimes(1);
    expect(graphHistory(sessionId, 'undo')).toHaveLength(1);
    const afterDrop = useStore.getState().sessions[sessionId].graph;
    expect(afterDrop.nodes.find((n) => n.id === 'n0')?.position).toEqual({ x: 75, y: 45 });
    expect(afterDrop.nodes.find((n) => n.id === 'n2')?.position).toEqual({ x: 595, y: 45 });

    // One undo restores the whole multi-node gesture.
    let undone!: Graph;
    expect(travelGraph(sessionId, afterDrop, 'undo', 1, (g) => { undone = g; return true; })).toBe(true);
    expect(undone.nodes.find((n) => n.id === 'n0')?.position).toEqual({ x: 0, y: 0 });
    expect(undone.nodes.find((n) => n.id === 'n2')?.position).toEqual({ x: 520, y: 0 });
  });

  it('skips editPresentation when a drag ends with zero net displacement', () => {
    const { sessionId } = mountWorkspace(20);
    let graphPublications = 0;
    const unsub = useStore.subscribe((next, prev) => {
      if (next.sessions[sessionId]?.graph !== prev.sessions[sessionId]?.graph) graphPublications++;
    });
    cleanups.push(unsub);
    const editSpy = vi.spyOn(edit, 'editPresentation');

    act(() => {
      flow.props!.onNodesChange([{ id: 'n0', type: 'position', position: { x: 40, y: 20 }, dragging: true }]);
    });
    act(() => {
      flow.props!.onNodesChange([{ id: 'n0', type: 'position', position: { x: 0, y: 0 }, dragging: false }]);
    });

    expect(graphPublications).toBe(0);
    expect(editSpy).not.toHaveBeenCalled();
    expect(graphHistory(sessionId, 'undo')).toHaveLength(0);
  });

  it('keeps two rapid drags of the same nodes (<700ms) as separate undo steps', () => {
    const { sessionId } = mountWorkspace(5);

    act(() => {
      flow.props!.onNodesChange([{ id: 'n0', type: 'position', position: { x: 100, y: 50 }, dragging: true }]);
      flow.props!.onNodesChange([{ id: 'n0', type: 'position', position: { x: 100, y: 50 }, dragging: false }]);
    });
    act(() => {
      flow.props!.onNodesChange([{ id: 'n0', type: 'position', position: { x: 220, y: 90 }, dragging: true }]);
      flow.props!.onNodesChange([{ id: 'n0', type: 'position', position: { x: 220, y: 90 }, dragging: false }]);
    });

    expect(graphHistory(sessionId, 'undo')).toHaveLength(2);
    let after = useStore.getState().sessions[sessionId].graph;
    expect(travelGraph(sessionId, after, 'undo', 1, (g) => { after = g; return true; })).toBe(true);
    expect(after.nodes.find((n) => n.id === 'n0')?.position).toEqual({ x: 100, y: 50 });
    expect(travelGraph(sessionId, after, 'undo', 1, (g) => { after = g; return true; })).toBe(true);
    expect(after.nodes.find((n) => n.id === 'n0')?.position).toEqual({ x: 0, y: 0 });
  });

  it('clears member drag previews if the group frame disappears mid-drag', () => {
    const { sessionId } = mountWorkspace(5);

    // Frame g0 wraps n0 (x:0,y:0) and n1 (x:260,y:0). With default NODE_WIDTH=240/220 and pad=28, frame starts at x=-28, y=-46.
    const initialFramePos = flow.props!.nodes.find((n) => n.id === 'g0' && n.type === 'group')!.position;
    act(() => {
      flow.props!.onNodesChange([
        { id: 'g0', type: 'position', position: { x: initialFramePos.x + 80, y: initialFramePos.y + 40 }, dragging: true },
      ]);
    });
    expect(flow.props!.nodes.find((n) => n.id === 'n0')?.position).toEqual({ x: 80, y: 40 });
    expect(flow.props!.nodes.find((n) => n.id === 'n1')?.position).toEqual({ x: 340, y: 40 });

    // Group is ungrouped mid-drag, then the drag gesture ends/cancels on g0.
    act(() => {
      ungroup(sessionId, 'g0');
      flow.props!.onNodesChange([
        { id: 'g0', type: 'position', position: { x: initialFramePos.x + 80, y: initialFramePos.y + 40 }, dragging: false },
      ]);
    });

    expect(flow.props!.nodes.find((n) => n.id === 'n0')?.position).toEqual({ x: 0, y: 0 });
    expect(flow.props!.nodes.find((n) => n.id === 'n1')?.position).toEqual({ x: 260, y: 0 });
  });

  it('preserves main generation history tie-breaking order when current is outside the node bucket', () => {
    const base = { kind: 'image' as const, status: 'done' as const, prompt: 'p', modelRef: 'm', modelName: 'Model', provider: 'atlas' as const, origin: 'node' as const, estimate: {} as Generation['estimate'], settings: { count: 1, advanced: {} }, inputs: { refs: [] }, assetIds: ['a1'] };
    const generations: Record<string, Generation> = {
      gCur: { ...base, id: 'gCur', sessionId: 'other', stepId: 'otherNode', createdAt: 1000 },
      gOwn: { ...base, id: 'gOwn', sessionId: 's1', stepId: 'n1', createdAt: 1000 },
    };
    const history = nodeGenerationHistory(generations, 's1', 'n1', 'gCur');
    expect(history.map((g) => g.id)).toEqual(['gCur', 'gOwn']);
  });
});
