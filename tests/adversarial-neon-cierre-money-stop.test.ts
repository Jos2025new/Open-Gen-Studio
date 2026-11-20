import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandApprovalFeedItem, GenNodeData, Graph, GraphNode, PlanFeedItem } from '../src/engine/types';

vi.hoisted(() => Object.assign(globalThis, {
  window: { setTimeout, clearTimeout, addEventListener() {} },
  document: { addEventListener() {}, visibilityState: 'visible' },
}));
const getAssetBlob = vi.hoisted(() => vi.fn<() => Promise<Blob | undefined>>(async () => undefined));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob,
  putAssetBlob: async (id: string) => id,
  deleteAssetBlobs: async () => undefined,
}));
const chat = vi.hoisted(() => vi.fn());
vi.mock('../src/engine/providers/llm', async (orig) => ({ ...(await orig<typeof import('../src/engine/providers/llm')>()), chat }));
const executeSteps = vi.hoisted(() => vi.fn());
vi.mock('../src/engine/executor', async (orig) => {
  const real = await orig<typeof import('../src/engine/executor')>();
  return { ...real, executeSteps: (...args: unknown[]) => executeSteps(...args) };
});
const retryGeneration = vi.hoisted(() => vi.fn());
vi.mock('../src/engine/jobs', async (orig) => {
  const real = await orig<typeof import('../src/engine/jobs')>();
  return { ...real, retryGeneration: (...args: unknown[]) => retryGeneration(...args) };
});
vi.mock('../src/lib/writerLock', () => ({
  holdsWriterLock: () => true,
  mayStartWork: () => true,
  getWriterState: () => ({ role: 'writer', requested: false }),
  onWriterLockGranted: () => () => undefined,
}));

import { setApprover } from '../src/engine/commands';
import { useStore } from '../src/store/store';
import { sendAgentMessage } from '../src/engine/agent/conversation';
import { controllers, feedOfChat, stopAgent } from '../src/engine/agent/runtimeShared';
import { laneState, patchLane } from '../src/engine/agent/lanes';
import { approvePlan, resumePlan } from '../src/engine/agent/planRun';
import { decideCommandApproval } from '../src/engine/agent/commandCalls';
import { prepareAction, resetActions, runAction } from '../src/engine/nodecore/action';
import { patchNodeData } from '../src/engine/flow/actions';
import { mainThread } from './helpers/threads';

const HOME = useStore.getState().activeSessionId;
const S = () => useStore.getState().sessions[HOME];
const ref = (id: string, type: 'chat' | 'agent') => ({
  id,
  position: { x: 0, y: 0 },
  data: { kind: 'ref' as const, type, ref: HOME, title: id },
});
const control = (id: string, source: string, target: string) => ({
  id,
  source,
  target,
  sourceHandle: 'out_control',
  targetHandle: 'control',
  kind: 'control' as const,
});
const imgNode = (id: string, prompt = 'a red apple'): GraphNode => ({
  id,
  position: { x: 300, y: 0 },
  data: {
    kind: 'image',
    title: id,
    prompt,
    modelRef: 'openrouter::img-paid',
    settings: { count: 1, aspect: '1:1', advanced: {} },
    outputIndex: 0,
  } as GenNodeData,
});
const baseGraph = (): Graph => ({
  nodes: [ref('chat1', 'chat'), ref('agentA', 'agent'), ref('chat2', 'chat'), ref('agentB', 'agent'), imgNode('n1')],
  edges: [control('c1', 'chat1', 'agentA'), control('c2', 'chat2', 'agentB')],
});
const llmReply = (text: string, toolCalls: Array<{ id: string; name: string; arguments: string }> = []) => ({
  text,
  toolCalls,
  usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 },
  timing: { totalMs: 5, outputMs: 5 },
  finishReason: toolCalls.length ? 'tool_calls' as const : 'stop' as const,
});
const makePlan = (id: string, owner: string, chatNodeId: string): PlanFeedItem => ({
  id,
  createdAt: 1,
  workspace: 'chat',
  type: 'plan',
  style: 'auto',
  status: 'awaiting',
  plan: {
    id: `pln_${id}`,
    title: 'Plan de prueba',
    summary: 'Resumen',
    workspace: 'chat',
    steps: [{
      id: 's1',
      kind: 'image',
      title: 'Imagen',
      prompt: 'old prompt',
      modelRef: 'openrouter::img-paid',
      refs: [],
      settings: { count: 1, aspect: '1:1', advanced: {} },
    }],
    adjustments: [],
  },
  estimate: { usd: 0.25, approximate: false },
  stepStates: { s1: 'pending' },
  stepGenerations: {},
  meta: { agentNodeId: owner, chatNodeId },
});

