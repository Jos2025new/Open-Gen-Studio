import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('fetch', async (input: unknown) => { throw new Error(`Blocked request before journey imports: ${String(input)}`); });
  Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } });
});
vi.mock('../../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  blobDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  getAssetBlob: async () => new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' }),
  putAssetBlob: async () => undefined,
}));

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlanCard } from '../../src/components/chat/PlanCard';
import { normalizePlan } from '../../src/engine/plan';
import { estimateSteps } from '../../src/engine/executor';
import { approvePlan } from '../../src/engine/agent/runtime';
import { clearJourneyTrace, lastJourneyTrace } from '../../src/lib/journeyTrace';
import { logSettled } from '../../src/lib/log';
import { useStore } from '../../src/store/store';
import type { ModelSchema, ModelSummary, PlanFeedItem } from '../../src/engine/types';

const TEXT = 'atlas::journey/studio-7/text-to-image';
const EDIT = 'atlas::journey/studio-7/edit';
const imageModel = (ref: string, acceptsImage: boolean, usd: number): ModelSummary => ({
  ref, provider: 'atlas', id: ref.split('::')[1], name: ref.endsWith('/edit') ? 'Studio Edit' : 'Studio Text', kind: 'image',
  acceptsText: true, acceptsImage, tags: [], price: { skus: [{ unit: 'output', usd }] },
});
const schema = (ref: string, images: boolean): ModelSchema => ({
  ref, params: [], slots: { prompt: 'prompt', promptRequired: true, ...(images ? { images: { key: 'image_urls', max: 1, min: 0, multiple: true, format: 'url' as const } } : {}) }, source: 'catalog',
});
const refAsset = { id: 'ref-image', sessionId: 'test', kind: 'image', name: 'input', mime: 'image/png', stored: true, width: 1, height: 1, createdAt: 1, size: 8 };
type Captured = { body: Record<string, unknown>; simulatedUsd: number };

// All three scenarios keep the explicit model, inputs, settings and approval API identical.
async function prepare(catalog: 'injected-change' | 'stable-capable' | 'stable-incapable') {
  clearJourneyTrace();
  const sent: Captured[] = [];
  const blocked: string[] = [];
  class TestImage {
    naturalWidth = 1;
    naturalHeight = 1;
    onload?: () => void;
    set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    decode() { return Promise.resolve(); }
  }
  vi.stubGlobal('Image', TestImage);
  vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === 'https://api.atlascloud.ai/api/v1/model/uploadMedia') return new Response(JSON.stringify({ data: { url: 'https://simulated.invalid/input.png' } }));
    if (url === 'https://api.atlascloud.ai/api/v1/model/generateImage') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const simulatedUsd = body.model === EDIT.split('::')[1] ? 1.2 : body.model === TEXT.split('::')[1] ? 0.2 : Infinity;
      sent.push({ body, simulatedUsd });
      throw new Error('simulation stops after request capture');
    }
    blocked.push(url);
    throw new Error(`Blocked unapproved price journey request: ${url}`);
  });
  const st = useStore.getState();
  const sessionId = st.activeSessionId;
  const capable = catalog !== 'stable-incapable';
  useStore.setState({
    assets: { 'ref-image': refAsset as never }, spentUsd: 0, quotes: {},
    catalog: { ...st.catalog, models: { [TEXT]: imageModel(TEXT, capable, 0.2), [EDIT]: imageModel(EDIT, true, 1.2) }, schemas: { [TEXT]: schema(TEXT, capable), [EDIT]: schema(EDIT, true) }, status: { ...st.catalog.status, atlas: 'ready' } },
    settings: { ...st.settings, keys: { ...st.settings.keys, atlas: 'test-only' }, budgetOn: false, budgetAccepted: null, agent: { ...st.settings.agent, provider: 'offline' } },
    composer: { ...st.composer, image: { ...st.composer.image, modelRef: TEXT }, userPicked: {}, videoRoutes: undefined },
    sessions: { ...st.sessions, [sessionId]: { ...st.sessions[sessionId], feed: [], agent: { history: [], questionRound: 0, notes: [], busy: false } } },
  });
  const context = {
    workspace: 'chat' as const,
    getModel: async (ref: string) => {
      const { models, schemas } = useStore.getState().catalog;
      return models[ref] && schemas[ref] ? { model: models[ref], schema: schemas[ref] } : null;
    },
    defaultModel: () => TEXT, defaultSettings: () => ({}),
    asset: (id: string) => useStore.getState().assets[id], layer: () => undefined, composerChosen: () => false,
  };
  const built = await normalizePlan({ steps: [{ id: 's1', kind: 'image', prompt: 'blue mug', model: TEXT, refs: ['asset:ref-image'], count: 1 }] }, context, 'journey-price-plan');
  if (!built.plan) return { ...built, sent, blocked, sessionId, item: undefined };
  const item: PlanFeedItem = { id: 'approval-1', createdAt: 1, workspace: 'chat', type: 'plan', plan: built.plan, style: 'guided', status: 'awaiting', stepStates: { s1: 'pending' }, stepGenerations: {}, estimate: estimateSteps(built.plan.steps).total };
  useStore.setState((s) => ({ sessions: { ...s.sessions, [sessionId]: { ...s.sessions[sessionId], feed: [item] } } }));
  if (catalog === 'injected-change') useStore.setState((s) => ({ catalog: { ...s.catalog, models: { ...s.catalog.models, [TEXT]: { ...s.catalog.models[TEXT], acceptsImage: false } } } }));
  return { ...built, item, sessionId, sent, blocked };
}

