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

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { StudioBoard } from '../src/components/studio/StudioBoard';
import { BOARD_MAX, BOARD_MIN, getStudioBoard, reloadStudioBoard, setStudioBoard } from '../src/lib/studioBoard';
import { StudioGeneration } from '../src/components/chat/StudioGeneration';
import { SpaceBoard } from '../src/components/space/SpaceBoard';
import { doneExpanded } from '../src/components/space/boardModel';
import { useStore } from '../src/store/store';
import type { Asset, Generation } from '../src/engine/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const asset = (id: string, kind: Asset['kind'] = 'image') => ({ id, kind, origin: 'generated', createdAt: 1, favorite: false, width: 10, height: 10 }) as unknown as Asset;
const gen = (id: string, status: Generation['status'], assetIds: string[] = [], extra: Partial<Generation> = {}) =>
  ({ id, sessionId: 's', kind: 'image', prompt: `prompt ${id}`, modelName: 'm', provider: 'demo', status, assetIds, settings: { count: 1 }, estimate: { usd: 0 }, createdAt: 1, ...extra }) as unknown as Generation;

let host: HTMLDivElement;
let root: Root;
const q = (s: string) => host.querySelector<HTMLElement>(s);
const render = (el: ReturnType<typeof createElement>) => act(() => root.render(el));
const setData = (gens: Generation[], assets: Asset[] = [asset('a1'), asset('a2')]) => act(() => useStore.setState({ generations: Object.fromEntries(gens.map((g) => [g.id, g])), assets: Object.fromEntries(assets.map((a) => [a.id, a])) }));

