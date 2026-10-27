import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));

import { sendAgentMessage } from '../src/engine/agent/runtime';
import { useStore } from '../src/store/store';
import type { ImageStep, ModelSchema, ModelSummary, PlanFeedItem } from '../src/engine/types';

const Y = 'atlas::google/nano-banana-2/text-to-image';
const Z = 'atlas::bfl/flux-3-klein/text-to-image';
const A = 'atlas::xai/grok-imagine-image/text-to-image';
const C = 'atlas::bytedance/seedream-v5.0-pro/text-to-image';
const T = 'atlas::google/nano-banana-pro/text-to-image';
const names: Record<string, string> = { [Y]: 'Nano Banana 2', [Z]: 'FLUX 3 Image Klein', [A]: 'Grok Imagine Image', [C]: 'Seedream 5.0 Pro', [T]: 'Nano Banana Pro' };
const initial = useStore.getState();
let replies: Array<{ name: string; args: unknown } | string> = [];
let requestCount = 0;
const sid = () => useStore.getState().activeSessionId;
const session = () => useStore.getState().sessions[sid()];
const sse = (reply: { name: string; args: unknown } | string) => {
  const delta = typeof reply === 'string' ? { content: reply } : { tool_calls: [{ index: 0, id: `call-${requestCount}`, function: { name: reply.name, arguments: JSON.stringify(reply.args) } }] };
  return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: typeof reply === 'string' ? 'stop' : 'tool_calls' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
};
const plans = () => session().feed.filter((item): item is PlanFeedItem => item.type === 'plan');
const refs = (plan: PlanFeedItem) => plan.plan.steps.map((step) => (step as ImageStep).modelRef);

beforeEach(() => {
  replies = [];
  requestCount = 0;
  const models = Object.fromEntries([Y, Z, A, C, T].map((ref) => [ref, { ref, id: ref.split('::')[1], provider: 'atlas', kind: 'image', name: names[ref], acceptsText: true, acceptsImage: false, tags: [], price: { skus: [{ unit: 'output', usd: 0.6 }] } } as unknown as ModelSummary]));
  const schemas = Object.fromEntries([Y, Z, A, C, T].map((ref) => [ref, { ref, source: 'catalog', params: [], slots: { prompt: 'prompt' } } as ModelSchema]));
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (!body.messages) return new Response(JSON.stringify({ data: [] }));
    requestCount++;
    return sse(replies.shift() ?? 'Listo.');
  });
  useStore.setState({
    settings: { ...initial.settings, keys: { ...initial.settings.keys, nanogpt: 'fixture', atlas: 'fixture' }, agent: { ...initial.settings.agent, provider: 'nanogpt', model: 'fixture' } },
    composer: { ...initial.composer, agentStyle: 'auto', attachments: [], image: { ...initial.composer.image, modelRef: Y } },
    catalog: { ...initial.catalog, models: { ...initial.catalog.models, ...models }, schemas: { ...initial.catalog.schemas, ...schemas } },
    sessions: { ...initial.sessions, [initial.activeSessionId]: { ...initial.sessions[initial.activeSessionId], feed: [], agent: { history: [], questionRound: 0, notes: [], busy: false, settings: { image: { modelRef: Y, needsImage: false, count: 1, aspect: '1:1' } } } } },
  });
});
afterEach(() => { vi.unstubAllGlobals(); useStore.setState(initial); });


const flux = (userRequested?: boolean) => ({ name: 'propose_plan', args: { title: 'Casa', steps: [1, 2].map((i) => ({ id: `s${i}`, kind: 'image', prompt: 'a house', count: 1, model: names[Z], ...(userRequested === undefined ? {} : { user_requested: userRequested }) })) } });
const answered = (text: string) => ({ id: 'q1', type: 'questions' as const, status: 'answered' as const, workspace: 'chat', questions: [{ id: 'm', question: '¿Qué modelo uso?', options: [] }], answers: { m: text } });

describe('a model without user_requested is inferred by the app, never bounced', () => {
  it('the user answered with the model: the plan is accepted and uses it as their choice', async () => {
    replies = ['¿Qué modelo uso?'];
    await sendAgentMessage('Haz una casa');
    useStore.setState((s) => ({ sessions: { ...s.sessions, [sid()]: { ...session(), feed: [...session().feed, answered('FLUX 3 Image Klein (más barato)') as never] } } }));
    replies = [flux()];
    await sendAgentMessage('Haz una casa con FLUX 3 Image Klein (más barato)');
    expect(plans().at(-1)?.status).toBe('awaiting');
    expect(refs(plans().at(-1)!)).toEqual([Z, Z]);
    expect(requestCount).toBeLessThan(4);
  });
  it('a model the user never named stays a recommendation', async () => {
    replies = [flux()];
    await sendAgentMessage('Haz una casa');
    expect(plans().at(-1)?.status).toBe('awaiting');
    expect(refs(plans().at(-1)!)).toEqual([Y, Y]);
  });
  it('an explicit user_requested is honoured', async () => {
    replies = [flux(true)];
    await sendAgentMessage('Haz una casa');
    expect(refs(plans().at(-1)!)).toEqual([Z, Z]);
  });
});
