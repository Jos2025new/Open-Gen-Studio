import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Graph } from '../src/engine/types';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener() {} }, document: { addEventListener() {}, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async (id: string) => id }));
const turn = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => undefined));
vi.mock('../src/engine/agent/llmTurn', () => ({ llmTurn: turn }));

import { useStore } from '../src/store/store';
import { sendAgentMessage, submitAnswers } from '../src/engine/agent/conversation';
import { messageMeta } from '../src/engine/agent/runtimeShared';
import { laneState, patchLane } from '../src/engine/agent/lanes';
import { recipientOf } from '../src/engine/agent/recipient';
import { resolveInputs, storeEnv } from '../src/engine/nodecore/resolver';
import { patchNodeData } from '../src/engine/flow/actions';

import { viewed, agentsWith, mainThread } from './helpers/threads';
const HOME = useStore.getState().activeSessionId;
const ref = (id: string, type: 'chat' | 'agent', extra = {}) => ({ id, position: { x: 0, y: 0 }, data: { kind: 'ref' as const, type, ref: HOME, title: id, ...extra } });
const control = (id: string, source: string, target: string) => ({ id, source, target, sourceHandle: 'out_control', targetHandle: 'control', kind: 'control' as const });
const graph = (): Graph => ({ nodes: [ref('chat', 'chat'), ref('chat2', 'chat'), ref('agentA', 'agent'), ref('agentB', 'agent')], edges: [control('c1', 'chat', 'agentA'), control('c2', 'chat', 'agentB'), control('c3', 'chat2', 'agentB')] });
const S = () => useStore.getState().sessions[HOME];
const pend = (kind: 'questions') => ({ toolCallId: 'call-1', kind, feedItemId: 'card-1' });

beforeEach(() => {
  turn.mockReset(); turn.mockImplementation(async () => undefined);
  const st = useStore.getState();
  useStore.setState({
    activeSessionId: HOME,
    settings: { ...st.settings, keys: { ...st.settings.keys, openrouter: 'sk-test' }, agent: { ...st.settings.agent, provider: 'openrouter', model: 'default/model' } },
    sessions: { ...st.sessions, [HOME]: { ...st.sessions[HOME], graph: graph(), feed: [], agents: mainThread({ history: [], questionRound: 0, notes: [], busy: false }), agentLane: undefined} },
  });
});

describe('review finding 4: a card action belongs to its own agent', () => {
  it('answers A\'s card while B is mid-turn: A continues, B is untouched', async () => {
    await sendAgentMessage('plan', { agentNodeId: 'agentA' });
    useStore.setState((st) => ({ sessions: { ...st.sessions, [HOME]: { ...st.sessions[HOME], feed: [{ id: 'card-1', createdAt: 1, workspace: 'chat', type: 'questions', status: 'pending', questions: [], meta: { agentNodeId: 'agentA' } } as never], agents: agentsWith(st.sessions[HOME], { pending: pend('questions') }) } } }));
    await sendAgentMessage('hello', { agentNodeId: 'agentB' });
    expect(S().agentLane).toBe('agentB');
    patchLane(HOME, 'agentB', { busy: true });
    turn.mockClear();
    await submitAnswers(HOME, 'card-1', { a: 'b' });
    expect(turn).toHaveBeenCalledTimes(1);
    expect(laneState(HOME, 'agentB')!.busy).toBe(true);
    expect(laneState(HOME, 'agentA')!.pending).toBeUndefined();
    expect((S().feed.find((f) => f.id === 'card-1') as { status: string }).status).toBe('answered');
  });
  it('a card action brings its owner forward when nobody is working', async () => {
    await sendAgentMessage('plan', { agentNodeId: 'agentA' });
    useStore.setState((st) => ({ sessions: { ...st.sessions, [HOME]: { ...st.sessions[HOME], feed: [{ id: 'card-1', createdAt: 1, workspace: 'chat', type: 'questions', status: 'pending', questions: [], meta: { agentNodeId: 'agentA' } } as never], agents: agentsWith(st.sessions[HOME], { pending: pend('questions') }) } } }));
    await sendAgentMessage('hello', { agentNodeId: 'agentB' });
    await submitAnswers(HOME, 'card-1', {});
    expect(S().agentLane).toBe('agentA');
  });
});