beforeEach(() => { localStorage.clear(); reloadStudioBoard(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe('Studio board layout state', () => {
  it('opens by default, closes, clamps its width and keeps both', () => {
    expect(getStudioBoard()).toEqual({ open: true, width: 400, view: 'assets' });
    setStudioBoard({ open: false, width: 9999 });
    expect(getStudioBoard()).toEqual({ open: false, width: BOARD_MAX, view: 'assets' });
    setStudioBoard({ width: 10 });
    expect(getStudioBoard().width).toBe(BOARD_MIN);
    reloadStudioBoard();
    expect(getStudioBoard()).toEqual({ open: false, width: BOARD_MIN, view: 'assets' });
  });
  it('the X closes the board, a small control reopens it', () => {
    setData([]);
    render(createElement(StudioBoard));
    expect(q('.studio-board')).not.toBeNull();
    act(() => q('[aria-label="Close board"]')!.click());
    expect(q('.studio-board')).toBeNull();
    expect(getStudioBoard().open).toBe(false);
    act(() => q('[aria-label="Show generations"]')!.click());
    expect(q('.studio-board')).not.toBeNull();
  });
  it('has Done and Ongoing only: no Actions suggested', () => {
    setData([]);
    render(createElement(StudioBoard));
    expect(q('[aria-label="Done"]')).not.toBeNull();
    expect(q('[aria-label="Ongoing"]')).not.toBeNull();
    expect(q('[aria-label="Actions suggested"]')).toBeNull();
  });
});

describe('board views', () => {
  beforeEach(() => {
    class RO { observe() {} unobserve() {} disconnect() {} }
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = RO;
    (globalThis as { DOMMatrixReadOnly?: unknown }).DOMMatrixReadOnly = class { m22 = 1; constructor() {} };
  });
  it('has a view switcher (Generations, Nodes, Designer); switching keeps the workspace', () => {
    setData([]);
    render(createElement(StudioBoard));
    const tabs = [...host.querySelectorAll<HTMLButtonElement>('.studio-view')];
    expect(tabs.map((t) => t.textContent)).toEqual(['Generations', 'Nodes', 'Designer']);
    expect(tabs.every((t) => !t.disabled)).toBe(true);
    const ws = useStore.getState().ui.workspace;
    act(() => tabs[1].click());
    expect(getStudioBoard().view).toBe('nodes');
    expect(useStore.getState().ui.workspace).toBe(ws);
    act(() => host.querySelectorAll<HTMLButtonElement>('.studio-view')[0].click());
    expect(q('[aria-label="Done"]')).not.toBeNull();
  });
  it('the Nodes view is the embedded canvas: zoom and fit only, no Add node or Operations', () => {
    setData([]);
    setStudioBoard({ view: 'nodes' });
    render(createElement(StudioBoard));
    expect(q('.node-canvas.is-embedded')).not.toBeNull();
    expect(q('[aria-label="Fit view"]')).not.toBeNull();
    expect(q('[aria-label="Zoom in"]')).not.toBeNull();
    expect(host.textContent).not.toContain('Add node');
    expect(q('.node-ops, .operations')).toBeNull();
    expect(host.textContent).toContain('No nodes yet');
  });
});

describe('Done / Ongoing rule', () => {
  it('pure rule: Studio folds Done while running; the hand toggle wins; elsewhere always open', () => {
    expect(doneExpanded({ running: true, override: null, auto: true })).toBe(false);
    expect(doneExpanded({ running: false, override: null, auto: true })).toBe(true);
    expect(doneExpanded({ running: true, override: true, auto: true })).toBe(true);
    expect(doneExpanded({ running: true, override: null, auto: false })).toBe(true);
    expect(doneExpanded({ running: false, override: false, auto: false })).toBe(false);
  });
  it('Studio: Done folds when something runs and opens when nothing does', () => {
    setData([gen('g1', 'done', ['a1'])]);
    render(createElement(SpaceBoard, { studio: true }));
    expect(q('.space-fold')!.getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelectorAll('.space-tile')).toHaveLength(1);
    setData([gen('g1', 'done', ['a1']), gen('g2', 'running')]);
    expect(q('.space-fold')!.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelectorAll('.space-tile')).toHaveLength(0);
    expect(q('.space-run')).not.toBeNull();
    setData([gen('g1', 'done', ['a1']), gen('g2', 'done', ['a2'])]);
    expect(q('.space-fold')!.getAttribute('aria-expanded')).toBe('true');
  });
  it('Done folds by hand with its count, in Studio and in the plain board (which keeps Actions)', () => {
    setData([gen('g1', 'done', ['a1', 'a2'])]);
    render(createElement(SpaceBoard, { kind: 'image' }));
    expect(q('.space-fold')!.textContent).toContain('2');
    act(() => q('.space-fold')!.click());
    expect(q('.space-fold')!.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelectorAll('.space-tile')).toHaveLength(0);
    expect(q('[aria-label="Actions suggested"]')).not.toBeNull();
    setData([gen('g1', 'done', ['a1', 'a2']), gen('g2', 'running')]);
    expect(q('.space-fold')!.getAttribute('aria-expanded')).toBe('false');
    act(() => q('.space-fold')!.click());
    expect(host.querySelectorAll('.space-tile')).toHaveLength(2);
  });
});

describe('compact generation in Studio chat', () => {
  const fallback = createElement('div', { className: 'full-card' }, 'card');
  it('shows "Created N files" and small thumbnails that open the viewer; the line folds', () => {
    setData([gen('g1', 'done', ['a1', 'a2'])]);
    render(createElement(StudioGeneration, { generationId: 'g1', fallback }));
    expect(q('.studio-gen-head')!.textContent).toContain('Created 2 files');
    expect(host.querySelectorAll('.studio-thumb')).toHaveLength(2);
    expect(q('.full-card')).toBeNull();
    act(() => host.querySelectorAll<HTMLElement>('.studio-thumb')[1].click());
    expect(useStore.getState().ui.lightbox).toMatchObject({ assetIds: ['a1', 'a2'], index: 1 });
    act(() => q('.studio-gen-head')!.click());
    expect(host.querySelectorAll('.studio-thumb')).toHaveLength(0);
  });
  it('thumbnails carry the tinted kind icon behind the picture, as the board tiles do', () => {
    setData([gen('g1', 'done', ['a1'])]);
    render(createElement(StudioGeneration, { generationId: 'g1', fallback }));
    expect(q('.studio-thumb .kind-backdrop.is-image')).not.toBeNull();
    render(createElement(SpaceBoard, { studio: true }));
    expect(q('.space-tile .kind-backdrop.is-image')).not.toBeNull();
  });
  it('a video shows a play icon; a running generation shows a small placeholder', () => {
    setData([gen('g1', 'done', ['v1'], { kind: 'video' }), gen('g2', 'running')], [asset('v1', 'video')]);
    render(createElement(StudioGeneration, { generationId: 'g1', fallback }));
    expect(q('.studio-thumb-play')).not.toBeNull();
    render(createElement(StudioGeneration, { generationId: 'g2', fallback }));
    expect(q('.studio-thumb.is-pending')).not.toBeNull();
    expect(q('.studio-gen-head')!.textContent).toContain('Creating');
  });
  it('failures and sound keep the full card', () => {
    setData([gen('g1', 'error'), gen('g2', 'done', ['a1'], { kind: 'audio' })]);
    render(createElement(StudioGeneration, { generationId: 'g1', fallback }));
    expect(q('.full-card')).not.toBeNull();
    render(createElement(StudioGeneration, { generationId: 'g2', fallback }));
    expect(q('.full-card')).not.toBeNull();
  });
});
