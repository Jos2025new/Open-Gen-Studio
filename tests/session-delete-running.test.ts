import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * C: deleting a session while one of its generations runs. It is not canceled (the provider may charge anyway): it
 * finishes, its charge reaches Spending once, then it and its results are removed. The provider is mocked.
 */

const gate = vi.hoisted(() => {
  const g = {
    wait: Promise.resolve<'ok' | 'fail'>('ok'),
    open: (_o: 'ok' | 'fail'): void => undefined,
    reset: () => { g.wait = new Promise((r) => (g.open = r)); },
  };
  return g;
});
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => new Blob([new Uint8Array(1)], { type: 'image/png' }),
  putAssetBlob: async () => undefined,
  deleteAssetBlobs: async () => undefined,
  loadAssetUrl: async () => null,
  assetBlobKey: (id: string) => `asset:${id}`,
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
        generate: async () => {
          const outcome = await gate.wait;
          if (outcome === 'fail') throw new Error('Atlas Cloud: failed');
          return { outputs: [{ blob: new Blob(['x'], { type: 'image/png' }), mime: 'image/png' }], costUsd: 0.05 };
        },
      },
    },
  };
});

import { createGeneration, runGeneration } from '../src/engine/jobs';
import { deleteSession } from '../src/engine/actions';
import { newSession, useStore } from '../src/store/store';
import type { ModelSummary } from '../src/engine/types';

const REF = 'atlas::google/nano-banana-2-lite/text-to-image';
const model = { id: REF, name: 'nb', provider: 'atlas', kind: 'image', acceptsImage: false, tags: [] } as unknown as ModelSummary;

beforeEach(() => {
  gate.reset();
  vi.stubGlobal('fetch', async () => new Response('{}', { status: 503 }));
  const st = useStore.getState();
  useStore.setState({
    spendLog: [],
    settings: { ...st.settings, keys: { ...st.settings.keys, atlas: 'k' } },
    catalog: { ...st.catalog, models: { [REF]: model }, schemas: { [REF]: { ref: REF, params: [], slots: {}, source: 'derived' } } },
  });
});
afterEach(() => vi.unstubAllGlobals());

function startInNewSession() {
  const sid = newSession();
  const g = createGeneration({ sessionId: sid, kind: 'image', prompt: 'x', modelRef: REF, settings: { count: 1, advanced: {} }, inputs: { refs: [] }, origin: 'composer' });
  const run = runGeneration(g.id).catch((e: Error) => e);
  return { sid, id: g.id, run };
}
const tick = () => new Promise((r) => setTimeout(r, 10));

describe('deleting a session with a generation running (C)', () => {
  it('the generation finishes, is charged once, and it and its results are removed', async () => {
    const { sid, id, run } = startInNewSession();
    await tick();
    deleteSession(sid);
    expect(useStore.getState().generations[id]?.discard).toBe(true);
    gate.open('ok');
    await run;
    const st = useStore.getState();
    expect(st.generations[id]).toBeUndefined();
    expect(Object.values(st.assets).filter((a) => a.generationId === id || a.sessionId === sid)).toEqual([]);
    expect(st.spendLog.filter((e) => e.sessionId === sid).map((e) => e.usd)).toEqual([0.05]);
  });

  it('a failure after the delete removes it too and charges nothing it did not deliver', async () => {
    const { sid, id, run } = startInNewSession();
    await tick();
    deleteSession(sid);
    gate.open('fail');
    await run;
    const st = useStore.getState();
    expect(st.generations[id]).toBeUndefined();
    expect(st.spendLog.filter((e) => e.sessionId === sid)).toEqual([]);
  });
});
