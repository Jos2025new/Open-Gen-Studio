// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* DELICATE (docs/features/agente.md, "Cambio de modelo"): the switch card is one question and one primary button. */
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  blobDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { SettingsCard } from '../src/components/chat/SettingsCard';
import { useStore } from '../src/store/store';
import type { ModelSummary, SettingsFeedItem } from '../src/engine/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

const FLUX = 'atlas::bfl/flux-3-klein/text-to-image';
const GROK = 'atlas::xai/grok-imagine-image/text-to-image';
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const models = Object.fromEntries([[FLUX, 'FLUX 3 Image Klein'], [GROK, 'Grok Imagine Image']].map(([ref, name]) => [ref, { ref, id: ref.split('::')[1], provider: 'atlas', kind: 'image', name, acceptsText: true, acceptsImage: false, tags: [] } as ModelSummary]));
  useStore.setState((s) => ({ catalog: { ...s.catalog, models: { ...s.catalog.models, ...models } } }));
});

describe('the switch card renders', () => {
  it('one question, ONE primary button "Switch to <Model>", a small "Keep <current>"', async () => {
    const item = { id: 'x', createdAt: 0, workspace: 'chat', type: 'settings', status: 'pending', sections: [{ kind: 'image', count: 1, recommended: { modelRef: GROK, needsImage: false }, alternatives: [] }], switchFrom: { modelRef: FLUX, needsImage: false } } as SettingsFeedItem;
    await act(async () => { root.render(createElement(SettingsCard, { item, sessionId: useStore.getState().activeSessionId })); });
    const text = host.textContent ?? '';
    expect(text).toMatch(/Found Grok Imagine Image · .*Switch to it\?/);
    const buttons = [...host.querySelectorAll('button')];
    expect(buttons.map((b) => b.textContent)).toEqual(['Keep FLUX 3 Image Klein', 'Switch to Grok Imagine Image']);
    expect(host.querySelectorAll('button.btn-primary')).toHaveLength(1);
    expect(host.querySelector('button.btn-primary')?.textContent).toBe('Switch to Grok Imagine Image');
    expect(text).not.toContain('Confirm settings');
  });
});
