// @vitest-environment jsdom
import { act, createElement, Fragment, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Edge, EdgeChange, Node, NodeChange, NodeTypes } from '@xyflow/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmbeddedNodeCanvas, NodeWorkspace, OmniCanvas } from '../src/components/node/NodeWorkspace';
import { addNode, deleteNodes, duplicateNode, restoreNodeDeletion } from '../src/engine/flow/actions';
import { copyNodes, pasteNodes } from '../src/engine/flow/arrange';
import { chatToNodes } from '../src/engine/flow/fromChat';
import type { Generation, Graph, GraphNode } from '../src/engine/types';
import { createSession, selectSession, useStore } from '../src/store/store';

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
    useReactFlow: () => ({ fitView: vi.fn(), screenToFlowPosition: (p: { x: number; y: number }) => p, zoomIn: vi.fn(), zoomOut: vi.fn(), zoomTo: vi.fn(), getZoom: () => 1, getNodes: () => [] }),
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
const positions = (sessionId: string) => Object.fromEntries(useStore.getState().sessions[sessionId].graph.nodes.map((n) => [n.id, [n.position.x, n.position.y]]));

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

describe('attack 1: graph arriving after first render (hydration / async / omni)', () => {
  it('saved cards hydrated into the same sessionId after mount keep their X/Y instead of settling', () => {
    const sid = seedSession({ nodes: [], edges: [] });
    useStore.setState({ hydrated: false });
    mountCanvas(sid);
    // Simulate async hydration completing into the active sessionId after first render.
    act(() => {
      useStore.setState((s) => ({
        hydrated: true,
        sessions: {
          ...s.sessions,
          [sid]: { ...s.sessions[sid], graph: { nodes: [text('a', 0, 0), text('b', 0, 100)], edges: [] } },
        },
      }));
    });
    measure(['a', 'b']);
    expect(positions(sid)).toEqual({ a: [0, 0], b: [0, 100] });
  });

  it('OmniCanvas: saved ordinary overlapping cards keep X/Y while newly ensured system cards can still settle', () => {
    const sid = seedSession({ nodes: [text('a', 0, 0), text('b', 0, 100)], edges: [] });
    for (let i = 0; i < 3; i++) {
      const { unmount } = mountCanvas(sid, 'omni');
      const allIds = useStore.getState().sessions[sid].graph.nodes.map((n) => n.id);
      measure(allIds);
      const pos = positions(sid);
      expect(pos.a).toEqual([0, 0]);
      expect(pos.b).toEqual([0, 100]);
      unmount();
    }
  });

  it('OmniCanvas: saved omni cards spaced clear of estimated rects keep X/Y even when measured taller', () => {
    const omniA: GraphNode = { id: 'omni_asset_1', omni: true, position: { x: 800, y: 0 }, data: { kind: 'asset', title: 'A', assetId: 'ast1' } };
    const omniB: GraphNode = { id: 'omni_asset_2', omni: true, position: { x: 800, y: 290 }, data: { kind: 'asset', title: 'B', assetId: 'ast2' } };
    const sid = seedSession({ nodes: [omniA, omniB], edges: [] });
    const { unmount } = mountCanvas(sid, 'omni');
    // Estimated height is 220 (gap 70 > 56 so ensureOmniNodes keeps them); measured height 320 overlaps.
    measure([['omni_asset_1', { width: 260, height: 320 }], ['omni_asset_2', { width: 260, height: 320 }]]);
    const pos = positions(sid);
    expect(pos.omni_asset_1).toEqual([800, 0]);
    expect(pos.omni_asset_2).toEqual([800, 290]);
    unmount();
  });
});

