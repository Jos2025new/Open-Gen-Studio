import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener() {} }, document: { addEventListener() {}, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async () => undefined }));
const execute = vi.hoisted(() => vi.fn(async () => ({ outputs: new Map(), failed: [], skipped: [] })));
vi.mock('../src/engine/executor', async (original) => ({ ...(await original<typeof import('../src/engine/executor')>()), executeSteps: execute }));
import { createSession, useStore } from '../src/store/store';
import { planRecoveryProblem } from '../src/engine/agent/planRun';
import { budgetProblem } from '../src/engine/actions';
import { runNodes } from '../src/engine/flow/actions';
import type { Generation, Graph, ModelSummary, PlanFeedItem } from '../src/engine/types';

/*
 * 2026-10-29 audit: an operation of session A must follow A's "Don't ask again", not the rule of whichever session is active.
 */
const ref = 'fal::fal-ai/priced';
const known = { usd: 0.5, approximate: false };
const planItem = { id: 'p1', createdAt: 0, workspace: 'chat', type: 'plan', status: 'error', skipped: [], stepStates: { s1: 'error' }, stepGenerations: { s1: 'g1' },
  plan: { id: 'pl', title: 't', workspace: 'chat', steps: [{ id: 's1', kind: 'image', title: 'A', prompt: 'a', modelRef: ref, settings: { count: 1, advanced: {} }, refs: [] }] } } as unknown as PlanFeedItem;
const graph: Graph = { nodes: [{ id: 'n', position: { x: 0, y: 0 }, data: { kind: 'image', title: 'N', prompt: 'a cat', modelRef: ref, settings: { count: 1, advanced: {} }, outputIndex: 0 } }], edges: [] };

/** A has «Don't ask again» (or not), B is the active session. */
function setup(aNoAsk: boolean, bNoAsk: boolean) {
  const st = useStore.getState();
  const m = { ref, provider: 'fal', id: 'fal-ai/priced', name: 'p', kind: 'image', acceptsText: true, acceptsImage: false, tags: [], price: { skus: [{ usd: 0.5, unit: 'output' }] } } as unknown as ModelSummary;
  useStore.setState({
    spentUsd: 5, activeSessionId: 'B',
    sessions: { A: { ...createSession(), id: 'A', graph, noAskOverLimit: aNoAsk }, B: { ...createSession(), id: 'B', noAskOverLimit: bNoAsk } },
    generations: { g1: { id: 'g1', status: 'error', kind: 'image', modelRef: ref, assetIds: [], settings: { count: 1, advanced: {} }, estimate: known, remoteJob: { provider: 'fal', id: 'j', meta: {} } } as unknown as Generation },
    catalog: { ...st.catalog, models: { [ref]: m }, schemas: { [ref]: { ref, params: [], source: 'openapi', slots: { prompt: 'prompt' } } } },
    settings: { ...st.settings, keys: { ...st.settings.keys, fal: 'k' }, budgetOn: true, budgetUsd: 5, budgetAccepted: null, budgetNoAsk: false },
  } as never);
  execute.mockClear();
}
beforeEach(() => setup(true, false));

describe('limit checks use the session of the operation, not the active one', () => {
  it('recovery of A follows A’s rule while B is active, and the reverse', () => {
    expect(planRecoveryProblem(planItem, 'retry', 'A')).toBeNull();
    setup(false, true);
    expect(planRecoveryProblem(planItem, 'retry', 'A')).toMatch(/limit/);
  });
  it('a general budget check names the session it is for', () => {
    expect(budgetProblem(known, 'A')).toBeNull();
    expect(budgetProblem(known, 'B')).toMatch(/limit/);
  });
  it('runNodes of A follows A’s rule while B is active, and asks when A has none', async () => {
    await runNodes('A', ['n']);
    expect(execute).toHaveBeenCalledTimes(1);
    setup(false, true);
    await runNodes('A', ['n']);
    expect(execute).not.toHaveBeenCalled();
  });
});
