import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async () => undefined }));
import { command, run } from '../src/engine/commands';
import * as actions from '../src/engine/actions';
import { STUDIO_ACTIONS } from '../src/engine/actions.commands';
import { createSession, useStore } from '../src/store/store';

const fetchSpy = vi.fn(async () => { throw new Error('Unexpected fetch'); });
let session: string;
beforeEach(() => {
  const fresh = createSession('Test'); session = fresh.id;
  useStore.setState({ sessions: { [session]: fresh }, activeSessionId: session, assets: {}, generations: {} });
  fetchSpy.mockClear(); globalThis.fetch = fetchSpy as typeof fetch;
});
describe('Studio commands', () => {
  it('covers every exported function and registers mapped commands', () => {
    for (const [name, value] of Object.entries(actions)) if (typeof value === 'function') expect(STUDIO_ACTIONS, name).toHaveProperty(name);
    for (const id of Object.values(STUDIO_ACTIONS)) if (!id.startsWith('-')) expect(command(id), id).toBeDefined();
  });
  it('runs two reads and two writes', async () => {
    useStore.setState({ assets: { a: { id: 'a', kind: 'image', sessionId: session, favorite: false } as never } });
    for (const [cmd, args] of [['studio.budget.problem', { estimate: { usd: 0, approximate: false } }], ['studio.images.accepts', { kind: 'image' }], ['studio.asset.favorite', { assetId: 'a' }], ['studio.asset.attach', { assetId: 'a' }]] as const) {
      expect(await run({ cmd, args, on: { session } }, { caller: 'agent' })).toMatchObject({ ok: true });
    }
    expect(useStore.getState().assets.a.favorite).toBe(true);
    expect(useStore.getState().composer.attachments).toContain('a');
  });
  it('denies every spend and delete without side effects', async () => {
    useStore.setState({ assets: { a: { id: 'a', kind: 'image', sessionId: session } as never }, generations: { g: { id: 'g', sessionId: session } as never } });
    const cases = [ ['studio.generate.start', { kind: 'image' }], ['studio.generation.regenerate', { generationId: 'g' }], ['studio.asset.run_op', { assetId: 'a', op: 'upscale', params: {} }], ['studio.layer.run_op', { docId: 'd', layerId: 'l', op: 'upscale', params: {} }], ['studio.generation.delete', { generationId: 'g' }], ['studio.assets.delete', { ids: ['a'] }], ['studio.session.delete', {}] ] as const;
    const before = useStore.getState();
    for (const [cmd, args] of cases) expect(await run({ cmd, args, on: { session } }, { caller: 'agent' }), cmd).toMatchObject({ ok: false, error: { code: 'denied' } });
    expect(useStore.getState()).toEqual(before); expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('rejects missing targets and extra arguments', async () => {
    expect(await run({ cmd: 'studio.asset.favorite', args: { assetId: 'missing' }, on: { session } }, { caller: 'agent' })).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    expect(await run({ cmd: 'studio.schema.ready', args: { ref: 'x' }, on: { session: 'missing' } }, { caller: 'agent' })).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    expect(await run({ cmd: 'studio.schema.ready', args: { ref: 'x', extra: true }, on: { session } }, { caller: 'agent' })).toMatchObject({ ok: false, error: { code: 'invalid' } });
  });
});
