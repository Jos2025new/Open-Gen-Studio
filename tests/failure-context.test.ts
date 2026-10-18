// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { failedStepSummary } from '../src/engine/agent/failureContext';
import { newSession, useStore } from '../src/store/store';

describe('failed step context with partial provider delivery', () => {
  beforeEach(() => {
    const sessionId = newSession();
    const st = useStore.getState();
    const ref = 'atlas::google/nano-banana-2-lite/text-to-image';
    useStore.setState({
      generations: {
        gen_partial: {
          id: 'gen_partial', sessionId, kind: 'image', prompt: 'fixture', modelRef: ref,
          modelName: 'Nano Banana 2 Text-to-Image Developer', provider: 'atlas',
          settings: { count: 2, advanced: {} }, assetIds: ['asset_delivered'], status: 'error',
        } as never,
      },
      assets: { asset_delivered: { id: 'asset_delivered' } as never },
      catalog: { ...st.catalog, schemas: { [ref]: { ref, params: [], slots: {}, source: 'catalog' } } },
      sessions: {
        ...st.sessions,
        [sessionId]: {
          ...st.sessions[sessionId],
          feed: [{ id: 'plan_partial', type: 'plan', stepGenerations: { s1: 'gen_partial' } } as never],
        },
      },
    });
  });

  it('reports delivered and remaining results and recommends revising a content-blocked request', () => {
    const sessionId = useStore.getState().activeSessionId;
    const error = 'Content violates platform security policy and has been blocked. Please adjust your prompt or reference media and try again. [Atlas code 1012000]';

    const summary = failedStepSummary(sessionId, 'plan_partial', 's1', error);

    expect(summary).toContain('Nano Banana 2 Text-to-Image Developer');
    expect(summary).toContain('provider atlas');
    expect(summary).toContain('schema: catalog');
    expect(summary).toContain('1 of 2 results');
    expect(summary).toContain('asset_delivered');
    expect(summary).toContain('1 result remains');
    expect(summary).toContain(error);
    expect(summary).toMatch(/safety policy/i);
    expect(summary).toMatch(/do not.*retry/i);
    expect(summary).toMatch(/adjust.*prompt or reference/i);
  });

  it('uses the variant total when it exceeds settings.count', () => {
    const sessionId = useStore.getState().activeSessionId;
    useStore.setState((st) => ({
      generations: { ...st.generations, gen_partial: { ...st.generations.gen_partial, settings: { count: 1, advanced: {} }, variants: ['v2', 'v3', 'v4'] } as never },
    }));
    const summary = failedStepSummary(sessionId, 'plan_partial', 's1', 'generic error');
    expect(summary).toContain('1 of 3 results');
    expect(summary).toContain('2 results remain');
    expect(summary).not.toMatch(/safety policy|blindly retry|adjust the prompt/i);
  });

  it('reports zero delivered results and all requested results remaining', () => {
    const sessionId = useStore.getState().activeSessionId;
    useStore.setState((st) => ({ generations: { ...st.generations, gen_partial: { ...st.generations.gen_partial, assetIds: [] } as never }, assets: {} }));
    const summary = failedStepSummary(sessionId, 'plan_partial', 's1', 'generic error');
    expect(summary).toContain('0 of 2 results');
    expect(summary).toContain('asset IDs: none');
    expect(summary).toContain('2 results remain');
  });

  it('keeps the plain fallback when the generation is missing', () => {
    expect(failedStepSummary(useStore.getState().activeSessionId, 'missing_plan', 's9', 'boom')).toBe('s9 failed (boom)');
  });
});
