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

import { patchGeneration, updateFeedItem, useStore } from '../src/store/store';
import { createGeneration, retryGeneration, runGeneration } from '../src/engine/jobs';
import { ADAPTERS } from '../src/engine/providers/registry';
import { HttpError } from '../src/lib/http';
import { forgetBalances, onGenerationCredit } from '../src/engine/credit';
import { useAlerts } from '../src/engine/alerts';
import { generateDirect, regenerate } from '../src/engine/actions';
import { runNodes } from '../src/engine/flow/actions';
import { approvePlan, resumePlan } from '../src/engine/agent/runtime';
import { overLimit, withOncePass } from '../src/engine/budget';
import { planRecovery } from '../src/engine/agent/planRecovery';
import { costAuthorization } from '../src/engine/priceAuthorization';
import type { ModelSummary, PlanFeedItem } from '../src/engine/types';
import { mainThread } from './helpers/threads';

/* After a 402, a dearer or unpriced substitute still asks before going over the limit; a plan step is never resent outside its plan. */
const NANO = 'nanogpt::seed';
const ATLAS = 'atlas::seed';
const mk = (provider: 'nanogpt' | 'atlas', usd?: number): ModelSummary => ({ ref: `${provider}::seed`, provider, id: 'seed', name: 'seed', kind: 'image', acceptsText: true, acceptsImage: false, tags: [], price: usd == null ? undefined : { skus: [{ unit: 'output', usd }] } }) as unknown as ModelSummary;
let atlasSends = 0;
const alerts = () => useAlerts.getState().alerts;
const sid = () => useStore.getState().activeSessionId;

function setup(atlasUsd: number | undefined, budget: { on: boolean; usd: number }, mode: 'ask' | 'always' | 'never' = 'ask') {
  const st = useStore.getState();
  const schema = { params: [], slots: { prompt: 'prompt', promptRequired: true }, source: 'catalog' };
  useStore.setState({
    generations: {}, quotes: {}, assets: {}, spendLog: [], spentUsd: 0,
    settings: { ...st.settings, autoSwitchProvider: mode, keys: { ...st.settings.keys, nanogpt: 'k', atlas: 'k' }, budgetOn: budget.on, budgetUsd: budget.usd, budgetNoAsk: false, budgetAccepted: null },
    catalog: { ...st.catalog, models: { [NANO]: mk('nanogpt', 0.1), [ATLAS]: mk('atlas', atlasUsd) }, schemas: { [NANO]: { ref: NANO, ...schema }, [ATLAS]: { ref: ATLAS, ...schema } } as never },
    sessions: { ...st.sessions, [st.activeSessionId]: { ...st.sessions[st.activeSessionId], noAskOverLimit: false, graph: { nodes: [], edges: [] }, feed: [], agents: mainThread({ history: [], notes: [], questionRound: 0, busy: false }) } },
  });
}

beforeEach(() => {
  atlasSends = 0;
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ data: [] })));
  useAlerts.setState({ alerts: [] });
  forgetBalances();
  vi.spyOn(ADAPTERS.atlas, 'balance').mockResolvedValue(5);
  vi.spyOn(ADAPTERS.nanogpt, 'generate').mockRejectedValue(new HttpError(402, 'Insufficient balance', null));
  vi.spyOn(ADAPTERS.atlas, 'generate').mockImplementation(async () => { atlasSends++; return { outputs: [{ blob: new Blob(['i'], { type: 'image/png' }), mime: 'image/png' }], costUsd: 0.14 }; });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const gen = (planId?: string, origin: 'composer' | 'node' = 'composer') => createGeneration({ sessionId: sid(), origin, kind: 'image', prompt: 'a', modelRef: NANO, settings: { count: 1, advanced: {} }, inputs: { refs: [] }, planId });

