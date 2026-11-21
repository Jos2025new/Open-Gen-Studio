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
import { copyNodes, groupNodes, hasNodeClipboard, pasteNodes, renameGroup, setGroupColor, ungroup } from '../src/engine/flow/arrange';
import { graphHistory, travelGraph } from '../src/engine/flow/history';
import * as edit from '../src/engine/nodecore/edit';
import { storeHooks } from '../src/engine/storeBindings';
import type { Graph, GraphNode } from '../src/engine/types';
import { createSession, useStore } from '../src/store/store';
import { check as checkNodeDrag } from '../scripts/check-node-drag.mjs';
import { rfDrag } from './rf-drag-events';

const flow = vi.hoisted(() => ({ props: null as null | { nodes: Node[]; edges: Edge[]; children: ReactNode; onNodesChange(c: NodeChange[]): void; onEdgesChange(c: EdgeChange[]): void; onBeforeDelete?(p: { nodes: Array<{ id: string }>; edges: Array<{ id: string }> }): Promise<boolean>; onNodeContextMenu?(e: React.MouseEvent, node: Node): void } }));

vi.mock('@xyflow/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@xyflow/react')>()),
  ReactFlow(p: NonNullable<typeof flow.props> & { nodeTypes: NodeTypes }) {
    flow.props = p;
    return createElement('div', { className: 'react-flow__pane' }, p.children, ...p.nodes.filter((n) => !n.hidden).map((n) => createElement(p.nodeTypes[n.type!], { ...n, key: n.id, type: n.type!, selected: Boolean(n.selected), dragging: false, draggable: n.draggable ?? true, selectable: n.selectable ?? true, deletable: n.deletable ?? true, isConnectable: n.connectable ?? true, zIndex: n.zIndex ?? 0, positionAbsoluteX: n.position.x, positionAbsoluteY: n.position.y })));
  },
  useReactFlow: () => ({ fitView: vi.fn(), screenToFlowPosition: (p: Pt) => p, zoomIn: vi.fn(), zoomOut: vi.fn(), zoomTo: vi.fn(), getZoom: () => 1, getNodes: () => [] }),
  useOnViewportChange: () => {}, useViewport: () => ({ x: 0, y: 0, zoom: 1 }), useConnection: () => false, useUpdateNodeInternals: () => () => {},
  useStore: (sel: (s: { transform: [number, number, number] }) => unknown) => sel({ transform: [0, 0, 1] }),
  Background: () => null, MiniMap: () => null, Handle: () => null,
  Panel: ({ children, ...r }: { children?: ReactNode } & Record<string, unknown>) => createElement('div', r, children),
  NodeToolbar: ({ isVisible = true, children }: { isVisible?: boolean; children?: ReactNode }) => isVisible ? createElement('div', null, children) : null,
}));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, peekAssetUrl: () => undefined, loadAssetUrl: async () => undefined }));
if (typeof globalThis.ResizeObserver === 'undefined') (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

const cleanups: Array<() => void> = [];
const unmountAll = () => { while (cleanups.length) cleanups.pop()!(); };
afterEach(() => { unmountAll(); vi.restoreAllMocks(); });
const pt = (x: number, y: number): Pt => ({ x, y });
const tNode = (id: string, x: number, y: number, title = id, text = id): GraphNode => ({ id, position: pt(x, y), data: { kind: 'text', title, text } });
const makeGraph = (n: number, grp = true): Graph => ({
  nodes: Array.from({ length: n }, (_, i) => tNode(`n${i}`, (i % 10) * 260, Math.floor(i / 10) * 180, `N${i}`, `P${i}`)),
  edges: n > 2 ? [{ id: 'e0', source: 'n0', sourceHandle: 'out', target: 'n1', targetHandle: 'in' }, { id: 'e1', source: 'n1', sourceHandle: 'out', target: 'n2', targetHandle: 'in' }] : [],
  groups: grp && n >= 2 ? [{ id: 'g0', title: 'G0', nodeIds: ['n0', 'n1'] }] : undefined,
});
const mGraph = (): Graph => ({
  nodes: [{ id: 'm1', position: pt(0, 0), data: { kind: 'ref', type: 'model', ref: 'atlas::nb', title: 'Model' } }, { id: 'a1', position: pt(300, 0), data: { kind: 'ref', type: 'agent', ref: 'agent', title: 'Agent' } }, tNode('t1', 600, 0, 'P1', 'hi'), tNode('t2', 900, 0, 'P2', 'yo'), tNode('t3', 1200, 0, 'Keep', 'k')],
  edges: [{ id: 'e_ctrl', source: 'm1', sourceHandle: 'out_control', target: 'a1', targetHandle: 'model', kind: 'control' }],
});
function mountCanvas(graph: Graph, mode: 'node' | 'omni' | 'embedded' = 'node') {
  const s = createSession(`adv-${Math.random()}`);
  useStore.setState((st) => ({ activeSessionId: s.id, generations: {}, assets: {}, sessions: { ...st.sessions, [s.id]: { ...s, graph, feed: [] } } }));
  const el = document.createElement('div'); document.body.append(el); const root = createRoot(el);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  cleanups.push(() => { act(() => root.unmount()); el.remove(); });
  act(() => root.render(createElement(mode === 'omni' ? OmniCanvas : mode === 'embedded' ? EmbeddedNodeCanvas : NodeWorkspace)));
  return { sid: s.id, el };
}

const sGraph = (sid: string) => useStore.getState().sessions[sid].graph;
const tr = (sid: string, dir: 'undo' | 'redo') => travelGraph(sid, sGraph(sid), dir, 1, (next) => edit.applyEdit({ session: sid, op: { op: 'travel', graph: next } }).ok);
const sPos = (sid: string, id: string) => sGraph(sid).nodes.find((n) => n.id === id)?.position, has = (sid: string, id: string) => sGraph(sid).nodes.some((n) => n.id === id);
const rNode = (id: string) => flow.props!.nodes.find((n) => n.id === id), rPos = (id: string) => rNode(id)?.position;
const pCh = (id: string, dragging: boolean, position?: Pt): NodeChange => ({ id, type: 'position', dragging, ...(position ? { position } : {}) });
const sCh = (...ids: string[]): NodeChange[] => ids.map((id) => ({ id, type: 'select' as const, selected: true }));
const btn = (root: ParentNode, sel: string) => root.querySelector<HTMLButtonElement>(sel)!, dlg = (c: HTMLElement) => c.querySelector('[role="alertdialog"][aria-label="Remove from canvas"]');
const clickTxt = (r: ParentNode, sel: string, txt: string) => act(() => [...r.querySelectorAll<HTMLButtonElement>(sel)].find((b) => b.textContent?.includes(txt))!.click());
const onCh = (cs: NodeChange[]) => act(() => flow.props!.onNodesChange(cs));
const drag = rfDrag(() => flow.props);
const WS = 'src/components/node/NodeWorkspace.tsx', EP = `import { editPresentation } from './e';`, ifD = `if (c.type === 'position' && c.dragging === true)`;
const h = (body: string) => `const onNodesChange = (cs: any[]) => { for (const c of cs) ${body}; };`;
const runFix = (files: Record<string, string>) => {
  const root = mkdtempSync(join(tmpdir(), 'ogs-adv-')); cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  for (const [rel, code] of Object.entries(files)) { const f = join(root, rel); mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(f, code); }
  return checkNodeDrag(root) as string[];
};
const hit = (files: Record<string, string>) => expect(runFix(files).length).toBeGreaterThan(0);

describe('Attack 1: drag, frames, cables, mid-drag mutations, session switch', () => {
  it('200-node multiselect: 0 move writes, stable edges, 1 drop write, 2 rapid drags = 2 undo', () => {
    const { sid } = mountCanvas(makeGraph(200));
    let w = 0; cleanups.push(useStore.subscribe((n, p) => { if (n.sessions[sid]?.graph !== p.sessions[sid]?.graph) w++; }));
    const editSpy = vi.spyOn(edit, 'editPresentation'), recSpy = vi.spyOn(storeHooks, 'recordGraph'), eRef = flow.props!.edges, ids = ['n0', 'n2', 'n5', 'n50', 'n199'];
    drag.start(...ids);
    for (let k = 1; k <= 20; k++) onCh(ids.map((id, i) => pCh(id, true, pt(i * 100 + k * 4, k * 3))));
    expect(w).toBe(0); expect(editSpy).not.toHaveBeenCalled(); expect(recSpy).not.toHaveBeenCalled();
    expect(flow.props!.edges).toBe(eRef); expect(flow.props!.edges.map((e) => e.id)).toEqual(['e0', 'e1']);
    onCh(ids.map((id) => pCh(id, false))); expect(w).toBe(0);
    drag.stop(ids);
    expect(w).toBe(1); expect(editSpy).toHaveBeenCalledTimes(1); expect(recSpy).toHaveBeenCalledTimes(1);
    expect(graphHistory(sid, 'undo')).toHaveLength(1); expect(sPos(sid, 'n199')).toEqual(pt(480, 60));
    drag.start('n199'); act(() => { flow.props!.onNodesChange([pCh('n199', true, pt(600, 120))]); flow.props!.onNodesChange([pCh('n199', false)]); }); drag.stop(['n199']);
    expect(graphHistory(sid, 'undo')).toHaveLength(2);
    expect(tr(sid, 'undo')).toBe(true); expect(sPos(sid, 'n199')).toEqual(pt(480, 60));
    expect(tr(sid, 'undo')).toBe(true); expect(sPos(sid, 'n199')).toEqual(pt(9 * 260, 19 * 180));
  });
  it('collapsed frame drag: 0 writes, moves hidden members, 1 undo', () => {
    const { sid, el } = mountCanvas(makeGraph(4));
    act(() => btn(el, 'button[aria-label="Collapse group"]').click()); expect(rNode('n0')?.hidden).toBe(true);
    let w = 0; cleanups.push(useStore.subscribe((n, p) => { if (n.sessions[sid]?.graph !== p.sessions[sid]?.graph) w++; }));
    const st = rPos('g0')!;
    drag.start('g0'); onCh([pCh('g0', true, pt(st.x + 120, st.y + 60))]); expect(w).toBe(0); expect(rPos('g0')).toEqual(pt(st.x + 120, st.y + 60));
    onCh([pCh('g0', false)]); expect(w).toBe(0); drag.stop(['g0']); expect(w).toBe(1); expect(sPos(sid, 'n0')).toEqual(pt(120, 60)); expect(sPos(sid, 'n1')).toEqual(pt(380, 60));
    expect(graphHistory(sid, 'undo')).toHaveLength(1);
  });
  it('delete mid-drag then drop does not resurrect node', () => {
    const { sid } = mountCanvas(makeGraph(4));
    drag.start('n0', 'n2'); onCh([pCh('n0', true, pt(150, 80)), pCh('n2', true, pt(650, 80))]); act(() => { deleteNodes(sid, ['n0']); });
    onCh([pCh('n0', false, pt(150, 80)), pCh('n2', false, pt(650, 80))]); drag.stop(['n0', 'n2'], { n0: pt(150, 80) }); expect(has(sid, 'n0')).toBe(false); expect(sPos(sid, 'n2')).toEqual(pt(650, 80));
  });
  it('delete mid-drag + Undo renders store pos (no ghost)', () => {
    const { sid } = mountCanvas(makeGraph(4));
    drag.start('n0'); onCh([pCh('n0', true, pt(150, 80))]); act(() => { deleteNodes(sid, ['n0']); }); act(() => { expect(tr(sid, 'undo')).toBe(true); });
    expect(sPos(sid, 'n0')).toEqual(pt(0, 0)); expect(rPos('n0')).toEqual(pt(0, 0));
  });
  it('trailing dragging:true after delete does not pollute Undo', () => {
    const { sid } = mountCanvas(makeGraph(4));
    act(() => { deleteNodes(sid, ['n0']); }); onCh([pCh('n0', true, pt(222, 111))]); act(() => { expect(tr(sid, 'undo')).toBe(true); }); expect(rPos('n0')).toEqual(pt(0, 0));
  });
  it('frame + member drop in same batch commits other member too', () => {
    const { sid } = mountCanvas(makeGraph(4)), st = rPos('g0')!;
    drag.start('g0', 'n0'); onCh([pCh('g0', true, pt(st.x + 80, st.y + 40))]); onCh([pCh('n0', false, pt(80, 40)), pCh('g0', false, pt(st.x + 80, st.y + 40))]); drag.stop(['g0', 'n0']);
    expect(sPos(sid, 'n0')).toEqual(pt(80, 40)); expect(sPos(sid, 'n1')).toEqual(pt(340, 40));
  });
  it('ungrouping frame mid-drag clears member previews', () => {
    const { sid } = mountCanvas(makeGraph(4)), st = rPos('g0')!;
    onCh([pCh('g0', true, pt(st.x + 80, st.y + 40))]); expect(rPos('n0')).toEqual(pt(80, 40));
    act(() => { ungroup(sid, 'g0'); }); expect(rPos('n0')).toEqual(pt(0, 0)); expect(rPos('n1')).toEqual(pt(260, 0));
  });
  it('session switch mid-drag drops preview with 0 writes', () => {
    const { sid: s1 } = mountCanvas(makeGraph(3)), s2 = createSession(`adv-s2-${Math.random()}`);
    useStore.setState((st) => ({ sessions: { ...st.sessions, [s2.id]: { ...s2, graph: { nodes: [tNode('n0', 10, 20, 'S2', 'x')], edges: [] }, feed: [] } } }));
    onCh([pCh('n0', true, pt(400, 300))]); act(() => { useStore.setState({ activeSessionId: s2.id }); });
    expect(sPos(s1, 'n0')).toEqual(pt(0, 0)); expect(sPos(s2.id, 'n0')).toEqual(pt(10, 20)); expect(rPos('n0')).toEqual(pt(10, 20));
    expect(graphHistory(s1, 'undo')).toHaveLength(0); expect(graphHistory(s2.id, 'undo')).toHaveLength(0);
  });
});

describe('Attack 2: CutTool parity & single undo', () => {
  it('matches trailCuts on 500-pt serpentine trail with repeats/backtracking', () => {
    if (typeof globalThis.DOMPoint === 'undefined') (globalThis as unknown as { DOMPoint: unknown }).DOMPoint = class { constructor(public x = 0, public y = 0) {} matrixTransform() { return this; } };
    if (!globalThis.CSS?.escape) (globalThis as unknown as { CSS: { escape: (s: string) => string } }).CSS = { escape: (s: string) => s };
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const cv = document.createElement('div'), pane = document.createElement('div'), NS = 'http://www.w3.org/2000/svg', lines: Array<{ id: string; points: Pt[] }> = [];
    cv.getBoundingClientRect = () => ({ left: 0, top: 0, right: 400, bottom: 400, width: 400, height: 400, x: 0, y: 0, toJSON: () => ({}) });
    pane.className = 'react-flow__pane'; cv.append(pane);
    for (let k = 0; k < 10; k++) {
      const id = `e${k}`, y = 30 + k * 35, g = document.createElementNS(NS, 'g'), p = document.createElementNS(NS, 'path');
      g.setAttribute('class', 'react-flow__edge'); g.setAttribute('data-id', id); p.setAttribute('class', 'react-flow__edge-path');
      Object.assign(p, { getScreenCTM: () => ({}), getTotalLength: () => 200, getPointAtLength: (l: number) => pt(50 + l, y) });
      g.append(p); cv.append(g); lines.push({ id, points: [pt(50, y), pt(250, y)] });
    }
    document.body.append(cv); let api!: ReturnType<typeof useCutTool>;
    const batches: string[][] = [], host = document.createElement('div'); document.body.append(host);
    function H() { const ref = useRef<HTMLDivElement | null>(cv); api = useCutTool({ active: true, canvasRef: ref, onCut: (ids) => batches.push(ids) }); return createElement('div', null, api.overlay); }
    const root = createRoot(host); cleanups.push(() => { act(() => root.unmount()); host.remove(); cv.remove(); }); act(() => root.render(createElement(H)));
    const trail: Pt[] = [pt(100, 10)];
    for (let i = 1; i < 200; i++) trail.push(pt(80 + (i % 9) * 15, 10 + i * 1.05));
    for (let i = 0; i < 150; i++) trail.push(pt(90 + (i % 5) * 20, 220 - (i % 40) * 3));
    for (let i = 0; i < 150; i++) trail.push(pt(100, Math.max(5, 200 - i * 1.5)));
    const ev = (p: Pt) => ({ button: 0, clientX: p.x, clientY: p.y, pointerId: 1, target: pane, currentTarget: cv, stopPropagation: vi.fn(), preventDefault: vi.fn() } as unknown as React.PointerEvent<HTMLDivElement>);
    act(() => api.down(ev(trail[0]))); for (let i = 1; i < trail.length; i++) act(() => api.move(ev(trail[i])));
    const hits = () => cv.querySelectorAll('.react-flow__edge.is-cut-hit').length;
    expect(hits()).toBe(6); act(() => api.up(ev(trail[trail.length - 1])));
    const exp = trailCuts(trail, lines), acc = new Set<string>();
    expect(batches).toHaveLength(1); expect(new Set(batches[0]).size).toBe(batches[0].length); expect([...batches[0]].sort()).toEqual([...exp].sort()); expect(hits()).toBe(0);
    for (let i = 1; i < trail.length; i++) for (const id of segmentCuts(trail[i - 1], trail[i], lines, acc)) acc.add(id);
    expect([...acc].sort()).toEqual([...exp].sort());
  });
  it('cutting multiple edges creates 1 undo step with exact undo/redo', () => {
    const img = (id: string, y: number): GraphNode => ({ id, position: pt(300, y), data: { kind: 'image', title: id, prompt: '', modelRef: 'm', settings: { count: 1, advanced: {} }, outputIndex: 0 } });
    const { sid } = mountCanvas({ nodes: [tNode('t1', 0, 0), tNode('t2', 0, 200), img('i1', 0), img('i2', 200)], edges: [] });
    expect(tryConnect(sid, { source: 't1', target: 'i1', targetHandle: 'prompt', sourceHandle: 'out' })).toBe(true);
    expect(tryConnect(sid, { source: 't2', target: 'i2', targetHandle: 'prompt', sourceHandle: 'out' })).toBe(true);
    const ids = sGraph(sid).edges.map((e) => e.id), before = graphHistory(sid, 'undo').length;
    act(() => { edit.applyEdit({ session: sid, op: { op: 'disconnect', edges: ids } }); });
    expect(graphHistory(sid, 'undo')).toHaveLength(before + 1);
    act(() => { expect(tr(sid, 'undo')).toBe(true); }); expect(sGraph(sid).edges.map((e) => e.id).sort()).toEqual([...ids].sort());
    act(() => { expect(tr(sid, 'redo')).toBe(true); }); expect(sGraph(sid).edges).toHaveLength(0);
  });
});

describe('Attack 3: group frames in history', () => {
  it('keeps group, rename, color, clear-color, ungroup & drags separate (<700ms)', () => {
    const { sid } = mountCanvas(makeGraph(3, false));
    const move = (id: string, p: Pt) => { drag.start(id); act(() => { flow.props!.onNodesChange([pCh(id, true, p)]); flow.props!.onNodesChange([pCh(id, false, p)]); }); drag.stop([id]); };
    move('n0', pt(50, 10)); const gid = groupNodes(sid, ['n0', 'n1'])!; move('n0', pt(90, 20));
    renameGroup(sid, gid, 'Hero'); setGroupColor(sid, gid, '#5ec8ff'); setGroupColor(sid, gid, undefined); move('n1', pt(300, 40)); ungroup(sid, gid);
    expect(graphHistory(sid, 'undo')).toHaveLength(8);
    const u = () => expect(tr(sid, 'undo')).toBe(true);
    u(); expect(sGraph(sid).groups).toEqual([{ id: gid, title: 'Hero', nodeIds: ['n0', 'n1'], color: undefined }]);
    u(); expect(sPos(sid, 'n1')).toEqual(pt(260, 0)); u(); expect(sGraph(sid).groups?.[0].color).toBe('#5ec8ff');
    u(); expect(sGraph(sid).groups?.[0].color).toBeUndefined(); u(); expect(sGraph(sid).groups?.[0].title).toBe('Group 1');
    u(); expect(sPos(sid, 'n0')).toEqual(pt(50, 10)); u(); expect(sGraph(sid).groups).toBeUndefined(); u(); expect(sPos(sid, 'n0')).toEqual(pt(0, 0));
    for (let i = 0; i < 8; i++) expect(tr(sid, 'redo')).toBe(true);
    expect(sGraph(sid).groups).toEqual([]); expect(sPos(sid, 'n0')).toEqual(pt(90, 20)); expect(sPos(sid, 'n1')).toEqual(pt(300, 40));
  });
});
describe('Attack 4: delete confirmation across entry points', () => {
  it('Del, Operations Delete & ContextMenu confirm on model-linked ref', async () => {
    const chk = async (trigger: (el: HTMLElement) => void | Promise<void>, action: 'Cancel' | 'Remove' | null) => {
      const { sid, el } = mountCanvas(mGraph(), 'omni'); await trigger(el);
      expect(has(sid, 'a1')).toBe(true); const d = dlg(el); expect(d).not.toBeNull();
      if (action) { clickTxt(d!, 'button', action); expect(has(sid, 'a1')).toBe(action === 'Cancel'); }
      unmountAll();
    };
    await chk(async () => { await act(async () => { await flow.props!.onBeforeDelete!({ nodes: [{ id: 'a1' }], edges: [] }); }); }, 'Cancel');
    await chk((el) => { onCh(sCh('a1', 't1')); clickTxt(el, 'button', 'Operations'); act(() => btn(el, '.ops-bar button[aria-label="Delete"]').click()); }, 'Remove');
    await chk(() => {
      act(() => flow.props!.onNodeContextMenu!({ preventDefault: vi.fn(), clientX: 50, clientY: 50 } as unknown as React.MouseEvent, rNode('a1')!));
      const m = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Delete') && b.closest('[role="dialog"], .popover'));
      expect(m).toBeDefined(); act(() => m!.click());
    }, null);
  });
  it('non-model nodes delete without dialog across Operations, Trash, DeleteButton', () => {
    const run = (fn: (el: HTMLElement) => void, gone: string[]) => {
      const { sid, el } = mountCanvas(mGraph(), 'node'); fn(el); expect(dlg(el)).toBeNull();
      for (const id of gone) expect(has(sid, id)).toBe(false);
      unmountAll();
    };
    run((el) => { onCh(sCh('t1', 't2')); clickTxt(el, 'button', 'Operations'); act(() => btn(el, '.ops-bar button[aria-label="Delete"]').click()); }, ['t1', 't2']);
    run((el) => { onCh(sCh('t1')); act(() => btn(el, 'button[aria-label="Delete 1 selected (Del)"]').click()); }, ['t1']);
    run((el) => { onCh(sCh('t1')); act(() => btn(el, 'button[aria-label="Delete node"]').click()); clickTxt(document.body, '.confirm button', 'Delete'); }, ['t1']);
  });
  it('Operations Cut and Ctrl+X do not bypass model-link confirmation', () => {
    const { sid, el } = mountCanvas(mGraph(), 'omni');
    onCh(sCh('a1', 't1')); clickTxt(el, 'button', 'Operations'); act(() => btn(el, '.ops-bar button[aria-label="Cut"]').click());
    expect(has(sid, 'a1')).toBe(true); expect(dlg(el)).not.toBeNull();
  });
});

describe('Attack 5: Pan & Select share selectability', () => {
  it('never selects collapsed members in Pan (normal/Shift) or Select', () => {
    const { el } = mountCanvas({ nodes: [tNode('t1', 100, 100), tNode('t2', 380, 100), tNode('t3', 100, 350)], edges: [], groups: [{ id: 'g1', title: 'G1', nodeIds: ['t1', 't2'] }] });
    const cv = el.querySelector<HTMLDivElement>('.node-canvas')!, pane = el.querySelector<HTMLDivElement>('.react-flow__pane')!;
    cv.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800, x: 0, y: 0, toJSON: () => ({}) });
    cv.setPointerCapture = () => {};
    act(() => btn(el, 'button[aria-label="Collapse group"]').click());
    expect([rNode('g1')?.selectable, rNode('t1')?.selectable, rNode('t1')?.hidden, rNode('t2')?.selectable, rNode('t3')?.selectable]).toEqual([false, false, true, false, true]);
    act(() => btn(el, 'button[aria-label^="Pan"]').click());
    const box = (shiftKey = false) => {
      const m = (t: string, x: number, y: number) => new MouseEvent(t, { bubbles: true, button: 0, clientX: x, clientY: y, shiftKey });
      act(() => { pane.dispatchEvent(m('pointerdown', 10, 10)); }); act(() => { pane.dispatchEvent(m('pointerdown', 10, 10)); });
      act(() => { cv.dispatchEvent(m('pointermove', 900, 600)); }); act(() => { cv.dispatchEvent(m('pointerup', 900, 600)); });
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
    const nLen = () => sGraph(sid).nodes.length, isCut = (c: HTMLElement) => c.querySelector('.node-canvas')?.classList.contains('is-cut-tool');
    onCh(sCh('n0'));
    key(window, { key: 'c', ctrlKey: true }); expect(hasNodeClipboard()).toBe(true); expect(nLen()).toBe(3);
    key(window, { key: 'x', ctrlKey: true }); expect(nLen()).toBe(2); key(window, { key: 'z', ctrlKey: true }); expect(nLen()).toBe(3);
    key(window, { key: 'Z', ctrlKey: true, shiftKey: true }); expect(nLen()).toBe(2); key(window, { key: 'z', ctrlKey: true }); expect(nLen()).toBe(3);
    key(window, { key: 'y', ctrlKey: true }); expect(nLen()).toBe(2);
    const ta = document.createElement('textarea'); el.append(ta);
    key(ta, { key: 'x' }); expect(isCut(el)).toBe(false); key(ta, { key: 'z', ctrlKey: true }); expect(nLen()).toBe(2);
    act(() => btn(el, 'button[aria-label^="Select:"]').click());
    key(window, { key: 'x' }); expect(isCut(el)).toBe(true); key(window, { key: 'x' }); expect(isCut(el)).toBe(false);
    const { el: emb } = mountCanvas(makeGraph(2, false), 'embedded'); key(window, { key: 'x' }); expect(isCut(emb)).toBe(false);
  });
});
describe('Attack 7: check-node-drag evasions', () => {
  it('reports file:line + hint on direct violation', () => {
    const e = runFix({ [WS]: `${EP} ${h(`${ifD} editPresentation('s', (g: any) => g)`)}` });
    expect(e).toHaveLength(1); expect(e[0]).toMatch(/^src\/components\/node\/NodeWorkspace\.tsx:\d+ — .*dragging: false/);
  });
  it('catches cross-file re-export alias & helper', () => {
    hit({ 'src/components/node/re.ts': `export { editPresentation as savePos } from './e';`, [WS]: `import { savePos } from './re'; ${h(`${ifD} savePos('s', (g: any) => g)`)}` });
    hit({ 'src/components/node/h.ts': `${EP} export function flush(s: string) { editPresentation(s, (g: any) => g); }`, [WS]: `import { flush } from './h'; ${h(`${ifD} flush('s')`)}` });
  });
  it('catches indirect calls + runtime counter catches dynamic writes', () => {
    hit({ [WS]: `${EP} ${h(`${ifD} editPresentation.call(null, 's', (g: any) => g)`)}` });
    hit({ [WS]: `${EP} const o = { w: editPresentation }; ${h(`${ifD} o.w('s', (g: any) => g)`)}` });
    hit({ [WS]: `import * as ed from './e'; const { editPresentation: w } = ed; ${h(`${ifD} w('s', (g: any) => g)`)}` });
    hit({ [WS]: `const ser = JSON.stringify; ${h(`${ifD} ser(c)`)}` });
    const { sid } = mountCanvas(makeGraph(4)); let w = 0;
    cleanups.push(useStore.subscribe((n, p) => { if (n.sessions[sid]?.graph !== p.sessions[sid]?.graph) w++; }));
    onCh([pCh('n0', true, pt(120, 40))]); expect(w).toBe(0);
    const dynObj: Record<string, typeof edit.editPresentation> = { ['w']: edit.editPresentation };
    act(() => { dynObj['w'].call(null, sid, (g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === 'n0' ? { ...n, position: pt(120, 40) } : n)) })); });
    expect(w).toBe(1);
  });
  it('catches nested closure, aliased c.dragging, inline JSX, trailCuts & NodeToolbar', () => {
    hit({ [WS]: `${EP} function C() { const save = () => editPresentation('s', (g: any) => g); const onNodesChange = useCallback((cs: any[]) => { for (const c of cs) ${ifD} save(); }, []); return onNodesChange; }` });
    hit({ [WS]: `${EP} ${h(`{ const d = c.dragging; if (c.type === 'position' && d) editPresentation('s', (g: any) => g); }`)}` });
    hit({ [WS]: `${EP} function C() { return <ReactFlow onNodesChange={(cs: any[]) => { for (const c of cs) if (c.type === 'position' && c.dragging) editPresentation('s', (g: any) => g); }} />; }` });
    hit({ 'src/components/node/CutTool.tsx': `import { trailCuts as scan } from './g'; function useCutTool() { const move = (e: any) => { scan([e], []); }; return { move }; }` });
    hit({ 'src/components/node/nodes.tsx': `import { NodeToolbar as Toolbar } from '@xyflow/react'; function Card({ selected }: { selected: boolean }) { return <><Toolbar isVisible={selected}><div /></Toolbar></>; }` });
  });
});

