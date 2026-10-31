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
import { readFileSync } from 'node:fs';
import { SpaceBoard } from '../src/components/space/SpaceBoard';
import { GalleryPanel } from '../src/components/gallery/GalleryPanel';
import { setUi, useStore } from '../src/store/store';
import { sanitizeUi, sanitizeTileSize, TILE_DEFAULT, TILE_MAX, TILE_MIN } from '../src/store/persistUi';
import type { Asset, Generation } from '../src/engine/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

const asset = (id: string) => ({ id, kind: 'image', origin: 'generated', createdAt: 1, favorite: false, width: 10, height: 10 }) as unknown as Asset;
let host: HTMLDivElement;
let root: Root;
const render = (el: ReturnType<typeof createElement>) => act(() => root.render(el));
const setNum = (input: HTMLInputElement, v: number) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, String(v));
  input.dispatchEvent(new Event('input', { bubbles: true }));
});

beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); setUi({ tileSize: undefined }); });
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ''; });

describe('Generations tile size slider', () => {
  const open = () => {
    const g = { id: 'g1', sessionId: useStore.getState().activeSessionId, kind: 'image', prompt: 'p', modelName: 'm', provider: 'demo', status: 'done', assetIds: ['a1'], settings: { count: 1 }, estimate: { usd: 0 }, createdAt: 1 } as unknown as Generation;
    act(() => useStore.setState({ generations: { g1: g }, assets: { a1: asset('a1') } }));
    render(createElement(SpaceBoard, { kind: 'image' }));
    act(() => document.querySelector<HTMLElement>('button[aria-label="View"]')!.click());
  };
  it('the View popover has the app slider (InlineSlider) instead of Large/Small, and it sets the grid CSS variable', () => {
    open();
    expect(document.body.textContent).not.toMatch(/Large|Small/);
    expect(document.querySelector('.opt-slider [aria-label="Tile size"]')).not.toBeNull();
    const grid = () => host.querySelector<HTMLElement>('.space-grid')!;
    expect(grid().style.getPropertyValue('--tile')).toBe(`${TILE_DEFAULT}px`);
    setNum(document.querySelector<HTMLInputElement>('input[aria-label="Tile size"]')!, 500);
    expect(grid().style.getPropertyValue('--tile')).toBe('500px');
    expect(useStore.getState().ui.tileSize).toBe(500);
  });
  it('the grid fills the row: minmax(min(var(--tile), 100%), 1fr), so the maximum is one column', () => {
    const css = readFileSync('src/styles/space.css', 'utf8');
    expect(css).toMatch(/\.space-grid \{[^}]*repeat\(auto-fill, minmax\(min\(var\(--tile\), 100%\), 1fr\)\)/);
    expect(TILE_MAX).toBeGreaterThanOrEqual(600);
    expect(TILE_DEFAULT).toBeGreaterThan(200);
  });
  it('List layout has no tile slider', () => {
    open();
    act(() => [...document.querySelectorAll<HTMLElement>('button')].find((b) => b.textContent === 'List')!.click());
    expect(document.querySelector('input[aria-label="Tile size"]')).toBeNull();
  });
});

describe('saved tile size', () => {
  it('migrates the old choice and validates numbers', () => {
    expect(sanitizeUi({ tileSize: 'small' as unknown as number }).tileSize).toBe(TILE_MIN);
    expect(sanitizeUi({ tileSize: 'large' as unknown as number }).tileSize).toBe(TILE_DEFAULT);
    expect(sanitizeTileSize(5)).toBe(TILE_MIN);
    expect(sanitizeTileSize(99999)).toBe(TILE_MAX);
    expect(sanitizeTileSize(333.4)).toBe(333);
    for (const bad of ['huge', NaN, null, {}]) expect(sanitizeTileSize(bad)).toBeUndefined();
  });
});

describe('Library uses the same slider', () => {
  it('shows the grid size slider in the bar and hides it in list view', () => {
    const sessionId = useStore.getState().activeSessionId;
    act(() => useStore.setState({ assets: { sample: { ...asset('sample'), sessionId } }, generations: {} }));
    render(createElement(GalleryPanel));
    const src = readFileSync('src/components/gallery/GalleryPanel.tsx', 'utf8');
    expect(src).toMatch(/<InlineSlider label="Grid size"/);
    const size = host.querySelector<HTMLInputElement>('input[aria-label="Grid size"]')!;
    expect(size).not.toBeNull();
    const before = Number(size.value);
    if (before < Number(size.max)) {
      const columns = Number(host.querySelector<HTMLElement>('.gallery-grid')!.style.getPropertyValue('--cols'));
      setNum(size, before + 1);
      expect(Number(host.querySelector<HTMLElement>('.gallery-grid')!.style.getPropertyValue('--cols'))).toBe(columns - 1);
    }
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="View"]')!.click());
    const list = [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((button) => button.textContent === 'List')!;
    act(() => list.click());
    expect(host.querySelector('input[aria-label="Grid size"]')).toBeNull();
    expect(host.querySelector<HTMLButtonElement>('[aria-label="View"]')?.textContent).toContain('List');
  });
});
