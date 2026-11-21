// @vitest-environment jsdom
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { act, createElement, useRef, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Edge, EdgeChange, Node, NodeChange, NodeTypes } from '@xyflow/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmbeddedNodeCanvas, NodeWorkspace, OmniCanvas } from '../src/components/node/NodeWorkspace';
import { segmentCuts, trailCuts, useCutTool, type Pt } from '../src/components/node/CutTool';
import { deleteNodes, tryConnect } from '../src/engine/flow/actions';
import { groupNodes, hasNodeClipboard, renameGroup, setGroupColor, ungroup } from '../src/engine/flow/arrange';
import { graphHistory, travelGraph } from '../src/engine/flow/history';
import * as edit from '../src/engine/nodecore/edit';
import { storeHooks } from '../src/engine/storeBindings';
import type { Graph, GraphNode } from '../src/engine/types';
import { createSession, useStore } from '../src/store/store';
import { check as checkNodeDrag } from '../scripts/check-node-drag.mjs';

const flow = vi.hoisted(() => ({
  props: null as null | {
    nodes: Node[]; edges: Edge[]; children: ReactNode;
    onNodesChange(c: NodeChange[]): void; onEdgesChange(c: EdgeChange[]): void;
    onBeforeDelete?(p: { nodes: Array<{ id: string }>; edges: Array<{ id: string }> }): Promise<boolean>;
    onNodeContextMenu?(e: React.MouseEvent, node: Node): void;
  },
}));

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>();
  return {
    ...actual,
    ReactFlow(p: NonNullable<typeof flow.props> & { nodeTypes: NodeTypes }) {
      flow.props = p;
      return createElement('div', { className: 'react-flow__pane' }, p.children,
        ...p.nodes.filter((n) => !n.hidden).map((n) => createElement(p.nodeTypes[n.type!], {
          ...n, key: n.id, type: n.type!, selected: Boolean(n.selected), dragging: false,
          draggable: n.draggable ?? true, selectable: n.selectable ?? true, deletable: n.deletable ?? true,
          isConnectable: n.connectable ?? true, zIndex: n.zIndex ?? 0, positionAbsoluteX: n.position.x, positionAbsoluteY: n.position.y,
        })));
    },
    useReactFlow: () => ({ fitView: vi.fn(), screenToFlowPosition: (p: Pt) => p, zoomIn: vi.fn(), zoomOut: vi.fn(), zoomTo: vi.fn(), getZoom: () => 1, getNodes: () => [] }),
    useOnViewportChange: () => {}, useViewport: () => ({ x: 0, y: 0, zoom: 1 }), useConnection: () => false,
    useUpdateNodeInternals: () => () => {}, useStore: (sel: (s: { transform: [number, number, number] }) => unknown) => sel({ transform: [0, 0, 1] }),
    Background: () => null, MiniMap: () => null, Handle: () => null,
    Panel: ({ children, ...r }: { children?: ReactNode } & Record<string, unknown>) => createElement('div', r, children),
    NodeToolbar: ({ isVisible = true, children }: { isVisible?: boolean; children?: ReactNode }) => isVisible ? createElement('div', null, children) : null,
  };
});

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  peekAssetUrl: () => undefined, loadAssetUrl: async () => undefined,
}));

if (typeof globalThis.ResizeObserver === 'undefined') {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}

const cleanups: Array<() => void> = [];
const unmountAll = () => { while (cleanups.length) cleanups.pop()!(); };
afterEach(() => { unmountAll(); vi.restoreAllMocks(); });

const makeGraph = (n: number, grp = true): Graph => ({
  nodes: Array.from({ length: n }, (_, i): GraphNode => ({
    id: `n${i}`, position: { x: (i % 10) * 260, y: Math.floor(i / 10) * 180 },
    data: { kind: 'text', title: `N${i}`, text: `P${i}` },
  })),
  edges: n > 2 ? [
    { id: 'e0', source: 'n0', sourceHandle: 'out', target: 'n1', targetHandle: 'in' },
    { id: 'e1', source: 'n1', sourceHandle: 'out', target: 'n2', targetHandle: 'in' },
  ] : [],
  groups: grp && n >= 2 ? [{ id: 'g0', title: 'G0', nodeIds: ['n0', 'n1'] }] : undefined,
});

