import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Graph, PlanFeedItem } from '../src/engine/types';

vi.hoisted(() => Object.assign(globalThis, {
  window: { setTimeout, clearTimeout, addEventListener() {} },
  document: { addEventListener() {}, visibilityState: 'visible' },
}));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async (id: string) => id,
}));
const execute = vi.hoisted(() => vi.fn<typeof import('../src/engine/executor').executeSteps>());
vi.mock('../src/engine/executor', async (original) => ({
  ...(await original<typeof import('../src/engine/executor')>()),
  executeSteps: execute,
}));

import { useStore } from '../src/store/store';
import { sendAgentMessage } from '../src/engine/agent/conversation';
import { laneState, patchLane } from '../src/engine/agent/lanes';
import { deleteUserMessage, editUserMessage } from '../src/engine/agent/messageEdit';
import { approvePlan } from '../src/engine/agent/planRun';
import { rewritePrompts } from '../src/engine/agent/planSettings';
import { feedOfChat } from '../src/engine/agent/runtimeShared';
import { disconnectEdges } from '../src/engine/flow/actions';

const HOME = useStore.getState().activeSessionId;
const ref = (id: string, type: 'chat' | 'agent', extra = {}) => ({
  id,
  position: { x: 0, y: 0 },
  data: { kind: 'ref' as const, type, ref: HOME, title: id, ...extra },
});
const ctrl = (id: string, source: string, target: string) => ({
  id,
  source,
  target,
  sourceHandle: 'out_control',
  targetHandle: 'control',
  kind: 'control' as const,
});
const baseGraph = (): Graph => ({
  nodes: [
    ref('chat1', 'chat'),
    ref('chat2', 'chat'),
    ref('agentA', 'agent', { llm: { provider: 'openrouter', model: 'model-a' } }),
    ref('agentB', 'agent', { llm: { provider: 'openrouter', model: 'model-b' } }),
  ],
  edges: [ctrl('e1', 'chat1', 'agentA'), ctrl('e2', 'chat1', 'agentB'), ctrl('e3', 'chat2', 'agentB')],
});
const sessionNow = () => useStore.getState().sessions[HOME];

const llmRequests: Array<{ model: string; messages: unknown[] }> = [];
function stubSse(replyFor: (req: { model: string; messages: unknown[] }) => string = (r) => `Reply from ${r.model}`) {
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (!String(url).includes('/chat/completions')) return new Response(null, { status: 204 });
    const req = JSON.parse(String(init?.body)) as { model: string; messages: unknown[] };
    llmRequests.push(req);
    const content = replyFor(req);
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, {
      headers: { 'content-type': 'text/event-stream' },
    });
  });
}

beforeEach(() => {
  llmRequests.length = 0;
  execute.mockReset();
  stubSse();
  const st = useStore.getState();
  useStore.setState({
    activeSessionId: HOME,
    settings: { ...st.settings, keys: { ...st.settings.keys, openrouter: 'sk-test' }, agent: { ...st.settings.agent, provider: 'openrouter', model: 'model-a' } },
    catalog: {
      ...st.catalog,
      llmStatus: { ...st.catalog.llmStatus, openrouter: 'ready' },
      llm: { ...st.catalog.llm, openrouter: [{ id: 'model-a', name: 'Model A', tools: true, vision: true }, { id: 'model-b', name: 'Model B', tools: true, vision: true }] },
    },
    sessions: {
      ...st.sessions,
      [HOME]: {
        ...st.sessions[HOME],
        graph: baseGraph(),
        feed: [],
        agent: { history: [], questionRound: 0, notes: [], busy: false },
        agentLane: undefined,
        agents: undefined,
      },
    },
  });
});