describe('a substitute after no credit', () => {
  it('a dearer substitute that goes over the limit asks first; Cancel sends nothing, Continue once sends once', async () => {
    setup(0.14, { on: true, usd: 0.12 });
    const g = gen();
    await runGeneration(g.id).catch(() => undefined);
    const offer = alerts().find((a) => a.actions?.some((x) => x.label.includes('Atlas')))!;
    offer.actions!.find((x) => x.label.includes('Atlas'))!.run();
    await new Promise((r) => setTimeout(r, 20));
    expect(atlasSends).toBe(0);
    const ask = alerts().find((a) => a.actions?.some((x) => x.label === 'Continue once'))!;
    expect(ask.text).toMatch(/limit/);
    ask.actions!.find((x) => x.label === 'Cancel')!.run();
    await new Promise((r) => setTimeout(r, 20));
    expect(atlasSends).toBe(0);
    offer.actions!.find((x) => x.label.includes('Atlas'))!.run();
    await vi.waitFor(() => expect(alerts().some((a) => a.actions?.some((x) => x.label === 'Continue once'))).toBe(true));
    alerts().find((a) => a.actions?.some((x) => x.label === 'Continue once'))!.actions!.find((x) => x.label === 'Continue once')!.run();
    await vi.waitFor(() => expect(useStore.getState().generations[g.id].status).toBe('done'));
    expect(atlasSends).toBe(1);
  });

  it('an unpriced substitute with a limit on asks first', async () => {
    setup(undefined, { on: true, usd: 5 });
    const g = gen();
    await runGeneration(g.id).catch(() => undefined);
    const offer = alerts().find((a) => a.actions?.some((x) => x.label.includes('Atlas')))!;
    offer.actions!.find((x) => x.label.includes('Atlas'))!.run();
    await new Promise((r) => setTimeout(r, 20));
    expect(atlasSends).toBe(0);
    expect(alerts().some((a) => a.actions?.some((x) => x.label === 'Continue once'))).toBe(true);
  });

  it('a dearer substitute within the limit runs on the click', async () => {
    setup(0.14, { on: true, usd: 5 });
    const g = gen();
    await runGeneration(g.id).catch(() => undefined);
    alerts().find((a) => a.actions?.some((x) => x.label.includes('Atlas')))!.actions!.find((x) => x.label.includes('Atlas'))!.run();
    await vi.waitFor(() => expect(useStore.getState().generations[g.id].status).toBe('done'));
    expect(atlasSends).toBe(1);
  });

  it('a plan step is not resent from the alert: the model changes and the plan\u2019s Retry runs it', async () => {
    for (const [usd, label] of [[0.08, 'Yes, this time'], [0.14, 'Atlas']] as const) {
      setup(usd, { on: false, usd: 5 });
      useAlerts.setState({ alerts: [] });
      forgetBalances();
      const g = gen('plan-1');
      patchGeneration(g.id, { status: 'error' });
      const rerun = vi.fn(async () => []);
      const later = vi.fn(async () => []);
      await onGenerationCredit(g.id, rerun, later);
      const a = alerts().find((x) => x.actions?.some((y) => y.label.includes(label)))!;
      a.actions!.find((y) => y.label.includes(label))!.run();
      await new Promise((r) => setTimeout(r, 20));
      expect(later).not.toHaveBeenCalled();
      expect(rerun).not.toHaveBeenCalled();
      expect(useStore.getState().generations[g.id].modelRef).toBe(ATLAS);
      expect(alerts().some((x) => /Retry/.test(x.text))).toBe(true);
    }
  });

  it('an old alert answered after the card was retried sends nothing (the operation is not paid twice)', async () => {
    setup(0.08, { on: false, usd: 5 });
    const g = gen();
    await runGeneration(g.id).catch(() => undefined);
    const offer = alerts().find((a) => a.actions?.some((x) => x.label === 'Yes, this time'))!;
    // The user recharges and presses Retry on the card: a new attempt of the same operation succeeds on NanoGPT.
    vi.mocked(ADAPTERS.nanogpt.generate).mockResolvedValue({ outputs: [{ blob: new Blob(['i'], { type: 'image/png' }), mime: 'image/png' }], costUsd: 0.1 } as never);
    await retryGeneration(g.id);
    offer.actions!.find((x) => x.label === 'Yes, this time')!.run();
    await new Promise((r) => setTimeout(r, 30));
    expect(atlasSends).toBe(0);
    expect(alerts().some((a) => /already/.test(a.text))).toBe(true);
  });
});

