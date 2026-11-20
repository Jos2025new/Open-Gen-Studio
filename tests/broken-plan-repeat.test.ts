import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener() {} }, document: { addEventListener() {}, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async (id: string) => id }));
const chat = vi.hoisted(() => vi.fn());
vi.mock('../src/engine/providers/llm', async (orig) => ({ ...(await orig<typeof import('../src/engine/providers/llm')>()), chat }));

import { useStore } from '../src/store/store';
import { llmTurn } from '../src/engine/agent/llmTurn';
import { MAIN_THREAD } from '../src/engine/agent/threads';
import { mainThread } from './helpers/threads';
import type { ModelSchema, ModelSummary } from '../src/engine/types';

const HOME = useStore.getState().activeSessionId;
const BROKEN = JSON.stringify({ title: 'Lighthouse', summary: 'a lighthouse' });
const reply = (args = BROKEN, id = 'plan1') => ({ text: '', toolCalls: [{ id, name: 'propose_plan', arguments: args }], finishReason: 'tool_calls', timing: { ttfbMs: 1, totalMs: 1 } });
const done = { text: 'ok', toolCalls: [], finishReason: 'stop', timing: { ttfbMs: 1, totalMs: 1 } };
const REF = 'openrouter::test/image';
const step = (extra: Record<string, unknown>) => JSON.stringify({ title: 'Lighthouse', steps: [{ id: 's1', kind: 'image', title: 'Lighthouse', count: 1, model: REF, ...extra }] });
const feed = () => useStore.getState().sessions[HOME].feed;
const history = () => useStore.getState().sessions[HOME].agents[MAIN_THREAD].history;

beforeEach(() => {
  chat.mockReset();
  chat.mockImplementation(async () => reply());
  const st = useStore.getState();
  useStore.setState({
    activeSessionId: HOME,
    settings: { ...st.settings, keys: { ...st.settings.keys, openrouter: 'sk-test' }, agent: { ...st.settings.agent, provider: 'openrouter', model: 'deepseek/deepseek-v4-flash', modelPinned: true } },
    composer: { ...st.composer, agentStyle: 'direct' },
    catalog: {
      ...st.catalog,
      models: { ...st.catalog.models, [REF]: { ref: REF, id: 'test/image', provider: 'openrouter', kind: 'image', name: 'Test Image', acceptsText: true, acceptsImage: false, tags: [], price: { skus: [{ unit: 'image', usd: 0.05 }] } } as unknown as ModelSummary },
      schemas: { ...st.catalog.schemas, [REF]: { ref: REF, source: 'catalog', params: [], slots: { prompt: 'prompt', promptRequired: true } } as ModelSchema },
    },
    sessions: { ...st.sessions, [HOME]: { ...st.sessions[HOME], feed: [], agents: mainThread({ history: [{ role: 'user', content: 'a lighthouse' }] }), agentLane: undefined } },
  });
});

describe('a model that repeats the same invalid plan', () => {
  it('stops on the second identical plan and does not change the model', async () => {
    const before = useStore.getState().settings.agent.model;
    await llmTurn(HOME, 'chat', { route: 'new', agentNodeId: MAIN_THREAD });
    expect(chat).toHaveBeenCalledTimes(2);
    expect(useStore.getState().settings.agent.model).toBe(before);
    const note = useStore.getState().sessions[HOME].feed.find((f) => f.type === 'notice');
    expect(note && 'text' in note ? note.text : '').toMatch(/same invalid plan twice/);
    expect(note && 'text' in note ? note.text : '').toMatch(/model was not changed/);
  });

  it('the real DeepSeek case (a step with no prompt, reaching the plan validator) stops on the repeat, answers its tool_call and drops the promise text', async () => {
    chat.mockReset();
    chat.mockImplementation(async () => ({ ...reply(step({}), 'p1'), text: 'I will make it now.' }));
    await llmTurn(HOME, 'chat', { route: 'new', agentNodeId: MAIN_THREAD });
    expect(chat).toHaveBeenCalledTimes(2);
    const note = feed().find((f) => f.type === 'notice');
    expect(note && 'text' in note ? note.text : '').toMatch(/same invalid plan twice \(.*prompt/);
    expect(feed().some((f) => f.type === 'assistant' || (f.type as string) === 'text')).toBe(false);
    const answered = history().filter((m) => m.role === 'tool').map((m) => (m as { tool_call_id: string }).tool_call_id);
    expect(answered).toEqual(['p1', 'p1']);
    expect(useStore.getState().settings.agent.model).toBe('deepseek/deepseek-v4-flash');
  });

  it('the same plan written with another key order or spacing counts as the same', async () => {
    const a = JSON.stringify({ title: 'Lighthouse', summary: 'a lighthouse' });
    const b = '{ "summary": "a lighthouse",   "title": "Lighthouse" }';
    chat.mockReset();
    chat.mockResolvedValueOnce(reply(a)).mockResolvedValueOnce(reply(b));
    await llmTurn(HOME, 'chat', { route: 'new', agentNodeId: MAIN_THREAD });
    expect(chat).toHaveBeenCalledTimes(2);
    expect(feed().find((f) => f.type === 'notice')).toBeTruthy();
  });

  it('two different broken plans in a row are not a repeat', async () => {
    chat.mockReset();
    chat.mockResolvedValueOnce(reply(step({}), 'a')).mockResolvedValueOnce(reply(step({ title: 'Other' }), 'b')).mockResolvedValueOnce(done);
    await llmTurn(HOME, 'chat', { route: 'new', agentNodeId: MAIN_THREAD });
    expect(chat).toHaveBeenCalledTimes(3);
    expect(feed().some((f) => f.type === 'notice' && 'text' in f && /same invalid plan/.test(f.text))).toBe(false);
  });

  it('a corrected plan after a broken one is presented and the turn is not stopped', async () => {
    chat.mockReset();
    chat.mockResolvedValueOnce(reply(step({}), 'a')).mockResolvedValueOnce(reply(step({ prompt: 'a lighthouse at dusk' }), 'b'));
    await llmTurn(HOME, 'chat', { route: 'new', agentNodeId: MAIN_THREAD });
    expect(chat).toHaveBeenCalledTimes(2);
    expect(feed().some((f) => f.type === 'plan')).toBe(true);
    expect(feed().some((f) => f.type === 'notice' && 'text' in f && /same invalid plan/.test(f.text))).toBe(false);
  });
});
