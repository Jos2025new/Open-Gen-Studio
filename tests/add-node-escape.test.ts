// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  blobDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  getAssetBlob: async () => undefined,
  peekAssetUrl: () => undefined,
  loadAssetUrl: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AddNodeMenu } from '../src/components/node/NodeCanvasParts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} disconnect() {} unobserve() {} };

let host: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(AddNodeMenu, { onAdd: vi.fn(), onImport: vi.fn() })));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe('Add node popover', () => {
  it('Escape closes it, with the focus in the search field or on the page', async () => {
    for (const inField of [true, false]) {
      await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Add node…"]')!.click());
      expect(document.querySelector('[role="dialog"][aria-label="Add node"]')).not.toBeNull();
      const target = inField ? document.querySelector<HTMLElement>('input[type="search"]')! : document.body;
      await act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
      expect(document.querySelector('[role="dialog"][aria-label="Add node"]')).toBeNull();
    }
  });
});
