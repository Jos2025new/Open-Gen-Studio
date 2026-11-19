import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Graph } from '../src/engine/types';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener() {} }, document: { addEventListener() {}, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async (id: string) => id }));
// The simulated provider: the turn itself is replaced; what it was asked is observable.
const turn = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => undefined));
vi.mock('../src/engine/agent/llmTurn', () => ({ llmTurn: turn }));

import { useStore } from '../src/store/store';
import { sendAgentMessage, pushHistory } from '../src/engine/agent/conversation';
import { agentEngine } from '../src/engine/agent/runtimeShared';
import { enterLane, laneState, patchLane } from '../src/engine/agent/lanes';
import { recipientOf } from '../src/engine/agent/recipient';
import { setAgentLlm } from '../src/engine/nodes/system';
import { patchNodeData } from '../src/engine/flow/actions';

const HOME = useStore.getState().activeSessionId;
const ref = (id: string, type: 'chat' | 'agent', extra = {}) => ({ id, position: { x: 0, y: 0 }, data: { kind: 'ref' as const, type, ref: HOME, title: id, ...extra } });
const control = (id: string, source: string, target: string) => ({ id, source, target, sourceHandle: 'out_control', targetHandle: 'control', kind: 'control' as const });
const graph = (): Graph => ({ nodes: [ref('chat', 'chat'), ref('agentA', 'agent', { title: 'Writer' }), ref('agentB', 'agent', { title: 'Critic' })], edges: [control('c1', 'chat', 'agentA'), control('c2', 'chat', 'agentB')] });
const S = () => useStore.getState().sessions[HOME];
const users = () => S().feed.filter((f) => f.type === 'user') as unknown as { text: string; meta: { agentNodeId?: string; toAgentNodeIds?: string[] } }[];

beforeEach(() => {
  turn.mockClear();
  const st = useStore.getState();
  useStore.setState({
    activeSessionId: HOME,
    settings: { ...st.settings, keys: { ...st.settings.keys, openrouter: 'sk-test' }, agent: { ...st.settings.agent, provider: 'openrouter', model: 'default/model' } },
    sessions: { ...st.sessions, [HOME]: { ...st.sessions[HOME], graph: graph(), feed: [], agent: { history: [], questionRound: 0, notes: [], busy: false }, agentLane: undefined, agents: undefined } },
  });
});

describe('strip 2: chat with two agents', () => {
  it('delivers to the named agent, end to end', async () => {
    await sendAgentMessage('review this', { agentNodeId: 'agentB' });
    expect(turn).toHaveBeenCalledTimes(1);
    expect(turn.mock.calls[0]).toMatchObject([HOME, expect.anything(), { agentNodeId: 'agentB' }]);
    expect(users()[0].meta).toMatchObject({ agentNodeId: 'agentB', toAgentNodeIds: ['agentB'] });
    expect(S().agentLane).toBe('agentB');
  });

  it('without a name it goes where the chat node is set, else to the first connected (as before)', async () => {
    await sendAgentMessage('one');
    expect(users().at(-1)!.meta.agentNodeId).toBe('agentA');
    patchNodeData(HOME, 'chat', { recipient: 'agentB' });
    await sendAgentMessage('two');
    expect(users().at(-1)!.meta.agentNodeId).toBe('agentB');
    expect(recipientOf(HOME, 'agentA').id).toBe('agentA'); // an explicit name beats the chat node's setting
  });

  it('an unknown recipient is an error, never another agent', async () => {
    await sendAgentMessage('hello', { agentNodeId: 'nobody' });
    expect(turn).not.toHaveBeenCalled();
    expect(users()).toHaveLength(0);
    expect(S().feed.at(-1)).toMatchObject({ type: 'notice', text: 'No such agent node: nobody.' });
  });

  it('each agent keeps its own history', async () => {
    await sendAgentMessage('for the writer', { agentNodeId: 'agentA' });
    pushHistory(HOME, { role: 'assistant', content: 'writer says' });
    await sendAgentMessage('for the critic', { agentNodeId: 'agentB' });
    expect(laneState(HOME, 'agentA')!.history.some((m) => m.content === 'writer says')).toBe(true);
    expect(S().agent.history.some((m) => m.content === 'writer says')).toBe(false); // the critic never saw it
    await sendAgentMessage('writer again', { agentNodeId: 'agentA' });
    expect(S().agent.history.some((m) => m.content === 'writer says')).toBe(true);
    expect(laneState(HOME, 'agentB')!.history.some((m) => JSON.stringify(m.content).includes('for the critic'))).toBe(true);
  });

  it('an open card belongs to its agent: a message to the other does not answer it', async () => {
    await sendAgentMessage('plan something', { agentNodeId: 'agentA' });
    patchLane(HOME, 'agentA', { pending: { toolCallId: 'call-1', kind: 'questions', feedItemId: 'card-1' } });
    await sendAgentMessage('hello critic', { agentNodeId: 'agentB' });
    expect(S().agent.pending).toBeUndefined(); // the critic has none
    expect(laneState(HOME, 'agentA')!.pending).toMatchObject({ feedItemId: 'card-1' }); // the writer's card is still open
    expect(turn.mock.calls.at(-1)![2]).toMatchObject({ agentNodeId: 'agentB' });
  });

  it('showing another agent never moves or stops the one that is mid-turn', async () => {
    await sendAgentMessage('go', { agentNodeId: 'agentA' });
    patchLane(HOME, 'agentA', { busy: true });
    expect(enterLane(HOME, 'agentB')).toBeNull();
    expect(S().agentLane).toBe('agentB');
    expect(S().agent.busy).toBe(false);
    expect(laneState(HOME, 'agentA')!.busy).toBe(true);
  });

  it('each agent has its own LLM', () => {
    expect(setAgentLlm(HOME, 'agentB', { provider: 'openrouter', model: 'critic/model' })).toBeNull();
    expect(agentEngine(HOME, 'agentB')).toMatchObject({ kind: 'llm', model: 'critic/model' });
    expect(agentEngine(HOME, 'agentA')).toMatchObject({ kind: 'llm', model: 'default/model' });
    setAgentLlm(HOME, 'agentB', null);
    expect(agentEngine(HOME, 'agentB')).toMatchObject({ model: 'default/model' });
  });

  it('an existing conversation stays with the first agent that is written to', async () => {
    useStore.setState((st) => ({ sessions: { ...st.sessions, [HOME]: { ...st.sessions[HOME], agent: { ...st.sessions[HOME].agent, history: [{ role: 'user', content: 'old talk' }] } } } }));
    await sendAgentMessage('continue', { agentNodeId: 'agentA' });
    expect(S().agent.history.some((m) => m.content === 'old talk')).toBe(true);
    expect(laneState(HOME, 'agentB')).toBeUndefined();
  });
});
