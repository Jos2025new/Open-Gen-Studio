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
import { rfDrag } from './rf-drag-events';

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

const drag = rfDrag(() => flow.props);
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
  let mounted = true;
  const unmount = () => {
    if (!mounted) return;
    mounted = false;
    act(() => root.unmount());
    container.remove();
  };
  cleanups.push(unmount);
  act(() => root.render(createElement(NodeWorkspace)));
  return { sessionId: session.id, initialGraph, unmount };
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
    drag.start('n0', 'n2');
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
    drag.stop(['n0', 'n2']);

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

    drag.start('n0');
    act(() => {
      flow.props!.onNodesChange([{ id: 'n0', type: 'position', position: { x: 40, y: 20 }, dragging: true }]);
    });
    act(() => {
      flow.props!.onNodesChange([{ id: 'n0', type: 'position', position: { x: 0, y: 0 }, dragging: false }]);
    });
    drag.stop(['n0']);

    expect(graphPublications).toBe(0);
    expect(editSpy).not.toHaveBeenCalled();
    expect(graphHistory(sessionId, 'undo')).toHaveLength(0);
  });

  it('keeps two rapid drags of the same nodes (<700ms) as separate undo steps', () => {
    const { sessionId } = mountWorkspace(5);

    for (const p of [{ x: 100, y: 50 }, { x: 220, y: 90 }]) {
      drag.start('n0');
      act(() => {
        flow.props!.onNodesChange([{ id: 'n0', type: 'position', position: p, dragging: true }]);
        flow.props!.onNodesChange([{ id: 'n0', type: 'position', position: p, dragging: false }]);
      });
      drag.stop(['n0']);
    }

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
    drag.start('g0');
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
    // React Flow then stops the gesture on g0: the frame no longer exists, so nothing moves.
    drag.stop(['g0'], { g0: { x: initialFramePos.x + 80, y: initialFramePos.y + 40 } });
    const after = useStore.getState().sessions[sessionId].graph;
    expect(after.nodes.find((n) => n.id === 'n0')?.position).toEqual({ x: 0, y: 0 });
    expect(after.nodes.find((n) => n.id === 'n1')?.position).toEqual({ x: 260, y: 0 });
  });

  it('commits once and records 1 undo step when a multi-node drop arrives split across 2 batches', () => {
    const { sessionId } = mountWorkspace(5);
    let graphPublications = 0;
    cleanups.push(useStore.subscribe((next, prev) => {
      if (next.sessions[sessionId]?.graph !== prev.sessions[sessionId]?.graph) graphPublications++;
    }));
    const editSpy = vi.spyOn(edit, 'editPresentation');

    drag.start('n0', 'n1');
    act(() => {
      flow.props!.onNodesChange([
        { id: 'n0', type: 'position', position: { x: 100, y: 50 }, dragging: true },
        { id: 'n1', type: 'position', position: { x: 360, y: 50 }, dragging: true },
      ]);
    });
    expect(graphPublications).toBe(0);

    // First drop batch: n0 drops while n1 is still dragging.
    act(() => {
      flow.props!.onNodesChange([{ id: 'n0', type: 'position', dragging: false }]);
    });
    expect(graphPublications).toBe(0);
    expect(editSpy).not.toHaveBeenCalled();
    expect(flow.props!.nodes.find((n) => n.id === 'n0')?.position).toEqual({ x: 100, y: 50 });
    expect(flow.props!.nodes.find((n) => n.id === 'n1')?.position).toEqual({ x: 360, y: 50 });

    // Second drop batch: n1 drops; React Flow's stop event completes the gesture.
    act(() => {
      flow.props!.onNodesChange([{ id: 'n1', type: 'position', dragging: false }]);
    });
    expect(editSpy).not.toHaveBeenCalled();
    drag.stop(['n0', 'n1']);
    expect(graphPublications).toBe(1);
    expect(editSpy).toHaveBeenCalledTimes(1);
    expect(graphHistory(sessionId, 'undo')).toHaveLength(1);
    let after = useStore.getState().sessions[sessionId].graph;
    expect(after.nodes.find((n) => n.id === 'n0')?.position).toEqual({ x: 100, y: 50 });
    expect(after.nodes.find((n) => n.id === 'n1')?.position).toEqual({ x: 360, y: 50 });

    expect(travelGraph(sessionId, after, 'undo', 1, (g) => { after = g; return true; })).toBe(true);
    expect(after.nodes.find((n) => n.id === 'n0')?.position).toEqual({ x: 0, y: 0 });
    expect(after.nodes.find((n) => n.id === 'n1')?.position).toEqual({ x: 260, y: 0 });
  });

  it('discards hanging preview from an unfinished gesture when a new gesture starts', () => {
    const { sessionId } = mountWorkspace(5);

    // Gesture 1 on n0 (and partial drop on n1) loses its stop event.
    drag.start('n0', 'n1');
    act(() => {
      flow.props!.onNodesChange([
        { id: 'n0', type: 'position', position: { x: 150, y: 80 }, dragging: true },
        { id: 'n1', type: 'position', position: { x: 360, y: 80 }, dragging: true },
      ]);
      flow.props!.onNodesChange([{ id: 'n1', type: 'position', dragging: false }]);
    });
    expect(flow.props!.nodes.find((n) => n.id === 'n0')?.position).toEqual({ x: 150, y: 80 });
    expect(flow.props!.nodes.find((n) => n.id === 'n1')?.position).toEqual({ x: 360, y: 80 });

    // Gesture 2 starts on n2: hanging previews of n0 and n1 from the unfinished gesture are discarded.
    drag.start('n2');
    act(() => {
      flow.props!.onNodesChange([{ id: 'n2', type: 'position', position: { x: 600, y: 90 }, dragging: true }]);
    });
    expect(flow.props!.nodes.find((n) => n.id === 'n0')?.position).toEqual({ x: 0, y: 0 });
    expect(flow.props!.nodes.find((n) => n.id === 'n1')?.position).toEqual({ x: 260, y: 0 });
    expect(flow.props!.nodes.find((n) => n.id === 'n2')?.position).toEqual({ x: 600, y: 90 });

    act(() => {
      flow.props!.onNodesChange([{ id: 'n2', type: 'position', dragging: false }]);
    });
    drag.stop(['n2']);
    const after = useStore.getState().sessions[sessionId].graph;
    expect(after.nodes.find((n) => n.id === 'n0')?.position).toEqual({ x: 0, y: 0 });
    expect(after.nodes.find((n) => n.id === 'n1')?.position).toEqual({ x: 260, y: 0 });
    expect(after.nodes.find((n) => n.id === 'n2')?.position).toEqual({ x: 600, y: 90 });
  });

  it('keeps an in-flight gesture through Redo, Undo or a graph load, commits onto the graph in force, and ignores a late drop', () => {
    const { sessionId } = mountWorkspace(4);
    type P = { x: number; y: number };
    const rPos = (id: string) => flow.props!.nodes.find((n) => n.id === id)?.position;
    const sPos = (id: string) => useStore.getState().sessions[sessionId].graph.nodes.find((n) => n.id === id)?.position;
    const move = (id: string, p: P, dragging: boolean) => act(() => flow.props!.onNodesChange([{ id, type: 'position', position: p, dragging }]));
    const full = (id: string, p: P) => { drag.start(id); move(id, p, true); move(id, p, false); drag.stop([id]); };
    const travel = (dir: 'undo' | 'redo') => act(() => {
      const cur = useStore.getState().sessions[sessionId].graph;
      expect(travelGraph(sessionId, cur, dir, 1, (next) => edit.applyEdit({ session: sessionId, op: { op: 'travel', graph: next } }).ok)).toBe(true);
    });
    full('n0', { x: 100, y: 50 });
    full('n1', { x: 300, y: 40 });
    travel('undo');

    // Redo (of n1) while n0 is in flight: the preview stays; the drop lands on the redone graph.
    drag.start('n0');
    move('n0', { x: 220, y: 90 }, true);
    travel('redo');
    expect(rPos('n0')).toEqual({ x: 220, y: 90 });
    expect(rPos('n1')).toEqual({ x: 300, y: 40 });
    move('n0', { x: 220, y: 90 }, false);
    drag.stop(['n0']);
    expect([sPos('n0'), sPos('n1')]).toEqual([{ x: 220, y: 90 }, { x: 300, y: 40 }]);

    // Undo of the dragged node itself while in flight: the preview stays; the drop lands on the undone graph.
    drag.start('n0');
    move('n0', { x: 330, y: 95 }, true);
    travel('undo');
    expect(rPos('n0')).toEqual({ x: 330, y: 95 });
    move('n0', { x: 330, y: 95 }, false);
    drag.stop(['n0']);
    expect(sPos('n0')).toEqual({ x: 330, y: 95 });
    expect(graphHistory(sessionId, 'undo')).toHaveLength(3);

    // A gesture closed early (window blur, lost mouseup), then Undo of its node: React Flow's late drop is ignored.
    drag.start('n0');
    move('n0', { x: 360, y: 100 }, true);
    act(() => { window.dispatchEvent(new Event('blur')); });
    travel('undo');
    expect(rPos('n0')).toEqual({ x: 330, y: 95 });
    move('n0', { x: 360, y: 100 }, false);
    drag.stop(['n0'], { n0: { x: 360, y: 100 } });
    expect(sPos('n0')).toEqual({ x: 330, y: 95 });
    expect(graphHistory(sessionId, 'redo')).toHaveLength(1);

    // A graph load mid-gesture: the preview stays; the drop moves only n0 on the loaded graph.
    drag.start('n0');
    move('n0', { x: 400, y: 160 }, true);
    act(() => {
      const cur = useStore.getState().sessions[sessionId].graph;
      const loaded: Graph = { ...cur, nodes: cur.nodes.map((n) => (n.id === 'n0' ? { ...n, position: { x: 40, y: 60 } } : n.id === 'n2' ? { ...n, position: { x: 999, y: 0 } } : { ...n })) };
      useStore.setState((s) => ({ sessions: { ...s.sessions, [sessionId]: { ...s.sessions[sessionId], graph: loaded } } }));
    });
    expect(rPos('n0')).toEqual({ x: 400, y: 160 });
    expect(rPos('n2')).toEqual({ x: 999, y: 0 });
    move('n0', { x: 400, y: 160 }, false);
    drag.stop(['n0']);
    expect(sPos('n0')).toEqual({ x: 400, y: 160 });
    expect(sPos('n2')).toEqual({ x: 999, y: 0 });
  });

  it('commits both A and B in 1 write when A drops first and B moves again before dropping', () => {
    const { sessionId } = mountWorkspace(5);
    let graphPublications = 0;
    cleanups.push(useStore.subscribe((next, prev) => {
      if (next.sessions[sessionId]?.graph !== prev.sessions[sessionId]?.graph) graphPublications++;
    }));
    const editSpy = vi.spyOn(edit, 'editPresentation');

    drag.start('n0', 'n1');
    act(() => {
      flow.props!.onNodesChange([
        { id: 'n0', type: 'position', position: { x: 110, y: 55 }, dragging: true },
        { id: 'n1', type: 'position', position: { x: 350, y: 40 }, dragging: true },
      ]);
    });
    expect(graphPublications).toBe(0);

    // Node A (n0) drops while node B (n1) remains in the gesture.
    act(() => {
      flow.props!.onNodesChange([{ id: 'n0', type: 'position', dragging: false }]);
    });
    expect(graphPublications).toBe(0);
    expect(editSpy).not.toHaveBeenCalled();
    expect(flow.props!.nodes.find((n) => n.id === 'n0')?.position).toEqual({ x: 110, y: 55 });

    // Node B moves again before dropping; A's pending final position must stay intact.
    act(() => {
      flow.props!.onNodesChange([{ id: 'n1', type: 'position', position: { x: 420, y: 95 }, dragging: true }]);
    });
    expect(graphPublications).toBe(0);
    expect(editSpy).not.toHaveBeenCalled();
    expect(flow.props!.nodes.find((n) => n.id === 'n0')?.position).toEqual({ x: 110, y: 55 });
    expect(flow.props!.nodes.find((n) => n.id === 'n1')?.position).toEqual({ x: 420, y: 95 });

    // Node B drops and React Flow stops the gesture: both A and B commit in a single editPresentation.
    act(() => {
      flow.props!.onNodesChange([{ id: 'n1', type: 'position', dragging: false }]);
    });
    drag.stop(['n0', 'n1']);
    expect(graphPublications).toBe(1);
    expect(editSpy).toHaveBeenCalledTimes(1);
    expect(graphHistory(sessionId, 'undo')).toHaveLength(1);
    let after = useStore.getState().sessions[sessionId].graph;
    expect(after.nodes.find((n) => n.id === 'n0')?.position).toEqual({ x: 110, y: 55 });
    expect(after.nodes.find((n) => n.id === 'n1')?.position).toEqual({ x: 420, y: 95 });

    expect(travelGraph(sessionId, after, 'undo', 1, (g) => { after = g; return true; })).toBe(true);
    expect(after.nodes.find((n) => n.id === 'n0')?.position).toEqual({ x: 0, y: 0 });
    expect(after.nodes.find((n) => n.id === 'n1')?.position).toEqual({ x: 260, y: 0 });
  });

  it('discards an active gesture without writing when the canvas unmounts', () => {
    const { sessionId, unmount } = mountWorkspace(4);
    let graphPublications = 0;
    cleanups.push(useStore.subscribe((next, prev) => {
      if (next.sessions[sessionId]?.graph !== prev.sessions[sessionId]?.graph) graphPublications++;
    }));
    const editSpy = vi.spyOn(edit, 'editPresentation');

    drag.start('n0', 'n1');
    act(() => {
      flow.props!.onNodesChange([
        { id: 'n0', type: 'position', position: { x: 130, y: 65 }, dragging: true },
        { id: 'n1', type: 'position', position: { x: 390, y: 65 }, dragging: true },
      ]);
      flow.props!.onNodesChange([{ id: 'n0', type: 'position', dragging: false }]);
    });
    const staleOnNodesChange = flow.props!.onNodesChange;
    const staleProps = flow.props;

    unmount();
    act(() => {
      staleOnNodesChange([{ id: 'n1', type: 'position', position: { x: 390, y: 65 }, dragging: false }]);
    });
    rfDrag(() => staleProps).stop(['n0', 'n1'], { n0: { x: 130, y: 65 }, n1: { x: 390, y: 65 } });

    expect(graphPublications).toBe(0);
    expect(editSpy).not.toHaveBeenCalled();
    expect(graphHistory(sessionId, 'undo')).toHaveLength(0);
    const graphAfterUnmount = useStore.getState().sessions[sessionId].graph;
    expect(graphAfterUnmount.nodes.find((n) => n.id === 'n0')?.position).toEqual({ x: 0, y: 0 });
    expect(graphAfterUnmount.nodes.find((n) => n.id === 'n1')?.position).toEqual({ x: 260, y: 0 });
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
