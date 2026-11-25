// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async () => undefined, blobDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined } }));
vi.mock('../src/components/ui/AssetMedia', () => ({ AssetMedia: ({ assetId }: { assetId: string }) => createElement('span', { 'data-asset': assetId }) }));
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { GalleryPanel } from '../src/components/gallery/GalleryPanel';
import { setUi, useStore } from '../src/store/store';
import type { Asset, Subject } from '../src/engine/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

let host: HTMLDivElement;
let root: Root;
const q = (sel: string) => host.querySelector<HTMLElement>(sel)!;
const click = (el: Element | null | undefined) => act(() => (el as HTMLElement).click());
const entries = () => [...host.querySelectorAll('.lib-tile .g-open')].map((b) => b.getAttribute('aria-label')!.replace(/^.*?(Marea|Tidal|Nora|Pebble).*$/, '$1')).sort();
const version = (at: number) => ({ id: `v${at}`, at, by: 'user', space: 'library' });

beforeEach(() => {
  localStorage.clear();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  act(() => {
    useStore.setState({
      assets: { a: { id: 'a', kind: 'image', origin: 'uploaded', createdAt: 20, favorite: true, width: 10, height: 10, stored: true, sessionId: useStore.getState().activeSessionId, name: 'photo' } as unknown as Asset },
      generations: {},
      library: [
        { id: 'k', name: 'Marea', kind: 'brand-kit', refAssetIds: [], versions: [version(30)], tokens: {} },
        { id: 'd', name: 'Tidal', kind: 'design-system', refAssetIds: [], versions: [version(10)], tokens: {} },
        { id: 'n', name: 'Nora', kind: 'character', refAssetIds: [], description: 'a sailor' },
        { id: 'f', name: 'Pebble', kind: 'font', refAssetIds: [], fonts: [{ id: 'font_1', family: 'Pebble', weight: 400, name: 'p.ttf' }] },
      ] as unknown as Subject[],
    });
    setUi({ panelExpanded: true, lightbox: null });
  });
  act(() => root.render(createElement(GalleryPanel)));
});
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ''; });

it('All shows the assets and every kind of Library entry, newest first', () => {
  expect(entries()).toEqual(['Marea', 'Nora', 'Pebble', 'Tidal']);
  const order = [...host.querySelectorAll('.g-tile')].map((t) => t.textContent);
  const at = (name: string) => order.findIndex((t) => t?.includes(name));
  expect(at('Marea')).toBeLessThan(at('Tidal'));
  expect(q('.pc-bar [aria-label="Search"]').getAttribute('data-tip')).toContain('5 results');
});

it('a hidden entry waits for Hidden, and the media filters leave the entries out', () => {
  act(() => useStore.setState((st) => ({ library: st.library.map((s) => (s.id === 'f' ? { ...s, userHidden: 1 } : s)) as Subject[] })));
  expect(entries()).toEqual(['Marea', 'Nora', 'Tidal']);
  click(q('.pc-bar [aria-label^="Favorites only"]'));
  expect(entries()).toEqual([]);
  expect(host.querySelector('[data-asset="a"]')).not.toBeNull();
});

it.each(['Grid', 'Cards', 'List'])('%s shows them too', (layout) => {
  click(q('.pc-bar [aria-label="View"]'));
  click([...document.querySelectorAll('[role="radio"]')].find((b) => b.textContent === layout));
  expect(entries()).toEqual(['Marea', 'Nora', 'Pebble', 'Tidal']);
});