function mountCanvas(graph: Graph, mode: 'node' | 'omni' | 'embedded' = 'node') {
  const s = createSession(`adv-${Math.random()}`);
  useStore.setState((st) => ({ activeSessionId: s.id, generations: {}, assets: {}, sessions: { ...st.sessions, [s.id]: { ...s, graph, feed: [] } } }));
  const el = document.createElement('div'); document.body.append(el);
  const root = createRoot(el);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  cleanups.push(() => { act(() => root.unmount()); el.remove(); });
  act(() => root.render(createElement(mode === 'omni' ? OmniCanvas : mode === 'embedded' ? EmbeddedNodeCanvas : NodeWorkspace)));
  return { sid: s.id, el };
}

const tr = (sid: string, dir: 'undo' | 'redo') =>
  travelGraph(sid, useStore.getState().sessions[sid].graph, dir, 1, (next) => edit.applyEdit({ session: sid, op: { op: 'travel', graph: next } }).ok);
const sPos = (sid: string, id: string) => useStore.getState().sessions[sid].graph.nodes.find((n) => n.id === id)?.position;
const rNode = (id: string) => flow.props!.nodes.find((n) => n.id === id);
const rPos = (id: string) => rNode(id)?.position;
const pCh = (id: string, dragging: boolean, position?: Pt): NodeChange => ({ id, type: 'position', dragging, ...(position ? { position } : {}) });
const sCh = (...ids: string[]): NodeChange[] => ids.map((id) => ({ id, type: 'select' as const, selected: true }));
const btn = (root: ParentNode, sel: string) => root.querySelector<HTMLButtonElement>(sel)!;
const onCh = (cs: NodeChange[]) => act(() => flow.props!.onNodesChange(cs));

