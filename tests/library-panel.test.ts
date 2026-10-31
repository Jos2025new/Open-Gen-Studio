// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async () => undefined, peekAssetUrl: () => undefined, loadAssetUrl: async () => undefined }));
vi.mock('../src/components/ui/AssetMedia', () => ({ AssetMedia: ({ assetId }: { assetId: string }) => createElement('span', { 'data-asset': assetId }) }));
import { readFileSync } from 'node:fs';
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
const click = (el: Element | null) => act(() => (el as HTMLElement).click());
const names = () => [...host.querySelectorAll('.g-tile .g-open')].map((b) => b.getAttribute('title'));
const mount = () => act(() => root.render(createElement(GalleryPanel)));

beforeEach(() => {
  localStorage.clear();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  act(() => {
    useStore.setState({
      assets: { a: asset('a', { createdAt: 10 }), b: asset('b', { createdAt: 30, favorite: true }), c: asset('c', { createdAt: 20, kind: 'video', duration: 5 }) },
      generations: { 'g-a': gen('g-a', 'Mango'), 'g-b': gen('g-b', 'Apple'), 'g-c': gen('g-c', 'Cherry', { kind: 'video', settings: { count: 1, advanced: {}, aspect: '16:9', resolution: '720p', duration: 5 } as Generation['settings'] }) },
      library: [{ id: 's1', name: 'Zed', kind: 'character', refAssetIds: [], frontalAssetId: 'a' }, { id: 's2', name: 'Bar', kind: 'location', refAssetIds: [] }, { id: 's3', name: 'Alf', kind: 'character', refAssetIds: [] }] as Subject[],
      composer: { ...useStore.getState().composer, attachments: [] },
    });
    setUi({ panelExpanded: true, lightbox: null });
  });
  mount();
});
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ''; });