afterEach(async () => { await logSettled(); clearJourneyTrace(); vi.unstubAllGlobals(); });

// Test-only oracle: no second approval is given in these scenarios. The app does not yet persist a spending authorization.
function expectWithinTestAuthorization(sent: Captured[], maximumUsd: number) {
  expect(sent.filter((request) => request.simulatedUsd > maximumUsd), 'no out-of-authorization request may cross the adapter boundary without fresh approval').toEqual([]);
}

describe('price approval evidence (simulated prices, real adapter)', () => {
  it('characterization: injected capability drift transmits EDIT at simulated $1.20 after accepting a $0.20 estimate', async () => {
    const run = await prepare('injected-change');
    expect(run.errors).toEqual([]);
    expect(run.item?.estimate.usd).toBe(0.2);
    await approvePlan(run.sessionId, run.item!.id);
    await logSettled();
    expect(run.sent).toHaveLength(1);
    expect(run.sent[0]).toMatchObject({ body: { model: EDIT.split('::')[1], image_urls: ['https://simulated.invalid/input.png'] }, simulatedUsd: 1.2 });
    expect(lastJourneyTrace().find(e => e.event === 'plan.approved')?.prices).toMatchObject({ acceptedEstimateUsd: 0.2 });
    expect(lastJourneyTrace().find(e => e.event === 'generation.request_prepared')?.prices).toMatchObject({ acceptedEstimateUsd: 0.2, currentEstimateUsd: 1.2 });
    expect(run.blocked).toContain('/x/store/log');
  });

  // Opt-in failing invariant: JNY_PRICE_01=1; see docs/history/017-2026-10-W40.md.
  it.skipIf(!process.env.JNY_PRICE_01)('[JNY-PRICE-01] no request outside the test authorization may be transmitted', async () => {
    const run = await prepare('injected-change');
    expect(run.errors).toEqual([]);
    expect(run.item?.estimate.usd).toBe(0.2);
    await approvePlan(run.sessionId, run.item!.id);
    expectWithinTestAuthorization(run.sent, 0.2);
  });

  it('the protection oracle accepts zero transmissions and rejects an excessive captured request', () => {
    expectWithinTestAuthorization([], 0.2);
    expectWithinTestAuthorization([{ body: {}, simulatedUsd: 0.2 }], 0.2);
    expect(() => expectWithinTestAuthorization([{ body: {}, simulatedUsd: 1.2 }], 0.2)).toThrow();
  });

  it('equivalent stable capable catalog sends the explicit TEXT model at $0.20', async () => {
    const run = await prepare('stable-capable');
    expect(run.errors).toEqual([]);
    expect(run.item?.estimate.usd).toBe(0.2);
    await approvePlan(run.sessionId, run.item!.id);
    expect(run.sent).toHaveLength(1);
    expect(run.sent[0]).toMatchObject({ body: { model: TEXT.split('::')[1], image_urls: ['https://simulated.invalid/input.png'] }, simulatedUsd: 0.2 });
    expectWithinTestAuthorization(run.sent, 0.2);
  });

  it('equivalent stable incapable catalog rejects the explicit TEXT plan instead of silently selecting EDIT', async () => {
    const run = await prepare('stable-incapable');
    expect(run.errors.join(' ')).toContain('does not accept reference images');
    expect(run.item).toBeUndefined();
    expect(run.sent).toEqual([]);
  });

  it('a budget-rejected approval attempt is not an accepted approval', async () => {
    const run = await prepare('stable-capable');
    useStore.setState(s => ({ settings: { ...s.settings, budgetOn: true, budgetUsd: 0.1, budgetAccepted: null } }));
    await approvePlan(run.sessionId, run.item!.id);
    expect(lastJourneyTrace().some(e => e.event === 'plan.approval_attempted')).toBe(true);
    expect(lastJourneyTrace().some(e => e.event === 'plan.approved')).toBe(false);
    expect(useStore.getState().sessions[run.sessionId].feed[0]).toMatchObject({ status: 'awaiting' });
    expect(run.sent).toEqual([]);
  });

  it('accepted estimate matches the live PlanCard amount rather than its stale stored estimate', async () => {
    const run = await prepare('stable-capable');
    useStore.setState(s => ({ catalog: { ...s.catalog, models: { ...s.catalog.models, [TEXT]: imageModel(TEXT, true, 0.4) } } }));
    expect(run.item?.estimate.usd).toBe(0.2);
    const html = renderToStaticMarkup(createElement(PlanCard, { item: run.item!, sessionId: run.sessionId }));
    expect(html).toContain('Run · $0.4</button>');
    await approvePlan(run.sessionId, run.item!.id);
    expect(lastJourneyTrace().find(e => e.event === 'plan.approved')?.prices).toMatchObject({ storedEstimateUsd: 0.2, liveEstimateUsd: 0.4, acceptedEstimateUsd: 0.4 });
  });
});
