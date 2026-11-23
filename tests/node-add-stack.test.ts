// @vitest-environment jsdom
import { act, createElement, Fragment, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Edge, EdgeChange, Node, NodeChange, NodeTypes } from '@xyflow/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmbeddedNodeCanvas, NodeWorkspace, OmniCanvas } from '../src/components/node/NodeWorkspace';
import type { Graph, GraphNode } from '../src/engine/types';
import { findFreePositionFor, nodeRect, panelZone, rectsOverlap } from '../src/engine/flow/graph';
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
    useReactFlow: () => ({ fitView: vi.fn(), screenToFlowPosition: (p: { x: number; y: number }) => p, flowToScreenPosition: (p: { x: number; y: number }) => p, setViewport: vi.fn(), setCenter: vi.fn(), getViewport: () => ({ x: 0, y: 0, zoom: 1 }), zoomIn: vi.fn(), zoomOut: vi.fn(), zoomTo: vi.fn(), getZoom: () => 1, getNodes: () => [] }),
    useOnViewportChange: () => {},
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
if (typeof globalThis.ResizeObserver === 'undefined') {
  Object.assign(globalThis, { ResizeObserver: class { observe() {} unobserve() {} disconnect() {} } });
}
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  vi.restoreAllMocks();
});

const text = (id: string, x: number, y: number): GraphNode => ({ id, position: { x, y }, data: { kind: 'text', title: id, text: id } });
const SIZE = { width: 300, height: 260 };
const measure = (dims: Array<[string, { width: number; height: number }]> | string[]) => {
  const entries = typeof dims[0] === 'string'
    ? (dims as string[]).map((id) => [id, SIZE] as [string, { width: number; height: number }])
    : (dims as Array<[string, { width: number; height: number }]>);
  act(() => flow.props!.onNodesChange(entries.map(([id, dimensions]) => ({ type: 'dimensions', id, dimensions }) as NodeChange)));
};

function seedSession(graph: Graph, extra?: Partial<ReturnType<typeof createSession>>) {
  const session = createSession(`adv-${Math.random()}`);
  useStore.setState((s) => ({
    generations: {},
    assets: {},
    sessions: { ...s.sessions, [session.id]: { ...session, graph, feed: [], ...extra } },
  }));
  return session.id;
}

function mountCanvas(sessionId: string, kind: 'nodes' | 'omni' | 'embedded' = 'nodes') {
  useStore.setState({ activeSessionId: sessionId });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const Comp = kind === 'omni' ? OmniCanvas : kind === 'embedded' ? EmbeddedNodeCanvas : NodeWorkspace;
  act(() => root.render(createElement(Comp)));
  const unmount = () => { act(() => root.unmount()); container.remove(); };
  cleanups.push(unmount);
  return { unmount, container };
}


const positionsOf = (sid: string) => useStore.getState().sessions[sid].graph.nodes;

async function addVia(label: string) {
  await act(async () => { document.querySelector<HTMLButtonElement>('button[aria-label="Add node…"]')!.click(); });
  const opt = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find((el) => el.querySelector('.node-lib-text > span')?.textContent === label);
  expect(opt, label + ' in ' + [...document.querySelectorAll('[role="option"]')].map((e) => e.textContent).join('/')).toBeDefined();
  await act(async () => { opt!.click(); });
}

describe('Add node menu: three nodes added in a row land free of each other', () => {
  it.each(['nodes', 'omni'] as const)('Text, Image, Video in %s do not overlap (estimated and measured)', async (kind) => {
    const sid = seedSession({ nodes: [], edges: [] });
    mountCanvas(sid, kind);
    const before = new Set(positionsOf(sid).map((n) => n.id));
    for (const label of ['Text', 'Image', 'Video']) await addVia(label);
    const added = positionsOf(sid).filter((n) => !before.has(n.id));
    expect(added).toHaveLength(3);
    const check = (m?: Map<string, { width: number; height: number }>) => {
      for (let i = 0; i < added.length; i++) for (let j = i + 1; j < added.length; j++) {
        expect(rectsOverlap(nodeRect(added[i], m), nodeRect(added[j], m)), `${added[i].data.title} vs ${added[j].data.title}`).toBe(false);
      }
    };
    check();
    // The real cards are taller than the estimate; once measured they settle clear of each other.
    measure(added.map((n) => n.id));
    const now = positionsOf(sid).filter((n) => !before.has(n.id));
    const m = new Map(now.map((n) => [n.id, SIZE]));
    for (let i = 0; i < now.length; i++) for (let j = i + 1; j < now.length; j++) expect(rectsOverlap(nodeRect(now[i], m), nodeRect(now[j], m))).toBe(false);
  });
});


describe('a new node keeps its floating composer panel clear of its neighbours', () => {
  it('the panel zone under the card of a node with a panel is free; a Text node needs none', () => {
    const card = { x: 0, y: 0, width: 260, height: 220 };
    // A neighbour 60 px under where the new card would go: clear of the card itself, but under its composer panel.
    const below: GraphNode = text('below', 0, 220 + 60);
    const image = { kind: 'image', title: 'Image' } as GraphNode['data'];
    const at = findFreePositionFor(image, { x: 0, y: 0 }, [nodeRect(below)]);
    const zone = panelZone(image, { ...card, ...at });
    expect(zone).not.toBeNull();
    expect(rectsOverlap(zone!, nodeRect(below))).toBe(false);
    expect(findFreePositionFor(text('t', 0, 0).data, { x: 0, y: 0 }, [nodeRect(below)])).toEqual({ x: 0, y: 0 });
    expect(panelZone(text('t', 0, 0).data, card)).toBeNull();
  });

  it.each(['nodes', 'omni'] as const)('Text, Image, Video added in a row in %s: no card sits under the composer panel of the selected one', async (kind) => {
    const sid = seedSession({ nodes: [], edges: [] });
    mountCanvas(sid, kind);
    const before = new Set(positionsOf(sid).map((n) => n.id));
    for (const label of ['Text', 'Image', 'Video']) await addVia(label);
    const added = positionsOf(sid).filter((n) => !before.has(n.id));
    const last = added[added.length - 1];
    const zone = panelZone(last.data, nodeRect(last))!;
    for (const o of positionsOf(sid)) if (o.id !== last.id) expect(rectsOverlap(zone, nodeRect(o)), `${o.data.title} under the Video composer`).toBe(false);
  });
});
