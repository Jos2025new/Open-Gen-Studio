import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));
const logged = vi.hoisted(() => [] as Array<{ kind: string; data: Record<string, unknown> }>);
vi.mock('../src/lib/log', () => ({ logEvent: (kind: string, data: Record<string, unknown>) => void logged.push({ kind, data }), logged: () => undefined, logSettled: async () => undefined }));
// The images need no blobs here: every asset "renders" as one image part.
vi.mock('../src/engine/agent/attachments', async (orig) => ({
  ...(await orig<typeof import('../src/engine/agent/attachments')>()),
  attachmentParts: async (ids: string[]) => ids.flatMap((id) => [{ type: 'text', text: `asset:${id}:` }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${id}` } }]),
}));

import { approvePlan, sendAgentMessage } from '../src/engine/agent/runtime';
import { editPairParts } from '../src/engine/agent/wrapUpPairs';
import { useStore } from '../src/store/store';
import type { PlanFeedItem } from '../src/engine/types';

const sse = (text: string, tool?: unknown) => {
  const chunks: unknown[] = [];
  if (text) chunks.push({ choices: [{ delta: { content: text } }] });
  if (tool) chunks.push({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'propose_plan', arguments: JSON.stringify(tool) } }] }, finish_reason: 'tool_calls' }] });
  return new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
};
let chatCalls = 0;
const ends = () => logged.filter((l) => l.data.event === 'turn-end').map((l) => l.data);
const starts = () => logged.filter((l) => l.data.event === 'turn-start').map((l) => l.data);

beforeEach(() => {
  chatCalls = 0;
  logged.length = 0;
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (!body.messages) return new Response(JSON.stringify({ data: [] }));
    chatCalls++;
    return chatCalls === 1 ? sse('', { title: 'Note', steps: [{ id: 's1', kind: 'text', text: 'a' }] }) : sse('Ready.');
  });
  const st = useStore.getState();
  const sid = st.activeSessionId;
  useStore.setState({
    settings: { ...st.settings, keys: { ...st.settings.keys, nanogpt: 'k' }, agent: { ...st.settings.agent, provider: 'nanogpt', model: 'm' } },
    composer: { ...st.composer, agentStyle: 'direct', attachments: [] },
    sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], feed: [], agent: { history: [], questionRound: 0, notes: [], busy: false } } },
  });
});
afterEach(() => vi.unstubAllGlobals());

const sid = () => useStore.getState().activeSessionId;
const plans = () => useStore.getState().sessions[sid()].feed.filter((f): f is PlanFeedItem => f.type === 'plan');

describe('turn log', () => {
  it('a turn leaves one start and one end line with the same id, engine, route and outcome, and no content', async () => {
    await sendAgentMessage('secret request text');
    expect(starts()).toHaveLength(1);
    expect(ends()).toHaveLength(1);
    expect(starts()[0]).toMatchObject({ session: sid(), engine: 'llm', route: 'new' });
    expect(ends()[0]).toMatchObject({ turn: starts()[0].turn, session: sid(), outcome: 'plan' });
    expect(typeof ends()[0].ms).toBe('number');
    expect(JSON.stringify(logged)).not.toContain('secret request text');
  });
  it('a comment on the plan is the plan-comment route; the wrap-up after running it is the wrap-up route', async () => {
    await sendAgentMessage('note');
    await approvePlan(sid(), plans()[0].id);
    expect(starts().map((t) => t.route)).toEqual(['new', 'wrap-up']);
    expect(ends().map((t) => t.outcome)).toEqual(['plan', 'text']);
    expect(starts().map((t) => t.turn)).toEqual(ends().map((t) => t.turn));
  });
  it('the local planner logs as offline', async () => {
    const st = useStore.getState();
    useStore.setState({ settings: { ...st.settings, agent: { ...st.settings.agent, provider: 'offline' } } });
    await sendAgentMessage('a poster');
    expect(starts()[0]).toMatchObject({ engine: 'offline', route: 'new' });
    expect(ends()[0].turn).toBe(starts()[0].turn);
  });
});

describe('wrap-up after a plan', () => {
  it('a plan that edited nothing carries no images and costs no extra call beyond the wrap-up text', async () => {
    await sendAgentMessage('note');
    await approvePlan(sid(), plans()[0].id);
    expect(chatCalls).toBe(2);
    const last = useStore.getState().sessions[sid()].agent.history.filter((m) => m.role === 'user').at(-1)!;
    expect(typeof last.content).toBe('string');
    expect(last.content).toMatch(/you have not seen the result/);
  });
  const item = (steps: unknown[], stepOutputs: Record<string, { assetIds: string[] }>) => ({ plan: { steps }, stepOutputs }) as unknown as PlanFeedItem;
  const asset = (id: string, kind = 'image') => ({ id, kind });
  beforeEach(() => useStore.setState((st) => ({ assets: { ...st.assets, a1: asset('a1'), r1: asset('r1'), r2: asset('r2'), v1: asset('v1', 'video') } as never })));
  it('an edit step yields original then result, labelled, with the change asked', async () => {
    const parts = await editPairParts(item([{ id: 's1', kind: 'image', title: 't', prompt: 'make the sky red', refs: ['asset:a1'] }], { s1: { assetIds: ['r1'] } }));
    const texts = parts.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text);
    expect(texts[0]).toMatch(/make the sky red.*ORIGINAL \(asset:a1\)/);
    expect(texts[2]).toMatch(/RESULT \(asset:r1\)/);
    expect(parts.filter((p) => p.type === 'image_url')).toHaveLength(2);
  });
  it('ambiguous or non-edit steps are left out; the pairs are capped at three', async () => {
    const steps = [
      { id: 'a', kind: 'image', title: 't', prompt: 'x', refs: [] },
      { id: 'b', kind: 'image', title: 't', prompt: 'x', refs: ['asset:a1', 'asset:a1'] },
      { id: 'c', kind: 'op', title: 't', op: 'upscale', input: 'asset:v1' },
      { id: 'd', kind: 'op', title: 't', op: 'upscale', input: 'asset:a1' },
    ];
    expect(await editPairParts(item(steps, { a: { assetIds: ['r1'] }, b: { assetIds: ['r1'] }, c: { assetIds: ['r1'] }, d: { assetIds: ['r1', 'r2'] } }))).toEqual([]);
    const many = ['e1', 'e2', 'e3', 'e4'].map((id) => ({ id, kind: 'op', title: 't', op: 'upscale', input: 'asset:a1' }));
    const parts = await editPairParts(item(many, Object.fromEntries(many.map((m) => [m.id, { assetIds: ['r1'] }]))));
    expect(parts.filter((p) => p.type === 'image_url')).toHaveLength(6);
  });
});
