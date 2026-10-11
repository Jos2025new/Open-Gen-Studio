// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));
vi.mock('../src/engine/catalog', async (original) => ({
  ...await original<typeof import('../src/engine/catalog')>(),
  loadCatalogs: vi.fn(async () => undefined), loadLlmCatalog: vi.fn(async () => undefined),
}));
import { loadCatalogs, loadLlmCatalog } from '../src/engine/catalog';
import { REMOTE_PROVIDERS } from '../src/engine/providers/registry';
import { PROVIDER_LABELS } from '../src/engine/providers/types';
import { useStore } from '../src/store/store';
import { ConnectedProviders } from '../src/components/shell/ConnectedProviders';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const initial = useStore.getState();
let root: Root, host: HTMLDivElement;
function Connections() {
  const keys = useStore((s) => s.settings.keys);
  const [added, setAdded] = useState<Array<typeof REMOTE_PROVIDERS[number]>>([]);
  return createElement(ConnectedProviders, { providers: [...new Set([...added, ...REMOTE_PROVIDERS.filter((p) => keys[p]?.trim())])], onAdd: (p) => setAdded((prev) => prev.includes(p) ? prev : [...prev, p]) });
}
beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  useStore.setState({ settings: { ...initial.settings, keys: { openrouter: '', fal: '', nanogpt: '', atlas: '' } }, catalog: { ...initial.catalog, schemas: { 'atlas::stale': { ref: 'atlas::stale' }, 'fal::keep': { ref: 'fal::keep' } } as never } });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(createElement(Connections)));
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  useStore.setState({ settings: initial.settings, catalog: initial.catalog }); vi.unstubAllGlobals();
});
async function click(label: string) {
  const b = [...document.querySelectorAll('button')].find((e) => e.textContent?.trim() === label || e.getAttribute('aria-label') === label);
  expect(b, label).toBeTruthy(); await act(async () => b!.click());
}
async function typeKey(value: string) {
  const input = document.querySelector<HTMLInputElement>('.key-input input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return input;
}

it('offers Add provider when empty, then provider names without exposing all key fields', async () => {
  expect(host.textContent).toContain('Add provider');
  await click('Add provider');
  for (const p of REMOTE_PROVIDERS) expect(document.body.textContent).toContain(PROVIDER_LABELS[p]);
  expect(document.querySelector('.key-input')).toBeNull();
});
it.each(REMOTE_PROVIDERS)('opens just the %s key field, hidden and focused, with its existing key link', async (p) => {
  await click('Add provider'); await click(PROVIDER_LABELS[p]);
  const input = document.querySelector<HTMLInputElement>('.key-input input')!;
  expect(document.querySelectorAll('.key-input')).toHaveLength(1);
  expect(input.getAttribute('aria-label')).toBe(`${PROVIDER_LABELS[p]} API key`);
  expect(input.type).toBe('password'); expect(document.activeElement).toBe(input);
  expect(document.querySelector('.prov-link')).toBeTruthy();
});
it('saves through the existing settings path and refreshes only that provider’s key-dependent schemas', async () => {
  await click('Add provider'); await click('Atlas Cloud');
  const input = await typeKey('  fixture-key  ');
  await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  expect(useStore.getState().settings.keys.atlas).toBe('fixture-key');
  expect(useStore.getState().settings.keys.fal).toBe('');
  expect(useStore.getState().catalog.schemas['atlas::stale']).toBeUndefined();
  expect(useStore.getState().catalog.schemas['fal::keep']).toBeTruthy();
  expect(loadCatalogs).toHaveBeenCalledExactlyOnceWith({ force: true, preferRemote: true });
  expect(loadLlmCatalog).toHaveBeenCalledExactlyOnceWith('atlas');
  expect(host.querySelector('.prov-name')?.textContent).toBe('Atlas Cloud');
  await act(async () => input.blur());
  expect(loadCatalogs).toHaveBeenCalledTimes(1);
});
it('saves on blur and keeps multiple chosen providers below Add provider, each with its own key visibility', async () => {
  await click('Add provider'); await click('fal.ai');
  const input = await typeKey('fixture-fal');
  await click('Show key'); expect(input.type).toBe('text');
  await act(async () => input.blur()); expect(useStore.getState().settings.keys.fal).toBe('fixture-fal');
  await click('Add provider'); await click('NanoGPT');
  expect(host.querySelectorAll('.key-input')).toHaveLength(2);
  expect(host.querySelector<HTMLInputElement>('[aria-label="NanoGPT API key"]')!.type).toBe('password');
  expect(host.querySelector<HTMLInputElement>('[aria-label="fal.ai API key"]')!.value).toBe('fixture-fal');
  expect(loadLlmCatalog).not.toHaveBeenCalled();
});
it('opens a chooser only for selection, keeps the fields in the original panel, and prevents duplicates', async () => {
  await click('Add provider'); await click('OpenRouter');
  expect(host.querySelector('.key-input')).toBeTruthy();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await click('Add provider'); expect(host.querySelector('.key-input')).toBeTruthy();
  const choice = [...document.querySelectorAll('button')].find((b) => b.textContent === 'OpenRouter')!;
  expect(choice.disabled).toBe(true);
  expect(document.querySelector('[role="menu"]')).toBeTruthy();
  await click('Add provider'); expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(host.querySelectorAll('.key-input')).toHaveLength(1);
});