describe('Attack 1: drag gestures, frames, cables, mid-drag mutations, session switch', () => {
  it('200-node multiselect: 0 writes in move, stable edges, 1 drop write, 2 rapid drags = 2 undo', () => {
    const { sid } = mountCanvas(makeGraph(200));
    let w = 0; cleanups.push(useStore.subscribe((n, p) => { if (n.sessions[sid]?.graph !== p.sessions[sid]?.graph) w++; }));
    const editSpy = vi.spyOn(edit, 'editPresentation'), recSpy = vi.spyOn(storeHooks, 'recordGraph');
    const eRef = flow.props!.edges, ids = ['n0', 'n2', 'n5', 'n50', 'n199'];

    for (let k = 1; k <= 20; k++) onCh(ids.map((id, i) => pCh(id, true, { x: i * 100 + k * 4, y: k * 3 })));
    expect(w).toBe(0); expect(editSpy).not.toHaveBeenCalled(); expect(recSpy).not.toHaveBeenCalled();
    expect(flow.props!.edges).toBe(eRef); expect(flow.props!.edges.map((e) => e.id)).toEqual(['e0', 'e1']);

    onCh(ids.map((id) => pCh(id, false)));
    expect(w).toBe(1); expect(editSpy).toHaveBeenCalledTimes(1); expect(recSpy).toHaveBeenCalledTimes(1);
    expect(graphHistory(sid, 'undo')).toHaveLength(1); expect(sPos(sid, 'n199')).toEqual({ x: 480, y: 60 });

    act(() => { flow.props!.onNodesChange([pCh('n199', true, { x: 600, y: 120 })]); flow.props!.onNodesChange([pCh('n199', false)]); });
    expect(graphHistory(sid, 'undo')).toHaveLength(2);
    expect(tr(sid, 'undo')).toBe(true); expect(sPos(sid, 'n199')).toEqual({ x: 480, y: 60 });
    expect(tr(sid, 'undo')).toBe(true); expect(sPos(sid, 'n199')).toEqual({ x: 9 * 260, y: 19 * 180 });
  });

  it('collapsed group frame drag: 0 mid-drag writes, moves hidden members, 1 undo on drop', () => {
    const { sid, el } = mountCanvas(makeGraph(4));
    act(() => btn(el, 'button[aria-label="Collapse group"]').click());
    expect(rNode('n0')?.hidden).toBe(true);
    let w = 0; cleanups.push(useStore.subscribe((n, p) => { if (n.sessions[sid]?.graph !== p.sessions[sid]?.graph) w++; }));
    const st = rPos('g0')!;
    onCh([pCh('g0', true, { x: st.x + 120, y: st.y + 60 })]);
    expect(w).toBe(0); expect(rPos('g0')).toEqual({ x: st.x + 120, y: st.y + 60 });
    onCh([pCh('g0', false)]);
    expect(w).toBe(1); expect(sPos(sid, 'n0')).toEqual({ x: 120, y: 60 }); expect(sPos(sid, 'n1')).toEqual({ x: 380, y: 60 });
    expect(graphHistory(sid, 'undo')).toHaveLength(1);
  });

  it('deleting a node mid-drag then dropping does not resurrect it', () => {
    const { sid } = mountCanvas(makeGraph(4));
    onCh([pCh('n0', true, { x: 150, y: 80 }), pCh('n2', true, { x: 650, y: 80 })]);
    act(() => { deleteNodes(sid, ['n0']); });
    onCh([pCh('n0', false, { x: 150, y: 80 }), pCh('n2', false, { x: 650, y: 80 })]);
    expect(useStore.getState().sessions[sid].graph.nodes.some((n) => n.id === 'n0')).toBe(false);
    expect(sPos(sid, 'n2')).toEqual({ x: 650, y: 80 });
  });

  // FAILS: useNodeDrag.ts:20-47 never prunes dragPos on external delete (Del/Trash/Operations/Menu); Undo renders ghost (150,80).
  it.fails('delete mid-drag via deleteNodes/Del + Undo must not render ghost drag position', () => {
    const { sid } = mountCanvas(makeGraph(4));
    onCh([pCh('n0', true, { x: 150, y: 80 })]);
    act(() => { deleteNodes(sid, ['n0']); });
    act(() => { expect(tr(sid, 'undo')).toBe(true); });
    expect(sPos(sid, 'n0')).toEqual({ x: 0, y: 0 }); expect(rPos('n0')).toEqual({ x: 0, y: 0 });
  });

  // FAILS: useNodeDrag.ts:128-131 prunes !liveNodesById before inserting previewMoves; trailing dragging:true pollutes dragPos.
  it.fails('trailing dragging:true after delete must not pollute dragPos for subsequent Undo', () => {
    const { sid } = mountCanvas(makeGraph(4));
    act(() => { deleteNodes(sid, ['n0']); });
    onCh([pCh('n0', true, { x: 222, y: 111 })]);
    act(() => { expect(tr(sid, 'undo')).toBe(true); });
    expect(rPos('n0')).toEqual({ x: 0, y: 0 });
  });

  // FAILS: useNodeDrag.ts:89-96 puts g0 members in droppedIds then `continue`s when n0 is in commitMoves, dropping n1 back to (260,0).
  it.fails('dropping dragged group frame with one member in same batch must commit other member too', () => {
    const { sid } = mountCanvas(makeGraph(4));
    const st = rPos('g0')!;
    onCh([pCh('g0', true, { x: st.x + 80, y: st.y + 40 })]);
    onCh([pCh('n0', false, { x: 80, y: 40 }), pCh('g0', false, { x: st.x + 80, y: st.y + 40 })]);
    expect(sPos(sid, 'n0')).toEqual({ x: 80, y: 40 }); expect(sPos(sid, 'n1')).toEqual({ x: 340, y: 40 });
  });

  it('ungrouping a frame mid-drag without follow-up drop clears member previews', () => {
    const { sid } = mountCanvas(makeGraph(4));
    const st = rPos('g0')!;
    onCh([pCh('g0', true, { x: st.x + 80, y: st.y + 40 })]);
    expect(rPos('n0')).toEqual({ x: 80, y: 40 });
    act(() => { ungroup(sid, 'g0'); });
    expect(rPos('n0')).toEqual({ x: 0, y: 0 }); expect(rPos('n1')).toEqual({ x: 260, y: 0 });
  });

  it('switching session mid-drag drops preview with 0 writes and no ghost in target session', () => {
    const { sid: s1 } = mountCanvas(makeGraph(3));
    const s2 = createSession(`adv-s2-${Math.random()}`);
    useStore.setState((st) => ({ sessions: { ...st.sessions, [s2.id]: { ...s2, graph: { nodes: [{ id: 'n0', position: { x: 10, y: 20 }, data: { kind: 'text', title: 'S2', text: 'x' } }], edges: [] }, feed: [] } } }));
    onCh([pCh('n0', true, { x: 400, y: 300 })]);
    act(() => { useStore.setState({ activeSessionId: s2.id }); });
    expect(sPos(s1, 'n0')).toEqual({ x: 0, y: 0 }); expect(sPos(s2.id, 'n0')).toEqual({ x: 10, y: 20 });
    expect(rPos('n0')).toEqual({ x: 10, y: 20 });
    expect(graphHistory(s1, 'undo')).toHaveLength(0); expect(graphHistory(s2.id, 'undo')).toHaveLength(0);
  });
});