const imageResult = () => ({ outputs: [{ blob: new Blob(['i'], { type: 'image/png' }), mime: 'image/png' }], costUsd: 0.1 });
const action = (label: string) => alerts().flatMap((a) => a.actions ?? []).find((a) => a.label.includes(label));
const planCard = () => useStore.getState().sessions[sid()].feed.find((f): f is PlanFeedItem => f.type === 'plan')!;

function failedPlan() {
  const settings = { count: 1, advanced: {} };
  const g = createGeneration({ sessionId: sid(), origin: 'agent', kind: 'image', prompt: 'a', modelRef: NANO, settings, inputs: { refs: [] }, planId: 'P', stepId: 's1' });
  const item: PlanFeedItem = {
    id: 'card', workspace: 'chat', createdAt: 1, type: 'plan', style: 'guided', status: 'error',
    plan: { id: 'P', title: 'P', summary: '', workspace: 'chat', steps: [{ id: 's1', title: 'Image', kind: 'image', prompt: 'a', modelRef: NANO, settings, refs: [] }], adjustments: [] },
    stepStates: { s1: 'error' }, stepGenerations: { s1: g.id },
    stepAuthorizations: { s1: costAuthorization(NANO, settings, g.estimate) }, estimate: g.estimate,
  };
  useStore.setState((s) => ({ settings: { ...s.settings, priceMargin: 'off' }, sessions: { ...s.sessions, [sid()]: { ...s.sessions[sid()], feed: [item] } } }));
  return g;
}

function addNode() {
  useStore.setState((s) => ({ sessions: { ...s.sessions, [sid()]: { ...s.sessions[sid()], graph: {
    nodes: [{ id: 'n1', position: { x: 0, y: 0 }, data: { kind: 'image', title: 'Image', prompt: 'a', modelRef: NANO, outputIndex: 0, settings: { count: 1, advanced: {} } } }],
    edges: [],
  } } } }));
}

