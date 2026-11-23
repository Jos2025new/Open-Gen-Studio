import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, {
  window: { setTimeout, clearTimeout, addEventListener() {} },
  document: { addEventListener() {}, visibilityState: 'visible' },
}));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
  deleteAssetBlobs: async () => undefined,
}));
const chat = vi.hoisted(() => vi.fn());
vi.mock('../src/engine/providers/llm', async (orig) => ({ ...(await orig<typeof import('../src/engine/providers/llm')>()), chat }));
vi.mock('../src/lib/writerLock', () => ({ holdsWriterLock: () => true, mayStartWork: () => true, getWriterState: () => ({ role: 'writer', requested: false }), onWriterLockGranted: () => () => undefined }));

import '../src/engine/nodecore/migrate';
import { migrateAgents } from '../src/engine/nodecore/migrate';
import { MAIN_THREAD, threadOf } from '../src/engine/agent/threads';
import { createSession, useStore } from '../src/store/store';
import { sendAgentMessage } from '../src/engine/agent/conversation';
import type { AgentState, Graph, PlanFeedItem, Session } from '../src/engine/types';

const ref = (sid: string, id: string, type: 'chat' | 'agent') => ({
  id,
  position: { x: 0, y: 0 },
  data: { kind: 'ref' as const, type, ref: sid, title: id },
});
const control = (id: string, source: string, target: string) => ({
  id,
  source,
  target,
  sourceHandle: 'out_control',
  targetHandle: 'control',
  kind: 'control' as const,
});
const twoAgentGraph = (sid: string): Graph => ({
  nodes: [ref(sid, 'chat1', 'chat'), ref(sid, 'agentA', 'agent'), ref(sid, 'chat2', 'chat'), ref(sid, 'agentB', 'agent')],
  edges: [control('c1', 'chat1', 'agentA'), control('c2', 'chat2', 'agentB')],
});
const llmReply = (text: string) => ({
  text,
  toolCalls: [],
  usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 },
  timing: { totalMs: 5, outputMs: 5 },
  finishReason: 'stop' as const,
});
const legacy = (extra: Record<string, unknown>): Session => ({ ...createSession('legacy'), agents: undefined, ...extra } as unknown as Session);
const makePlan = (id: string, meta?: { agentNodeId?: string; chatNodeId?: string }): PlanFeedItem => ({
  id,
  createdAt: 1,
  workspace: 'chat',
  type: 'plan',
  style: 'auto',
  status: 'awaiting',
  plan: {
    id: `pln_${id}`,
    title: 'Plan viejo',
    summary: 'Resumen',
    workspace: 'chat',
    steps: [{ id: 's1', kind: 'text', title: 'Nota', text: 'hola' }],
    adjustments: [],
  },
  estimate: { usd: 0, approximate: false },
  stepStates: { s1: 'pending' },
  stepGenerations: {},
  ...(meta ? { meta } : {}),
});

beforeEach(() => {
  chat.mockReset();
  const st = useStore.getState();
  useStore.setState({
    settings: {
      ...st.settings,
      budgetOn: false,
      keys: { ...st.settings.keys, openrouter: 'sk-test' },
      agent: { ...st.settings.agent, provider: 'openrouter', model: 'openai/gpt-4o-mini', showThinking: false },
    },
  });
});

