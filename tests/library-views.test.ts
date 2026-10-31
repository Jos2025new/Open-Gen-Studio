// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async () => undefined, peekAssetUrl: () => undefined, loadAssetUrl: async () => undefined }));
vi.mock('../src/components/ui/AssetMedia', () => ({ AssetMedia: ({ assetId }: { assetId: string }) => createElement('span', { 'data-asset': assetId }) }));
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { GalleryPanel } from '../src/components/gallery/GalleryPanel';
import { setUi, useStore } from '../src/store/store';
import type { Asset, Generation, Subject } from '../src/engine/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

let host: HTMLDivElement;
let root: Root;
const sid = () => useStore.getState().activeSessionId;
const asset = (id: string, over: Partial<Asset> = {}) => ({ id, kind: 'image', origin: 'generated', createdAt: 1, favorite: false, width: 10, height: 10, stored: true, sessionId: sid(), generationId: `g-${id}`, ...over }) as unknown as Asset;
const gen = (id: string, prompt: string, over: Partial<Generation> = {}) => ({ id, sessionId: sid(), kind: 'image', prompt, modelName: 'Seedance', provider: 'demo', status: 'done', assetIds: [], settings: { count: 1, advanced: {}, aspect: '1:1', resolution: '1k' }, estimate: { usd: 0 }, createdAt: 1, ...over }) as unknown as Generation;
const q = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel)!;
const click = (el: Element | null | undefined) => act(() => (el as HTMLElement).click());
const radio = (text: string) => [...document.querySelectorAll('[role="radio"]')].find((b) => b.textContent === text);
const layout = (name: string) => { click(q('.pc-bar [aria-label="View"]')); click(radio(name)); };

beforeEach(() => {
  localStorage.clear();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  act(() => {
    useStore.setState({
      assets: { a: asset('a', { createdAt: 10 }), c: asset('c', { createdAt: 20, kind: 'video', duration: 5 }) },
      generations: { 'g-a': gen('g-a', 'Mango'), 'g-c': gen('g-c', 'Cherry', { kind: 'video', settings: { count: 1, advanced: {}, aspect: '16:9', resolution: '720p', duration: 5 } as Generation['settings'] }) },
      library: [{ id: 's1', name: 'Zed', kind: 'character', refAssetIds: ['c'], frontalAssetId: 'a' }] as Subject[],
      composer: { ...useStore.getState().composer, attachments: [] },
    });
    setUi({ panelExpanded: true, lightbox: null });
  });
  act(() => root.render(createElement(GalleryPanel)));
});
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ''; });

it('View offers Grid, Cards and List; Cards shows horizontal tiles with details, figures and actions, remembered', () => {
  click(q('.pc-bar [aria-label="View"]'));
  expect([...document.querySelectorAll('[role="radio"]')].map((b) => b.textContent).slice(0, 3)).toEqual(['Grid', 'Cards', 'List']);
  click(radio('Cards'));
  expect(localStorage.getItem('ogs.libraryView')).toBe('"tile"');
  const tiles = [...host.querySelectorAll('.library-layout-tile > .pc-tile')];
  expect(tiles).toHaveLength(2);
  const cherry = tiles.find((t) => t.querySelector('.pc-info-title')?.textContent === 'Cherry')!;
  expect([...cherry.querySelectorAll('.pc-stat')].map((s) => s.textContent)).toEqual(['16:9Aspect', '720pResolution', '5sDuration']);
  expect(cherry.querySelector('.pc-card-actions .btn')?.textContent).toBe('Use as reference');
  click(cherry.querySelector('.pc-card-actions .btn'));
  expect(useStore.getState().composer.attachments).toContain('c');
  click(cherry.querySelector('[aria-label="More actions"]'));
  expect([...document.querySelectorAll('[role="menuitem"]')].map((e) => e.textContent)).toEqual(['Download', 'Hide', 'Delete']);
});

it('list rows offer Use as reference as a pill before their actions', () => {
  layout('List');
  const row = q('.g-tile.pc-row');
  expect(row.querySelector('.pc-tools > .pc-go')?.textContent).toBe('Use as reference');
});

it('saved items follow the same views: Open is the main action and the menu keeps Hide and Remove', () => {
  click(q('.pc-source'));
  click([...document.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent?.startsWith('Character')));
  layout('Cards');
  const tile = q('.lib-tile.pc-tile');
  expect([...tile.querySelectorAll('.pc-stat')].map((s) => s.textContent)).toEqual(['1References', '0Videos', 'CharacterKind']);
  click(tile.querySelector('.pc-card-actions .btn'));
  expect(useStore.getState().ui.lightbox?.assetIds).toEqual(['a', 'c']);
  click(tile.querySelector('[aria-label="More actions for @Zed"]'));
  expect([...document.querySelectorAll('[role="menuitem"]')].map((e) => e.textContent)).toEqual(['Hide', 'Remove @Zed from the library']);
});
