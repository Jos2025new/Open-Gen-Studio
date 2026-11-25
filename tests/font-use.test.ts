// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async () => undefined, blobDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined } }));
vi.mock('../src/components/ui/AssetMedia', () => ({ AssetMedia: ({ assetId }: { assetId: string }) => createElement('span', { 'data-asset': assetId }) }));
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { GalleryPanel } from '../src/components/gallery/GalleryPanel';
import { run } from '../src/engine/commands';
import { addDoc } from '../src/engine/design/actions';
import { createDoc, newTextLayer } from '../src/engine/design/doc';
import type { DesignDoc, Subject } from '../src/engine/types';
import { createSession, selectSession, setUi, useStore } from '../src/store/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

let host: HTMLDivElement, root: Root, one: string, two: string, poster: string;
const click = (el: Element | null | undefined) => act(() => (el as HTMLElement).click());
const text = (fontFamily: string) => newTextLayer('T', 'Hi', { x: 0, y: 0, width: 100 }, { fontFamily });
const design = (session: string, name: string, fonts: string[], over: Partial<DesignDoc> = {}) => {
  const doc = { ...createDoc(name, 100, 100), layers: fonts.map(text), ...over } as DesignDoc;
  addDoc(session, doc);
  return doc.id;
};
const font = (name: string) => [...host.querySelectorAll<HTMLElement>('.lib-tile')].find((t) => t.textContent?.includes(name));

beforeEach(() => {
  localStorage.clear();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  act(() => {
    useStore.setState({ library: [{ id: 'f', name: 'Pebble', kind: 'font', refAssetIds: [], fonts: [{ id: 'font_1', family: 'Pebble', weight: 400, name: 'p.ttf' }] }, { id: 'g', name: 'Reed', kind: 'font', refAssetIds: [], fonts: [{ id: 'font_2', family: 'Reed', weight: 400, name: 'r.ttf' }] }, { id: 'k', name: 'Marea', kind: 'brand-kit', refAssetIds: [], versions: [], tokens: {}, fonts: [{ id: 'font_3', family: 'Kelp', weight: 400, name: 'k.ttf' }] }] as unknown as Subject[] });
    const a = createSession('Spring'), b = createSession('Autumn');
    one = a.id; two = b.id;
    useStore.setState({ sessions: { [one]: a, [two]: b } });
    poster = design(one, 'Poster', ['Pebble', 'Inter', 'Pebble']);
    design(one, 'Card', ['Inter']);
    design(two, 'Menu', ['Pebble']);
    design(two, 'Board', ['Pebble'], { view: 'studio' });
    selectSession(two);
    setUi({ workspace: 'chat', home: false, panel: 'gallery', panelExpanded: true, lightbox: null } as never);
  });
});
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ''; });

it('the agent reads which designs use each font, most used first; boards of kits are not designs', async () => {
  const all = await run({ cmd: 'library.font.list', args: {} }, { caller: 'agent' });
  const fonts = (all.results![0] as { fonts: Array<{ family: string }> }).fonts;
  expect(fonts.map((f) => f.family)).toEqual(['Inter', 'Pebble', 'Kelp', 'Reed']);
  expect(fonts[1]).toEqual({ family: 'Pebble', inLibrary: true, designs: 2, texts: 3 });
  expect(fonts[0]).toMatchObject({ inLibrary: false, designs: 2 });
  expect(fonts[3]).toMatchObject({ designs: 0 });
  const just = await run({ cmd: 'library.font.list', args: { family: 'Pebble' } }, { caller: 'agent' });
  expect(just.results![0]).toEqual({ family: 'Pebble', inLibrary: true, designs: 2, texts: 3, usedIn: [{ session: one, sessionTitle: 'Spring', doc: poster, name: 'Poster', texts: 2 }, { session: two, sessionTitle: 'Autumn', doc: expect.any(String), name: 'Menu', texts: 1 }] });
  expect((await run({ cmd: 'library.font.list', args: { family: 'Reed' } }, { caller: 'agent' })).results![0]).toMatchObject({ designs: 0, usedIn: [] });
});

it('fits whole in what the agent reads, however many fonts and designs there are', async () => {
  for (let i = 0; i < 60; i++) design(one, `A design with quite a long name, number ${i}`, [`A font family with a long name ${i}`, 'Reed']);
  const all = await run({ cmd: 'library.font.list', args: {} }, { caller: 'agent' }), reed = await run({ cmd: 'library.font.list', args: { family: 'Reed' } }, { caller: 'agent' });
  expect(all.results![0]).toMatchObject({ total: 64, more: 34 });
  expect(reed.results![0]).toMatchObject({ designs: 60, more: 45 });
  for (const r of [all, reed]) expect(JSON.stringify(r.results).length).toBeLessThan(4000);
});

it('Fonts shows how many designs use each; a click lists them and goes to one', () => {
  act(() => root.render(createElement(GalleryPanel)));
  click(host.querySelector('.pc-source'));
  click([...document.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent?.startsWith('Fonts')));
  expect(font('Pebble')?.textContent).toContain('2 designs');
  expect(font('Reed')?.textContent).toContain('Not used');
  expect(font('Kelp')?.textContent).toContain('No font file');
  // A font of the app that designs use shows as well, with nothing to remove.
  expect(font('Inter')?.textContent).toContain('2 designs');
  click(font('Pebble')?.querySelector('.g-open'));
  const items = [...document.querySelectorAll('.font-uses [role="menuitem"]')];
  expect(items.map((i) => i.textContent)).toEqual(['PosterSpring2 texts', 'MenuAutumn1 text']);
  click(items[0]);
  const st = useStore.getState();
  expect([st.activeSessionId, st.sessions[one].activeDocId, st.ui.workspace, st.ui.panel]).toEqual([one, poster, 'designer', null]);
  expect(st.sessions[one].docs.find((d) => d.id === poster)!.activeLayerId).toBe(st.sessions[one].docs.find((d) => d.id === poster)!.layers[0].id);
});

it('in an open design a click uses the font, and the menu still lists its designs', () => {
  act(() => { selectSession(one); setUi({ workspace: 'designer' }); });
  act(() => root.render(createElement(GalleryPanel)));
  click(host.querySelector('.pc-source'));
  click([...document.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent?.startsWith('Fonts')));
  click(font('Reed')?.querySelector('[aria-label="Use Reed"]'));
  expect(document.querySelector('.font-uses')).toBeNull();
  expect(useStore.getState().ui.text.fontFamily).toBe('Reed');
  click(font('Pebble')?.querySelector('.pc-more'));
  click([...document.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent === 'Designs that use it'));
  expect(document.querySelectorAll('.font-uses [role="menuitem"]')).toHaveLength(2);
});