describe('402 recovery at the spending gate', () => {
  it.each(['Retry', '402 alert'])('recovers a standalone plan Regenerate via %s exactly once', async (recovery) => {
    setup(0.08, { on: false, usd: 5 });
    const original = failedPlan();
    patchGeneration(original.id, { status: 'done' });
    updateFeedItem<PlanFeedItem>(sid(), 'card', { status: 'done', stepStates: { s1: 'done' } });
    await regenerate(original.id);
    const attempt = Object.values(useStore.getState().generations).find((g) => g.parentId === original.id)!;
    await vi.waitFor(() => expect(action('Yes, this time')).toBeDefined());
    if (recovery === 'Retry') {
      vi.mocked(ADAPTERS.nanogpt.generate).mockResolvedValue(imageResult());
      await Promise.all([retryGeneration(attempt.id), retryGeneration(attempt.id)]);
      expect(ADAPTERS.nanogpt.generate).toHaveBeenCalledTimes(2);
      expect(atlasSends).toBe(0);
    } else {
      const offer = action('Yes, this time')!;
      offer.run();
      offer.run();
      await vi.waitFor(() => expect(useStore.getState().generations[attempt.id].status).toBe('done'));
      expect(atlasSends).toBe(1);
      expect(ADAPTERS.nanogpt.generate).toHaveBeenCalledTimes(1);
    }
    expect(planCard().stepGenerations).toEqual({ s1: original.id });
    expect(useStore.getState().spendLog).toHaveLength(1);
  });

  it('sends a confirmed Regenerate once after the source plan leaves the feed', async () => {
    setup(0.08, { on: false, usd: 5 });
    const original = failedPlan();
    patchGeneration(original.id, { status: 'done' });
    useStore.setState((s) => ({ sessions: { ...s.sessions, [sid()]: { ...s.sessions[sid()], feed: [] } } }));
    vi.mocked(ADAPTERS.nanogpt.generate).mockResolvedValue(imageResult());
    await regenerate(original.id);
    const attempt = Object.values(useStore.getState().generations).find((g) => g.parentId === original.id)!;
    await vi.waitFor(() => expect(useStore.getState().generations[attempt.id].status).toBe('done'));
    expect(ADAPTERS.nanogpt.generate).toHaveBeenCalledTimes(1);
  });

  it('keeps a 402 substitute selected during a parallel step and sends it only on plan Retry', async () => {
    setup(0.08, { on: false, usd: 5 });
    failedPlan();
    const { plan } = planCard();
    updateFeedItem<PlanFeedItem>(sid(), 'card', {
      status: 'awaiting', stepStates: {}, stepGenerations: {},
      plan: { ...plan, steps: [...plan.steps, { ...plan.steps[0], id: 's2', prompt: 'parallel' } as typeof plan.steps[0]] },
    });
    let finish!: () => void;
    const parallel = new Promise<void>((resolve) => { finish = resolve; });
    vi.mocked(ADAPTERS.nanogpt.generate).mockImplementation(async ({ prompt }) => {
      if (!prompt.includes('parallel')) throw new HttpError(402, 'Insufficient balance', null);
      await parallel;
      return imageResult();
    });
    const run = approvePlan(sid(), 'card');
    try {
      await vi.waitFor(() => expect(planCard().stepStates).toMatchObject({ s1: 'error', s2: 'running' }));
      const offer = action('Yes, this time')!;
      offer.run();
      offer.run();
      expect(atlasSends).toBe(0);
      expect(useStore.getState().generations[planCard().stepGenerations.s1].modelRef).toBe(ATLAS);
      await resumePlan(sid(), 'card', 'retry', true);
      expect(atlasSends).toBe(0);
    } finally {
      finish();
      await run;
    }
    await Promise.all([resumePlan(sid(), 'card', 'retry', true), resumePlan(sid(), 'card', 'retry', true)]);
    expect(atlasSends).toBe(1);
    expect(planCard().status).toBe('done');
    expect(ADAPTERS.nanogpt.generate).toHaveBeenCalledTimes(2);
  });

  it('retries only the latest node attempt after Run follows a legacy composer generation', async () => {
    setup(0.08, { on: false, usd: 5 });
    addNode();
    const original = gen(undefined, 'node');
    patchGeneration(original.id, { status: 'error' });
    const session = useStore.getState().sessions[sid()];
    const [node] = session.graph.nodes;
    useStore.setState({ sessions: { ...useStore.getState().sessions, [sid()]: {
      ...session, graph: { ...session.graph, nodes: [{ ...node, data: { ...node.data, generationId: original.id } } as typeof node] },
    } } });
    await runNodes(sid(), ['n1']);
    const latest = Object.values(useStore.getState().generations).find((g) => g.stepId === 'n1' && g.status === 'error')!;
    vi.mocked(ADAPTERS.nanogpt.generate).mockResolvedValue(imageResult());
    await retryGeneration(original.id);
    await Promise.all([retryGeneration(latest.id), retryGeneration(latest.id)]);
    expect(ADAPTERS.nanogpt.generate).toHaveBeenCalledTimes(2);
    expect(useStore.getState().spendLog).toHaveLength(1);
    expect(Object.values(useStore.getState().generations).find((g) => g.parentId === latest.id)?.status).toBe('done');
  });

  it('blocks Retry of a composer node attempt after a successful Run relinks the node', async () => {
    setup(0.08, { on: false, usd: 5 });
    useStore.setState((s) => ({
      ui: { ...s.ui, workspace: 'node', space: undefined },
      composer: { ...s.composer, text: 'a', attachments: [], image: { ...s.composer.image, modelRef: NANO, settings: { count: 1, advanced: {} } } },
    }));
    await generateDirect('image');
    const [original] = Object.values(useStore.getState().generations);
    const node = useStore.getState().sessions[sid()].graph.nodes.find((n) => n.data.kind === 'image')!;
    await vi.waitFor(() => expect(action('Yes, this time')).toBeDefined());
    vi.mocked(ADAPTERS.nanogpt.generate).mockResolvedValue(imageResult());
    const run = await runNodes(sid(), [node.id]);
    expect(run?.outputs.get(node.id)?.assetIds).toHaveLength(1);
    await retryGeneration(original.id);
    expect(ADAPTERS.nanogpt.generate).toHaveBeenCalledTimes(2);
    expect(useStore.getState().spendLog).toHaveLength(1);
  });

  it.each([undefined, 0.14])('budgets the selected plan substitute (%s) with price margin off', async (price) => {
    setup(price, { on: true, usd: 0.12 });
    const g = failedPlan();
    await runGeneration(g.id).catch(() => undefined);
    action('Atlas')!.run();
    const estimate = planRecovery(planCard())!.estimate;
    expect(estimate.usd).toBe(price ?? null);
    expect(overLimit(estimate, sid())).toBe(true);
    await resumePlan(sid(), 'card', 'retry', true);
    expect(atlasSends).toBe(0);
    await withOncePass(sid(), () => resumePlan(sid(), 'card', 'retry', true));
    expect(planCard().status).toBe('done');
    expect(atlasSends).toBe(1);
  });

  it('holds the node during a 402 resend even if the failed attempt was not linked', async () => {
    setup(0.08, { on: false, usd: 5 });
    addNode();
    await runNodes(sid(), ['n1']);
    const first = Object.values(useStore.getState().generations)[0];
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    vi.mocked(ADAPTERS.atlas.generate).mockImplementation(async () => { atlasSends++; await pending; return imageResult(); });
    action('Yes, this time')!.run();
    try {
      await vi.waitFor(() => expect(atlasSends).toBe(1));
      await regenerate(first.id);
      await runNodes(sid(), ['n1']).catch(() => null);
      expect(ADAPTERS.nanogpt.generate).toHaveBeenCalledTimes(1);
      expect(Object.keys(useStore.getState().generations)).toEqual([first.id]);
    } finally {
      finish();
      await vi.waitFor(() => expect(useStore.getState().generations[first.id].status).toBe('done'));
    }
  });

  it('ignores a node offer after runNodes already ran that node again', async () => {
    setup(0.08, { on: false, usd: 5 });
    addNode();
    await runNodes(sid(), ['n1']);
    const old = action('Don’t ask again')!;
    vi.mocked(ADAPTERS.nanogpt.generate).mockResolvedValue(imageResult());
    await runNodes(sid(), ['n1']);
    old.run();
    expect(alerts().some((a) => /already/.test(a.text))).toBe(true);
    expect(useStore.getState().settings.autoSwitchProvider).toBe('ask');
    expect(atlasSends).toBe(0);
  });

  it('does not open a budget prompt for an already retried attempt', async () => {
    setup(0.14, { on: true, usd: 0.12 });
    const g = gen();
    await runGeneration(g.id).catch(() => undefined);
    const old = action('Atlas')!;
    vi.mocked(ADAPTERS.nanogpt.generate).mockResolvedValue(imageResult());
    await retryGeneration(g.id);
    old.run();
    expect(action('Continue once')).toBeUndefined();
    expect(atlasSends).toBe(0);
  });

  it('leaves the old plan attempt unchanged after Retry', async () => {
    setup(0.14, { on: true, usd: 0.12 });
    const g = failedPlan();
    await runGeneration(g.id).catch(() => undefined);
    const old = action('Atlas')!;
    vi.mocked(ADAPTERS.nanogpt.generate).mockResolvedValue(imageResult());
    await resumePlan(sid(), 'card', 'retry', true);
    old.run();
    expect(useStore.getState().generations[g.id].modelRef).toBe(NANO);
    expect(atlasSends).toBe(0);
  });

  it('checks the live budget before direct Retry creates an attempt', async () => {
    // The failed attempt already exists; the limit is lowered afterwards (createGeneration itself refuses an unasked run over a limit).
    setup(0.08, { on: false, usd: 5 });
    const g = gen();
    useStore.setState((s) => ({ settings: { ...s.settings, budgetOn: true, budgetUsd: 0.05 } }));
    patchGeneration(g.id, { status: 'error' });
    await retryGeneration(g.id).catch(() => undefined);
    expect(ADAPTERS.nanogpt.generate).not.toHaveBeenCalled();
    expect(Object.keys(useStore.getState().generations)).toEqual([g.id]);
  });

  it('a plan generation cannot be retried directly outside the plan gate', async () => {
    setup(0.08, { on: false, usd: 5 });
    const g = failedPlan();
    patchGeneration(g.id, { status: 'error' });
    await retryGeneration(g.id).catch(() => undefined);
    expect(ADAPTERS.nanogpt.generate).not.toHaveBeenCalled();
    expect(planCard().stepGenerations.s1).toBe(g.id);
  });

  it('keeps a recorded remote job for checking instead of falling back after 402', async () => {
    setup(0.08, { on: false, usd: 5 }, 'always');
    vi.mocked(ADAPTERS.nanogpt.generate).mockImplementationOnce(async ({ onRemoteJob }) => {
      onRemoteJob?.({ id: 'submitted', provider: 'nanogpt', meta: {} });
      throw new HttpError(402, 'Insufficient balance', null);
    });
    const g = gen();
    await runGeneration(g.id).catch(() => undefined);
    expect(atlasSends).toBe(0);
    expect(useStore.getState().generations[g.id].remoteJob?.id).toBe('submitted');
  });

  it('does not resend a submitted batch request after 402 and keeps its remote job', async () => {
    setup(0.08, { on: false, usd: 5 }, 'always');
    vi.mocked(ADAPTERS.nanogpt.generate).mockImplementationOnce(async ({ onRemoteJob }) => {
      onRemoteJob?.({ id: 'submitted', provider: 'nanogpt', meta: {} });
      throw new HttpError(402, 'Insufficient balance', null);
    });
    const g = gen();
    patchGeneration(g.id, { settings: { ...g.settings, count: 2 } });
    await runGeneration(g.id).catch(() => undefined);
    expect(useStore.getState().generations[g.id].remoteJob?.id).toBe('submitted');
    expect(useStore.getState().generations[g.id].sends?.[0]).toMatchObject({ status: 'sent', remoteJob: { id: 'submitted' } });
    expect(atlasSends).toBe(0);
  });

  it('rechecks plan approval after marking a send and before calling the adapter', async () => {
    setup(0.08, { on: false, usd: 5 });
    const g = failedPlan();
    const unsub = useStore.subscribe((s) => {
      const session = s.sessions[sid()];
      if (session.feed.length && s.generations[g.id]?.sending != null) {
        useStore.setState({ sessions: { ...s.sessions, [sid()]: { ...session, feed: [] } } });
      }
    });
    try {
      await runGeneration(g.id).catch(() => undefined);
      expect(ADAPTERS.nanogpt.generate).not.toHaveBeenCalled();
      expect(useStore.getState().generations[g.id].error).toMatch(/approval is gone/);
    } finally {
      unsub();
    }
  });
});