beforeEach(() => {
  setApprover(null);
  chat.mockReset();
  executeSteps.mockReset();
  retryGeneration.mockReset();
  getAssetBlob.mockReset().mockResolvedValue(undefined);
  controllers.clear();
  resetActions();
  const st = useStore.getState();
  useStore.setState({
    activeSessionId: HOME,
    generations: {},
    assets: {
      img1: { id: 'img1', sessionId: HOME, kind: 'image', origin: 'upload', name: 'ref.png', width: 512, height: 512, createdAt: 1 } as never,
    },
    composer: { ...st.composer, mode: 'agent', agentStyle: 'auto', text: '', attachments: [] },
    ui: { ...st.ui, workspace: 'chat' },
    catalog: {
      ...st.catalog,
      models: {
        ...st.catalog.models,
        'openrouter::img-paid': {
          ref: 'openrouter::img-paid',
          provider: 'openrouter',
          id: 'img-paid',
          name: 'Img Paid',
          kind: 'image',
          tags: [],
          acceptsImage: false,
          pricing: { perImage: 0.25 },
        } as never,
      },
      schemas: {
        ...st.catalog.schemas,
        'openrouter::img-paid': {
          modelRef: 'openrouter::img-paid',
          source: 'fetched',
          params: [],
          slots: { prompt: 'prompt' },
        } as never,
      },
      llm: {
        ...st.catalog.llm,
        openrouter: [{ id: 'openai/gpt-4o-mini', name: 'GPT-4o mini', tools: true, vision: true, inputPrice: 0.1, outputPrice: 0.1 }],
      },
    },
    settings: {
      ...st.settings,
      keys: { ...st.settings.keys, openrouter: 'sk-test' },
      agent: { ...st.settings.agent, provider: 'openrouter', model: 'openai/gpt-4o-mini', showThinking: false },
      budgetOn: false,
    },
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
});

describe('adversarial cierre: dinero, Stop y aprobaciones', () => {
  // FALLO REAL: canvasCalls.ts:131 llama runCommandsTool(sessionId, parsed.value) sin signal ni meta: pulsar Stop deja la tarjeta de aprobación viva (awaiting) y aprobarla después ejecuta y gasta dinero; además cae en chat1 en vez de chat2.
  it('run_commands con gasto: pulsar Stop debe cancelar la tarjeta de aprobación, impedir el gasto tardío y etiquetarla en chat2', async () => {
    executeSteps.mockResolvedValue({ outputs: new Map([['n1', { assetIds: [] }]]), failed: [], skipped: [], waiting: [] });
    const runCmdCall = {
      id: 'tc-cmd-spend',
      name: 'run_commands',
      arguments: JSON.stringify({ seq: [{ cmd: 'nodes.run.start', args: { targets: ['n1'], force: true } }] }),
    };
    chat.mockResolvedValueOnce(llmReply('', [runCmdCall])).mockResolvedValueOnce(llmReply('Done'));

    const turn = sendAgentMessage('corre el nodo n1', { agentNodeId: 'agentB', chatNodeId: 'chat2' });
    await vi.waitFor(() => {
      expect(S().feed.some((f) => f.type === 'commands' && f.status === 'awaiting')).toBe(true);
    });

    const card = S().feed.find((f): f is CommandApprovalFeedItem => f.type === 'commands')!;
    const inChat2 = feedOfChat(HOME, 'chat2').some((f) => f.id === card.id);

    // El usuario pulsa Stop en agentB antes de aprobar.
    stopAgent(HOME, 'agentB');
    await turn;

    const afterStop = S().feed.find((f): f is CommandApprovalFeedItem => f.id === card.id)!;
    // Aprobar una tarjeta de un turno ya detenido no debe ejecutar ni gastar dinero.
    const accepted = decideCommandApproval(HOME, card.id, 'approve');
    await new Promise((r) => setTimeout(r, 20));
    expect({ statusAfterStop: afterStop.status, accepted, spentCalls: executeSteps.mock.calls.length, inChat2 }).toEqual({
      statusAfterStop: 'canceled',
      accepted: false,
      spentCalls: 0,
      inChat2: true,
    });
  });

  // FALLO REAL: conversation.ts:114-120 espera visibleAttachments antes de marcar revising: mientras los adjuntos cargan, approvePlan permite cobrar el plan viejo que el usuario ya está revisando.
  it('comentar un plan con adjunto: mientras visibleAttachments espera, approvePlan no debe cobrar el plan viejo', async () => {
    const plan = makePlan('plan-rev', 'agentA', 'chat1');
    useStore.setState((st) => ({
      sessions: { ...st.sessions, [HOME]: { ...st.sessions[HOME], feed: [plan] } },
    }));
    patchLane(HOME, 'agentA', { pending: { toolCallId: 'tc-plan', kind: 'plan', feedItemId: plan.id } });

    let releaseBlob!: () => void;
    getAssetBlob.mockImplementationOnce(() => new Promise((resolve) => { releaseBlob = () => resolve(undefined); }));
    chat.mockResolvedValueOnce(llmReply('Revisando'));
    executeSteps.mockResolvedValue({ outputs: new Map([['s1', { assetIds: [] }]]), failed: [], skipped: [], waiting: [] });

    const commentTurn = sendAgentMessage('cámbialo a azul', { agentNodeId: 'agentA', chatNodeId: 'chat1', attachments: ['img1'] });
    await vi.waitFor(() => expect(releaseBlob).toBeTypeOf('function'));

    // Mientras la revisión espera los adjuntos, aprobar el plan viejo debe bloquearse.
    await approvePlan(HOME, plan.id);
    releaseBlob();
    await commentTurn;

    expect(executeSteps).not.toHaveBeenCalled();
  });

  // FALLO REAL: conversation.ts:114-119 empuja replyToCard (tool_call_id) antes de await visibleAttachments y de limpiar pending: pulsar Stop ahí deja pending con el mismo toolCallId y aprobar después duplica el mensaje role:tool en history.
  it('pulsar Stop mientras la revisión de plan espera adjuntos no debe dejar un tool_call_id duplicado al aprobar después', async () => {
    const plan = makePlan('plan-stop-rev', 'agentA', 'chat1');
    useStore.setState((st) => ({
      sessions: { ...st.sessions, [HOME]: { ...st.sessions[HOME], feed: [plan] } },
    }));
    patchLane(HOME, 'agentA', {
      history: [{ role: 'assistant', content: null, tool_calls: [{ id: 'tc-plan-1', type: 'function', function: { name: 'propose_plan', arguments: '{}' } }] }],
      pending: { toolCallId: 'tc-plan-1', kind: 'plan', feedItemId: plan.id },
    });

    let releaseBlob!: () => void;
    getAssetBlob.mockImplementationOnce(() => new Promise((resolve) => { releaseBlob = () => resolve(undefined); }));
    executeSteps.mockResolvedValue({ outputs: new Map([['s1', { assetIds: [] }]]), failed: [], skipped: [], waiting: [] });

    const commentTurn = sendAgentMessage('hazlo verde', { agentNodeId: 'agentA', chatNodeId: 'chat1', attachments: ['img1'] });
    await vi.waitFor(() => expect(releaseBlob).toBeTypeOf('function'));

    stopAgent(HOME, 'agentA');
    releaseBlob();
    await commentTurn;

    // Tras cancelar el comentario, aprobar el plan debe dejar como máximo una respuesta role:'tool' para tc-plan-1.
    await approvePlan(HOME, plan.id);
    const toolMsgs = (laneState(HOME, 'agentA')?.history ?? []).filter((m) => m.role === 'tool' && m.tool_call_id === 'tc-plan-1');
    expect(toolMsgs).toHaveLength(1);
  });

  // Ataque que pasa: doble resumePlan('retry') simultáneo solo reintenta una vez.
  it('doble clic simultáneo en resumePlan("retry") ejecuta exactamente un reintento', async () => {
    const plan: PlanFeedItem = {
      ...makePlan('plan-fail', 'agentA', 'chat1'),
      status: 'error',
      stepStates: { s1: 'error' },
      stepGenerations: { s1: 'gen-fail-1' },
    };
    useStore.setState((st) => ({
      generations: {
        'gen-fail-1': {
          id: 'gen-fail-1',
          sessionId: HOME,
          kind: 'image',
          status: 'error',
          error: 'boom',
          prompt: 'old',
          modelRef: 'openrouter::img-paid',
          settings: { count: 1, aspect: '1:1', advanced: {} },
          inputs: { refs: [] },
          assetIds: [],
          createdAt: 1,
        } as never,
      },
      sessions: { ...st.sessions, [HOME]: { ...st.sessions[HOME], feed: [plan] } },
    }));

    let releaseRetry!: () => void;
    retryGeneration.mockImplementationOnce(() => new Promise<void>((resolve) => { releaseRetry = resolve; }));
    executeSteps.mockResolvedValue({ outputs: new Map(), failed: [], skipped: [], waiting: [] });

    const r1 = resumePlan(HOME, plan.id, 'retry', true);
    const r2 = resumePlan(HOME, plan.id, 'retry', true);
    expect(await r2).toContain('no failed steps');
    releaseRetry();
    await r1;
    expect(retryGeneration).toHaveBeenCalledTimes(1);
  });

  // Ataque que pasa: adoptPreview/prepareAction + runAction rechaza como stale si el nodo cambia tras aprobar.
  it('runAction rechaza como stale sin cobrar cuando un input cambia después de prepareAction/adoptPreview', async () => {
    const prep = await prepareAction(HOME, ['n1'], true);
    expect(prep.ok).toBe(true);
    if (!prep.ok) return;

    patchNodeData(HOME, 'n1', { prompt: 'changed after approval' });
    const rec = await runAction(prep.snapshot, 'run-after-edit');
    expect(rec.status).toBe('stale');
    expect(rec.sends).toBe(0);
    expect(executeSteps).not.toHaveBeenCalled();
  });
});
