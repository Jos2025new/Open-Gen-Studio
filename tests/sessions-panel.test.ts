// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, deleteAssetBlobs: async () => undefined, peekAssetUrl: () => undefined, loadAssetUrl: async () => undefined }));
vi.mock('../src/components/ui/AssetMedia', () => ({ AssetMedia: ({ assetId }: { assetId: string }) => createElement('span', { 'data-asset': assetId }) }));
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SessionsPanel } from '../src/components/shell/SessionsPanel';
import { createSession, useStore } from '../src/store/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });

let host: HTMLDivElement;
let root: Root;
const ids: Record<string, string> = {};
const click = (el: Element | null | undefined) => act(() => (el as HTMLElement).click());
const q = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel)!;
const titles = () => [...host.querySelectorAll('.sess-card .pc-info-title, .sess-row .pc-info-title')].map((e) => e.textContent);
const item = (text: string) => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((e) => e.textContent === text);

beforeEach(() => {
  localStorage.clear();
  const mk = (title: string, created: number, updated: number) => { const s = createSession(title); s.createdAt = created; s.updatedAt = updated; ids[title] = s.id; return s; };
  const bravo = mk('Bravo', 100, 300), alpha = mk('Alpha', 300, 100), charlie = mk('Charlie', 200, 200);
  bravo.feed.push({ id: 'p', type: 'user', text: 'x', mode: 'video', workspace: 'chat', createdAt: 5, attachments: [] });
  charlie.graph.nodes.push({ id: 'n' } as never);
  const state = useStore.getState();
  useStore.setState({ sessions: { [bravo.id]: bravo, [alpha.id]: alpha, [charlie.id]: charlie }, activeSessionId: bravo.id, assets: {}, generations: {}, ui: { ...state.ui, panelExpanded: true } });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  act(() => root.render(createElement(SessionsPanel)));
});
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ''; });

