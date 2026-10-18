// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { COMMON_RATIOS, AspectPicker, shapeDims, splitRatios } from '../src/components/chat/aspectShape';
import { StepThumb } from '../src/components/chat/StepThumb';
import { PlanCard } from '../src/components/chat/PlanCard';
import { SettingsCard } from '../src/components/chat/SettingsCard';
import { LOCAL_IMAGE_REF, LOCAL_VIDEO_REF } from '../src/engine/providers/demo';
import { useStore } from '../src/store/store';
import type { Asset, Generation, ImageStep, ModelSummary, PlanFeedItem } from '../src/engine/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
const mount = async (el: ReturnType<typeof createElement>) => { await act(async () => { root.render(el); }); };

describe('aspect shape glyphs', () => {
  it('draw the true proportion inside the requested longest side', () => {
    for (const [v, r] of [['1:1', 1], ['3:4', 3 / 4], ['9:16', 9 / 16], ['16:9', 16 / 9], ['3:2', 3 / 2], ['21:9', 21 / 9]] as const) {
      for (const max of [12, 14, 20]) {
        const d = shapeDims(v, max);
        expect(Math.max(d.w, d.h)).toBe(max);
        expect(d.w / d.h).toBeCloseTo(r, 1);
      }
    }
    expect(shapeDims('auto', 14).auto).toBe(true);
  });
});

describe('the aspect picker', () => {
  const all = ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9'];
  it('shows at most five common ratios plus More, and the rest only after More', async () => {
    expect(splitRatios(all).main).toEqual([...COMMON_RATIOS]);
    await mount(createElement(AspectPicker, { values: all, value: '9:16', onPick: () => undefined }));
    const labels = () => [...host.querySelectorAll('.cc-ratio:not(.cc-more)')].map((b) => b.textContent);
    expect(labels()).toEqual([...COMMON_RATIOS]);
    expect(host.querySelector('.cc-more')?.textContent).toMatch(/More/);
    expect(host.querySelector('.cc-ratio.is-on')?.textContent).toBe('9:16');
    await act(async () => { (host.querySelector('.cc-more') as HTMLElement).click(); });
    expect(host.querySelector('.cc-more')?.textContent).toMatch(/Less/);
    expect(labels()).toHaveLength(all.length);
    // Each glyph sits in a 28x28 box and keeps its proportion.
    const shape = host.querySelector('.cc-ratio.is-on .cc-shape') as HTMLElement;
    expect(parseFloat(shape.style.width) / parseFloat(shape.style.height)).toBeCloseTo(9 / 16, 1);
  });
  it('lists only the common ratios the model supports and has no More when nothing is left', async () => {
    const some = ['1:1', '16:9'];
    expect(splitRatios(some)).toEqual({ main: some, rest: [] });
    await mount(createElement(AspectPicker, { values: some, value: '1:1', onPick: () => undefined }));
    expect(host.querySelectorAll('.cc-ratio')).toHaveLength(2);
    expect(host.querySelector('.cc-more')).toBeNull();
  });
});

describe('plan step thumbnails', () => {
  const asset = (id: string): Asset => ({ id, name: id, kind: 'image', mime: 'image/png', width: 8, height: 8, sessionId: 's', origin: 'generated', stored: true, favorite: false, createdAt: 1 });
  const gen = (assetIds: string[]): Generation => ({ id: 'g1', sessionId: 's', kind: 'image', status: 'running', assetIds, settings: { count: 2, advanced: {} } } as unknown as Generation);
  it('start as the app pending placeholder and turn into the real image live, one slot per result', async () => {
    useStore.setState({ generations: { g1: gen([]) }, assets: {} });
    await mount(createElement(StepThumb, { genId: 'g1', count: 2 }));
    expect(host.querySelectorAll('[data-pending]')).toHaveLength(2);
    expect(host.querySelectorAll('.tile-pending .shimmer')).toHaveLength(2);
    expect(host.querySelectorAll('[data-thumb]')).toHaveLength(0);
    await act(async () => { useStore.setState({ assets: { a1: asset('a1') }, generations: { g1: gen(['a1']) } }); });
    expect(host.querySelectorAll('[data-thumb]')).toHaveLength(1);
    expect(host.querySelectorAll('[data-pending]')).toHaveLength(1);
    await act(async () => { useStore.setState({ assets: { a1: asset('a1'), a2: asset('a2') }, generations: { g1: gen(['a1', 'a2']) } }); });
    expect(host.querySelectorAll('[data-thumb]')).toHaveLength(2);
    expect(host.querySelectorAll('[data-pending]')).toHaveLength(0);
    expect(host.querySelector('.cc-thumbs')?.getAttribute('data-slots')).toBe('2');
  });
});

