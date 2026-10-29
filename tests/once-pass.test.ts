import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener() {} }, document: { addEventListener() {}, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async () => undefined }));
const execute = vi.hoisted(() => vi.fn(async () => ({ outputs: new Map(), failed: [], skipped: [] })));
vi.mock('../src/engine/executor', async (original) => ({ ...(await original<typeof import('../src/engine/executor')>()), executeSteps: execute }));
import { useStore } from '../src/store/store';
import { approvePlan, presentNodeRun } from '../src/engine/agent/runtime';
import { patchNodeData } from '../src/engine/flow/actions';
import { consumeOnce, overLimit, withOncePass } from '../src/engine/budget';
import type { Graph, PlanFeedItem } from '../src/engine/types';

/*
 * 2026-10-29 audit: "Continue once" must die with the approved action. If that action never creates a generation
 * (Nodes run whose graph changed, a recovery refused), the pass must not be left alive for another action.
 */
const known = { usd: 0.5, approximate: false };
const data = (title: string) => ({ kind: 'image' as const, title, prompt: 'old', modelRef: 'local::studio-image', settings: { count: 1, advanced: {} }, outputIndex: 0 });
let sid: string;
beforeEach(() => {
  const st = useStore.getState();
  sid = st.activeSessionId;
  const graph: Graph = { nodes: [{ id: 'a', position: { x: 0, y: 0 }, data: data('A') }], edges: [] };
  useStore.setState({ spentUsd: 0.9, sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], graph, feed: [], noAskOverLimit: false } }, settings: { ...st.settings, agent: { ...st.settings.agent, provider: 'offline' }, budgetOn: true, budgetUsd: 1, budgetAccepted: null, budgetNoAsk: false } });
  execute.mockClear();
});

describe('Continue once lives only as long as the approved action', () => {
  it('an approved action that aborts (the graph changed) leaves no pass: the next action asks', async () => {
    const card = await presentNodeRun(sid, ['a']);
    patchNodeData(sid, 'a', { prompt: 'edited after the preview' });
    await withOncePass(sid, () => approvePlan(sid, card.itemId!));
    expect(execute).not.toHaveBeenCalled();
    expect((useStore.getState().sessions[sid].feed.find((f) => f.id === card.itemId) as PlanFeedItem).status).toBe('awaiting');
    expect(overLimit(known, sid)).toBe(true);
  });
  it('an action that throws leaves no pass either', async () => {
    await expect(withOncePass(sid, async () => { throw new Error('x'); })).rejects.toThrow('x');
    expect(overLimit(known, sid)).toBe(true);
  });
  it('the approved action passes while it runs, painting does not spend it, and it ends with the action', async () => {
    await withOncePass(sid, async () => {
      for (let i = 0; i < 5; i++) expect(overLimit(known, sid)).toBe(false);
      expect(overLimit(known, 'other')).toBe(true);
    });
    expect(overLimit(known, sid)).toBe(true);
  });
  it('a batch approved once counts as one run: it passes until its first generation, then the next asks', async () => {
    await withOncePass(sid, async () => {
      expect(overLimit({ usd: 3, approximate: false }, sid)).toBe(false);
      consumeOnce(sid); // first generation of the batch
      expect(overLimit({ usd: 3, approximate: false }, sid)).toBe(true);
    });
    expect(overLimit(known, sid)).toBe(true);
  });
  it('a synchronous action ends its pass too', () => {
    withOncePass(sid, () => { expect(overLimit(known, sid)).toBe(false); });
    expect(overLimit(known, sid)).toBe(true);
  });
});
