import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Stop frees the composer at once, whatever the turn is awaiting. The user's case: a newly released Atlas model whose
 * schema never arrives left the turn in "Checking the plan…" and Stop did nothing. Nothing reaches a provider.
 */

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined, setInterval, clearInterval }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

// The schema load of the atlas model hangs until the test resolves it; others behave as always.
const hangs: Array<() => void> = [];
vi.mock('../src/engine/catalog', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/engine/catalog')>();
  return {
    ...real,
    resolveModel: (ref: string) => (ref.startsWith('atlas::') ? new Promise((resolve) => hangs.push(() => resolve(null))) : real.resolveModel(ref)),
  };
});

import { sendAgentMessage, stopAgent } from '../src/engine/agent/runtime';
import { agentAccepts } from '../src/engine/agent/sendGate';
import { useStore } from '../src/store/store';

const REF = 'atlas::xai/grok-imagine-video-v1.5-lite/image-to-video';
const plan = { name: 'propose_plan', args: { title: 'Switch model', steps: [{ id: 's1', kind: 'image', title: 'Frame', model: REF, prompt: 'a frame' }] } };
const sse = (call: typeof plan) => new Response(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: call.name, arguments: JSON.stringify(call.args) } }] }, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
const text = (t: string) => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
let replies: Array<typeof plan | string> = [];
const sid = () => useStore.getState().activeSessionId;
const sess = () => useStore.getState().sessions[sid()];
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  hangs.length = 0;
  replies = [plan];
  vi.stubGlobal('fetch', async (_u: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (!body.messages) return new Response(JSON.stringify({ data: [] }));
    const r = replies.shift() ?? 'ok';
    return typeof r === 'string' ? text(r) : sse(r);
  });
  const st = useStore.getState();
  const id = st.activeSessionId;
  useStore.setState({
    settings: { ...st.settings, keys: { ...st.settings.keys, nanogpt: 'k', atlas: 'k' }, agent: { ...st.settings.agent, provider: 'nanogpt', model: 'm', showThinking: false } },
    composer: { ...st.composer, agentStyle: 'direct', attachments: [] },
    catalog: { ...st.catalog, models: { ...st.catalog.models, [REF]: { ref: REF, id: 'x', provider: 'atlas', name: 'Grok Imagine Video 1.5 Lite', kind: 'video' } as never } },
    sessions: { ...st.sessions, [id]: { ...st.sessions[id], feed: [], subjects: [], agent: { history: [], questionRound: 0, notes: [], busy: false, settings: {} } } },
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function stuckInCheck() {
  const turn = sendAgentMessage('switch to the new model');
  await vi.waitFor(() => expect(hangs.length).toBeGreaterThan(0));
  expect(sess().agent.phase).toBe('checking');
  return { turn };
}
const feedSnapshot = () => JSON.stringify(sess().feed.map((f) => [f.id, f.type]));

describe('Stop frees a turn stuck in "Checking the plan…"', () => {
  it('(a) busy is false and the turn is over at once; the late schema adds nothing', async () => {
    const { turn } = await stuckInCheck();
    stopAgent();
    expect(sess().agent.busy).toBe(false);
    expect(sess().agent.phase).toBeUndefined();
    await turn; // the turn itself ends, without the hang being resolved
    const feed = feedSnapshot();
    const agent = JSON.stringify({ ...sess().agent });
    expect(sess().feed.some((f) => f.type === 'notice' && f.text === 'Stopped.')).toBe(true);
    hangs.forEach((h) => h());
    await flush();
    await flush();
    expect(feedSnapshot()).toBe(feed);
    expect(sess().feed.some((f) => f.type === 'plan')).toBe(false);
    expect(JSON.stringify({ ...sess().agent })).toBe(agent);
  });

  it('(b) the user can write right after Stop, and the old turn\'s late result does not touch the new one', async () => {
    const { turn } = await stuckInCheck();
    stopAgent();
    expect(agentAccepts()).toBe(true);
    replies = ['Here you are.'];
    await sendAgentMessage('hello');
    await turn;
    expect(sess().feed.some((f) => f.type === 'assistant' && f.text === 'Here you are.')).toBe(true);
    const feed = feedSnapshot();
    hangs.forEach((h) => h());
    await flush();
    await flush();
    expect(feedSnapshot()).toBe(feed);
    expect(sess().feed.some((f) => f.type === 'plan')).toBe(false);
    expect(sess().agent.busy).toBe(false);
  });

  it('(c) the five-minute cap frees the turn the same way', async () => {
    vi.useFakeTimers();
    const turn = sendAgentMessage('switch to the new model');
    await vi.advanceTimersByTimeAsync(50);
    expect(hangs.length).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(sess().agent.busy).toBe(false);
    await turn;
    expect(sess().feed.filter((f) => f.type === 'notice' && /min limit/.test(f.text))).toHaveLength(1);
    hangs.forEach((h) => h());
    await vi.advanceTimersByTimeAsync(50);
    expect(sess().feed.some((f) => f.type === 'plan')).toBe(false);
  });

  it('(d) while the check waits for a schema, the activity block names the model', async () => {
    vi.useFakeTimers();
    const turn = sendAgentMessage('switch to the new model');
    await vi.advanceTimersByTimeAsync(4000);
    expect(sess().agent.waiting?.some((w) => /Grok Imagine Video 1.5 Lite/.test(w.name))).toBe(true);
    stopAgent();
    await turn;
  });
});
