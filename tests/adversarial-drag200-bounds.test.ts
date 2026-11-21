// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Edge, EdgeChange, Node, NodeChange, NodeTypes } from '@xyflow/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NodeWorkspace } from '../src/components/node/NodeWorkspace';
import type { FlowNode } from '../src/components/node/nodes';
import { graphHistory, travelGraph } from '../src/engine/flow/history';
import * as edit from '../src/engine/nodecore/edit';
import type { Graph, GraphNode } from '../src/engine/types';
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
  const s = createSession(`adv-bounds-${Math.random()}`);
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

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
// The release of the pointer as the window sees it (the fallback when React Flow sends no end), then its timer.
const release = async () => { act(() => { window.dispatchEvent(new Event('pointerup')); }); await settle(); };

describe('Gesture bounds from React Flow events', () => {
  type Ev = (e: unknown, ...rest: unknown[]) => void;
  const rf = () => flow.props as unknown as Record<'onNodeDragStart' | 'onSelectionDragStart' | 'onNodeDragStop' | 'onSelectionDragStop', Ev>;

  it('commits an aborted drag (dragging:false, no stop) at the window pointerup, and autopan cannot reopen it', async () => {
    const { sid } = mountCanvas(makeGraph(3));
    const writes = watchWrites(sid);
    drag.start('n0');
    onCh([pCh('n0', true, pt(70, 30))]);
    onCh([pCh('n0', false, pt(70, 30))]);
    await settle();
    expect(writes()).toBe(0);
    await release();
    expect(sPos(sid, 'n0')).toEqual(pt(70, 30));
    expect(graphHistory(sid, 'undo')).toHaveLength(1);
    // XYDrag's abort skips the autopan cleanup: later dragging:true ticks must not reopen the closed flight.
    onCh([pCh('n0', true, pt(90, 40))]);
    expect(rPos('n0')).toEqual(pt(70, 30));
    drag.stop(['n0'], { n0: pt(90, 40) });
    await release();
    expect(writes()).toBe(1);
    expect(sPos(sid, 'n0')).toEqual(pt(70, 30));
  });

  it('closes a flight whose touch target unmounted (no end from React Flow) at the window pointerup', async () => {
    const { sid } = mountCanvas(makeGraph(3));
    drag.start('n0');
    onCh([pCh('n0', true, pt(40, 25))]);
    await release();
    expect(sPos(sid, 'n0')).toEqual(pt(40, 25));
    expect(graphHistory(sid, 'undo')).toHaveLength(1);
  });

  it('closes a flight on window blur (lost mouseup) and ignores its late end after Undo of the same node', async () => {
    const { sid } = mountCanvas(makeGraph(3));
    drag.start('n0');
    onCh([pCh('n0', true, pt(120, 60))]);
    act(() => { window.dispatchEvent(new Event('blur')); });
    expect(sPos(sid, 'n0')).toEqual(pt(120, 60));
    act(() => { expect(tr(sid, 'undo')).toBe(true); });
    // The mouseup finally reaches d3: React Flow ends that same gesture late.
    onCh([pCh('n0', true, pt(150, 70))]);
    onCh([pCh('n0', false, pt(150, 70))]);
    drag.stop(['n0'], { n0: pt(150, 70) });
    await release();
    expect(sPos(sid, 'n0')).toEqual(pt(0, 0));
    expect(graphHistory(sid, 'redo')).toHaveLength(1);
    // After that end, arrow keys write again.
    onCh([pCh('n0', false, pt(5, 0))]);
    expect(sPos(sid, 'n0')).toEqual(pt(5, 0));
  });

  it('groups rapid arrow nudges of the same nodes into one undo step, but never into a drag step', async () => {
    const { sid } = mountCanvas(makeGraph(3));
    drag.start('n0');
    onCh([pCh('n0', true, pt(20, 0))]);
    onCh([pCh('n0', false, pt(20, 0))]);
    drag.stop(['n0']);
    for (const x of [25, 30, 35]) onCh([pCh('n0', false, pt(x, 0))]);
    expect(sPos(sid, 'n0')).toEqual(pt(35, 0));
    expect(graphHistory(sid, 'undo')).toHaveLength(2);
    act(() => { expect(tr(sid, 'undo')).toBe(true); });
    expect(sPos(sid, 'n0')).toEqual(pt(20, 0));
  });

  it('keeps an arrow nudge pressed during a drag inside the flight: no write before the stop', async () => {
    const { sid } = mountCanvas(makeGraph(3));
    const writes = watchWrites(sid);
    drag.start('n0');
    onCh([pCh('n0', true, pt(50, 20))]);
    onCh([pCh('n0', false, pt(55, 20))]);
    await settle();
    expect(writes()).toBe(0);
    expect(rPos('n0')).toEqual(pt(55, 20));
    onCh([pCh('n0', true, pt(60, 20))]);
    onCh([pCh('n0', false, pt(60, 20))]);
    drag.stop(['n0']);
    expect(writes()).toBe(1);
    expect(sPos(sid, 'n0')).toEqual(pt(60, 20));
  });

  it('treats onNodeDragStart + onSelectionDragStart of one selection drag as one gesture and one write', () => {
    const { sid } = mountCanvas(makeGraph(3));
    const writes = watchWrites(sid);
    const down = new MouseEvent('mousedown'), up = new MouseEvent('mouseup');
    const at = [{ id: 'n0', position: pt(0, 0) }, { id: 'n2', position: pt(520, 0) }];
    act(() => { rf().onNodeDragStart(down, at[0], at); rf().onSelectionDragStart(down, at); });
    onCh([pCh('n0', true, pt(30, 10)), pCh('n2', true, pt(550, 10))]);
    act(() => { rf().onSelectionDragStart(down, at); });
    expect(rPos('n0')).toEqual(pt(30, 10));
    onCh([pCh('n0', false, pt(30, 10)), pCh('n2', false, pt(550, 10))]);
    const end = [{ id: 'n0', position: pt(30, 10) }, { id: 'n2', position: pt(550, 10) }];
    act(() => { rf().onNodeDragStop(up, end[0], end); rf().onSelectionDragStop(up, end); });
    expect(writes()).toBe(1);
    expect([sPos(sid, 'n0'), sPos(sid, 'n2')]).toEqual([pt(30, 10), pt(550, 10)]);
  });
});