describe('Attack 2: CutTool parity on long/repeated/backtracking trails and single undo', () => {
  it('matches trailCuts on 500-point serpentine trail with repeated crossings and backtracking', () => {
    if (typeof globalThis.DOMPoint === 'undefined') (globalThis as unknown as { DOMPoint: unknown }).DOMPoint = class { constructor(public x = 0, public y = 0) {} matrixTransform() { return this; } };
    if (!globalThis.CSS?.escape) (globalThis as unknown as { CSS: { escape: (s: string) => string } }).CSS = { escape: (s: string) => s };
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const cv = document.createElement('div'), pane = document.createElement('div');
    cv.getBoundingClientRect = () => ({ left: 0, top: 0, right: 400, bottom: 400, width: 400, height: 400, x: 0, y: 0, toJSON: () => ({}) });
    pane.className = 'react-flow__pane'; cv.append(pane);
    const NS = 'http://www.w3.org/2000/svg', lines: Array<{ id: string; points: Pt[] }> = [];
    for (let k = 0; k < 10; k++) {
      const id = `e${k}`, y = 30 + k * 35, g = document.createElementNS(NS, 'g'), p = document.createElementNS(NS, 'path');
      g.setAttribute('class', 'react-flow__edge'); g.setAttribute('data-id', id); p.setAttribute('class', 'react-flow__edge-path');
      Object.assign(p, { getScreenCTM: () => ({}), getTotalLength: () => 200, getPointAtLength: (l: number) => ({ x: 50 + l, y }) });
      g.append(p); cv.append(g); lines.push({ id, points: [{ x: 50, y }, { x: 250, y }] });
    }
    document.body.append(cv);
    let api!: ReturnType<typeof useCutTool>;
    const batches: string[][] = [], host = document.createElement('div'); document.body.append(host);
    function H() { const ref = useRef<HTMLDivElement | null>(cv); api = useCutTool({ active: true, canvasRef: ref, onCut: (ids) => batches.push(ids) }); return createElement('div', null, api.overlay); }
    const root = createRoot(host);
    cleanups.push(() => { act(() => root.unmount()); host.remove(); cv.remove(); });
    act(() => root.render(createElement(H)));
    const trail: Pt[] = [{ x: 100, y: 10 }];
    for (let i = 1; i < 200; i++) trail.push({ x: 80 + (i % 9) * 15, y: 10 + i * 1.05 });
    for (let i = 0; i < 150; i++) trail.push({ x: 90 + (i % 5) * 20, y: 220 - (i % 40) * 3 });
    for (let i = 0; i < 150; i++) trail.push({ x: 100, y: Math.max(5, 200 - i * 1.5) });
    const ev = (p: Pt) => ({ button: 0, clientX: p.x, clientY: p.y, pointerId: 1, target: pane, currentTarget: cv, stopPropagation: vi.fn(), preventDefault: vi.fn() } as unknown as React.PointerEvent<HTMLDivElement>);
    act(() => api.down(ev(trail[0])));
    for (let i = 1; i < trail.length; i++) act(() => api.move(ev(trail[i])));
    expect(cv.querySelectorAll('.react-flow__edge.is-cut-hit').length).toBe(6);
    act(() => api.up(ev(trail[trail.length - 1])));
    const exp = trailCuts(trail, lines);
    expect(batches).toHaveLength(1); expect(new Set(batches[0]).size).toBe(batches[0].length);
    expect([...batches[0]].sort()).toEqual([...exp].sort());
    expect(cv.querySelectorAll('.react-flow__edge.is-cut-hit').length).toBe(0);
    const acc = new Set<string>();
    for (let i = 1; i < trail.length; i++) for (const id of segmentCuts(trail[i - 1], trail[i], lines, acc)) acc.add(id);
    expect([...acc].sort()).toEqual([...exp].sort());
  });

  it('cutting multiple edges creates 1 undo step with exact undo/redo', () => {
    const img = (id: string, y: number): GraphNode => ({ id, position: { x: 300, y }, data: { kind: 'image', title: id, prompt: '', modelRef: 'm', settings: { count: 1, advanced: {} }, outputIndex: 0 } });
    const txt = (id: string, y: number): GraphNode => ({ id, position: { x: 0, y }, data: { kind: 'text', title: id, text: id } });
    const { sid } = mountCanvas({ nodes: [txt('t1', 0), txt('t2', 200), img('i1', 0), img('i2', 200)], edges: [] });
    expect(tryConnect(sid, { source: 't1', target: 'i1', targetHandle: 'prompt', sourceHandle: 'out' })).toBe(true);
    expect(tryConnect(sid, { source: 't2', target: 'i2', targetHandle: 'prompt', sourceHandle: 'out' })).toBe(true);
    const ids = useStore.getState().sessions[sid].graph.edges.map((e) => e.id);
    const before = graphHistory(sid, 'undo').length;
    act(() => { edit.applyEdit({ session: sid, op: { op: 'disconnect', edges: ids } }); });
    expect(graphHistory(sid, 'undo')).toHaveLength(before + 1);
    act(() => { expect(tr(sid, 'undo')).toBe(true); });
    expect(useStore.getState().sessions[sid].graph.edges.map((e) => e.id).sort()).toEqual([...ids].sort());
    act(() => { expect(tr(sid, 'redo')).toBe(true); });
    expect(useStore.getState().sessions[sid].graph.edges).toHaveLength(0);
  });
});

