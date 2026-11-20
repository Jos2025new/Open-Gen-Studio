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
import { PORT_MIN_ZOOM, portZoom, rejectedDrop } from '../src/components/node/connectionDrop';
import { connectionError } from '../src/engine/flow/graph';
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

describe('a connection dropped on an incompatible port', () => {
  it('is identified from the drop, with both ports, so the reason can be shown', () => {
    expect(rejectedDrop(state({}))).toEqual({ source: 'a', target: 'b', sourceHandle: 'out', targetHandle: 'prompt' });
  });
  it('is not one when it lands on the background, is valid, or starts from an input', () => {
    expect(rejectedDrop(state({ toNode: null, toHandle: null }))).toBeNull();
    expect(rejectedDrop(state({ isValid: true }))).toBeNull();
    expect(rejectedDrop(state({ fromHandle: { type: 'target', id: 'x' } }))).toBeNull();
  });
  it('has a reason naming both types, and creates no cable', () => {
    setGraph(sid, (g) => ({
      edges: g.edges,
      nodes: [
        { id: 'a', position: { x: 0, y: 0 }, data: { kind: 'image', title: 'I', prompt: '', modelRef: 'm', settings: {}, outputIndex: 0 } as never },
        { id: 'b', position: { x: 300, y: 0 }, data: { kind: 'image', title: 'J', prompt: '', modelRef: 'm', settings: {}, outputIndex: 0 } as never },
      ],
    }));
    const why = connectionError(useStore.getState().sessions[sid].graph, useStore.getState().assets, { source: 'a', target: 'b', targetHandle: 'prompt', sourceHandle: 'out' });
    expect(why).toMatch(/image/i);
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
  it('syncs --rf-zoom at mount and keeps one memoized listener', () => {
    const src = readFileSync('src/components/node/connectionDrop.ts', 'utf8');
    expect(src).toMatch(/useCallback\(\(v/);
    expect(src).toMatch(/rf\.getZoom\(\)/);
  });
});
