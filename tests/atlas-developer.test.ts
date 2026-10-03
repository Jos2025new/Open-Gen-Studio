import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * T4: Atlas developer variants one at a time, and one automatic retry against "Upstream access denied".
 * Both real failures with Atlas (2 of 2) were that message on a *-developer id, while the same plan ran two
 * generations of that model at once. The provider is mocked: no request, no cost.
 */

const events = vi.hoisted(() => [] as Array<{ model: string; at: string }>);
const denials = vi.hoisted(() => new Map<string, number>());
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => new Blob([new Uint8Array(1)], { type: 'image/png' }),
  putAssetBlob: async () => undefined,
}));
vi.mock('../src/lib/media', async (orig) => ({
  ...(await orig<typeof import('../src/lib/media')>()),
  blobToCanvas: async () => ({ width: 768, height: 768 }),
  createCanvas: (w: number, h: number) => ({ width: w, height: h }),
  ctx2d: () => ({ drawImage: () => undefined }),
  canvasToBlob: async () => new Blob(['x'], { type: 'image/png' }),
}));
vi.mock('../src/engine/providers/registry', async (orig) => {
  const real = await orig<typeof import('../src/engine/providers/registry')>();
  return {
    ...real,
    ADAPTERS: {
      ...real.ADAPTERS,
      atlas: {
        ...real.ADAPTERS.atlas,
        generate: async (req: { model: { id: string } }) => {
          events.push({ model: req.model.id, at: 'start' });
          const left = denials.get(req.model.id) ?? 0;
          if (left > 0) {
            denials.set(req.model.id, left - 1);
            events.push({ model: req.model.id, at: 'end' });
            throw new Error('Atlas Cloud: Upstream access denied, please contact administrator.');
          }
          await new Promise((r) => setTimeout(r, 30));
          events.push({ model: req.model.id, at: 'end' });
          return { outputs: [{ blob: new Blob(['x'], { type: 'image/png' }), mime: 'image/png' }] };
        },
      },
    },
  };
});

import { ATLAS_RETRY_MS, createGeneration, runGeneration } from '../src/engine/jobs';
import { useStore } from '../src/store/store';
import type { ModelSummary } from '../src/engine/types';

const DEV = 'atlas::google/nano-banana-2-lite/text-to-image-developer';
const NORMAL = 'atlas::google/nano-banana-2-lite/text-to-image';

const model = (id: string): ModelSummary => ({ id, name: id.split('/').pop()!, provider: 'atlas', kind: 'image', acceptsImage: false, tags: [], price: undefined } as unknown as ModelSummary);
const schema = (ref: string) => ({ ref, params: [], slots: {}, source: 'derived' as const });
const gen = (modelRef: string) =>
  createGeneration({ sessionId: useStore.getState().activeSessionId, kind: 'image', prompt: 'chica', modelRef, settings: { count: 1, advanced: {} }, inputs: { refs: [] }, origin: 'agent' });
const order = () => events.map((e) => `${e.at}:${e.model.replace(/^.*\//, '')}`);

beforeEach(() => {
  events.length = 0;
  denials.clear();
  // No network: the exact-price quote and anything else the runner asks for is refused at once.
  vi.stubGlobal('fetch', async () => new Response('{}', { status: 503 }));
  const st = useStore.getState();
  useStore.setState({
    settings: { ...st.settings, keys: { ...st.settings.keys, atlas: 'k' } },
    catalog: { ...st.catalog, models: { [DEV]: model(DEV), [NORMAL]: model(NORMAL) }, schemas: { [DEV]: schema(DEV), [NORMAL]: schema(NORMAL) } },
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Atlas developer variants (T4)', () => {
  it('two requests to the same developer model never overlap; different models still run together', async () => {
    const a = gen(DEV);
    const b = gen(DEV);
    const other = gen(NORMAL);
    await Promise.all([runGeneration(a.id), runGeneration(b.id), runGeneration(other.id)]);
    const dev = order().filter((e) => e.endsWith('text-to-image-developer'));
    // The two requests to the same model took turns: start, end, start, end.
    expect(dev).toEqual(['start:text-to-image-developer', 'end:text-to-image-developer', 'start:text-to-image-developer', 'end:text-to-image-developer']);
    // The normal model was not made to wait behind the developer one.
    const firstDevEnd = order().findIndex((e) => e === 'end:text-to-image-developer');
    expect(order().indexOf('start:text-to-image')).toBeLessThan(firstDevEnd);
  });

  it('"Upstream access denied" is tried once more on its own, and the card says so', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    denials.set(DEV, 1);
    const g = gen(DEV);
    const run = runGeneration(g.id);
    await run;
    const done = useStore.getState().generations[g.id];
    expect(done.status).toBe('done');
    expect(done.assetIds).toHaveLength(1);
    expect(order().filter((e) => e === 'start:text-to-image-developer')).toHaveLength(2);
    // The card keeps what happened, after it is over.
    expect(done.notes?.join(' ')).toMatch(/access denied/i);
  }, 20_000);

  it('denied twice: no third attempt, and the provider message stands', async () => {
    vi.useFakeTimers();
    denials.set(DEV, 2);
    const g = gen(DEV);
    const run = runGeneration(g.id).catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(ATLAS_RETRY_MS * 3);
    const err = await run;
    vi.useRealTimers();
    expect((err as Error).message).toMatch(/Upstream access denied/);
    expect(order().filter((e) => e === 'start:text-to-image-developer')).toHaveLength(2);
    expect(useStore.getState().generations[g.id].status).toBe('error');
  });
});
