import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
const imageBlob = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' });
vi.mock('../../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  blobDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  getAssetBlob: async () => imageBlob,
  putAssetBlob: async () => undefined,
}));

import { normalizePlan } from '../../src/engine/plan';
import { estimateSteps } from '../../src/engine/executor';
import { approvePlan } from '../../src/engine/agent/runtime';
import { defaultModelFor } from '../../src/engine/catalog';
import { clearJourneyTrace, lastJourneyTrace, recordJourneyEvent } from '../../src/lib/journeyTrace';
import { useStore } from '../../src/store/store';
import type { MediaKind, ModelSchema, ModelSummary, PlanFeedItem } from '../../src/engine/types';

const TEXT = 'atlas::journey/studio-7/text-to-image';
const EDIT = 'atlas::journey/studio-7/edit';
const imageModel = (ref: string, acceptsImage: boolean, usd: number): ModelSummary => ({
  ref, provider: 'atlas', id: ref.split('::')[1], name: ref.endsWith('/edit') ? 'Studio Edit' : 'Studio Text', kind: 'image',
  acceptsText: true, acceptsImage, tags: [], price: { skus: [{ unit: 'output', usd }] },
});
const schema = (ref: string, images = false): ModelSchema => ({
  ref, params: [], slots: { prompt: 'prompt', promptRequired: true, ...(images ? { images: { key: 'image_urls', max: 1, min: 0, multiple: true, format: 'url' as const } } : {}) }, source: 'catalog',
});
const refAsset = { id: 'ref-image', sessionId: 'test', kind: 'image', name: 'input', mime: 'image/png', stored: true, width: 1, height: 1, createdAt: 1, size: 8 };
let sent: Array<{ url: string; body: Record<string, unknown> }> = [];
let blocked: string[] = [];

afterEach(() => { clearJourneyTrace(); vi.unstubAllGlobals(); });

