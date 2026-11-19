import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Graph, ModelSchema, PlanFeedItem, SettingsFeedItem } from '../src/engine/types';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener() {} }, document: { addEventListener() {}, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async (id: string) => id }));
type ChatOpts = { model: string; messages: unknown[]; signal?: AbortSignal };
const chat = vi.hoisted(() => vi.fn<(o: ChatOpts) => Promise<unknown>>());
vi.mock('../src/engine/providers/llm', async (orig) => ({ ...(await orig<typeof import('../src/engine/providers/llm')>()), chat }));
const executeSteps = vi.hoisted(() => vi.fn(async () => ({ outputs: new Map(), failed: [], skipped: [], waiting: [] })));
vi.mock('../src/engine/executor', async (orig) => ({ ...(await orig<typeof import('../src/engine/executor')>()), executeSteps }));
const retryGeneration = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../src/engine/jobs', async (orig) => ({ ...(await orig<typeof import('../src/engine/jobs')>()), retryGeneration }));

import { useStore, appendFeed } from '../src/store/store';
import { sendAgentMessage } from '../src/engine/agent/conversation';
import { enterLane, patchLane } from '../src/engine/agent/lanes';
import { approvePlan, presentNodeRun } from '../src/engine/agent/planRun';
import { changePlanChoice } from '../src/engine/agent/planSettings';
import { controllers } from '../src/engine/agent/runtimeShared';
import { draftMode } from '../src/engine/agent/draftFirst';
import { resetActions } from '../src/engine/nodecore/action';

import { mainThread } from './helpers/threads';
const HOME = useStore.getState().activeSessionId;
const ref = (id: string, type: 'chat' | 'agent', extra: Record<string, unknown> = {}) => ({
  id, position: { x: 0, y: 0 }, data: { kind: 'ref' as const, type, ref: HOME, title: id, ...extra },
});
const control = (id: string, source: string, target: string) => ({ id, source, target, sourceHandle: 'out_control', targetHandle: 'control', kind: 'control' as const });
const nodeData = (title: string) => ({ kind: 'image' as const, title, prompt: 'a mountain', modelRef: 'local::studio-image', settings: { count: 1, advanced: {} }, outputIndex: 0 });
const baseGraph = (): Graph => ({
  nodes: [
    ref('chat', 'chat'),
    ref('chat2', 'chat'),
    ref('agentA', 'agent', { llm: { provider: 'openrouter', model: 'model/a' } }),
    ref('agentB', 'agent', { llm: { provider: 'openrouter', model: 'model/b' } }),
    { id: 'imgNode', position: { x: 200, y: 0 }, data: nodeData('Mountain') },
  ],
  edges: [control('c1', 'chat', 'agentA'), control('c2', 'chat2', 'agentB')],
});
const S = () => useStore.getState().sessions[HOME];
const llmReply = (t: string, toolCalls: unknown[] = []) => ({
  text: t, toolCalls, finishReason: toolCalls.length ? 'tool_calls' : 'stop', timing: { ttfbMs: 1, totalMs: 1 },
});

const videoSchema = (ref: string): ModelSchema => ({
  ref,
  source: 'catalog',
  slots: { prompt: 'prompt' },
  params: [
    { key: 'resolution', label: 'Resolution', role: 'resolution', type: 'enum', options: ['480p', '1080p'], default: '480p' },
    { key: 'aspect', label: 'Aspect', role: 'aspect', type: 'enum', options: ['16:9', '9:16'], default: '16:9' },
    { key: 'duration', label: 'Duration', role: 'duration', type: 'enum', options: ['5', '10'], default: '5' },
  ],
});

beforeEach(() => {
  chat.mockReset();
  executeSteps.mockReset().mockResolvedValue({ outputs: new Map(), failed: [], skipped: [], waiting: [] });
  retryGeneration.mockReset().mockResolvedValue(undefined);
  resetActions();
  controllers.clear();
  vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
  const st = useStore.getState();
  useStore.setState({
    activeSessionId: HOME,
    spentUsd: 0,
    spendLog: [],
    catalog: {
      ...st.catalog,
      models: {
        ...st.catalog.models,
        'atlas::vid-a': { ref: 'atlas::vid-a', provider: 'atlas', id: 'vid-a', name: 'Vid A', kind: 'video', acceptsImage: false, pricing: { unit: 'second', usd: 0.1 } } as never,
        'atlas::vid-b': { ref: 'atlas::vid-b', provider: 'atlas', id: 'vid-b', name: 'Vid B', kind: 'video', acceptsImage: false, pricing: { unit: 'second', usd: 0.2 } } as never,
      },
      schemas: {
        ...st.catalog.schemas,
        'atlas::vid-a': videoSchema('atlas::vid-a'),
        'atlas::vid-b': videoSchema('atlas::vid-b'),
      },
      llm: {
        ...st.catalog.llm,
        openrouter: [
          { id: 'model/a', name: 'Model A', tools: true, vision: true, inputPrice: 1, outputPrice: 1 },
          { id: 'model/b', name: 'Model B', tools: true, vision: true, inputPrice: 1, outputPrice: 1 },
        ],
      },
    },
    settings: { ...st.settings, keys: { ...st.settings.keys, openrouter: 'sk-test' }, agent: { ...st.settings.agent, provider: 'openrouter', model: 'model/b' } },
    composer: { ...st.composer, agentStyle: 'auto', attachments: [] },
    sessions: {
      ...st.sessions,
      [HOME]: {
        ...st.sessions[HOME],
        graph: baseGraph(),
        feed: [],
        agents: mainThread({ history: [], questionRound: 0, notes: [], busy: false }),
        agentLane: undefined,
      },
    },
  });
});

