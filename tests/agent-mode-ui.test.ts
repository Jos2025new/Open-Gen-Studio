// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { AgentControls } from '../src/components/composer/AgentControls';
import { useStore } from '../src/store/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  useStore.setState((s) => ({ composer: { ...s.composer, agentStyle: 'auto' } }));
  act(() => root.render(createElement(AgentControls)));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('agent mode dropdown', () => {
  it('is a dropdown with Auto, Guided and Direct, Auto selected by default', () => {
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="Agent mode"]');
    expect(select).not.toBeNull();
    expect(select!.value).toBe('auto');
    expect([...select!.options].map((o) => o.textContent)).toEqual(['Auto', 'Guided', 'Direct']);
  });

  it('choosing an option sets the agent mode in the composer', () => {
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="Agent mode"]')!;
    act(() => {
      select.value = 'direct';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(useStore.getState().composer.agentStyle).toBe('direct');

    act(() => {
      select.value = 'guided';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(useStore.getState().composer.agentStyle).toBe('guided');
  });
});
