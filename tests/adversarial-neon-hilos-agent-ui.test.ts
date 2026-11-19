// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
  deleteAssetBlobs: async () => undefined,
}));
const chat = vi.hoisted(() => vi.fn());
vi.mock('../src/engine/providers/llm', async (orig) => ({ ...(await orig<typeof import('../src/engine/providers/llm')>()), chat }));
vi.mock('../src/lib/writerLock', () => ({ holdsWriterLock: () => true, mayStartWork: () => true, getWriterState: () => ({ role: 'writer', requested: false }), onWriterLockGranted: () => () => undefined }));

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useStore } from '../src/store/store';
import { Composer } from '../src/components/composer/Composer';
import { HomeBar } from '../src/components/shell/HomeBar';
import { sendAgentMessage } from '../src/engine/agent/conversation';
import { stopAgent } from '../src/engine/agent/runtimeShared';
import { enterLane, patchLane } from '../src/engine/agent/lanes';
import { allThreads } from '../src/engine/agent/threads';
import { controllers, feedOfAgent } from '../src/engine/agent/runtimeShared';
import { applyEdit } from '../src/engine/nodecore/edit';
import { checkingPlan, watchModel } from '../src/engine/agent/turnStop';
import { changePlanChoice } from '../src/engine/agent/planSettings';
import { setSessionModelAsDefault } from '../src/engine/agent/sessionModel';
import { resolveSystemNodeLive } from '../src/engine/nodes/spec';
import { draftMode } from '../src/engine/agent/draftFirst';
import type { Graph, NoticeFeedItem, PlanFeedItem, SettingsFeedItem } from '../src/engine/types';
import { mainThread } from './helpers/threads';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}

