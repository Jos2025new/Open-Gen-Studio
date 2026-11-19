import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedItem, Graph, PlanFeedItem, QuestionsFeedItem } from '../src/engine/types';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener() {} }, document: { addEventListener() {}, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async (id: string) => id, deleteAssetBlobs: async () => undefined }));
type ChatOpts = { model: string; messages: unknown[]; signal?: AbortSignal; onText?: (d: string, full: string) => void };
const chat = vi.hoisted(() => vi.fn<(o: ChatOpts) => Promise<unknown>>());
vi.mock('../src/engine/providers/llm', async (orig) => ({ ...(await orig<typeof import('../src/engine/providers/llm')>()), chat }));
const executeSteps = vi.hoisted(() => vi.fn(async () => ({ outputs: new Map(), failed: [], skipped: [], waiting: [] })));
vi.mock('../src/engine/executor', async (orig) => ({ ...(await orig<typeof import('../src/engine/executor')>()), executeSteps }));

import { useStore, appendFeed, patchSession } from '../src/store/store';
import { deleteSession } from '../src/engine/actions';
import { sendAgentMessage, retryAgentTurn, submitAnswers } from '../src/engine/agent/conversation';
import { deleteUserMessage, editUserMessage, reopenCard } from '../src/engine/agent/messageEdit';
import { enterLane, laneState, patchLane } from '../src/engine/agent/lanes';
import { controllers, feedOfChat, presentPlan, setTurnChat, turnKey } from '../src/engine/agent/runtimeShared';
import { approvePlan } from '../src/engine/agent/planRun';
import { inferChoices } from '../src/engine/agent/userChoice';
import { recordPriceResults } from '../src/engine/agent/priceNotes';
import { applyEdit } from '../src/engine/nodecore/edit';
import { applyModelLinkToAgent } from '../src/engine/nodes/system';
import { NetworkError } from '../src/lib/http';

const HOME = useStore.getState().activeSessionId;
const INITIAL_SESSION = structuredClone(useStore.getState().sessions[HOME]);
const ref = (id: string, type: 'chat' | 'agent' | 'model', extra: Record<string, unknown> = {}) => ({
  id,
  position: { x: 0, y: 0 },
  data: { kind: 'ref' as const, type, ref: HOME, title: id, ...extra },
});
const control = (id: string, source: string, target: string) => ({ id, source, target, sourceHandle: 'out_control', targetHandle: 'control', kind: 'control' as const });
const baseGraph = (): Graph => ({
  nodes: [
    ref('chat', 'chat'),
    ref('chat2', 'chat'),
    ref('agentA', 'agent', { llm: { provider: 'openrouter', model: 'model/a' } }),
    ref('agentB', 'agent', { llm: { provider: 'openrouter', model: 'model/b' } }),
  ],
  edges: [control('c1', 'chat', 'agentA'), control('c2', 'chat2', 'agentB')],
});
const S = (id = HOME) => useStore.getState().sessions[id];
const asText = (x: unknown) => JSON.stringify(x);
const llmReply = (t: string, toolCalls: unknown[] = [], usage?: { inputTokens: number; outputTokens: number; costUsd?: number }) => ({
  text: t,
  toolCalls,
  finishReason: toolCalls.length ? 'tool_calls' : 'stop',
  timing: { ttfbMs: 1, totalMs: 1 },
  ...(usage ? { usage } : {}),
});

let releaseA: (() => void) | undefined;

beforeEach(() => {
  releaseA = undefined;
  chat.mockReset();
  executeSteps.mockClear();
  controllers.clear();
  vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
  const st = useStore.getState();
  useStore.setState({
    activeSessionId: HOME,
    spentUsd: 0,
    spendLog: [],
    catalog: {
      ...st.catalog,
      llm: {
        ...st.catalog.llm,
        openrouter: [
          { id: 'model/a', name: 'Model A', tools: true, vision: false, inputPrice: 1, outputPrice: 1 },
          { id: 'model/b', name: 'Model B', tools: true, vision: true, inputPrice: 1, outputPrice: 1 },
        ],
      },
    },
    settings: { ...st.settings, keys: { ...st.settings.keys, openrouter: 'sk-test' }, agent: { ...st.settings.agent, provider: 'openrouter', model: 'model/b' } },
    composer: { ...st.composer, agentStyle: 'auto', attachments: [] },
    sessions: {
      ...st.sessions,
      [HOME]: {
        ...INITIAL_SESSION,
        id: HOME,
        graph: baseGraph(),
        feed: [],
        agent: { history: [], questionRound: 0, notes: [], busy: false },
        agentLane: undefined,
        agents: undefined,
      },
    },
  });
});

