// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedItem, Graph, NoticeFeedItem, PlanFeedItem, QuestionsFeedItem, SettingsFeedItem } from '../src/engine/types';

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
  deleteAssetBlobs: async () => undefined,
}));
const chat = vi.hoisted(() => vi.fn());
vi.mock('../src/engine/providers/llm', async (orig) => ({ ...(await orig<typeof import('../src/engine/providers/llm')>()), chat }));
const executeSteps = vi.hoisted(() => vi.fn());
vi.mock('../src/engine/executor', async (orig) => {
  const real = await orig<typeof import('../src/engine/executor')>();
  return { ...real, executeSteps: (...args: unknown[]) => executeSteps(...args) };
});
const writerState = vi.hoisted(() => ({ requested: false }));
vi.mock('../src/lib/writerLock', () => ({
  holdsWriterLock: () => true,
  mayStartWork: () => true,
  getWriterState: () => ({ role: 'writer', requested: writerState.requested }),
  onWriterLockGranted: () => () => undefined,
}));

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useStore } from '../src/store/store';
import { Composer } from '../src/components/composer/Composer';
import { NoticeView } from '../src/components/chat/FeedList';
import { sendAgentMessage } from '../src/engine/agent/conversation';
import { editUserMessage, reopenCard } from '../src/engine/agent/messageEdit';
import { approvePlan } from '../src/engine/agent/planRun';
import { controllers, feedOfChat } from '../src/engine/agent/runtimeShared';
import { laneState, patchLane } from '../src/engine/agent/lanes';
import { mainThread } from './helpers/threads';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}

const HOME = useStore.getState().activeSessionId;
const S = () => useStore.getState().sessions[HOME];
const ref = (id: string, type: 'chat' | 'agent', extra: Record<string, unknown> = {}) => ({
  id,
  position: { x: 0, y: 0 },
  data: { kind: 'ref' as const, type, ref: HOME, title: id, ...extra },
});
const control = (id: string, source: string, target: string) => ({
  id,
  source,
  target,
  sourceHandle: 'out_control',
  targetHandle: 'control',
  kind: 'control' as const,
});
const twoChatGraph = (): Graph => ({
  nodes: [ref('chat1', 'chat'), ref('agentA', 'agent'), ref('chat2', 'chat'), ref('agentB', 'agent')],
  edges: [control('c1', 'chat1', 'agentA'), control('c2', 'chat2', 'agentB')],
});
const llmReply = (text: string) => ({
  text,
  toolCalls: [],
  usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 },
  timing: { totalMs: 5, outputMs: 5 },
  finishReason: 'stop' as const,
});

const roots: Root[] = [];
async function mount(el: ReturnType<typeof createElement>) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => { root.render(el); });
  return { host, root };
}

beforeEach(() => {
  chat.mockReset();
  executeSteps.mockReset();
  writerState.requested = false;
  controllers.clear();
  const st = useStore.getState();
  useStore.setState({
    activeSessionId: HOME,
    generations: {},
    assets: {},
    composer: {
      ...st.composer,
      mode: 'agent',
      text: 'hola',
      attachments: [],
      agentStyle: 'auto',
      image: { ...st.composer.image, modelRef: 'local::studio-image' },
    },
    ui: { ...st.ui, workspace: 'chat' },
    catalog: {
      ...st.catalog,
      models: {
        ...st.catalog.models,
        'openrouter::model-A': { ref: 'openrouter::model-A', provider: 'openrouter', id: 'model-A', name: 'Model A', kind: 'image', tags: [], acceptsImage: false, pricing: {} } as never,
        'openrouter::model-B': { ref: 'openrouter::model-B', provider: 'openrouter', id: 'model-B', name: 'Model B', kind: 'image', tags: [], acceptsImage: false, pricing: {} } as never,
      },
      schemas: {
        ...st.catalog.schemas,
        'openrouter::model-A': { modelRef: 'openrouter::model-A', source: 'fetched', params: [], slots: { prompt: 'prompt' } } as never,
        'openrouter::model-B': { modelRef: 'openrouter::model-B', source: 'fetched', params: [], slots: { prompt: 'prompt' } } as never,
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
        graph: twoChatGraph(),
        feed: [],
        agents: mainThread({ history: [], questionRound: 0, notes: [], busy: false }),
        agentLane: undefined,
      },
    },
  });
});

