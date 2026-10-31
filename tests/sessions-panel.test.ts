// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, deleteAssetBlobs: async () => undefined, peekAssetUrl: () => undefined, loadAssetUrl: async () => undefined }));
vi.mock('../src/components/ui/AssetMedia', () => ({ AssetMedia: ({ assetId }: { assetId: string }) => createElement('span', { 'data-asset': assetId }) }));
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SessionsPanel } from '../src/components/shell/SessionsPanel';
import { createSession, useStore } from '../src/store/store';
import { setUserHidden } from '../src/store/userHidden';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });

let host: HTMLDivElement;
let root: Root;
const ids: Record<string, string> = {};
const click = (el: Element | null | undefined) => act(() => (el as HTMLElement).click());
const q = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel)!;
const titles = () => [...host.querySelectorAll('.sess-card .pc-info-title, .sess-row .pc-info-title')].map((e) => e.textContent);
const bar = (label: string) => q(`.pc-bar [aria-label^="${label}"]`);
const radio = (text: string) => [...document.querySelectorAll('[role="radio"]')].find((b) => b.textContent === text) ?? null;
const sw = (label: string) => document.querySelector<HTMLButtonElement>(`[role="switch"][aria-label="${label}"]`)!;
const canvasIs = (name: string) => { click(q('.pc-source')); click([...document.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent?.startsWith(name))); };
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
  it('orders by last activity newest first; the View popover sorts Newest, Oldest, A–Z and Z–A', () => {
    expect(titles()).toEqual(['Bravo', 'Charlie', 'Alpha']);
    click(bar('View'));
    expect(radio('Newest')?.getAttribute('aria-checked')).toBe('true');
    click(radio('A–Z'));
    expect(titles()).toEqual(['Alpha', 'Bravo', 'Charlie']);
    expect(radio('A–Z')?.getAttribute('aria-checked')).toBe('true');
    expect(radio('Newest')?.getAttribute('aria-checked')).toBe('false');
    click(radio('Z–A'));
    expect(titles()).toEqual(['Charlie', 'Bravo', 'Alpha']);
    click(radio('Newest'));
    expect(titles()).toEqual(['Bravo', 'Charlie', 'Alpha']);
    click(radio('Oldest'));
    expect(titles()).toEqual(['Alpha', 'Charlie', 'Bravo']);
  });

  it('the date can mean created instead of last activity, from the View popover', () => {
    click(bar('View'));
    click(radio('Created'));
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

  it('the canvas selector at the start of the bar lists All, Studio, Nodes, Designer with counts; there is no side rail', () => {
    expect(host.querySelector('.pc-rail')).toBeNull();
    expect(q('.pc-split').contains(q('.pc-bar'))).toBe(false);
    expect(q('.pc-source').textContent).toBe('All');
    click(q('.pc-source'));
    expect([...document.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent?.replace(/\d+$/, ''))).toEqual(['All', 'Studio', 'Nodes', 'Designer']);
    click([...document.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent?.startsWith('Nodes')));
    expect(q('.pc-source').textContent).toBe('Nodes');
    expect(titles()).toEqual(['Charlie']);
    canvasIs('All');
    expect(titles()).toHaveLength(3);
  });

  it('View holds Layout, Sort, Date means and Grid size; Filters holds Show hidden, Show archived and Clear filters; Pinned only is a bar pin', () => {
    click(bar('View'));
    const labels = () => [...document.querySelectorAll('.sv-label, .sv-switch > span:first-child')].map((e) => e.textContent?.trim());
    expect(labels()).toEqual(['Layout', 'Sort', 'Date means', 'Grid size']);
    click(bar('Filters'));
    expect([...document.querySelectorAll('[role="dialog"][aria-label="Filters"] .sv-switch > span')].map((e) => e.textContent?.trim())).toEqual(['Show hidden · 0', 'Show archived · 0']);
    expect([...document.querySelectorAll('[role="dialog"][aria-label="Filters"] button')].some((b) => b.textContent === 'Clear filters')).toBe(true);
    const pin = bar('Pinned only');
    expect(pin.getAttribute('aria-pressed')).toBe('false');
  });

  it('Pinned only is a pin in the bar that keeps a chip while on', () => {
    const pin = bar('Pinned only');
    click(pin);
    expect(pin.getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('.sessions-active .active-chip')?.textContent).toContain('Pinned');
    click(pin);
    expect(host.querySelector('.sessions-active')).toBeNull();
  });

  it('Show archived in Filters switches to the archived sessions and shows the count; Clear filters returns', () => {
    click(q('.sess-card [aria-label="Session actions"]'));
    click(item('Archive session'));
    click(bar('Filters'));
    const arch = () => sw('Show archived');
    expect(arch().closest('.sv-switch')?.textContent).toContain('1');
    expect(arch().getAttribute('aria-checked')).toBe('false');
    expect(host.querySelector('.pc-dot')).toBeNull();
    click(arch());
    expect(arch().getAttribute('aria-checked')).toBe('true');
    expect(host.querySelector('.pc-dot')).not.toBeNull();
    expect(titles()).toHaveLength(1);
    click([...document.querySelectorAll('[role="dialog"][aria-label="Filters"] button')].find((b) => b.textContent === 'Clear filters'));
    expect(arch().getAttribute('aria-checked')).toBe('false');
    expect(titles()).toHaveLength(2);
  });

  it('the Filters popover offers to select the empty sessions and closes after using it', () => {
    click(bar('Filters'));
    const act1 = [...document.querySelectorAll('.sv-action')].find((b) => b.textContent?.startsWith('Select the'));
    expect(act1?.textContent).toMatch(/Select the 1 empty session/);
    click(act1);
    expect(host.querySelector('.session-bar')?.textContent).toContain('1 selected');
    expect(document.querySelector('[role="dialog"][aria-label="Filters"]')).toBeNull();
  });

  it('the bar icon buttons share one size class and stroke', () => {
    for (const b of host.querySelectorAll('.pc-bar .icon-btn')) {
      expect(b.classList.contains('icon-btn-sm')).toBe(true);
      expect(b.querySelector('svg')?.getAttribute('stroke-width')).toBe('1.75');
    }
  });

  it('two zones: New and the canvas selector on the left; size, modes, pin, View, Filters, Search and chrome on the right', () => {
    const zones = [...q('.pc-bar').children];
    expect(zones).toHaveLength(2);
    expect(zones[0].querySelector('button')?.textContent).toContain('New');
    expect(zones[0].querySelector('.pc-source')).not.toBeNull();
    expect(zones[1].querySelector('.pc-center [aria-label="Videos"]')).not.toBeNull();
    expect(zones[1].querySelector('input[aria-label="Grid size"]')).toBeNull(); // in View
    const icons = [...zones[1].querySelectorAll('.pc-icons > button, .pc-icons > .pc-pop > button')].map((b) => b.getAttribute('aria-label'));
    expect(icons).toEqual(['Pinned only', 'View', 'Filters', 'Search']);
    expect([...zones[1].querySelectorAll(':scope > .pc-chrome button')].map((b) => b.getAttribute('aria-label'))).toEqual(['Collapse', 'Close']);
    expect(host.querySelector('.sessions-toolbar')).toBeNull(); // one chrome row
  });

  it('list and card views are remembered; old values mean card', () => {
    click(bar('View'));
    click(radio('List'));
    expect(localStorage.getItem('ogs.sessionsView')).toBe('"list"');
    expect(host.querySelectorAll('.sess-row')).toHaveLength(3);
    act(() => root.unmount());
    localStorage.setItem('ogs.sessionsView', '"cards"');
    root = createRoot(host);
    act(() => root.render(createElement(SessionsPanel)));
    click(bar('View'));
    expect(radio('Grid')?.getAttribute('aria-checked')).toBe('true');
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
    expect([...document.querySelectorAll('[role="menuitem"]')].map((e) => e.textContent)).toEqual(['Rename', 'Archive session', 'Hide', 'Delete']);
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
    click(bar('View'));
    click(radio('List'));
    dbl(q('.sess-row .session-main'));
    expect(host.querySelector('input[aria-label="Session title"]')).not.toBeNull();
    // while selecting, double-click does not rename
    act(() => root.unmount()); root = createRoot(host);
    act(() => root.render(createElement(SessionsPanel)));
    click(q('.sess-row [role="checkbox"]'));
    dbl(q('.sess-row .session-main'));
    expect(host.querySelector('input[aria-label="Session title"]')).toBeNull();
  });

  it('Hide removes a session from the panel; the eye shows it dimmed with a badge; Unhide restores it', () => {
    click(card('Alpha').querySelector('[aria-label="Session actions"]'));
    click(item('Hide'));
    expect(useStore.getState().sessions[ids.Alpha].userHidden).toBe(true);
    expect(useStore.getState().sessions[ids.Alpha].hidden).toBeUndefined(); // not the Space-container flag
    expect(titles()).toEqual(['Bravo', 'Charlie']);
    click(bar('Filters'));
    const eye = sw('Show hidden');
    expect(eye.getAttribute('aria-checked')).toBe('false');
    expect(eye.closest('.sv-switch')?.textContent).toContain('1');
    click(eye);
    expect(eye.getAttribute('aria-checked')).toBe('true');
    expect(titles()).toHaveLength(3);
    expect(card('Alpha').classList.contains('is-hidden-item')).toBe(true);
    expect(card('Alpha').querySelector('.pc-hidden-badge')).not.toBeNull();
    expect(card('Bravo').querySelector('.pc-hidden-badge')).toBeNull();
    click(card('Alpha').querySelector('[aria-label="Session actions"]'));
    click(item('Unhide'));
    expect(useStore.getState().sessions[ids.Alpha].userHidden).toBeUndefined();
    expect(card('Alpha').classList.contains('is-hidden-item')).toBe(false);
  });

  it('the selection bar hides and unhides the selected sessions; Space containers are never touched', () => {
    const space = createSession('Space container'); space.hidden = true;
    act(() => useStore.setState((st) => ({ sessions: { ...st.sessions, [space.id]: space } })));
    click(card('Charlie').querySelector('[role="checkbox"]'));
    click(card('Alpha').querySelector('[role="checkbox"]'));
    click(q('.session-bar [aria-label="Hide"]'));
    expect(titles()).toEqual(['Bravo']);
    act(() => setUserHidden('session', [space.id], true));
    expect(useStore.getState().sessions[space.id].userHidden).toBeUndefined();
    click(bar('Filters'));
    click(sw('Show hidden'));
    click(card('Charlie').querySelector('[role="checkbox"]'));
    expect(q('.session-bar [aria-label="Unhide"]')).not.toBeNull();
    click(q('.session-bar [aria-label="Unhide"]'));
    expect(useStore.getState().sessions[ids.Charlie].userHidden).toBeUndefined();
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
