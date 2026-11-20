import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener() {} }, document: { addEventListener() {}, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => new Blob([new Uint8Array([1])], { type: 'image/png' }), putAssetBlob: async () => undefined }));
vi.mock('../src/lib/media', async (orig) => ({ ...(await orig<typeof import('../src/lib/media')>()), probeMedia: async () => ({ width: 64, height: 64, size: 1 }), jpegThumbnail: async () => undefined }));
import { useStore } from '../src/store/store';
import { askAgain, dontAskAgain, beginOncePass, dontAskUntilNextSession, OverLimitError, withOncePass } from '../src/engine/budget';
import { costAuthorization } from '../src/engine/priceAuthorization';
import { createGeneration, type GenerationSpec } from '../src/engine/jobs';
import { runNodes } from '../src/engine/flow/actions';
import { approvePlan, presentNodeRun } from '../src/engine/agent/runtime';
import { ADAPTERS } from '../src/engine/providers/registry';
import type { Graph, ModelSchema, ModelSummary, PlanFeedItem } from '../src/engine/types';

/*
 * Opus #6: «new paid runs will ask first» is checked where the send is made (createGeneration), not only at the
 * entries. (a) an entry that never asked is stopped; (b) everything an entry already approved goes through once.
 */
const REF = 'local::studio-image';
const settings = { count: 1, advanced: {} };
const paid = { usd: 0.5, approximate: false };
let sid: string;
const spec = (over: Partial<GenerationSpec> = {}): GenerationSpec => ({ sessionId: sid, origin: 'composer', kind: 'image', prompt: 'x', modelRef: REF, settings, estimate: paid, ...over });
const count = () => Object.keys(useStore.getState().generations).length;

beforeEach(() => {
  const st = useStore.getState();
  sid = st.activeSessionId;
  askAgain(sid);
  useStore.setState({ generations: {}, spentUsd: 0.9, sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], feed: [], noAskOverLimit: false } }, settings: { ...st.settings, budgetOn: true, budgetUsd: 1, budgetAccepted: null, budgetNoAsk: false } });
});

describe('(a) a new entry that never asked is stopped at the send', () => {
  it('a paid run over the limit with no pass is refused with the typed error and creates nothing', () => {
    expect(() => createGeneration(spec())).toThrow(OverLimitError);
    expect(count()).toBe(0);
  });
  it('a known price over what is left is refused even by a model the catalog prices lower in the composer', () => {
    useStore.setState({ spentUsd: 0.99 });
    expect(() => createGeneration(spec({ estimate: { usd: 0.02, approximate: false } }))).toThrow(OverLimitError);
  });
  it('an unpublished price needs approval when the limit is active', () => {
    const unpriced = spec({ estimate: { usd: null, approximate: true } });
    expect(() => createGeneration(unpriced)).toThrow(OverLimitError);
    expect(count()).toBe(0);
    withOncePass(sid, () => createGeneration(unpriced));
    expect(count()).toBe(1);
    expect(() => createGeneration(unpriced)).toThrow(OverLimitError);
  });
  it('another session\'s pass does not cover it', () => {
    withOncePass('other', () => expect(() => createGeneration(spec())).toThrow(OverLimitError));
  });
  it('free runs, runs within the limit and runs with no limit are not touched', () => {
    createGeneration(spec({ estimate: { usd: 0, approximate: false } }));
    createGeneration(spec({ estimate: { usd: 0.05, approximate: false } }));
    useStore.setState((s) => ({ settings: { ...s.settings, budgetOn: false } }));
    createGeneration(spec({ estimate: { usd: 50, approximate: false } }));
    expect(count()).toBe(3);
  });
});