describe('review finding 5: the turn is reserved and keeps its identity', () => {
  it('a second agent starts while the first turn is still running; each keeps its own reservation', async () => {
    let release!: () => void;
    turn.mockImplementationOnce(() => new Promise<undefined>((r) => { release = () => r(undefined); }));
    const first = sendAgentMessage('slow', { agentNodeId: 'agentA' });
    await vi.waitFor(() => expect(turn).toHaveBeenCalledTimes(1));
    expect(viewed(S()).busy).toBe(true);
    await sendAgentMessage('in parallel', { agentNodeId: 'agentB' });
    expect(turn).toHaveBeenCalledTimes(2);
    expect(laneState(HOME, 'agentA')!.busy).toBe(true);
    release(); await first;
    expect(laneState(HOME, 'agentA')!.busy).toBe(false);
  });
  it('a message that never reaches a turn does not leave the agent reserved', async () => {
    await sendAgentMessage('   ', { agentNodeId: 'agentA' });
    expect(viewed(S()).busy).toBe(false);
  });
  it('metadata comes from the session of the turn, not from the one on screen', () => {
    useStore.setState((st) => ({ sessions: { ...st.sessions, [HOME]: { ...st.sessions[HOME], agentLane: 'agentB' }, other: { ...st.sessions[HOME], id: 'other', graph: { nodes: [], edges: [] }, agentLane: undefined } }, activeSessionId: 'other' }));
    expect(messageMeta('chat', {}, HOME, 'agentB')).toMatchObject({ agentNodeId: 'agentB', chatNodeId: 'chat' });
  });
  it('an agent port delivers its own last reply, not the last one of the session', () => {
    const say = (id: string, agent: string, text: string) => ({ id, createdAt: 1, workspace: 'chat', type: 'assistant', text, meta: { agentNodeId: agent } }) as never;
    useStore.setState((st) => ({ sessions: { ...st.sessions, [HOME]: { ...st.sessions[HOME], feed: [say('1', 'agentA', 'from A'), say('2', 'agentB', 'from B')], graph: { ...graph(), nodes: [...graph().nodes, { id: 't', position: { x: 0, y: 0 }, data: { kind: 'text', title: 't', text: '' } }], edges: [{ id: 'w', source: 'agentA', target: 't', sourceHandle: 'out', targetHandle: 'in' }] } } } }));
    const node = S().graph.nodes.find((n) => n.id === 'agentA')!;
    expect(storeEnv().chatText(node)).toBe('from A');
    expect(storeEnv().chatText(S().graph.nodes.find((n) => n.id === 'agentB')!)).toBe('from B');
    expect(resolveInputs(S().graph, S().graph.nodes.find((n) => n.id === 't')!, storeEnv())[0]).toMatchObject({ from: 'agentA', value: 'from A' });
  });
});

describe('review finding 6: the chosen recipient is never swapped silently', () => {
  it('a disconnected recipient is an error, not another agent', async () => {
    patchNodeData(HOME, 'chat', { recipient: 'agentB' });
    useStore.setState((st) => ({ sessions: { ...st.sessions, [HOME]: { ...st.sessions[HOME], graph: { ...S().graph, edges: S().graph.edges.filter((e) => e.id !== 'c2') } } } }));
    expect(recipientOf(HOME).error).toContain('no longer connected');
    await sendAgentMessage('hi');
    expect(turn).not.toHaveBeenCalled();
    expect(S().feed.at(-1)).toMatchObject({ type: 'notice' });
  });
  it('the message comes from the chat whose composer sent it', async () => {
    patchNodeData(HOME, 'chat', { recipient: 'agentA' });
    await sendAgentMessage('from chat 2', { chatNodeId: 'chat2' }); // chat2 is wired to agentB only
    expect(S().agentLane).toBe('agentB');
    expect((S().feed.find((f) => f.type === 'user') as unknown as { meta: { chatNodeId?: string } }).meta.chatNodeId).toBe('chat2');
  });
});