describe('Library top bar', () => {
  it('sorts by date newest first, then toggles name and date, flipping on a second press', () => {
    expect(names()).toEqual(['Apple', 'Cherry', 'Mango']);
    const name = q<HTMLButtonElement>('[aria-label="Sort by name"]');
    const date = q<HTMLButtonElement>('[aria-label="Sort by date"]');
    expect(date.getAttribute('aria-pressed')).toBe('true');
    expect(name.getAttribute('aria-pressed')).toBe('false');
    click(name);
    expect(names()).toEqual(['Apple', 'Cherry', 'Mango']);
    expect(name.getAttribute('aria-pressed')).toBe('true');
    expect(date.getAttribute('aria-pressed')).toBe('false');
    click(name);
    expect(names()).toEqual(['Mango', 'Cherry', 'Apple']);
    click(date);
    expect(names()).toEqual(['Apple', 'Cherry', 'Mango']);
    click(date);
    expect(names()).toEqual(['Mango', 'Cherry', 'Apple']);
    expect(name.getAttribute('aria-pressed')).toBe('false');
  });

  it('has three zones: left (search, filter, sorts, scope), centered types, right (size, view)', () => {
    expect(readFileSync('src/components/ui/PanelControls.css', 'utf8')).not.toMatch(/\.pc-bar \{[^}]*space-between/);
    const kids = [...q('.pc-bar').children];
    expect(kids).toHaveLength(3);
    const labels = [...kids[0].querySelectorAll('button')].map((b) => b.getAttribute('aria-label') ?? b.textContent);
    expect(labels.slice(0, 4)).toEqual(['Search', 'Filter by', 'Sort by name', 'Sort by date']);
    expect(labels.slice(4)).toEqual(['This session', 'All sessions']);
    expect(kids[1].classList.contains('pc-center')).toBe(true);
    expect(kids[1].querySelector('[aria-label="Images"]')).not.toBeNull();
    expect(kids[2].querySelector('input[aria-label="Grid size"]')).not.toBeNull();
    expect(kids[2].querySelector('[aria-label="List view"]')).not.toBeNull();
  });

  it('the bar spans the full width of the controls even when the panel is expanded', () => {
    const css = readFileSync('src/components/gallery/GalleryLayout.css', 'utf8');
    expect(css).toMatch(/\.side-panel\.is-expanded \.generated-controls \{ flex-direction: column;[^}]*align-items: stretch/);
    expect(css).toMatch(/\.generated-controls > \.pc-bar \{ width: 100%/);
    expect(q('.generated-controls').firstElementChild?.classList.contains('pc-bar')).toBe(true);
    click(q('.pc-rail [aria-label="Character"]'));
    expect(q('.generated-controls').firstElementChild?.classList.contains('pc-bar')).toBe(true);
  });

  it('the scope is a visible control after the date sort (default this session) and no longer in Filter by', () => {
    const seg = q('.pc-bar .pc-grp').querySelector('[role="radiogroup"], .seg')!;
    expect(seg).not.toBeNull();
    useStore.setState((s) => ({ assets: { ...s.assets, z: asset('z', { sessionId: 'other', createdAt: 5, generationId: undefined, name: 'Zed' }) } }));
    act(() => root.unmount()); root = createRoot(host); mount();
    expect(names()).not.toContain('Zed');
    click([...q('.pc-bar').querySelectorAll('button')].find((b) => b.textContent === 'All sessions') ?? null);
    expect(names()).toContain('Zed');
    click(q('[aria-label="Filter by"]'));
    expect([...document.querySelectorAll('.sv-label')].map((e) => e.textContent?.trim())).not.toContain('Show');
  });

  it('filters by type with icon buttons and All restores everything', () => {
    for (const label of ['Images', 'Videos', 'Audio', '3D', 'Text']) expect(q(`[aria-label="${label}"]`).textContent).toBe('');
    click(q('[aria-label="Videos"]'));
    expect(names()).toEqual(['Cherry']);
    click(q('[aria-label="Videos"]'));
    expect(names()).toHaveLength(3);
    click(q('[aria-label="Images"]'));
    expect(names()).toHaveLength(2);
    const all = [...host.querySelectorAll('.pc-center button')].find((b) => b.textContent === 'All')!;
    click(all);
    expect(names()).toHaveLength(3);
  });

  it('keeps Canvas, Place, Mode, Group by and Favorites only in the Filter by menu', () => {
    click(q('[aria-label="Filter by"]'));
    const labels = [...document.querySelectorAll('.sv-row .sv-label, .sv-switch span')].map((e) => e.textContent?.trim());
    for (const l of ['Canvas', 'Place', 'Mode', 'Group by', 'Favorites only']) expect(labels).toContain(l);
    click(document.querySelector('[role="switch"][aria-label="Favorites only"]'));
    expect(names()).toEqual(['Apple']);
  });

  it('remembers list or card view, and old stored values mean card', () => {
    expect(q('[aria-label="Card view"]').getAttribute('aria-pressed')).toBe('true');
    click(q('[aria-label="List view"]'));
    expect(localStorage.getItem('ogs.libraryView')).toBe('"list"');
    expect(host.querySelector('.library-layout-list')).not.toBeNull();
    act(() => root.unmount());
    localStorage.setItem('ogs.libraryView', '"grid"');
    root = createRoot(host);
    mount();
    expect(q('[aria-label="Card view"]').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('Library search', () => {
  const type = (el: HTMLInputElement, v: string) => act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); });
  it('is an icon button that reveals the input; the icon stays active while a query is set; Escape clears and closes', () => {
    expect(host.querySelector('input[aria-label="Search assets"]')).toBeNull();
    const icon = q<HTMLButtonElement>('.pc-bar [aria-label="Search"]');
    expect(icon.textContent).toBe('');
    expect(host.querySelector('.pc-bar')?.firstElementChild?.firstElementChild).toBe(icon);
    click(icon);
    const input = q<HTMLInputElement>('input[aria-label="Search assets"]');
    expect(document.activeElement).toBe(input);
    type(input, 'apple');
    expect(names()).toEqual(['Apple']);
    click(icon); // hide the box: the query stays and the icon shows it
    expect(host.querySelector('input[aria-label="Search assets"]')).toBeNull();
    expect(icon.classList.contains('is-active')).toBe(true);
    expect(names()).toEqual(['Apple']);
    click(icon);
    act(() => { q('input[aria-label="Search assets"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(host.querySelector('input[aria-label="Search assets"]')).toBeNull();
    expect(icon.classList.contains('is-active')).toBe(false);
    expect(names()).toHaveLength(3);
  });
  it('also works in a category view and clears with its button', () => {
    click(q('.pc-rail [aria-label="Character"]'));
    click(q('.pc-bar [aria-label="Search"]'));
    type(q<HTMLInputElement>('input[aria-label="Search saved items"]'), 'zed');
    expect(host.querySelectorAll('.lib-tile')).toHaveLength(1);
    click(q('[aria-label="Clear search"]'));
    expect(host.querySelector('input[aria-label="Search saved items"]')).toBeNull();
    expect(host.querySelectorAll('.lib-tile')).toHaveLength(2);
  });
});

describe('Library side panel', () => {
  it('lists All, Character, Location, Product, Object and Style, and switches to saved items', () => {
    const rail = () => q('.pc-rail');
    expect([...rail().querySelectorAll('button')].map((b) => b.textContent)).toEqual(['All', 'Character', 'Location', 'Product', 'Object', 'Style']);
    click(rail().querySelector('[aria-label="Character"]'));
    expect([...host.querySelectorAll('.lib-tile .pc-info-title')].map((e) => e.textContent)).toEqual(['@Alf', '@Zed']);
    click(q('[aria-label="Sort by name"]'));
    expect([...host.querySelectorAll('.lib-tile .pc-info-title')].map((e) => e.textContent)).toEqual(['@Zed', '@Alf']);
    click(rail().querySelector('[aria-label="Location"]'));
    expect(host.querySelectorAll('.lib-tile')).toHaveLength(1);
    click(rail().querySelector('[aria-label="All"]'));
    expect(names()).toHaveLength(3);
  });

  it('the top bar spans the panel and the rail sits below it, beside the results', () => {
    const check = () => {
      const bar = q('.pc-bar'), split = q('.pc-split'), rail = q('.pc-rail');
      expect(split.contains(bar)).toBe(false);
      expect(split.contains(rail)).toBe(true);
      expect(bar.compareDocumentPosition(rail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(rail.nextElementSibling?.classList.contains('pc-main')).toBe(true);
      expect(q('.pc-main').querySelector('.gallery-scroll')).not.toBeNull();
      expect(rail.contains(bar.querySelector('[aria-label="Sort by name"]'))).toBe(false);
    };
    check();
    expect(q('.pc-main').querySelector('.gallery-count')?.textContent).toContain('results');
    click(q('.pc-rail [aria-label="Character"]'));
    check();
  });

  it('is an icon-only rail with tooltips when the panel is not expanded', () => {
    act(() => setUi({ panelExpanded: false }));
    const items = [...host.querySelectorAll('.pc-rail button')];
    expect(items.every((b) => b.textContent === '' && b.getAttribute('data-tip') && b.getAttribute('aria-label'))).toBe(true);
  });
});

describe('Library cards', () => {
  it('shows no text by default; the overlay has checkbox, favorite, menu and model · params', () => {
    const tile = q('.g-tile');
    expect(tile.querySelector('[role="checkbox"]')).not.toBeNull();
    expect(tile.querySelector('[aria-label="Add to favorites"], [aria-label="Remove from favorites"]')).not.toBeNull();
    expect(tile.querySelector('[aria-label="More actions"]')).not.toBeNull();
    expect(tile.querySelector('.pc-info')?.textContent).toContain('Seedance · 1:1 · 1k');
    expect(tile.querySelector('.pc-info')?.classList.contains('pc-hover')).toBe(true);
    expect(tile.querySelector('.library-item-meta')).toBeNull();
  });

  it('checked and favorite states are marked without hover; checking turns on selection mode', () => {
    const tiles = [...host.querySelectorAll('.g-tile')];
    expect(tiles[0].querySelector('.pc-fav')?.classList.contains('is-on')).toBe(true); // Apple, favorite
    expect(tiles[1].querySelector('.pc-fav')?.classList.contains('is-on')).toBe(false);
    expect(host.querySelector('.gallery-bulk')).toBeNull();
    click(tiles[1].querySelector('[role="checkbox"]'));
    expect(tiles[1].querySelector('[role="checkbox"]')?.classList.contains('is-on')).toBe(true);
    expect(tiles[1].classList.contains('is-selected')).toBe(true);
    expect(tiles[0].classList.contains('is-selecting')).toBe(true);
    expect(q('.gallery-bulk').textContent).toContain('1 selected');
    click(tiles[0].querySelector('.g-open')); // while selecting, a click toggles
    expect(q('.gallery-bulk').textContent).toContain('2 selected');
    expect(useStore.getState().ui.lightbox).toBeNull();
    click(q('[aria-label="Clear selection"]'));
    expect(host.querySelector('.gallery-bulk')).toBeNull();
  });

  it('the star toggles favorite and the menu keeps download, reference, agent context and delete with confirmation', () => {
    const tile = [...host.querySelectorAll('.g-tile')][1]; // Cherry (video)
    click(tile.querySelector('[aria-label="Add to favorites"]'));
    expect(useStore.getState().assets.c.favorite).toBe(true);
    click(tile.querySelector('[aria-label="More actions"]'));
    const items = [...document.querySelectorAll('[role="menuitem"]')].map((e) => e.textContent);
    expect(items).toEqual(expect.arrayContaining(['Download', 'Use as reference', 'Add to the agent context', 'Delete']));
    click([...document.querySelectorAll('[role="menuitem"]')].find((e) => e.textContent === 'Add to the agent context') ?? null);
    expect(useStore.getState().composer.attachments).toEqual(['c']);
    click(tile.querySelector('[aria-label="More actions"]'));
    click([...document.querySelectorAll('[role="menuitem"]')].find((e) => e.textContent === 'Delete') ?? null);
    expect(document.querySelector('.confirm')?.textContent).toContain('Delete this asset?');
    click([...document.querySelectorAll('.confirm button')].find((b) => b.textContent === 'Cancel') ?? null);
    expect(useStore.getState().assets.c).toBeDefined();
  });

  it('a first touch tap shows the overlay and the second opens; a mouse click opens at once', () => {
    const open = q('.g-tile .g-open');
    const pointer = (type: string) => act(() => { const e = new MouseEvent('pointerdown', { bubbles: true }); Object.defineProperty(e, 'pointerType', { value: type }); open.dispatchEvent(e); });
    pointer('touch'); click(open);
    expect(q('.g-tile').classList.contains('is-armed')).toBe(true);
    expect(useStore.getState().ui.lightbox).toBeNull();
    pointer('touch'); click(open);
    expect(useStore.getState().ui.lightbox).not.toBeNull();
    act(() => setUi({ lightbox: null }));
    pointer('mouse'); click(open);
    expect(useStore.getState().ui.lightbox).not.toBeNull();
  });

  it('an asset in the agent context shows its checked, numbered toggle without hover', () => {
    act(() => useStore.setState({ composer: { ...useStore.getState().composer, attachments: ['c', 'a'] } }));
    const tiles = [...host.querySelectorAll('.g-tile')]; // Apple(b), Cherry(c), Mango(a)
    expect(tiles[0].querySelector('.attach-toggle')?.classList.contains('is-on')).toBe(false);
    const on = tiles[1].querySelector('.attach-toggle')!;
    expect(on.classList.contains('is-on')).toBe(true);
    expect(on.getAttribute('aria-checked')).toBe('true');
    expect(on.textContent).toBe('1');
    expect(tiles[2].querySelector('.attach-toggle')?.textContent).toBe('2');
    click(on);
    expect(useStore.getState().composer.attachments).toEqual(['a']);
    click(q('[aria-label="List view"]'));
    expect(host.querySelector('.g-tile.pc-row .attach-toggle.is-on')?.textContent).toBe('1');
  });

  it('overlay controls share one style and the agent-context toggle has its own glyph, distinct from the select box', () => {
    const css = readFileSync('src/components/ui/PanelControls.css', 'utf8');
    expect(css).toMatch(/\.pc-card \.pc-check, \.pc-card \.attach-toggle, \.pc-card \.pc-tools \.icon-btn \{[^}]*width: 30px; height: 30px[^}]*background: var\(--pc-btn-bg\)/);
    const tile = q('.g-tile');
    const attach = tile.querySelector('.attach-toggle')!;
    expect(attach.querySelector('.is-glyph svg')).not.toBeNull(); // off: a paperclip, not a plain box
    expect(tile.querySelector('.pc-check .pc-box')).not.toBeNull();
    expect(tile.querySelector('.pc-check svg')).toBeNull(); // unchecked select box stays plain
    click(attach);
    expect(tile.querySelector('.attach-toggle.is-on')?.textContent).toBe('1');
    expect(tile.querySelector('.attach-toggle.is-on svg')).toBeNull();
  });

  it('list rows keep the actions', () => {
    click(q('[aria-label="List view"]'));
    const row = q('.g-tile.pc-row');
    expect(row.textContent).toContain('Apple');
    expect(row.textContent).toContain('Seedance · 1:1 · 1k');
    expect(row.querySelector('[role="checkbox"]')).not.toBeNull();
    expect(row.querySelector('[aria-label="More actions"]')).not.toBeNull();
    expect(row.querySelector('time')).not.toBeNull();
  });
});