describe('the plan card', () => {
  const REF = 'atlas::c5/image';
  const model: ModelSummary = { ref: REF, provider: 'atlas', id: 'c5/image', name: 'Studio Image', kind: 'image', acceptsText: true, acceptsImage: false, tags: [], price: { skus: [{ unit: 'output', usd: 0.3 }] } };
  const step = (id: string, title: string, aspect: string): ImageStep => ({ id, title, kind: 'image', prompt: `${title} prompt`, modelRef: REF, refs: [], settings: { aspect, count: 1, advanced: {} } });
  it('shows the total once, on the approve button; steps carry shapes, thumbnails and their own small cost', async () => {
    useStore.setState((s) => ({ catalog: { ...s.catalog, models: { ...s.catalog.models, [REF]: model } } }));
    const item = {
      id: 'p1', createdAt: 0, workspace: 'chat', type: 'plan', style: 'auto', status: 'awaiting', stepStates: {}, stepGenerations: {},
      estimate: { usd: 0.6 }, plan: { id: 'pl', title: 'Two portraits', summary: '', workspace: 'chat', adjustments: [], steps: [step('s1', 'Portrait', '9:16'), step('s2', 'Room', '16:9')] },
    } as unknown as PlanFeedItem;
    await mount(createElement(PlanCard, { item, sessionId: useStore.getState().activeSessionId }));
    const text = host.textContent ?? '';
    expect(host.querySelector('.plan-kicker')).toBeNull();
    expect(host.querySelector('.cost-tag')).toBeNull();
    const total = host.querySelector('.cc-ap-cost')?.textContent ?? '';
    expect(total).toMatch(/\$0\.6/);
    // The total appears once; each step shows only its own price.
    expect(text.split(total).length - 1).toBe(1);
    expect(host.querySelectorAll('.plan-step .step-cost')).toHaveLength(2);
    expect(host.querySelectorAll('.plan-step [data-pending]')).toHaveLength(2);
    const shapes = [...host.querySelectorAll('.step-detail .cc-shape')].map((e) => e.getAttribute('data-shape'));
    expect(shapes).toEqual(['9:16', '16:9']);
    expect(host.querySelector('.cc-approve')?.textContent).toMatch(/^Approve/);
  });
});

describe('the settings card chips', () => {
  it('shows model, aspect, resolution-free count chips and opens the model list above the chip', async () => {
    useStore.setState((s) => ({ catalog: { ...s.catalog } }));
    const item = { id: 'x', createdAt: 0, workspace: 'chat', type: 'settings', summary: 'Retrato', status: 'pending', sections: [{ kind: 'image', count: 1, recommended: { modelRef: LOCAL_IMAGE_REF, needsImage: false, aspect: '9:16' }, alternatives: [LOCAL_VIDEO_REF] }] } as never;
    await mount(createElement(SettingsCard, { item, sessionId: useStore.getState().activeSessionId }));
    expect(host.querySelector('.q-kicker')).toBeNull();
    const chips = [...host.querySelectorAll('.cc-chip')].map((c) => c.getAttribute('aria-label'));
    expect(chips).toContain('Model');
    expect(chips).toContain('Images per step');
    await act(async () => { (host.querySelector('.cc-chip[aria-label="Model"]') as HTMLElement).click(); });
    expect(document.body.textContent).toContain('recommended');
    expect(document.body.textContent).toContain('Show 1 other model');
  });
});
