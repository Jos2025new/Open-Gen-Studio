// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

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
const head = (label: string) => q(`[aria-label^="Sort by ${label}"]`);
const row = (title: string) => [...host.querySelectorAll<HTMLElement>('.sess-row')].find((r) => r.querySelector('.pc-info-title')?.textContent === title)!;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('ogs.sessionsView', '"list"');
  const mk = (title: string, updated: number) => { const s = createSession(title); s.createdAt = updated; s.updatedAt = updated; ids[title] = s.id; return s; };
  const alpha = mk('Alpha', 100), bravo = mk('Bravo', 300), charlie = mk('Charlie', 200);
  charlie.graph.nodes.push({ id: 'n1' } as never, { id: 'n2' } as never);
  alpha.graph.nodes.push({ id: 'n3' } as never);
  const state = useStore.getState();
  useStore.setState({ sessions: { [alpha.id]: alpha, [bravo.id]: bravo, [charlie.id]: charlie }, activeSessionId: bravo.id, assets: {}, generations: {}, ui: { ...state.ui, panelExpanded: true } });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  act(() => root.render(createElement(SessionsPanel)));
});
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ''; });

it('the list header names the columns, each row fills them, and the end of the row holds Show hidden and Show archived', () => {
  expect([...host.querySelectorAll('.pc-list-head .pc-head-cell > button')].map((b) => b.textContent)).toEqual(['Name', 'Mode', 'Generations', 'Nodes', 'Designs', 'Spend', 'Date']);
  expect([...host.querySelectorAll('.pc-list-head .pc-strip-end button')].map((b) => b.getAttribute('aria-label'))).toEqual(['Show hidden · 0', 'Show archived · 0']);
  expect(row('Charlie').querySelector('.pc-col-nodes')?.textContent).toBe('2');
  expect(row('Bravo').querySelector('.pc-col-nodes')?.textContent).toBe('—');
  expect(q('.session-list').classList.contains('pc-cols')).toBe(true);
});

it('a column sorts from its header, empty values last; pressing it again flips; Date returns to the date groups', () => {
  expect(host.querySelectorAll('.date-head').length).toBeGreaterThan(0);
  click(head('Nodes'));
  expect(titles()).toEqual(['Alpha', 'Charlie', 'Bravo']);
  expect(host.querySelector('.date-head')).toBeNull();
  click(head('Nodes'));
  expect(head('Nodes').getAttribute('aria-label')).toBe('Sort by Nodes, descending');
  expect(titles()).toEqual(['Charlie', 'Alpha', 'Bravo']);
  click(head('Name'));
  expect(titles()).toEqual(['Alpha', 'Bravo', 'Charlie']);
  click(head('Date'));
  expect(titles()).toEqual(['Bravo', 'Charlie', 'Alpha']);
});

it('pinned sessions stay first whatever the column', () => {
  click(row('Bravo').querySelector('[aria-label="Pin"]'));
  click(head('Nodes'));
  expect(titles()[0]).toBe('Bravo');
});

it('a column width is resized from the keyboard, stored, and restored with a double click', () => {
  const handle = q('[aria-label="Resize Nodes column"]');
  act(() => { handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); });
  expect(JSON.parse(localStorage.getItem('ogs.sessionsColumns')!).nodes).toBeGreaterThan(0);
  expect(q('.sessions-scroll').style.getPropertyValue('--pc-w-nodes')).toMatch(/px$/);
  act(() => { handle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
  expect(JSON.parse(localStorage.getItem('ogs.sessionsColumns')!).nodes).toBeUndefined();
});

it('rows show Hide and Archive beside the pin; the row menu keeps only what is not on the row', () => {
  const tools = () => [...row('Alpha').querySelectorAll('.pc-tools > button')].map((b) => b.getAttribute('aria-label'));
  expect(tools()).toEqual(['Hide', 'Archive session', 'Pin', 'Session actions']);
  click(row('Alpha').querySelector('[aria-label="Session actions"]'));
  expect([...document.querySelectorAll('[role="menuitem"]')].map((e) => e.textContent)).toEqual(['Rename', 'Delete']);
  act(() => document.body.click());
  click(row('Alpha').querySelector('[aria-label="Archive session"]'));
  expect(useStore.getState().sessions[ids.Alpha].archived).toBe(true);
  click(row('Charlie').querySelector('[aria-label="Hide"]'));
  expect(useStore.getState().sessions[ids.Charlie].userHidden).toBe(true);
  expect(titles()).toEqual(['Bravo']);
});

it('the card grid shows the same sort labels as a compact row with the toggles at its end', () => {
  click(q('.pc-bar [aria-label="View"]'));
  click([...document.querySelectorAll('[role="radio"]')].find((b) => b.textContent === 'Grid'));
  expect(host.querySelector('.pc-list-head')).toBeNull();
  expect([...host.querySelectorAll('.pc-sort-strip .pc-head-cell > button')].map((b) => b.textContent)).toEqual(['Name', 'Mode', 'Generations', 'Nodes', 'Designs', 'Spend', 'Date']);
  expect(host.querySelector('.pc-sort-strip [role="separator"]')).toBeNull();
});

it('Cards is a third view between Grid and List: compact cards with the cover, title, mode and date, remembered', () => {
  click(q('.pc-bar [aria-label="View"]'));
  expect([...document.querySelectorAll('[role="radio"]')].map((b) => b.textContent).slice(0, 3)).toEqual(['Grid', 'Cards', 'List']);
  click([...document.querySelectorAll('[role="radio"]')].find((b) => b.textContent === 'Cards'));
  expect(host.querySelector('.sessions.layout-tile')).not.toBeNull();
  expect(host.querySelectorAll('.sess-tile')).toHaveLength(3);
  expect(localStorage.getItem('ogs.sessionsView')).toBe('"tile"');
  const bravo = [...host.querySelectorAll('.sess-tile')].find((c) => c.querySelector('.pc-info-title')?.textContent === 'Bravo')!;
  expect(bravo.querySelector('.pc-open-tag')?.textContent).toBe('Open');
  expect(bravo.querySelector('time')).not.toBeNull();
  expect(host.querySelector('.pc-sort-strip')).not.toBeNull();
});

it('the open session shows an Open tag beside its title in the list', () => {
  expect(row('Bravo').querySelector('.pc-title-line .pc-open-tag')?.textContent).toBe('Open');
  expect(row('Alpha').querySelector('.pc-open-tag')).toBeNull();
});
