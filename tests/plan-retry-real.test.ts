import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const disk = vi.hoisted(() => ({ raw: undefined as string | undefined }));
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener() {} },
  document: { addEventListener() {}, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => disk.raw, set: async (_k: string, raw: string | { text(): string }) => { disk.raw = typeof raw === "string" ? raw : raw.text(); }, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => new Blob(['test'], { type: 'image/png' }), putAssetBlob: async () => undefined,
}));
vi.mock('../src/lib/media', async (original) => ({ ...await original<typeof import('../src/lib/media')>(),
  probeMedia: async () => ({ width: 1, height: 1 }) }));

import { useStore } from '../src/store/store';
import { createGeneration } from '../src/engine/jobs';
import { ADAPTERS } from '../src/engine/providers/registry';
import { costAuthorization } from '../src/engine/priceAuthorization';
import { resumePlan } from '../src/engine/agent/runtime';
import type { ModelSummary, PlanFeedItem } from '../src/engine/types';
import { agentsWith, mainThread } from './helpers/threads';

/* Retry with the REAL retryGeneration and a simulated adapter (the plan-recovery test replaces jobs): the first send is lost, the retry runs once, and the step that waited for it gets the NEW attempt's result. */
const REF = 'nanogpt::test-image';
const sid = () => useStore.getState().activeSessionId;
const plan = () => useStore.getState().sessions[sid()].feed.find((f): f is PlanFeedItem => f.type === 'plan')!;
let calls: unknown[];

beforeEach(() => {
  calls = [];
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ data: [] })));
  const st = useStore.getState();
  useStore.setState({
    generations: {}, quotes: {}, assets: {}, spendLog: [], spentUsd: 0,
    settings: { ...st.settings, keys: { ...st.settings.keys, nanogpt: 'test-only' }, budgetOn: false },
    catalog: { ...st.catalog, models: { [REF]: { ref: REF, provider: 'nanogpt', id: 'test-image', name: 'Test', kind: 'image', acceptsText: true, acceptsImage: true, tags: [], price: { skus: [{ unit: 'output', usd: 0.1 }] } } as ModelSummary },
      schemas: { [REF]: { ref: REF, params: [], slots: { prompt: 'prompt', promptRequired: true, images: 'image', maxImages: 4 }, source: 'catalog' } } },
    sessions: { ...st.sessions, [st.activeSessionId]: { ...st.sessions[st.activeSessionId], feed: [], agentMetrics: [], agents: mainThread({ history: [], notes: [], questionRound: 0, busy: false }) } },
  });
  let n = 0;
  vi.spyOn(ADAPTERS.nanogpt, 'generate').mockImplementation(async (...args: unknown[]) => {
    calls.push(args[0]);
    if (++n === 0) throw new Error('Network error reaching nano-gpt.com.');
    return { outputs: [{ blob: new Blob([`image${n}`], { type: 'image/png' }), mime: 'image/png' }], costUsd: 0.1 };
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Retry failed with the real retryGeneration', () => {
  it('sends the lost step once more and the dependent step receives the new attempt\'s image, not the failed one\'s', async () => {
    const settings = { count: 1, resolution: 'new', advanced: {} };
    const steps = [
      { id: 's1', title: 'A', kind: 'image' as const, prompt: 'a', modelRef: REF, settings, refs: [] },
      { id: 's2', title: 'B', kind: 'image' as const, prompt: 'b', modelRef: REF, settings, refs: ['s1'] },
    ];
    const g = createGeneration({ sessionId: sid(), origin: 'agent', kind: 'image', prompt: 'a', modelRef: REF, settings, inputs: { refs: [] }, planId: 'P', stepId: 's1' });
    const auth = costAuthorization(REF, settings, { usd: 0.1, approximate: false });
    const item: PlanFeedItem = { id: 'card', workspace: 'chat', createdAt: 1, type: 'plan', style: 'guided', status: 'error',
      plan: { id: 'P', title: 'P', summary: 'x', workspace: 'chat', steps, adjustments: [] },
      stepStates: { s1: 'error', s2: 'skipped' }, stepGenerations: { s1: g.id }, stepAuthorizations: { s1: auth, s2: auth }, estimate: { usd: 0.2, approximate: false }, error: 's1: Network error' };
    useStore.setState((s) => ({ generations: { ...s.generations, [g.id]: { ...g, status: 'error', error: 'Network error reaching nano-gpt.com.' } },
      sessions: { ...s.sessions, [sid()]: { ...s.sessions[sid()], feed: [item] } } }));
    await resumePlan(sid(), 'card', 'retry', true);
    expect(plan().error ?? '').toBe('');
    expect(plan().status).toBe('done');
    expect(calls).toHaveLength(2); // the retry of s1 + s2 (the lost first send happened before the test)
    const retried = Object.values(useStore.getState().generations).filter((x) => x.stepId === 's1' && x.status === 'done');
    expect(retried).toHaveLength(1);
    const s2 = Object.values(useStore.getState().generations).find((x) => x.stepId === 's2')!;
    // s2 was built from the retried attempt's asset.
    expect(JSON.stringify(s2.inputs)).toContain(retried[0].assetIds[0]);
  });
});
