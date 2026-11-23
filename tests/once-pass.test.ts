import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener() {} }, document: { addEventListener() {}, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async () => undefined }));
const execute = vi.hoisted(() => vi.fn(async () => ({ outputs: new Map(), failed: [], skipped: [] })));
vi.mock('../src/engine/executor', async (original) => ({ ...(await original<typeof import('../src/engine/executor')>()), executeSteps: execute }));
import { useStore } from '../src/store/store';
import { approvePlan, presentNodeRun } from '../src/engine/agent/runtime';
import { patchNodeData } from '../src/engine/flow/actions';
import { beginOncePass, consumeOnce, llmCallEstimate, overLimit, withOncePass } from '../src/engine/budget';
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
    const card = await presentNodeRun(sid, ['a'], null, undefined, 'main');
    patchNodeData(sid, 'a', { prompt: 'edited after the preview' });
    await withOncePass(sid, (pass) => approvePlan(sid, card.itemId!, pass), null);
    expect(execute).not.toHaveBeenCalled();
    expect((useStore.getState().sessions[sid].feed.find((f) => f.id === card.itemId) as PlanFeedItem).status).toBe('awaiting');
    expect(overLimit(known, sid)).toBe(true);
  });
  it('an action that throws leaves no pass either', async () => {
    await expect(withOncePass(sid, async () => { throw new Error('x'); }, known.usd)).rejects.toThrow('x');
    expect(overLimit(known, sid)).toBe(true);
  });
  it('the approved action passes while it runs, painting does not spend it, and it ends with the action', async () => {
    await withOncePass(sid, async (pass) => {
      for (let i = 0; i < 5; i++) expect(overLimit(known, sid, pass)).toBe(false);
      expect(overLimit(known, 'other', pass)).toBe(true);
    }, known.usd);
    expect(overLimit(known, sid)).toBe(true);
  });
  it('a batch approved once counts as one run: it passes until its first generation, then the next asks', async () => {
    await withOncePass(sid, async (pass) => {
      expect(overLimit({ usd: 3, approximate: false }, sid, pass)).toBe(false);
      consumeOnce(pass); // first generation of the batch
      expect(overLimit({ usd: 3, approximate: false }, sid, pass)).toBe(true);
    }, 3);
    expect(overLimit(known, sid)).toBe(true);
  });
  it('a synchronous action ends its pass too', () => {
    let leaked: import('../src/engine/budget').BudgetPass | undefined;
    withOncePass(sid, (pass) => { leaked = pass; expect(overLimit(known, sid, pass)).toBe(false); }, known.usd);
    expect(overLimit(known, sid, leaked)).toBe(true);
  });
});

describe('one-time spending caps', () => {
  const price = (usd: number | null) => ({ usd, approximate: usd === null });

  it('asks again when a $0.10 approval is followed by a $0.40 estimate', () => {
    withOncePass(sid, (pass) => {
      expect(overLimit(price(0.1), sid, pass)).toBe(false);
      expect(overLimit(price(0.4), sid, pass)).toBe(true);
    }, 0.1);
  });

  it('debits a sequence pass at execution and never for a preview', () => {
    const { pass, end } = beginOncePass(sid, 0.4);
    try {
      expect(overLimit(price(0.25), sid, pass)).toBe(false);
      expect(overLimit(price(0.25), sid, pass)).toBe(false);
      consumeOnce(pass, price(0.25));
      expect(overLimit(price(0.2), sid, pass)).toBe(true);
      expect(overLimit(price(0.15), sid, pass)).toBe(false);
    } finally { end(); }
  });

  it('allows one explicitly unknown spend without authorizing other steps', () => {
    const { pass, end } = beginOncePass(sid, null);
    try {
      expect(overLimit(price(null), sid, pass)).toBe(false);
      expect(overLimit(price(0.4), sid, pass)).toBe(true);
      consumeOnce(pass, price(null));
      expect(overLimit(price(null), sid, pass)).toBe(true);
    } finally { end(); }
  });
});

describe('LLM budget estimates', () => {
  it('asks about missing and unpriced models even when there is budget left, and keeps explicit 0/0 free', () => {
    const st = useStore.getState();
    useStore.setState({ catalog: { ...st.catalog, llm: { ...st.catalog.llm, nanogpt: [
      { id: 'unpriced', name: 'Unpriced', tools: false },
      { id: 'partial', name: 'Partial', tools: false, inputPrice: 1 },
      { id: 'free', name: 'Free', tools: false, inputPrice: 0, outputPrice: 0 },
    ] } } });
    for (const id of ['missing', 'unpriced', 'partial']) {
      const estimate = llmCallEstimate('nanogpt', id);
      expect(estimate.usd, id).toBeNull();
      expect(overLimit(estimate, sid), id).toBe(true);
    }
    expect(llmCallEstimate('nanogpt', 'free')).toEqual(priceFree);
    expect(overLimit(llmCallEstimate('nanogpt', 'free'), sid)).toBe(false);
  });
});

const priceFree = { usd: 0, approximate: false };
