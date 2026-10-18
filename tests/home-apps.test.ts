// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { HomeView } from '../src/components/shell/HomeView';
import { setUi, useStore } from '../src/store/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

let root: Root | undefined;
let host: HTMLElement;
const mount = () => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); act(() => root!.render(createElement(HomeView))); };
const card = (cls: string) => host.querySelector(`.home-app.${cls}`) as HTMLButtonElement;
const tools = () => [...host.querySelectorAll('.home-tools > button')] as HTMLButtonElement[];

beforeEach(() => {
  // Two image models: one from a provider with a key, one from a provider with no key. Only the first counts.
  useStore.setState((s) => ({
    catalog: { ...s.catalog, models: {
      'fal::img-a': { ref: 'fal::img-a', id: 'img-a', provider: 'fal', kind: 'image', needsVideo: false, name: 'A' },
      'replicate::img-b': { ref: 'replicate::img-b', id: 'img-b', provider: 'replicate', kind: 'image', needsVideo: false, name: 'B' },
    } as never },
    settings: { ...s.settings, keys: { fal: 'test-key' } as never },
  }));
  setUi({ home: true, space: undefined, homeTab: 'home' });
});
afterEach(() => { act(() => root?.unmount()); root = undefined; host?.remove(); });

describe('app cards', () => {
  it('count only the models the connected keys reach, and show nothing when there are none', () => {
    mount();
    expect(card('t-image').querySelector('.home-app-count')?.textContent).toBe('1');
    expect(card('t-video').querySelector('.home-app-count')).toBeNull();
  });
  it('an app card opens Create with its mode', () => {
    mount();
    act(() => card('t-image').click());
    expect(useStore.getState().composer.mode).toBe('image');
    expect(useStore.getState().ui).toMatchObject({ workspace: 'chat', home: false, space: 'create' });
  });
});

describe('tools More / Less', () => {
  it('"More" expands the row in place and "Less" collapses it', () => {
    mount();
    const before = tools().length;
    const more = tools().at(-1)!;
    expect(more.textContent).toBe('More');
    act(() => more.click());
    expect(tools().length).toBeGreaterThan(before);
    expect(tools().at(-1)!.textContent).toBe('Less');
    expect(tools().at(-1)!.getAttribute('aria-expanded')).toBe('true');
    act(() => tools().at(-1)!.click());
    expect(tools().length).toBe(before);
  });
});
