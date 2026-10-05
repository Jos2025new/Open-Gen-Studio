import { afterEach, describe, expect, it, vi } from 'vitest';

const savedState = vi.hoisted(() => ({ raw: undefined as string | undefined }));
vi.hoisted(() => {
  vi.stubGlobal('fetch', async (input: unknown) => { throw new Error(`Blocked request before journey imports: ${String(input)}`); });
  Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } });
});
vi.mock('../../src/lib/media', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/lib/media')>();
  return { ...original, probeMedia: async () => ({ width: 1, height: 1 }) };
});
vi.mock('../../src/lib/idb', () => ({
  stateDb: { get: async () => savedState.raw, set: async (_key: string, raw: string) => { savedState.raw = raw; }, del: async () => undefined },
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
import { approvePlan, resolveStepCostReview, settleInterruptedPlans, resumePlan } from '../../src/engine/agent/runtime';
import { createGeneration, estimateSpec, runGeneration, resumeInterrupted } from '../../src/engine/jobs';
import { checkStepAuthorization, costAuthorization } from '../../src/engine/priceAuthorization';
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
async function prepare(catalog: 'injected-change' | 'stable-capable' | 'stable-incapable', complete = false) {
  savedState.raw = undefined;
  clearJourneyTrace();
  const sent: Captured[] = [];
  const blocked: string[] = [];
  const logs: Array<Record<string, any>> = [];
  const requests: string[] = [];
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
    requests.push(url);
    if (url === '/x/store/log') logs.push(JSON.parse(String(init?.body)));
    if (url === 'https://api.atlascloud.ai/api/v1/model/uploadMedia') return new Response(JSON.stringify({ data: { url: 'https://simulated.invalid/input.png' } }));
    if (url === 'https://api.atlascloud.ai/api/v1/model/generateImage') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const simulatedUsd = body.model === EDIT.split('::')[1] ? 1.2 : body.model === TEXT.split('::')[1] ? 0.2 : Infinity;
      sent.push({ body, simulatedUsd });
      if (complete) return new Response(JSON.stringify({ data: { id: `job-${sent.length}` } }));
      throw new Error('simulation stops after request capture');
    }
    if (complete && url.startsWith('https://api.atlascloud.ai/api/v1/model/prediction/')) return new Response(JSON.stringify({ data: { status: 'completed', outputs: ['https://simulated.invalid/output.png'] } }));
    if (complete && url === 'https://simulated.invalid/output.png') return new Response(new Blob(['mock-output'], { type: 'image/png' }));
    blocked.push(url);
    throw new Error(`Blocked unapproved price journey request: ${url}`);
  });
  const st = useStore.getState();
  const sessionId = st.activeSessionId;
  const capable = catalog !== 'stable-incapable';
  useStore.setState({
    generations: {},
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
  if (!built.plan) return { ...built, sent, blocked, logs, requests, sessionId, item: undefined };
  const item: PlanFeedItem = { id: 'approval-1', createdAt: 1, workspace: 'chat', type: 'plan', plan: built.plan, style: 'guided', status: 'awaiting', stepStates: { s1: 'pending' }, stepGenerations: {}, estimate: estimateSteps(built.plan.steps).total };
  useStore.setState((s) => ({ sessions: { ...s.sessions, [sessionId]: { ...s.sessions[sessionId], feed: [item] } } }));
  if (catalog === 'injected-change') useStore.setState((s) => ({ catalog: { ...s.catalog, models: { ...s.catalog.models, [TEXT]: { ...s.catalog.models[TEXT], acceptsImage: false } } } }));
  return { ...built, item, sessionId, sent, blocked, logs, requests };
}

afterEach(async () => { vi.useRealTimers(); await logSettled(); clearJourneyTrace(); vi.unstubAllGlobals(); });

// Test-only prices independently check the serialized request against the approval.
function expectWithinTestAuthorization(sent: Captured[], maximumUsd: number) {
  expect(sent.filter((request) => request.simulatedUsd > maximumUsd), 'no out-of-authorization request may cross the adapter boundary without fresh approval').toEqual([]);
}

function currentPlan(sessionId: string): PlanFeedItem {
  return useStore.getState().sessions[sessionId].feed.find((f): f is PlanFeedItem => f.type === 'plan')!;
}
function addBranches(sessionId: string) {
  const item = currentPlan(sessionId);
  item.plan.steps.push({ id: 'independent', title: 'Independent', kind: 'text', text: 'still runs' }, { id: 'dependent', title: 'Dependent', kind: 'text', text: 'waits', after: ['s1'] });
}

describe('price approval evidence (simulated prices, real adapter)', () => {
  it('more expensive variant is held, logged without private inputs, and explained to the agent', async () => {
    const run = await prepare('injected-change');
    await approvePlan(run.sessionId, run.item!.id);
    await logSettled();
    const item = currentPlan(run.sessionId);
    expect(run.sent).toEqual([]);
    expect(item).toMatchObject({ status: 'review', stepStates: { s1: 'review' }, stepAuthorizations: { s1: { modelRef: TEXT, parameters: { count: 1 }, estimate: { usd: 0.2 } } } });
    expect(useStore.getState().generations[item.stepGenerations.s1]).toMatchObject({ status: 'review', modelRef: EDIT, error: undefined });
    expect(run.logs.filter(l => l.data.event === 'plan-step-cost-stopped')).toMatchObject([{ kind: 'app', data: { planId: item.plan.id, stepId: 's1', generationId: item.stepGenerations.s1, approvedModel: TEXT, newModel: EDIT, approvedEstimate: { usd: 0.2 }, newEstimate: { usd: 1.2 } } }]);
    const logged = JSON.stringify(run.logs);
    expect(logged).not.toContain('blue mug');
    expect(logged).not.toContain('test-only');
    expect(logged).not.toContain('input.png');
    expect(lastJourneyTrace().some(e => e.event === 'plan.step_cost_stopped')).toBe(true);
    expect(useStore.getState().sessions[run.sessionId].agent.notes.join(' ')).toContain('s1 needs cost review');
    const html = renderToStaticMarkup(createElement(PlanCard, { item, sessionId: run.sessionId }));
    expect(html).toContain('$1.20 en vez de $0.20');
    expect(html).toContain('Continuar');
    expect(html).toContain('Cancelar paso');
  });

  it('[JNY-PRICE-01] no request outside the test authorization may be transmitted', async () => {
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
    // Captured from unchanged 6c58cb2 with this same fixture and real adapter.
    expect(run.sent).toEqual([{ body: { model: 'journey/studio-7/text-to-image', prompt: 'blue mug', image_urls: ['https://simulated.invalid/input.png'] }, simulatedUsd: 0.2 }]);
    expect(lastJourneyTrace().some(e => e.event === 'plan.step_cost_stopped')).toBe(false);
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
  it('Continue sends the same generation only once, including concurrent and later clicks', async () => {
    const run = await prepare('injected-change');
    await approvePlan(run.sessionId, run.item!.id);
    const gid = currentPlan(run.sessionId).stepGenerations.s1;
    await Promise.all([resolveStepCostReview(run.sessionId, run.item!.id, 's1', 'continue'), resolveStepCostReview(run.sessionId, run.item!.id, 's1', 'continue')]);
    await resolveStepCostReview(run.sessionId, run.item!.id, 's1', 'continue');
    expect(run.sent).toHaveLength(1);
    expect(run.sent[0].body.model).toBe(EDIT.split('::')[1]);
    expect(currentPlan(run.sessionId).stepGenerations.s1).toBe(gid);
    expect(currentPlan(run.sessionId).stepAuthorizations?.s1.estimate.usd).toBe(1.2);
    expect(Object.keys(useStore.getState().generations)).toEqual([gid]);
  });

  it('Cancel sends nothing, independent steps finish and dependent steps wait then skip', async () => {
    const run = await prepare('injected-change');
    addBranches(run.sessionId);
    await approvePlan(run.sessionId, run.item!.id);
    expect(currentPlan(run.sessionId).stepStates).toMatchObject({ s1: 'review', independent: 'done', dependent: 'pending' });
    await resolveStepCostReview(run.sessionId, run.item!.id, 's1', 'cancel');
    expect(currentPlan(run.sessionId).stepStates).toMatchObject({ s1: 'skipped', independent: 'done', dependent: 'skipped' });
    expect(run.sent).toEqual([]);
  });

  it('persisted reload keeps review and its warning without sending; Continue still sends once', async () => {
    const run = await prepare('injected-change');
    addBranches(run.sessionId);
    await approvePlan(run.sessionId, run.item!.id);
    vi.useFakeTimers();
    useStore.setState({ hydrated: true });
    await vi.advanceTimersByTimeAsync(2100);
    const diskState = savedState.raw!;
    expect(JSON.parse(diskState).state.sessions[run.sessionId].feed[0].stepCostReviews.s1.proposed.estimate.usd).toBe(1.2);
    useStore.setState({ generations: {}, sessions: {} });
    savedState.raw = diskState;
    await useStore.persist.rehydrate();
    await resumeInterrupted();
    settleInterruptedPlans();
    await vi.advanceTimersByTimeAsync(2100);
    vi.useRealTimers();
    const item = currentPlan(run.sessionId);
    expect(item).toMatchObject({ status: 'review', stepStates: { s1: 'review', independent: 'done', dependent: 'pending' } });
    expect(item.stepCostReviews?.s1.message).toContain('$1.20 en vez de $0.20');
    expect(run.sent).toEqual([]);
    await Promise.all([resolveStepCostReview(run.sessionId, item.id, 's1', 'continue'), resolveStepCostReview(run.sessionId, item.id, 's1', 'continue')]);
    expect(run.sent).toHaveLength(1);
    expect(currentPlan(run.sessionId).stepStates.independent).toBe('done');
  });

  it.each([0.1, 0.2, 0.21])('changed variant at $%s is sent without review', async usd => {
    const run = await prepare('injected-change');
    useStore.setState(s => ({ catalog: { ...s.catalog, models: { ...s.catalog.models, [EDIT]: imageModel(EDIT, true, usd) } } }));
    await approvePlan(run.sessionId, run.item!.id);
    expect(run.sent).toHaveLength(1);
    expect(currentPlan(run.sessionId).stepCostReviews).toBeUndefined();
    expect(lastJourneyTrace().some(e => e.event === 'plan.step_cost_stopped')).toBe(false);
  });

  it.each(['approved', 'proposed'])('unknown %s price sends the changed variant, logs it and displays information', async side => {
    const run = await prepare('injected-change');
    const ref = side === 'approved' ? TEXT : EDIT;
    useStore.setState(s => ({ catalog: { ...s.catalog, models: { ...s.catalog.models, [ref]: { ...s.catalog.models[ref], price: undefined } } } }));
    await approvePlan(run.sessionId, run.item!.id);
    await logSettled();
    const item = currentPlan(run.sessionId);
    expect(run.sent).toHaveLength(1);
    expect(item.stepCostReviews).toBeUndefined();
    expect(item.stepVariantNotes?.s1).toContain('la variante de edición porque lleva una imagen');
    expect(run.logs.some(l => l.data.event === 'plan-step-variant-used')).toBe(true);
    expect(lastJourneyTrace().some(e => e.event === 'plan.step_cost_stopped')).toBe(false);
    const html = renderToStaticMarkup(createElement(PlanCard, { item, sessionId: run.sessionId }));
    expect(html).toContain('Precio desconocido');
    expect(html).not.toContain('Cancelar paso');
  });

  it('automatic approval obeys the same guard', async () => {
    const run = await prepare('injected-change');
    run.item!.style = 'auto';
    await approvePlan(run.sessionId, run.item!.id);
    expect(run.sent).toEqual([]);
    expect(currentPlan(run.sessionId).stepStates.s1).toBe('review');
  });

  it('comparison reads memory only, including missing cached quotes', async () => {
    const run = await prepare('injected-change');
    await approvePlan(run.sessionId, run.item!.id);
    await logSettled();
    const item = currentPlan(run.sessionId);
    const g = useStore.getState().generations[item.stepGenerations.s1];
    useStore.setState({ quotes: {} });
    const count = run.requests.length;
    expect(() => checkStepAuthorization(g, costAuthorization(g.modelRef, g.settings, estimateSpec(g, true)))).toThrow();
    await Promise.resolve();
    // The only additional request is the required local log, never a quote or a provider request.
    expect(run.requests.slice(count).filter(url => url !== '/x/store/log')).toEqual([]);
    expect(run.sent).toEqual([]);
  });

  it('a changed count with measurable higher cost stops; five percent tolerance is accepted', async () => {
    const run = await prepare('stable-capable');
    const unsubscribe = useStore.subscribe(state => {
      const g = Object.values(state.generations)[0];
      if (!g) return;
      unsubscribe();
      useStore.setState(s => ({ generations: { ...s.generations, [g.id]: { ...g, settings: { ...g.settings, count: 2 } } } }));
    });
    await approvePlan(run.sessionId, run.item!.id);
    expect(run.sent).toEqual([]);
    expect(currentPlan(run.sessionId).stepCostReviews?.s1.proposed).toMatchObject({ parameters: { count: 2 }, estimate: { usd: 0.4 } });
    const g = useStore.getState().generations[currentPlan(run.sessionId).stepGenerations.s1];
    const approved = costAuthorization(TEXT, { ...g.settings, count: 1 }, { usd: 1, approximate: true });
    useStore.setState(s => ({ sessions: { ...s.sessions, [run.sessionId]: { ...s.sessions[run.sessionId], feed: s.sessions[run.sessionId].feed.map(f => f.type === 'plan' ? { ...f, stepAuthorizations: { s1: approved } } : f) } } }));
    expect(() => checkStepAuthorization(g, costAuthorization(TEXT, g.settings, { usd: 1.05, approximate: true }))).not.toThrow();
  });

  it('direct generations keep the existing late variant dispatch', async () => {
    const run = await prepare('injected-change');
    const step = run.item!.plan.steps[0];
    if (step.kind !== 'image') throw new Error('fixture');
    const g = createGeneration({ sessionId: run.sessionId, origin: 'composer', kind: 'image', prompt: step.prompt, modelRef: TEXT, settings: step.settings, inputs: { refs: ['ref-image'] } });
    await runGeneration(g.id).catch(() => undefined);
    expect(run.sent).toHaveLength(1);
    expect(run.sent[0].body.model).toBe(EDIT.split('::')[1]);
    expect(lastJourneyTrace().some(e => e.event === 'plan.step_cost_stopped')).toBe(false);
  });

  it('Continue completes the affected step and releases dependents, reusing independent results', async () => {
    const run = await prepare('injected-change', true);
    addBranches(run.sessionId);
    await approvePlan(run.sessionId, run.item!.id);
    expect(currentPlan(run.sessionId).stepStates.dependent).toBe('pending');
    await resolveStepCostReview(run.sessionId, run.item!.id, 's1', 'continue');
    expect(run.sent).toHaveLength(1);
    expect(currentPlan(run.sessionId)).toMatchObject({ status: 'done', stepStates: { s1: 'done', independent: 'done', dependent: 'done' } });
    expect(currentPlan(run.sessionId).stepOutputs?.s1.assetIds).toHaveLength(1);
  });

  it('approving one reviewed step leaves the other approval and dependent waiting', async () => {
    const run = await prepare('injected-change', true);
    const item = currentPlan(run.sessionId);
    const first = item.plan.steps[0];
    item.plan.steps.push({ ...first, id: 's2' }, { id: 'dependent', kind: 'text', title: 'Waiting', text: 'wait', after: ['s2'] });
    await approvePlan(run.sessionId, item.id);
    expect(currentPlan(run.sessionId).stepStates).toMatchObject({ s1: 'review', s2: 'review', dependent: 'pending' });
    await resolveStepCostReview(run.sessionId, item.id, 's1', 'continue');
    expect(currentPlan(run.sessionId).stepStates).toMatchObject({ s1: 'done', s2: 'review', dependent: 'pending' });
    expect(currentPlan(run.sessionId).stepAuthorizations?.s2.modelRef).toBe(TEXT);
    await resolveStepCostReview(run.sessionId, item.id, 's2', 'continue');
    expect(currentPlan(run.sessionId)).toMatchObject({ status: 'done', stepStates: { s1: 'done', s2: 'done', dependent: 'done' } });
    expect(run.sent).toHaveLength(2);
  });

  it('operation approval keeps the actual count and settings, and an unchanged operation sends identically', async () => {
    const run = await prepare('stable-capable', true);
    useStore.setState(s => ({ settings: { ...s.settings, ops: { ...s.settings.ops, edit: EDIT } } }));
    const item = currentPlan(run.sessionId);
    item.plan.steps = [{ id: 's1', title: 'Variations', kind: 'op', op: 'variations', input: 'asset:ref-image', params: { count: 2 } }];
    await approvePlan(run.sessionId, item.id);
    expect(currentPlan(run.sessionId).stepAuthorizations?.s1).toMatchObject({ modelRef: EDIT, parameters: { count: 2 }, estimate: { usd: 2.4 } });
    expect(currentPlan(run.sessionId).stepStates.s1).toBe('done');
    expect(run.sent).toHaveLength(2);
    expect(lastJourneyTrace().some(e => e.event === 'plan.step_cost_stopped')).toBe(false);
  });

  it('reload during plan settlement preserves review and pending dependencies through boot recovery', async () => {
    const run = await prepare('injected-change');
    addBranches(run.sessionId);
    await approvePlan(run.sessionId, run.item!.id);
    const st = useStore.getState();
    useStore.setState({ sessions: { ...st.sessions, [run.sessionId]: { ...st.sessions[run.sessionId], feed: st.sessions[run.sessionId].feed.map(f => f.type === 'plan' ? { ...f, status: 'running' } : f) } } });
    await resumeInterrupted();
    settleInterruptedPlans();
    expect(currentPlan(run.sessionId)).toMatchObject({ status: 'review', stepStates: { s1: 'review', independent: 'done', dependent: 'pending' } });
    expect(run.sent).toEqual([]);
  });

  it('a failed step that becomes more expensive on retry remains review rather than failed', async () => {
    const run = await prepare('stable-capable');
    await approvePlan(run.sessionId, run.item!.id);
    expect(currentPlan(run.sessionId).status).toBe('error');
    run.sent.length = 0;
    useStore.setState(s => ({ catalog: { ...s.catalog, models: { ...s.catalog.models, [TEXT]: { ...s.catalog.models[TEXT], acceptsImage: false } } } }));
    await resumePlan(run.sessionId, run.item!.id, 'retry');
    expect(currentPlan(run.sessionId)).toMatchObject({ status: 'review', stepStates: { s1: 'review' } });
    expect(run.sent).toEqual([]);
    await resolveStepCostReview(run.sessionId, run.item!.id, 's1', 'continue');
    expect(run.sent).toHaveLength(1);
  });

});
