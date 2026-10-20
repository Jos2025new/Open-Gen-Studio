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
import * as runtime from '../src/engine/agent/runtime';
import type { ModelSummary, SettingsFeedItem } from '../src/engine/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

const FLUX = 'atlas::bfl/flux-3-klein/text-to-image';
const GROK = 'atlas::xai/grok-imagine-image/text-to-image';
const OTHER = 'atlas::google/nano-banana-2/text-to-image';
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const models = Object.fromEntries([[FLUX, 'FLUX 3 Image Klein'], [GROK, 'Grok Imagine Image'], [OTHER, 'Nano Banana 2']].map(([ref, name]) => [ref, { ref, id: ref.split('::')[1], provider: 'atlas', kind: 'image', name, acceptsText: true, acceptsImage: false, tags: [] } as ModelSummary]));
  useStore.setState((s) => ({ catalog: { ...s.catalog, models: { ...s.catalog.models, ...models } } }));
});

describe('the switch card renders', () => {
  it('one short line with the model as a pill, two small buttons: Keep and Change (the only primary)', async () => {
    const item = { id: 'x', createdAt: 0, workspace: 'chat', type: 'settings', status: 'pending', sections: [{ kind: 'image', count: 1, recommended: { modelRef: GROK, needsImage: false }, alternatives: [] }], switchFrom: { modelRef: FLUX, needsImage: false } } as SettingsFeedItem;
    await act(async () => { root.render(createElement(SettingsCard, { item, sessionId: useStore.getState().activeSessionId })); });
    expect(host.querySelector('.cc-switch-line')?.textContent).toMatch(/^Found model Grok Imagine Image/);
    expect(host.querySelectorAll('.cc-switch-line .cc-mini')).toHaveLength(1);
    expect(host.querySelector('article')?.className).toContain('cc-narrow');
    const buttons = [...host.querySelectorAll('button')];
    expect(buttons.map((b) => b.textContent)).toEqual(['Keep', 'Change']);
    expect(buttons.map((b) => b.className)).toEqual([expect.stringContaining('btn-sm'), expect.stringContaining('btn-sm')]);
    expect(host.querySelectorAll('button.btn-primary')).toHaveLength(1);
    expect(host.querySelector('button.btn-primary')?.textContent).toBe('Change');
    expect(host.textContent).not.toContain('Confirm settings');
  });
});

describe('the follow-up card after a switch', () => {
  const item = { id: 'f1', createdAt: 0, workspace: 'chat', type: 'settings', status: 'pending', followUp: true, sections: [{ kind: 'image', count: 1, recommended: { modelRef: GROK, needsImage: false }, alternatives: [OTHER] }], switchFrom: { modelRef: FLUX, needsImage: false } } as SettingsFeedItem;
  const show = async () => { await act(async () => { root.render(createElement(SettingsCard, { item, sessionId: useStore.getState().activeSessionId })); }); };

  it('is tiny: "Next image:", two checkbox rows with a model pill, and the settings card model chip for another model', async () => {
    await show();
    expect(host.querySelector('.cc-switch-line')?.textContent).toBe('Next image:');
    expect(host.querySelector('article')?.className).toContain('cc-narrow');
    const rows = [...host.querySelectorAll('button[role="checkbox"]')];
    expect(rows.map((b) => b.textContent)).toEqual(['ContinueGrok Imagine Image', 'BackFLUX 3 Image Klein']);
    expect(rows.every((b) => b.getAttribute('aria-checked') === 'false' && b.querySelector('.cc-box') && b.querySelector('.cc-mini'))).toBe(true);
    expect(host.querySelectorAll('.cc-pick.is-on')).toHaveLength(0);
    expect(host.querySelector('button.btn-primary')).toBeNull();
    // The same capsule the confirm_settings card uses for its model (ChipPop: cc-chip), not a plain-text fold.
    const chip = host.querySelector('button.cc-chip[aria-label="Model"]');
    expect(chip?.textContent).toBe('Another model');
    expect(host.textContent).not.toContain('Nano Banana 2');
  });

  it('one click fills the box green (is-on, checked) and answers; the picker lists the other models with the Model-chip rows', async () => {
    const spy = vi.spyOn(runtime, 'confirmSettings').mockResolvedValue(undefined);
    await show();
    await act(async () => { (host.querySelectorAll('button[role="checkbox"]')[1] as HTMLElement).click(); });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][2][0]).toMatchObject({ modelRef: FLUX });
    const on = host.querySelector('button[role="checkbox"].is-on');
    expect(on?.getAttribute('aria-checked')).toBe('true');
    expect(on?.querySelector('.cc-box svg')).not.toBeNull();
    expect(on?.textContent).toContain('Back');
    await act(async () => { (host.querySelector('button.cc-chip[aria-label="Model"]') as HTMLElement).click(); });
    spy.mockRestore();
  });

  it('the "Another model" popover is the confirm_settings model field: rows with provider tag and price, highlighted chosen row, fold toggle', async () => {
    const spy = vi.spyOn(runtime, 'confirmSettings').mockResolvedValue(undefined);
    await show();
    await act(async () => { (host.querySelector('button.cc-chip[aria-label="Model"]') as HTMLElement).click(); });
    const pop = document.body.querySelector('.cc-pop .set-models')!;
    const rows = [...pop.querySelectorAll('button.set-model')];
    expect(rows.map((r) => r.querySelector('.set-model-name')?.textContent)).toEqual(['Grok Imagine Image', 'FLUX 3 Image Klein']);
    expect(rows.map((r) => r.querySelector('.faint')?.textContent)).toEqual(['atlas · switched', 'atlas · confirmed']);
    expect(rows.every((r) => /^(from \$|price unknown)/.test(r.querySelector('.set-model-price')?.textContent ?? ''))).toBe(true);
    const toggle = pop.querySelector('button.set-more')!;
    expect(toggle.textContent).toContain('Show 1 other model');
    expect(pop.textContent).not.toContain('Nano Banana 2');
    await act(async () => { (toggle as HTMLElement).click(); });
    expect(pop.textContent).toContain('Hide other models');
    const last = [...pop.querySelectorAll('button.set-model')].at(-1)!;
    expect(last.querySelector('.set-model-name')?.textContent).toBe('Nano Banana 2');
    expect(last.querySelector('.set-model-price')?.textContent).toBeTruthy();
    await act(async () => { (last as HTMLElement).click(); });
    expect(spy.mock.calls[0][2][0]).toMatchObject({ modelRef: OTHER });
    spy.mockRestore();
  });
});
