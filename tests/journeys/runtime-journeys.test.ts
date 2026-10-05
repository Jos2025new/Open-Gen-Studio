import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('fetch', async (input: unknown) => { throw new Error(`Blocked request before journey imports: ${String(input)}`); });
});

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { LOCAL_IMAGE_REF } from '../../src/engine/providers/demo';
import { confirmSettings, sendAgentMessage, submitAnswers } from '../../src/engine/agent/runtime';
import { clearJourneyTrace, lastJourneyTrace } from '../../src/lib/journeyTrace';
import { useStore } from '../../src/store/store';
import type { PlanFeedItem, SettingsFeedItem } from '../../src/engine/types';

type Reply = { name?: string; args?: unknown; text?: string };
const sse = (reply: Reply) => {
  const chunk = reply.name
    ? { choices: [{ delta: { tool_calls: [{ index: 0, id: `call-${Math.random()}`, function: { name: reply.name, arguments: JSON.stringify(reply.args ?? {}) } }] }, finish_reason: 'tool_calls' }] }
    : { choices: [{ delta: { content: reply.text ?? 'ok' } }] };
  return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
};

let replies: Reply[] = [];
let requests: Array<{ url: string; body: Record<string, unknown> }> = [];
let sessionId = '';

function setup() {
  clearJourneyTrace();
  replies = [];
  requests = [];
  vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {};
    if (url === 'https://nano-gpt.com/api/v1/chat/completions' && Array.isArray(body.messages)) {
      requests.push({ url, body });
      return sse(replies.shift() ?? { text: 'ok' });
    }
    throw new Error(`Blocked unapproved network request in journey test: ${url}`);
  });
  const st = useStore.getState();
  sessionId = st.activeSessionId;
  useStore.setState({
    settings: { ...st.settings, keys: { ...st.settings.keys, nanogpt: 'test-only' }, agent: { ...st.settings.agent, provider: 'nanogpt', model: 'test-model' } },
    composer: { ...st.composer, agentStyle: 'guided', attachments: [], userPicked: {} },
    sessions: { ...st.sessions, [sessionId]: { ...st.sessions[sessionId], feed: [], agent: { history: [], questionRound: 0, notes: [], busy: false } } },
  });
}

beforeEach(setup);
afterEach(async () => { await (await import('../../src/lib/log')).logSettled(); clearJourneyTrace(); vi.unstubAllGlobals(); });

const planCards = () => useStore.getState().sessions[sessionId].feed.filter((f): f is PlanFeedItem => f.type === 'plan');
const settingsCard = () => useStore.getState().sessions[sessionId].feed.find((f): f is SettingsFeedItem => f.type === 'settings');

