// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TopBar } from '../src/components/shell/TopBar';
import { setUi } from '../src/store/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
let root: Root | undefined;
afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.innerHTML = ''; });

/** Mounts the bar and returns its markup. Zustand reads the live state only on the client, so SSR would show the initial state. */
function mount(home: boolean): HTMLElement {
  setUi({ home });
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(TopBar, { slotRef: () => undefined })));
  return host;
}

describe('top bar on Home', () => {
  it('keeps Settings and a Connected pill, and drops the breadcrumb and Generations', () => {
    const host = mount(true);
    expect(host.querySelector('.ws-tag')).toBeNull();
    expect(host.textContent).not.toContain('Generations');
    const pill = host.querySelector('.topbar-pill') as HTMLButtonElement;
    expect(pill.textContent).toBe('Connected');
    expect(pill.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('[aria-label="Settings"]')).not.toBeNull();
  });
  it('the pill opens the Connected popover as before', () => {
    const host = mount(true);
    act(() => (host.querySelector('.topbar-pill') as HTMLButtonElement).click());
    expect(host.querySelector('.topbar-pill')?.getAttribute('aria-expanded')).toBe('true');
  });
  it('outside Home the breadcrumb, Generations and the plain Connected button are unchanged', () => {
    const host = mount(false);
    expect(host.querySelector('.ws-tag')).not.toBeNull();
    expect(host.textContent).toContain('Generations');
    expect(host.querySelector('.topbar-pill')).toBeNull();
    expect(host.querySelector('.topbar-menu')?.textContent).toContain('Connected');
  });
});
