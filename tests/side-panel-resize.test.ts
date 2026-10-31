// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, peekAssetUrl: () => undefined, loadAssetUrl: async () => undefined }));
vi.mock('../src/components/ui/AssetMedia', () => ({ AssetMedia: () => null }));
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PANEL_MIN_W, SidePanel } from '../src/components/shell/SidePanel';
import { setUi } from '../src/store/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });

let host: HTMLDivElement;
let root: Root;
const aside = () => host.querySelector<HTMLElement>('.side-panel')!;
const handle = () => host.querySelector<HTMLElement>('[aria-label="Resize panel"]')!;
const key = (k: string) => act(() => { handle().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); });

beforeEach(() => {
  localStorage.clear();
  setUi({ panel: 'sessions', panelExpanded: false });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  act(() => root.render(createElement(SidePanel)));
});
afterEach(() => { act(() => root.unmount()); host.remove(); setUi({ panel: null }); });

it('the drawer resizes from its right edge, remembers the width, never goes below its minimum, and resets on double click', () => {
  expect(aside().style.getPropertyValue('--side-w')).toBe('370px');
  key('ArrowRight');
  expect(aside().style.getPropertyValue('--side-w')).toBe('386px');
  expect(localStorage.getItem('ogs.sidePanelWidth')).toBe('386');
  for (let i = 0; i < 10; i++) key('ArrowLeft');
  expect(aside().style.getPropertyValue('--side-w')).toBe(`${PANEL_MIN_W}px`);
  act(() => { handle().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
  expect(aside().style.getPropertyValue('--side-w')).toBe('370px');
});

it('expanded, the drawer has no resize handle', () => {
  act(() => setUi({ panelExpanded: true }));
  expect(host.querySelector('[aria-label="Resize panel"]')).toBeNull();
});

it('the Sessions grid keeps cards at least 150px wide, so a narrow drawer shows fewer columns', () => {
  expect(readFileSync('src/components/shell/SessionsLayout.css', 'utf8')).toMatch(/\.sessions\.layout-card \.session-list \{ grid-template-columns: repeat\(auto-fill, minmax\(max\(150px,/);
});