describe('runtime request and card decisions', () => {
  it('a question or objection while settings are open does not confirm or approve', async () => {
    replies = [{ name: 'confirm_settings', args: { parts: [{ kind: 'image', model: LOCAL_IMAGE_REF }] } }, { text: 'That was only a question.' }];
    await sendAgentMessage('Create a cat');
    expect(settingsCard()?.status).toBe('pending');
    await sendAgentMessage('Why that model?');
    expect(settingsCard()?.status).toBe('skipped');
    expect(useStore.getState().sessions[sessionId].agent.settings).toBeUndefined();
    expect(lastJourneyTrace().map((e) => e.event)).toContain('settings.reply_received');
    expect(lastJourneyTrace().some((e) => e.event === 'settings.confirmed' || e.event === 'plan.approved')).toBe(false);
    expect(requests.every((r) => r.body.messages)).toBe(true);
  });

  it('a reply to a questions card is recorded separately from settings confirmation', async () => {
    replies = [{ name: 'ask_questions', args: { questions: [{ id: 'subject', question: 'Who is in the clip?', options: ['A', 'B'] }] } }, { text: 'Understood.' }];
    await sendAgentMessage('Create a clip');
    const question = useStore.getState().sessions[sessionId].feed.find((f) => f.type === 'questions');
    expect(question?.type).toBe('questions');
    if (question?.type !== 'questions') return;
    await submitAnswers(sessionId, question.id, { subject: 'A' });
    const answered = lastJourneyTrace().find((e) => e.event === 'questions.answered');
    expect(answered?.after).toMatchObject({ status: 'answered', answeredIds: ['subject'] });
    expect(lastJourneyTrace().some((e) => e.event === 'settings.confirmed')).toBe(false);
  });

  it('presents a simulated revision that already preserves the unrequested step and its settings', async () => {
    const original = { title: 'Two options', steps: [
      { id: 's1', kind: 'image', prompt: 'portrait', model: LOCAL_IMAGE_REF, aspect: '3:2', resolution: '1024x1024', count: 1, seed: 71, params: { quality: 'high' } },
      { id: 's2', kind: 'image', prompt: 'back view', model: LOCAL_IMAGE_REF, aspect: '3:2', resolution: '1024x1024', count: 1, seed: 72, params: { quality: 'high' } },
    ] };
    const revised = { ...original, revision: true, steps: [original.steps[0], { ...original.steps[1], prompt: 'back view, blue jacket' }] };
    replies = [
      { name: 'confirm_settings', args: { parts: [{ kind: 'image', model: LOCAL_IMAGE_REF, count: 1 }] } },
      { name: 'propose_plan', args: original },
      { name: 'propose_plan', args: revised },
    ];
    await sendAgentMessage('Make two images');
    const card = settingsCard();
    expect(card).toBeDefined();
    if (!card) return;
    await confirmSettings(sessionId, card.id, [card.sections[0].recommended]);
    const before = planCards().find((p) => p.status === 'awaiting');
    expect(before).toBeDefined();
    await sendAgentMessage('Change the second jacket to blue');
    const after = planCards().find((p) => p.status === 'awaiting');
    expect(after?.revised).toBe(true);
    expect(after?.plan.steps[0]).toEqual(before?.plan.steps[0]);
    expect(after?.plan.steps[1]).toMatchObject({ prompt: 'back view, blue jacket', modelRef: LOCAL_IMAGE_REF });
    expect(after?.plan.steps[1]).toMatchObject({ settings: (before?.plan.steps[1] as { settings: unknown }).settings });
    expect(lastJourneyTrace().filter((e) => e.event === 'plan.normalized').length).toBe(2);
    expect(lastJourneyTrace().some((e) => e.event === 'plan.comment_received')).toBe(true);
  });

  it('characterization: accepts an unrequested change to step one and includes it in the revised plan for user review', async () => {
    const original = { title: 'Two options', steps: [
      { id: 's1', kind: 'image', prompt: 'portrait', model: LOCAL_IMAGE_REF, aspect: '3:2', resolution: '1024x1024', count: 1, seed: 71, params: { quality: 'high' } },
      { id: 's2', kind: 'image', prompt: 'back view', model: LOCAL_IMAGE_REF, aspect: '3:2', resolution: '1024x1024', count: 1, seed: 72, params: { quality: 'high' } },
    ] };
    const revised = { ...original, revision: true, steps: [
      { ...original.steps[0], prompt: 'portrait, red hat' },
      { ...original.steps[1], prompt: 'back view, blue jacket' },
    ] };
    replies = [
      { name: 'confirm_settings', args: { parts: [{ kind: 'image', model: LOCAL_IMAGE_REF, count: 1 }] } },
      { name: 'propose_plan', args: original },
      { name: 'propose_plan', args: revised },
    ];
    await sendAgentMessage('Make two images');
    const card = settingsCard();
    expect(card).toBeDefined();
    if (!card) return;
    await confirmSettings(sessionId, card.id, [card.sections[0].recommended]);
    const before = planCards().find((p) => p.status === 'awaiting');
    expect(before).toBeDefined();
    await sendAgentMessage('Change only the second jacket to blue');
    const after = planCards().find((p) => p.status === 'awaiting');
    expect(after?.revised).toBe(true);
    expect(after?.plan.steps[0]).toMatchObject({ prompt: 'portrait, red hat' });
    expect(after?.plan.steps[1]).toMatchObject({ prompt: 'back view, blue jacket' });
    expect(after?.status).toBe('awaiting');
    expect(lastJourneyTrace().some((e) => e.event === 'plan.rejected')).toBe(false);
  });
});
