// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const disk = vi.hoisted(() => ({
  raw: undefined as string | undefined, failSet: false, hangSet: false,
  unblock: undefined as (() => void) | undefined,
  onSet: undefined as (() => Promise<void> | void) | undefined,
  onBlobGet: undefined as (() => Promise<void> | void) | undefined,
  onBlobPut: undefined as (() => Promise<void> | void) | undefined,
}));
const lock = vi.hoisted(() => ({ held: true }));

vi.mock('../src/lib/writerLock', async (orig) => ({ ...(await orig<typeof import('../src/lib/writerLock')>()), holdsWriterLock: () => lock.held, mayStartWork: () => lock.held }));
vi.mock('../src/lib/idb', async () => {
  const { guard } = await import('../src/lib/saveGuard');
  return {
    stateDb: {
      get: async () => disk.raw,
      set: async (_k: string, raw: string | { text(): string }) => {
        const pending = disk.onSet?.();
        if (pending) await pending;
        if (guard.discarding) return 'fail';
        if (!lock.held) return 'browser-only';
        if (disk.hangSet) await new Promise<void>((r) => { disk.unblock = r; });
        if (disk.failSet) throw new Error('IDB write failed');
        disk.raw = typeof raw === 'string' ? raw : raw.text();
        return 'ok';
      },
      del: async () => undefined,
    },
    cacheDb: { get: async () => undefined, set: async () => undefined },
    getAssetBlob: async () => { if (disk.onBlobGet) await disk.onBlobGet(); return new Blob(['img'], { type: 'image/png' }); },
    putAssetBlob: async () => { if (disk.onBlobPut) await disk.onBlobPut(); },
    deleteAssetBlobs: async () => undefined,
  };
});
vi.mock('../src/lib/media', async (orig) => ({ ...(await orig<typeof import('../src/lib/media')>()), probeMedia: async () => ({ width: 512, height: 512 }) }));
vi.mock('../src/engine/design/raster', () => ({ flushRaster: async () => undefined }));

import { guard } from '../src/lib/saveGuard';
import { HttpError } from '../src/lib/http';
import { saveNow, useStore } from '../src/store/store';
import { forgetBalances } from '../src/engine/credit';
import { createGeneration, resumeInterrupted, runGeneration } from '../src/engine/jobs';
import { controllers, running } from '../src/engine/jobState';
import { ADAPTERS } from '../src/engine/providers/registry';
import { LOCAL_IMAGE_REF } from '../src/engine/providers/demo';
import type { Generation, ModelSummary } from '../src/engine/types';
import { mainThread } from './helpers/threads';

const NANO = 'nanogpt::seed';
const sid = () => useStore.getState().activeSessionId;
const genOf = (id: string) => useStore.getState().generations[id];
const imgOut = (tag = 'x', costUsd: number | undefined = 0.1) => ({ outputs: [{ blob: new Blob([tag], { type: 'image/png' }), mime: 'image/png' }], costUsd });
const patchG = (id: string, patch: Partial<Generation>) => useStore.setState((s) => ({ generations: { ...s.generations, [id]: { ...s.generations[id], ...patch } } }));
const rj = (id: string) => ({ provider: 'nanogpt' as const, id, meta: {} });
const reload = async () => { running.clear(); controllers.clear(); await useStore.persist.rehydrate(); await resumeInterrupted(); };
const spent = () => useStore.getState().spentUsd;
const mkAsset = (id: string, g: string) => ({ id, kind: 'image', mime: 'image/png', width: 512, height: 512, sessionId: sid(), origin: 'generated', generationId: g, stored: true, favorite: false, createdAt: 1 }) as never;

beforeEach(() => {
  Object.assign(disk, { raw: undefined, failSet: false, hangSet: false, unblock: undefined, onSet: undefined, onBlobGet: undefined, onBlobPut: undefined });
  lock.held = true; guard.discarding = false;
  running.clear(); controllers.clear(); forgetBalances();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => { throw new Error(`Unexpected fetch: ${url}`); }));
  const st = useStore.getState(), sId = st.activeSessionId;
  const mod = (ref: string, provider: 'nanogpt' | 'local', id: string, usd: number): ModelSummary =>
    ({ ref, provider, id, name: id, kind: 'image', acceptsText: true, acceptsImage: false, tags: [], price: { skus: [{ unit: 'output', usd }] } } as ModelSummary);
  const sch = (ref: string) => ({ ref, params: [], slots: { prompt: 'prompt', promptRequired: true }, source: 'catalog' });
  useStore.setState({
    generations: {}, quotes: {}, spendLog: [], spentUsd: 0, assets: {}, ui: { ...st.ui, toasts: [] },
    settings: { ...st.settings, keys: { ...st.settings.keys, nanogpt: 'k-n' }, budgetOn: false, mutedNotices: [] },
    catalog: { ...st.catalog, models: { [NANO]: mod(NANO, 'nanogpt', 'seed', 0.1), [LOCAL_IMAGE_REF]: mod(LOCAL_IMAGE_REF, 'local', 'studio-image', 0) }, schemas: { [NANO]: sch(NANO), [LOCAL_IMAGE_REF]: { ...sch(LOCAL_IMAGE_REF), price: { skus: [{ unit: 'output', usd: 0 }] } } } } as never,
    sessions: { ...st.sessions, [sId]: { ...st.sessions[sId], feed: [], agents: mainThread({ history: [], notes: [], questionRound: 0, busy: false }) } },
  });
});