describe('price approval through the real execution path', () => {
  // Catalog metadata is changed after plan validation and estimation, but before approvePlan re-estimates and runs it.
  it.skip('[JNY-PRICE-01] blocks a simulated final request above approval', async () => {
    clearJourneyTrace();
    sent = [];
    blocked = [];
    const st = useStore.getState();
    const sessionId = st.activeSessionId;
    const textModel = imageModel(TEXT, true, 0.20);
    const editModel = imageModel(EDIT, true, 1.20);
    useStore.setState({
      assets: { 'ref-image': refAsset as never },
      catalog: { ...st.catalog, models: { [TEXT]: textModel, [EDIT]: editModel }, schemas: { [TEXT]: schema(TEXT, true), [EDIT]: schema(EDIT, true) }, status: { ...st.catalog.status, atlas: 'ready' } },
      settings: { ...st.settings, keys: { ...st.settings.keys, atlas: 'test-only' }, budgetOn: false, agent: { ...st.settings.agent, provider: 'offline' } },
      composer: { ...st.composer, image: { ...st.composer.image, modelRef: TEXT }, userPicked: {}, videoRoutes: undefined },
      sessions: { ...st.sessions, [sessionId]: { ...st.sessions[sessionId], feed: [], agent: { history: [], questionRound: 0, notes: [], busy: false } } },
    });
    class TestImage {
      naturalWidth = 1;
      naturalHeight = 1;
      onload?: () => void;
      onerror?: () => void;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
      decode() { return Promise.resolve(); }
    }
    vi.stubGlobal('Image', TestImage);
    vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v1/model/uploadMedia')) return new Response(JSON.stringify({ data: { url: 'https://simulated.invalid/input.png' } }));
      if (url.endsWith('/api/v1/model/generateImage')) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        sent.push({ url, body });
        const pending = lastJourneyTrace().find((event) => event.event === 'generation.request_prepared');
        const simulatedRequestUsd = body.model === EDIT.split('::')[1] ? 1.2 : 0.2;
        if (pending) recordJourneyEvent({ ...pending, event: 'provider.simulated_price', reason: 'test provider price for the exact captured request body', prices: { ...pending.prices, simulatedRequestUsd } });
        throw new Error('simulation stops after request capture');
      }
      blocked.push(url);
      throw new Error(`Blocked unapproved network request in price journey: ${url}`);
    });

    // Exercise real validation and estimation against the catalog as it stood when the plan was shown.
    const context = {
      workspace: 'chat' as const,
      getModel: async (ref: string) => {
        const model = useStore.getState().catalog.models[ref];
        const modelSchema = useStore.getState().catalog.schemas[ref];
        return model && modelSchema ? { model, schema: modelSchema } : null;
      },
      defaultModel: () => TEXT,
      defaultSettings: () => ({}),
      asset: (id: string) => useStore.getState().assets[id],
      layer: () => undefined,
      composerChosen: () => false,
    };
    const built = await normalizePlan({ steps: [{ id: 's1', kind: 'image', prompt: 'blue mug', model: TEXT, refs: ['asset:ref-image'] }] }, context, 'journey-price-plan');
    expect(built.errors).toEqual([]);
    const plan = built.plan!;
    const approved = estimateSteps(plan.steps).total;
    expect(approved.usd).toBe(0.2);
    const item: PlanFeedItem = { id: 'approval-1', createdAt: 1, workspace: 'chat', type: 'plan', plan, style: 'guided', status: 'awaiting', stepStates: { s1: 'pending' }, stepGenerations: {}, estimate: approved };
    useStore.setState((s) => ({ sessions: { ...s.sessions, [sessionId]: { ...s.sessions[sessionId], feed: [item] } } }));

    // Between validation/estimate and approval, the test changes catalog capability metadata. The real jobs.ts
    // late twin resolver then picks the costlier edit route during execution.
    useStore.setState((s) => ({ catalog: { ...s.catalog, models: { ...s.catalog.models, [TEXT]: { ...textModel, acceptsImage: false } } } }));
    await approvePlan(sessionId, item.id);

    const trace = lastJourneyTrace();
    expect(trace.find((e) => e.event === 'plan.approved')?.prices).toMatchObject({ approvedUsd: 0.2, currentEstimateUsd: 0.2 });
    expect(trace.find((e) => e.event === 'generation.request_prepared')?.prices).toMatchObject({ approvedUsd: 0.2, currentEstimateUsd: 1.2 });
    expect(trace.find((e) => e.event === 'provider.simulated_price')?.prices).toMatchObject({ approvedUsd: 0.2, currentEstimateUsd: 1.2, simulatedRequestUsd: 1.2 });
    expect(blocked.some((url) => url.endsWith('/x/store/log'))).toBe(true);
    expect(sent, 'the app must require fresh approval before transmitting a request above the approved price').toHaveLength(0);
  });

  it('with stable catalog metadata, normalization selects and prices the compatible input variant before approval', async () => {
    clearJourneyTrace();
    sent = [];
    blocked = [];
    const st = useStore.getState();
    const sessionId = st.activeSessionId;
    const textModel = imageModel(TEXT, false, 0.20);
    const editModel = imageModel(EDIT, true, 1.20);
    useStore.setState({
      assets: { 'ref-image': refAsset as never },
      catalog: { ...st.catalog, models: { [TEXT]: textModel, [EDIT]: editModel }, schemas: { [TEXT]: schema(TEXT, false), [EDIT]: schema(EDIT, true) }, status: { ...st.catalog.status, atlas: 'ready' } },
      settings: { ...st.settings, keys: { ...st.settings.keys, atlas: 'test-only' }, budgetOn: false, agent: { ...st.settings.agent, provider: 'offline' } },
      composer: { ...st.composer, image: { ...st.composer.image, modelRef: TEXT }, userPicked: {}, videoRoutes: undefined },
      sessions: { ...st.sessions, [sessionId]: { ...st.sessions[sessionId], feed: [], agent: { history: [], questionRound: 0, notes: [], busy: false } } },
    });
    class TestImage {
      naturalWidth = 1;
      naturalHeight = 1;
      onload?: () => void;
      onerror?: () => void;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
      decode() { return Promise.resolve(); }
    }
    vi.stubGlobal('Image', TestImage);
    vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v1/model/uploadMedia')) return new Response(JSON.stringify({ data: { url: 'https://simulated.invalid/input.png' } }));
      if (url.endsWith('/api/v1/model/generateImage')) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        sent.push({ url, body });
        const pending = lastJourneyTrace().find((event) => event.event === 'generation.request_prepared');
        const simulatedRequestUsd = body.model === EDIT.split('::')[1] ? 1.2 : 0.2;
        if (pending) recordJourneyEvent({ ...pending, event: 'provider.simulated_price', reason: 'test provider price for the exact captured request body', prices: { ...pending.prices, simulatedRequestUsd } });
        throw new Error('simulation stops after request capture');
      }
      blocked.push(url);
      throw new Error(`Blocked unapproved network request in stable-price journey: ${url}`);
    });

    const context = {
      workspace: 'chat' as const,
      getModel: async (ref: string) => {
        const model = useStore.getState().catalog.models[ref];
        const modelSchema = useStore.getState().catalog.schemas[ref];
        return model && modelSchema ? { model, schema: modelSchema } : null;
      },
      defaultModel: (kind: MediaKind, needsImage: boolean) => defaultModelFor(kind, needsImage),
      defaultSettings: () => ({}),
      asset: (id: string) => useStore.getState().assets[id],
      layer: () => undefined,
      composerChosen: () => false,
    };
    const built = await normalizePlan({ steps: [{ id: 's1', kind: 'image', prompt: 'blue mug', refs: ['asset:ref-image'] }] }, context, 'stable-catalog-plan');
    expect(built.errors).toEqual([]);
    expect(built.plan?.steps[0]).toMatchObject({ modelRef: EDIT });
    const approved = estimateSteps(built.plan!.steps).total;
    expect(approved.usd).toBe(1.2);
    const item: PlanFeedItem = { id: 'stable-approval', createdAt: 1, workspace: 'chat', type: 'plan', plan: built.plan!, style: 'guided', status: 'awaiting', stepStates: { s1: 'pending' }, stepGenerations: {}, estimate: approved };
    useStore.setState((s) => ({ sessions: { ...s.sessions, [sessionId]: { ...s.sessions[sessionId], feed: [item] } } }));
    await approvePlan(sessionId, item.id);
    const trace = lastJourneyTrace();
    expect(trace.find((e) => e.event === 'plan.approved')?.prices).toMatchObject({ approvedUsd: 1.2, currentEstimateUsd: 1.2 });
    expect(trace.find((e) => e.event === 'generation.request_prepared')?.prices).toMatchObject({ approvedUsd: 1.2, currentEstimateUsd: 1.2 });
    expect(trace.find((e) => e.event === 'provider.simulated_price')?.prices).toMatchObject({ approvedUsd: 1.2, currentEstimateUsd: 1.2, simulatedRequestUsd: 1.2 });
    expect(sent).toHaveLength(1);
    expect(sent[0].body.model).toBe(EDIT.split('::')[1]);
  });
});