afterEach(() => {
  releaseA?.();
  releaseA = undefined;
  for (const c of controllers.values()) c.abort();
  controllers.clear();
  vi.unstubAllGlobals();
});

async function startAInBackgroundAndBOnScreen(aReply: () => unknown = () => llmReply('A done')) {
  chat.mockImplementation(async (o) => {
    const last = asText(o.messages.at(-1));
    if (last.includes('task for A')) {
      o.onText?.('A', 'A partial');
      await new Promise<void>((res, rej) => {
        releaseA = res;
        o.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
      });
      return aReply();
    }
    return llmReply('B done');
  });
  const aTurn = sendAgentMessage('task for A', { agentNodeId: 'agentA', chatNodeId: 'chat' });
  await vi.waitFor(() => expect(chat).toHaveBeenCalledTimes(1));
  await sendAgentMessage('hello B', { agentNodeId: 'agentB', chatNodeId: 'chat2' });
  expect(S().agentLane).toBe('agentB');
  expect(laneState(HOME, 'agentA')?.busy).toBe(true);
  expect(laneState(HOME, 'agentB')?.busy).toBe(false);
  return { aTurn };
}

describe('adversarial: cruce entre agentes, borrado, edición y revisión', () => {
  // FALLO REAL: editUserMessage lee s.agent.busy (el de B en pantalla = false) en vez del dueño A; trunca el historial de A y borra sus mensajes en pleno turno mientras el reenvío a A queda bloqueado.
  it('editar un mensaje de A mientras A trabaja de fondo y B está en pantalla no debe truncar A ni perder la edición', async () => {
    const { aTurn } = await startAInBackgroundAndBOnScreen();
    const msgA = S().feed.find((f) => f.type === 'user' && f.meta?.agentNodeId === 'agentA')!;
    const historyBefore = laneState(HOME, 'agentA')!.history.length;

    await editUserMessage(HOME, msgA.id, 'edited task for A');

    // Al estar A ocupado, la edición debe rechazarse: el mensaje y el historial de A deben seguir intactos.
    expect(S().feed.some((f) => f.id === msgA.id)).toBe(true);
    expect(laneState(HOME, 'agentA')!.history.length).toBe(historyBefore);
    releaseA?.();
    await aTurn;
  });

  // FALLO REAL: deleteUserMessage lee s.agent.busy (B = false) en vez de agentOf(sessionId, owner).busy; borra el mensaje de A y muta su historial mientras A está corriendo.
  it('borrar un mensaje de A mientras A trabaja de fondo y B está en pantalla debe rechazarse', async () => {
    const { aTurn } = await startAInBackgroundAndBOnScreen();
    const msgA = S().feed.find((f) => f.type === 'user' && f.meta?.agentNodeId === 'agentA')!;

    deleteUserMessage(HOME, msgA.id);

    expect(S().feed.some((f) => f.id === msgA.id)).toBe(true);
    expect(asText(laneState(HOME, 'agentA')!.history)).not.toContain('deleted this message');
    releaseA?.();
    await aTurn;
  });

  // FALLO REAL: borrar el nodo agentA a mitad de turno no detiene su llamada y agentNodeOf(HOME, 'agentA') hace fallback a agents[0] ('agentB'), etiquetando la respuesta y tarjeta de A como escritas por B.
  it('borrar el nodo agentA mientras A trabaja de fondo no debe atribuir su salida a agentB', async () => {
    const ask = { id: 'qA', name: 'ask_questions', arguments: JSON.stringify({ questions: [{ id: 'q1', question: 'Q from deleted A?', options: ['a', 'b'] }] }) };
    const { aTurn } = await startAInBackgroundAndBOnScreen(() => llmReply('answer from deleted A', [ask]));

    const deleted = applyEdit({ session: HOME, op: { op: 'delete', nodes: ['agentA'] } });
    expect(deleted.ok).toBe(true);

    releaseA?.();
    await aTurn;

    const leakedToB = S().feed.filter(
      (f) =>
        ((f.type === 'assistant' && f.text.includes('deleted A')) || (f.type === 'questions' && f.questions[0]?.question.includes('deleted A'))) &&
        f.meta?.agentNodeId === 'agentB',
    );
    expect(leakedToB).toEqual([]);
  });

  // FALLO REAL: deleteSession no detiene los agentes de la sesión; el turno de A sigue vivo tras borrar la sesión, cobra gasto LLM y rompe al tocar session(id) inexistente (dejando el controller colgado).
  it('borrar la sesión mientras A trabaja de fondo debe abortar A sin gasto posterior ni crash', async () => {
    let seenSignal: AbortSignal | undefined;
    chat.mockImplementation(async (o) => {
      seenSignal = o.signal;
      await new Promise<void>((res, rej) => {
        releaseA = res;
        o.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
      });
      return llmReply('ghost reply', [], { inputTokens: 1000, outputTokens: 500, costUsd: 0.25 });
    });

    const aTurn = sendAgentMessage('work in doomed session', { agentNodeId: 'agentA', chatNodeId: 'chat' });
    const settled = aTurn.then(() => ({ ok: true as const }), (err) => ({ ok: false as const, err }));
    await vi.waitFor(() => expect(chat).toHaveBeenCalledTimes(1));

    deleteSession(HOME);
    releaseA?.();
    const out = await settled;
    expect(seenSignal?.aborted).toBe(true);
    expect(out.ok).toBe(true);
    expect(useStore.getState().spentUsd).toBe(0);
    expect(controllers.has(turnKey(HOME, 'agentA'))).toBe(false);
  });

  // FALLO REAL: carryOverRevision (planRevision.ts:13) lee session.agent.revising (el de B en pantalla) en lugar de agentOf(sessionId, owner).revising; la revisión de A pierde su estilo y hereda el estilo del plan de B.
  it('revisar un plan de A mientras B está en pantalla y revisando otro plan debe conservar el estilo de A, no robar el de B', async () => {
    enterLane(HOME, 'agentA');
    const planA: PlanFeedItem = {
      id: 'fd_planA', createdAt: 1, workspace: 'chat', type: 'plan', style: 'auto', status: 'awaiting',
      plan: { id: 'plnA', title: 'Plan A', summary: 'A', workspace: 'chat', style: 'noir cinema', steps: [{ id: 's1', kind: 'text', title: 'T', text: 'x' }], adjustments: [] },
      stepStates: { s1: 'pending' }, stepGenerations: {}, estimate: { usd: 0, approximate: false },
      meta: { agentNodeId: 'agentA', chatNodeId: 'chat' },
    };
    const planB: PlanFeedItem = {
      id: 'fd_planB', createdAt: 2, workspace: 'chat', type: 'plan', style: 'auto', status: 'awaiting',
      plan: { id: 'plnB', title: 'Plan B', summary: 'B', workspace: 'chat', style: 'pastel anime', steps: [{ id: 's1', kind: 'text', title: 'T', text: 'y' }], adjustments: [] },
      stepStates: { s1: 'pending' }, stepGenerations: {}, estimate: { usd: 0, approximate: false },
      meta: { agentNodeId: 'agentB', chatNodeId: 'chat2' },
    };
    appendFeed(HOME, planA);
    appendFeed(HOME, planB);
    patchLane(HOME, 'agentA', { revising: planA.id });
    enterLane(HOME, 'agentB');
    patchLane(HOME, 'agentB', { revising: planB.id });

    // A presenta su revisión omitiendo style (debe heredar 'noir cinema' de planA, jamás 'pastel anime' de planB).
    const res = await presentPlan(HOME, 'chat', { title: 'Plan A v2', summary: 'revised', steps: [{ id: 's1', kind: 'text', title: 'T', text: 'x2' }] }, null, 'agentA', true);
    expect(res.errors).toEqual([]);
    const revised = S().feed.find((f) => f.id === res.itemId) as PlanFeedItem;
    expect(revised.plan.style).toBe('noir cinema');
  });

  // FALLO REAL: requestWords (userChoice.ts:43) lee el último mensaje 'user' de todo s.feed sin filtrar por dueño; un mensaje para B nombrando "Kling 2.6" marca user_requested=true en el plan de A.
  it('un mensaje del usuario a B nombrando un modelo no debe marcar user_requested en la petición en curso de A', async () => {
    enterLane(HOME, 'agentA');
    patchLane(HOME, 'agentA', { draft: { request: 'haz un video corto de un gato', answers: {}, attachments: [] } });
    appendFeed(HOME, { id: 'uA', createdAt: 1, workspace: 'chat', type: 'user', text: 'haz un video corto de un gato', mode: 'agent', attachments: [], meta: { agentNodeId: 'agentA', chatNodeId: 'chat' } });
    // Mientras A trabaja, el usuario le escribe a B mencionando otro modelo.
    enterLane(HOME, 'agentB');
    appendFeed(HOME, { id: 'uB', createdAt: 2, workspace: 'chat', type: 'user', text: 'usa Kling 2.6 para el anuncio', mode: 'agent', attachments: [], meta: { agentNodeId: 'agentB', chatNodeId: 'chat2' } });

    const steps: Array<{ kind: string; model: string; user_requested?: boolean }> = [{ kind: 'video', model: 'kling 2.6' }];
    inferChoices(HOME, 'agentA', 'propose_plan', steps);
    expect(steps[0].user_requested).toBe(false);
  });

  // FALLO REAL: activityLog (activityLog.ts:10) crea ActivityFeedItem sin meta (ni agentNodeId ni chatNodeId), así que las actividades de B en chat2 caen en feedOfChat(chat) (el chat de A).
  it('el bloque de actividad de B en chat2 debe pertenecer a chat2 y no aparecer en el feed de chat (de A)', async () => {
    chat.mockResolvedValue(llmReply('B answer'));
    await sendAgentMessage('hello B', { agentNodeId: 'agentB', chatNodeId: 'chat2' });

    const activitiesInChat1 = feedOfChat(HOME, 'chat').filter((f) => f.type === 'activity');
    const activitiesInChat2 = feedOfChat(HOME, 'chat2').filter((f) => f.type === 'activity');
    expect(activitiesInChat1).toEqual([]);
    expect(activitiesInChat2.length).toBeGreaterThan(0);
  });

  // FALLO REAL: patchLane (lanes.ts:73) ignora nodeId cuando agentLane es undefined; vincular modelos a agentA y agentB antes del primer chat sobreescribe el modelo de A con el de B.
  it('conectar modelos distintos a agentA y agentB antes del primer turno debe conservar el modelo propio de cada agente', () => {
    patchSession(HOME, (s) => ({
      ...s,
      graph: {
        ...s.graph,
        nodes: [
          ...s.graph.nodes,
          ref('mA', 'model', { ref: 'local::img-a', mediaKind: 'image' }),
          ref('mB', 'model', { ref: 'local::img-b', mediaKind: 'image' }),
        ],
      },
    }));

    applyModelLinkToAgent(HOME, 'mA', 'agentA');
    applyModelLinkToAgent(HOME, 'mB', 'agentB');

    enterLane(HOME, 'agentA');
    expect(laneState(HOME, 'agentA')?.settings?.image?.modelRef).toBe('local::img-a');
    enterLane(HOME, 'agentB');
    expect(laneState(HOME, 'agentB')?.settings?.image?.modelRef).toBe('local::img-b');
  });

  // FALLO REAL: canvasCalls.ts:170 llama agentSeesImages() sin (sessionId, c.owner); si A no tiene visión pero B en pantalla sí, find_assets(view:true) intenta enviar imágenes al modelo ciego de A.
  it('find_assets(view:true) de A (sin visión) mientras B (con visión) está en pantalla debe rechazar mostrar imágenes', async () => {
    const st = useStore.getState();
    useStore.setState({
      assets: {
        ...st.assets,
        img1: { id: 'img1', sessionId: HOME, kind: 'image', mime: 'image/png', origin: 'upload', name: 'cat.png', width: 512, height: 512, createdAt: 1, thumbnailUrl: 'data:image/png;base64,AA==' } as never,
      },
    });
    let calls = 0;
    chat.mockImplementation(async (o) => {
      if (o.model === 'model/a') {
        calls++;
        if (calls === 1) {
          await new Promise<void>((res) => { releaseA = res; });
          return llmReply('', [{ id: 'fa1', name: 'find_assets', arguments: JSON.stringify({ view: true, canvas: 'all' }) }]);
        }
        return llmReply('A saw result');
      }
      return llmReply('B ok');
    });

    const aTurn = sendAgentMessage('show images', { agentNodeId: 'agentA', chatNodeId: 'chat', attachments: ['img1'] });
    await vi.waitFor(() => expect(chat).toHaveBeenCalledTimes(1));
    await sendAgentMessage('hi B', { agentNodeId: 'agentB', chatNodeId: 'chat2' });
    expect(S().agentLane).toBe('agentB');

    releaseA?.();
    await aTurn;

    const toolMsg = laneState(HOME, 'agentA')!.history.find((m) => m.role === 'tool' && m.tool_call_id === 'fa1');
    expect(asText(toolMsg?.content)).toContain('cannot see images');
  });

  // FALLO REAL: wrapUpPlan (planRun.ts:352) comprueba si hay cualquier mensaje user en s.feed tras el plan de A (sin filtrar por dueño); hablar con B silencia el cierre de A.
  it('un mensaje del usuario a B mientras corre el plan de A no debe cancelar el wrap-up de A', async () => {
    chat.mockResolvedValue(llmReply('wrap-up from A'));
    enterLane(HOME, 'agentA');
    const planA: PlanFeedItem = {
      id: 'fd_planA_wrap', createdAt: 1, workspace: 'chat', type: 'plan', style: 'auto', status: 'awaiting',
      plan: { id: 'plnW', title: 'Plan A', summary: 'A', workspace: 'chat', steps: [{ id: 's1', kind: 'text', title: 'T', text: 'hi' }], adjustments: [] },
      stepStates: { s1: 'pending' }, stepGenerations: {}, estimate: { usd: 0, approximate: false },
      meta: { agentNodeId: 'agentA', chatNodeId: 'chat' },
    };
    appendFeed(HOME, planA);
    executeSteps.mockImplementationOnce(async () => {
      // Mientras corre el plan de A, el usuario manda un mensaje a B.
      appendFeed(HOME, { id: 'uB_mid', createdAt: 2, workspace: 'chat', type: 'user', text: 'msg for B', mode: 'agent', attachments: [], meta: { agentNodeId: 'agentB', chatNodeId: 'chat2' } });
      return { outputs: new Map([['s1', { assetIds: [], text: 'ok' }]]), failed: [], skipped: [], waiting: [] };
    });

    await approvePlan(HOME, planA.id);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(asText(laneState(HOME, 'agentA')!.history)).toContain('wrap-up from A');
  });

  // FALLO REAL: turnChats (runtimeShared.ts:72) solo vive en RAM y submitAnswers/confirmSettings/retryAgentTurn no restauran setTurnChat desde item.meta.chatNodeId; tras recargar, responder una tarjeta de B en chat2 manda su respuesta a chat (chat 1 de A).
  it('tras recargar (turnChats vacío), responder una tarjeta de B en chat2 debe seguir respondiendo en chat2', async () => {
    const ask = { id: 'qB', name: 'ask_questions', arguments: JSON.stringify({ questions: [{ id: 'k', question: 'Q in chat2?', options: ['1', '2'] }] }) };
    chat.mockResolvedValueOnce(llmReply('B asks', [ask])).mockResolvedValueOnce(llmReply('B reply after reload'));

    await sendAgentMessage('ask B in chat2', { agentNodeId: 'agentB', chatNodeId: 'chat2' });
    const qCard = S().feed.find((f): f is QuestionsFeedItem => f.type === 'questions')!;
    expect(qCard.meta?.chatNodeId).toBe('chat2');

    // Simula recarga: el mapa en RAM turnChats arranca vacío mientras el feed persistido conserva meta.chatNodeId='chat2'.
    setTurnChat(HOME, undefined, 'agentB');

    await submitAnswers(HOME, qCard.id, { k: '1' });

    const reply = S().feed.find((f) => f.type === 'assistant' && f.text.includes('B reply after reload'));
    expect(reply?.meta?.chatNodeId).toBe('chat2');
  });
});

