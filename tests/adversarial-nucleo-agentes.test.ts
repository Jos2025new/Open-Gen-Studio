import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Graph } from '../src/engine/types';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener() {} }, document: { addEventListener() {}, visibilityState: 'visible' } }));
const blob = vi.hoisted(() => vi.fn(async (_id: string): Promise<Blob | undefined> => undefined));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: blob, putAssetBlob: async (id: string) => id }));
const turn = vi.hoisted(() => vi.fn<typeof import('../src/engine/agent/llmTurn').llmTurn>());
vi.mock('../src/engine/agent/llmTurn', () => ({ llmTurn: turn }));

import { useStore } from '../src/store/store';
import { sendAgentMessage, submitAnswers } from '../src/engine/agent/conversation';
import { laneState } from '../src/engine/agent/lanes';
import { disconnectEdges, patchNodeData } from '../src/engine/flow/actions';

const HOME = useStore.getState().activeSessionId;
const ref = (id: string, type: 'chat' | 'agent', extra = {}) => ({ id, position: { x: 0, y: 0 }, data: { kind: 'ref' as const, type, ref: HOME, title: id, ...extra } });
const edge = (id: string, target: string) => ({ id, source: 'chat', target, sourceHandle: 'out_control', targetHandle: 'control', kind: 'control' as const });
const graph = (): Graph => ({ nodes: [ref('chat', 'chat'), ref('a', 'agent', { llm: { provider: 'openrouter', model: 'vision' } }), ref('b', 'agent', { llm: { provider: 'openrouter', model: 'blind' } })], edges: [edge('ea', 'a'), edge('eb', 'b')] });
const current = () => useStore.getState().sessions[HOME];

beforeEach(() => {
  turn.mockReset(); turn.mockImplementation(async () => undefined);
  blob.mockReset(); blob.mockResolvedValue(undefined);
  vi.stubGlobal('fetch', () => { throw new Error('Unexpected network request'); });
  const st = useStore.getState();
  useStore.setState({
    activeSessionId: HOME,
    settings: { ...st.settings, keys: { ...st.settings.keys, openrouter: 'sk-test' }, agent: { ...st.settings.agent, provider: 'openrouter', model: 'vision' } },
    catalog: { ...st.catalog, llmStatus: { ...st.catalog.llmStatus, openrouter: 'ready' }, llm: { ...st.catalog.llm, openrouter: [{ id: 'vision', name: 'Vision', tools: true, vision: true }, { id: 'blind', name: 'Blind', tools: true, vision: false }] } },
    assets: { ...st.assets, picture: { id: 'picture', kind: 'image', name: 'picture', width: 10, height: 10 } as never },
    sessions: { ...st.sessions, [HOME]: { ...st.sessions[HOME], graph: graph(), feed: [], agent: { history: [], questionRound: 0, notes: [], busy: false }, agentLane: undefined, agentLanes: undefined } },
  });
});

