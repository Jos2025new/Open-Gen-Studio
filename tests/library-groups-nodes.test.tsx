// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Edge, EdgeChange, Node, NodeChange, NodeTypes } from '@xyflow/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NodeWorkspace } from '../src/components/node/NodeWorkspace';
import { deleteNodes } from '../src/engine/flow/actions';
import { createEmptyGroup, groupFrameBounds, groupNodes, reparentGroup } from '../src/engine/flow/arrange';
import { groupChain, groupSubtree } from '../src/engine/flow/groupTree';
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

describe('Nodes nested groups, drag, cycles, copy/paste and duplicate (Part A2)', () => {
  const rightClickFrame = (id: string) => {
    const node = flow.props!.nodes.find((n) => n.id === id)!;
    act(() => {
      flow.props!.onNodeContextMenu?.({ preventDefault() {}, clientX: 50, clientY: 50 } as unknown as MouseEvent, node);
    });
  };
  const clickMenu = (label: string) => {
    const btn = [...document.querySelectorAll<HTMLButtonElement>('.menu .menu-item, .menu button')].find((b) => b.textContent?.includes(label));
    expect(btn, `menu item "${label}"`).toBeDefined();
    act(() => btn!.click());
  };

  it('nests 3 levels via context menu, computes recursive bounds, drags outer carrying inner + empty leaf in 1 undo, and moves out', () => {
    const { sessionId } = mount(twoNodes());
    let innerId = '', midId = '', outerId = '';
    act(() => {
      innerId = groupNodes(sessionId, ['a', 'b'], 'Inner')!;
      midId = createEmptyGroup(sessionId, { x: 0, y: 0 }, 'Mid')!;
      outerId = createEmptyGroup(sessionId, { x: 0, y: 0 }, 'Outer')!;
    });

    // Move Inner into Mid, then Mid into Outer via GroupContextMenu.
    rightClickFrame(innerId);
    clickMenu('Move into');
    clickMenu('Mid');
    expect(gOf(sessionId).groups!.find((g) => g.id === innerId)?.parentId).toBe(midId);

    rightClickFrame(midId);
    clickMenu('Move into');
    clickMenu('Outer');
    expect(gOf(sessionId).groups!.find((g) => g.id === midId)?.parentId).toBe(outerId);
    expect(groupChain(gOf(sessionId).groups, innerId).map((g) => g.id)).toEqual([innerId, midId, outerId]);

    // Add an empty leaf subgroup inside Mid.
    rightClickFrame(midId);
    clickMenu('Add subgroup');
    const leaf = gOf(sessionId).groups!.find((g) => g.parentId === midId && g.id !== innerId)!;
    expect(leaf).toBeDefined();
    expect(leaf.nodeIds).toEqual([]);
    const leafStart = structuredClone(leaf.bounds!);

    // Recursive frame bounds: Outer wraps Mid wraps Inner; zIndex increases with depth.
    const fOuter = flow.props!.nodes.find((n) => n.id === outerId)!;
    const fMid = flow.props!.nodes.find((n) => n.id === midId)!;
    const fInner = flow.props!.nodes.find((n) => n.id === innerId)!;
    expect(fOuter.position.x).toBeLessThan(fMid.position.x);
    expect(fMid.position.x).toBeLessThan(fInner.position.x);
    expect(fOuter.zIndex!).toBeLessThan(fMid.zIndex!);
    expect(fMid.zIndex!).toBeLessThan(fInner.zIndex!);
    expect(fInner.zIndex!).toBeLessThan(0);

    // Drag Outer by (+150, +90): moves nodes a, b AND empty leaf bounds in 1 undo step.
    const undoBefore = graphHistory(sessionId, 'undo').length;
    const targetPos = { x: fOuter.position.x + 150, y: fOuter.position.y + 90 };
    act(() => { flow.props!.onNodeDragStart?.({}, fOuter, [fOuter]); });
    act(() => { flow.props!.onNodesChange([{ id: outerId, type: 'position', position: targetPos, dragging: true }]); });
    act(() => { flow.props!.onNodeDragStop?.({}, { ...fOuter, position: targetPos }, [{ ...fOuter, position: targetPos }]); });
    expect(gOf(sessionId).nodes.find((n) => n.id === 'a')!.position).toEqual({ x: 250, y: 190 });
    expect(gOf(sessionId).nodes.find((n) => n.id === 'b')!.position).toEqual({ x: 650, y: 190 });
    expect(gOf(sessionId).groups!.find((g) => g.id === leaf.id)!.bounds).toEqual({ ...leafStart, x: leafStart.x + 150, y: leafStart.y + 90 });
    expect(graphHistory(sessionId, 'undo').length).toBe(undoBefore + 1);

    // Undo and redo the single drag step.
    expect(travel(sessionId, 'undo')).toBe(true);
    expect(gOf(sessionId).nodes.find((n) => n.id === 'a')!.position).toEqual({ x: 100, y: 100 });
    expect(gOf(sessionId).groups!.find((g) => g.id === leaf.id)!.bounds).toEqual(leafStart);
    expect(travel(sessionId, 'redo')).toBe(true);
    expect(gOf(sessionId).nodes.find((n) => n.id === 'a')!.position).toEqual({ x: 250, y: 190 });

    // Collapsing Outer hides descendant frames and nodes.
    act(() => { (fOuter.data as { toggle(id: string): void }).toggle(outerId); });
    expect(flow.props!.nodes.some((n) => n.id === midId)).toBe(false);
    expect(flow.props!.nodes.some((n) => n.id === innerId)).toBe(false);
    expect(flow.props!.nodes.find((n) => n.id === 'a')?.hidden).toBe(true);
    act(() => { (fOuter.data as { toggle(id: string): void }).toggle(outerId); });
    expect(flow.props!.nodes.some((n) => n.id === innerId)).toBe(true);

    // Move out lifts Inner one level (Mid → Outer), then to root (undefined).
    rightClickFrame(innerId);
    clickMenu('Move out');
    expect(gOf(sessionId).groups!.find((g) => g.id === innerId)?.parentId).toBe(outerId);
    rightClickFrame(innerId);
    clickMenu('Move out');
    expect(gOf(sessionId).groups!.find((g) => g.id === innerId)?.parentId).toBeUndefined();
  });

  it('rejects cycles on reparent, treats unknown parentId as root, and never hangs on cyclic loaded data', () => {
    const { sessionId } = mount({
      ...twoNodes(),
      groups: [
        { id: 'cyc1', title: 'Cyc1', nodeIds: ['a'], parentId: 'cyc2' },
        { id: 'cyc2', title: 'Cyc2', nodeIds: ['b'], parentId: 'cyc1' },
        { id: 'orphan', title: 'Orphan', nodeIds: [], bounds: { x: 0, y: 0, width: 200, height: 120 }, parentId: 'does_not_exist' },
      ],
    });
    // Cyclic & orphan data render and compute bounds safely without hanging.
    expect(groupChain(gOf(sessionId).groups, 'cyc1').map((g) => g.id)).toEqual(['cyc1', 'cyc2']);
    expect(groupSubtree(gOf(sessionId).groups, 'cyc1').nodeIds).toEqual(new Set(['a', 'b']));
    expect(groupFrameBounds(gOf(sessionId), 'cyc1', new Map())).not.toBeNull();
    expect(groupChain(gOf(sessionId).groups, 'orphan').map((g) => g.id)).toEqual(['orphan']);
    expect(flow.props!.nodes.some((n) => n.id === 'orphan')).toBe(true);

    // Break cycle into outer -> child, then verify reparenting rejects cycles and unknown parent becomes root.
    act(() => {
      expect(reparentGroup(sessionId, 'cyc1', undefined)).toBe(true);
      expect(reparentGroup(sessionId, 'cyc1', 'cyc1')).toBe(false);
      expect(reparentGroup(sessionId, 'cyc1', 'cyc2')).toBe(false);
      expect(reparentGroup(sessionId, 'cyc2', 'nonexistent')).toBe(true);
    });
    expect(gOf(sessionId).groups!.find((g) => g.id === 'cyc2')?.parentId).toBeUndefined();
  });

  it('duplicates and copies/pastes a group with subgroups, remapping all inner group, parentId, node and edge ids in 1 undo', () => {
    const { sessionId } = mount({
      nodes: [
        { id: 'a', position: { x: 100, y: 100 }, data: { kind: 'text', title: 'Prompt', text: 'hi' } },
        { id: 'b', position: { x: 450, y: 100 }, data: { kind: 'image', title: 'Img', prompt: '', modelRef: 'atlas::nb', settings: { count: 1, advanced: {} }, outputIndex: 0 } },
      ],
      edges: [{ id: 'e1', source: 'a', target: 'b', sourceHandle: 'out', targetHandle: 'prompt' }],
      groups: [
        { id: 'outer', title: 'Outer', nodeIds: [] },
        { id: 'inner', title: 'Inner', nodeIds: ['a', 'b'], parentId: 'outer' },
        { id: 'leaf', title: 'Leaf', nodeIds: [], parentId: 'outer', bounds: { x: 120, y: 380, width: 220, height: 140 } },
      ],
    });

    // Duplicate via right-click context menu.
    const undoBefore = graphHistory(sessionId, 'undo').length;
    rightClickFrame('outer');
    clickMenu('Duplicate');
    expect(graphHistory(sessionId, 'undo').length).toBe(undoBefore + 1);
    const afterDup = gOf(sessionId);
    expect(afterDup.groups).toHaveLength(6);
    expect(afterDup.nodes).toHaveLength(4);
    expect(afterDup.edges).toHaveLength(2);
    const newOuter = afterDup.groups!.find((g) => g.id !== 'outer' && g.title === 'Outer')!;
    const newInner = afterDup.groups!.find((g) => g.id !== 'inner' && g.title === 'Inner')!;
    const newLeaf = afterDup.groups!.find((g) => g.id !== 'leaf' && g.title === 'Leaf')!;
    expect(newOuter.parentId).toBeUndefined();
    expect(newInner.parentId).toBe(newOuter.id);
    expect(newLeaf.parentId).toBe(newOuter.id);
    expect(newInner.nodeIds.every((id) => id !== 'a' && id !== 'b')).toBe(true);
    const newEdge = afterDup.edges.find((e) => e.id !== 'e1')!;
    expect(newInner.nodeIds).toContain(newEdge.source);
    expect(newInner.nodeIds).toContain(newEdge.target);
    expect(newLeaf.bounds).toEqual({ x: 180, y: 440, width: 220, height: 140 });

    // 1 Undo removes the duplicated subtree cleanly.
    expect(travel(sessionId, 'undo')).toBe(true);
    expect(gOf(sessionId).groups).toHaveLength(3);
    expect(gOf(sessionId).nodes).toHaveLength(2);

    // Copy + Paste via Ctrl+C and document paste event on selected Outer group.
    act(() => { flow.props!.onNodesChange([{ id: 'outer', type: 'select', selected: true }]); });
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true })); });
    act(() => { document.dispatchEvent(new Event('paste', { bubbles: true, cancelable: true })); });
    const afterPaste = gOf(sessionId);
    expect(afterPaste.groups).toHaveLength(6);
    const pastedOuter = afterPaste.groups!.find((g) => g.id !== 'outer' && g.title === 'Outer')!;
    const pastedInner = afterPaste.groups!.find((g) => g.id !== 'inner' && g.title === 'Inner')!;
    expect(pastedInner.parentId).toBe(pastedOuter.id);
    expect(pastedInner.nodeIds.every((id) => id !== 'a' && id !== 'b')).toBe(true);
    expect(travel(sessionId, 'undo')).toBe(true);
    expect(gOf(sessionId).groups).toHaveLength(3);
  });
});
