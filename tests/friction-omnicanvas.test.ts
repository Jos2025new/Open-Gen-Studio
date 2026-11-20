import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

/* Omnicanvas friction: a refused drop says why, a refused add says why, ports keep a minimum on-screen size at low
 * zoom, Add node says it opens a picker and the menu entry says it is the node canvas. */
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));
import { PORT_MIN_ZOOM, portZoom, refusedDropReason, rejectedDrop, reportRefusedDrop } from '../src/components/node/connectionDrop';
import { addNode } from '../src/engine/flow/actions';
import { OMNI_ITEM } from '../src/components/shell/navModel';
import { createSession, setGraph, useStore } from '../src/store/store';

let sid = '';
beforeEach(() => {
  const session = createSession('Friction');
  sid = session.id;
  useStore.setState((st) => ({ sessions: { ...st.sessions, [sid]: session }, ui: { ...st.ui, toasts: [] } }));
});

const state = (over: Record<string, unknown>) => ({ isValid: false, fromNode: { id: 'a' }, fromHandle: { type: 'source', id: 'out' }, toNode: { id: 'b' }, toHandle: { type: 'target', id: 'prompt' }, ...over }) as never;

const graphWith = () => setGraph(sid, (g) => ({
  edges: g.edges,
  nodes: [
    { id: 'p', position: { x: 0, y: 0 }, data: { kind: 'text', title: 'P', text: '' } as never },
    { id: 'i', position: { x: 300, y: 0 }, data: { kind: 'image', title: 'I', prompt: '', modelRef: 'm', settings: {}, outputIndex: 0 } as never },
  ],
}));
const reason = (st: unknown) => refusedDropReason(st as never, useStore.getState().sessions[sid].graph, useStore.getState().assets);
// text output 'p' dropped on the image node's 'ref' input, dragging from either end.
const fwd = { fromNode: { id: 'p' }, fromHandle: { type: 'source', id: 'out' }, toNode: { id: 'i' }, toHandle: { type: 'target', id: 'ref' } };
const rev = { fromNode: { id: 'i' }, fromHandle: { type: 'target', id: 'ref' }, toNode: { id: 'p' }, toHandle: { type: 'source', id: 'out' } };

describe('a connection dropped on an incompatible port', () => {
  it('is identified from the drop, oriented source→target in either drag direction', () => {
    const tried = { source: 'p', target: 'i', sourceHandle: 'out', targetHandle: 'ref' };
    expect(rejectedDrop(state(fwd))).toEqual(tried);
    expect(rejectedDrop(state(rev))).toEqual(tried);
  });
  it('is not one when released on the very handle it started from', () => {
    expect(rejectedDrop(state({ toNode: { id: 'a' }, toHandle: { type: 'source', id: 'out' } }))).toBeNull();
  });
  it('is not one when it lands on the background or is valid', () => {
    expect(rejectedDrop(state({ toNode: null, toHandle: null }))).toBeNull();
    expect(rejectedDrop(state({ isValid: true }))).toBeNull();
  });
  it('names both port types in the reason, in both directions', () => {
    graphWith();
    for (const drop of [fwd, rev]) expect(reason(state(drop))).toMatch(/expects image.*text|text.*expects image/i);
  });
  it('refuses output→output and input→input with a reason', () => {
    graphWith();
    expect(reason(state({ ...fwd, toHandle: { type: 'source', id: 'out' } }))).toMatch(/output.*input/);
    expect(reason(state({ ...rev, toHandle: { type: 'target', id: 'ref' } }))).toMatch(/output.*input/);
  });
  it('toasts the reason once from onConnectEnd and reports the drop as handled', () => {
    graphWith();
    const notify = vi.fn();
    const st = useStore.getState();
    expect(reportRefusedDrop(state(rev), st.sessions[sid].graph, st.assets, notify)).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatch(/^Cannot connect: .*image/i);
    expect(reportRefusedDrop(state({ isValid: true }), st.sessions[sid].graph, st.assets, notify)).toBe(false);
    expect(notify).toHaveBeenCalledTimes(1);
  });
  it('says nothing for a valid drop and creates no cable when refused', () => {
    graphWith();
    expect(reason(state({ ...fwd, isValid: true }))).toBeNull();
    expect(useStore.getState().sessions[sid].graph.edges).toHaveLength(0);
  });
});

describe('Add node', () => {
  it('says why when the add is refused, and adds nothing', () => {
    expect(addNode('nope', { kind: 'text', title: 'Prompt', text: '' }, { x: 0, y: 0 })).toBe('');
    expect(useStore.getState().ui.toasts.map((t) => t.text).join()).toMatch(/Could not add the node: No such session/);
  });
  it('adds a node and returns its id when accepted', () => {
    const id = addNode(sid, { kind: 'text', title: 'Prompt', text: '' }, { x: 0, y: 0 });
    expect(useStore.getState().sessions[sid].graph.nodes.some((n) => n.id === id)).toBe(true);
  });
  it('is labelled as opening a picker', () => {
    expect(readFileSync('src/components/node/NodeCanvasParts.tsx', 'utf8')).toContain('label="Add node…"');
  });
});

describe('omnicanvas entry and ports', () => {
  it('names the node canvas in the entry, keeping its icon', () => {
    expect(OMNI_ITEM.label).toMatch(/Node canvas/);
    expect(OMNI_ITEM.icon).toBeDefined();
  });
  it('clamps the zoom that scales ports, so the hit area never outgrows a card', () => {
    expect(portZoom(0.05)).toBe(PORT_MIN_ZOOM);
    expect(portZoom(0.35)).toBe(0.35);
    expect(portZoom(3)).toBe(3);
    expect(12 / portZoom(0.05)).toBeLessThanOrEqual(48);
  });
  it('never resizes the port box (React Flow anchors cables from it), only a centred ::before', () => {
    const css = readFileSync('src/styles/node-system.css', 'utf8');
    const omni = css.split('\n').filter((l) => l.startsWith('.node-canvas.is-omni .react-flow__node .port'));
    expect(omni.length).toBeGreaterThan(0);
    for (const rule of omni.filter((l) => !l.includes('::before'))) expect(rule).not.toMatch(/(^|[^-])(width|height)\s*:/);
    expect(omni.find((l) => l.includes('::before'))).toMatch(/12px \/ var\(--rf-zoom[^}]*translate\(-50%, -50%\)[^}]*pointer-events: all/);
  });
  it('keeps hidden (.port-quiet) ports unclickable through the enlarged ::before', () => {
    const css = readFileSync('src/styles/node-system.css', 'utf8');
    expect(css).toMatch(/\.port\.port-quiet::before \{ pointer-events: none; \}/);
  });
  it('syncs --rf-zoom at mount and keeps one memoized listener', () => {
    const src = readFileSync('src/components/node/connectionDrop.ts', 'utf8');
    expect(src).toMatch(/useCallback\(\(v/);
    expect(src).toMatch(/rf\.getZoom\(\)/);
  });
});

describe('a locked delete is announced once', () => {
  it('flags the refused edit as already notified so addNode does not toast a second time', async () => {
    const { applyEdit } = await import('../src/engine/nodecore/edit');
    const { lockNodes } = await import('../src/engine/flow/locks');
    graphWith();
    const done = applyEdit({ session: sid, op: { op: 'delete', nodes: ['p'] } });
    expect(done.ok).toBe(true);
    const release = lockNodes(sid, ['i']);
    const refused = applyEdit({ session: sid, op: { op: 'delete', nodes: ['i'] } });
    release();
    expect(refused).toMatchObject({ ok: false, notified: true });
  });
});
