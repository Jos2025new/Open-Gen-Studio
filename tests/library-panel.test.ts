// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async () => undefined, peekAssetUrl: () => undefined, loadAssetUrl: async () => undefined }));
vi.mock('../src/components/ui/AssetMedia', () => ({ AssetMedia: ({ assetId }: { assetId: string }) => createElement('span', { 'data-asset': assetId }) }));
import { readFileSync } from 'node:fs';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { GalleryPanel } from '../src/components/gallery/GalleryPanel';
import { setUi, useStore } from '../src/store/store';
import { createSession } from '../src/store/store';
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
const bar = (label: string) => q(`.pc-bar [aria-label^="${label}"]`);
const radio = (text: string) => [...document.querySelectorAll('[role="radio"]')].find((b) => b.textContent === text) ?? null;
const source = (name: string) => { click(q('.pc-source')); click([...document.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent?.startsWith(name)) ?? null); };
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
  it('sorts from the View popover: Newest, Oldest, A–Z and Z–A over the same order', () => {
    expect(names()).toEqual(['Apple', 'Cherry', 'Mango']);
    click(bar('View'));
    expect(document.querySelector('[role="dialog"][aria-label="View"] .pop-title')?.textContent).toBe('View');
    expect(radio('Newest')?.getAttribute('aria-checked')).toBe('true');
    click(radio('A–Z'));
    expect(names()).toEqual(['Apple', 'Cherry', 'Mango']);
    expect(radio('A–Z')?.getAttribute('aria-checked')).toBe('true');
    click(radio('Z–A'));
    expect(names()).toEqual(['Mango', 'Cherry', 'Apple']);
    click(radio('Oldest'));
    expect(names()).toEqual(['Mango', 'Cherry', 'Apple']);
    click(radio('Newest'));
    expect(names()).toEqual(['Apple', 'Cherry', 'Mango']);
    expect(radio('A–Z')?.getAttribute('aria-checked')).toBe('false');
  });

  it('has two zones: the source selector and Sessions pill on the left; size, types, favorites, View, Filters, Search and chrome on the right', () => {
    const kids = [...q('.pc-bar').children];
    expect(kids).toHaveLength(2);
    expect(kids[0].classList.contains('pc-left')).toBe(true);
    const left = [...kids[0].querySelectorAll('button')].map((b) => b.getAttribute('aria-label') ?? b.textContent);
    expect(left).toEqual(['Library source: All', 'Sessions']);
    expect(kids[0].querySelector('.pc-source')?.getAttribute('aria-haspopup')).toBe('menu');
    expect(kids[1].querySelector('.pc-center [aria-label="Images"]')).not.toBeNull();
    expect(kids[1].querySelector('input[aria-label="Grid size"]')).not.toBeNull();
    const icons = [...kids[1].querySelectorAll('.pc-icons > button, .pc-icons > .pc-pop > button')].map((b) => b.getAttribute('aria-label'));
    expect(icons).toEqual(['Favorites only', 'View', 'Filters', 'Search']);
    expect(bar('View').getAttribute('aria-haspopup')).toBe('dialog');
    expect(bar('View').getAttribute('aria-expanded')).toBe('false');
    expect(kids[1].querySelector('.pc-icons')?.nextElementSibling?.classList.contains('pc-chrome')).toBe(true); // collapse and close end the bar
    expect(readFileSync('src/components/ui/PanelControls.css', 'utf8')).toMatch(/@container pc-panel \(max-width: 640px\)/);
  });

  it('the bar spans the full width of the controls even when the panel is expanded', () => {
    const css = readFileSync('src/components/gallery/GalleryLayout.css', 'utf8');
    expect(css).toMatch(/\.side-panel\.is-expanded \.generated-controls \{ flex-direction: column;[^}]*align-items: stretch/);
    expect(css).toMatch(/\.generated-controls > \.pc-bar \{ width: 100%/);
    expect(q('.generated-controls').firstElementChild?.classList.contains('pc-bar')).toBe(true);
    source('Character');
    expect(q('.generated-controls').firstElementChild?.classList.contains('pc-bar')).toBe(true);
  });

  it('the Sessions pill replaces the scope and Group by: unpressed groups by date, pressed by session with titled, selectable headers', () => {
    const pill = () => [...q('.pc-bar').querySelectorAll('button')].find((b) => b.textContent === 'Sessions')!;
    expect(pill().getAttribute('aria-pressed')).toBe('false');
    const other = createSession('Other');
    act(() => useStore.setState((st) => ({ sessions: { ...st.sessions, [other.id]: other }, assets: { ...st.assets, z: asset('z', { sessionId: other.id, createdAt: 5, generationId: 'g-z' }) }, generations: { ...st.generations, 'g-z': gen('g-z', 'Zed', { sessionId: other.id }) } })));
    expect(names()).toContain('Zed'); // every session is covered
    expect([...host.querySelectorAll('.date-head')].map((h) => h.textContent)).not.toContain('Other 1');
    click(pill());
    expect(pill().getAttribute('aria-pressed')).toBe('true');
    const heads = [...host.querySelectorAll('.date-head')];
    expect(heads.map((h) => h.textContent)).toContain('Other 1');
    const group = heads.find((h) => h.textContent === 'Other 1')!;
    click(group.querySelector('[role="checkbox"]'));
    expect(q('.gallery-bulk').textContent).toContain('1 selected');
    click(pill());
    expect(pill().getAttribute('aria-pressed')).toBe('false');
    expect([...host.querySelectorAll('.date-head')].map((h) => h.textContent)).not.toContain('Other 1');
    click(bar('Filters'));
    expect([...document.querySelectorAll('.sv-label')].map((e) => e.textContent?.trim())).not.toEqual(expect.arrayContaining(['Show']));
    expect(document.body.textContent).not.toContain('Group by');
    expect(document.body.textContent).not.toContain('This session');
  });

  it('card view lays tiles out in justified rows that keep each asset ratio', () => {
    act(() => useStore.setState((st) => ({ assets: { ...st.assets, a: { ...st.assets.a, width: 200, height: 100 }, b: { ...st.assets.b, width: 100, height: 200 } } })));
    const cells = [...host.querySelectorAll<HTMLElement>('.jg-cell')];
    expect(cells).toHaveLength(3);
    const ratio = (c: HTMLElement) => parseFloat(c.style.width) / parseFloat(c.style.height);
    const byName = Object.fromEntries(cells.map((c) => [c.querySelector('.g-open')?.getAttribute('title'), c]));
    expect(ratio(byName.Mango)).toBeCloseTo(2, 3);
    expect(ratio(byName.Apple)).toBeCloseTo(0.5, 3);
    click(bar('View'));
    click(radio('List'));
    expect(host.querySelector('.jg-cell')).toBeNull();
  });

  it('every icon button of the bar is the same size class and stroke, and one CSS rule sets the 18px glyph', () => {
    const buttons = [...host.querySelectorAll('.pc-bar .icon-btn')];
    expect(buttons.length).toBeGreaterThan(9);
    for (const b of buttons) {
      expect(b.classList.contains('icon-btn-sm')).toBe(true);
      expect(b.querySelector('svg')?.getAttribute('stroke-width')).toBe('1.75');
    }
    const css = readFileSync('src/components/ui/PanelControls.css', 'utf8');
    expect(css).toMatch(/\.pc-bar \.icon-btn svg, \.pc-bar \.results-menu-trigger svg \{[^}]*width: 18px; height: 18px; stroke-width: 1\.75/);
    expect(css).toMatch(/\.pc-bar \.results-menu-trigger svg:not\(:first-child\) \{ display: none; \}/);
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

  it('Filters holds Canvas, Place, Mode, Show hidden and Show archived; Favorites only is a star in the bar', () => {
    const star = bar('Favorites only');
    expect(star.getAttribute('aria-pressed')).toBe('false');
    click(star);
    expect(names()).toEqual(['Apple']);
    expect(star.getAttribute('aria-pressed')).toBe('true');
    click(star);
    click(bar('Filters'));
    const labels = [...document.querySelectorAll('.sv-row .sv-label, .sv-switch > span')].map((e) => e.textContent?.trim());
    for (const l of ['Canvas', 'Place', 'Mode', 'Show hidden · 0', 'Show archived · 0']) expect(labels).toContain(l);
    expect(labels).not.toContain('Favorites only');
    expect(bar('Filters').getAttribute('aria-label')).toBe('Filters');
  });

  it('Filters shows an active dot and Clear filters resets it', () => {
    click(bar('Filters'));
    const pop = () => document.querySelector('[role="dialog"][aria-label="Filters"]')!;
    expect(host.querySelector('.pc-dot')).toBeNull();
    click(pop().querySelector('[role="switch"][aria-label="Show hidden"]'));
    expect(host.querySelector('.pc-dot')).not.toBeNull();
    expect(bar('Filters').getAttribute('aria-label')).toBe('Filters (active)');
    click([...pop().querySelectorAll('button')].find((b) => b.textContent === 'Clear filters') ?? null);
    expect(host.querySelector('.pc-dot')).toBeNull();
    expect(pop().querySelector('[role="switch"][aria-label="Show hidden"]')?.getAttribute('aria-checked')).toBe('false');
  });

  it('Show hidden and Show archived in Filters include hidden assets and those of archived sessions', () => {
    const other = createSession('Old'); other.archived = true;
    act(() => useStore.setState((st) => ({ sessions: { ...st.sessions, [other.id]: other }, assets: { ...st.assets, h: asset('h', { userHidden: true, createdAt: 2 }), z: asset('z', { sessionId: other.id, createdAt: 3, generationId: 'g-z' }) }, generations: { ...st.generations, 'g-z': gen('g-z', 'Zed', { sessionId: other.id }) } })));
    expect(names()).toHaveLength(3);
    click(bar('Filters'));
    const pop = () => document.querySelector('[role="dialog"][aria-label="Filters"]')!;
    click(pop().querySelector('[role="switch"][aria-label="Show hidden"]'));
    expect(names()).toHaveLength(4);
    click(pop().querySelector('[role="switch"][aria-label="Show archived"]'));
    expect(names()).toHaveLength(5);
  });

  it('remembers list or card view, and old stored values mean card', () => {
    click(bar('View'));
    expect(radio('Grid')?.getAttribute('aria-checked')).toBe('true');
    click(radio('List'));
    expect(localStorage.getItem('ogs.libraryView')).toBe('"list"');
    expect(host.querySelector('.library-layout-list')).not.toBeNull();
    act(() => root.unmount());
    localStorage.setItem('ogs.libraryView', '"grid"');
    root = createRoot(host);
    mount();
    click(bar('View'));
    expect(radio('Grid')?.getAttribute('aria-checked')).toBe('true');
  });
});

describe('Library search', () => {
  const type = (el: HTMLInputElement, v: string) => act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); });
  it('is an icon button that reveals the input; the icon stays active while a query is set; Escape clears and closes', () => {
    expect(host.querySelector('input[aria-label="Search assets"]')).toBeNull();
    const icon = q<HTMLButtonElement>('.pc-bar [aria-label="Search"]');
    expect(icon.textContent).toBe('');
    expect(host.querySelector('.pc-bar .pc-icons')?.lastElementChild).toBe(icon);
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
    source('Character');
    click(q('.pc-bar [aria-label="Search"]'));
    type(q<HTMLInputElement>('input[aria-label="Search saved items"]'), 'zed');
    expect(host.querySelectorAll('.lib-tile')).toHaveLength(1);
    click(q('[aria-label="Clear search"]'));
    expect(host.querySelector('input[aria-label="Search saved items"]')).toBeNull();
    expect(host.querySelectorAll('.lib-tile')).toHaveLength(2);
  });
});

