import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Auto changes the provider when the composer's one cannot take what the user asked and the same model and variant at
 * another connected provider can (providerFit). A provider the user named in words is never changed.
 * User, 2026-10-24: «si en un proveedor el modelo no admite 480p sino 720p … el mismo modelo en openrouter».
 */
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { betterProvider, missing } from '../src/engine/agent/providerFit';
import { useStore } from '../src/store/store';
import type { ModelSchema, ModelSummary } from '../src/engine/types';

const NANO = 'nanogpt::bytedance-seedance-2-0-mini';
const OR = 'openrouter::bytedance/seedance-2.0-mini';
const before = useStore.getState();
afterEach(() => useStore.setState(before));

const video = (ref: string, provider: string, res: string[]): [ModelSummary, ModelSchema] => [
  { ref, id: ref.split('::')[1], provider, kind: 'video', name: 'Seedance 2.0 Mini', acceptsText: true, acceptsImage: false, tags: [] } as unknown as ModelSummary,
  { ref, source: 'catalog', slots: { prompt: 'prompt' }, params: [
    { key: 'resolution', label: 'Resolution', role: 'resolution', type: 'enum', options: res },
    { key: 'duration', label: 'Duration', role: 'duration', type: 'enum', options: ['5', '8', '12'] },
  ] } as unknown as ModelSchema,
];

beforeEach(() => {
  const list = [video(NANO, 'nanogpt', ['720p', '1080p']), video(OR, 'openrouter', ['480p', '720p'])];
  const s = useStore.getState();
  useStore.setState({
    settings: { ...s.settings, keys: { ...s.settings.keys, nanogpt: 'k', openrouter: 'k' } },
    catalog: { ...s.catalog, status: { ...s.catalog.status, nanogpt: 'ready', openrouter: 'ready' }, models: { ...s.catalog.models, ...Object.fromEntries(list.map(([m]) => [m.ref, m])) }, schemas: { ...s.catalog.schemas, ...Object.fromEntries(list.map(([m, sc]) => [m.ref, sc])) } },
  });
});

const want = { resolution: '480p', duration: 12, startImage: false, images: 0 };

describe('provider that fits what was asked (Auto)', () => {
  it('says what a schema cannot take', () => {
    expect(missing(useStore.getState().catalog.schemas[NANO], want)).toEqual(['480p']);
    expect(missing(useStore.getState().catalog.schemas[OR], want)).toEqual([]);
  });
  it('480p asked, composer on NanoGPT without it: the same model at OpenRouter, with a note for the agent to tell the user', async () => {
    const got = await betterProvider(NANO, want, 'un video con seedance 2.0 mini 480p');
    expect(got?.ref).toBe(OR);
    expect(got?.note).toContain('Provider changed');
    expect(got?.note).toContain('480p');
  });
  it('a provider the user named in words is never changed', async () => {
    expect(await betterProvider(NANO, want, 'un video con seedance 2.0 mini en NanoGPT a 480p')).toBeUndefined();
  });
  it('the composer one takes it: nothing changes', async () => {
    expect(await betterProvider(NANO, { ...want, resolution: '720p' }, 'un video a 720p')).toBeUndefined();
  });
});
