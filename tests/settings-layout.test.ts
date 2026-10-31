// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));
vi.mock('../src/engine/catalog', async (orig) => ({ ...(await orig<object>()), loadCatalogs: async () => undefined, loadLlmCatalog: async () => undefined }));
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SettingsPanel } from '../src/components/shell/SettingsPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));

let host: HTMLDivElement;
let root: Root;
const tab = (name: string) => act(() => [...host.querySelectorAll<HTMLElement>('[role="tab"]')].find((b) => b.textContent === name)!.click());
const groups = () => [...host.querySelectorAll('.set-group-head')].map((h) => h.textContent);

beforeEach(() => {
  localStorage.clear();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  act(() => root.render(createElement(SettingsPanel)));
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

it('the sections sit in a side rail, each with its icon, and the chosen one is remembered', () => {
  const rail = [...host.querySelectorAll('.set-nav [role="tab"]')];
  expect(rail.map((b) => b.textContent)).toEqual(['Providers', 'Agent', 'Operations', 'Budget', 'Look', 'Data', 'Shortcuts']);
  expect(rail.every((b) => b.querySelector('svg'))).toBe(true);
  expect(rail[0].getAttribute('aria-selected')).toBe('true');
  tab('Budget');
  expect(localStorage.getItem('ogs:settings-tab')).toBe('"budget"');
  expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Budget');
});

it('each section groups its rows under titled cards, and rows lead with an icon', () => {
  expect(groups()).toEqual(['Notifications', 'API keys']);
  tab('Operations');
  expect(groups()).toEqual(['Image', 'Video', 'Audio']);
  const rows = [...host.querySelectorAll('.set-group-body > .set-row')];
  expect(rows.length).toBe(10);
  expect(rows.every((r) => r.querySelector('.set-label .set-row-icon'))).toBe(true);
  tab('Budget');
  expect(groups()).toEqual(['Limit', 'Prices']);
  tab('Data');
  expect(groups()).toEqual(['Storage', 'Drawing', 'Reset']);
});

it('Look shows each base as a small picture in its own colours; System shows dark and light halves', () => {
  tab('Look');
  expect(groups()).toEqual(['Theme']);
  const thumbs = [...host.querySelectorAll('.theme-thumb')];
  expect(thumbs.map((t) => t.textContent)).toEqual(['System', 'Atlas', 'Graphite', 'Light', 'White', 'Original (old)']);
  expect([...thumbs[0].querySelectorAll('.theme-mini')].map((m) => m.getAttribute('data-base'))).toEqual(['atlas', 'claro']);
  expect(thumbs[2].querySelector('.theme-mini')?.getAttribute('data-base')).toBe('grafito');
});
