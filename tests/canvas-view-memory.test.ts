// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined, putAssetBlob: async () => undefined,
}));
import { rememberView, savedView } from '../src/engine/flow/canvasView';
import { useViewMemory, VIEW_SAVE_DELAY_MS } from '../src/components/node/useViewMemory';
import { graphHistory, travelGraph } from '../src/engine/flow/history';
import { persistState } from '../src/store/persistJson';
import { newSession, setGraph, useStore } from '../src/store/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const graphOf = (sid: string) => useStore.getState().sessions[sid].graph;
const A = { x: 120, y: -40, zoom: 0.62 };
const B = { x: -300, y: 80, zoom: 1.5 };

describe('the canvas view is remembered per session and per canvas', () => {
  it('Nodes and the omnicanvas keep separate views, and sessions are independent', () => {
    const one = newSession(), two = newSession();
    expect(savedView(graphOf(one), 'nodes')).toBeUndefined();
    expect(rememberView(one, 'nodes', A)).toBe(true);
    expect(rememberView(one, 'omni', B)).toBe(true);
    expect(savedView(graphOf(one), 'nodes')).toEqual(A);
    expect(savedView(graphOf(one), 'omni')).toEqual(B);
    expect(savedView(graphOf(two), 'nodes')).toBeUndefined();
    expect(savedView(graphOf(two), 'omni')).toBeUndefined();
    expect(rememberView(one, 'nodes', { ...A })).toBe(false);
  });

  it('refuses a view that is not finite', () => {
    const sid = newSession();
    expect(rememberView(sid, 'nodes', { x: NaN, y: 0, zoom: 1 })).toBe(false);
    expect(rememberView(sid, 'nodes', { x: 0, y: 0, zoom: 0 })).toBe(false);
    expect(savedView(graphOf(sid), 'nodes')).toBeUndefined();
  });

  it('survives a reload (the saved JSON keeps both views)', () => {
    const sid = newSession();
    rememberView(sid, 'nodes', A);
    rememberView(sid, 'omni', B);
    const saved = JSON.parse(persistState({ state: { sessions: { [sid]: useStore.getState().sessions[sid] } }, version: 1 }).text());
    const graph = saved.state.sessions[sid].graph;
    expect(savedView(graph, 'nodes')).toEqual(A);
    expect(savedView(graph, 'omni')).toEqual(B);
  });

  it('a pan is no undo step and does not change what freshness and plans read', () => {
    const sid = newSession();
    setGraph(sid, (g) => ({ ...g, nodes: [...g.nodes, { id: 'n1', position: { x: 0, y: 0 }, data: { kind: 'text', title: 'T', text: 'hi' } as never }] }));
    const steps = graphHistory(sid, 'undo').length;
    const before = graphOf(sid);
    const updatedAt = useStore.getState().sessions[sid].updatedAt;
    rememberView(sid, 'nodes', A);
    rememberView(sid, 'omni', B);
    expect(graphHistory(sid, 'undo')).toHaveLength(steps);
    expect(graphHistory(sid, 'redo')).toHaveLength(0);
    const after = graphOf(sid);
    expect(after.nodes).toBe(before.nodes);
    expect(after.edges).toBe(before.edges);
    expect(useStore.getState().sessions[sid].updatedAt).toBe(updatedAt);
  });

  it('undo keeps the views as they are now', () => {
    const sid = newSession();
    setGraph(sid, (g) => ({ ...g, nodes: [...g.nodes, { id: 'n1', position: { x: 0, y: 0 }, data: { kind: 'text', title: 'T', text: 'hi' } as never }] }));
    rememberView(sid, 'nodes', A);
    rememberView(sid, 'omni', B);
    let undone = graphOf(sid);
    expect(travelGraph(sid, graphOf(sid), 'undo', 1, (g) => { undone = g; return true; })).toBe(true);
    expect(undone.nodes).toHaveLength(0);
    expect(undone.viewport).toEqual(A);
    expect(undone.omniViewport).toEqual(B);
  });
});

describe('useViewMemory', () => {
  afterEach(() => vi.useRealTimers());
  type Memory = ReturnType<typeof useViewMemory>;
  function mount(sid: string, omni: boolean) {
    const out: { current: Memory | null } = { current: null };
    const Harness = () => { out.current = useViewMemory(sid, omni, true); return null; };
    const root = createRoot(document.createElement('div'));
    act(() => root.render(createElement(Harness)));
    return { out, unmount: () => act(() => root.unmount()) };
  }

  it('Nodes -> Designer -> Nodes comes back to the same x, y and zoom, without a new fit', () => {
    vi.useFakeTimers();
    const sid = newSession();
    const first = mount(sid, false);
    expect(first.out.current!.saved).toBeUndefined();
    first.out.current!.onMoveEnd(null, A);
    expect(savedView(graphOf(sid), 'nodes')).toBeUndefined();
    act(() => { vi.advanceTimersByTime(VIEW_SAVE_DELAY_MS + 50); });
    expect(savedView(graphOf(sid), 'nodes')).toEqual(A);
    first.unmount();
    const back = mount(sid, false);
    expect(back.out.current!.saved).toEqual(A);
    back.unmount();
  });

  it('a move still waiting when the canvas closes is saved on the way out; one move is one write', () => {
    vi.useFakeTimers();
    const sid = newSession();
    const m = mount(sid, true);
    const writes = vi.fn();
    const stop = useStore.subscribe((s, p) => { if (s.sessions[sid]?.graph !== p.sessions[sid]?.graph) writes(); });
    for (let i = 0; i < 60; i++) m.out.current!.onMoveEnd(null, { x: i, y: i, zoom: 1 });
    expect(writes).not.toHaveBeenCalled();
    m.out.current!.onMoveEnd(null, B);
    m.unmount();
    stop();
    expect(writes).toHaveBeenCalledTimes(1);
    expect(savedView(graphOf(sid), 'omni')).toEqual(B);
    expect(savedView(graphOf(sid), 'nodes')).toBeUndefined();
    expect(mount(sid, true).out.current!.saved).toEqual(B);
  });
});
