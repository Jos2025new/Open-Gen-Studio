// @vitest-environment jsdom
import { act, createElement, Fragment, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Edge, EdgeChange, Node, NodeChange, NodeTypes } from '@xyflow/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NodeWorkspace } from '../src/components/node/NodeWorkspace';
import { addNode } from '../src/engine/flow/actions';
import type { GraphNode } from '../src/engine/types';
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


const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  vi.restoreAllMocks();
});

const text = (id: string, x: number, y: number): GraphNode => ({ id, position: { x, y }, data: { kind: 'text', title: id, text: id } });
const SIZE = { width: 300, height: 260 };
const measure = (...ids: string[]) => act(() => flow.props!.onNodesChange(ids.map((id) => ({ type: 'dimensions', id, dimensions: SIZE }) as NodeChange)));
const positions = (sessionId: string) => Object.fromEntries(useStore.getState().sessions[sessionId].graph.nodes.map((n) => [n.id, [n.position.x, n.position.y]]));

// One mount = one opening of the page: React state (measured sizes) starts empty, the store keeps the saved graph.
function mount(sessionId: string) {
  useStore.setState({ activeSessionId: sessionId });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  act(() => root.render(createElement(NodeWorkspace)));
  return () => { act(() => root.unmount()); container.remove(); };
}

describe('saved card positions survive a reload', () => {
  it('two saved cards that overlap keep their X/Y when measured; a card added afterwards is settled; no drift after several mounts', () => {
    const session = createSession(`reload-${Math.random()}`);
    // A saved pair overlapping once measured (300x260 cards, 100 px apart in Y).
    const saved = [text('a', 0, 0), text('b', 0, 100)];
    useStore.setState((s) => ({ generations: {}, assets: {}, sessions: { ...s.sessions, [session.id]: { ...session, graph: { nodes: saved, edges: [] }, feed: [] } } }));
    const expected = { a: [0, 0], b: [0, 100] };
    for (let i = 0; i < 4; i++) {
      const unmount = mount(session.id);
      measure('a', 'b');
      expect(positions(session.id)).toEqual(expected);
      unmount();
    }
    const unmount = mount(session.id);
    measure('a', 'b');
    const c = addNode(session.id, { kind: 'text', title: 'c', text: 'c' }, { x: 0, y: 50 });
    measure(c);
    const after = positions(session.id);
    expect(after.a).toEqual([0, 0]);
    expect(after.b).toEqual([0, 100]);
    expect(after[c]).not.toEqual([0, 50]);
    unmount();
    // The settled card is now saved: the next opening leaves it too.
    const settled = positions(session.id);
    const again = mount(session.id);
    measure('a', 'b', c);
    expect(positions(session.id)).toEqual(settled);
    again();
  });
});