describe('adversarial: migración de hilos por agente', () => {
  // FALLO REAL: interrupted() en src/engine/agent/threads.ts:39 borra `revising` sin restaurar `pending` al plan en espera (como hace keepCommentedPlan); tras recargar, comentar el plan en revisión crea una petición nueva y deja el plan huérfano en `awaiting`.
  it('sesión vieja con plan en revisión (`revising` sin `pending`): tras recargar y comentar, debe seguir revisando ese plan y no dejarlo huérfano', async () => {
    const sid = 's_rev';
    const planItem = makePlan('plan_rev_1');
    const oldAgent: AgentState = {
      history: [{ role: 'user', content: 'haz un póster' }],
      questionRound: 0,
      notes: ['nota previa'],
      busy: true,
      phase: 'working',
      revising: planItem.id,
      pending: undefined,
      draft: { request: 'haz un póster', answers: {}, attachments: [] },
    };
    const saved = legacy({ id: sid, graph: twoAgentGraph(sid), feed: [planItem], agent: oldAgent });
    const merged = useStore.persist.getOptions().merge!({ sessions: { [sid]: saved }, activeSessionId: sid }, useStore.getState()) as ReturnType<typeof useStore.getState>;
    useStore.setState({ sessions: merged.sessions, activeSessionId: sid });

    chat.mockImplementationOnce(async (o) => {
      o.onText?.('Ajustado', 'Ajustado');
      return llmReply('Ajustado');
    });

    await sendAgentMessage('cámbiale el fondo a rojo', { agentNodeId: 'agentA', chatNodeId: 'chat1' });

    const sentMessages = chat.mock.calls[0]?.[0]?.messages as Array<{ role: string; content: string }>;
    expect(sentMessages.some((m) => String(m.content).includes('The user replied instead of approving'))).toBe(true);
    expect(useStore.getState().sessions[sid].agents.agentA?.pending?.feedItemId).toBe(planItem.id);
  });

  // FALLO REAL: migrateAgents (src/engine/agent/threads.ts:49) guarda el `agent` único bajo `MAIN_THREAD` y `withThread` (threads.ts:34) entrega `main` al PRIMER agente que reciba un mensaje; si el usuario habla primero a `agentB`, B roba el historial, ajustes, notas y secuestra el plan pendiente de A.
  it('sesión vieja (`agent` único, `agentLane: undefined`) con dos agentes en el grafo: hablar primero a agentB no debe robar el historial ni el plan pendiente de agentA', async () => {
    const sid = 's_two_legacy';
    const planA = makePlan('plan_legacy_A');
    const oldAgent: AgentState = {
      history: [{ role: 'user', content: 'historia secreta de A' }],
      questionRound: 1,
      notes: ['nota exclusiva de A'],
      busy: false,
      pending: { toolCallId: 'tc_a', kind: 'plan', feedItemId: planA.id },
      draft: { request: 'borrador de A', answers: { q1: 'op1' }, attachments: [] },
      settings: { image: { modelRef: 'local::studio-image', needsImage: false, aspect: '16:9' } },
    };
    const saved = legacy({ id: sid, graph: twoAgentGraph(sid), feed: [planA], agent: oldAgent, agentLane: undefined });
    const merged = useStore.persist.getOptions().merge!({ sessions: { [sid]: saved }, activeSessionId: sid }, useStore.getState()) as ReturnType<typeof useStore.getState>;
    useStore.setState({ sessions: merged.sessions, activeSessionId: sid });

    chat.mockImplementationOnce(async (o) => {
      o.onText?.('Hola soy B', 'Hola soy B');
      return llmReply('Hola soy B');
    });

    await sendAgentMessage('hola B', { agentNodeId: 'agentB', chatNodeId: 'chat2' });

    const s = useStore.getState().sessions[sid];
    // El plan pendiente de A NO debe haberse cancelado porque el usuario habló con B
    const planAfter = s.feed.find((f) => f.id === planA.id) as PlanFeedItem;
    expect(planAfter.status).toBe('awaiting');
    // agentA debe conservar su historial y agentB NO debe haberlo robado
    expect(threadOf(s, 'agentA')?.history.some((m) => String(m.content).includes('historia secreta de A'))).toBe(true);
    expect(threadOf(s, 'agentB')?.history.some((m) => String(m.content).includes('historia secreta de A'))).toBe(false);
  });

  // FALLO REAL: migrateAgents (src/engine/agent/threads.ts:48-49) con `agentLane: undefined` + `agent` + `agents: { agentB }` mete `agent` en `main` junto a `agentB`; `onlyMain` pasa a false y `agentA` pierde por completo su historial, notas, borrador y tarjeta pendiente (quedan huérfanos en `main`).
  it('sesión vieja con `agent` + `agents` parcial y `agentLane: undefined`: agentA no debe perder su estado al migrar', () => {
    const sid = 's_partial';
    const stateA: AgentState = {
      history: [{ role: 'user', content: 'conversación de A' }],
      questionRound: 1,
      notes: ['nota A'],
      busy: false,
      pending: { toolCallId: 'tc1', kind: 'questions', feedItemId: 'q1' },
      draft: { request: 'pedido A', answers: {}, attachments: [] },
    };
    const stateB: AgentState = {
      history: [{ role: 'user', content: 'conversación de B' }],
      questionRound: 0,
      notes: ['nota B'],
      busy: false,
    };
    const saved = legacy({ id: sid, graph: twoAgentGraph(sid), agent: stateA, agentLane: undefined, agents: { agentB: stateB } });
    const migrated = migrateAgents(saved);

    expect(threadOf(migrated, 'agentA')?.history[0]?.content).toBe('conversación de A');
    expect(threadOf(migrated, 'agentA')?.pending?.feedItemId).toBe('q1');
    expect(threadOf(migrated, 'agentB')?.history[0]?.content).toBe('conversación de B');
  });

  // Ataques que pasan: verifican que lo básico de la migración sí aguanta.
  it('sesión vieja completa (tarjetas pendientes, borradores, varios chats) conserva datos al abrir el primer agente y es idempotente', () => {
    const sid = 's_ok';
    const oldAgent: AgentState = {
      history: [{ role: 'user', content: 'hola' }, { role: 'assistant', content: 'buenas' }],
      questionRound: 2,
      notes: ['n1'],
      busy: true,
      phase: 'drafting',
      pending: { toolCallId: 'tc_q', kind: 'questions', feedItemId: 'q_old' },
      draft: { request: 'un clip', answers: { estilo: 'cine' }, attachments: ['a1'] },
      settings: { video: { modelRef: 'local::studio-video', needsImage: false, duration: 5 } },
      enhance: false,
    };
    const saved = legacy({ id: sid, graph: twoAgentGraph(sid), agent: oldAgent, agentLane: 'agentA' });
    const once = migrateAgents(saved);
    const twice = migrateAgents(once);
    expect(twice).toEqual(once);
    expect(once.agents.agentA).toMatchObject({
      questionRound: 2,
      notes: ['n1'],
      busy: false,
      phase: undefined,
      pending: { toolCallId: 'tc_q', kind: 'questions', feedItemId: 'q_old' },
      draft: { request: 'un clip', answers: { estilo: 'cine' }, attachments: ['a1'] },
      enhance: false,
    });
  });

  it('sesión sin agentes (`agents: {}` y grafo vacío) carga sin fallar y puede recibir un mensaje', async () => {
    const sid = 's_empty';
    const saved = legacy({ id: sid, graph: { nodes: [], edges: [] }, agents: {} });
    const merged = useStore.persist.getOptions().merge!({ sessions: { [sid]: saved }, activeSessionId: sid }, useStore.getState()) as ReturnType<typeof useStore.getState>;
    useStore.setState({ sessions: merged.sessions, activeSessionId: sid });
    expect(merged.sessions[sid].agents[MAIN_THREAD]).toBeDefined();

    chat.mockImplementationOnce(async (o) => {
      o.onText?.('Respuesta sin nodos', 'Respuesta sin nodos');
      return llmReply('Respuesta sin nodos');
    });
    await sendAgentMessage('hola sin agentes');
    expect(useStore.getState().sessions[sid].agents[MAIN_THREAD].history.length).toBeGreaterThanOrEqual(2);
    expect(useStore.getState().sessions[sid].agents[MAIN_THREAD].busy).toBe(false);
  });
});
