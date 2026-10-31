// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
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

it('Soft contrast is one on/off rule for every base: the toggle sets html[data-contrast], is remembered, and the pre-paint script restores it', () => {
  tab('Look');
  const toggle = host.querySelector<HTMLElement>('[role="switch"][aria-label="Soft contrast"]')!;
  expect(toggle.getAttribute('aria-checked')).toBe('false');
  act(() => toggle.click());
  expect(document.documentElement.getAttribute('data-contrast')).toBe('soft');
  expect(localStorage.getItem('ogs-contrast')).toBe('soft');
  const script = /<script>([\s\S]*?)<\/script>/.exec(readFileSync('index.html', 'utf8'))?.[1] ?? '';
  const got: Record<string, string> = {};
  new Function('document', 'localStorage', 'matchMedia', script)({ documentElement: { setAttribute: (k: string, v: string) => (got[k] = v) } }, localStorage, matchMedia);
  expect(got['data-contrast']).toBe('soft');
  act(() => toggle.click());
  expect(document.documentElement.hasAttribute('data-contrast')).toBe(false);
  expect(localStorage.getItem('ogs-contrast')).toBeNull();
});

it('the soft rule only moves surfaces, borders and what derives from them: never text or highlight colours', () => {
  const css = readFileSync('src/styles/soft-contrast.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const set = [...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]);
  expect(set.filter((t) => /^--(text|accent|select|danger|warn|ok)/.test(t))).toEqual([]);
  expect(set).toContain('--surface-2');
});

it('the brightness hierarchy dims and shrinks the frame icons, steps the composer and bubble up, and lifts conversation text', () => {
  const css = readFileSync('src/styles/hierarchy.css', 'utf8');
  expect(css).toMatch(/\.side-btn svg \{ width: 16px; height: 16px; \}/);
  expect(css).toMatch(/:not\(:hover\)[^{]*svg \{ color: var\(--text-3\); \}/);
  expect(css).toMatch(/\.composer, :root \.bubble \{ background: var\(--surface-2\); \}/);
  expect(css).toMatch(/\.composer-input \{ color: var\(--text-content\); \}/);
  expect(readFileSync('src/styles/soft-contrast.css', 'utf8')).toMatch(/--soft-anchor: var\(--bg-canvas\)/);
});
