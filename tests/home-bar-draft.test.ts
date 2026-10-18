// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { HomeBar } from '../src/components/shell/HomeBar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const type = (input: HTMLInputElement, v: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, v);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('HomeBar draft', () => {
  it('survives unmount (tab switch) and remounts with the text', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    let root = createRoot(host);
    await act(async () => root.render(createElement(HomeBar)));
    await act(async () => type(host.querySelector('input.home-bar-input')!, 'a red fox'));
    await act(async () => root.unmount());
    root = createRoot(host);
    await act(async () => root.render(createElement(HomeBar)));
    expect((host.querySelector('input.home-bar-input') as HTMLInputElement).value).toBe('a red fox');
    await act(async () => root.unmount());
  });
});