describe('attack 2: cards that MUST still settle (added, pasted, duplicated, imported, undo deletion)', () => {
  it('added, pasted, duplicated and chat-imported cards still settle off neighbours', () => {
    const sid = seedSession({ nodes: [text('a', 0, 0)], edges: [] });
    mountCanvas(sid);
    measure(['a']);

    // Added
    let added = '';
    act(() => { added = addNode(sid, { kind: 'text', title: 'added', text: 'added' }, { x: 0, y: 40 }); });
    measure([added]);
    expect(positions(sid)[added]).not.toEqual([0, 40]);

    // Duplicated (placed at +40, +60 over 'a')
    const nodeA = useStore.getState().sessions[sid].graph.nodes.find((n) => n.id === 'a')!;
    let dup = '';
    act(() => { dup = duplicateNode(sid, nodeA); });
    measure([dup]);
    expect(positions(sid)[dup]).not.toEqual([40, 60]);

    // Pasted (placed at +60, +60 over 'a')
    let pasted = '';
    act(() => { copyNodes(sid, ['a']); [pasted] = pasteNodes(sid); });
    measure([pasted]);
    expect(positions(sid)[pasted]).not.toEqual([60, 60]);

    // Imported from chat: two independent generations laid out by estimated height (170+56=226) overlap when measured at 260 px.
    const makeGen = (id: string, createdAt: number): Generation => ({
      id, sessionId: sid, kind: 'text', status: 'done', createdAt, prompt: id,
      modelRef: 'local::sketch', modelName: 'Local', provider: 'local', settings: { count: 1, advanced: {} }, inputs: { refs: [] },
      assetIds: [], text: id, estimate: { usd: 0, approximate: true }, origin: 'composer',
    });
    let imported: GraphNode[] = [];
    act(() => {
      useStore.setState((s) => ({ generations: { ...s.generations, gen_1: makeGen('gen_1', 1), gen_2: makeGen('gen_2', 2) } }));
      imported = chatToNodes(sid, ['gen_1', 'gen_2']).added;
    });
    expect(imported).toHaveLength(2);
    const beforeImp = imported.map((n) => positions(sid)[n.id]);
    measure(imported.map((n) => n.id));
    expect(positions(sid)[imported[1].id]).not.toEqual(beforeImp[1]);
  });

  it('undoing a deletion via restoreNodeDeletion in the same mount settles the restored card off a card now occupying its spot', () => {
    const sid = seedSession({ nodes: [text('a', 0, 0), text('b', 0, 500)], edges: [] });
    mountCanvas(sid);
    measure(['a', 'b']);
    act(() => { deleteNodes(sid, ['b']); });
    let c = '';
    act(() => { c = addNode(sid, { kind: 'text', title: 'c', text: 'c' }, { x: 0, y: 500 }); });
    measure([c]);
    expect(positions(sid)[c]).toEqual([0, 500]);

    const notice = useStore.getState().sessions[sid].feed.find((f) => f.type === 'notice' && f.undoNodes)!;
    expect(notice).toBeDefined();
    act(() => { expect(restoreNodeDeletion(sid, notice.id)).toBeNull(); });
    measure(['b']);
    expect(positions(sid).b).not.toEqual([0, 500]);
    expect(positions(sid)[c]).toEqual([0, 500]);
  });

  it('undoing a deletion of an unmeasured saved card (e.g. deleted before dimensions) settles it off a card now occupying its spot', () => {
    const sid = seedSession({ nodes: [text('a', 0, 0), text('b', 0, 500)], edges: [] });
    mountCanvas(sid);
    measure(['a']);
    act(() => { deleteNodes(sid, ['b']); });
    let c = '';
    act(() => { c = addNode(sid, { kind: 'text', title: 'c', text: 'c' }, { x: 0, y: 500 }); });
    measure([c]);
    const notice = useStore.getState().sessions[sid].feed.find((f) => f.type === 'notice' && f.undoNodes)!;
    act(() => { expect(restoreNodeDeletion(sid, notice.id)).toBeNull(); });
    measure(['b']);
    expect(positions(sid).b).not.toEqual([0, 500]);
  });
});

describe('attack 3: session switch & return, group frames, EmbeddedNodeCanvas vs NodeWorkspace', () => {
  it('switching sessions A -> B -> A preserves saved overlapping positions in both sessions', () => {
    const sidA = seedSession({ nodes: [text('a1', 0, 0), text('a2', 0, 100)], edges: [] });
    const sidB = seedSession({ nodes: [text('b1', 10, 20), text('b2', 10, 120)], edges: [] });
    mountCanvas(sidA);
    measure(['a1', 'a2']);
    expect(positions(sidA)).toEqual({ a1: [0, 0], a2: [0, 100] });

    act(() => selectSession(sidB));
    measure(['b1', 'b2']);
    expect(positions(sidB)).toEqual({ b1: [10, 20], b2: [10, 120] });

    act(() => selectSession(sidA));
    measure(['a1', 'a2']);
    expect(positions(sidA)).toEqual({ a1: [0, 0], a2: [0, 100] });

    // New card in A settles and stays settled after B -> A round-trip.
    let a3 = '';
    act(() => { a3 = addNode(sidA, { kind: 'text', title: 'a3', text: 'a3' }, { x: 0, y: 50 }); });
    measure([a3]);
    const settledA3 = positions(sidA)[a3];
    expect(settledA3).not.toEqual([0, 50]);

    act(() => selectSession(sidB));
    measure(['b1', 'b2']);
    act(() => selectSession(sidA));
    measure(['a1', 'a2', a3]);
    expect(positions(sidA)).toEqual({ a1: [0, 0], a2: [0, 100], [a3]: settledA3 });
  });

  it('group frames: saved overlapping cards inside a group keep X/Y and frame geometry across reloads; new card settles', () => {
    const sid = seedSession({
      nodes: [text('a', 0, 0), text('b', 0, 100)],
      edges: [],
      groups: [{ id: 'grp_1', title: 'Frame', nodeIds: ['a', 'b'] }],
    });
    for (let i = 0; i < 3; i++) {
      const { unmount } = mountCanvas(sid);
      // Group frame dimensions change must be ignored; saved members must stay put.
      measure([['grp_1', { width: 400, height: 500 }], ['a', SIZE], ['b', SIZE]]);
      expect(positions(sid)).toEqual({ a: [0, 0], b: [0, 100] });
      const frame = flow.props!.nodes.find((n) => n.id === 'grp_1')!;
      expect(frame.position).toEqual({ x: -28, y: -46 });
      unmount();
    }
    mountCanvas(sid);
    measure(['a', 'b']);
    let c = '';
    act(() => { c = addNode(sid, { kind: 'text', title: 'c', text: 'c' }, { x: 0, y: 50 }); });
    measure([c]);
    expect(positions(sid).a).toEqual([0, 0]);
    expect(positions(sid).b).toEqual([0, 100]);
    expect(positions(sid)[c]).not.toEqual([0, 50]);
  });

  it('EmbeddedNodeCanvas preserves saved overlapping positions across reloads', () => {
    const sid = seedSession({ nodes: [text('a', 0, 0), text('b', 0, 100)], edges: [] });
    for (let i = 0; i < 3; i++) {
      const { unmount } = mountCanvas(sid, 'embedded');
      measure(['a', 'b']);
      expect(positions(sid)).toEqual({ a: [0, 0], b: [0, 100] });
      unmount();
    }
  });
});
