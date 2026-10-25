// @vitest-environment jsdom
// The model picker: one row per variant with every provider that serves it, and a search that finds it however the version is typed.
import { expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));
import { ModelList } from '../src/components/composer/ModelList';
import { matchesSearch } from '../src/engine/variants';
import { useStore } from '../src/store/store';
import type { ModelSummary } from '../src/engine/types';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mk = (provider: 'nanogpt' | 'openrouter', id: string, name: string) => ({ ref: `${provider}::${id}`, provider, id, name, kind: 'video', tags: [], acceptsText: true, acceptsImage: true }) as unknown as ModelSummary;

it('search words: versions with or without .0, numbers whole, words by prefix, provider names', () => {
  const t = 'Seedance 2.0 Mini bytedance/seedance-2.0-mini OpenRouter';
  for (const q of ['seedance 2 mini', 'seedance 2.0 mini', 'seed mini', 'openrouter seedance', 'MINI']) expect(matchesSearch(t, q), q).toBe(true);
  for (const q of ['seedance 2.5', 'seedance 1', 'nanogpt']) expect(matchesSearch(t, q), q).toBe(false);
  expect(matchesSearch('Seedance 2.5 bytedance-seedance-2-5', 'seedance 2.5')).toBe(true);
  expect(matchesSearch('Seedance 2.5 bytedance-seedance-2-5', 'seedance 2')).toBe(false);
});

it('recommended and search rows name every provider of the variant (sandbox report 2026-10-25)', async () => {
  const st = useStore.getState();
  const list = [mk('nanogpt', 'bytedance-seedance-2-0-mini', 'Seedance 2.0 Mini'), mk('openrouter', 'bytedance/seedance-2.0-mini', 'Seedance 2.0 Mini'), mk('nanogpt', 'bytedance-seedance-2-0-fast', 'Seedance 2.0 Fast Turbo'), mk('openrouter', 'bytedance/seedance-2.0-fast', 'Seedance 2.0 Fast')];
  useStore.setState({ catalog: { ...st.catalog, models: Object.fromEntries(list.map((m) => [m.ref, m])) }, settings: { ...st.settings, keys: { ...st.settings.keys, nanogpt: 'k', openrouter: 'k' } } });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(ModelList, { kind: 'video', value: null, onSelect: () => {}, familyTree: true, automaticVariants: true, autoOption: 'Auto' })));
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>('.ml-family')].forEach((b) => b.click()));
  const rows = () => [...host.querySelectorAll('.ml-row .ml-where')].map((r) => r.closest('.ml-row')!.querySelector('.ml-name')!.textContent + ' @ ' + r.textContent);
  // The recommended Fast row also says OpenRouter has it.
  expect(rows().find((r) => r.startsWith('Seedance 2.0 Fast'))).toMatch(/NanoGPT/);
  expect(rows().find((r) => r.startsWith('Seedance 2.0 Fast'))).toMatch(/OpenRouter/);
  const input = host.querySelector('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'seedance 2 mini');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(rows()).toEqual([expect.stringMatching(/^Seedance 2\.0 Mini @ .*OpenRouter.*NanoGPT|^Seedance 2\.0 Mini @ .*NanoGPT.*OpenRouter/)]);
  await act(async () => root.unmount());
});
