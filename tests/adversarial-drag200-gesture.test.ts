// @vitest-environment jsdom
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { act, createElement, useRef, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Edge, EdgeChange, Node, NodeChange, NodeTypes } from '@xyflow/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NodeWorkspace } from '../src/components/node/NodeWorkspace';
import type { FlowNode } from '../src/components/node/nodes';
import { liveGroupsMap, useNodeDrag } from '../src/components/node/useNodeDrag';
import { deleteNodes } from '../src/engine/flow/actions';
import { ungroup } from '../src/engine/flow/arrange';
import { graphHistory, travelGraph } from '../src/engine/flow/history';
import * as edit from '../src/engine/nodecore/edit';
import type { Graph, GraphNode } from '../src/engine/types';
import { createSession, useStore } from '../src/store/store';
import { check as checkNodeDrag } from '../scripts/check-node-drag.mjs';
import { arrowKey, rfDrag } from './rf-drag-events';

const flow = vi.hoisted(() => ({
  props: null as null | {
    nodes: Node[];
    edges: Edge[];
    children: ReactNode;
    onNodesChange(changes: NodeChange[]): void;
    onEdgesChange(changes: EdgeChange[]): void;
  },
}));

vi.mock('@xyflow/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@xyflow/react')>()),
  ReactFlow(p: NonNullable<typeof flow.props> & { nodeTypes: NodeTypes }) {
    flow.props = p;
    return createElement(
      'div',
      { className: 'react-flow__pane' },
      p.children,
      ...p.nodes.filter((n) => !n.hidden).map((n) =>
        createElement(p.nodeTypes[n.type!], {
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
  useReactFlow: () => ({ fitView: vi.fn(), screenToFlowPosition: (p: { x: number; y: number }) => p, zoomIn: vi.fn(), zoomOut: vi.fn(), zoomTo: vi.fn(), getZoom: () => 1, getNodes: () => [] }),
  useOnViewportChange: () => {},
  useViewport: () => ({ x: 0, y: 0, zoom: 1 }),
  useConnection: () => false,
  useUpdateNodeInternals: () => () => {},
  useStore: (sel: (s: { transform: [number, number, number] }) => unknown) => sel({ transform: [0, 0, 1] }),
  Background: () => null,
  MiniMap: () => null,
  Handle: () => null,
  Panel: ({ children, ...r }: { children?: ReactNode } & Record<string, unknown>) => createElement('div', r, children),
  NodeToolbar: ({ isVisible = true, children }: { isVisible?: boolean; children?: ReactNode }) => (isVisible ? createElement('div', null, children) : null),
}));

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  peekAssetUrl: () => undefined,
  loadAssetUrl: async () => undefined,
}));

if (typeof globalThis.ResizeObserver === 'undefined') {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

type Pt = { x: number; y: number };
const pt = (x: number, y: number): Pt => ({ x, y });
const tNode = (id: string, x: number, y: number, title = id): GraphNode => ({ id, position: pt(x, y), data: { kind: 'text', title, text: title } });
const makeGraph = (count = 5, twoGroups = false): Graph => ({
  nodes: Array.from({ length: count }, (_, i) => tNode(`n${i}`, i * 260, 0, `N${i}`)),
  edges: count > 1 ? [{ id: 'e0', source: 'n0', sourceHandle: 'out', target: 'n1', targetHandle: 'in' }] : [],
  groups: twoGroups && count >= 4
    ? [{ id: 'g0', title: 'G0', nodeIds: ['n0', 'n1'] }, { id: 'g1', title: 'G1', nodeIds: ['n2', 'n3'] }]
    : count >= 2
      ? [{ id: 'g0', title: 'G0', nodeIds: ['n0', 'n1'] }]
      : undefined,
});

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  vi.restoreAllMocks();
});