describe('Attack 3: group frames in history with rapid drag interleaving', () => {
  it('keeps group, rename, color, clear-color, ungroup, and drags as separate undo/redo steps (<700ms)', () => {
    const { sid } = mountCanvas(makeGraph(3, false));
    const drag = (id: string, p: Pt) => act(() => { flow.props!.onNodesChange([pCh(id, true, p)]); flow.props!.onNodesChange([pCh(id, false, p)]); });
    drag('n0', { x: 50, y: 10 });
    const gid = groupNodes(sid, ['n0', 'n1'])!;
    drag('n0', { x: 90, y: 20 });
    renameGroup(sid, gid, 'Hero'); setGroupColor(sid, gid, '#5ec8ff'); setGroupColor(sid, gid, undefined);
    drag('n1', { x: 300, y: 40 });
    ungroup(sid, gid);
    expect(graphHistory(sid, 'undo')).toHaveLength(8);

    const g = () => useStore.getState().sessions[sid].graph;
    const undo = () => expect(tr(sid, 'undo')).toBe(true);
    undo(); expect(g().groups).toEqual([{ id: gid, title: 'Hero', nodeIds: ['n0', 'n1'], color: undefined }]);
    undo(); expect(sPos(sid, 'n1')).toEqual({ x: 260, y: 0 });
    undo(); expect(g().groups?.[0].color).toBe('#5ec8ff');
    undo(); expect(g().groups?.[0].color).toBeUndefined();
    undo(); expect(g().groups?.[0].title).toBe('Group 1');
    undo(); expect(sPos(sid, 'n0')).toEqual({ x: 50, y: 10 });
    undo(); expect(g().groups).toBeUndefined();
    undo(); expect(sPos(sid, 'n0')).toEqual({ x: 0, y: 0 });
    for (let i = 0; i < 8; i++) expect(tr(sid, 'redo')).toBe(true);
    expect(g().groups).toEqual([]); expect(sPos(sid, 'n0')).toEqual({ x: 90, y: 20 }); expect(sPos(sid, 'n1')).toEqual({ x: 300, y: 40 });
  });
});

