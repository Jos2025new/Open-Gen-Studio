// @vitest-environment jsdom
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
afterAll(() => vi.unstubAllGlobals());

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
  const open = () => act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Agent mode"]')!.click());
  const choose = (label: string) => act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((button) => button.textContent?.trim() === label)!.click());

  it('shows Auto, Guided and Direct, with Auto selected by default', () => {
    const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="Agent mode"]')!;
    expect(trigger.textContent).toContain('Auto');
    open();
    const options = [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    expect(options.map((option) => option.textContent?.trim())).toEqual(['Auto', 'Guided', 'Direct']);
    expect(options[0].getAttribute('aria-checked')).toBe('true');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('choosing an option sets the agent mode and closes the menu', () => {
    open(); choose('Direct');
    expect(useStore.getState().composer.agentStyle).toBe('direct');
    expect(host.querySelector('[aria-label="Agent mode"]')?.getAttribute('aria-expanded')).toBe('false');
    open(); choose('Guided');
    expect(useStore.getState().composer.agentStyle).toBe('guided');
  });
});
