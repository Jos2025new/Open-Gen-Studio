// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlowProvider } from '@xyflow/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const rf = vi.hoisted(() => ({
  fitView: vi.fn(),
  getNodes: vi.fn(() => [] as Array<{ id: string; hidden?: boolean }>),
  zoomIn: vi.fn(),
  zoomOut: vi.fn(),
  zoomTo: vi.fn(),
}));

vi.mock('@xyflow/react', async (orig) => ({
  ...(await orig<typeof import('@xyflow/react')>()),
  useReactFlow: () => rf,
  useViewport: () => ({ x: 0, y: 0, zoom: 1 }),
}));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { rememberView, savedView } from '../src/engine/flow/canvasView';
import { fitTargets } from '../src/engine/flow/fitTargets';
import { graphHistory, travelGraph } from '../src/engine/flow/history';
import { ensureOmniNodes, ordinaryGraph } from '../src/engine/nodes/omni';
import { omniOnly } from '../src/engine/nodes/omniSpaces';
import { CanvasNavigation } from '../src/components/node/CanvasNavigation';
import { useViewMemory } from '../src/components/node/useViewMemory';
import { addAssets, newSession, setGraph, setUi, useStore } from '../src/store/store';
import type { GraphNode } from '../src/engine/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const A = { x: 145, y: -62, zoom: 0.75 };
const B = { x: -420, y: 110, zoom: 1.4 };
const graphOf = (sid: string) => useStore.getState().sessions[sid].graph;
const note = (id: string): GraphNode => ({ id, position: { x: 100, y: 100 }, data: { kind: 'text', title: id, text: id } as never });
const userAsset = (id: string, assetId: string): GraphNode => ({ id, position: { x: 200, y: 200 }, data: { kind: 'asset', title: id, assetId } as never });

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  vi.useRealTimers();
  rf.fitView.mockClear();
  document.body.innerHTML = '';
  act(() => setUi({ workspace: 'node', home: false, space: undefined, omni: false, lightbox: null, textView: null, sketch: null, panel: null }));
});

describe('Attack 1 (UI flush): reload within 600 ms', () => {
  it('flushes a pending pan on pagehide before reload', () => {
    vi.useFakeTimers();
    const sid = newSession();
    let api: ReturnType<typeof useViewMemory> | null = null;
    const Harness = () => { api = useViewMemory(sid, false, true); return null; };
    const root = createRoot(document.createElement('div'));
    act(() => root.render(createElement(Harness)));

    api!.onMoveEnd(null, A);
    expect(savedView(graphOf(sid), 'nodes')).toBeUndefined();
    act(() => { vi.advanceTimersByTime(100); });
    window.dispatchEvent(new Event('pagehide'));
    expect(savedView(graphOf(sid), 'nodes')).toEqual(A);

    act(() => root.unmount());
  });
});

describe('Attack 3: system/omni-only definition vs omniSpaces.ts', () => {
  it('treats omnicanvas auto-imported assets (omni:true) consistently with omniOnly in omniSpaces.ts', () => {
    const sid = newSession();
    addAssets([{ id: 'ast_chat_1', sessionId: sid, kind: 'image', origin: 'chat', mime: 'image/png', createdAt: 100 } as never]);
    ensureOmniNodes(sid);
    const omniAuto = graphOf(sid).nodes.find((n) => n.omni === true);
    expect(omniAuto).toBeDefined();
    expect(omniOnly(omniAuto!)).toBe(true);

    // Case A: only omnicanvas defaults (ref + omni:true), no user-placed nodes -> Fit view should frame all omni cards
    const allDefaultTargets = fitTargets(graphOf(sid).nodes, [], 'all');
    expect(allDefaultTargets).toContain('sys_space_studio');
    expect(allDefaultTargets).toContain('sys_chat');

    // Case B: user adds a workflow node and an explicit asset node -> Fit view frames only user-placed nodes, excluding omni:true auto cards
    setGraph(sid, (g) => ({ ...g, nodes: [...g.nodes, note('u1'), userAsset('u_ast', 'ast_chat_1')] }));
    expect(fitTargets(graphOf(sid).nodes, [], 'all').sort()).toEqual(['u1', 'u_ast']);
  });

  it('disables Fit view button on ordinary Nodes when only omnicanvas-only nodes exist', () => {
    const sid = newSession();
    ensureOmniNodes(sid);
    expect(ordinaryGraph(graphOf(sid)).nodes).toHaveLength(0);
    useStore.setState({ activeSessionId: sid });
    rf.getNodes.mockImplementation(() => []);

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(createElement(ReactFlowProvider, null, createElement(CanvasNavigation, {
      sessionId: sid,
      onSelect: () => undefined,
      tool: 'pan',
      onTool: () => undefined,
      selectedCount: 0,
      selectedIds: [],
      onDelete: () => undefined,
      omni: false,
    }))));
    const btn = host.querySelector('[aria-label^="Fit view"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    act(() => root.unmount());
  });
});

