import { afterEach, expect, it, vi } from 'vitest';
import { savePilotFixtures } from '../scripts/price-pilot.mjs';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener() {} },
  document: { addEventListener() {}, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined, putAssetBlob: async () => undefined,
}));
import { sendAgentMessage } from '../src/engine/agent/runtime';
import { priceDecisionNote } from '../src/engine/agent/priceNotes';
import { costAuthorization } from '../src/engine/priceAuthorization';
import { useStore } from '../src/store/store';

const MODEL = 'deepseek/deepseek-v4.1-flash';
const settings = { count: 1, advanced: {} };
const before = costAuthorization('nanogpt::test-before', settings, { usd: 0.2, approximate: true });
const after = costAuthorization('nanogpt::test-after', settings, { usd: 1.2, approximate: true });
const cases = [
  { id: 'first', continuation: false, decision: 'continue' as const,
    answer: 'Autorizaste $1.20 estimados. El paso está pendiente; todavía no hay un coste cobrado informado.' },
  { id: 'continuation-continue', continuation: true, decision: 'continue' as const,
    answer: 'Elegiste continuar con $1.20 estimados, frente a $0.20 antes. El paso sigue pendiente; el coste real es desconocido.' },
  { id: 'continuation-cancel', continuation: true, decision: 'cancel' as const,
    answer: 'Cancelaste el paso. No se envió al proveedor y no debe reintentarse; no hay un cargo informado.' },
];
afterEach(() => vi.unstubAllGlobals());

it('captures actual runtime requests offline with complete tools and stable prefix', async () => {
  const fixtures: unknown[] = [];
  for (const c of cases) for (const arm of ['control', 'notice'] as const) {
    const st = useStore.getState();
    const sid = st.activeSessionId;
    const note = priceDecisionNote('P', 's1', { decision: c.decision, decidedAt: 1, generationId: 'fixture', before, after, reason: 'cambió el modelo' });
    const captured: Array<Record<string, any>> = [];
    useStore.setState({
      assets: {}, generations: {}, library: [], quotes: {},
      settings: { ...st.settings, keys: { atlas: '', fal: '', openrouter: '', nanogpt: 'test-only' }, agent: { ...st.settings.agent, provider: 'nanogpt', model: MODEL, effort: 'low', showThinking: false } },
      composer: { ...st.composer, attachments: [], agentStyle: 'guided', skillId: null, workflowId: null },
      sessions: { [sid]: { ...st.sessions[sid], title: 'Sandbox pilot fixture', feed: [], subjects: [], agentMetrics: [],
        agent: { history: [], notes: !c.continuation && arm === 'notice' ? [note] : [], busy: false, questionRound: 0 } } },
    });
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (!body.messages) return new Response(JSON.stringify({ data: [] }));
      captured.push(body);
      const guide = c.continuation && captured.length === 1;
      if (guide && arm === 'notice') useStore.setState((s) => ({ sessions: { ...s.sessions, [sid]: {
        ...s.sessions[sid], agent: { ...s.sessions[sid].agent, notes: [note] },
      } } }));
      const delta = guide ? { tool_calls: [{ index: 0, id: 'pilot-guide', function: { name: 'read_guide', arguments: '{"id":"workflow:storyboard"}' } }] }
        : { content: c.answer };
      return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: guide ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`,
        { headers: { 'content-type': 'text/event-stream' } });
    });
    await sendAgentMessage('Explica brevemente qué significa autorizar una estimación y cómo se distingue del coste cobrado. No generes archivos ni medios.');
    expect(captured).toHaveLength(c.continuation ? 2 : 1);
    const body = captured.at(-1)!;
    expect(body.model).toBe(MODEL);
    expect(body.messages[0].role).toBe('system');
    expect(body.tools.length).toBeGreaterThan(10);
    expect(JSON.stringify(body)).not.toMatch(/test-only|cache_control/);
    expect(body.messages.filter((m: { content: unknown }) => typeof m.content === 'string' && m.content.includes('Decisión:'))).toHaveLength(arm === 'notice' ? 1 : 0);
    if (c.continuation) expect(body.messages.slice(0, captured[0].messages.length)).toEqual(captured[0].messages);
    // Pilot-only cap. The production client stays at 16000.
    fixtures.push({ id: `${c.id}-${arm}`, case: c.id, arm, body: { ...body, max_tokens: 500 } });
  }
  if (process.env.PRICE_PILOT_CAPTURE === '1') {
    await savePilotFixtures(process.cwd(), fixtures);
  }
});