function mountCanvas(graph: Graph) {
  const s = createSession(`adv-gest-${Math.random()}`);
  useStore.setState((st) => ({
    activeSessionId: s.id,
    generations: {},
    assets: {},
    sessions: { ...st.sessions, [s.id]: { ...s, graph, feed: [] } },
  }));
  const el = document.createElement('div');
  document.body.append(el);
  const root = createRoot(el);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let mounted = true;
  const unmount = () => {
    if (!mounted) return;
    mounted = false;
    act(() => root.unmount());
    el.remove();
  };
  cleanups.push(unmount);
  act(() => root.render(createElement(NodeWorkspace)));
  return { sid: s.id, unmount };
}

const sGraph = (sid: string) => useStore.getState().sessions[sid].graph;
const sPos = (sid: string, id: string) => sGraph(sid).nodes.find((n) => n.id === id)?.position;
const rPos = (id: string) => flow.props!.nodes.find((n) => n.id === id)?.position;
const pCh = (id: string, dragging: boolean, position?: Pt): NodeChange<FlowNode> => ({ id, type: 'position', dragging, ...(position ? { position } : {}) });
const onCh = (cs: NodeChange[]) => act(() => flow.props!.onNodesChange(cs));
// React Flow bounds every pointer gesture with onNodeDragStart / onNodeDragStop; the batches below happen in between.
const drag = rfDrag(() => flow.props);
const tr = (sid: string, dir: 'undo' | 'redo') =>
  travelGraph(sid, sGraph(sid), dir, 1, (next) => edit.applyEdit({ session: sid, op: { op: 'travel', graph: next } }).ok);

function watchWrites(sid: string) {
  let count = 0;
  cleanups.push(useStore.subscribe((n, p) => {
    if (n.sessions[sid]?.graph !== p.sessions[sid]?.graph) count++;
  }));
  return () => count;
}