afterEach(() => {
  disk.unblock?.();
  running.clear(); controllers.clear();
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

const make = (count: number, modelRef = NANO) => createGeneration({ sessionId: sid(), origin: 'composer', kind: 'image', prompt: 'b', modelRef, settings: { count, advanced: {} }, inputs: { refs: [] } });

describe('Gasto de lotes a medias: lo anotado es lo realmente entregado, una sola vez', () => {
  it('N2: lote síncrono, 2.º envío falla (no red): se anota el 1.º', async () => {
    let n = 0;
    vi.spyOn(ADAPTERS.nanogpt, 'generate').mockImplementation(async () => { if (++n === 2) throw new HttpError(500, 'boom', {}); return imgOut('a'); });
    const g = make(2);
    await expect(runGeneration(g.id)).rejects.toThrow();
    expect(genOf(g.id).assetIds).toHaveLength(1);
    expect(spent()).toBeCloseTo(0.1);
    await reload(); await reload();
    expect(spent()).toBeCloseTo(0.1);
    expect(useStore.getState().spendLog).toHaveLength(1);
  });

  it('N2: recarga a mitad de lote síncrono: se anota lo entregado, una vez tras dos recargas', async () => {
    const g = make(2);
    useStore.setState((s) => ({ assets: { ...s.assets, p0: mkAsset('p0', g.id) } }));
    patchG(g.id, { status: 'running', assetIds: ['p0'], costSoFar: 0.1 });
    await saveNow();
    await reload(); await reload();
    expect(genOf(g.id).status).toBe('error');
    expect(spent()).toBeCloseTo(0.1);
    expect(useStore.getState().spendLog).toHaveLength(1);
  });

  it('N1: recarga a mitad de lote remoto: se cobra lo anterior más el último, una vez', async () => {
    const g = make(2);
    useStore.setState((s) => ({ assets: { ...s.assets, p0: mkAsset('p0', g.id) } }));
    patchG(g.id, { status: 'running', assetIds: ['p0'], costSoFar: 0.1, remoteJob: rj('j2'), sends: [{ id: 'r0', index: 0, status: 'done', remoteJob: rj('j1') }, { id: 'r1', index: 1, status: 'sent', remoteJob: rj('j2') }] });
    await saveNow();
    vi.spyOn(ADAPTERS.nanogpt, 'resume').mockResolvedValue(imgOut('two', 0.1));
    await resumeInterrupted(); await running.get(g.id);
    await reload(); await reload();
    expect(genOf(g.id).assetIds).toHaveLength(2);
    expect(spent()).toBeCloseTo(0.2);
    expect(useStore.getState().spendLog).toHaveLength(1);
  });

  it('N1 parcial: lote remoto que queda a medias suma lo anterior y lo recibido', async () => {
    const g = make(3);
    useStore.setState((s) => ({ assets: { ...s.assets, p0: mkAsset('p0', g.id) } }));
    patchG(g.id, { status: 'running', assetIds: ['p0'], costSoFar: 0.1, remoteJob: rj('j2'), sends: [{ id: 'r0', index: 0, status: 'done', remoteJob: rj('j1') }, { id: 'r1', index: 1, status: 'sent', remoteJob: rj('j2') }] });
    await saveNow();
    vi.spyOn(ADAPTERS.nanogpt, 'resume').mockResolvedValue(imgOut('two', 0.1));
    await resumeInterrupted(); await running.get(g.id);
    expect(genOf(g.id).status).toBe('error');
    expect(spent()).toBeCloseTo(0.2);
    await reload();
    expect(spent()).toBeCloseTo(0.2);
  });

  it('bajo: un envío gratis que falla por red no queda incierto', async () => {
    vi.spyOn(ADAPTERS.local, 'generate').mockRejectedValue(new (await import('../src/lib/http')).NetworkError('down'));
    const g = make(1, LOCAL_IMAGE_REF);
    await expect(runGeneration(g.id)).rejects.toThrow();
    expect(genOf(g.id).lostJob).toBeFalsy();
    expect(genOf(g.id).sends?.some((s) => s.status === 'uncertain') ?? false).toBe(false);
    expect(spent()).toBe(0);
  });
});