describe('Attack 8: round 2 regressions & gaps after tanda C', () => {
  it('Cut without model links skips dialog; Ctrl+X on model link keeps clipboard on Cancel', () => {
    const { sid, el } = mountCanvas(mGraph(), 'omni');
    onCh(sCh('t1', 't2')); clickTxt(el, 'button', 'Operations'); act(() => btn(el, '.ops-bar button[aria-label="Cut"]').click());
    expect(dlg(el)).toBeNull(); expect(has(sid, 't1')).toBe(false); expect(has(sid, 't2')).toBe(false);
    const p1 = pasteNodes(sid); expect(sGraph(sid).nodes.filter((n) => p1.includes(n.id)).map((n) => n.data.title).sort()).toEqual(['P1', 'P2']);
    copyNodes(sid, ['t3']); onCh(sCh('a1'));
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', ctrlKey: true, bubbles: true })); });
    expect(dlg(el)).not.toBeNull(); expect(has(sid, 'a1')).toBe(true); clickTxt(dlg(el)!, 'button', 'Cancel'); expect(has(sid, 'a1')).toBe(true);
    const p2 = pasteNodes(sid); expect(sGraph(sid).nodes.filter((n) => p2.includes(n.id)).map((n) => n.data.title)).toEqual(['Keep']);
  });
  it('check-node-drag catches unconditional write after harmless c.dragging', () => {
    hit({ [WS]: `${EP} ${h(`{ if (c.type !== 'position') continue; if (c.dragging) {} editPresentation('s', (g: any) => g); }`)}` });
  });
  it('check-node-drag respects lexical scope (shadowing & same-name FP)', () => {
    hit({ [WS]: `${EP} function A() { const w = editPresentation; ${h(`${ifD} w('s', (g: any) => g)`)} return onNodesChange; } function B(noop: any) { const w = noop; return w; }` });
    expect(runFix({ [WS]: `${EP} function Drag() { const apply = (p: any) => p; ${h(`${ifD} apply(c.position)`)} return onNodesChange; } function Other() { const apply = () => editPresentation('s', (g: any) => g); return apply; }` })).toEqual([]);
  });
  it('check-node-drag catches NodeToolbar after null-return & arrow useCutTool', () => {
    hit({ 'src/components/node/nodes.tsx': `import { NodeToolbar } from '@xyflow/react'; function Card({ node, selected }: any) { if (!node) return null; return <><NodeToolbar isVisible={selected}><div /></NodeToolbar></>; }` });
    hit({ 'src/components/node/CutTool.tsx': `import { trailCuts } from './g'; const useCutTool = () => { const move = (e: any) => { trailCuts([e], []); }; return { move }; };` });
  });
});