describe('Attack 4: delete confirmation across all entry points', () => {
  const mGraph = (): Graph => ({
    nodes: [
      { id: 'm1', position: { x: 0, y: 0 }, data: { kind: 'ref', type: 'model', ref: 'atlas::nb', title: 'Model' } },
      { id: 'a1', position: { x: 300, y: 0 }, data: { kind: 'ref', type: 'agent', ref: 'agent', title: 'Agent' } },
      { id: 't1', position: { x: 600, y: 0 }, data: { kind: 'text', title: 'P1', text: 'hi' } },
      { id: 't2', position: { x: 900, y: 0 }, data: { kind: 'text', title: 'P2', text: 'yo' } },
    ],
    edges: [{ id: 'e_ctrl', source: 'm1', sourceHandle: 'out_control', target: 'a1', targetHandle: 'model', kind: 'control' }],
  });
  const has = (sid: string, id: string) => useStore.getState().sessions[sid].graph.nodes.some((n) => n.id === id);
  const dlg = (c: HTMLElement) => c.querySelector('[role="alertdialog"][aria-label="Remove from canvas"]');
  const clickTxt = (r: ParentNode, sel: string, txt: string) =>
    act(() => [...r.querySelectorAll<HTMLButtonElement>(sel)].find((b) => b.textContent?.includes(txt))!.click());

  it('Delete key, Operations Delete, and ContextMenu Delete confirm on model-linked ref node', async () => {
    const checkConfirm = async (trigger: (el: HTMLElement) => void | Promise<void>, action: 'Cancel' | 'Remove' | null) => {
      const { sid, el } = mountCanvas(mGraph(), 'omni');
      await trigger(el);
      expect(has(sid, 'a1')).toBe(true);
      const d = dlg(el); expect(d).not.toBeNull();
      if (action) { clickTxt(d!, 'button', action); expect(has(sid, 'a1')).toBe(action === 'Cancel'); }
      unmountAll();
    };
    await checkConfirm(async () => { await act(async () => { await flow.props!.onBeforeDelete!({ nodes: [{ id: 'a1' }], edges: [] }); }); }, 'Cancel');
    await checkConfirm((el) => { onCh(sCh('a1', 't1')); clickTxt(el, 'button', 'Operations'); act(() => btn(el, '.ops-bar button[aria-label="Delete"]').click()); }, 'Remove');
    await checkConfirm(() => {
      act(() => flow.props!.onNodeContextMenu!({ preventDefault: vi.fn(), clientX: 50, clientY: 50 } as unknown as React.MouseEvent, rNode('a1')!));
      const m = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Delete') && b.closest('[role="dialog"], .popover'));
      expect(m).toBeDefined(); act(() => m!.click());
    }, null);
  });

  it('non-model nodes delete without Remove-from-canvas dialog across Operations, Trash, DeleteButton', () => {
    const run = (fn: (el: HTMLElement) => void, gone: string[]) => {
      const { sid, el } = mountCanvas(mGraph(), 'node');
      fn(el);
      expect(dlg(el)).toBeNull();
      for (const id of gone) expect(has(sid, id)).toBe(false);
      unmountAll();
    };
    run((el) => { onCh(sCh('t1', 't2')); clickTxt(el, 'button', 'Operations'); act(() => btn(el, '.ops-bar button[aria-label="Delete"]').click()); }, ['t1', 't2']);
    run((el) => { onCh(sCh('t1')); act(() => btn(el, 'button[aria-label="Delete 1 selected (Del)"]').click()); }, ['t1']);
    run((el) => { onCh(sCh('t1')); act(() => btn(el, 'button[aria-label="Delete node"]').click()); clickTxt(document.body, '.confirm button', 'Delete'); }, ['t1']);
  });

  // FAILS: Operations.tsx:81 & NodeWorkspace.tsx:341 invoke cutNodes -> deleteNodes directly, bypassing model-link confirmation.
  it.fails('Operations Cut and Ctrl+X should not bypass model-link confirmation', () => {
    const { sid, el } = mountCanvas(mGraph(), 'omni');
    onCh(sCh('a1', 't1')); clickTxt(el, 'button', 'Operations');
    act(() => btn(el, '.ops-bar button[aria-label="Cut"]').click());
    expect(has(sid, 'a1')).toBe(true); expect(dlg(el)).not.toBeNull();
  });
});

