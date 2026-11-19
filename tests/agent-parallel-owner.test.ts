import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Graph } from '../src/engine/types';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener() {} }, document: { addEventListener() {}, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async (id: string) => id }));
type ChatOpts = { messages: unknown[]; signal?: AbortSignal; onText?: (d: string, full: string) => void };
const chat = vi.hoisted(() => vi.fn<(o: ChatOpts) => Promise<unknown>>());
vi.mock('../src/engine/providers/llm', async (orig) => ({ ...(await orig<typeof import('../src/engine/providers/llm')>()), chat }));

import { check as ownerCheck } from '../scripts/check-agent-owner.mjs';
import { useStore } from '../src/store/store';
import { sendAgentMessage, stopAgent } from '../src/engine/agent/conversation';
import { laneState, patchLane } from '../src/engine/agent/lanes';
import { directModelRefs, inConversation } from '../src/engine/agent/requestGuides';
import { buildContext } from '../src/engine/agent/context';
import { resolveSystemNodeLive } from '../src/engine/nodes/spec';

import { mainThread } from './helpers/threads';
/** ADR 0031: two agents of one chat run in parallel; whatever agent A's turn writes lands in A, never in the agent on screen. */
const HOME = useStore.getState().activeSessionId;
const ref = (id: string, type: 'chat' | 'agent') => ({ id, position: { x: 0, y: 0 }, data: { kind: 'ref' as const, type, ref: HOME, title: id } });
const control = (id: string, source: string, target: string) => ({ id, source, target, sourceHandle: 'out_control', targetHandle: 'control', kind: 'control' as const });
const graph = (): Graph => ({ nodes: [ref('chat', 'chat'), ref('chat2', 'chat'), ref('agentA', 'agent'), ref('agentB', 'agent')], edges: [control('c1', 'chat', 'agentA'), control('c3', 'chat2', 'agentB')] });
const S = () => useStore.getState().sessions[HOME];
const text = (x: unknown) => JSON.stringify(x);
const result = (t: string, toolCalls: unknown[] = []) => ({ text: t, toolCalls, finishReason: toolCalls.length ? 'tool_calls' : 'stop', timing: { ttfbMs: 1, totalMs: 1 } });
const ASK = { id: 'callA', name: 'ask_questions', arguments: JSON.stringify({ questions: [{ id: 'q', question: 'Which?', options: ['x', 'y'] }] }) };

let releaseA!: () => void;
beforeEach(() => {
  chat.mockReset();
  vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
  const st = useStore.getState();
  useStore.setState({
    activeSessionId: HOME,
    settings: { ...st.settings, keys: { ...st.settings.keys, openrouter: 'sk-test' }, agent: { ...st.settings.agent, provider: 'openrouter', model: 'default/model' } },
    sessions: { ...st.sessions, [HOME]: { ...st.sessions[HOME], graph: graph(), feed: [], agents: mainThread({ history: [], questionRound: 0, notes: [], busy: false }), agentLane: undefined} },
  });
  // A waits to be released (it is the slow one); B answers at once.
  chat.mockImplementation(async (o) => {
    const last = text(o.messages.at(-1));
    if (last.includes('ask A')) { o.onText?.('part', 'A part'); await new Promise<void>((r, j) => { releaseA = r; o.signal?.addEventListener('abort', () => j(new DOMException('x', 'AbortError'))); }); return result('A final', [ASK]); }
    return result('B final');
  });
});

