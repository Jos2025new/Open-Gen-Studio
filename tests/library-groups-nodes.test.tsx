// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Edge, EdgeChange, Node, NodeChange, NodeTypes } from '@xyflow/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NodeWorkspace } from '../src/components/node/NodeWorkspace';
import { deleteNodes } from '../src/engine/flow/actions';
import { groupNodes } from '../src/engine/flow/arrange';
import { graphHistory, travelGraph } from '../src/engine/flow/history';
import { applyEdit } from '../src/engine/nodecore/edit';
import type { Graph } from '../src/engine/types';
import { persistJson } from '../src/store/persistJson';
import { createSession, useStore } from '../src/store/store';

const flow = vi.hoisted(() => ({
  props: null as null | {
    nodes: Node[];
    edges: Edge[];
    children: ReactNode;
    onNodesChange(changes: NodeChange[]): void;
    onEdgesChange(changes: EdgeChange[]): void;
    onNodeDragStart?: (e: unknown, n: Node, ns: Node[]) => void;
    onNodeDragStop?: (e: unknown, n: Node, ns: Node[]) => void;
    onBeforeDelete?: (p: { nodes: Node[]; edges: Edge[] }) => Promise<boolean>;
    onPaneContextMenu?: (e: MouseEvent) => void;
    onNodeContextMenu?: (e: MouseEvent, n: Node) => void;
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
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  vi.restoreAllMocks();
});

const gOf = (sid: string) => useStore.getState().sessions[sid].graph;
const travel = (sid: string, dir: 'undo' | 'redo') =>
  travelGraph(sid, gOf(sid), dir, 1, (next) => applyEdit({ session: sid, op: { op: 'travel', graph: next } }).ok);

function mount(graph: Graph) {
  const session = createSession(`lg-nodes-${Math.random()}`);
  useStore.setState((s) => ({
    activeSessionId: session.id,
    generations: {},
    assets: {},
    sessions: { ...s.sessions, [session.id]: { ...session, graph, feed: [] } },
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
  return { sessionId: session.id, container };
}

const twoNodes = (): Graph => ({
  nodes: [
    { id: 'a', position: { x: 100, y: 100 }, data: { kind: 'text', title: 'A', text: 'a' } },
    { id: 'b', position: { x: 500, y: 100 }, data: { kind: 'text', title: 'B', text: 'b' } },
  ],
  edges: [],
});

describe('Nodes empty groups (Part A1)', () => {
  it('creates an empty group from Add node menu, moves, resizes, persists via persistJson, and deletes without confirmation', async () => {
    const { sessionId, container } = mount({ nodes: [], edges: [] });

    // Open Add node menu and click Group.
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Add node…"]')!.click());
    const grpOpt = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find((b) => b.textContent?.includes('Group'));
    expect(grpOpt).toBeDefined();
    act(() => grpOpt!.click());

    const created = gOf(sessionId).groups?.[0];
    expect(created).toBeDefined();
    expect(created!.nodeIds).toEqual([]);
    const startBounds = structuredClone(created!.bounds!);
    expect(startBounds.width).toBeGreaterThan(0);
    expect(startBounds.height).toBeGreaterThan(0);

    // Frame is rendered on the canvas.
    const frameNode = flow.props!.nodes.find((n) => n.id === created!.id)!;
    expect(frameNode).toBeDefined();
    expect(frameNode.type).toBe('group');

    // Drag the empty frame: one undo step updates bounds.
    const movedPos = { x: startBounds.x + 120, y: startBounds.y + 80 };
    act(() => { flow.props!.onNodeDragStart?.({}, frameNode, [frameNode]); });
    act(() => { flow.props!.onNodesChange([{ id: created!.id, type: 'position', position: movedPos, dragging: true }]); });
    act(() => { flow.props!.onNodeDragStop?.({}, { ...frameNode, position: movedPos }, [{ ...frameNode, position: movedPos }]); });
    expect(gOf(sessionId).groups![0].bounds).toEqual({ ...startBounds, x: movedPos.x, y: movedPos.y });

    // Resize the empty frame via its handle: one undo step updates width/height.
    const handle = container.querySelector<HTMLElement>('.group-resize')!;
    expect(handle).not.toBeNull();
    handle.setPointerCapture = () => {};
    act(() => { handle.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 300, clientY: 200 })); });
    act(() => { handle.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 420, clientY: 290 })); });
    act(() => { handle.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 420, clientY: 290 })); });
    const resized = gOf(sessionId).groups![0].bounds!;
    expect(resized.width).toBe(startBounds.width + 120);
    expect(resized.height).toBe(startBounds.height + 90);

    // Reload round-trip via persistJson preserves the empty group and its bounds.
    const raw = persistJson({ state: { sessions: { [sessionId]: useStore.getState().sessions[sessionId] } }, version: 1 }, 100);
    const reloaded = JSON.parse(raw).state.sessions[sessionId].graph as Graph;
    expect(reloaded.groups).toEqual(gOf(sessionId).groups);

    // Undo resize, then redo resize.
    expect(travel(sessionId, 'undo')).toBe(true);
    expect(gOf(sessionId).groups![0].bounds).toEqual({ ...startBounds, x: movedPos.x, y: movedPos.y });
    expect(travel(sessionId, 'redo')).toBe(true);
    expect(gOf(sessionId).groups![0].bounds).toEqual(resized);

    // Delete empty group via Delete key: no confirmation dialog, 1 Undo brings it back.
    const curFrame = flow.props!.nodes.find((n) => n.id === created!.id)!;
    const undoBefore = graphHistory(sessionId, 'undo').length;
    await act(async () => { await flow.props!.onBeforeDelete?.({ nodes: [curFrame], edges: [] }); });
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(gOf(sessionId).groups).toEqual([]);
    expect(graphHistory(sessionId, 'undo').length).toBe(undoBefore + 1);
    expect(travel(sessionId, 'undo')).toBe(true);
    expect(gOf(sessionId).groups).toHaveLength(1);
    expect(gOf(sessionId).groups![0].bounds).toEqual(resized);
  });

  it('stops pruning a group when its nodes are deleted down to 1 and then 0, keeping its frame bounds', () => {
    const { sessionId } = mount(twoNodes());
    let gid = '';
    act(() => { gid = groupNodes(sessionId, ['a', 'b'], 'Frame')!; });
    act(() => { deleteNodes(sessionId, ['b']); });
    expect(gOf(sessionId).groups).toHaveLength(1);
    expect(gOf(sessionId).groups![0].nodeIds).toEqual(['a']);

    act(() => { deleteNodes(sessionId, ['a']); });
    expect(gOf(sessionId).groups).toHaveLength(1);
    expect(gOf(sessionId).groups![0].id).toBe(gid);
    expect(gOf(sessionId).groups![0].nodeIds).toEqual([]);
    expect(gOf(sessionId).groups![0].bounds).toBeDefined();
    expect(flow.props!.nodes.some((n) => n.id === gid)).toBe(true);
  });

  it('keeps legacy graphs without parentId or bounds identical after open and persistJson', () => {
    const legacy: Graph = {
      ...twoNodes(),
      groups: [{ id: 'g_old', title: 'Legacy', nodeIds: ['a', 'b'] }],
    };
    const { sessionId } = mount(structuredClone(legacy));
    const raw = persistJson({ state: { sessions: { [sessionId]: useStore.getState().sessions[sessionId] } }, version: 1 }, 200);
    const reloaded = JSON.parse(raw).state.sessions[sessionId].graph as Graph;
    expect(reloaded.groups).toEqual(legacy.groups);
    expect('parentId' in reloaded.groups![0]).toBe(false);
    expect('bounds' in reloaded.groups![0]).toBe(false);
  });
});
