import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const disk = vi.hoisted(() => ({ raw: undefined as string | undefined }));
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener() {} },
  document: { addEventListener() {}, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => disk.raw, set: async (_k: string, raw: string) => { disk.raw = raw; }, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => new Blob(['test'], { type: 'image/png' }), putAssetBlob: async () => undefined,
}));
vi.mock('../src/lib/media', async (original) => ({ ...await original<typeof import('../src/lib/media')>(),
  probeMedia: async () => ({ width: 1, height: 1 }) }));

import { useStore } from '../src/store/store';
import { createGeneration } from '../src/engine/jobs';
import { ADAPTERS } from '../src/engine/providers/registry';
import { costAuthorization } from '../src/engine/priceAuthorization';
import { resolveStepCostReview, resumePlan, sendAgentMessage, settleInterruptedPlans } from '../src/engine/agent/runtime';
import { recordPriceResults } from '../src/engine/agent/priceNotes';
import type { LlmMessage, ModelSummary, PlanFeedItem } from '../src/engine/types';

const REF = 'nanogpt::test-image';
type Body = { messages: Array<LlmMessage | { role: 'system'; content: string }>; model: string };
let bodies: Body[];
let modelCalls = 0;
let mediaCalls = 0;
let quoteCalls = 0;
let inject: (() => void) | undefined;
let toolRounds = 0;
const sid = () => useStore.getState().activeSessionId;
const agent = () => useStore.getState().sessions[sid()].agent;
const plan = () => useStore.getState().sessions[sid()].feed.find((f): f is PlanFeedItem => f.type === 'plan')!;
const notices = (body: Body, needle: string) => body.messages.filter((m) => typeof m.content === 'string' && m.content.includes(needle));