describe('Gesture attack 1: lifecycle, split drops, autopan, rapid gestures', () => {
  it('commits 3-node split drop with interleaved moves in 1 write and 1 undo step', () => {
    const { sid } = mountCanvas(makeGraph(5));
    const writes = watchWrites(sid);
    const editSpy = vi.spyOn(edit, 'editPresentation');

    drag.start('n0', 'n1', 'n2');
    onCh([pCh('n0', true, pt(40, 20)), pCh('n1', true, pt(300, 20)), pCh('n2', true, pt(560, 20))]);
    onCh([pCh('n0', false)]);
    onCh([pCh('n1', true, pt(340, 50)), pCh('n2', true, pt(600, 50))]);
    onCh([pCh('n1', false)]);
    onCh([pCh('n2', true, pt(660, 90))]);
    expect(writes()).toBe(0);
    expect(editSpy).not.toHaveBeenCalled();

    onCh([pCh('n2', false)]);
    expect(writes()).toBe(0);
    drag.stop(['n0', 'n1', 'n2']);
    expect(writes()).toBe(1);
    expect(editSpy).toHaveBeenCalledTimes(1);
    expect(graphHistory(sid, 'undo')).toHaveLength(1);
    expect([sPos(sid, 'n0'), sPos(sid, 'n1'), sPos(sid, 'n2')]).toEqual([pt(40, 20), pt(340, 50), pt(660, 90)]);
    act(() => { expect(tr(sid, 'undo')).toBe(true); });
    expect([sPos(sid, 'n0'), sPos(sid, 'n1'), sPos(sid, 'n2')]).toEqual([pt(0, 0), pt(260, 0), pt(520, 0)]);
  });

  it('handles 30 autopan drag ticks with 0 mid-drag writes, 1 commit on drop, and ignores duplicate drop', () => {
    const { sid } = mountCanvas(makeGraph(4));
    const writes = watchWrites(sid);
    const editSpy = vi.spyOn(edit, 'editPresentation');

    drag.start('n0', 'n1');
    for (let k = 1; k <= 30; k++) {
      onCh([pCh('n0', true, pt(k * 15, k * 8)), pCh('n1', true, pt(260 + k * 15, k * 8))]);
    }
    expect(writes()).toBe(0);
    expect(rPos('n0')).toEqual(pt(450, 240));
    expect(rPos('n1')).toEqual(pt(710, 240));

    onCh([pCh('n0', false, pt(450, 240)), pCh('n1', false, pt(710, 240))]);
    drag.stop(['n0', 'n1']);
    onCh([pCh('n0', false, pt(450, 240)), pCh('n1', false, pt(710, 240))]);
    drag.stop(['n0', 'n1']);
    expect(writes()).toBe(1);
    expect(editSpy).toHaveBeenCalledTimes(1);
    expect(graphHistory(sid, 'undo')).toHaveLength(1);
    expect(sPos(sid, 'n0')).toEqual(pt(450, 240));
    expect(sPos(sid, 'n1')).toEqual(pt(710, 240));
  });

  it('keeps two rapid frame drags (<700ms) as 2 writes and 2 separate undo steps', () => {
    const { sid } = mountCanvas(makeGraph(4));
    const writes = watchWrites(sid);
    const f0 = rPos('g0')!;

    drag.start('g0');
    onCh([pCh('g0', true, pt(f0.x + 60, f0.y + 30))]);
    onCh([pCh('g0', false)]);
    drag.stop(['g0']);
    const f1 = rPos('g0')!;
    drag.start('g0');
    onCh([pCh('g0', true, pt(f1.x + 40, f1.y + 20))]);
    onCh([pCh('g0', false)]);
    drag.stop(['g0']);

    expect(writes()).toBe(2);
    expect(graphHistory(sid, 'undo')).toHaveLength(2);
    expect(sPos(sid, 'n0')).toEqual(pt(100, 50));
    expect(sPos(sid, 'n1')).toEqual(pt(360, 50));
    act(() => { expect(tr(sid, 'undo')).toBe(true); });
    expect(sPos(sid, 'n0')).toEqual(pt(60, 30));
    act(() => { expect(tr(sid, 'undo')).toBe(true); });
    expect(sPos(sid, 'n0')).toEqual(pt(0, 0));
  });

  it('commits direct dragging:false position updates with coordinates (React Flow arrow-key nudge)', () => {
    const { sid } = mountCanvas(makeGraph(3));
    const writes = watchWrites(sid);

    // @xyflow/react useMoveSelectedNodes emits { type: 'position', position, dragging: false } from its keydown handler.
    arrowKey(() => flow.props!.onNodesChange([pCh('n0', false, pt(5, 0))]));
    expect(writes()).toBe(1);
    expect(sPos(sid, 'n0')).toEqual(pt(5, 0));
    expect(graphHistory(sid, 'undo')).toHaveLength(1);
  });

  it('does not lose gesture 1 drop when gesture 2 starts right after it', async () => {
    const { sid } = mountCanvas(makeGraph(3));
    drag.start('n0');
    onCh([pCh('n0', true, pt(120, 60))]);
    // Gesture 1 ends without a stop (an abort); its pointer goes up before gesture 2 can start. A batch carrying n1 before
    // gesture 2's start is not gesture 1's: items are fixed at each start (XYDrag's dragItems).
    onCh([pCh('n0', false, pt(120, 60)), pCh('n1', true, pt(999, 999))]);
    act(() => { window.dispatchEvent(Object.assign(new Event('pointerup'), { pointerType: 'mouse', isPrimary: true })); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    drag.start('n1');
    onCh([pCh('n1', true, pt(380, 60))]);
    onCh([pCh('n1', false, pt(380, 60))]);
    drag.stop(['n1']);

    expect(sPos(sid, 'n0')).toEqual(pt(120, 60));
    expect(sPos(sid, 'n1')).toEqual(pt(380, 60));
  });

  it('does not discard a legitimate node drag when non-positional node data updates mid-drag', () => {
    const { sid } = mountCanvas(makeGraph(3));
    drag.start('n0');
    onCh([pCh('n0', true, pt(150, 75))]);
    expect(rPos('n0')).toEqual(pt(150, 75));

    // E.g. running generation finishes or title updates on n0 without moving n0.position.
    act(() => {
      const g = sGraph(sid);
      useStore.setState((st) => ({
        sessions: {
          ...st.sessions,
          [sid]: {
            ...st.sessions[sid],
            graph: {
              ...g,
              nodes: g.nodes.map((n) => (n.id === 'n0' ? { ...n, data: { ...n.data, title: 'Updated' } } : n)),
            },
          },
        },
      }));
    });

    onCh([pCh('n0', false, pt(150, 75))]);
    drag.stop(['n0']);
    expect(sPos(sid, 'n0')).toEqual(pt(150, 75));
  });

  it('does not discard already-dropped n0 when another active node gets a non-positional update mid-drag', () => {
    const { sid } = mountCanvas(makeGraph(4));
    drag.start('n0', 'n1', 'n2');
    onCh([pCh('n0', true, pt(90, 40)), pCh('n1', true, pt(350, 40)), pCh('n2', true, pt(610, 40))]);
    onCh([pCh('n0', false)]);

    // Non-positional update on n1 prunes n1 from gesture.ids -> next move on [n1, n2] triggers "outside gesture" discard.
    act(() => {
      const g = sGraph(sid);
      useStore.setState((st) => ({
        sessions: {
          ...st.sessions,
          [sid]: {
            ...st.sessions[sid],
            graph: {
              ...g,
              nodes: g.nodes.map((n) => (n.id === 'n1' ? { ...n, data: { ...n.data, title: 'GenDone' } } : n)),
            },
          },
        },
      }));
    });

    onCh([pCh('n1', true, pt(370, 50)), pCh('n2', true, pt(630, 50))]);
    onCh([pCh('n1', false), pCh('n2', false)]);
    drag.stop(['n0', 'n1', 'n2']);
    expect(sPos(sid, 'n0')).toEqual(pt(90, 40));
    expect(sPos(sid, 'n1')).toEqual(pt(370, 50));
    expect(sPos(sid, 'n2')).toEqual(pt(630, 50));
  });
});

describe('Round 2 split-drop regressions (moved from adversarial-drag200 Attack 8)', () => {
  it('split multi-node drop batches: 1 write, 1 undo step, keeps preview of still-dropping node', () => {
    const { sid } = mountCanvas(makeGraph(4)), editSpy = vi.spyOn(edit, 'editPresentation');
    drag.start('n0', 'n1'); onCh([pCh('n0', true, pt(100, 50)), pCh('n1', true, pt(360, 50))]);
    onCh([pCh('n0', false)]); expect(editSpy).not.toHaveBeenCalled(); expect(rPos('n0')).toEqual(pt(100, 50)); expect(rPos('n1')).toEqual(pt(360, 50));
    onCh([pCh('n1', false)]); expect(editSpy).not.toHaveBeenCalled(); drag.stop(['n0', 'n1']); expect(editSpy).toHaveBeenCalledTimes(1); expect(graphHistory(sid, 'undo')).toHaveLength(1);
    expect(sPos(sid, 'n0')).toEqual(pt(100, 50)); expect(sPos(sid, 'n1')).toEqual(pt(360, 50));
    act(() => { expect(tr(sid, 'undo')).toBe(true); }); expect(sPos(sid, 'n0')).toEqual(pt(0, 0)); expect(sPos(sid, 'n1')).toEqual(pt(260, 0));
  });
  it('trailing event for deleted node keeps another active drag', () => {
    const { sid } = mountCanvas(makeGraph(4)); act(() => { deleteNodes(sid, ['n3']); });
    drag.start('n0'); onCh([pCh('n0', true, pt(140, 70))]);
    onCh([pCh('n3', true, pt(999, 999))]); expect(rPos('n0')).toEqual(pt(140, 70));
    onCh([pCh('n0', false)]); drag.stop(['n0', 'n3'], { n3: pt(999, 999) }); expect(sPos(sid, 'n0')).toEqual(pt(140, 70));
  });
});

describe('Gesture attack 2: discard and reconciliation (delete, undo/redo, load, session)', () => {
  it('does not leave zombie ghost preview or commit on unrelated select when last active node is deleted after partial drop', () => {
    const { sid } = mountCanvas(makeGraph(4));
    const editSpy = vi.spyOn(edit, 'editPresentation');

    drag.start('n0', 'n1');
    onCh([pCh('n0', true, pt(110, 55)), pCh('n1', true, pt(370, 55))]);
    onCh([pCh('n0', false)]);
    expect(editSpy).not.toHaveBeenCalled();

    // Last active node (n1) is deleted externally while n0 sits in gesture.final.
    act(() => { deleteNodes(sid, ['n1']); });
    // Before any stop: no ghost of the deleted node, n0 stays where React Flow still drags it, a select writes nothing.
    expect(rPos('n1')).toBeUndefined();
    expect(rPos('n0')).toEqual(pt(110, 55));
    const callsAfterDelete = editSpy.mock.calls.length;
    onCh([{ id: 'n2', type: 'select', selected: true }]);
    expect(editSpy).toHaveBeenCalledTimes(callsAfterDelete);
    // Undo of the deletion still mid-gesture: n1 comes back at its store position, never at its old drag position.
    act(() => { expect(tr(sid, 'undo')).toBe(true); });
    expect(rPos('n1')).toEqual(sPos(sid, 'n1'));
    expect(rPos('n1')).toEqual(pt(260, 0));

    // React Flow's final batch and stop still carry n1 from its drag items: it stays out of this gesture.
    onCh([pCh('n0', false, pt(110, 55)), pCh('n1', false, pt(370, 55))]);
    drag.stop(['n0', 'n1'], { n1: pt(370, 55) });
    expect(rPos('n0')).toEqual(sPos(sid, 'n0'));
    expect([sPos(sid, 'n0'), sPos(sid, 'n1')]).toEqual([pt(110, 55), pt(260, 0)]);
  });

  it('keeps the in-flight gesture through Undo of an unrelated node and does not wipe Redo on next select', () => {
    const { sid } = mountCanvas(makeGraph(4));
    // Create an undoable step on n2.
    drag.start('n2');
    onCh([pCh('n2', true, pt(600, 80))]);
    onCh([pCh('n2', false)]);
    drag.stop(['n2']);
    expect(graphHistory(sid, 'undo')).toHaveLength(1);

    // Start multi-drag on n0+n1, drop n0 (now in gesture.final), keep n1 active.
    drag.start('n0', 'n1');
    onCh([pCh('n0', true, pt(100, 50)), pCh('n1', true, pt(360, 50))]);
    onCh([pCh('n0', false)]);

    // Undo restores n2; all nodes are cloned with same coords for n0/n1. The gesture is still in flight.
    act(() => { expect(tr(sid, 'undo')).toBe(true); });
    expect(graphHistory(sid, 'redo')).toHaveLength(1);
    expect(rPos('n0')).toEqual(pt(100, 50));
    expect(rPos('n1')).toEqual(pt(360, 50));
    expect(rPos('n2')).toEqual(pt(520, 0));

    // Selecting n2 must NOT commit stale n0 or wipe the Redo stack.
    onCh([{ id: 'n2', type: 'select', selected: true }]);
    expect(sPos(sid, 'n0')).toEqual(pt(0, 0));
    expect(graphHistory(sid, 'redo')).toHaveLength(1);

    // React Flow's stop commits the gesture onto the undone graph: n2 stays undone.
    onCh([pCh('n1', false)]);
    drag.stop(['n0', 'n1']);
    expect([sPos(sid, 'n0'), sPos(sid, 'n1'), sPos(sid, 'n2')]).toEqual([pt(100, 50), pt(360, 50), pt(520, 0)]);
  });

  it('keeps the in-flight gesture through a graph load with same coordinates and does not corrupt the loaded graph', () => {
    const { sid } = mountCanvas(makeGraph(3));
    drag.start('n0', 'n1');
    onCh([pCh('n0', true, pt(120, 60)), pCh('n1', true, pt(380, 60))]);
    onCh([pCh('n0', false)]);

    act(() => {
      const loaded: Graph = {
        nodes: [tNode('n0', 0, 0, 'Loaded0'), tNode('n1', 260, 0, 'Loaded1'), tNode('n2', 520, 0, 'Loaded2')],
        edges: [],
      };
      useStore.setState((st) => ({
        sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], graph: loaded } },
      }));
    });

    expect(rPos('n0')).toEqual(pt(120, 60));
    onCh([{ id: 'n2', type: 'select', selected: true }]);
    expect(sPos(sid, 'n0')).toEqual(pt(0, 0));

    onCh([pCh('n1', false)]);
    drag.stop(['n0', 'n1']);
    expect(sGraph(sid).nodes.map((n) => [n.id, n.data.title, n.position])).toEqual([
      ['n0', 'Loaded0', pt(120, 60)], ['n1', 'Loaded1', pt(380, 60)], ['n2', 'Loaded2', pt(520, 0)],
    ]);
  });

  it('discards partial-drop gesture with 0 writes when activeSessionId switches', () => {
    const { sid: s1 } = mountCanvas(makeGraph(3));
    const s2 = createSession(`adv-gest-s2-${Math.random()}`);
    useStore.setState((st) => ({
      sessions: { ...st.sessions, [s2.id]: { ...s2, graph: { nodes: [tNode('n0', 15, 25)], edges: [] }, feed: [] } },
    }));
    const w1 = watchWrites(s1);
    const w2 = watchWrites(s2.id);

    drag.start('n0', 'n1');
    onCh([pCh('n0', true, pt(140, 70)), pCh('n1', true, pt(400, 70))]);
    onCh([pCh('n0', false)]);
    const staleChange = flow.props!.onNodesChange;
    const staleProps = flow.props;

    act(() => { useStore.setState({ activeSessionId: s2.id }); });
    act(() => { staleChange([pCh('n1', false, pt(400, 70))]); });
    rfDrag(() => staleProps).stop(['n0', 'n1'], { n0: pt(140, 70), n1: pt(400, 70) });

    expect(w1()).toBe(0);
    expect(w2()).toBe(0);
    expect(sPos(s1, 'n0')).toEqual(pt(0, 0));
    expect(sPos(s2.id, 'n0')).toEqual(pt(15, 25));
    expect(rPos('n0')).toEqual(pt(15, 25));
  });

  it('ignores stale applyDragChanges from old session when useNodeDrag sessionId prop changes without unmount', () => {
    const s1 = createSession(`adv-hook-s1-${Math.random()}`);
    const s2 = createSession(`adv-hook-s2-${Math.random()}`);
    useStore.setState((st) => ({
      activeSessionId: s1.id,
      sessions: {
        ...st.sessions,
        [s1.id]: { ...s1, graph: makeGraph(2), feed: [] },
        [s2.id]: { ...s2, graph: makeGraph(2), feed: [] },
      },
    }));

    let api!: ReturnType<typeof useNodeDrag>;
    function Harness({ sid }: { sid: string }) {
      const measured = useRef(new Map<string, { width: number; height: number }>());
      api = useNodeDrag(sid, measured);
      return null;
    }

    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    cleanups.push(() => { act(() => root.unmount()); host.remove(); });

    act(() => root.render(createElement(Harness, { sid: s1.id })));
    const staleApply = api.applyDragChanges, staleEnd = api.endDrag;
    act(() => api.startDrag(new MouseEvent('mousedown'), undefined, [{ id: 'n0', position: pt(0, 0) }]));
    act(() => staleApply([pCh('n0', true, pt(80, 40))]));

    // Switch sessionId prop without unmounting the hook component.
    act(() => root.render(createElement(Harness, { sid: s2.id })));
    act(() => staleApply([pCh('n0', true, pt(90, 45)), pCh('n0', false, pt(90, 45))]));
    act(() => staleEnd(new MouseEvent('mouseup'), undefined, [{ id: 'n0', position: pt(90, 45) }]));

    expect(sPos(s1.id, 'n0')).toEqual(pt(0, 0));
    expect(liveGroupsMap(s1.id).liveGraph?.nodes[0].position).toEqual(pt(0, 0));
  });
});

