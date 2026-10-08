import { describe, expect, it, vi } from 'vitest';

/*
 * The three agent modes. Auto (default) and guided keep their behavior; direct asks nothing, shows no settings card and
 * uses the composer's models. Stubbed fetch, nothing reaches a provider.
 */
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));


import { STEER_TOOL, steerNote, steerOps } from '../src/engine/agent/force';
import { chat } from '../src/engine/providers/llm';
import { sendAgentMessage } from '../src/engine/agent/runtime';
import { useStore } from '../src/store/store';
import type { PlanFeedItem } from '../src/engine/types';

/*
 * Steering (agent/force.ts): every operation's keywords direct the agent toward the tool call that carries it. The
 * agent reads what the keywords named, and its first call of that request is propose_plan (tool_choice), only when
 * keywords applied. No plan is refused for a missing operation. Stubbed fetch, nothing reaches a provider.
 */
const img = { id: 'img1', kind: 'image' };

describe('every operation\'s keywords steer, with an attached input when one fits', () => {
  it('names the operations in request order, with their phrase and input', () => {
    expect(steerOps('quítale el fondo y luego una vista lateral', [img])).toEqual([
      { op: 'remove_bg', phrase: 'quitale el fondo', input: 'asset:img1' },
      { op: 'angle', phrase: 'vista lateral', input: 'asset:img1' },
    ]);
    expect(steerOps('ponle luz de estudio', []).map((o) => o.op)).toEqual(['relight']);
    expect(steerOps('quiero variaciones de este logo', []).map((o) => o.op)).toEqual(['variations']);
    expect(steerOps('una bicicleta roja en la playa', [img])).toEqual([]);
  });

  it('the note says what was named and to call propose_plan; nothing when no keyword applied', () => {
    expect(steerNote([])).toBe('');
    const note = steerNote(steerOps('quita el fondo', [img]));
    expect(note).toContain("The request's keywords name: remove_bg («quita el fondo», on asset:img1:");
    expect(note).toContain('Call propose_plan');
  });
});

/** A request end to end; returns each model call's tool_choice and messages. */
async function request(text: string, attachments: string[], plans: unknown[]) {
  const calls: Array<{ toolChoice: unknown; messages: string }> = [];
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (!body.messages) return new Response(JSON.stringify({ data: [] }));
    calls.push({ toolChoice: body.tool_choice, messages: JSON.stringify(body.messages) });
    const plan = plans.shift();
    const delta = plan ? { tool_calls: [{ index: 0, id: `c${calls.length}`, function: { name: 'propose_plan', arguments: JSON.stringify(plan) } }] } : { content: 'Listo.' };
    return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: plan ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  });
  const st = useStore.getState();
  const sid = st.activeSessionId;
  useStore.setState({
    settings: { ...st.settings, keys: { ...st.settings.keys, nanogpt: 'k' }, agent: { ...st.settings.agent, provider: 'nanogpt', model: 'm' } },
    composer: { ...st.composer, agentStyle: 'auto', attachments },
    assets: { ...st.assets, img1: { id: 'img1', kind: 'image', name: 'foto.png', width: 1024, height: 1024, createdAt: Date.now() } as never },
    sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], feed: [], subjects: [], agent: { history: [], questionRound: 0, notes: [], busy: false } } },
  });
  await sendAgentMessage(text);
  vi.unstubAllGlobals();
  return { calls, plans: useStore.getState().sessions[sid].feed.filter((f) => f.type === 'plan') as unknown as PlanFeedItem[] };
}

describe('in a request, end to end', () => {
  it('keywords: the first call is directed to propose_plan with the note; later calls are free', async () => {
    const { calls, plans } = await request('Quítale el fondo a esta foto', ['img1'], [{ title: 'Fondo', steps: [{ id: 's1', kind: 'op', op: 'remove_bg', input: 'asset:img1' }] }]);
    expect(calls[0].toolChoice).toEqual({ type: 'function', function: { name: STEER_TOOL } });
    expect(calls[0].messages).toContain("The request's keywords name: remove_bg");
    expect(calls.slice(1).every((c) => c.toolChoice === 'auto')).toBe(true);
    expect(plans).toHaveLength(1);
  });

  it('no keyword: the model chooses freely and reads no note', async () => {
    const { calls } = await request('Una bicicleta roja en la playa', [], []);
    expect(calls[0].toolChoice).toBe('auto');
    expect(calls[0].messages).not.toContain("The request's keywords name");
  });

  it('a plan without the named operation is not refused: steering directs, it does not gate', async () => {
    const { plans } = await request('Quítale el fondo a esta foto', ['img1'], [{ title: 'Fondo', steps: [{ id: 's1', kind: 'op', op: 'edit', input: 'asset:img1', params: { instruction: 'remove the background' } }] }]);
    expect(plans).toHaveLength(1);
  });
});

describe('a provider that refuses a named tool_choice', () => {
  it('is asked again once with "auto"', async () => {
    const sent: unknown[] = [];
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      sent.push(body.tool_choice);
      if (sent.length === 1) return new Response(JSON.stringify({ error: { message: 'tool_choice with a named function is not supported' } }), { status: 400 });
      return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
    });
    await chat({ provider: 'nanogpt', apiKey: 'k', model: 'm', system: 's', messages: [], tools: [], toolChoice: STEER_TOOL, signal: new AbortController().signal });
    expect(sent).toEqual([{ type: 'function', function: { name: STEER_TOOL } }, 'auto']);
    vi.unstubAllGlobals();
  });
});