describe('Attack 5: Pan and Select box selection share selectability rule', () => {
  it('never selects collapsed-group members in Pan (normal/Shift) or Select, restoring after expand', () => {
    const graph: Graph = {
      nodes: [
        { id: 't1', position: { x: 100, y: 100 }, data: { kind: 'text', title: 'T1', text: 'a' } },
        { id: 't2', position: { x: 380, y: 100 }, data: { kind: 'text', title: 'T2', text: 'b' } },
        { id: 't3', position: { x: 100, y: 350 }, data: { kind: 'text', title: 'T3', text: 'c' } },
      ],
      edges: [], groups: [{ id: 'g1', title: 'G1', nodeIds: ['t1', 't2'] }],
    };
    const { el } = mountCanvas(graph);
    const cv = el.querySelector<HTMLDivElement>('.node-canvas')!, pane = el.querySelector<HTMLDivElement>('.react-flow__pane')!;
    cv.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800, x: 0, y: 0, toJSON: () => ({}) });
    cv.setPointerCapture = () => {};
    act(() => btn(el, 'button[aria-label="Collapse group"]').click());
    expect([rNode('g1')?.selectable, rNode('t1')?.selectable, rNode('t1')?.hidden, rNode('t2')?.selectable, rNode('t3')?.selectable]).toEqual([false, false, true, false, true]);
    act(() => btn(el, 'button[aria-label^="Pan"]').click());
    const box = (shiftKey = false) => {
      const m = (t: string, x: number, y: number) => new MouseEvent(t, { bubbles: true, button: 0, clientX: x, clientY: y, shiftKey });
      act(() => { pane.dispatchEvent(m('pointerdown', 10, 10)); });
      act(() => { pane.dispatchEvent(m('pointerdown', 10, 10)); });
      act(() => { cv.dispatchEvent(m('pointermove', 900, 600)); });
      act(() => { cv.dispatchEvent(m('pointerup', 900, 600)); });
    };
    box(false); expect([rNode('t3')?.selected, rNode('t1')?.selected, rNode('t2')?.selected]).toEqual([true, false, false]);
    box(true); expect(btn(el, 'button[aria-label^="Delete "]').getAttribute('aria-label')).toBe('Delete 1 selected (Del)');
    act(() => btn(el, 'button[aria-label="Expand group"]').click()); expect(rNode('t1')?.selectable).toBe(true);
    box(false); expect(btn(el, 'button[aria-label^="Delete "]').getAttribute('aria-label')).toBe('Delete 3 selected (Del)');
  });
});

describe('Attack 6: keyboard listeners parity with main', () => {
  it('supports Ctrl+C/X/Z/Shift+Z/Y and X/Esc, ignoring text inputs and embedded X', () => {
    const { sid, el } = mountCanvas(makeGraph(3, false));
    const key = (t: EventTarget, init: KeyboardEventInit) => act(() => { t.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init })); });
    const nLen = () => useStore.getState().sessions[sid].graph.nodes.length;
    const isCut = (c: HTMLElement) => c.querySelector('.node-canvas')?.classList.contains('is-cut-tool');

    onCh(sCh('n0'));
    key(window, { key: 'c', ctrlKey: true }); expect(hasNodeClipboard()).toBe(true); expect(nLen()).toBe(3);
    key(window, { key: 'x', ctrlKey: true }); expect(nLen()).toBe(2);
    key(window, { key: 'z', ctrlKey: true }); expect(nLen()).toBe(3);
    key(window, { key: 'Z', ctrlKey: true, shiftKey: true }); expect(nLen()).toBe(2);
    key(window, { key: 'z', ctrlKey: true }); expect(nLen()).toBe(3);
    key(window, { key: 'y', ctrlKey: true }); expect(nLen()).toBe(2);

    const ta = document.createElement('textarea'); el.append(ta);
    key(ta, { key: 'x' }); expect(isCut(el)).toBe(false);
    key(ta, { key: 'z', ctrlKey: true }); expect(nLen()).toBe(2);

    act(() => btn(el, 'button[aria-label^="Select:"]').click());
    key(window, { key: 'x' }); expect(isCut(el)).toBe(true);
    key(window, { key: 'x' }); expect(isCut(el)).toBe(false);

    const { el: emb } = mountCanvas(makeGraph(2, false), 'embedded');
    key(window, { key: 'x' }); expect(isCut(emb)).toBe(false);
  });
});