describe('Sessions top bar', () => {
  it('orders by last activity newest first; name and date toggles flip and exclude each other', () => {
    expect(titles()).toEqual(['Bravo', 'Charlie', 'Alpha']);
    const name = q('[aria-label="Sort by name"]'), date = q('[aria-label="Sort by date"]');
    click(name);
    expect(titles()).toEqual(['Alpha', 'Bravo', 'Charlie']);
    expect(name.getAttribute('aria-pressed')).toBe('true');
    expect(date.getAttribute('aria-pressed')).toBe('false');
    click(name);
    expect(titles()).toEqual(['Charlie', 'Bravo', 'Alpha']);
    click(date);
    expect(titles()).toEqual(['Bravo', 'Charlie', 'Alpha']);
    click(date);
    expect(titles()).toEqual(['Alpha', 'Charlie', 'Bravo']);
  });

  it('the date can mean created instead of last activity, from the Filter by menu', () => {
    click(q('[aria-label="Filter by"]'));
    click([...document.querySelectorAll<HTMLElement>('button')].find((b) => b.textContent === 'Created'));
    expect(titles()).toEqual(['Alpha', 'Charlie', 'Bravo']);
  });

  it('filters by mode with icon buttons and All', () => {
    for (const l of ['Agent', 'Images', 'Videos', 'Audio', '3D']) expect(q(`[aria-label="${l}"]`).textContent).toBe('');
    click(q('[aria-label="Videos"]'));
    expect(titles()).toEqual(['Bravo']);
    click([...host.querySelectorAll('.pc-center button')].find((b) => b.textContent === 'All'));
    expect(titles()).toHaveLength(3);
  });

  it('search is an icon button that filters by title and stays marked while a query is set', () => {
    const icon = q<HTMLButtonElement>('.pc-bar [aria-label="Search"]');
    expect(host.querySelector('input[aria-label="Search sessions"]')).toBeNull();
    click(icon);
    const input = q<HTMLInputElement>('input[aria-label="Search sessions"]');
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'alp'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(titles()).toEqual(['Alpha']);
    click(icon);
    expect(icon.classList.contains('is-active')).toBe(true);
    click(icon);
    click(q('[aria-label="Clear search"]'));
    expect(icon.classList.contains('is-active')).toBe(false);
    expect(titles()).toHaveLength(3);
  });

  it('the canvas filter is a rail below the bar (All, Studio, Nodes, Designer), not a Filter by row', () => {
    const rail = q('.pc-rail');
    expect([...rail.querySelectorAll('button')].map((b) => b.textContent?.replace(/\d+$/, ''))).toEqual(['All', 'Studio', 'Nodes', 'Designer']);
    expect(q('.pc-split').contains(q('.pc-bar'))).toBe(false);
    expect(q('.pc-bar').compareDocumentPosition(rail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    click(rail.querySelector('[aria-label="Nodes"]'));
    expect(titles()).toEqual(['Charlie']);
    click(q('[aria-label="Filter by"]'));
    const labels = [...document.querySelectorAll('.sv-label, .sv-switch > span:first-child')].map((e) => e.textContent);
    expect(labels).toEqual(['Date means', 'Pinned only']);
  });

  it('archived is an icon toggle at the end of the right zone, next to the eye; the Filter by menu has no Active/Archived row', () => {
    const zone = q('.pc-bar .pc-right');
    const btns = [...zone.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'));
    expect(btns[btns.length - 1]).toBe('Show archived');
    expect(btns).toContain('Hide thumbnails');
    const arch = q<HTMLButtonElement>('[aria-label="Show archived"]');
    expect(arch.getAttribute('aria-pressed')).toBe('false');
    expect(arch.getAttribute('data-tip')).toContain('0');
    click(q('.sess-card [aria-label="Session actions"]'));
    click(item('Archive session'));
    expect(arch.getAttribute('data-tip')).toContain('1');
    click(arch);
    expect(arch.getAttribute('aria-pressed')).toBe('true');
    expect(titles()).toHaveLength(1);
    click(arch);
    expect(titles()).toHaveLength(2);
  });

  it('three zones: left (search, filter, sorts, archived), centered modes, right (size, view, thumbnails)', () => {
    const zones = [...q('.pc-bar').children];
    expect(zones).toHaveLength(3);
    expect(zones[1].classList.contains('pc-center')).toBe(true);
    expect(zones[1].querySelector('[aria-label="Videos"]')).not.toBeNull();
    for (const l of ['Grid size', 'List view', 'Hide thumbnails']) expect(zones[2].querySelector(`[aria-label="${l}"]`)).not.toBeNull();
  });

  it('list and card views are remembered; old values mean card', () => {
    click(q('[aria-label="List view"]'));
    expect(localStorage.getItem('ogs.sessionsView')).toBe('"list"');
    expect(host.querySelectorAll('.sess-row')).toHaveLength(3);
    act(() => root.unmount());
    localStorage.setItem('ogs.sessionsView', '"cards"');
    root = createRoot(host);
    act(() => root.render(createElement(SessionsPanel)));
    expect(q('[aria-label="Card view"]').getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelectorAll('.sess-card')).toHaveLength(3);
  });
});

describe('Sessions cards', () => {
  const card = (title: string) => [...host.querySelectorAll('.sess-card')].find((c) => c.textContent?.includes(title))!;

  it('overlay has checkbox, pin and menu; details show mode and date', () => {
    const c = card('Bravo');
    expect(c.querySelector('[role="checkbox"]')).not.toBeNull();
    expect(c.querySelector('[aria-label="Pin"]')).not.toBeNull();
    expect(c.querySelector('[aria-label="Session actions"]')).not.toBeNull();
    expect(c.querySelector('.pc-info')?.classList.contains('pc-hover')).toBe(true);
    expect(c.querySelector('.pc-info')?.textContent).toMatch(/Video · /);
    expect(c.querySelector('.session-cover-icon')).not.toBeNull(); // no cover: the canvas icon
  });

  it('active, pinned and selected states are visible without hover', () => {
    expect(card('Bravo').classList.contains('is-active')).toBe(true);
    expect(card('Bravo').querySelector('.sess-open')).not.toBeNull();
    click(card('Alpha').querySelector('[aria-label="Pin"]'));
    expect(useStore.getState().sessions[ids.Alpha].pinned).toBe(true);
    expect(card('Alpha').querySelector('.pc-fav')?.classList.contains('is-on')).toBe(true);
    click(card('Charlie').querySelector('[role="checkbox"]'));
    expect(card('Charlie').classList.contains('is-selected')).toBe(true);
    expect(card('Charlie').querySelector('[role="checkbox"]')?.classList.contains('is-on')).toBe(true);
    expect(card('Bravo').classList.contains('is-selecting')).toBe(true);
    expect(q('.session-bar').textContent).toContain('1 selected');
  });

  it('the menu renames, archives and deletes with a contextual confirmation', () => {
    click(card('Alpha').querySelector('[aria-label="Session actions"]'));
    expect([...document.querySelectorAll('[role="menuitem"]')].map((e) => e.textContent)).toEqual(['Rename', 'Archive session', 'Delete']);
    click(item('Archive session'));
    expect(useStore.getState().sessions[ids.Alpha].archived).toBe(true);
    click(card('Charlie').querySelector('[aria-label="Session actions"]'));
    click(item('Delete'));
    expect(document.querySelector('.confirm')?.textContent).toContain('Delete “Charlie”');
    click([...document.querySelectorAll('.confirm button')].find((b) => b.textContent === 'Cancel'));
    expect(useStore.getState().sessions[ids.Charlie]).toBeDefined();
    click(item('Delete'));
    click([...document.querySelectorAll('.confirm button')].find((b) => b.textContent === 'Delete'));
    expect(useStore.getState().sessions[ids.Charlie]).toBeUndefined();
  });

  it('double-clicking a card or row starts renaming; Enter saves', () => {
    const dbl = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
    dbl(card('Alpha').querySelector('.session-main')!);
    const input = q<HTMLInputElement>('input[aria-label="Session title"]');
    expect(input).not.toBeNull();
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Alpha 2');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => input.blur());
    expect(useStore.getState().sessions[ids.Alpha].title).toBe('Alpha 2');
    click(q('[aria-label="List view"]'));
    dbl(q('.sess-row .session-main'));
    expect(host.querySelector('input[aria-label="Session title"]')).not.toBeNull();
    // while selecting, double-click does not rename
    act(() => root.unmount()); root = createRoot(host);
    act(() => root.render(createElement(SessionsPanel)));
    click(q('.sess-row [role="checkbox"]'));
    dbl(q('.sess-row .session-main'));
    expect(host.querySelector('input[aria-label="Session title"]')).toBeNull();
  });

  it('a touch tap reveals the overlay first and opens on the second tap; a mouse click opens', () => {
    const open = card('Charlie').querySelector<HTMLElement>('.session-main')!;
    const pointer = (type: string) => act(() => { const e = new MouseEvent('pointerdown', { bubbles: true }); Object.defineProperty(e, 'pointerType', { value: type }); open.dispatchEvent(e); });
    pointer('touch'); click(open);
    expect(card('Charlie').classList.contains('is-armed')).toBe(true);
    expect(useStore.getState().activeSessionId).toBe(ids.Bravo);
    pointer('touch'); click(open);
    expect(useStore.getState().activeSessionId).toBe(ids.Charlie);
    const other = card('Alpha').querySelector<HTMLElement>('.session-main')!;
    act(() => { const e = new MouseEvent('pointerdown', { bubbles: true }); Object.defineProperty(e, 'pointerType', { value: 'mouse' }); other.dispatchEvent(e); });
    click(other);
    expect(useStore.getState().activeSessionId).toBe(ids.Alpha);
  });
});
