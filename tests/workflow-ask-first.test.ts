import { afterEach, describe, expect, it, vi } from 'vitest';

/*
 * A workflow asks before it loads: outside Direct and before the first question round, read_guide of a workflow
 * answers with a short card; ready: true, a round of questions or Direct bring the full guide. Stubbed LLM, no provider.
 */
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { sendAgentMessage, submitAnswers } from '../src/engine/agent/runtime';
import { SYSTEM_PROMPT } from '../src/engine/agent/context';
import { useStore } from '../src/store/store';
import type { AgentStyle } from '../src/engine/types';

const before = useStore.getState();
afterEach(() => { vi.unstubAllGlobals(); useStore.setState(before); });

const sse = (name: string, args: unknown) => {
  const chunks = [
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'g1', function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }] },
    { choices: [], usage: { prompt_tokens: 100, completion_tokens: 5, cost: 0 } },
  ];
  return new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
};

/** Calls read_guide(args) once (after one questions round when asked) and returns what the agent got back. */
async function guide(style: AgentStyle, args: Record<string, unknown>, afterQuestions = false) {
  let tool = '';
  const script: Array<[string, unknown]> = [
    ...(afterQuestions ? [['ask_questions', { questions: [{ id: 'q1', question: 'Style?', options: ['A', 'B'] }] }] as [string, unknown]] : []),
    ['read_guide', args],
  ];
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (!body.messages) return new Response(JSON.stringify({ data: [] }));
    const tools = body.messages.filter((m: { role: string }) => m.role === 'tool');
    if (tools.length) tool = String(tools[tools.length - 1].content);
    const next = script.shift();
    if (next) return sse(next[0], next[1]);
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  });
  const st = useStore.getState();
  const sid = st.activeSessionId;
  useStore.setState({
    settings: { ...st.settings, keys: { ...st.settings.keys, nanogpt: 'k' }, agent: { ...st.settings.agent, provider: 'nanogpt', model: 'm' } },
    composer: { ...st.composer, agentStyle: style, attachments: [], workflowId: null },
    sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], feed: [], agentMetrics: [], agent: { history: [], questionRound: 0, notes: [], busy: false } } },
  });
  await sendAgentMessage('Quiero tres chicos para un anuncio UGC que tengo en mente');
  if (afterQuestions) {
    const q = useStore.getState().sessions[sid].feed.find((f) => f.type === 'questions');
    expect(q).toBeTruthy();
    await submitAnswers(sid, q!.id, { q1: 'A' });
  }
  const s = useStore.getState().sessions[sid];
  return { tool, guides: (s.agentMetrics ?? []).flatMap((m) => m.guides ?? []), feed: JSON.stringify(s.feed) };
}

const isCard = (t: string) => /^Workflow card "ugc"/.test(t) && !/continuity:/.test(t);

describe('read_guide of a workflow asks first', () => {
  it('outside Direct, before the first round, answers with the card: name, delivery, needs, instruction', async () => {
    for (const style of ['auto', 'guided'] as const) {
      const r = await guide(style, { id: 'workflow:ugc' });
      expect(isCard(r.tool)).toBe(true);
      expect(r.tool).toContain('UGC video');
      expect(r.tool).toContain('the product (photo, or a description)');
      expect(r.tool).toContain('ready: true');
      expect(r.tool).toContain('not this workflow');
    }
  });

  it('the card does not count as a loaded guide: no metric, no "Read the" action', async () => {
    const r = await guide('auto', { id: 'workflow:ugc/unboxing' });
    expect(isCard(r.tool)).toBe(true);
    expect(r.guides).toEqual([]);
    expect(r.feed).not.toContain('Read the');
  });

  it('with ready: true the full guide arrives in one call, and is recorded', async () => {
    const r = await guide('auto', { id: 'workflow:ugc', ready: true });
    expect(isCard(r.tool)).toBe(false);
    expect(r.tool).toMatch(/continuity:/);
    expect(r.guides).toEqual(['workflow:ugc']);
  });

  it('after a round of questions the full guide arrives without ready', async () => {
    const r = await guide('guided', { id: 'workflow:ugc' }, true);
    expect(isCard(r.tool)).toBe(false);
    expect(r.tool).toMatch(/continuity:/);
  });

  it('in Direct the full guide arrives as before', async () => {
    const r = await guide('direct', { id: 'workflow:ugc' });
    expect(isCard(r.tool)).toBe(false);
    expect(r.tool).toMatch(/continuity:/);
  });

  it('skills and app guides are not affected', async () => {
    const r = await guide('auto', { id: 'skill:product' });
    expect(r.tool).toMatch(/^Product photography:/);
    expect(r.guides).toEqual(['skill:product']);
  });

  it('the card does not stop the full guide from being loaded afterwards', async () => {
    const card = await guide('auto', { id: 'workflow:storyboard' });
    expect(card.tool).toMatch(/^Workflow card "storyboard"/);
    const full = await guide('auto', { id: 'workflow:storyboard', ready: true });
    expect(full.tool).toMatch(/continuity:/);
  });
});

describe('the system prompt separates deliverable from purpose', () => {
  it('states the deliverable-vs-purpose MUST rule and no longer loads on resemblance', () => {
    expect(SYSTEM_PROMPT).toContain('is not a deliverable');
    expect(SYSTEM_PROMPT).toContain('Never turn a deliverable into a workflow on your own');
    expect(SYSTEM_PROMPT).not.toMatch(/closely resembles/);
  });

  it('offers a fitting workflow as a choice and loads it only if accepted; read_guide returns a card before asking', () => {
    expect(SYSTEM_PROMPT).toContain('offer it in one line as a choice');
    expect(SYSTEM_PROMPT).toContain('Load it only if the user accepts');
    expect(SYSTEM_PROMPT).toContain('read_guide of a workflow returns its card');
  });
});