describe('(b) what an entry already approved keeps going without a second question', () => {
  it('Continue once (and a user Retry or Regenerate, which run inside it) creates the generation, and the pass dies with the action', async () => {
    await withOncePass(sid, async () => { createGeneration(spec()); });
    expect(count()).toBe(1);
    expect(() => createGeneration(spec())).toThrow(OverLimitError);
  });
  it('"Allow this time" covers every send of its sequence until it ends', () => {
    const end = beginOncePass(sid);
    createGeneration(spec());
    createGeneration(spec());
    end();
    expect(count()).toBe(2);
    expect(() => createGeneration(spec())).toThrow(OverLimitError);
  });
  it('"Don\'t ask again" and "until next session" go through', () => {
    dontAskAgain(sid);
    createGeneration(spec());
    useStore.setState((s) => ({ sessions: { ...s.sessions, [sid]: { ...s.sessions[sid], noAskOverLimit: false } } }));
    expect(() => createGeneration(spec())).toThrow(OverLimitError);
    dontAskUntilNextSession();
    createGeneration(spec());
    expect(count()).toBe(2);
  });
  it('a step of an approved plan (stepAuthorizations) goes through with no pass, also after the pass of its approval is spent', () => {
    const steps = [{ id: 's1', title: 'A', kind: 'image' as const, prompt: 'a', modelRef: REF, settings, refs: [] }, { id: 's2', title: 'B', kind: 'image' as const, prompt: 'b', modelRef: REF, settings, refs: [] }];
    const auth = costAuthorization(REF, settings, paid);
    const item: PlanFeedItem = { id: 'card', workspace: 'chat', createdAt: 1, type: 'plan', style: 'guided', status: 'running',
      plan: { id: 'P', title: 'P', summary: 'x', workspace: 'chat', steps, adjustments: [] },
      stepStates: { s1: 'running' }, stepGenerations: {}, stepAuthorizations: { s1: auth }, estimate: { usd: 1, approximate: false } };
    useStore.setState((s) => ({ sessions: { ...s.sessions, [sid]: { ...s.sessions[sid], feed: [item] } } }));
    createGeneration(spec({ origin: 'agent', planId: 'P', stepId: 's1' }));
    expect(count()).toBe(1);
    // A step nobody authorized, or a plan that left the chat, is not covered.
    expect(() => createGeneration(spec({ origin: 'agent', planId: 'P', stepId: 's2' }))).toThrow(OverLimitError);
    expect(() => createGeneration(spec({ origin: 'agent', planId: 'GONE', stepId: 's1' }))).toThrow(OverLimitError);
  });
  it('a multi-step Nodes run with an active limit and unknown price sends every step once confirmed (both direct runNodes and a nodeRun card)', async () => {
    const modelRef = 'fal::unpriced-img';
    const model: ModelSummary = { ref: modelRef, provider: 'fal', id: 'unpriced-img', name: 'Unpriced Img', kind: 'image', acceptsText: true, acceptsImage: true };
    const schema: ModelSchema = { ref: modelRef, source: 'schema', slots: { images: { min: 0, max: 4 }, promptRequired: true }, params: [] };
    const node = (id: string, title: string) => ({ id, position: { x: 0, y: 0 }, data: { kind: 'image' as const, title, prompt: title, modelRef, settings: { count: 1, advanced: {} }, outputIndex: 0 } });
    const graph: Graph = { nodes: [node('a', 'Step A'), node('b', 'Step B')], edges: [{ id: 'e1', source: 'a', target: 'b', sourceHandle: 'out', targetHandle: 'ref' }] };
    const st = useStore.getState();
    useStore.setState({
      assets: {},
      catalog: { ...st.catalog, models: { ...st.catalog.models, [modelRef]: model }, schemas: { ...st.catalog.schemas, [modelRef]: schema } },
      settings: { ...st.settings, keys: { ...st.settings.keys, fal: 'test-key' }, agent: { ...st.settings.agent, provider: 'offline' } },
      sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], graph, feed: [], noAskOverLimit: false } },
    });
    const out = { outputs: [{ blob: new Blob([new Uint8Array([1])], { type: 'image/png' }), mime: 'image/png' }] };
    let midRunRefused = false;
    const gen = vi.spyOn(ADAPTERS.fal, 'generate').mockImplementation(async () => {
      // Once the approved Nodes run started, an unrelated send cannot piggyback on its pass.
      try { createGeneration(spec()); } catch (err) { if (err instanceof OverLimitError) midRunRefused = true; }
      return out;
    });
    try {
      // Unapproved: stopped before starting.
      expect(await runNodes(sid, ['b'])).toBeNull();
      expect(count()).toBe(0);

      // Direct Nodes run (Run / Run all) confirmed once: both steps run.
      const res = await withOncePass(sid, () => runNodes(sid, ['b']));
      expect(res?.failed).toEqual([]);
      expect(res?.outputs.size).toBe(2);
      expect(gen).toHaveBeenCalledTimes(2);
      expect(count()).toBe(2);
      expect(midRunRefused).toBe(true);
      expect(() => createGeneration(spec())).toThrow(OverLimitError);

      // Nodes run approved on its PlanCard (nodeRun): both steps run through the real runNodes path.
      gen.mockClear();
      useStore.setState((s) => ({ generations: {}, sessions: { ...s.sessions, [sid]: { ...s.sessions[sid], graph, feed: [] } } }));
      const card = await presentNodeRun(sid, ['b'], null, undefined, 'main');
      expect(card.errors).toEqual([]);
      await withOncePass(sid, () => approvePlan(sid, card.itemId!));
      const feedItem = useStore.getState().sessions[sid].feed.find((f) => f.id === card.itemId) as PlanFeedItem;
      expect(feedItem.status).toBe('done');
      expect(gen).toHaveBeenCalledTimes(2);
      expect(count()).toBe(2);
    } finally {
      gen.mockRestore();
    }
  });
});
