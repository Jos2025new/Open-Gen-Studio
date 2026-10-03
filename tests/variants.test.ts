import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { ADAPTERS } from '../src/engine/providers/registry';
import { createGeneration, runGeneration } from '../src/engine/jobs';
import { LOCAL_IMAGE_REF } from '../src/engine/providers/demo';
import { useStore } from '../src/store/store';

describe('candidates with their own variation', () => {
  it('each result is its own request: the shared prompt plus its variation', async () => {
    const prompts: string[] = [];
    const real = ADAPTERS.local.generate;
    ADAPTERS.local.generate = async (req) => {
      prompts.push(req.prompt);
      expect(req.count).toBe(1);
      return { outputs: [] };
    };
    try {
      const g = createGeneration({ sessionId: useStore.getState().activeSessionId, kind: 'image', prompt: 'gamer girl sheet', modelRef: LOCAL_IMAGE_REF, settings: { count: 2, advanced: {} }, origin: 'agent', variants: ['pink hair', 'black braids'] });
      await runGeneration(g.id).catch(() => undefined);
    } finally {
      ADAPTERS.local.generate = real;
    }
    expect(prompts[0]).toMatch(/gamer girl sheet\npink hair$/);
  });
});
