// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
  peekAssetUrl: () => undefined,
  loadAssetUrl: async () => undefined,
}));

import { readFileSync } from 'node:fs';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { StudioBoard } from '../src/components/studio/StudioBoard';
import { getStudioBoard, reloadStudioBoard } from '../src/lib/studioBoard';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
const q = (s: string) => host.querySelector<HTMLElement>(s);
const render = (el: ReturnType<typeof createElement>) => act(() => root.render(el));

beforeEach(() => { localStorage.clear(); reloadStudioBoard(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe('Studio board divider drag', () => {
  it('moves the board and the workspace --studio-w by direct style writes, and commits only on pointerup', async () => {
    const raf: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => { raf.push(f); return raf.length; });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    const ws = host;
    ws.style.setProperty('--studio-w', '400px');
    render(createElement(StudioBoard));
    const board = q('.studio-board')!, div = q('.studio-divider')!;
    div.setPointerCapture = () => undefined;
    ws.getBoundingClientRect = () => ({ right: 1000, left: 0 }) as DOMRect;
    act(() => { div.dispatchEvent(new PointerEvent('pointerdown', { clientX: 600, pointerId: 1, bubbles: true })); });
    act(() => { div.dispatchEvent(new PointerEvent('pointermove', { clientX: 500, pointerId: 1, bubbles: true })); });
    expect(getStudioBoard().width).toBe(400);
    raf.splice(0).forEach((f) => f(0));
    expect(board.style.width).toBe('500px');
    expect(ws.style.getPropertyValue('--studio-w')).toBe('500px');
    expect(div.classList.contains('is-dragging')).toBe(true);
    expect(getStudioBoard().width).toBe(400);
    act(() => { div.dispatchEvent(new PointerEvent('pointerup', { clientX: 500, pointerId: 1, bubbles: true })); });
    expect(getStudioBoard().width).toBe(500);
    expect(div.classList.contains('is-dragging')).toBe(false);
    vi.unstubAllGlobals();
  });
  it('contains both panes so they cannot overlap', () => {
    const css = readFileSync('src/styles/studio.css', 'utf8');
    expect(css).toMatch(/\.studio-board \{ contain: layout; \}/);
    expect(css).toMatch(/> \.chat \{ min-width: 0; overflow-x: clip; \}/);
  });
});
