// @vitest-environment jsdom
import { act, createElement, Fragment, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Edge, EdgeChange, Node, NodeChange, NodeTypes } from '@xyflow/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NodeWorkspace, OmniCanvas } from '../src/components/node/NodeWorkspace';
import type { Graph } from '../src/engine/types';
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
        'div',
        { className: 'react-flow__pane' },
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
    useReactFlow: () => ({
      fitView: vi.fn(),
      screenToFlowPosition: (p: { x: number; y: number }) => p,
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
      zoomTo: vi.fn(),
      getZoom: () => 1,
      getNodes: () => [],
    }),
    useOnViewportChange: () => {},
    useViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    useConnection: () => false,
    useUpdateNodeInternals: () => () => {},
    useStore: (sel: (s: { transform: [number, number, number] }) => unknown) => sel({ transform: [0, 0, 1] }),
    Background: () => null,
    MiniMap: () => null,
    Panel: ({ children, ...rest }: { children?: ReactNode } & Record<string, unknown>) =>
      createElement('div', rest, children),
    Handle: () => null,
    NodeToolbar: ({ isVisible = true, children }: { isVisible?: boolean; children?: ReactNode }) =>
      isVisible ? createElement('div', null, children) : null,
  };
});

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  peekAssetUrl: () => undefined,
  loadAssetUrl: async () => undefined,
}));

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  vi.restoreAllMocks();
});

function mount(graph: Graph, omni = false) {
  const session = createSession(`bugs-${Math.random()}`);
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
  act(() => root.render(createElement(omni ? OmniCanvas : NodeWorkspace)));
  return { sessionId: session.id, container };
}

describe('NodeWorkspace delete confirmation', () => {
  it('Operations Delete asks confirmation before removing a ref node with model links', () => {
    const graph: Graph = {
      nodes: [
        { id: 'm1', position: { x: 0, y: 0 }, data: { kind: 'ref', type: 'model', ref: 'atlas::nb', title: 'Model' } },
        { id: 'a1', position: { x: 300, y: 0 }, data: { kind: 'ref', type: 'agent', ref: 'agent', title: 'Agent' } },
        { id: 't1', position: { x: 600, y: 0 }, data: { kind: 'text', title: 'Prompt', text: 'hi' } },
      ],
      edges: [{ id: 'e_ctrl', source: 'm1', sourceHandle: 'out_control', target: 'a1', targetHandle: 'model', kind: 'control' }],
    };
    const { sessionId, container } = mount(graph, true);

    act(() => {
      flow.props!.onNodesChange([
        { id: 'a1', type: 'select', selected: true },
        { id: 't1', type: 'select', selected: true },
      ]);
    });

    const opsBtn = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('Operations'));
    expect(opsBtn).toBeDefined();
    act(() => opsBtn!.click());

    const delBtn = container.querySelector<HTMLButtonElement>('.ops-bar button[aria-label="Delete"]');
    expect(delBtn).not.toBeNull();
    act(() => delBtn!.click());

    // Must not delete without confirmation!
    expect(useStore.getState().sessions[sessionId].graph.nodes.some((n) => n.id === 'a1')).toBe(true);
    const dialog = container.querySelector('[role="alertdialog"][aria-label="Remove from canvas"]');
    expect(dialog).not.toBeNull();

    const confirmBtn = [...dialog!.querySelectorAll('button')].find((b) => b.textContent === 'Remove');
    expect(confirmBtn).toBeDefined();
    act(() => confirmBtn!.click());
    expect(useStore.getState().sessions[sessionId].graph.nodes.some((n) => n.id === 'a1')).toBe(false);
    expect(useStore.getState().sessions[sessionId].graph.nodes.some((n) => n.id === 't1')).toBe(false);
  });
});

