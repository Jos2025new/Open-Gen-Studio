import { describe, expect, it, vi } from 'vitest';

/* A reference a step declares must resolve: missing = visible error and no provider call (it used to be skipped). */
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));
const created = vi.hoisted(() => [] as unknown[]);
vi.mock('../src/engine/jobs', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/engine/jobs')>();
  return { ...real, createGeneration: (spec: unknown) => { created.push(spec); throw new Error('provider reached'); } };
});
import { executeSteps } from '../src/engine/executor';
import { useStore } from '../src/store/store';
import type { ImageStep } from '../src/engine/types';

describe('required references', () => {
  it('a reference with no output stops the step before any generation is created', async () => {
    const step: ImageStep = { id: 's1', kind: 'image', title: 's1', prompt: 'p', modelRef: 'local::studio-image', settings: { count: 1, advanced: {} }, refs: ['asset:ghost'] };
    const result = await executeSteps([step], { sessionId: useStore.getState().activeSessionId, workspace: 'create' as never, origin: 'agent' as never, onState: () => undefined });
    expect(created).toHaveLength(0);
    expect(result.failed[0]?.error).toMatch(/Missing reference "asset:ghost"/);
  });
});