afterEach(async () => {
  for (const c of controllers.values()) c.abort();
  controllers.clear();
  while (roots.length) {
    const r = roots.pop()!;
    await act(async () => { r.unmount(); });
  }
  document.body.innerHTML = '';
});

describe('adversarial cierre: agentes equivocados, Stop cruzado, edición y multi-chat', () => {
  // FALLO REAL: messageEdit.ts:60-77 borra el mensaje y trunca el historial/filas antes de comprobar agentAccepts: si otra pestaña pidió el writer lock (requested:true), sendAgentMessage retorna en silencio y el usuario pierde su mensaje y la conversación posterior.
  it('editUserMessage con traspaso de writerLock pedido (agentAccepts=false) no debe borrar el mensaje ni truncar el historial', async () => {
    const u1: FeedItem = { id: 'u-1', createdAt: 1, workspace: 'chat', type: 'user', text: 'primer mensaje', mode: 'agent', attachments: [], meta: { agentNodeId: 'agentA', chatNodeId: 'chat1' } };
    const a1: FeedItem = { id: 'a-1', createdAt: 2, workspace: 'chat', type: 'assistant', text: 'respuesta importante', engine: 'test', meta: { agentNodeId: 'agentA', chatNodeId: 'chat1' } };
    useStore.setState((st) => ({
      sessions: { ...st.sessions, [HOME]: { ...st.sessions[HOME], feed: [u1, a1] } },
    }));
    patchLane(HOME, 'agentA', {
      history: [
        { role: 'user', content: '<user_message canvas="chat">\nprimer mensaje\n</user_message>' },
        { role: 'assistant', content: 'respuesta importante' },
      ],
    });

    writerState.requested = true;
    await editUserMessage(HOME, 'u-1', 'mensaje editado');

    expect(chat).not.toHaveBeenCalled();
    expect(S().feed.map((f) => f.id)).toEqual(['u-1', 'a-1']);
    expect(laneState(HOME, 'agentA')?.history).toHaveLength(2);
  });

  // FALLO REAL: messageEdit.ts:77 omite agentNodeId cuando el mensaje editado no tenía meta.agentNodeId (mensaje previo a ids, dueño=agentA): borra la conversación de agentA pero sendAgentMessage lo entrega a agentB si chat1.recipient cambió a agentB.
  it('editUserMessage en un mensaje sin meta.agentNodeId (de agentA) tras cambiar chat1.recipient a agentB debe reenviar a agentA, no a agentB', async () => {
    useStore.setState((st) => ({
      sessions: {
        ...st.sessions,
        [HOME]: {
          ...st.sessions[HOME],
          graph: {
            nodes: [ref('chat1', 'chat', { recipient: 'agentB' }), ref('agentA', 'agent'), ref('agentB', 'agent')],
            edges: [control('c1', 'chat1', 'agentA'), control('c2', 'chat1', 'agentB')],
          },
          feed: [
            { id: 'u-old', createdAt: 1, workspace: 'chat', type: 'user', text: 'hola A', mode: 'agent', attachments: [], meta: { chatNodeId: 'chat1' } },
            { id: 'a-old', createdAt: 2, workspace: 'chat', type: 'assistant', text: 'respuesta A', engine: 'test', meta: { chatNodeId: 'chat1' } },
          ],
        },
      },
    }));
    patchLane(HOME, 'agentA', {
      history: [
        { role: 'user', content: '<user_message canvas="chat">\nhola A\n</user_message>' },
        { role: 'assistant', content: 'respuesta A' },
      ],
    });
    chat.mockResolvedValueOnce(llmReply('nueva respuesta'));

    await editUserMessage(HOME, 'u-old', 'hola A editado');

    expect(laneState(HOME, 'agentB')?.history ?? []).toHaveLength(0);
    expect(laneState(HOME, 'agentA')?.history.some((m) => typeof m.content === 'string' && m.content.includes('hola A editado'))).toBe(true);
  });

  // FALLO REAL: recipient.ts:23 devuelve { id: resolveOwner(sessionId), error } (id='agentA') para un chat sin agente; useThread.ts:13 y Composer.tsx:536 ignoran .error, así que chat2 sin agente muestra Stop cuando agentA corre y pulsar Stop en chat2 aborta a agentA en chat1.
  it('un chat sin agente conectado (chat2) no debe mostrar Stop ni abortar a agentA en chat1 al pulsar Stop', async () => {
    useStore.setState((st) => ({
      sessions: {
        ...st.sessions,
        [HOME]: {
          ...st.sessions[HOME],
          graph: {
            nodes: [ref('chat1', 'chat'), ref('agentA', 'agent'), ref('chat2', 'chat')],
            edges: [control('c1', 'chat1', 'agentA')], // chat2 sin agente conectado
          },
        },
      },
    }));

    let abortA = false;
    let releaseA!: () => void;
    chat.mockImplementationOnce(({ signal }: { signal?: AbortSignal }) => new Promise((resolve, reject) => {
      signal?.addEventListener('abort', () => { abortA = true; reject(new DOMException('Stopped', 'AbortError')); });
      releaseA = () => resolve(llmReply('A terminó bien'));
    }));

    const turnA = sendAgentMessage('trabaja A', { agentNodeId: 'agentA', chatNodeId: 'chat1' });
    await vi.waitFor(() => expect(laneState(HOME, 'agentA')?.busy).toBe(true));

    const { host } = await mount(createElement(Composer as (p: { chatNodeId?: string }) => ReturnType<typeof Composer>, { chatNodeId: 'chat2' }));
    const stopBtn = host.querySelector<HTMLButtonElement>('button[aria-label="Stop"]');
    if (stopBtn) await act(async () => { stopBtn.click(); });
    releaseA();
    await turnA;

    // Un chat sin agente conectado no debe mostrar Stop ni abortar a agentA en chat1.
    expect({ showedStop: Boolean(stopBtn), abortedA: abortA }).toEqual({ showedStop: false, abortedA: false });
  });

  // FALLO REAL: AgentModelControls.tsx:112,176 y Composer.tsx:463 no pasan chatNodeId: en chat2 (conectado a agentB), el popover Models lee agentA y «Set as default» aplica el modelo de agentA en lugar del de agentB.
  it('AgentModelControls dentro de Composer(chatNodeId="chat2") debe leer y aplicar el modelo de agentB, no el de agentA', async () => {
    patchLane(HOME, 'agentA', { settings: { image: { modelRef: 'openrouter::model-A', needsImage: false } } });
    patchLane(HOME, 'agentB', { settings: { image: { modelRef: 'openrouter::model-B', needsImage: false } } });

    const { host } = await mount(createElement(Composer as (p: { chatNodeId?: string }) => ReturnType<typeof Composer>, { chatNodeId: 'chat2' }));
    const modelsChip = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Models'));
    expect(modelsChip).toBeTruthy();
    await act(async () => { modelsChip!.click(); });

    const setDefaultBtn = [...document.body.querySelectorAll('button')].find((b) => b.textContent?.includes('Set as default'));
    expect(setDefaultBtn).toBeTruthy();
    await act(async () => { setDefaultBtn!.click(); });

    expect(useStore.getState().composer.image.modelRef).toBe('openrouter::model-B');
  });

  // FALLO REAL: planRun.ts:199 crea filas feed type:'generation' sin meta (agentNodeId/chatNodeId): los resultados del plan aprobado de agentB en chat2 desaparecen de feedOfChat(chat2) y caen en chat1.
  it('las generaciones producidas por un plan de agentB en chat2 deben pertenecer a feedOfChat(chat2) y no caer en chat1', async () => {
    const planB: PlanFeedItem = {
      id: 'plan-b',
      createdAt: 1,
      workspace: 'chat',
      type: 'plan',
      style: 'auto',
      status: 'awaiting',
      plan: {
        id: 'pln_b',
        title: 'Plan de B',
        summary: 'Imagen en chat2',
        workspace: 'chat',
        steps: [{
          id: 's1',
          kind: 'image',
          title: 'Img B',
          prompt: 'paisaje B',
          modelRef: 'openrouter::model-B',
          refs: [],
          settings: { count: 1, aspect: '1:1', advanced: {} },
        }],
        adjustments: [],
      },
      estimate: { usd: 0.01, approximate: false },
      stepStates: { s1: 'pending' },
      stepGenerations: {},
      meta: { agentNodeId: 'agentB', chatNodeId: 'chat2' },
    };
    useStore.setState((st) => ({
      sessions: { ...st.sessions, [HOME]: { ...st.sessions[HOME], feed: [planB] } },
    }));
    executeSteps.mockImplementationOnce(async (_steps: unknown, opts: { onState?: (id: string, state: string, info?: { generationId?: string }) => void }) => {
      opts.onState?.('s1', 'done', { generationId: 'gen-b-1' });
      return { outputs: new Map([['s1', { assetIds: [] }]]), failed: [], skipped: [], waiting: [] };
    });
    chat.mockResolvedValueOnce(llmReply('Listo B'));

    await approvePlan(HOME, planB.id);

    const genRow = S().feed.find((f) => f.type === 'generation' && f.generationId === 'gen-b-1');
    expect(genRow).toBeTruthy();
    expect(feedOfChat(HOME, 'chat2').some((f) => f.id === genRow!.id)).toBe(true);
    expect(feedOfChat(HOME, 'chat1').some((f) => f.id === genRow!.id)).toBe(false);
  });

  // FALLO REAL: FeedList.tsx:142 calcula isLast sobre todo session.feed.at(-1): cuando agentB escribe en chat2, desaparece el botón Retry del aviso de error de agentA en chat1.
  it('NoticeView: un mensaje nuevo de agentB en chat2 no debe ocultar el botón Retry del aviso de error de agentA en chat1', async () => {
    const errA: NoticeFeedItem = {
      id: 'notice-err-a',
      createdAt: 1,
      workspace: 'chat',
      type: 'notice',
      level: 'error',
      text: 'OpenRouter: timeout',
      retry: {},
      meta: { agentNodeId: 'agentA', chatNodeId: 'chat1' },
    };
    const msgB: FeedItem = {
      id: 'msg-b-later',
      createdAt: 2,
      workspace: 'chat',
      type: 'user',
      text: 'hola B',
      mode: 'agent',
      attachments: [],
      meta: { agentNodeId: 'agentB', chatNodeId: 'chat2' },
    };
    useStore.setState((st) => ({
      sessions: { ...st.sessions, [HOME]: { ...st.sessions[HOME], feed: [errA, msgB] } },
    }));

    const { host } = await mount(createElement(NoticeView, { item: errA, sessionId: HOME }));
    const retryBtn = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Retry'));
    expect(retryBtn).toBeTruthy();
  });

  // Ataque que pasa: reopenCard (con el helper compartido removeOwnedFrom) reabre la tarjeta de A sin tocar filas ni historial de B.
  it('reopenCard en una tarjeta de A elimina solo filas posteriores de A y deja intacto a B', () => {
    const qA: QuestionsFeedItem = {
      id: 'q-a',
      createdAt: 1,
      workspace: 'chat',
      type: 'questions',
      questions: [{ id: 'q1', question: 'Estilo?', options: ['A', 'B'], allowCustom: false, multi: false }],
      round: 1,
      maxRounds: 2,
      status: 'answered',
      answers: { q1: 'A' },
      toolCallId: 'tc-q-a',
      meta: { agentNodeId: 'agentA', chatNodeId: 'chat1' },
    };
    const rowB: SettingsFeedItem = {
      id: 's-b',
      createdAt: 2,
      workspace: 'chat',
      type: 'settings',
      status: 'confirmed',
      sections: [],
      meta: { agentNodeId: 'agentB', chatNodeId: 'chat2' },
    };
    const afterA: FeedItem = { id: 'a-after', createdAt: 3, workspace: 'chat', type: 'assistant', text: 'después A', engine: 'test', meta: { agentNodeId: 'agentA', chatNodeId: 'chat1' } };
    useStore.setState((st) => ({
      sessions: { ...st.sessions, [HOME]: { ...st.sessions[HOME], feed: [qA, rowB, afterA] } },
    }));
    patchLane(HOME, 'agentA', {
      history: [
        { role: 'assistant', content: null, tool_calls: [{ id: 'tc-q-a', type: 'function', function: { name: 'ask_questions', arguments: '{}' } }] },
        { role: 'tool', tool_call_id: 'tc-q-a', content: 'A' },
        { role: 'assistant', content: 'después A' },
      ],
    });
    patchLane(HOME, 'agentB', { history: [{ role: 'user', content: 'de B' }] });

    reopenCard(HOME, 'q-a');

    expect(S().feed.map((f) => f.id)).toEqual(['q-a', 's-b']);
    expect((S().feed[0] as QuestionsFeedItem).status).toBe('pending');
    expect(laneState(HOME, 'agentB')?.history).toEqual([{ role: 'user', content: 'de B' }]);
  });
});
