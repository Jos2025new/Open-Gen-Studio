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
import { ChatWorkspace } from '../src/components/chat/ChatWorkspace';
import { setUi } from '../src/store/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

let root: Root | undefined;
afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.innerHTML = ''; });

/** The import button is portalled into the TopBar's #workspace-actions slot, so the slot is put in place first. */
function mount(home: boolean): void {
  setUi({ home });
  const slot = document.createElement('div');
  slot.id = 'workspace-actions';
  document.body.append(slot);
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(ChatWorkspace)));
}

describe('Import from Nodes button', () => {
  it('is absent on Home', () => {
    mount(true);
    expect(document.querySelector('.import-chat-btn')).toBeNull();
  });
  it('is present outside Home', () => {
    mount(false);
    expect(document.querySelector('.import-chat-btn')).not.toBeNull();
  });
});