describe('Library source selector', () => {
  it('lists All, Character, Location, Product, Object and Style with counts, and switches to saved items', () => {
    click(q('.pc-source'));
    const items = [...document.querySelectorAll('[role="menuitem"]')];
    expect(items.map((b) => b.textContent)).toEqual(['All', 'Character2', 'Location1', 'Product0', 'Object0', 'Style0']);
    expect(document.querySelector('.pc-menu-sep')).not.toBeNull();
    expect(items[0].getAttribute('aria-current')).toBe('true');
    click(items[1]);
    expect(q('.pc-source').textContent).toBe('Character');
    expect([...host.querySelectorAll('.lib-tile .pc-info-title')].map((e) => e.textContent)).toEqual(['@Alf', '@Zed']);
    click(bar('View'));
    const sortRow = [...document.querySelectorAll('.sv-row')].find((r) => r.querySelector('.sv-label')?.textContent === 'Sort')!;
    expect([...sortRow.querySelectorAll('[role="radio"]')].map((b) => b.textContent)).toEqual(['A–Z', 'Z–A']); // categories sort by name only
    click(radio('Z–A'));
    expect([...host.querySelectorAll('.lib-tile .pc-info-title')].map((e) => e.textContent)).toEqual(['@Zed', '@Alf']);
    source('Location');
    expect(host.querySelectorAll('.lib-tile')).toHaveLength(1);
    source('All');
    expect(names()).toHaveLength(3);
  });

  it('a category keeps only View, Filters (Show hidden) and Search; All-only controls disappear', () => {
    source('Character');
    expect(host.querySelector('.pc-center')).toBeNull();
    expect(host.querySelector('[aria-label="Favorites only"]')).toBeNull();
    expect([...host.querySelectorAll('.pc-bar button')].some((b) => b.textContent === 'Sessions')).toBe(false);
    click(bar('Filters'));
    expect([...document.querySelectorAll('.sv-switch > span')].map((e) => e.textContent?.trim())).toEqual(['Show hidden · 0']);
    click(document.querySelector('[role="switch"][aria-label="Show hidden"]'));
    expect(bar('Filters').getAttribute('aria-label')).toBe('Filters (active)');
  });

  it('there is no side rail: the bar spans the panel and the results follow it', () => {
    expect(host.querySelector('.pc-rail')).toBeNull();
    expect(q('.pc-split').contains(q('.pc-bar'))).toBe(false);
    expect(q('.pc-main').querySelector('.gallery-scroll')).not.toBeNull();
    expect(host.querySelector('.gallery-count')).toBeNull(); // no standalone results line
    expect(q('.pc-bar [aria-label="Search"]').getAttribute('data-tip')).toContain('3 results');
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
    click(bar('View'));
    click(radio('List'));
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

  it('Hide removes an asset from the views, the eye shows it dimmed with a badge, and the bulk bar hides and unhides', () => {
    const tile = [...host.querySelectorAll('.g-tile')][1]; // Cherry
    click(tile.querySelector('[aria-label="More actions"]'));
    click([...document.querySelectorAll('[role="menuitem"]')].find((e) => e.textContent === 'Hide') ?? null);
    expect(useStore.getState().assets.c.userHidden).toBe(true);
    expect(useStore.getState().assets.c).toBeDefined(); // hidden is not deleted
    expect(names()).toEqual(['Apple', 'Mango']);
    click(bar('Filters'));
    const eye = () => document.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Show hidden"]')!;
    expect(eye().closest('.sv-switch')?.textContent).toContain('1');
    expect(eye().getAttribute('aria-checked')).toBe('false');
    click(eye());
    expect(eye().getAttribute('aria-checked')).toBe('true');
    expect(names()).toHaveLength(3);
    const dim = host.querySelector('.is-hidden-item')!;
    expect(dim.querySelector('.pc-hidden-badge')).not.toBeNull();
    click(dim.querySelector('[role="checkbox"]'));
    click(q('.gallery-bulk [aria-label="Unhide"]'));
    expect(useStore.getState().assets.c.userHidden).toBeUndefined();
    click([...host.querySelectorAll('.g-tile [role="checkbox"]')][0]);
    click(q('.gallery-bulk [aria-label="Hide"]'));
    expect(useStore.getState().assets.b.userHidden).toBe(true);
  });

  it('saved items can be hidden too, with the same eye', () => {
    source('Character');
    click(q('.lib-tile [aria-label^="More actions"]'));
    click([...document.querySelectorAll('[role="menuitem"]')].find((e) => e.textContent === 'Hide') ?? null);
    expect(host.querySelectorAll('.lib-tile')).toHaveLength(1);
    click(bar('Filters'));
    click(document.querySelector('[role="switch"][aria-label="Show hidden"]'));
    expect(host.querySelectorAll('.lib-tile')).toHaveLength(2);
    expect(host.querySelector('.lib-tile.is-hidden-item .pc-hidden-badge')).not.toBeNull();
  });

  it('items of archived sessions are left out until Show archived is on', () => {
    const old = createSession('Old'); old.archived = true;
    act(() => useStore.setState((st) => ({ sessions: { ...st.sessions, [old.id]: old }, assets: { ...st.assets, z: asset('z', { sessionId: old.id, createdAt: 99, generationId: 'g-z' }) }, generations: { ...st.generations, 'g-z': gen('g-z', 'Zebra', { sessionId: old.id }) } })));
    expect(names()).not.toContain('Zebra');
    click(bar('Filters'));
    const arch = document.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Show archived"]')!;
    expect(arch.closest('.sv-switch')?.textContent).toContain('1');
    expect(arch.getAttribute('aria-checked')).toBe('false');
    click(arch);
    expect(arch.getAttribute('aria-checked')).toBe('true');
    expect(names()).toContain('Zebra');
    const btns = [...q('.pc-right').querySelectorAll(':scope > .pc-chrome button')].map((b) => b.getAttribute('aria-label'));
    expect(btns).toEqual(['Collapse', 'Close']); // close/collapse end the bar
  });

  it('list rows keep the actions', () => {
    click(bar('View'));
    click(radio('List'));
    const row = q('.g-tile.pc-row');
    expect(row.textContent).toContain('Apple');
    expect(row.textContent).toContain('Seedance · 1:1 · 1k');
    expect(row.querySelector('[role="checkbox"]')).not.toBeNull();
    expect(row.querySelector('[aria-label="More actions"]')).not.toBeNull();
    expect(row.querySelector('time')).not.toBeNull();
  });
});

describe('Library list columns', () => {
  const rows = () => [...host.querySelectorAll('.library-layout-list .pc-info-title')].map((t) => t.textContent);
  const head = (label: string) => q(`.pc-list-head [aria-label^="Sort by ${label}"]`);
  const toList = () => { click(bar('View')); click(radio('List')); };

  it('shows model and parameters in their own columns', () => {
    toList();
    const cherry = [...host.querySelectorAll('.library-layout-list .pc-row')].find((r) => r.textContent?.includes('Cherry'))!;
    expect([...cherry.querySelectorAll('.pc-col')].map((c) => c.textContent)).toEqual(['Seedance', '16:9', '720p', '5s']);
    expect(cherry.querySelector('.pc-info-sub')?.classList.contains('pc-cols-alt')).toBe(true); // shown only when the narrow panel hides the columns
  });

  it('sorts from the header, flips on a second press and keeps empty values last', () => {
    toList();
    click(head('Duration'));
    expect(rows()[0]).toBe('Cherry');
    expect(head('Duration').getAttribute('aria-pressed')).toBe('true');
    click(head('Duration'));
    expect(rows()[0]).toBe('Cherry'); // only Cherry has a duration: it stays first either way
    click(head('Aspect'));
    expect(rows()[2]).toBe('Cherry');
    click(head('Aspect'));
    expect(rows()[0]).toBe('Cherry');
    // The View popover is still open from switching to List.
    expect(['Newest', 'Oldest', 'A–Z', 'Z–A'].map((t) => radio(t)?.getAttribute('aria-checked'))).toEqual(['false', 'false', 'false', 'false']);
    click(radio('A–Z'));
    expect(rows()).toEqual(['Apple', 'Cherry', 'Mango']);
    expect(head('Name').getAttribute('aria-pressed')).toBe('true');
  });
  it('resizes a column from its header edge with the keyboard and restores it on double-click', () => {
    toList();
    const handle = q('[role="separator"][aria-label="Resize Model column"]');
    const scroll = q<HTMLElement>('.gallery-scroll');
    act(() => { handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); });
    const w = JSON.parse(localStorage.getItem('ogs.libraryColumns') ?? '{}').model;
    expect(w).toBeGreaterThanOrEqual(44);
    expect(scroll.style.getPropertyValue('--pc-w-model')).toBe(`${w}px`);
    act(() => { handle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
    expect(JSON.parse(localStorage.getItem('ogs.libraryColumns') ?? '{}').model).toBeUndefined();
    expect(scroll.style.getPropertyValue('--pc-w-model')).toBe('');
  });
  it('sorts the card grid from the same labels', () => {
    click(q('.pc-sort-strip [aria-label^="Sort by Name"]'));
    expect(names()).toEqual(['Apple', 'Cherry', 'Mango']);
    click(q('.pc-sort-strip [aria-label^="Sort by Name"]'));
    expect(names()).toEqual(['Mango', 'Cherry', 'Apple']);
    expect(host.querySelector('.pc-sort-strip .pc-col-resize')).toBeNull();
  });
});