describe('parallel agents: A runs in the background while B is on screen', () => {
  const start = async () => {
    const a = sendAgentMessage('ask A', { agentNodeId: 'agentA', chatNodeId: 'chat' });
    await vi.waitFor(() => expect(chat).toHaveBeenCalledTimes(1));
    await sendAgentMessage('hello B', { agentNodeId: 'agentB', chatNodeId: 'chat2' }); // B is now on screen and has answered
    return { a };
  };

  it('the history and tool_calls of A go to A, not to B', async () => {
    const { a } = await start();
    expect(S().agentLane).toBe('agentB');
    releaseA(); await a;
    expect(text(laneState(HOME, 'agentA')?.history)).toContain('A final');
    expect(text(laneState(HOME, 'agentA')?.history)).toContain('callA');
    expect(text(laneState(HOME, 'agentB')?.history)).not.toContain('A final');
    expect(text(laneState(HOME, 'agentB')?.history)).not.toContain('callA');
    expect(text(laneState(HOME, 'agentB')?.history)).toContain('B final');
  });

  it('the card, pending call and question round of A belong to A', async () => {
    const { a } = await start();
    releaseA(); await a;
    expect(laneState(HOME, 'agentA')?.pending).toMatchObject({ toolCallId: 'callA' });
    expect(laneState(HOME, 'agentA')?.questionRound).toBe(1);
    expect(laneState(HOME, 'agentB')?.pending).toBeUndefined();
    expect(laneState(HOME, 'agentB')?.questionRound).toBe(0);
    const card = S().feed.find((f) => f.type === 'questions') as { meta?: { agentNodeId?: string; chatNodeId?: string } };
    expect(card.meta).toMatchObject({ agentNodeId: 'agentA', chatNodeId: 'chat' });
  });

  it('every row A wrote carries A and the chat it was asked from', async () => {
    const { a } = await start();
    releaseA(); await a;
    const rows = S().feed.filter((f) => (f.type === 'assistant' || f.type === 'questions') && /A (part|final)|Which/.test(text(f)));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect((r as { meta?: unknown }).meta).toMatchObject({ agentNodeId: 'agentA', chatNodeId: 'chat' });
  });

  it('Stop stops the agents working in the background too', async () => {
    const { a } = await start();
    stopAgent(HOME);
    await a;
    expect(laneState(HOME, 'agentA')?.busy).toBe(false);
    expect(text(laneState(HOME, 'agentA')?.history)).not.toContain('A final');
  });

  it('each agent card shows its own state and model, not the global one', async () => {
    await sendAgentMessage('hello B', { agentNodeId: 'agentB', chatNodeId: 'chat2' });
    patchLane(HOME, 'agentA', { busy: true, phase: 'working' });
    useStore.setState((st) => ({ sessions: { ...st.sessions, [HOME]: { ...st.sessions[HOME], graph: { ...st.sessions[HOME].graph, nodes: st.sessions[HOME].graph.nodes.map((n) => (n.id === 'agentA' && n.data.kind === 'ref' ? { ...n, data: { ...n.data, llm: { provider: 'openrouter', model: 'a/own' } } } : n)) } } } }));
    const card = (id: string) => resolveSystemNodeLive(HOME, S().graph.nodes.find((n) => n.id === id)!);
    expect(card('agentA')).toMatchObject({ badge: 'Busy', chips: expect.arrayContaining([expect.stringContaining('own')]) });
    expect(card('agentB')?.badge).not.toBe('Busy');
    expect(card('agentB')?.chips).not.toContainEqual(expect.stringContaining('own'));
  });

  it('the check refuses a hand-built write of session.agent and the tree has none', () => {
    expect(ownerCheck('.')).toEqual([]);
    const root = mkdtempSync(join(tmpdir(), 'own-'));
    mkdirSync(join(root, 'src/engine'), { recursive: true });
    writeFileSync(join(root, 'src/engine/bad.ts'), "patchSession(id, (s) => ({ ...s, agent: { ...s.agent, notes: [] } }));\n");
    expect(ownerCheck(root)[0]).toMatch(/bad\.ts:1: writes an agent's state by hand/);
  });

  describe('readers take the agent that owns the turn, not the one on screen', () => {
    const setup = async () => {
      await sendAgentMessage('hello B', { agentNodeId: 'agentB', chatNodeId: 'chat2' }); // B is on screen
      patchLane(HOME, 'agentA', { history: [{ role: 'user', content: 'GUIDE-MARK' }], settings: { video: { modelRef: 'local::vid-a', aspect: '16:9', resolution: '720p', needsImage: false, duration: 5 } } as never, draft: { request: 'for A', answers: {}, attachments: [] } });
    };
    it('a guide already in A\'s conversation is found for A and not for B', async () => {
      await setup();
      expect(inConversation(HOME, 'agentA', 'GUIDE-MARK')).toBe(true);
      expect(inConversation(HOME, 'agentB', 'GUIDE-MARK')).toBe(false);
    });
    it('Direct runs the model A confirmed, not the one on screen', async () => {
      await setup();
      useStore.setState((st) => ({ composer: { ...st.composer, agentStyle: 'direct' } }));
      expect(directModelRefs(HOME, 'agentA', 'video')).toContain('local::vid-a');
      expect(directModelRefs(HOME, 'agentB', 'video')).not.toContain('local::vid-a');
    });
    it('the context of A\'s turn carries A\'s confirmed settings', async () => {
      await setup();
      const opts = (id: string) => ({ workspace: 'chat' as const, style: 'auto' as const, round: 0, maxRounds: 1, attachments: [], agent: laneState(HOME, id)! });
      expect(buildContext(S(), opts('agentA'))).toContain('settings confirmed by the user');
      expect(buildContext(S(), opts('agentB'))).not.toContain('settings confirmed by the user');
    });
  });
});