describe('two-agent identity, history isolation and multi-chat (neon adversarial)', () => {
  it('does not route silently to an unconnected agent when the chat loses its only connected agent', async () => {
    // chat1 is wired ONLY to agentB; agentA sits disconnected earlier in graph.nodes; recipient is unset.
    useStore.setState((st) => ({
      sessions: {
        ...st.sessions,
        [HOME]: {
          ...sessionNow(),
          graph: {
            nodes: [ref('chat1', 'chat'), ref('agentA', 'agent', { llm: { provider: 'openrouter', model: 'model-a' } }), ref('agentB', 'agent', { llm: { provider: 'openrouter', model: 'model-b' } })],
            edges: [ctrl('only-b', 'chat1', 'agentB')],
          },
        },
      },
    }));
    expect(disconnectEdges(HOME, ['only-b'])).toBeNull();

    await sendAgentMessage('nobody connected', { chatNodeId: 'chat1' });
    expect(llmRequests).toHaveLength(0);
    expect(sessionNow().feed.at(-1)).toMatchObject({ type: 'notice' });
  });

  it('deletes a user message from its owning agent history without mutating the other active agent', async () => {
    await sendAgentMessage('same request text', { agentNodeId: 'agentA' });
    await sendAgentMessage('same request text', { agentNodeId: 'agentB' });
    expect(sessionNow().agentLane).toBe('agentB');

    const msgToA = sessionNow().feed.find((f) => f.type === 'user' && f.meta?.agentNodeId === 'agentA')!;
    deleteUserMessage(HOME, msgToA.id);

    expect(JSON.stringify(laneState(HOME, 'agentA')?.history)).not.toContain('same request text');
    expect(JSON.stringify(laneState(HOME, 'agentB')?.history)).toContain('same request text');
  });

  it('delivers plan completion notes to the owning agent A even if the user talks to agent B while the plan executes', async () => {
    await sendAgentMessage('ask A for a plan', { agentNodeId: 'agentA' });
    const planItem: PlanFeedItem = {
      id: 'plan-a',
      createdAt: Date.now(),
      workspace: 'chat',
      type: 'plan',
      style: 'direct',
      status: 'awaiting',
      plan: {
        id: 'pln-a',
        title: 'Secret Plan A',
        summary: 'A summary',
        workspace: 'chat',
        steps: [{ id: 's1', kind: 'text', title: 'Step 1', text: 'done text' }],
        adjustments: [],
      },
      stepStates: { s1: 'pending' },
      stepGenerations: {},
      estimate: { usd: 0, approximate: false, lowerBound: false },
      meta: { timeZone: 'UTC', agentNodeId: 'agentA', chatNodeId: 'chat1' },
    };
    useStore.setState((st) => ({
      sessions: {
        ...st.sessions,
        [HOME]: {
          ...sessionNow(),
          feed: [...sessionNow().feed, planItem],
        },
      },
    }));
    patchLane(HOME, 'agentA', { pending: { toolCallId: null, kind: 'plan', feedItemId: 'plan-a' } });

    let finishExec!: (res: { outputs: Map<string, { assetIds: string[]; text?: string }>; failed: []; skipped: []; waiting: [] }) => void;
    execute.mockImplementationOnce(() => new Promise((resolve) => { finishExec = resolve; }));

    const approval = approvePlan(HOME, 'plan-a');
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));

    // While A's plan runs, the user talks to B (agent.busy is false during plan execution).
    await sendAgentMessage('hello B', { agentNodeId: 'agentB' });
    expect(sessionNow().agentLane).toBe('agentB');

    finishExec({ outputs: new Map([['s1', { assetIds: [], text: 'result from A' }]]), failed: [], skipped: [], waiting: [] });
    await approval;

    // A's closing is its own turn now (a message to B no longer silences it): the news reaches A's conversation or notes, never B's.
    const told = (id: string) => JSON.stringify([laneState(HOME, id)?.notes ?? [], laneState(HOME, id)?.history ?? []]);
    expect(told('agentB')).not.toContain('Secret Plan A');
    expect(told('agentA')).toContain('Secret Plan A');
  });

  it('tags the assistant reply with chat2 when the message was sent from chat2', async () => {
    await sendAgentMessage('hello from second chat', { chatNodeId: 'chat2' });

    const reply = sessionNow().feed.find((f) => f.type === 'assistant');
    expect(reply?.meta?.agentNodeId).toBe('agentB');
    expect(reply?.meta?.chatNodeId).toBe('chat2');
    expect(feedOfChat(HOME, 'chat2').some((f) => f.type === 'assistant')).toBe(true);
  });

  it('truncates agent A history cleanly when editing a message whose text also appeared in agent B', async () => {
    await sendAgentMessage('shared wording', { agentNodeId: 'agentA' });
    await sendAgentMessage('shared wording', { agentNodeId: 'agentB' });

    const msgA = sessionNow().feed.find((f) => f.type === 'user' && f.meta?.agentNodeId === 'agentA')!;
    await editUserMessage(HOME, msgA.id, 'edited for A');

    const histA = JSON.stringify(laneState(HOME, 'agentA')?.history ?? []);
    expect(histA).toContain('edited for A');
    expect(histA).not.toContain('shared wording');
  });

  it('uses owning agent A model and lane notes when rewriting prompts on A’s awaiting plan while B is active', async () => {
    await sendAgentMessage('A starts', { agentNodeId: 'agentA' });
    const planItem: PlanFeedItem = {
      id: 'plan-auto-a',
      createdAt: Date.now(),
      workspace: 'chat',
      type: 'plan',
      style: 'auto',
      status: 'awaiting',
      plan: {
        id: 'pln-auto-a',
        title: 'Auto Plan A',
        summary: 'summary',
        workspace: 'chat',
        steps: [{ id: 's1', kind: 'image', title: 'Shot 1', prompt: 'red fox', modelRef: 'local::image', settings: { count: 1, advanced: {} }, refs: [] }],
        adjustments: [],
      },
      stepStates: { s1: 'pending' },
      stepGenerations: {},
      estimate: { usd: 0, approximate: false, lowerBound: false },
      meta: { timeZone: 'UTC', agentNodeId: 'agentA', chatNodeId: 'chat1' },
    };
    useStore.setState((st) => ({
      sessions: { ...st.sessions, [HOME]: { ...sessionNow(), feed: [...sessionNow().feed, planItem] } },
    }));
    await sendAgentMessage('B is now active', { agentNodeId: 'agentB' });
    expect(sessionNow().agentLane).toBe('agentB');

    llmRequests.length = 0;
    stubSse(() => JSON.stringify({ s1: 'rewritten red fox' }));
    await rewritePrompts(HOME, 'plan-auto-a', 'image');

    expect(llmRequests).toHaveLength(1);
    expect(llmRequests[0].model).toBe('model-a');
    expect(JSON.stringify(laneState(HOME, 'agentB')?.notes ?? [])).not.toContain('Auto Plan A');
    expect(JSON.stringify(laneState(HOME, 'agentA')?.notes ?? [])).toContain('Auto Plan A');
  });

  it('rejects an explicit nonexistent agentNodeId without routing to another agent', async () => {
    await sendAgentMessage('do not route', { agentNodeId: 'does-not-exist' });
    expect(llmRequests).toHaveLength(0);
    expect(sessionNow().feed.at(-1)).toMatchObject({ type: 'notice', level: 'error' });
  });
});