afterEach(() => {
  for (const c of controllers.values()) c.abort();
  controllers.clear();
  vi.unstubAllGlobals();
});

describe('adversarial: dinero, doble gasto y planes cruzados', () => {
  // FALLO REAL: approveNodeRun (planRun.ts:119-139) hace await prepareNodeRun antes de marcar status='running' y sin candado ni runId estable; un segundo clic concurrente choca con lockNodes y revierte la tarjeta a status='awaiting' mientras el primer run sigue en vuelo (y si el primero acaba antes, ejecuta y cobra dos veces).
  it('doble clic concurrente en aprobar un nodeRun de A no debe revertir la tarjeta a awaiting ni disparar dos ejecuciones', async () => {
    enterLane(HOME, 'agentA');
    const card = await presentNodeRun(HOME, ['imgNode'], null, undefined, 'agentA');
    expect(card.errors).toEqual([]);
    const itemId = card.itemId!;

    let releaseRun!: () => void;
    executeSteps.mockImplementationOnce(
      () => new Promise((res) => { releaseRun = () => res({ outputs: new Map(), failed: [], skipped: [], waiting: [] }); }),
    );

    const first = approvePlan(HOME, itemId);
    const second = approvePlan(HOME, itemId);
    await second;
    await vi.waitFor(() => expect(typeof releaseRun).toBe('function')); // the first click's run has reached the provider
    // Mientras el primer run sigue en vuelo, el segundo clic NO debe haber devuelto la tarjeta a 'awaiting' (rehabilitando Approve).
    const statusWhileRunning = (S().feed.find((f) => f.id === itemId) as PlanFeedItem).status;
    releaseRun();
    await first;

    expect(statusWhileRunning).toBe('running');
    expect(executeSteps).toHaveBeenCalledTimes(1);
  });

  // FALLO REAL: approvePlan (planRun.ts:47) no bloquea aprobar un plan mientras su dueño A lo está revisando (agentA.revising === itemId), y PlanCard.tsx:143 lee session.agent.revising (B = undefined) habilitando el botón Approve; el plan viejo se ejecuta y cobra.
  it('aprobar el plan viejo de A mientras A lo revisa de fondo y B está en pantalla debe rechazarse', async () => {
    enterLane(HOME, 'agentA');
    const planA: PlanFeedItem = {
      id: 'fd_planA_rev', createdAt: 1, workspace: 'chat', type: 'plan', style: 'auto', status: 'awaiting',
      plan: { id: 'plnRev', title: 'Old Plan A', summary: 'old', workspace: 'chat', steps: [{ id: 's1', kind: 'image', title: 'Img', prompt: 'old', modelRef: 'local::studio-image', refs: [], settings: { count: 1, advanced: {} } }], adjustments: [] },
      stepStates: { s1: 'pending' }, stepGenerations: {}, estimate: { usd: 0.5, approximate: false },
      meta: { agentNodeId: 'agentA', chatNodeId: 'chat' },
    };
    appendFeed(HOME, planA);
    // El usuario comentó sobre el planA: A está ocupado revisándolo de fondo; B está en pantalla.
    patchLane(HOME, 'agentA', { busy: true, revising: planA.id });
    enterLane(HOME, 'agentB');

    await approvePlan(HOME, planA.id);

    expect(executeSteps).not.toHaveBeenCalled();
    expect((S().feed.find((f) => f.id === planA.id) as PlanFeedItem).status).toBe('awaiting');
  });

  // FALLO REAL: canvasCalls.ts:74 (recover_plan) busca el último plan fallido de toda la sesión sin filtrar por c.owner; un turno de B reintenta y vuelve a cobrar el plan fallido de A.
  it('recover_plan llamado por B no debe reintentar ni cobrar el plan fallido de A', async () => {
    enterLane(HOME, 'agentA');
    const st = useStore.getState();
    useStore.setState({
      generations: {
        ...st.generations,
        genFailA: { id: 'genFailA', sessionId: HOME, kind: 'image', status: 'error', error: 'timeout', modelRef: 'local::studio-image', prompt: 'p', settings: { count: 1, advanced: {} }, inputs: { refs: [] }, assetIds: [], estimate: { usd: 1, approximate: false }, createdAt: 1 } as never,
      },
    });
    const failedPlanA: PlanFeedItem = {
      id: 'fd_failA', createdAt: 1, workspace: 'chat', type: 'plan', style: 'auto', status: 'error',
      plan: { id: 'plnFailA', title: 'Failed Plan A', summary: 'A', workspace: 'chat', steps: [{ id: 's1', kind: 'image', title: 'Img', prompt: 'p', modelRef: 'local::studio-image', refs: [], settings: { count: 1, advanced: {} } }], adjustments: [] },
      stepStates: { s1: 'error' }, stepGenerations: { s1: 'genFailA' }, estimate: { usd: 1.0, approximate: false },
      meta: { agentNodeId: 'agentA', chatNodeId: 'chat' },
    };
    appendFeed(HOME, failedPlanA);

    let bCalls = 0;
    chat.mockImplementation(async () => {
      bCalls++;
      if (bCalls === 1) return llmReply('', [{ id: 'recB', name: 'recover_plan', arguments: JSON.stringify({ action: 'retry' }) }]);
      return llmReply('B done');
    });

    await sendAgentMessage('retry my failed plan', { agentNodeId: 'agentB', chatNodeId: 'chat2' });

    expect(retryGeneration).not.toHaveBeenCalled();
    expect(executeSteps).not.toHaveBeenCalled();
    expect((S().feed.find((f) => f.id === failedPlanA.id) as PlanFeedItem).status).toBe('error');
  });

  // FALLO REAL: planDraft (planSettings.ts:70) y promptWriterOn (planSettings.ts:144) leen session.agent (B en pantalla) en vez del dueño del plan (A); editar la tarjeta de A rompe el candado Borrador (sube a 1080p) y cobra un rewrite LLM aunque A tenía enhance=false.
  it('cambiar el modelo en el plan de A mientras B (hq + enhance=true) está en pantalla debe respetar el candado Borrador y enhance=false de A', async () => {
    enterLane(HOME, 'agentA');
    patchLane(HOME, 'agentA', { draftMode: draftMode('draft'), enhance: false });
    const inlineA: SettingsFeedItem = {
      id: 'fd_setA', createdAt: 1, workspace: 'chat', type: 'settings', status: 'confirmed', inline: true,
      draft: draftMode('draft'),
      sections: [{ kind: 'video', count: 1, recommended: { modelRef: 'atlas::vid-a', resolution: '480p', aspect: '16:9', duration: 5, needsImage: false }, chosen: { modelRef: 'atlas::vid-a', resolution: '480p', aspect: '16:9', duration: 5, needsImage: false }, alternatives: ['atlas::vid-b'] }],
      meta: { agentNodeId: 'agentA', chatNodeId: 'chat' },
    };
    const planA: PlanFeedItem = {
      id: 'fd_planA_vid', createdAt: 2, workspace: 'chat', type: 'plan', style: 'auto', status: 'awaiting',
      plan: { id: 'plnVidA', title: 'Video A', summary: 'A', workspace: 'chat', steps: [{ id: 'v1', kind: 'video', title: 'Clip', prompt: 'cat walking', modelRef: 'atlas::vid-a', settings: { count: 1, advanced: {}, resolution: '480p', aspect: '16:9', duration: 5 } }], adjustments: [] },
      stepStates: { v1: 'pending' }, stepGenerations: {}, estimate: { usd: 0.5, approximate: false },
      meta: { agentNodeId: 'agentA', chatNodeId: 'chat' },
    };
    appendFeed(HOME, inlineA);
    appendFeed(HOME, planA);

    // B entra en pantalla con Alta calidad (desbloqueado) y enhance activado.
    enterLane(HOME, 'agentB');
    patchLane(HOME, 'agentB', { draftMode: draftMode('hq'), enhance: true });

    chat.mockResolvedValue(llmReply(JSON.stringify({ v1: 'rewritten prompt' })));

    await changePlanChoice(HOME, planA.id, 'video', { modelRef: 'atlas::vid-b', resolution: '1080p', aspect: '16:9', duration: 5, needsImage: false }, 'atlas::vid-a');

    const updated = S().feed.find((f) => f.id === planA.id) as PlanFeedItem;
    const step = updated.plan.steps[0] as Extract<PlanFeedItem['plan']['steps'][number], { kind: 'video' }>;
    // A tenía Borrador bloqueado (480p) y enhance=false: ni debe subir a 1080p ni debe cobrar un rewrite LLM.
    expect(step.settings.resolution).toBe('480p');
    expect(chat).not.toHaveBeenCalled();
  });
});
