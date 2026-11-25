// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Edge, EdgeChange, Node, NodeChange, NodeTypes } from '@xyflow/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NodeWorkspace } from '../src/components/node/NodeWorkspace';
import { run } from '../src/engine/commands';
import { copyNodes, detachOutputs, pasteNodes } from '../src/engine/flow/arrange';
import { graphHistory, travelGraph } from '../src/engine/flow/history';
import { applyEdit } from '../src/engine/nodecore/edit';
import type { Graph } from '../src/engine/types';
import { createSession, useStore } from '../src/store/store';

const flow = vi.hoisted(() => ({
  props: null as null | {
    nodes: Node[];
    edges: Edge[];
    children: ReactNode;
    onNodesChange(changes: NodeChange[]): void;
    onEdgesChange(changes: EdgeChange[]): void;
    onBeforeDelete?: (p: { nodes: Node[]; edges: Edge[] }) => Promise<boolean>;
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
  const session = createSession(`lg-del-${Math.random()}`);
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

describe('Nodes group delete, confirm-pop, command and paste bounds (Part A3)', () => {
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
  const dialogBtn = (container: HTMLElement, label: string) => {
    const dlg = container.querySelector('[role="alertdialog"][aria-label="Delete group"]');
    expect(dlg, 'Delete group dialog').not.toBeNull();
    const btn = [...dlg!.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === label);
    expect(btn, `dialog button "${label}"`).toBeDefined();
    return btn!;
  };

  it('asks Cancel / Ungroup / Delete with contents via Del, toolbar Delete and menu; Ungroup lifts direct children in 1 undo', async () => {
    const { sessionId, container } = mount({
      nodes: [
        { id: 'a', position: { x: 100, y: 100 }, data: { kind: 'text', title: 'A', text: 'a' } },
        { id: 'b', position: { x: 450, y: 100 }, data: { kind: 'text', title: 'B', text: 'b' } },
      ],
      edges: [],
      groups: [
        { id: 'outer', title: 'Outer', nodeIds: [] },
        { id: 'mid', title: 'Mid', nodeIds: ['a'], parentId: 'outer' },
        { id: 'inner', title: 'Inner', nodeIds: ['b'], parentId: 'mid' },
      ],
    });

    // Select Mid frame (selects Mid + subtree nodes a, b), press Del -> confirm-pop opens; Cancel leaves graph intact.
    act(() => { flow.props!.onNodesChange([{ id: 'mid', type: 'select', selected: true }]); });
    const midNodes = flow.props!.nodes.filter((n) => n.selected);
    await act(async () => { await flow.props!.onBeforeDelete?.({ nodes: midNodes, edges: [] }); });
    act(() => dialogBtn(container, 'Cancel').click());
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(gOf(sessionId).groups).toHaveLength(3);
    expect(gOf(sessionId).nodes).toHaveLength(2);

    // Toolbar Delete button opens the same confirm-pop; Ungroup lifts Mid's direct node (a) and subgroup (Inner) into Outer in 1 undo.
    const undoBefore = graphHistory(sessionId, 'undo').length;
    const delBtn = container.querySelector<HTMLButtonElement>('button[aria-label*="Delete"]')!;
    expect(delBtn).not.toBeNull();
    act(() => delBtn.click());
    act(() => dialogBtn(container, 'Ungroup').click());
    expect(gOf(sessionId).groups!.map((g) => g.id)).toEqual(['outer', 'inner']);
    expect(gOf(sessionId).groups!.find((g) => g.id === 'outer')!.nodeIds).toEqual(['a']);
    expect(gOf(sessionId).groups!.find((g) => g.id === 'inner')!.parentId).toBe('outer');
    expect(gOf(sessionId).nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(graphHistory(sessionId, 'undo').length).toBe(undoBefore + 1);

    // 1 Undo restores Mid, 1 Redo ungroups again.
    expect(travel(sessionId, 'undo')).toBe(true);
    expect(gOf(sessionId).groups!.find((g) => g.id === 'mid')?.nodeIds).toEqual(['a']);
    expect(gOf(sessionId).groups!.find((g) => g.id === 'inner')?.parentId).toBe('mid');
    expect(travel(sessionId, 'redo')).toBe(true);
    expect(gOf(sessionId).groups!.find((g) => g.id === 'outer')?.nodeIds).toEqual(['a']);
    expect(gOf(sessionId).groups!.find((g) => g.id === 'inner')?.parentId).toBe('outer');

    // Context menu Delete -> Ungroup on root Outer lifts direct node (a) and subgroup (Inner) to root.
    rightClickFrame('outer');
    clickMenu('Delete');
    act(() => dialogBtn(container, 'Ungroup').click());
    expect(gOf(sessionId).groups!.map((g) => g.id)).toEqual(['inner']);
    expect(gOf(sessionId).groups![0].parentId).toBeUndefined();
    expect(gOf(sessionId).nodes.map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('Delete with contents removes the whole subtree via planDelete (broken cables + notice, no orphan frames) in 1 undo/redo', () => {
    const { sessionId, container } = mount({
      nodes: [
        { id: 'a', position: { x: 100, y: 100 }, data: { kind: 'text', title: 'A', text: 'a' } },
        { id: 'b', position: { x: 450, y: 100 }, data: { kind: 'text', title: 'B', text: 'b' } },
        { id: 'ext', position: { x: 900, y: 100 }, data: { kind: 'image', title: 'Ext', prompt: '', modelRef: 'atlas::nb', settings: { count: 1, advanced: {} }, outputIndex: 0 } },
      ],
      edges: [{ id: 'e_out', source: 'b', target: 'ext', sourceHandle: 'out', targetHandle: 'prompt' }],
      groups: [
        { id: 'outer', title: 'Outer', nodeIds: ['a'] },
        { id: 'inner', title: 'Inner', nodeIds: ['b'], parentId: 'outer' },
        { id: 'leaf', title: 'Leaf', nodeIds: [], parentId: 'outer', bounds: { x: 120, y: 360, width: 200, height: 120 } },
      ],
    });

    const undoBefore = graphHistory(sessionId, 'undo').length;
    rightClickFrame('outer');
    clickMenu('Delete');
    act(() => dialogBtn(container, 'Delete with contents').click());

    expect(gOf(sessionId).groups).toEqual([]);
    expect(gOf(sessionId).nodes.map((n) => n.id)).toEqual(['ext']);
    expect(gOf(sessionId).edges).toEqual([]);
    expect(gOf(sessionId).broken?.map((b) => b.edge.id)).toEqual(['e_out']);
    expect(useStore.getState().sessions[sessionId].feed.some((f) => f.type === 'notice' && f.text.includes('Deleted nodes'))).toBe(true);
    expect(graphHistory(sessionId, 'undo').length).toBe(undoBefore + 1);

    // 1 Undo restores everything cleanly; 1 Redo deletes all without leaving empty frames.
    expect(travel(sessionId, 'undo')).toBe(true);
    expect(gOf(sessionId).groups).toHaveLength(3);
    expect(gOf(sessionId).nodes).toHaveLength(3);
    expect(gOf(sessionId).edges).toHaveLength(1);
    expect(gOf(sessionId).broken).toBeUndefined();
    expect(travel(sessionId, 'redo')).toBe(true);
    expect(gOf(sessionId).groups).toEqual([]);
    expect(gOf(sessionId).nodes.map((n) => n.id)).toEqual(['ext']);
  });

  it('prompts when a group holds only an empty subgroup and leaves detachedOutputs / sys_grp_ unchanged', () => {
    const { sessionId, container } = mount({
      nodes: [
        { id: 'n1', position: { x: 0, y: 0 }, data: { kind: 'image', title: 'Img', prompt: '', modelRef: 'atlas::nb', settings: { count: 2, advanced: {} }, outputIndex: 0, generationId: 'g1' } },
        { id: 'n2', position: { x: 400, y: 0 }, data: { kind: 'text', title: 'Sys', text: '' } },
      ],
      edges: [],
      groups: [
        { id: 'holder', title: 'Holder', nodeIds: [] },
        { id: 'sub_empty', title: 'SubEmpty', nodeIds: [], parentId: 'holder', bounds: { x: 20, y: 40, width: 200, height: 120 } },
        { id: 'sys_grp_1', title: 'Sys', nodeIds: ['n2'] },
      ],
    });
    act(() => {
      useStore.setState((s) => ({
        generations: { ...s.generations, g1: { id: 'g1', sessionId, stepId: 'n1', status: 'done', kind: 'image', prompt: '', modelRef: 'atlas::nb', settings: { count: 2, advanced: {} }, inputs: { refs: [] }, assetIds: ['a1', 'a2'] } as never },
      }));
      detachOutputs(sessionId, 'n1');
    });
    const detId = gOf(sessionId).groups!.find((g) => 'detachedOutputs' in g)!.id;

    // Detached outputs: Delete reattaches without opening Delete group dialog.
    rightClickFrame(detId);
    clickMenu('Delete');
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(gOf(sessionId).groups!.some((g) => g.id === detId)).toBe(false);

    // sys_grp_: Delete ungroups directly without dialog, keeping node n2.
    rightClickFrame('sys_grp_1');
    clickMenu('Delete');
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(gOf(sessionId).groups!.some((g) => g.id === 'sys_grp_1')).toBe(false);
    expect(gOf(sessionId).nodes.some((n) => n.id === 'n2')).toBe(true);

    // Group containing only an empty subgroup asks, and Delete with contents removes both in 1 undo.
    rightClickFrame('holder');
    clickMenu('Delete');
    act(() => dialogBtn(container, 'Delete with contents').click());
    expect(gOf(sessionId).groups).toEqual([]);
  });

  it('supports deleting a group via nodes.node.delete (ungroup or delete contents) in 1 undo', async () => {
    const { sessionId } = mount({
      nodes: [
        { id: 'a', position: { x: 100, y: 100 }, data: { kind: 'text', title: 'A', text: 'a' } },
        { id: 'b', position: { x: 450, y: 100 }, data: { kind: 'text', title: 'B', text: 'b' } },
      ],
      edges: [],
      groups: [
        { id: 'outer', title: 'Outer', nodeIds: [] },
        { id: 'mid', title: 'Mid', nodeIds: ['a'], parentId: 'outer' },
        { id: 'inner', title: 'Inner', nodeIds: ['b'], parentId: 'mid' },
      ],
    });

    const missing = await run({ cmd: 'nodes.node.delete', args: { group: 'nope', contents: 'ungroup' }, on: { session: sessionId } }, { caller: 'agent' });
    expect(missing).toMatchObject({ ok: false, error: { code: 'unavailable' } });

    const un = await run({ cmd: 'nodes.node.delete', args: { group: 'mid', contents: 'ungroup' }, on: { session: sessionId } }, { caller: 'agent' });
    expect(un.ok).toBe(true);
    expect(gOf(sessionId).groups!.find((g) => g.id === 'outer')!.nodeIds).toEqual(['a']);
    expect(gOf(sessionId).groups!.find((g) => g.id === 'inner')!.parentId).toBe('outer');

    const delAll = await run({ cmd: 'nodes.node.delete', args: { group: 'outer', contents: 'delete' }, on: { session: sessionId } }, { caller: 'agent' });
    expect(delAll.ok).toBe(true);
    expect(gOf(sessionId).groups).toEqual([]);
    expect(gOf(sessionId).nodes).toEqual([]);
    expect(travel(sessionId, 'undo')).toBe(true);
    expect(gOf(sessionId).groups).toHaveLength(2);
    expect(gOf(sessionId).nodes).toHaveLength(2);
  });

  it('pasteNodes ignores stale bounds on non-empty groups when computing the target offset', () => {
    const { sessionId } = mount({
      nodes: [{ id: 'a', position: { x: 500, y: 400 }, data: { kind: 'text', title: 'A', text: 'a' } }],
      edges: [],
      groups: [{ id: 'g1', title: 'G1', nodeIds: ['a'], bounds: { x: 10, y: 20, width: 200, height: 150 } }],
    });

    act(() => { copyNodes(sessionId, [], ['g1']); });
    let pastedIds: string[] = [];
    act(() => { pastedIds = pasteNodes(sessionId, { x: 800, y: 700 }); });
    const pastedNode = gOf(sessionId).nodes.find((n) => n.id === pastedIds[0])!;
    expect(pastedNode.position).toEqual({ x: 800, y: 700 });
  });
});
