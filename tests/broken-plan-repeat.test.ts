import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener() {} }, document: { addEventListener() {}, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async (id: string) => id }));
const chat = vi.hoisted(() => vi.fn());
vi.mock('../src/engine/providers/llm', async (orig) => ({ ...(await orig<typeof import('../src/engine/providers/llm')>()), chat }));

import { useStore } from '../src/store/store';
import { llmTurn } from '../src/engine/agent/llmTurn';
import { MAIN_THREAD } from '../src/engine/agent/threads';
import { mainThread } from './helpers/threads';

const HOME = useStore.getState().activeSessionId;
const BROKEN = JSON.stringify({ title: 'Lighthouse', summary: 'a lighthouse' });
const reply = () => ({ text: '', toolCalls: [{ id: 'plan1', name: 'propose_plan', arguments: BROKEN }], finishReason: 'tool_calls', timing: { ttfbMs: 1, totalMs: 1 } });

beforeEach(() => {
  chat.mockReset();
  chat.mockImplementation(async () => reply());
  const st = useStore.getState();
  useStore.setState({
    activeSessionId: HOME,
    settings: { ...st.settings, keys: { ...st.settings.keys, openrouter: 'sk-test' }, agent: { ...st.settings.agent, provider: 'openrouter', model: 'deepseek/deepseek-v4-flash', modelPinned: true } },
    composer: { ...st.composer, agentStyle: 'direct' },
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
});