describe('Pan box selection with collapsed groups', () => {
  it('does not select hidden members of a collapsed group when boxing in Pan mode', () => {
    const graph: Graph = {
      nodes: [
        { id: 't1', position: { x: 100, y: 100 }, data: { kind: 'text', title: 'T1', text: 'a' } },
        { id: 't2', position: { x: 400, y: 100 }, data: { kind: 'text', title: 'T2', text: 'b' } },
      ],
      edges: [],
      groups: [{ id: 'g1', title: 'G1', nodeIds: ['t1', 't2'] }],
    };
    const { container } = mount(graph);
    const canvas = container.querySelector<HTMLDivElement>('.node-canvas')!;
    const pane = container.querySelector<HTMLDivElement>('.react-flow__pane')!;
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800, x: 0, y: 0, toJSON: () => ({}) });
    canvas.setPointerCapture = () => {};

    // Collapse the group.
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Collapse group"]')!.click());
    expect(flow.props!.nodes.find((n) => n.id === 't1')?.hidden).toBe(true);

    // Ensure Pan mode is active.
    const panBtn = container.querySelector<HTMLButtonElement>('button[aria-label^="Pan"]')!;
    act(() => panBtn.click());

    // Double pointerdown on empty pane and drag box over (50,50)..(700,400).
    const downEvt = (x: number, y: number) =>
      new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: x, clientY: y });
    const moveEvt = (x: number, y: number) =>
      new MouseEvent('pointermove', { bubbles: true, button: 0, clientX: x, clientY: y });
    const upEvt = (x: number, y: number) =>
      new MouseEvent('pointerup', { bubbles: true, button: 0, clientX: x, clientY: y });

    act(() => { pane.dispatchEvent(downEvt(50, 50)); });
    act(() => { pane.dispatchEvent(downEvt(50, 50)); });
    act(() => { canvas.dispatchEvent(moveEvt(700, 400)); });
    act(() => { canvas.dispatchEvent(upEvt(700, 400)); });

    // Hidden members must NOT be selected (Delete button stays disabled with 0 selected).
    const delNav = container.querySelector<HTMLButtonElement>('button[aria-label^="Delete selected"]')
      ?? container.querySelector<HTMLButtonElement>('button[aria-label^="Delete "]');
    expect(delNav?.disabled).toBe(true);
    expect(delNav?.getAttribute('aria-label')).toBe('Delete selected (Del)');
  });
});

describe('NodeWorkspace keydown listener stability', () => {
  it('does not re-register keydown listeners on re-renders while preserving X/Esc and Ctrl+G/Ctrl+Shift+G shortcuts', () => {
    const graph: Graph = {
      nodes: [
        { id: 't1', position: { x: 0, y: 0 }, data: { kind: 'text', title: 'T1', text: 'a' } },
        { id: 't2', position: { x: 300, y: 0 }, data: { kind: 'text', title: 'T2', text: 'b' } },
      ],
      edges: [],
    };
    const addSpy = vi.spyOn(window, 'addEventListener');
    const { sessionId, container } = mount(graph);
    addSpy.mockClear();

    // Re-render via selection changes and tool toggle.
    act(() => { flow.props!.onNodesChange([{ id: 't1', type: 'select', selected: true }]); });
    act(() => { flow.props!.onNodesChange([{ id: 't2', type: 'select', selected: true }]); });
    act(() => { container.querySelector<HTMLButtonElement>('button[aria-label^="Select:"]')!.click(); });

    const keydownRegistrations = addSpy.mock.calls.filter(([type]) => type === 'keydown');
    expect(keydownRegistrations).toHaveLength(0);

    // Shortcuts still work: Ctrl+G groups selected, Ctrl+Shift+G ungroups, X toggles cut, Escape exits cut.
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', ctrlKey: true, bubbles: true })); });
    expect(useStore.getState().sessions[sessionId].graph.groups).toHaveLength(1);

    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'G', ctrlKey: true, shiftKey: true, bubbles: true })); });
    expect(useStore.getState().sessions[sessionId].graph.groups).toEqual([]);

    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true })); });
    expect(container.querySelector('.node-canvas')?.classList.contains('is-cut-tool')).toBe(true);

    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(container.querySelector('.node-canvas')?.classList.contains('is-cut-tool')).toBe(false);
  });
});