describe('Attack 7: evading scripts/check-node-drag.mjs', () => {
  const WS = 'src/components/node/NodeWorkspace.tsx';
  const h = (body: string) => `const onNodesChange = (cs: any[]) => { for (const c of cs) ${body}; };`;
  const runFix = (files: Record<string, string>) => {
    const root = mkdtempSync(join(tmpdir(), 'ogs-adv-'));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    for (const [rel, code] of Object.entries(files)) { const f = join(root, rel); mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(f, code); }
    return checkNodeDrag(root) as string[];
  };
  const ifDrag = `if (c.type === 'position' && c.dragging === true)`;

  it('reports file:line and hint on direct violation', () => {
    const e = runFix({ [WS]: `import { editPresentation } from './e'; ${h(`${ifDrag} editPresentation('s', (g: any) => g)`)}` });
    expect(e).toHaveLength(1); expect(e[0]).toMatch(/^src\/components\/node\/NodeWorkspace\.tsx:\d+ — .*dragging: false/);
  });

  // FAILS: check-node-drag.mjs:125-138 scans each file in isolation, missing cross-file re-exports ([]).
  it.fails('catches re-exported alias from another file', () => {
    expect(runFix({ 'src/components/node/re.ts': `export { editPresentation as savePos } from './e';`, [WS]: `import { savePos } from './re'; ${h(`${ifDrag} savePos('s', (g: any) => g)`)}` }).length).toBeGreaterThan(0);
  });

  // FAILS: check-node-drag.mjs:162-189 only indexes top-level localBodies in same file, missing cross-file helpers ([]).
  it.fails('catches helper function in another file', () => {
    expect(runFix({ 'src/components/node/h.ts': `import { editPresentation } from './e'; export function flush(s: string) { editPresentation(s, (g: any) => g); }`, [WS]: `import { flush } from './h'; ${h(`${ifDrag} flush('s')`)}` }).length).toBeGreaterThan(0);
  });

  // FAILS: check-node-drag.mjs:139-160 misses .call(), object indirection, destructuring, and JSON.stringify aliases ([]).
  it.fails('catches indirect same-file calls (.call, object, destructuring, JSON.stringify alias)', () => {
    expect(runFix({ [WS]: `import { editPresentation } from './e'; ${h(`${ifDrag} editPresentation.call(null, 's', (g: any) => g)`)}` }).length).toBeGreaterThan(0);
    expect(runFix({ [WS]: `import { editPresentation } from './e'; const o = { w: editPresentation }; ${h(`${ifDrag} o.w('s', (g: any) => g)`)}` }).length).toBeGreaterThan(0);
    expect(runFix({ [WS]: `import * as ed from './e'; const { editPresentation: w } = ed; ${h(`${ifDrag} w('s', (g: any) => g)`)}` }).length).toBeGreaterThan(0);
    expect(runFix({ [WS]: `const ser = JSON.stringify; ${h(`${ifDrag} ser(c)`)}` }).length).toBeGreaterThan(0);
  });

  // FAILS: check-node-drag.mjs:162-172 only scans program.body, missing component/hook closures ([]).
  it.fails('catches nested helper closure inside a React component or hook', () => {
    expect(runFix({ [WS]: `import { editPresentation } from './e'; function C() { const save = () => editPresentation('s', (g: any) => g); const onNodesChange = useCallback((cs: any[]) => { for (const c of cs) ${ifDrag} save(); }, []); return onNodesChange; }` }).length).toBeGreaterThan(0);
  });

  // FAILS: check-node-drag.mjs:47-67 misses aliased `const d = c.dragging` and line 346 ignores inline JSX onNodesChange ([]).
  it.fails('catches aliased c.dragging variable or inline ReactFlow onNodesChange handler', () => {
    expect(runFix({ [WS]: `import { editPresentation } from './e'; ${h(`{ const d = c.dragging; if (c.type === 'position' && d) editPresentation('s', (g: any) => g); }`)}` }).length).toBeGreaterThan(0);
    expect(runFix({ [WS]: `import { editPresentation } from './e'; function C() { return <ReactFlow onNodesChange={(cs: any[]) => { for (const c of cs) if (c.type === 'position' && c.dragging) editPresentation('s', (g: any) => g); }} />; }` }).length).toBeGreaterThan(0);
  });

  // FAILS: check-node-drag.mjs:298 & 117 check literal names 'trailCuts' and 'NodeToolbar' without import-alias resolution ([]).
  it.fails('catches aliased trailCuts in CutTool and aliased NodeToolbar in cards', () => {
    expect(runFix({ 'src/components/node/CutTool.tsx': `import { trailCuts as scan } from './g'; function useCutTool() { const move = (e: any) => { scan([e], []); }; return { move }; }` }).length).toBeGreaterThan(0);
    expect(runFix({ 'src/components/node/nodes.tsx': `import { NodeToolbar as Toolbar } from '@xyflow/react'; function Card({ selected }: { selected: boolean }) { return <><Toolbar isVisible={selected}><div /></Toolbar></>; }` }).length).toBeGreaterThan(0);
  });
});
