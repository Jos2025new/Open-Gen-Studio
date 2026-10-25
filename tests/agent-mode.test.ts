import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The three agent modes. Auto (default) and guided keep their behavior; direct asks nothing, shows no settings card and
 * uses the composer's models. Stubbed fetch, nothing reaches a provider.
 */
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { roundsFor } from '../src/engine/procedure';
import { buildContext } from '../src/engine/agent/context';
import { sendAgentMessage } from '../src/engine/agent/runtime';
import { useStore } from '../src/store/store';
import type { AgentStyle, PlanFeedItem } from '../src/engine/types';

type Call = { name: string; args: unknown };
const enc = new TextEncoder();
const sse = (chunks: unknown[]) =>
  new Response(new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(enc.encode(`data: ${JSON.stringify(x)}\n\n`)); c.enqueue(enc.encode('data: [DONE]\n\n')); c.close(); } }), { headers: { 'content-type': 'text/event-stream' } });
const text = (t: string) => sse([{ choices: [{ delta: { content: t } }] }]);
const tool = (c: Call) => sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: `c${Math.random()}`, function: { name: c.name, arguments: JSON.stringify(c.args) } }] }, finish_reason: 'tool_calls' }] }]);

let replies: Array<Response | Call> = [];
let toolNames: string[][] = [];
let sentMessages: string[] = [];
const sid = () => useStore.getState().activeSessionId;
const feedOf = (type: string) => useStore.getState().sessions[sid()].feed.filter((f) => f.type === type);

const imagePlan: Call = { name: 'propose_plan', args: { title: 'Una imagen', steps: [{ id: 's1', kind: 'image', title: 'Imagen', prompt: 'a red bicycle on a beach', count: 1 }] } };

beforeEach(() => {
  replies = [];
  toolNames = [];
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (!body.messages) return new Response(JSON.stringify({ data: [] }));
    toolNames.push((body.tools ?? []).map((t: { function: { name: string } }) => t.function.name));
    sentMessages.push(JSON.stringify(body.messages));
    const next = replies.shift();
    if (!next) return text('ok');
    return next instanceof Response ? next : tool(next);
  });
  const st = useStore.getState();
  useStore.setState({
    settings: { ...st.settings, keys: { ...st.settings.keys, nanogpt: 'k' }, agent: { ...st.settings.agent, provider: 'nanogpt', model: 'm' } },
    composer: { ...st.composer, attachments: [] },
    sessions: {
      ...st.sessions,
      [sid()]: { ...st.sessions[sid()], feed: [], subjects: [], agent: { history: [], questionRound: 0, notes: [], busy: false } },
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

const setMode = (style: AgentStyle) => useStore.setState((s) => ({ composer: { ...s.composer, agentStyle: style } }));

describe('rounds per mode', () => {
  it('auto asks one card, guided uses the Settings rounds, direct asks nothing', () => {
    expect(roundsFor('auto', 3)).toBe(1);
    expect(roundsFor('guided', 3)).toBe(3);
    expect(roundsFor('direct', 3)).toBe(0);
  });
});

describe('the mode line the agent reads', () => {
  it('names direct and says which tools are not available', () => {
    const session = useStore.getState().sessions[sid()];
    const line = buildContext(session, { workspace: 'chat', style: 'direct', round: 0, maxRounds: 0, attachments: [] });
    expect(line).toContain('mode: direct');
    expect(line).toContain('ask_questions and confirm_settings are not available');
    expect(line).not.toContain('guided');
  });
});

describe('direct mode in a request', () => {
  it('does not offer ask_questions or confirm_settings to the model', async () => {
    setMode('direct');
    replies = [text('Listo.')];
    await sendAgentMessage('Una imagen de una bicicleta roja en la playa');
    expect(toolNames[0]).toContain('propose_plan');
    expect(toolNames[0]).not.toContain('ask_questions');
    expect(toolNames[0]).not.toContain('confirm_settings');
  });

  it('shows the plan without a settings card when no model was confirmed', async () => {
    setMode('direct');
    replies = [imagePlan, text('Listo.')];
    await sendAgentMessage('Una imagen de una bicicleta roja en la playa');
    expect(feedOf('plan')).toHaveLength(1);
    expect(feedOf('settings')).toHaveLength(0);
    expect((feedOf('plan')[0] as unknown as PlanFeedItem).status).toBe('awaiting');
  });
});

describe('direct mode guides: the composer\'s model prompts are written for that model, never a generic one', () => {
  it('the composer\'s video guide comes with the request, and reading it is not blocked as unconfirmed', async () => {
    setMode('direct');
    useStore.setState((s) => ({ composer: { ...s.composer, video: { ...s.composer.video, modelRef: 'nanogpt::seedance-2.0' } } }));
    replies = [tool({ name: 'read_guide', args: { id: 'model:seedance' } }), text('Listo.')];
    sentMessages = [];
    await sendAgentMessage('Un vídeo de una taza girando sobre una mesa');
    expect(sentMessages[0]).toContain('Prompting guide of');
    expect(sentMessages[0]).toContain('model:seedance');
    expect(sentMessages[1]).not.toContain('Not loaded');
  });
});

describe('auto stays as before', () => {
  it('a plan whose image model was never confirmed: the app confirms the settings itself and, as the plan fits them, shows it written once', async () => {
    setMode('auto');
    replies = [imagePlan, text('Listo.')];
    await sendAgentMessage('Una imagen de una bicicleta roja en la playa');
    expect(feedOf('settings')).toHaveLength(1);
    expect(feedOf('plan')).toHaveLength(1);
    expect(toolNames[0]).toContain('confirm_settings');
  });
});

describe('guided always asks, and confirms settings in every request', () => {
  it('a plan proposed before any question is sent back: ask first', async () => {
    setMode('guided');
    replies = [imagePlan, text('Primero te pregunto.')];
    await sendAgentMessage('Una imagen de una bicicleta roja en la playa');
    expect(feedOf('plan')).toHaveLength(0);
    expect(sentMessages.join('\n')).toContain('Guided mode: ask your questions first');
  });

  it('settings confirmed in an earlier request are not inherited in guided; auto inherits them', async () => {
    const confirmed = { image: { modelRef: 'local::studio-image', needsImage: false } };
    for (const [style, kept] of [['guided', false], ['auto', true]] as const) {
      setMode(style);
      useStore.setState((s) => ({ sessions: { ...s.sessions, [sid()]: { ...s.sessions[sid()], agent: { ...s.sessions[sid()].agent, settings: confirmed as never } } } }));
      replies = [text('ok')];
      await sendAgentMessage('Otra imagen');
      expect(Boolean(useStore.getState().sessions[sid()].agent.settings?.image)).toBe(kept);
    }
  });
});