describe('ataques que pasan (verificación de correcciones existentes)', () => {
  it('reopenCard sobre una tarjeta de A no borra mensajes ni historial de B', async () => {
    const ask = { id: 'q1', name: 'ask_questions', arguments: JSON.stringify({ questions: [{ id: 'k', question: 'Pick?', options: ['1', '2'] }] }) };
    chat
      .mockResolvedValueOnce(llmReply('A asks', [ask]))
      .mockResolvedValueOnce(llmReply('A after answer'))
      .mockResolvedValueOnce(llmReply('B answer'));

    await sendAgentMessage('start A', { agentNodeId: 'agentA', chatNodeId: 'chat' });
    const qCard = S().feed.find((f): f is QuestionsFeedItem => f.type === 'questions')!;
    await submitAnswers(HOME, qCard.id, { k: '1' });
    await sendAgentMessage('start B', { agentNodeId: 'agentB', chatNodeId: 'chat2' });
    const bFeedBefore = S().feed.filter((f) => (f as { meta?: { agentNodeId?: string } }).meta?.agentNodeId === 'agentB').map((f) => f.id);
    const bHistBefore = laneState(HOME, 'agentB')!.history;

    reopenCard(HOME, qCard.id);

    expect((S().feed.find((f) => f.id === qCard.id) as QuestionsFeedItem).status).toBe('pending');
    expect(laneState(HOME, 'agentB')!.history).toEqual(bHistBefore);
    for (const id of bFeedBefore) expect(S().feed.some((f) => f.id === id)).toBe(true);
  });

  it('retryAgentTurn sobre una notice de A con B en pantalla reintenta en A y no toca B', async () => {
    chat
      .mockRejectedValueOnce(new NetworkError('connection reset'))
      .mockResolvedValueOnce(llmReply('B ok'))
      .mockResolvedValueOnce(llmReply('A recovered'));

    await sendAgentMessage('fragile A', { agentNodeId: 'agentA', chatNodeId: 'chat' });
    const errNotice = S().feed.find((f) => f.type === 'notice' && f.retry)!;
    await sendAgentMessage('hello B', { agentNodeId: 'agentB', chatNodeId: 'chat2' });

    await retryAgentTurn(HOME, errNotice.id);

    expect(asText(laneState(HOME, 'agentA')!.history)).toContain('A recovered');
    expect(asText(laneState(HOME, 'agentB')!.history)).not.toContain('A recovered');
  });

  it('recordPriceResults anota el coste en las notas de A aunque B esté en pantalla', () => {
    enterLane(HOME, 'agentA');
    const st = useStore.getState();
    useStore.setState({ generations: { ...st.generations, gA: { id: 'gA', sessionId: HOME, kind: 'image', status: 'done', providerReportedUsd: 0.42 } as never } });
    appendFeed(HOME, {
      id: 'pPrice', createdAt: 1, workspace: 'chat', type: 'plan', style: 'auto', status: 'done',
      plan: { id: 'plnP', title: 'P', summary: 'P', workspace: 'chat', steps: [], adjustments: [] },
      stepStates: {}, stepGenerations: { s1: 'gA' }, estimate: { usd: 0.1, approximate: false },
      stepCostReviews: { s1: { message: 'cost up', approved: { estimate: { usd: 0.1, approximate: false } }, proposed: { estimate: { usd: 0.4, approximate: false } }, decisions: [{ decision: 'continue', decidedAt: 1, generationId: 'gA', before: { estimate: { usd: 0.1, approximate: false } }, after: { estimate: { usd: 0.4, approximate: false } }, reason: 'up' }] } as never },
      meta: { agentNodeId: 'agentA', chatNodeId: 'chat' },
    } as FeedItem);
    enterLane(HOME, 'agentB');

    recordPriceResults(HOME, 'pPrice');

    expect(laneState(HOME, 'agentA')!.notes.some((n) => n.includes('0.42'))).toBe(true);
    expect(laneState(HOME, 'agentB')!.notes).toEqual([]);
  });

  it('enterLane a mitad de turno de A no sobrescribe los settings ni el historial de A', async () => {
    enterLane(HOME, 'agentA');
    patchLane(HOME, 'agentA', { settings: { image: { modelRef: 'local::img-a', needsImage: false } } });
    const { aTurn } = await startAInBackgroundAndBOnScreen();
    patchLane(HOME, 'agentB', { settings: { image: { modelRef: 'local::img-b', needsImage: false } } });

    enterLane(HOME, 'agentA');
    expect(laneState(HOME, 'agentA')?.settings?.image?.modelRef).toBe('local::img-a');
    releaseA?.();
    await aTurn;
    expect(laneState(HOME, 'agentA')?.settings?.image?.modelRef).toBe('local::img-a');
    expect(laneState(HOME, 'agentB')?.settings?.image?.modelRef).toBe('local::img-b');
  });
});
