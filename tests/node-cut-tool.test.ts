// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { act, createElement, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { segmentsCross, trailCuts, useCutTool } from '../src/components/node/CutTool';
import { shortcutGroups } from '../src/engine/shortcuts';

const nav = readFileSync('src/components/node/CanvasNavigation.tsx', 'utf8');
const ws = readFileSync('src/components/node/NodeWorkspace.tsx', 'utf8');

describe('Nodes Cut tool (scissors)', () => {
  it('a trail cuts only the connections it crosses', () => {
    expect(segmentsCross({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 })).toBe(true);
    expect(segmentsCross({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: 10, y: 5 })).toBe(false);
    expect(segmentsCross({ x: 0, y: 0 }, { x: 4, y: 4 }, { x: 6, y: 0 }, { x: 10, y: -4 })).toBe(false);
    const lines = [
      { id: 'a', points: [{ x: 0, y: 10 }, { x: 50, y: 12 }, { x: 100, y: 10 }] },
      { id: 'b', points: [{ x: 0, y: 80 }, { x: 100, y: 80 }] },
    ];
    expect(trailCuts([{ x: 40, y: 0 }, { x: 45, y: 30 }], lines)).toEqual(['a']);
    expect(trailCuts([{ x: 40, y: 0 }, { x: 42, y: 50 }, { x: 45, y: 100 }], lines)).toEqual(['a', 'b']);
    expect(trailCuts([{ x: 40, y: 30 }, { x: 60, y: 60 }], lines)).toEqual([]);
  });

  it('sits in the toolbox after Pan, takes X, is not remembered, and cuts through disconnectEdges (one undo step)', () => {
    const panel = nav.slice(nav.indexOf('<Panel position'), nav.indexOf('</Panel>'));
    expect(panel.indexOf('icon={Scissors}')).toBeGreaterThan(panel.indexOf('icon={Hand}'));
    expect(panel.indexOf('icon={Scissors}')).toBeLessThan(panel.indexOf('icon={LayoutDashboard}'));
    expect(panel).toMatch(/label="Cut connections \(X\)/);
    expect(ws).toMatch(/if \(k === 'x'\) \{ e\.preventDefault\(\); pickTool\(tool === 'cut' \? lastTool\.current : 'cut'\); \}/);
    expect(ws).toMatch(/if \(t === 'cut'\) return; lastTool\.current = t; try \{ localStorage/);
    expect(ws).toMatch(/useCutTool\(\{ active: tool === 'cut', canvasRef, onCut: \(ids\) => void disconnectEdges\(sessionId, ids\) \}\)/);
    expect(ws).toMatch(/panOnDrag=\{tool === 'pan' \? true : \[1, 2\]\}/);
    expect(shortcutGroups().find((g) => g.title === 'Nodes')?.items.some((i) => i.keys === 'X')).toBe(true);
  });
});

describe('useCutTool incremental per-move cutting', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()!();
    vi.restoreAllMocks();
  });

  it('cuts the same edges as trailCuts on a long trail without repeating work per move', () => {
    if (typeof globalThis.DOMPoint === 'undefined') {
      (globalThis as unknown as { DOMPoint: unknown }).DOMPoint = class {
        constructor(public x = 0, public y = 0) {}
        matrixTransform() { return this; }
      };
    }
    if (!globalThis.CSS?.escape) {
      (globalThis as unknown as { CSS: { escape: (s: string) => string } }).CSS = { escape: (s: string) => s };
    }
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

    const canvas = document.createElement('div');
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, right: 200, bottom: 200, width: 200, height: 200, x: 0, y: 0, toJSON: () => ({}) });
    const pane = document.createElement('div');
    pane.className = 'react-flow__pane';
    canvas.append(pane);

    const makeEdge = (id: string, y: number) => {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'react-flow__edge');
      g.setAttribute('data-id', id);
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('class', 'react-flow__edge-path');
      Object.assign(path, {
        getScreenCTM: () => ({}),
        getTotalLength: () => 100,
        getPointAtLength: (len: number) => ({ x: len, y }),
      });
      g.append(path);
      canvas.append(g);
    };
    makeEdge('e1', 20);
    makeEdge('e2', 80);
    document.body.append(canvas);

    let api!: ReturnType<typeof useCutTool>;
    const onCut = vi.fn();
    function Harness() {
      const ref = useRef<HTMLDivElement | null>(canvas);
      api = useCutTool({ active: true, canvasRef: ref, onCut });
      return createElement('div', null, api.overlay);
    }
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    cleanups.push(() => {
      act(() => root.unmount());
      host.remove();
      canvas.remove();
    });
    act(() => root.render(createElement(Harness)));

    const qsaSpy = vi.spyOn(canvas, 'querySelectorAll');
    const qsSpy = vi.spyOn(canvas, 'querySelector');
    const evt = (x: number, y: number) => ({
      button: 0,
      clientX: x,
      clientY: y,
      pointerId: 1,
      target: pane,
      currentTarget: canvas,
      stopPropagation: vi.fn(),
      preventDefault: vi.fn(),
    } as unknown as React.PointerEvent<HTMLDivElement>);

    act(() => api.down(evt(50, 0)));
    qsaSpy.mockClear();
    qsSpy.mockClear();

    // Cross e1 (y=20), then 100 moves in empty space (y=41..60), then cross e2 (y=80).
    act(() => api.move(evt(50, 40)));
    for (let i = 0; i < 100; i++) {
      act(() => api.move(evt(50 + (i % 5), 41 + i * 0.19)));
    }
    act(() => api.move(evt(50, 100)));

    // Moves should not re-scan .is-cut-hit or re-query already-hit edges on every pointermove.
    expect(qsaSpy).not.toHaveBeenCalled();
    expect(qsSpy).toHaveBeenCalledTimes(2);

    act(() => api.up(evt(50, 100)));
    expect(onCut).toHaveBeenCalledWith(['e1', 'e2']);
  });
});