describe('Gesture attack 3: group frames & members', () => {
  it('commits two frames dragged together with split drop and interleaved move in 1 write and 1 undo', () => {
    const { sid } = mountCanvas(makeGraph(4, true));
    const writes = watchWrites(sid);
    const f0 = rPos('g0')!;
    const f1 = rPos('g1')!;

    drag.start('g0', 'g1');
    onCh([pCh('g0', true, pt(f0.x + 50, f0.y + 20)), pCh('g1', true, pt(f1.x + 50, f1.y + 20))]);
    onCh([pCh('g0', false)]);
    onCh([pCh('g1', true, pt(f1.x + 90, f1.y + 60))]);
    expect(writes()).toBe(0);

    onCh([pCh('g1', false)]);
    expect(writes()).toBe(0);
    drag.stop(['g0', 'g1']);
    expect(writes()).toBe(1);
    expect(graphHistory(sid, 'undo')).toHaveLength(1);
    expect([sPos(sid, 'n0'), sPos(sid, 'n1'), sPos(sid, 'n2'), sPos(sid, 'n3')]).toEqual([
      pt(50, 20), pt(310, 20), pt(610, 60), pt(870, 60),
    ]);
  });

  it('commits frame + selected member dragged together when frame drops before member moves again', () => {
    const { sid } = mountCanvas(makeGraph(3));
    const writes = watchWrites(sid);
    const f0 = rPos('g0')!;

    drag.start('g0', 'n0');
    onCh([pCh('g0', true, pt(f0.x + 50, f0.y + 20)), pCh('n0', true, pt(50, 20))]);
    onCh([pCh('g0', false)]);
    onCh([pCh('n0', true, pt(80, 35))]);
    expect(writes()).toBe(0);

    onCh([pCh('n0', false)]);
    expect(writes()).toBe(0);
    // React Flow's stop carries each item's last reported position: the frame's is still its first move.
    drag.stop(['g0', 'n0'], { g0: pt(f0.x + 50, f0.y + 20) });
    expect(writes()).toBe(1);
    expect(graphHistory(sid, 'undo')).toHaveLength(1);
    expect(sPos(sid, 'n0')).toEqual(pt(80, 35));
    expect(sPos(sid, 'n1')).toEqual(pt(310, 20));
  });

  it('does not teleport surviving members when leftmost member n0 is deleted mid-frame-drag before drop', () => {
    const graph: Graph = {
      nodes: [tNode('n0', 0, 0), tNode('n1', 260, 0), tNode('n2', 520, 0)],
      edges: [],
      groups: [{ id: 'g0', title: 'G0', nodeIds: ['n0', 'n1', 'n2'] }],
    };
    const { sid } = mountCanvas(graph);
    const f0 = rPos('g0')!;
    const movedFrame = pt(f0.x + 100, f0.y + 40);

    drag.start('g0');
    onCh([pCh('g0', true, movedFrame)]);
    expect(rPos('n0')).toEqual(pt(100, 40));
    expect(rPos('n1')).toEqual(pt(360, 40));
    expect(rPos('n2')).toEqual(pt(620, 40));

    // Delete leftmost member n0; g0 survives with [n1, n2]. XYFlow end emits movedFrame for g0.
    act(() => { deleteNodes(sid, ['n0']); });
    onCh([pCh('g0', false, movedFrame)]);
    drag.stop(['g0'], { g0: movedFrame });

    expect(sPos(sid, 'n1')).toEqual(pt(360, 40));
    expect(sPos(sid, 'n2')).toEqual(pt(620, 40));
  });

  it('keeps member n0 in frame drag and does not teleport n1 when n0 data updates mid-frame-drag', () => {
    const { sid } = mountCanvas(makeGraph(3));
    const f0 = rPos('g0')!;
    drag.start('g0');

    onCh([pCh('g0', true, pt(f0.x + 80, f0.y + 40))]);
    expect(rPos('n0')).toEqual(pt(80, 40));
    expect(rPos('n1')).toEqual(pt(340, 40));

    act(() => {
      const g = sGraph(sid);
      useStore.setState((st) => ({
        sessions: {
          ...st.sessions,
          [sid]: {
            ...st.sessions[sid],
            graph: {
              ...g,
              nodes: g.nodes.map((n) => (n.id === 'n0' ? { ...n, data: { ...n.data, title: 'Done' } } : n)),
            },
          },
        },
      }));
    });

    onCh([pCh('g0', true, pt(f0.x + 90, f0.y + 40))]);
    onCh([pCh('g0', false)]);
    drag.stop(['g0'], { g0: pt(f0.x + 90, f0.y + 40) });
    expect(sPos(sid, 'n0')).toEqual(pt(90, 40));
    expect(sPos(sid, 'n1')).toEqual(pt(350, 40));
  });

  it('commits frame drag when dragging:true and dragging:false (no position) arrive in the same batch', () => {
    const { sid } = mountCanvas(makeGraph(3));
    const f0 = rPos('g0')!;

    drag.start('g0');
    onCh([pCh('g0', true, pt(f0.x + 80, f0.y + 40)), pCh('g0', false)]);
    drag.stop(['g0']);
    expect(sPos(sid, 'n0')).toEqual(pt(80, 40));
    expect(sPos(sid, 'n1')).toEqual(pt(340, 40));
  });

  it('does not leave zombie ghost preview on n2 when co-dragged frame g0 is ungrouped after n2 dropped', () => {
    const { sid } = mountCanvas(makeGraph(3));
    const editSpy = vi.spyOn(edit, 'editPresentation');
    const f0 = rPos('g0')!;

    drag.start('g0', 'n2');
    onCh([pCh('g0', true, pt(f0.x + 60, f0.y + 30)), pCh('n2', true, pt(580, 30))]);
    onCh([pCh('n2', false)]);
    act(() => { ungroup(sid, 'g0'); });
    // Before any stop: the former members show their store positions (no ghost of the dead frame), a select writes nothing.
    expect(rPos('n0')).toEqual(sPos(sid, 'n0'));
    expect(rPos('n1')).toEqual(sPos(sid, 'n1'));
    expect(rPos('n2')).toEqual(pt(580, 30));
    const before = editSpy.mock.calls.length;
    onCh([{ id: 'n0', type: 'select', selected: true }]);
    expect(editSpy).toHaveBeenCalledTimes(before);
    onCh([pCh('g0', false)]);
    drag.stop(['g0', 'n2'], { g0: pt(f0.x + 60, f0.y + 30) });

    expect(rPos('n2')).toEqual(sPos(sid, 'n2'));
    expect([sPos(sid, 'n0'), sPos(sid, 'n2')]).toEqual([pt(0, 0), pt(580, 30)]);
    const calls = editSpy.mock.calls.length;
    onCh([{ id: 'n0', type: 'select', selected: true }]);
    expect(editSpy).toHaveBeenCalledTimes(calls);
  });

  it('does not start phantom preview when group frame remove and position arrive in the same onNodesChange batch', () => {
    const { sid } = mountCanvas(makeGraph(3));
    const f0 = rPos('g0')!;

    onCh([{ id: 'g0', type: 'remove' }, pCh('g0', true, pt(f0.x + 80, f0.y + 40))]);
    expect(sGraph(sid).groups).toEqual([]);
    expect(rPos('n0')).toEqual(pt(0, 0));
    expect(rPos('n1')).toEqual(pt(260, 0));
  });
});

describe('Gesture attack 4: check-node-drag guard gaps', () => {
  // Cubierto por el test de conteo: the runtime write counters above catch any write during a drag the AST guard misses.
  it.fails('catches editPresentation when a block shadows a c.dragging alias with false', () => {
    const root = mkdtempSync(join(tmpdir(), 'ogs-adv-gest-'));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const file = join(root, 'src/components/node/useNodeDrag.ts');
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(
      file,
      `import { editPresentation } from '../../engine/nodecore/edit';
      export function useNodeDrag(sessionId: string) {
        const applyDragChanges = (changes: any[]) => {
          for (const c of changes) {
            const d = c.dragging;
            if (c.type === 'position' && d) {
              const d = false;
              if (!d) editPresentation(sessionId, (g: any) => g);
            }
          }
        };
        return { applyDragChanges };
      }`,
    );
    expect(checkNodeDrag(root).length).toBeGreaterThan(0);
  });
});
