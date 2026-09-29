import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { sendAgentMessage } from '../src/engine/agent/runtime';
import { buildContext, SYSTEM_PROMPT } from '../src/engine/agent/context';
import { guideIndex, guideWorkspaceProblem, readGuide } from '../src/engine/skills';
import { useStore } from '../src/store/store';
import type { LlmMessage } from '../src/engine/types';

type Reply = { text?: string; tool?: { name: string; args: unknown } };

const sse = (r: Reply) => {
  const chunks: unknown[] = [];
  if (r.text) chunks.push({ choices: [{ delta: { content: r.text } }] });
  if (r.tool) chunks.push({ choices: [{ delta: { tool_calls: [{ index: 0, id: `c${Math.random()}`, function: { name: r.tool.name, arguments: JSON.stringify(r.tool.args) } }] }, finish_reason: 'tool_calls' }] });
  const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
};

let replies: Reply[] = [];
const sid = () => useStore.getState().activeSessionId;
const session = () => useStore.getState().sessions[sid()];

beforeEach(() => {
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (!body.messages) return new Response(JSON.stringify({ data: [] }));
    return sse(replies.shift() ?? { text: 'ok' });
  });
  const st = useStore.getState();
  useStore.setState({
    settings: { ...st.settings, keys: { ...st.settings.keys, nanogpt: 'k' }, agent: { ...st.settings.agent, provider: 'nanogpt', model: 'm' } },
    composer: { ...st.composer, agentStyle: 'guided', attachments: [] },
    sessions: { ...st.sessions, [sid()]: { ...st.sessions[sid()], feed: [], agent: { history: [], questionRound: 0, notes: [], busy: false } } },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('workflows by canvas', () => {
  it('the index marks chat-only workflows and stays the same prompt on every canvas', () => {
    expect(guideIndex()).toMatch(/workflow:story — .*\(chat only\)/);
    expect(SYSTEM_PROMPT).toContain(guideIndex());
  });

  it('read_guide refuses a workflow outside its canvas, with the alternative', () => {
    expect(guideWorkspaceProblem('workflow:story', 'chat')).toBeUndefined();
    expect(guideWorkspaceProblem('workflow:story', 'node')).toMatch(/one node per clip, without join_clips/);
    expect(guideWorkspaceProblem('skill:product', 'node')).toBeUndefined();
    expect(readGuide('workflow:story')).toBeTruthy();
  });

  it('the node context names what the canvas cannot run; the chat context does not', () => {
    const base = { style: 'guided' as const, round: 0, maxRounds: 2, attachments: [] };
    expect(buildContext(session(), { ...base, workspace: 'node' })).toContain('node canvas cannot run: join_clips');
    expect(buildContext(session(), { ...base, workspace: 'chat' })).not.toContain('cannot run');
  });
});

describe('text before a rejected plan', () => {
  const bad = { name: 'propose_plan', args: { title: 'Bad', steps: [{ id: 's1', kind: 'op', op: 'upscale', input: 's9' }] } };
  const good = { name: 'propose_plan', args: { title: 'Good', steps: [{ id: 's1', kind: 'text', text: 'hi' }] } };
  const assistantTexts = () => session().feed.filter((f) => f.type === 'assistant').map((f) => (f as { text: string }).text);

  it('is dropped from the feed and kept in the history; the retry keeps its own text', async () => {
    replies = [{ text: 'Here is your plan.', tool: bad }, { text: 'Fixed plan.', tool: good }];
    await sendAgentMessage('upscale it');
    expect(assistantTexts()).toEqual(['Fixed plan.']);
    expect(session().agent.history.some((m: LlmMessage) => m.role === 'assistant' && m.content === 'Here is your plan.')).toBe(true);
    expect(session().feed.some((f) => f.type === 'plan')).toBe(true);
  });

  it('a valid plan keeps the text written with it', async () => {
    replies = [{ text: 'Copy: "OPEN LATE".', tool: good }];
    await sendAgentMessage('a poster');
    expect(assistantTexts()).toEqual(['Copy: "OPEN LATE".']);
  });

  it('when no valid plan comes, a notice stays visible', async () => {
    replies = [1, 2, 3].map(() => ({ text: 'Promise.', tool: bad }));
    await sendAgentMessage('upscale it');
    expect(assistantTexts()).toEqual([]);
    expect(session().feed.some((f) => f.type === 'notice')).toBe(true);
  });
});