const HOME = useStore.getState().activeSessionId;
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
const S = () => useStore.getState().sessions[HOME];
const llmReply = (text: string, toolCalls: Array<{ id: string; name: string; arguments: string }> = []) => ({
  text,
  toolCalls,
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
  controllers.clear();
  const st = useStore.getState();
  useStore.setState({
    activeSessionId: HOME,
    generations: {},
    assets: {},
    composer: { ...st.composer, mode: 'agent', text: 'hola', attachments: [], agentStyle: 'auto' },
    ui: { ...st.ui, workspace: 'chat', homeDrafts: { [HOME]: 'desde home' } },
    settings: {
      ...st.settings,
      keys: { ...st.settings.keys, openrouter: 'sk-test' },
      agent: { ...st.settings.agent, provider: 'openrouter', model: 'openai/gpt-4o-mini', showThinking: false },
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
  while (roots.length) {
    const r = roots.pop()!;
    await act(async () => { r.unmount(); });
  }
  document.body.innerHTML = '';
});

describe('adversarial: agente equivocado, Stop, borrado y regresiones de UI', () => {
  // FALLO REAL: Composer (src/components/composer/Composer.tsx:247) llama `useRecipientThread(sessionId, a => a.busy, false)` sin pasar `chatNodeId` (y `useRecipientThread` en src/engine/agent/useThread.ts:12 tampoco lo acepta); el Composer de chat2 lee el estado `busy` de agentA (destinatario de chat1) en vez de agentB.
  it('Composer con chatNodeId="chat2": si agentA (chat1) está busy y agentB (chat2) está libre, chat2 debe mostrar Send habilitado y NO Stop', async () => {
    patchLane(HOME, 'agentA', { busy: true, phase: 'working' });
    patchLane(HOME, 'agentB', { busy: false });

    const { host } = await mount(createElement(Composer as (p: { chatNodeId?: string }) => ReturnType<typeof Composer>, { chatNodeId: 'chat2' }));
    expect(host.querySelector('button[aria-label="Stop"]')).toBeNull();
    const sendBtn = host.querySelector<HTMLButtonElement>('button[aria-label="Send"]');
    expect(sendBtn).not.toBeNull();
    expect(sendBtn!.disabled).toBe(false);
  });

  // FALLO REAL: AgentSend (src/components/composer/AgentSend.tsx:6) llama `stopAgent()` sin id, y stopAgent (src/engine/agent/conversation.ts:318-324) aborta TODOS los agentes de la sesión; pulsar Stop en chat2 mata también el turno en paralelo de agentA.
  it('Stop en chat2 (agentB) con agentA y agentB corriendo en paralelo no debe abortar a agentA', async () => {
    let sigA!: AbortSignal;
    let sigB!: AbortSignal;
    let finishA!: () => void;
    let finishB!: () => void;
    chat
      .mockImplementationOnce((o: { signal: AbortSignal }) => new Promise((res, rej) => {
        sigA = o.signal;
        o.signal.addEventListener('abort', () => rej(new DOMException('Stopped', 'AbortError')));
        finishA = () => res(llmReply('respuesta A'));
      }))
      .mockImplementationOnce((o: { signal: AbortSignal }) => new Promise((res, rej) => {
        sigB = o.signal;
        o.signal.addEventListener('abort', () => rej(new DOMException('Stopped', 'AbortError')));
        finishB = () => res(llmReply('respuesta B'));
      }));

    const turnA = sendAgentMessage('turno A', { agentNodeId: 'agentA', chatNodeId: 'chat1' });
    const turnB = sendAgentMessage('turno B', { agentNodeId: 'agentB', chatNodeId: 'chat2' });
    await vi.waitFor(() => expect(sigA && sigB).toBeTruthy());

    // Montamos el Composer de chat2 y pulsamos Stop (asumiendo que muestra Stop porque agentA también está busy)
    const { host } = await mount(createElement(Composer as (p: { chatNodeId?: string }) => ReturnType<typeof Composer>, { chatNodeId: 'chat2' }));
    const stopBtn = host.querySelector<HTMLButtonElement>('button[aria-label="Stop"]');
    expect(stopBtn).not.toBeNull();
    await act(async () => { stopBtn!.click(); });

    const abortedA = sigA.aborted;
    const abortedB = sigB.aborted;
    if (!sigA.aborted) finishA();
    if (!sigB.aborted) finishB();
    await Promise.all([turnA, turnB]);

    expect(abortedB).toBe(true);
    expect(abortedA).toBe(false);
  });

  // FALLO REAL: al borrar `agentA` en vuelo (`applyEdit(delete)`), onNodesRemoved (src/engine/agent/runtimeShared.ts:37-44) ejecuta `ending` después de quitar `agentA` del grafo, así que `messageMeta` omite `agentNodeId` (runtimeShared.ts:104) y `feedOfAgent(HOME, 'agentB')` atribuye el aviso "Stopped." a agentB; además `session.agents.agentA` nunca se limpia y conserva `pending` para siempre en `allThreads`.
  it('borrar agentA en vuelo: su aviso "Stopped." no debe atribuirse a agentB ni su hilo fantasma dejar `pending` activo para siempre', async () => {
    let sigA!: AbortSignal;
    chat.mockImplementationOnce((o: { signal: AbortSignal }) => new Promise((_res, rej) => {
      sigA = o.signal;
      o.signal.addEventListener('abort', () => rej(new DOMException('Stopped', 'AbortError')));
    }));

    patchLane(HOME, 'agentA', { pending: { toolCallId: null, kind: 'plan', feedItemId: 'pA' } });
    const turnA = sendAgentMessage('trabaja A', { agentNodeId: 'agentA', chatNodeId: 'chat1' });
    await vi.waitFor(() => expect(sigA).toBeTruthy());
    // Simulamos también una tarjeta pending en agentA antes de borrar el nodo
    patchLane(HOME, 'agentA', { pending: { toolCallId: null, kind: 'plan', feedItemId: 'pA' } });

    applyEdit({ session: HOME, op: { op: 'delete', nodes: ['agentA'] } });
    await turnA;

    const bNotices = feedOfAgent(HOME, 'agentB').filter((f): f is NoticeFeedItem => f.type === 'notice' && f.text === 'Stopped.');
    expect(bNotices).toHaveLength(0);
    expect(allThreads(S()).some((a) => Boolean(a.pending))).toBe(false);
  });

  // FALLO REAL: llmTurn (src/engine/agent/llmTurn.ts:403-405 y 414) lee `session(sessionId).feed` sin filtrar por dueño; un mensaje a B borra `settingsParts` de A y en modo Guided `draftGate` de A acepta la tarjeta de vídeo de B saltándose la confirmación de A.
  it('llmTurn en modo Guided: que B haya confirmado vídeo no debe permitir a A saltarse `draftGate` sin tarjeta propia', async () => {
    useStore.setState((st) => ({ composer: { ...st.composer, agentStyle: 'guided' } }));
    const settingsB: SettingsFeedItem = {
      id: 'set_b_vid',
      createdAt: 1,
      workspace: 'chat',
      type: 'settings',
      status: 'confirmed',
      draft: draftMode('hq'),
      sections: [{ kind: 'video', count: 1, recommended: { modelRef: 'local::studio-video', needsImage: false, resolution: '1080p' }, chosen: { modelRef: 'local::studio-video', needsImage: false, resolution: '1080p' }, alternatives: [] }],
      meta: { agentNodeId: 'agentB', chatNodeId: 'chat2' },
    };
    useStore.setState((st) => ({
      sessions: {
        ...st.sessions,
        [HOME]: {
          ...st.sessions[HOME],
          feed: [settingsB],
          agents: {
            agentA: { history: [], questionRound: 1, notes: [], busy: false, settingsParts: [{ kind: 'video', modelRef: 'local::studio-video', needsImage: false }] },
            agentB: { history: [], questionRound: 1, notes: [], busy: false },
          },
          agentLane: 'agentA',
        },
      },
    }));

    // A intenta proponer un plan de vídeo sin haber tenido NINGUNA tarjeta de vídeo propia en Guided
    chat
      .mockResolvedValueOnce(llmReply('', [{
        id: 'tc_plan_A',
        name: 'propose_plan',
        arguments: JSON.stringify({ title: 'Clip A', steps: [{ id: 'v1', kind: 'video', title: 'Clip', prompt: 'ocean waves', model: 'local::studio-video' }] }),
      }]))
      .mockResolvedValueOnce(llmReply('Necesito confirmar primero'));

    // Forzamos que A ya tenga questionRound=1 tras sendAgentMessage (via reply a un turno o re-setting): usamos llmTurn directo
    const { llmTurn } = await import('../src/engine/agent/llmTurn');
    await llmTurn(HOME, 'chat', { route: 'new', agentNodeId: 'agentA' });

    // Si draftGate filtrara por agentA, la llamada habría sido rechazada pidiendo confirm_settings (y NO se habría mostrado el plan)
    const plansA = S().feed.filter((f) => f.type === 'plan');
    expect(plansA).toHaveLength(0);
  });

  // FALLO REAL: HomeBar (src/components/shell/HomeBar.tsx:16,25) calcula `canSend` con `useRecipientThread` (destinatario B libre), pero al enviar llama `agentAccepts()` sin `agentNodeId` (src/engine/agent/sendGate.ts:10), que comprueba `agentLane` (A ocupado) y descarta el envío.
  it('HomeBar: con chat1 apuntando a agentB libre y agentA busy en pantalla (`agentLane="agentA"`), enviar desde HomeBar debe aceptar el mensaje', async () => {
    useStore.setState((st) => ({
      sessions: {
        ...st.sessions,
        [HOME]: {
          ...st.sessions[HOME],
          graph: {
            nodes: [ref('chat1', 'chat', { recipient: 'agentB' }), ref('agentA', 'agent'), ref('agentB', 'agent')],
            edges: [control('c1', 'chat1', 'agentA'), control('c2', 'chat1', 'agentB')],
          },
          agents: {
            agentA: { history: [], questionRound: 0, notes: [], busy: true, phase: 'working' },
            agentB: { history: [], questionRound: 0, notes: [], busy: false },
          },
          agentLane: 'agentA',
        },
      },
    }));
    chat.mockImplementationOnce(async (o) => {
      o.onText?.('Recibido en B', 'Recibido en B');
      return llmReply('Recibido en B');
    });

    const { host } = await mount(createElement(HomeBar));
    const submitBtn = host.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(submitBtn.disabled).toBe(false);
    await act(async () => {
      host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await vi.waitFor(() => expect(chat).toHaveBeenCalledTimes(1), { timeout: 200 });
  });

  // FALLO REAL: AgentModelControls (src/components/composer/AgentModelControls.tsx:111,175) muestra el modelo de `recipient` pero llama `setSessionModelAsDefault(sessionId, kind)` sin `owner`, que lee `agentLane` (src/engine/agent/sessionModel.ts:19) aplicando el modelo de A en vez del de B.
  it('setSessionModelAsDefault desde AgentModelControls: con agentA en pantalla y chat apuntando a agentB, debe usar el modelo de agentB', async () => {
    useStore.setState((st) => ({
      catalog: {
        ...st.catalog,
        models: {
          ...st.catalog.models,
          'openrouter::model-A': { ref: 'openrouter::model-A', provider: 'openrouter', id: 'model-A', name: 'Model A', kind: 'image', tags: [], acceptsText: true, acceptsImage: false },
          'openrouter::model-B': { ref: 'openrouter::model-B', provider: 'openrouter', id: 'model-B', name: 'Model B', kind: 'image', tags: [], acceptsText: true, acceptsImage: false },
        },
        schemas: {
          ...st.catalog.schemas,
          'openrouter::model-A': { ref: 'openrouter::model-A', source: 'catalog', params: [], slots: {} },
          'openrouter::model-B': { ref: 'openrouter::model-B', source: 'catalog', params: [], slots: {} },
        },
      },
      sessions: {
        ...st.sessions,
        [HOME]: {
          ...st.sessions[HOME],
          graph: {
            nodes: [ref('chat1', 'chat', { recipient: 'agentB' }), ref('agentA', 'agent'), ref('agentB', 'agent')],
            edges: [control('c1', 'chat1', 'agentA'), control('c2', 'chat1', 'agentB')],
          },
          agents: {
            agentA: { history: [], questionRound: 0, notes: [], busy: false, settings: { image: { modelRef: 'openrouter::model-A', needsImage: false } } },
            agentB: { history: [], questionRound: 0, notes: [], busy: false, settings: { image: { modelRef: 'openrouter::model-B', needsImage: false } } },
          },
          agentLane: 'agentA',
        },
      },
    }));

    // Tal como lo llama AgentModelControls.tsx: con el destinatario del chat (owner obligatorio)
    await setSessionModelAsDefault(HOME, 'image', 'agentB');
    expect(useStore.getState().composer.image.modelRef).toBe('openrouter::model-B');
  });

  // FALLO REAL: planSettings.remember (src/engine/agent/planSettings.ts:85) busca la última tarjeta inline en `session.feed` sin filtrar por agente; cambiar ajustes en el plan de A sobrescribe la tarjeta inline de B.
  it('changePlanChoice en el plan de A no debe sobrescribir la tarjeta inline de ajustes de B', async () => {
    const inlineA: SettingsFeedItem = {
      id: 'in_A', createdAt: 1, workspace: 'chat', type: 'settings', status: 'confirmed', inline: true,
      sections: [{ kind: 'image', count: 1, recommended: { modelRef: 'local::studio-image', needsImage: false, aspect: '1:1' }, chosen: { modelRef: 'local::studio-image', needsImage: false, aspect: '1:1' }, alternatives: [] }],
      meta: { agentNodeId: 'agentA', chatNodeId: 'chat1' },
    };
    const planA: PlanFeedItem = {
      id: 'pl_A', createdAt: 2, workspace: 'chat', type: 'plan', style: 'auto', status: 'awaiting',
      plan: { id: 'pA', title: 'Plan A', summary: '', workspace: 'chat', steps: [{ id: 's1', kind: 'image', title: 'Img', prompt: 'cat', modelRef: 'local::studio-image', settings: { count: 1, aspect: '1:1', advanced: {} }, refs: [] }], adjustments: [] },
      estimate: { usd: 0, approximate: false }, stepStates: { s1: 'pending' }, stepGenerations: {},
      meta: { agentNodeId: 'agentA', chatNodeId: 'chat1' },
    };
    const inlineB: SettingsFeedItem = {
      id: 'in_B', createdAt: 3, workspace: 'chat', type: 'settings', status: 'confirmed', inline: true,
      sections: [{ kind: 'image', count: 1, recommended: { modelRef: 'local::studio-image', needsImage: false, aspect: '9:16' }, chosen: { modelRef: 'local::studio-image', needsImage: false, aspect: '9:16' }, alternatives: [] }],
      meta: { agentNodeId: 'agentB', chatNodeId: 'chat2' },
    };
    useStore.setState((st) => ({
      sessions: {
        ...st.sessions,
        [HOME]: {
          ...st.sessions[HOME],
          feed: [inlineA, planA, inlineB],
          agents: {
            agentA: { history: [], questionRound: 0, notes: [], busy: false, enhance: false },
            agentB: { history: [], questionRound: 0, notes: [], busy: false, enhance: false },
          },
          agentLane: 'agentB',
        },
      },
    }));

    await changePlanChoice(HOME, 'pl_A', 'image', { modelRef: 'local::studio-image', needsImage: false, aspect: '16:9', count: 1 });
    const afterB = S().feed.find((f) => f.id === 'in_B') as SettingsFeedItem;
    const afterA = S().feed.find((f) => f.id === 'in_A') as SettingsFeedItem;
    expect(afterB.sections[0].chosen?.aspect).toBe('9:16');
    expect(afterA.sections[0].chosen?.aspect).toBe('16:9');
  });

  // FALLO REAL: watchers en src/engine/agent/turnStop.ts:25,57-63 se indexa solo por `sessionId` (sin agente); en paralelo, `runB` sobrescribe el watcher de A (las esperas de A caen en B y A no recibe nada) y al terminar A borra el watcher de B.
  it('checkingPlan en paralelo para agentA y agentB no debe enviar las esperas de esquema de A al watcher de B', async () => {
    const eventsA: string[] = [];
    const eventsB: string[] = [];
    const acA = new AbortController();
    const acB = new AbortController();
    let releaseA!: () => void;
    let releaseB!: () => void;

    const runA = checkingPlan(HOME, 'agentA', acA.signal, async () => {
      await new Promise<void>((r) => { releaseA = r; });
      const lookup = watchModel(HOME, 'agentA', async () => null);
      await lookup('openrouter::slow-model-A');
    }, { begin: (k) => eventsA.push(`begin:${k}`), end: (k) => eventsA.push(`end:${k}`) });

    const runB = checkingPlan(HOME, 'agentB', acB.signal, async () => {
      await new Promise<void>((r) => { releaseB = r; });
    }, { begin: (k) => eventsB.push(`begin:${k}`), end: (k) => eventsB.push(`end:${k}`) });

    releaseA();
    await runA;
    releaseB();
    await runB;

    expect(eventsA).toContain('begin:openrouter::slow-model-A');
    expect(eventsB).toEqual([]);
  });

  // FALLO REAL: resolveSystemNodeLive (src/engine/nodes/spec.ts:303-307) lee `targetSession.feed` completo en vez de `feedOfChat(d.ref, node.id)`, mezclando mensajes de chat1 dentro de la tarjeta de chat2; además, con `onlyMain`, `threadOf` (threads.ts:23) devuelve el mismo hilo `main` para las tarjetas de agentA y agentB.
  it('tarjetas de sistema: chat2 no debe mostrar mensajes de chat1 y agentB no debe mostrar el historial de main como propio', () => {
    useStore.setState((st) => ({
      sessions: {
        ...st.sessions,
        [HOME]: {
          ...st.sessions[HOME],
          feed: [{ id: 'u1', createdAt: 1, workspace: 'chat', type: 'user', text: 'mensaje solo en chat1', mode: 'agent', attachments: [], meta: { chatNodeId: 'chat1', agentNodeId: 'agentA' } }],
          agents: mainThread({ history: [{ role: 'user', content: 'solo de A' }], questionRound: 0, notes: [], busy: true }),
          agentLane: undefined,
        },
      },
    }));
    const chat2Node = S().graph.nodes.find((n) => n.id === 'chat2')!;
    const liveChat2 = resolveSystemNodeLive(HOME, chat2Node)!;
    expect(liveChat2.details[0]).not.toContain('mensaje solo en chat1');

    const agentBNode = S().graph.nodes.find((n) => n.id === 'agentB')!;
    const liveAgentB = resolveSystemNodeLive(HOME, agentBNode)!;
    expect(liveAgentB.badge).not.toBe('Busy');
  });

  // Ataque que pasa: cambiar el agente visible (`enterLane`) a mitad de turno de A no contamina el historial ni la respuesta de A.
  it('cambiar el agente visible (`enterLane`) a mitad de turno de A mantiene el turno y la respuesta dentro del hilo de A', async () => {
    let finishA!: () => void;
    chat.mockImplementationOnce((o: { onText?: (d: string, f: string) => void }) => new Promise((res) => {
      finishA = () => {
        o.onText?.('Respuesta A intacta', 'Respuesta A intacta');
        res(llmReply('Respuesta A intacta'));
      };
    }));
    const turnA = sendAgentMessage('pregunta a A', { agentNodeId: 'agentA', chatNodeId: 'chat1' });
    await vi.waitFor(() => expect(typeof finishA).toBe('function'));
    enterLane(HOME, 'agentB');
    expect(S().agentLane).toBe('agentB');
    finishA();
    await turnA;
    expect(S().agents.agentA.history.some((m) => m.role === 'assistant' && m.content === 'Respuesta A intacta')).toBe(true);
    expect(S().agents.agentB.history).toHaveLength(0);
    expect(S().agents.agentA.busy).toBe(false);
    stopAgent(HOME, 'agentA');
  });
});