describe('Attack 4: Shift+1/2 contexts and undo after pan', () => {
  function mountNav(selectedIds: string[], omni = false) {
    const sid = newSession();
    setGraph(sid, (g) => ({ ...g, nodes: [...g.nodes, note('a'), note('b')] }));
    useStore.setState({ activeSessionId: sid });
    rf.getNodes.mockImplementation(() => graphOf(sid).nodes.map((n) => ({ id: n.id })));
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(createElement(ReactFlowProvider, null, createElement(CanvasNavigation, {
      sessionId: sid,
      onSelect: () => undefined,
      tool: 'pan',
      onTool: () => undefined,
      selectedCount: selectedIds.length,
      selectedIds,
      onDelete: () => undefined,
      omni,
    }))));
    const stop = () => act(() => root.unmount());
    cleanups.push(stop);
    return { sid, host, stop };
  }
  const press = (code: 'Digit1' | 'Digit2', target: EventTarget = window) =>
    act(() => { target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, shiftKey: true, code, key: code === 'Digit1' ? '!' : '@' })); });

  it('does not fire Shift+1/2 inside select, input, textarea or contenteditable', () => {
    const m = mountNav(['a']);
    for (const tag of ['input', 'textarea', 'select']) {
      const el = document.body.appendChild(document.createElement(tag));
      press('Digit1', el);
      press('Digit2', el);
    }
    const ce = document.body.appendChild(document.createElement('div'));
    ce.setAttribute('contenteditable', 'true');
    press('Digit1', ce);
    expect(rf.fitView).not.toHaveBeenCalled();
    m.stop();
  });

  it('does not fire Shift+1/2 when another space (Create/Tools/Home) or overlay (Lightbox/SidePanel) covers Nodes', () => {
    const m = mountNav(['a']);

    act(() => setUi({ workspace: 'node', space: 'create' }));
    press('Digit1');
    press('Digit2');
    expect(rf.fitView).not.toHaveBeenCalled();

    act(() => setUi({ workspace: 'node', space: undefined, home: true }));
    press('Digit1');
    expect(rf.fitView).not.toHaveBeenCalled();

    act(() => setUi({ workspace: 'node', home: false, lightbox: { assetIds: ['ast_1'], index: 0 } }));
    press('Digit1');
    expect(rf.fitView).not.toHaveBeenCalled();

    act(() => setUi({ workspace: 'node', lightbox: null }));
    const panel = document.body.appendChild(document.createElement('aside'));
    panel.className = 'side-panel';
    const btn = panel.appendChild(document.createElement('button'));
    press('Digit1', btn);
    expect(rf.fitView).not.toHaveBeenCalled();

    m.stop();
  });

  it('does not fire Shift+1/2 when Designer is open (Nodes unmounted)', () => {
    const m = mountNav(['a']);
    m.stop();
    act(() => setUi({ workspace: 'designer' }));
    press('Digit1');
    press('Digit2');
    expect(rf.fitView).not.toHaveBeenCalled();
  });

  it('undo and redo after panning preserve both viewports and panning alone adds no undo step', () => {
    vi.useFakeTimers();
    const sid = newSession();
    rememberView(sid, 'nodes', A);
    expect(graphHistory(sid, 'undo')).toHaveLength(0);

    setGraph(sid, (g) => ({ ...g, nodes: [...g.nodes, note('a')] }));
    expect(graphHistory(sid, 'undo')).toHaveLength(1);
    rememberView(sid, 'nodes', { x: 50, y: 60, zoom: 0.9 });
    rememberView(sid, 'omni', B);
    expect(graphHistory(sid, 'undo')).toHaveLength(1);

    let cur = graphOf(sid);
    expect(travelGraph(sid, cur, 'undo', 1, (g) => { cur = g; return true; })).toBe(true);
    expect(cur.nodes).toHaveLength(0);
    expect(cur.viewport).toEqual({ x: 50, y: 60, zoom: 0.9 });
    expect(cur.omniViewport).toEqual(B);

    expect(travelGraph(sid, cur, 'redo', 1, (g) => { cur = g; return true; })).toBe(true);
    expect(cur.nodes).toHaveLength(1);
    expect(cur.viewport).toEqual({ x: 50, y: 60, zoom: 0.9 });
    expect(cur.omniViewport).toEqual(B);
  });
});
