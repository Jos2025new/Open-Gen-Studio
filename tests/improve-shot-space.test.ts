// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { blobs } = vi.hoisted(() => ({ blobs: new Map<string, Blob>() }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async (id: string) => blobs.get(id),
  putAssetBlob: async (id: string, b: Blob) => { blobs.set(id, b); return `blob:${id}`; },
}));
vi.mock('../src/lib/media', async (orig) => ({
  ...(await orig<typeof import('../src/lib/media')>()),
  probeMedia: async () => ({ width: 1280, height: 720, duration: 5, size: 10 }),
  jpegThumbnail: async () => undefined,
}));

import { ImproveShotButton } from '../src/components/chat/ImproveShotButton';
import { ADAPTERS } from '../src/engine/providers/registry';
import type { Asset, Generation, ModelSchema, ModelSummary } from '../src/engine/types';
import { useStore } from '../src/store/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
afterAll(() => vi.unstubAllGlobals());

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('ImproveShotButton in upscale mode from a Space', () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    blobs.clear();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  it('grants the once-pass to the same Space session that improveShot/runAssetOp validates', async () => {
    const activeSid = useStore.getState().activeSessionId;
    const draftRef = 'fal::veo/draft';
    const upRef = 'fal::fal-ai/bytedance-upscaler/upscale/video';
    const upModel: ModelSummary = { ref: upRef, provider: 'fal', id: 'fal-ai/bytedance-upscaler/upscale/video', name: 'Video Upscaler', kind: 'video', acceptsText: false, acceptsImage: false, acceptsVideo: true, needsVideo: true, tags: ['upscale'] };
    const draftSchema = { ref: draftRef, source: 'openapi', slots: { promptRequired: true }, params: [{ key: 'resolution', label: 'Resolution', role: 'resolution', type: 'enum', options: ['480p', '720p'], default: '480p' }] } as unknown as ModelSchema;
    const upSchema = { ref: upRef, source: 'openapi', slots: { video: { key: 'video_url' }, promptRequired: false }, params: [] } as unknown as ModelSchema;
    const clip: Asset = { id: 'clip1', kind: 'video', mime: 'video/mp4', width: 854, height: 480, duration: 5, sessionId: activeSid, origin: 'generation', createdAt: 1, stored: true, favorite: false };
    const g: Generation = {
      id: 'g_draft', sessionId: activeSid, kind: 'video', prompt: 'ocean wave', modelRef: draftRef, modelName: 'Draft', provider: 'fal',
      settings: { count: 1, resolution: '480p', seed: 7, advanced: {} }, inputs: { refs: [] }, origin: 'composer', status: 'done',
      assetIds: ['clip1'], estimate: { usd: 0.1, approximate: false }, createdAt: 1,
    };
    blobs.set('clip1', new Blob([new Uint8Array([1, 2, 3])], { type: 'video/mp4' }));
    useStore.setState((st) => ({
      spentUsd: 0.9,
      assets: { clip1: clip },
      generations: { [g.id]: g },
      catalog: { ...st.catalog, models: { ...st.catalog.models, [upRef]: upModel }, schemas: { ...st.catalog.schemas, [draftRef]: draftSchema, [upRef]: upSchema } },
      settings: { ...st.settings, keys: { ...st.settings.keys, fal: 'test-key' }, budgetOn: true, budgetUsd: 1, budgetAccepted: null, budgetNoAsk: false },
      ui: { ...st.ui, space: 'create', toasts: [] },
    }));
    const gen = vi.spyOn(ADAPTERS.fal, 'generate').mockResolvedValue({
      outputs: [{ blob: new Blob([new Uint8Array([4, 5, 6])], { type: 'video/mp4' }), mime: 'video/mp4' }],
    });

    try {
      act(() => { root.render(createElement(ImproveShotButton, { g })); });
      const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="Mejorar esta toma"]')!;
      expect(trigger).toBeTruthy();
      trigger.getBoundingClientRect = () => ({ left: 100, top: 100, right: 130, bottom: 130, width: 30, height: 30, x: 100, y: 100, toJSON() {} });
      await act(async () => {
        trigger.click();
        await flush();
      });

      const pop = document.querySelector<HTMLElement>('[role="dialog"][aria-label="Mejorar esta toma"]')!;
      expect(pop).toBeTruthy();
      const continueBtn = [...pop.querySelectorAll<HTMLButtonElement>('.spend-actions button')]
        .find((b) => b.textContent?.includes('Continue once'))!;
      expect(continueBtn).toBeTruthy();

      await act(async () => {
        continueBtn.click();
        await flush();
        await flush();
      });

      expect(useStore.getState().ui.toasts.filter((t) => t.level === 'error')).toEqual([]);
      expect(gen).toHaveBeenCalledTimes(1);
      const upscaled = Object.values(useStore.getState().generations).find((x) => x.op?.id === 'video_upscale');
      expect(upscaled).toBeTruthy();
      expect(upscaled!.sessionId).not.toBe(activeSid);
      expect(useStore.getState().sessions[upscaled!.sessionId]?.hidden).toBe(true);
    } finally {
      gen.mockRestore();
      useStore.setState((st) => ({ ui: { ...st.ui, space: undefined } }));
      act(() => root.unmount());
      host.remove();
    }
  });
});