describe('two agent adversarial routes', () => {
  it('rejects a saved recipient when its last chat connection disappears', async () => {
    expect(patchNodeData(HOME, 'chat', { recipient: 'b' })).toBeNull();
    expect(disconnectEdges(HOME, ['ea', 'eb'])).toBeNull();
    expect(current().graph.edges).toEqual([]);
    // FALLO REAL: recipient.ts accepts a saved agent when connected is empty; a disconnected recipient must block the send.
    await sendAgentMessage('do not route', { chatNodeId: 'chat' });
    expect.soft(turn).not.toHaveBeenCalled();
    expect(current().feed.at(-1)).toMatchObject({ type: 'notice' });
  });

  it('uses the chosen agent vision capability for its attachment', async () => {
    // FALLO REAL: attachments.ts reads global settings rather than the chosen agent model; blind B must not receive an image.
    await sendAgentMessage('describe', { agentNodeId: 'b', attachments: ['picture'] });
    expect.soft(blob).not.toHaveBeenCalled();
    expect.soft(current().feed.some((f) => f.type === 'notice' && f.text.includes('cannot see images'))).toBe(true);
    expect(turn).toHaveBeenCalledWith(HOME, expect.anything(), expect.objectContaining({ agentNodeId: 'b' }));
  });

  it('reserves A before a slow attachment and retains the original session after navigation', async () => {
    let release!: (value: undefined) => void;
    blob.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const first = sendAgentMessage('for A', { agentNodeId: 'a', chatNodeId: 'chat', attachments: ['picture'] });
    await vi.waitFor(() => expect(blob).toHaveBeenCalled());
    expect(current().agent.busy).toBe(true);
    await sendAgentMessage('for B', { agentNodeId: 'b' });
    expect(turn).not.toHaveBeenCalled();
    const before = useStore.getState();
    useStore.setState({ activeSessionId: 'other', sessions: { ...before.sessions, other: { ...before.sessions[HOME], id: 'other', feed: [], graph: { nodes: [], edges: [] } } } });
    release(undefined); await first;
    expect(turn).toHaveBeenCalledTimes(1);
    expect(turn).toHaveBeenCalledWith(HOME, expect.anything(), expect.objectContaining({ agentNodeId: 'a' }));
    expect(current().feed.find((f) => f.type === 'user')).toMatchObject({ meta: { agentNodeId: 'a', chatNodeId: 'chat' } });
    expect(useStore.getState().sessions.other.feed).toEqual([]);
  });

  it('refuses A card answers during B turn and preserves both pending states', async () => {
    await sendAgentMessage('A request', { agentNodeId: 'a' });
    useStore.setState((st) => ({ sessions: { ...st.sessions, [HOME]: { ...current(), feed: [{ id: 'card-a', createdAt: 1, workspace: 'chat', type: 'questions', status: 'pending', questions: [], meta: { agentNodeId: 'a' } } as never], agent: { ...current().agent, pending: { toolCallId: 'call-a', kind: 'questions', feedItemId: 'card-a' } } } } }));
    await sendAgentMessage('B request', { agentNodeId: 'b' });
    useStore.setState((st) => ({ sessions: { ...st.sessions, [HOME]: { ...current(), agent: { ...current().agent, busy: true, pending: { toolCallId: 'call-b', kind: 'questions', feedItemId: 'card-b' } } } } }));
    turn.mockClear();
    await submitAnswers(HOME, 'card-a', { answer: 'yes' });
    expect(turn).not.toHaveBeenCalled();
    expect(current().agentLane).toBe('b');
    expect(current().agent.pending?.feedItemId).toBe('card-b');
    expect(laneState(HOME, 'a')?.pending?.feedItemId).toBe('card-a');
    expect(current().feed.find((f) => f.id === 'card-a')).toMatchObject({ status: 'pending' });
  });

  it('routes a comment on A’s waiting plan back to A with B selected', async () => {
    await sendAgentMessage('A request', { agentNodeId: 'a' });
    useStore.setState((st) => ({
      sessions: {
        ...st.sessions,
        [HOME]: {
          ...current(),
          feed: [...current().feed, {
            id: 'plan-a', createdAt: 1, workspace: 'chat', type: 'plan', status: 'awaiting',
            plan: { id: 'plan-a', title: 'A plan', steps: [] }, meta: { agentNodeId: 'a' },
          } as never],
          agent: { ...current().agent, pending: { toolCallId: null, kind: 'plan', feedItemId: 'plan-a' } },
        },
      },
    }));
    await sendAgentMessage('private B request', { agentNodeId: 'b' });
    turn.mockClear();
    await sendAgentMessage('Change the framing', { attachments: [], agentNodeId: 'a' });
    expect(turn).toHaveBeenCalledOnce();
    expect(turn).toHaveBeenCalledWith(HOME, 'chat', expect.objectContaining({ route: 'plan-comment', agentNodeId: 'a' }));
    expect(JSON.stringify(laneState(HOME, 'a')?.history)).toContain('Change the framing');
    expect(JSON.stringify(laneState(HOME, 'b')?.history)).not.toContain('Change the framing');
    expect(current().feed.find((item) => item.id === 'plan-a')).toMatchObject({ status: 'awaiting' });
  });

  it('sends each lane history and model to its own simulated LLM', async () => {
    const actual = await vi.importActual<typeof import('../src/engine/agent/llmTurn')>('../src/engine/agent/llmTurn');
    turn.mockImplementation(actual.llmTurn);
    const requests: Array<{ model: string; messages: unknown[] }> = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (!String(url).includes('/chat/completions')) return new Response(null, { status: 204 });
      const request = JSON.parse(String(init?.body)) as { model: string; messages: unknown[] };
      requests.push(request);
      const delta = { content: `Reply from ${request.model}` };
      return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, {
        headers: { 'content-type': 'text/event-stream' },
      });
    });
    await sendAgentMessage('private alpha token', { agentNodeId: 'a' });
    await sendAgentMessage('private bravo token', { agentNodeId: 'b' });
    await sendAgentMessage('alpha continuation', { agentNodeId: 'a' });
    expect(requests.map((request) => request.model)).toEqual(['vision', 'blind', 'vision']);
    expect(JSON.stringify(requests[1].messages)).not.toContain('private alpha token');
    const continued = JSON.stringify(requests[2].messages);
    expect(continued).toContain('private alpha token');
    expect(continued).not.toContain('private bravo token');
    expect(current().feed.filter((item) => item.type === 'assistant').map((item) => [item.meta?.agentNodeId, item.text])).toEqual([
      ['a', 'Reply from vision'], ['b', 'Reply from blind'], ['a', 'Reply from vision'],
    ]);
  });
});
