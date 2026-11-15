// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatResult, chat as chatFn } from '../src/engine/providers/llm';
import type { AssistantFeedItem, NoticeFeedItem, PlanFeedItem, QuestionsFeedItem, SettingsFeedItem, UserFeedItem } from '../src/engine/types';

type ChatArgs = Parameters<typeof chatFn>[0];
const mockChat = vi.fn<(opts: ChatArgs) => Promise<ChatResult>>();

vi.mock('../src/engine/providers/llm', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/engine/providers/llm')>();
  return { ...mod, chat: (opts: ChatArgs) => mockChat(opts) };
});

vi.mock('../src/lib/writerLock', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/lib/writerLock')>();
  return { ...mod, mayStartWork: () => true };
});

import { FeedList } from '../src/components/chat/FeedList';
import { ThreadPeek } from '../src/components/composer/ThreadPeek';
import { DesignerCorner, useCorner } from '../src/components/node/NodeSide';
import { sendAgentMessage } from '../src/engine/agent/runtime';
import { notice } from '../src/engine/agent/runtimeShared';
import { buildMessageMetaSummary, formatMessageDateTime } from '../src/engine/feedMeta';
import { useStore } from '../src/store/store';

function resetStore(opts: { provider?: 'openrouter' | 'offline'; model?: string } = {}) {
  mockChat.mockReset();
  const provider = opts.provider ?? 'openrouter';
  const model = opts.model ?? 'anthropic/claude-sonnet-4';
  const st = useStore.getState();
  const sid = st.activeSessionId;
  useStore.setState({
    ui: { ...st.ui, workspace: 'node' },
    composer: { ...st.composer, agentStyle: 'auto', attachments: [] },
    catalog: {
      ...st.catalog,
      llm: {
        ...st.catalog.llm,
        openrouter: [
          { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4', contextLength: 200000, vision: true, tools: true, reasoning: false, inputPrice: 3, outputPrice: 15 },
          { id: 'vendor/unpriced-model', name: 'Unpriced Model', contextLength: 32000, vision: false, tools: true, reasoning: false },
        ],
      },
    },
    settings: {
      ...st.settings,
      keys: { ...st.settings.keys, openrouter: provider === 'openrouter' ? 'sk-test' : '' },
      agent: {
        ...st.settings.agent,
        provider,
        model: provider === 'openrouter' ? model : '',
        showThinking: false,
      },
    },
    sessions: {
      ...st.sessions,
      [sid]: {
        ...st.sessions[sid],
        feed: [],
        agent: {
          busy: false,
          history: [],
          notes: [],
          questionRound: 0,
        },
      },
    },
  });
  return sid;
}

describe('chat message metadata (step 10)', () => {
  beforeEach(() => {
    resetStore();
  });

  it('stores time zone, agent, Space, provider, model, usage, cost, and shared runId on user and LLM agent messages', async () => {
    const sid = resetStore();
    mockChat.mockImplementationOnce(async (opts) => {
      opts.onText?.('Hello back', 'Hello back');
      return {
        text: 'Hello back',
        toolCalls: [],
        timing: { ttfbMs: 20, totalMs: 120, reasoningMs: 0, outputMs: 120 },
        usage: { inputTokens: 120, outputTokens: 45, cachedTokens: 20, costUsd: 0.0012 },
        finishReason: 'stop',
      };
    });

    await sendAgentMessage('Make a poster');

    const feed = useStore.getState().sessions[sid].feed;
    const user = feed.find((f): f is UserFeedItem => f.type === 'user');
    const assistant = feed.find((f): f is AssistantFeedItem => f.type === 'assistant');

    expect(user?.meta).toBeDefined();
    expect(user?.meta?.timeZone).toBeTruthy();
    expect(user?.meta?.agent).toBeUndefined();
    expect('agent' in (user?.meta ?? {})).toBe(false);
    expect(user?.meta?.space).toBe('canvas');
    expect(user?.meta?.provider).toBe('openrouter');
    expect(user?.meta?.model).toBe('anthropic/claude-sonnet-4');
    expect(user?.meta?.runId).toBeTruthy();

    expect(assistant?.meta).toBeDefined();
    expect(assistant?.meta?.runId).toBe(user?.meta?.runId);
    expect(assistant?.meta?.agent).toBe('Director');
    expect(assistant?.meta?.space).toBe('canvas');
    expect(assistant?.meta?.provider).toBe('openrouter');
    expect(assistant?.meta?.model).toBe('anthropic/claude-sonnet-4');
    expect(assistant?.meta?.usage).toEqual({ inputTokens: 120, outputTokens: 45, cachedTokens: 20 });
    expect(assistant?.meta?.costUsd).toBeCloseTo(0.0012, 6);
    expect(assistant?.meta?.costEstimated).toBe(false);
  });

  it('marks catalog-derived cost as estimated and omits costUsd when neither provider nor catalog has pricing', async () => {
    const sid = resetStore({ model: 'anthropic/claude-sonnet-4' });
    mockChat.mockImplementationOnce(async (opts) => {
      opts.onText?.('Estimated', 'Estimated');
      return {
        text: 'Estimated',
        toolCalls: [],
        timing: { ttfbMs: 20, totalMs: 80, reasoningMs: 0, outputMs: 80 },
        usage: { inputTokens: 1000, outputTokens: 1000 },
        finishReason: 'stop',
      };
    });
    await sendAgentMessage('First');
    const first = useStore.getState().sessions[sid].feed.find((f): f is AssistantFeedItem => f.type === 'assistant');
    expect(first?.meta?.costEstimated).toBe(true);
    expect(first?.meta?.costUsd).toBeCloseTo(0.018, 6);

    const sid2 = resetStore({ model: 'vendor/unpriced-model' });
    mockChat.mockImplementationOnce(async (opts) => {
      opts.onText?.('No price', 'No price');
      return {
        text: 'No price',
        toolCalls: [],
        timing: { ttfbMs: 20, totalMs: 60, reasoningMs: 0, outputMs: 60 },
        usage: { inputTokens: 500, outputTokens: 200 },
        finishReason: 'stop',
      };
    });
    await sendAgentMessage('Second');
    const second = useStore.getState().sessions[sid2].feed.find((f): f is AssistantFeedItem => f.type === 'assistant');
    expect(second?.meta?.usage).toEqual({ inputTokens: 500, outputTokens: 200 });
    expect(second?.meta?.costUsd).toBeUndefined();
  });

  it('accumulates usage and cost across tool-only iterations into the surviving assistant message', async () => {
    const sid = resetStore();
    mockChat
      .mockImplementationOnce(async () => ({
        text: '',
        toolCalls: [{ id: 'tc1', name: 'unknown_probe_tool', arguments: '{}' }],
        timing: { ttfbMs: 20, totalMs: 50, reasoningMs: 0, outputMs: 50 },
        usage: { inputTokens: 100, outputTokens: 20, costUsd: 0.001 },
        finishReason: 'tool_calls',
      }))
      .mockImplementationOnce(async (opts) => {
        opts.onText?.('Done now', 'Done now');
        return {
          text: 'Done now',
          toolCalls: [],
          timing: { ttfbMs: 20, totalMs: 70, reasoningMs: 0, outputMs: 70 },
          usage: { inputTokens: 150, outputTokens: 30, costUsd: 0.002 },
          finishReason: 'stop',
        };
      });

    await sendAgentMessage('Check workspace');
    const assistant = useStore.getState().sessions[sid].feed.find((f): f is AssistantFeedItem => f.type === 'assistant');
    expect(assistant?.meta?.usage).toEqual({ inputTokens: 250, outputTokens: 50 });
    expect(assistant?.meta?.costUsd).toBeCloseTo(0.003, 6);
  });

  it('records Space, local agent, and shared runId for offline turns', async () => {
    const sid = resetStore({ provider: 'offline' });
    await sendAgentMessage('Explain how this works');
    const feed = useStore.getState().sessions[sid].feed;
    const user = feed.find((f): f is UserFeedItem => f.type === 'user');
    const assistant = feed.find((f): f is AssistantFeedItem => f.type === 'assistant');
    expect(user?.meta?.agent).toBeUndefined();
    expect(user?.meta?.provider).toBe('offline');
    expect(assistant?.meta?.agent).toBe('Local planner');
    expect(assistant?.meta?.provider).toBe('offline');
    expect(assistant?.meta?.model).toBe('Local planner');
    expect(assistant?.meta?.space).toBe('canvas');
    expect(assistant?.meta?.runId).toBe(user?.meta?.runId);
  });

  it('caches one Intl.DateTimeFormat per time zone in formatMessageDateTime', () => {
    const OrigDateTimeFormat = Intl.DateTimeFormat;
    const seenZones: Array<string | undefined> = [];
    const spy = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (this: unknown, locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
      seenZones.push(options?.timeZone);
      return new OrigDateTimeFormat(locales, options);
    } as unknown as typeof Intl.DateTimeFormat);
    try {
      const a1 = formatMessageDateTime(Date.UTC(2026, 5, 1, 12, 0), 'Asia/Tokyo');
      const a2 = formatMessageDateTime(Date.UTC(2026, 5, 2, 12, 0), 'Asia/Tokyo');
      const b1 = formatMessageDateTime(Date.UTC(2026, 5, 1, 12, 0), 'Europe/Madrid');
      const b2 = formatMessageDateTime(Date.UTC(2026, 5, 2, 12, 0), 'Europe/Madrid');
      expect(a1).toBeTruthy();
      expect(a2).toBeTruthy();
      expect(b1).toBeTruthy();
      expect(b2).toBeTruthy();
      expect(seenZones).toEqual(['Asia/Tokyo', 'Europe/Madrid']);
    } finally {
      spy.mockRestore();
    }
  });

  it('builds summaries cleanly for legacy messages that have no saved meta field', () => {
    const legacy: UserFeedItem = {
      id: 'fd_old',
      createdAt: Date.UTC(2026, 0, 15, 14, 30),
      workspace: 'designer',
      type: 'user',
      text: 'Legacy prompt',
      mode: 'agent',
      attachments: [],
    };
    const summary = buildMessageMetaSummary(legacy);
    expect(summary.spaceLabel).toBe('Designer');
    expect(summary.dateTime).toContain('2026');
    expect(summary.detailParts).toEqual([]);
    expect(summary.tooltip).toContain('Space: Designer');
  });

  it('renders date, time with timezone, Space tag, and hover/compact metadata on user and agent messages and never cuts across Spaces', () => {
    const sid = resetStore();
    const st = useStore.getState();
    const feed: Array<UserFeedItem | AssistantFeedItem> = [
      {
        id: 'fd_studio_u',
        createdAt: Date.UTC(2026, 5, 1, 15, 0),
        workspace: 'chat',
        type: 'user',
        text: 'From Studio',
        mode: 'agent',
        attachments: [],
        meta: {
          timeZone: 'UTC',
          space: 'studio',
          provider: 'openrouter',
          model: 'anthropic/claude-sonnet-4',
          runId: 'turn_abc',
        },
      },
      {
        id: 'fd_node_a',
        createdAt: Date.UTC(2026, 5, 1, 15, 1),
        workspace: 'node',
        type: 'assistant',
        text: 'Reply from Canvas',
        engine: 'Claude Sonnet 4',
        meta: {
          timeZone: 'UTC',
          agent: 'Director',
          space: 'canvas',
          provider: 'openrouter',
          model: 'anthropic/claude-sonnet-4',
          usage: { inputTokens: 120, outputTokens: 45 },
          costUsd: 0.0012,
          costEstimated: false,
          runId: 'turn_abc',
        },
      },
      {
        id: 'fd_legacy_u',
        createdAt: Date.UTC(2026, 0, 15, 14, 30),
        workspace: 'designer',
        type: 'user',
        text: 'Old Designer message',
        mode: 'agent',
        attachments: [],
      },
    ];
    useStore.setState({
      ui: { ...st.ui, workspace: 'node', threadOpen: true },
      sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], feed } },
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      act(() => {
        root.render(createElement(FeedList, { sessionId: sid }));
      });
      // Continuous thread across Spaces: no filter button and all 3 messages appear in Node view.
      expect(host.querySelector('.feed-everywhere')).toBeNull();
      expect(host.textContent).toContain('From Studio');
      expect(host.textContent).toContain('Reply from Canvas');
      expect(host.textContent).toContain('Old Designer message');

      const badges = [...host.querySelectorAll('.ws-badge')].map((el) => el.textContent);
      expect(badges).toEqual(['Studio', 'Canvas', 'Designer']);

      const times = [...host.querySelectorAll('time.msg-time')];
      expect(times).toHaveLength(3);
      expect(times[0].textContent).toContain('UTC');
      expect(times[1].textContent).toContain('UTC');

      const metas = [...host.querySelectorAll('.msg-meta')];
      expect(metas[0].textContent).not.toContain('Director');
      expect(metas[0].textContent).toContain('claude-sonnet-4 (OpenRouter)');
      expect(metas[0].textContent).toContain('run turn_abc');
      expect(metas[0].getAttribute('data-tip')).toContain('Time:');
      expect(metas[0].getAttribute('data-tip')).toContain('Run: turn_abc');

      expect(metas[1].textContent).toContain('120 in / 45 out');
      expect(metas[1].textContent).toContain('$0.0012');
      expect(metas[1].getAttribute('data-tip')).toContain('Model: anthropic/claude-sonnet-4');

      // Switching to Designer renders the full cross-Space thread in ThreadPeek and DesignerCorner too.
      act(() => {
        useStore.setState((s) => ({ ui: { ...s.ui, workspace: 'designer', threadOpen: true } }));
        useCorner.setState({ open: true, view: 'chat' });
        root.render(
          createElement(
            'div',
            null,
            createElement(ThreadPeek, { workspace: 'designer' }),
            createElement(DesignerCorner, { sessionId: sid }),
          ),
        );
      });
      expect(host.querySelector('.thread-toggle .num')?.textContent).toBe('3');
      const peekBadges = [...host.querySelectorAll('.thread-peek .ws-badge')].map((el) => el.textContent);
      expect(peekBadges).toEqual(['Studio', 'Canvas', 'Designer']);
      const cornerBadges = [...host.querySelectorAll('.designer-corner .ws-badge')].map((el) => el.textContent);
      expect(cornerBadges).toEqual(['Studio', 'Canvas', 'Designer']);
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  });

  it('stores date/time zone, Space, and runId on notices and renders metadata on notice, plan, questions, and settings cards', async () => {
    const sid = resetStore();
    notice(sid, 'designer', 'Direct notice', 'info', undefined, { runId: 'turn_notice_1' });
    const directNotice = useStore.getState().sessions[sid].feed.find((f): f is NoticeFeedItem => f.type === 'notice');
    expect(directNotice?.meta?.timeZone).toBeTruthy();
    expect(directNotice?.meta?.space).toBe('designer');
    expect(directNotice?.meta?.runId).toBe('turn_notice_1');

    // Also verify an error notice emitted during an LLM turn carries the turn's runId.
    mockChat.mockImplementationOnce(async () => ({
      text: '',
      toolCalls: [],
      timing: { ttfbMs: 10, totalMs: 25, reasoningMs: 0, outputMs: 25 },
      finishReason: 'stop',
    }));
    await sendAgentMessage('Empty reply test');
    const feedAfterTurn = useStore.getState().sessions[sid].feed;
    const userItem = feedAfterTurn.find((f): f is UserFeedItem => f.type === 'user');
    const turnNotice = feedAfterTurn.filter((f): f is NoticeFeedItem => f.type === 'notice').at(-1);
    expect(turnNotice?.meta?.timeZone).toBeTruthy();
    expect(turnNotice?.meta?.space).toBe('canvas');
    expect(turnNotice?.meta?.runId).toBe(userItem?.meta?.runId);

    const st = useStore.getState();
    const cards: Array<NoticeFeedItem | QuestionsFeedItem | SettingsFeedItem | PlanFeedItem> = [
      {
        id: 'fd_n1',
        createdAt: Date.UTC(2026, 5, 1, 15, 0),
        workspace: 'chat',
        type: 'notice',
        level: 'error',
        text: 'Notice text',
        meta: { timeZone: 'UTC', space: 'studio', agent: 'Director', provider: 'openrouter', model: 'anthropic/claude-sonnet-4', runId: 'turn_card' },
      },
      {
        id: 'fd_q1',
        createdAt: Date.UTC(2026, 5, 1, 15, 1),
        workspace: 'node',
        type: 'questions',
        round: 1,
        maxRounds: 2,
        status: 'pending',
        questions: [{ id: 'style', question: 'Which style?', options: ['Bold', 'Clean'], allowCustom: true, multi: false }],
        meta: { timeZone: 'UTC', space: 'canvas', agent: 'Director', provider: 'openrouter', model: 'anthropic/claude-sonnet-4', runId: 'turn_card' },
      },
      {
        id: 'fd_s1',
        createdAt: Date.UTC(2026, 5, 1, 15, 2),
        workspace: 'designer',
        type: 'settings',
        status: 'skipped',
        sections: [],
        meta: { timeZone: 'UTC', space: 'designer', agent: 'Director', provider: 'openrouter', model: 'anthropic/claude-sonnet-4', runId: 'turn_card' },
      },
      {
        id: 'fd_p1',
        createdAt: Date.UTC(2026, 5, 1, 15, 3),
        workspace: 'chat',
        type: 'plan',
        style: 'direct',
        status: 'awaiting',
        stepStates: { s1: 'pending' },
        stepGenerations: {},
        estimate: { usd: 0, approximate: false },
        plan: {
          id: 'pln_1',
          title: 'Card meta plan',
          summary: 'Summary',
          workspace: 'chat',
          adjustments: [],
          steps: [{ id: 's1', kind: 'text', title: 'Write copy', text: 'Hello' }],
        },
        meta: { timeZone: 'UTC', space: 'studio', agent: 'Director', provider: 'openrouter', model: 'anthropic/claude-sonnet-4', runId: 'turn_card' },
      },
    ];
    useStore.setState({
      ui: { ...st.ui, workspace: 'chat' },
      sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], feed: cards } },
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      act(() => {
        root.render(createElement(FeedList, { sessionId: sid }));
      });
      const badges = [...host.querySelectorAll('.ws-badge')].map((el) => el.textContent);
      expect(badges).toEqual(['Studio', 'Canvas', 'Designer', 'Studio']);
      const times = [...host.querySelectorAll('time.msg-time')];
      expect(times).toHaveLength(4);
      expect(times.every((t) => t.textContent?.includes('UTC'))).toBe(true);
      const metas = [...host.querySelectorAll('.msg-meta')];
      expect(metas).toHaveLength(4);
      for (const m of metas) {
        expect(m.textContent).toContain('run turn_card');
        expect(m.getAttribute('data-tip')).toContain('Run: turn_card');
      }
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  });
});
