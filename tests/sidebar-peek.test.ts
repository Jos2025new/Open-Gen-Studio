// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async () => undefined }));
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Sidebar } from '../src/components/shell/Sidebar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));

let host: HTMLDivElement;
let root: Root;
const nav = () => host.querySelector('nav.sidebar') as HTMLElement;
const icon = () => host.querySelector('.side-collapse') as HTMLButtonElement;
const hover = (el: Element, type: 'mouseover' | 'mouseout') => act(() => { el.dispatchEvent(new MouseEvent(type, { bubbles: true, relatedTarget: type === 'mouseover' ? document.body : document.body })); });

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  localStorage.setItem('ogs:sidebar-folded', 'true');
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  act(() => root.render(createElement(Sidebar)));
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });

it('folded, hovering the icon shows the bar floating (peek) without unfolding the layout; leaving hides it after a pause', () => {
  expect(nav().className).toContain('is-folded');
  hover(icon(), 'mouseover');
  expect(nav().className).toContain('is-peek');
  expect(nav().className).not.toContain('is-folded');
  expect(document.documentElement.classList.contains('sidebar-folded')).toBe(true);
  hover(nav(), 'mouseout');
  expect(nav().className).toContain('is-peek');
  act(() => { vi.advanceTimersByTime(300); });
  expect(nav().className).toContain('is-folded');
});

it('the left edge also peeks, and clicking the icon pins the bar', () => {
  hover(host.querySelector('.side-peek-edge')!, 'mouseover');
  expect(nav().className).toContain('is-peek');
  expect(icon().getAttribute('aria-label')).toBe('Pin panel');
  act(() => icon().click());
  expect(nav().className).not.toMatch(/is-peek|is-folded/);
  expect(localStorage.getItem('ogs:sidebar-folded')).toBe('false');
});

it('the peeking frame reaches the top, covering the top bar beside the logo', async () => {
  const { readFileSync } = await import('node:fs');
  expect(readFileSync('src/styles/sidebar-peek.css', 'utf8')).toMatch(/\.sidebar\.is-peek::before \{ top: 6px;/);
});