beforeEach(() => {
  disk.raw = undefined;
  bodies = []; modelCalls = 0; mediaCalls = 0; quoteCalls = 0; inject = undefined; toolRounds = 0;
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (String(url).includes('price') || String(url).includes('quote')) quoteCalls++;
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (!body.messages) return new Response(JSON.stringify({ data: [] }));
    bodies.push(body); modelCalls++;
    inject?.(); inject = undefined;
    const delta = modelCalls <= toolRounds ? { tool_calls: [{ index: 0, id: `call-${modelCalls}`,
      function: { name: 'read_guide', arguments: JSON.stringify({ id: 'workflow:storyboard' }) } }] } : { content: 'Ready.' };
    return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: modelCalls <= toolRounds ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`,
      { headers: { 'content-type': 'text/event-stream' } });
  });
  const st = useStore.getState();
  useStore.setState({
    generations: {}, quotes: {}, assets: {}, spendLog: [], spentUsd: 0,
    settings: { ...st.settings, keys: { ...st.settings.keys, nanogpt: 'test-only' }, budgetOn: false,
      agent: { ...st.settings.agent, provider: 'nanogpt', model: 'test-luna', effort: 'low' } },
    catalog: { ...st.catalog, models: { [REF]: { ref: REF, provider: 'nanogpt', id: 'test-image', name: 'Test',
      kind: 'image', acceptsText: true, acceptsImage: false, tags: [], price: { skus: [{ unit: 'output', usd: 1.2 }] } } as ModelSummary },
      schemas: { [REF]: { ref: REF, params: [], slots: { prompt: 'prompt', promptRequired: true }, source: 'catalog' } } },
    composer: { ...st.composer, agentStyle: 'guided', attachments: [], userPicked: {} },
    sessions: { ...st.sessions, [st.activeSessionId]: { ...st.sessions[st.activeSessionId], feed: [], agentMetrics: [],
      agent: { history: [], notes: [], questionRound: 0, busy: false } } },
  });
  vi.spyOn(ADAPTERS.nanogpt, 'generate').mockImplementation(async () => {
    mediaCalls++;
    return { outputs: [{ blob: new Blob(['image'], { type: 'image/png' }), mime: 'image/png' }], costUsd: 0.73 };
  });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function reviewedStep() {
  const settings = { count: 1, resolution: 'new', advanced: {} };
  const g = createGeneration({ sessionId: sid(), origin: 'agent', kind: 'image', prompt: 'test', modelRef: REF,
    settings, inputs: { refs: [] }, planId: 'P', stepId: 's1' });
  const approved = costAuthorization(REF, { ...settings, resolution: 'old' }, { usd: 0.2, approximate: true });
  const proposed = costAuthorization(REF, settings, { usd: 1.2, approximate: true });
  const item: PlanFeedItem = { id: 'card', workspace: 'chat', createdAt: 1, type: 'plan', style: 'guided', status: 'review',
    plan: { id: 'P', title: 'P', summary: 'Test', workspace: 'chat', steps: [{ id: 's1', title: 'Test', kind: 'image', prompt: 'test', modelRef: REF, settings, refs: [] }], adjustments: [] },
    stepStates: { s1: 'review' }, stepGenerations: { s1: g.id }, stepAuthorizations: { s1: approved },
    stepCostReviews: { s1: { approved, proposed, reason: 'cambiaron los parámetros', message: 'price changed' } }, estimate: proposed.estimate };
  useStore.setState((s) => ({ generations: { ...s.generations, [g.id]: { ...g, status: 'review' } },
    sessions: { ...s.sessions, [sid()]: { ...s.sessions[sid()], feed: [item] } } }));
  return g.id;
}

describe('price notices reach the model over the existing channel', () => {
  it('Continue persists the displayed amounts and sends decision + actual reported cost once', async () => {
    const gid = reviewedStep();
    await Promise.all([resolveStepCostReview(sid(), 'card', 's1', 'continue'), resolveStepCostReview(sid(), 'card', 's1', 'continue')]);
    await resolveStepCostReview(sid(), 'card', 's1', 'continue');
    expect(plan().stepCostReviews?.s1.decisions).toHaveLength(1);
    expect(plan().stepCostReviews?.s1.decisions?.[0]).toMatchObject({ decision: 'continue', generationId: gid,
      decidedAt: expect.any(Number), before: { modelRef: REF, estimate: { usd: 0.2 } }, after: { modelRef: REF, estimate: { usd: 1.2 } },
      reason: 'cambiaron los parámetros', result: { status: 'done', providerReportedUsd: 0.73 } });
    expect(notices(bodies[0], 'Decisión: Continuar')).toHaveLength(1);
    expect(notices(bodies[0], 'coste informado por el proveedor: $0.73')).toHaveLength(1);
    expect(notices(bodies[0], 'Autorizado: $1.20 estimados')[0].content).toContain('Estado: pendiente');
    expect(mediaCalls).toBe(1); expect(modelCalls).toBe(1); expect(quoteCalls).toBe(0);
    expect(useStore.getState().generations[gid].providerReportedUsd).toBe(0.73);
    const history = structuredClone(agent().history);
    recordPriceResults(sid(), 'card'); settleInterruptedPlans();
    expect(agent().notes).toEqual([]); expect(agent().history).toEqual(history);
    expect(JSON.stringify(bodies)).not.toContain('cache_control');
  });

  it('Cancel remains blocked even after notes are consumed and Retry is requested', async () => {
    reviewedStep();
    await resolveStepCostReview(sid(), 'card', 's1', 'cancel');
    expect(notices(bodies[0], 'Decisión: Cancelar. No enviado. No reintentar.')).toHaveLength(1);
    expect(plan().stepCostReviews?.s1.decisions?.[0].decision).toBe('cancel');
    expect(plan().canceledSteps).toContain('s1');
    expect(modelCalls).toBe(1);
    await resumePlan(sid(), 'card', 'retry');
    expect(mediaCalls).toBe(0); expect(quoteCalls).toBe(0);
    expect(notices(bodies.at(-1)!, 'Decisión: Cancelar. No enviado. No reintentar.')).toHaveLength(1);
  });

  it.each(['continue', 'cancel'] as const)('rehydration preserves %s and delivers pending notices once', async (choice) => {
    reviewedStep();
    useStore.setState((s) => ({ sessions: { ...s.sessions, [sid()]: { ...s.sessions[sid()], agent: { ...agent(), busy: true } } } }));
    await resolveStepCostReview(sid(), 'card', 's1', choice);
    expect(modelCalls).toBe(0);
    vi.useFakeTimers(); useStore.setState({ hydrated: true }); await vi.advanceTimersByTimeAsync(2100);
    const saved = disk.raw!;
    expect(saved).toBeTruthy();
    useStore.setState({ sessions: {}, generations: {} }); disk.raw = saved;
    await useStore.persist.rehydrate(); vi.useRealTimers();
    useStore.setState((s) => ({ sessions: { ...s.sessions, [sid()]: { ...s.sessions[sid()], agent: { ...agent(), busy: false } } } }));
    settleInterruptedPlans();
    await sendAgentMessage('status');
    const needle = choice === 'continue' ? 'Decisión: Continuar' : 'Decisión: Cancelar';
    expect(notices(bodies[0], needle)).toHaveLength(1);
    await sendAgentMessage('status again');
    expect(notices(bodies[1], needle)).toHaveLength(1);
    expect(agent().notes).toEqual([]);
    expect(plan().stepCostReviews?.s1.decisions).toHaveLength(1);
    expect(mediaCalls).toBe(choice === 'continue' ? 1 : 0);
  });

  it('an estimate never becomes provider-reported cost', async () => {
    const gid = reviewedStep();
    vi.mocked(ADAPTERS.nanogpt.generate).mockResolvedValue({ outputs: [{ blob: new Blob(['image']), mime: 'image/png' }] });
    await resolveStepCostReview(sid(), 'card', 's1', 'continue');
    expect(notices(bodies[0], 'coste real desconocido')).toHaveLength(1);
    expect(notices(bodies[0], 'coste informado por el proveedor:')).toHaveLength(0);
    expect(useStore.getState().generations[gid].providerReportedUsd).toBeUndefined();
  });

  it('rehydration after delivery keeps the same notice instead of appending it again', async () => {
    reviewedStep();
    await resolveStepCostReview(sid(), 'card', 's1', 'continue');
    const history = structuredClone(agent().history);
    vi.useFakeTimers(); useStore.setState({ hydrated: true }); await vi.advanceTimersByTimeAsync(2100);
    const saved = disk.raw!;
    useStore.setState({ sessions: {}, generations: {} }); disk.raw = saved;
    await useStore.persist.rehydrate(); vi.useRealTimers();
    settleInterruptedPlans();
    expect(agent().history).toEqual(history); expect(agent().notes).toEqual([]);
    await sendAgentMessage('status after reload');
    expect(notices(bodies[1], 'Decisión: Continuar')).toHaveLength(1);
    expect(notices(bodies[1], 'coste informado por el proveedor: $0.73')).toHaveLength(1);
    expect(mediaCalls).toBe(1);
  });

  it('a failed generation reports failure with unknown real cost', async () => {
    const gid = reviewedStep();
    useStore.setState((s) => ({ generations: { ...s.generations, [gid]: { ...s.generations[gid], providerReportedUsd: 0.99 } } }));
    vi.mocked(ADAPTERS.nanogpt.generate).mockRejectedValue(new Error('simulated failure'));
    await resolveStepCostReview(sid(), 'card', 's1', 'continue');
    expect(notices(bodies[0], 'Estado: fallido. coste real desconocido')).toHaveLength(1);
    expect(notices(bodies[0], 'Decisión: Continuar')).toHaveLength(1);
    expect(plan().stepCostReviews?.s1.decisions?.[0].result?.status).toBe('error');
    expect(useStore.getState().generations[gid].providerReportedUsd).toBeUndefined();
    expect(modelCalls).toBe(1); expect(quoteCalls).toBe(0);
  });

  it.each([[false, false], [true, false], [true, true]])('continuation preserves the complete prefix and call count (notice=%s, hurry=%s)', async (withNotice, hurry) => {
    toolRounds = 2;
    if (withNotice) inject = () => {
      if (hurry) vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_000);
      useStore.setState((s) => ({ sessions: { ...s.sessions, [sid()]: {
        ...s.sessions[sid()], agent: { ...agent(), notes: ['[app] Plan P, paso s1: antes $0.20 → ahora $1.20 (motivo: modelo). Decisión: Continuar. Autorizado: $1.20 estimados. Estado: pendiente.'] },
      } } }));
    };
    await sendAgentMessage('read the storyboard guide');
    expect(modelCalls).toBe(3); expect(quoteCalls).toBe(0); expect(mediaCalls).toBe(0);
    expect(notices(bodies[0], 'Decisión: Continuar')).toHaveLength(0);
    expect(notices(bodies[1], 'Decisión: Continuar')).toHaveLength(withNotice ? 1 : 0);
    expect(notices(bodies[2], 'Decisión: Continuar')).toHaveLength(withNotice ? 1 : 0);
    expect(notices(bodies[2], 'For this agent turn only')).toHaveLength(hurry ? 1 : 0);
    for (let i = 1; i < bodies.length; i++) {
      expect(bodies[i].messages.slice(0, bodies[i - 1].messages.length)).toEqual(bodies[i - 1].messages);
      expect(JSON.stringify(bodies[i].messages.slice(0, bodies[i - 1].messages.length))).toBe(JSON.stringify(bodies[i - 1].messages));
      expect(bodies[i].messages[0]).toEqual(bodies[0].messages[0]);
      const messages = bodies[i].messages;
      for (let j = 0; j < messages.length; j++) {
        for (const call of ('tool_calls' in messages[j] ? (messages[j] as LlmMessage).tool_calls : []) ?? [])
          expect(messages[j + 1]).toMatchObject({ role: 'tool', tool_call_id: call.id });
      }
    }
  });
});
