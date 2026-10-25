import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The cost-based automation gate (needsConfirmation) on a real propose_plan call: (Auto) a costly or unknown-cost plan of a confirmed kind is shown for approval, not blocked by a new settings card; a low-cost plan with several candidates is shown without a card.
 * The price is forced through estimateSteps; nothing reaches a provider.
 */
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));
let forcedUsd: number | null | undefined;
vi.mock('../src/engine/executor', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/engine/executor')>();
  return {
    ...real,
    estimateSteps: (steps: Parameters<typeof real.estimateSteps>[0]) => {
      const out = real.estimateSteps(steps);
      return forcedUsd === undefined ? out : { ...out, total: { ...out.total, usd: forcedUsd } };
    },
  };
});

import { confirmSettings, sendAgentMessage } from '../src/engine/agent/runtime';
import { useStore } from '../src/store/store';
import type { PlanFeedItem, SettingsFeedItem } from '../src/engine/types';

type Call = { name: string; args: unknown };
const sse = (call: Call) => {
  const chunk = { choices: [{ delta: { tool_calls: [{ index: 0, id: `c${Math.random()}`, function: { name: call.name, arguments: JSON.stringify(call.args) } }] }, finish_reason: 'tool_calls' }] };
  return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
};
const text = (t: string) => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });

let replies: Array<Call | string> = [];
let sentMessages: string[] = [];
const sid = () => useStore.getState().activeSessionId;
const feedOf = <T extends { type: string }>(type: T['type']) => useStore.getState().sessions[sid()].feed.filter((f) => f.type === type) as unknown as PlanFeedItem[];

beforeEach(() => {
  replies = [];
  sentMessages = [];
  forcedUsd = undefined;
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (!body.messages) return new Response(JSON.stringify({ data: [] }));
    sentMessages.push(JSON.stringify(body.messages));
    const r = replies.shift() ?? 'ok';
    return typeof r === 'string' ? text(r) : sse(r);
  });
  const st = useStore.getState();
  useStore.setState({
    settings: { ...st.settings, keys: { ...st.settings.keys, nanogpt: 'k' }, agent: { ...st.settings.agent, provider: 'nanogpt', model: 'm' } },
    composer: { ...st.composer, agentStyle: 'auto', attachments: [] },
    sessions: {
      ...st.sessions,
      [sid()]: {
        ...st.sessions[sid()],
        feed: [], subjects: [],
        agent: { history: [], questionRound: 0, notes: [], busy: false, settings: { image: { modelRef: 'local::studio-image', needsImage: false } } },
      },
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

const imagePlan = (count: number, model?: string) => ({
  name: 'propose_plan',
  args: { title: 'Propuestas del vestido', steps: [{ id: 's1', kind: 'image', title: 'Propuestas', prompt: 'the dress on a model', count, ...(model ? { model } : {}) }] },
});

describe('propose_plan with a confirmed image kind, decided by the plan cost', () => {
  it('shows a low-cost plan with several candidates without a settings card (expose)', async () => {
    forcedUsd = 0.1;
    replies = [imagePlan(3, 'local::studio-image'), 'Listo.'];
    await sendAgentMessage('Tres propuestas de este vestido');
    const plans = feedOf('plan');
    expect(plans).toHaveLength(1);
    expect(plans[0].status).toBe('awaiting');
    expect((useStore.getState().sessions[sid()].feed.filter((f) => f.type === 'settings') as unknown as SettingsFeedItem[])).toHaveLength(0);
  });

  it('shows a low-cost single image with confirmed settings and no named model (automate)', async () => {
    forcedUsd = 0.1;
    replies = [imagePlan(1), 'Listo.'];
    await sendAgentMessage('Una imagen de este vestido');
    expect(feedOf('plan')).toHaveLength(1);
  });
});

const settingsCards = () => useStore.getState().sessions[sid()].feed.filter((f) => f.type === 'settings');

describe('Auto: the settings card comes once per kind; spending is approved on the plan card', () => {
  it.each([2, null])('a confirmed kind with cost %s shows the plan (awaiting approval) and no settings card', async (usd) => {
    forcedUsd = usd;
    replies = [imagePlan(1), 'Listo.'];
    await sendAgentMessage('Una imagen de este vestido');
    const plans = feedOf('plan');
    expect(plans).toHaveLength(1);
    expect(plans[0].status).toBe('awaiting');
    expect(settingsCards()).toHaveLength(0);
  });
  it('two image requests ask nothing again (1 card in total, here the one confirmed beforehand)', async () => {
    forcedUsd = 2;
    replies = [imagePlan(1), 'Listo.', imagePlan(1), 'Listo.'];
    await sendAgentMessage('Una imagen de este vestido');
    await sendAgentMessage('Otra imagen de este vestido');
    expect(feedOf('plan').length).toBeGreaterThanOrEqual(1);
    expect(settingsCards()).toHaveLength(0);
  });
  it('a kind never confirmed: Auto confirms the video settings itself (no card) and shows the plan that fits them', async () => {
    forcedUsd = 0.1;
    replies = [{ name: 'propose_plan', args: { title: 'Clip', steps: [{ id: 's1', kind: 'video', title: 'Clip', prompt: 'a dress twirling' }] } }, 'Listo.'];
    await sendAgentMessage('Un clip del vestido');
    expect(settingsCards().filter((f) => !(f as unknown as SettingsFeedItem).inline)).toHaveLength(0);
    expect(feedOf('settings').some((f) => (f as unknown as SettingsFeedItem).inline && (f as unknown as SettingsFeedItem).sections.some((x) => x.kind === 'video'))).toBe(true);
    expect(feedOf('plan')).toHaveLength(1);
  });
});

describe('Guided: the settings card comes in every request', () => {
  it('two requests → two cards, even with the kind confirmed before', async () => {
    useStore.setState({ composer: { ...useStore.getState().composer, agentStyle: 'guided' } });
    const ask = { name: 'confirm_settings', args: { parts: [{ kind: 'image', refs: 0 }] } };
    replies = [ask];
    await sendAgentMessage('Una imagen de este vestido');
    const first = settingsCards()[0] as unknown as SettingsFeedItem;
    await confirmSettings(sid(), first.id, [first.sections[0].recommended]);
    replies = [ask];
    await sendAgentMessage('Otra imagen de este vestido');
    expect(settingsCards()).toHaveLength(2);
  });
});
