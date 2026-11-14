import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async () => undefined }));
import * as catalog from '../src/engine/catalog';
import { CATALOG_ACTIONS } from '../src/engine/catalog.commands';
import { command, run } from '../src/engine/commands';
import { createSession, useStore } from '../src/store/store';
beforeEach(() => { const s = createSession('Test'); useStore.setState({ sessions: { [s.id]: s }, activeSessionId: s.id }); });
describe('catalog commands', () => {
  it('covers every exported function and registers command ids', () => {
    expect(Object.keys(CATALOG_ACTIONS).sort()).toEqual(Object.keys(catalog).filter((k) => typeof catalog[k as keyof typeof catalog] === 'function').sort());
    for (const id of Object.values(CATALOG_ACTIONS)) if (!id.startsWith('-')) expect(command(id)).toBeDefined();
    expect(CATALOG_ACTIONS.apiKeyFor).toBe('- returns a secret');
  });
  it('writes and reads, chaining the result', async () => {
    const result = await run({ seq: [{ cmd: 'models.agent.pick', args: { model: 'example' } }, { cmd: 'models.agent.pick', args: { model: '$1.model' } }, { cmd: 'models.kind.list', args: { kind: 'image' } }] }, { caller: 'agent' });
    expect(result.ok).toBe(true); expect(useStore.getState().settings.agent.model).toBe('example'); expect(Array.isArray(result.results[2])).toBe(true);
  });
  it('rejects unknown models and extra fields without a change', async () => {
    const before = useStore.getState().composer.image.modelRef;
    expect(await run({ cmd: 'models.model.get', args: { ref: 'missing' } }, { caller: 'agent' })).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    expect(await run({ cmd: 'models.kind.list', args: { kind: 'image', extra: true } }, { caller: 'agent' })).toMatchObject({ ok: false, error: { code: 'invalid' } });
    expect(useStore.getState().composer.image.modelRef).toBe(before);
  });
});
