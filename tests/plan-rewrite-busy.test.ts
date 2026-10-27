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
import { PlanCard } from '../src/components/chat/PlanCard';
import { usePlanRewrite } from '../src/engine/agent/planSettings';
import { useStore } from '../src/store/store';
import type { ImageStep, ModelSummary, PlanFeedItem } from '../src/engine/types';

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

// The Ajustar prompt button is disabled while a rewrite runs on the plan card, and enabled again after it ends.
describe('plan card: Ajustar prompt during a rewrite', () => {
  const REF = 'atlas::busy/image';
  const model: ModelSummary = { ref: REF, provider: 'atlas', id: 'busy/image', name: 'Busy Image', kind: 'image', acceptsText: true, acceptsImage: false, tags: [], price: { skus: [{ unit: 'output', usd: 0.3 }] } };
  const step: ImageStep = { id: 's1', title: 'Portrait', kind: 'image', prompt: 'a portrait prompt', modelRef: REF, refs: [], settings: { aspect: '1:1', count: 1, advanced: {} } };
  const item = {
    id: 'pb1', createdAt: 0, workspace: 'chat', type: 'plan', style: 'auto', status: 'awaiting', stepStates: {}, stepGenerations: {},
    estimate: { usd: 0.3 }, plan: { id: 'plb', title: 'One portrait', summary: '', workspace: 'chat', adjustments: [], steps: [step] },
  } as unknown as PlanFeedItem;
  const wand = () => [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Ajustar prompt')) as HTMLButtonElement | undefined;

  beforeEach(() => {
    useStore.setState((s) => ({ catalog: { ...s.catalog, models: { ...s.catalog.models, [REF]: model } } }));
    usePlanRewrite.setState({ busy: {}, failed: {} });
  });

  it('is disabled while the prompt is being adapted and enabled after', async () => {
    await mount(createElement(PlanCard, { item, sessionId: useStore.getState().activeSessionId }));
    expect(wand()).toBeDefined();
    expect(wand()?.disabled).toBe(false);

    await act(async () => { usePlanRewrite.setState({ busy: { pb1: true }, failed: {} }); });
    expect(host.textContent).toMatch(/Adapting the prompt/);
    expect(wand()?.disabled).toBe(true);

    await act(async () => { usePlanRewrite.setState({ busy: { pb1: false }, failed: {} }); });
    expect(wand()?.disabled).toBe(false);
  });
});
