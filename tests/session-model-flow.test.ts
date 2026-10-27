import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));

import { sendAgentMessage } from '../src/engine/agent/runtime';
import { changePlanChoice, setPromptWriter } from '../src/engine/agent/planSettings';
import { newSession, useStore } from '../src/store/store';
import type { ImageStep, ModelSchema, ModelSummary, PlanFeedItem, SettingsFeedItem } from '../src/engine/types';

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
const proposal = (models: Array<string | undefined>, requested = false) => ({ name: 'propose_plan', args: { title: 'Prueba', steps: models.map((model, i) => ({ id: `s${i + 1}`, kind: 'image', title: `Imagen ${i + 1}`, prompt: 'a lighthouse', count: 1, ...(model ? { model, user_requested: requested } : {}) })) } });
const confirmModels = (models: string[]) => ({ name: 'confirm_settings', args: { parts: models.map((model) => ({ kind: 'image', model: names[model], user_requested: true, count: 1 })) } });
const plans = () => session().feed.filter((item): item is PlanFeedItem => item.type === 'plan');
const settings = () => session().feed.filter((item): item is SettingsFeedItem => item.type === 'settings');
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

describe('selected model belongs to the session flow', () => {
  it('changes Y to Z on the plan, keeps Z, accepts C, compares four models in one plan, and uses the composer in a new session', async () => {
    replies = [proposal([undefined])];
    await sendAgentMessage('Haz una imagen de un faro');
    const first = plans().at(-1)!;
    expect(refs(first)).toEqual([Y]);
    expect(first.status).toBe('awaiting');
    expect(first.estimate.usd).toBe(0.6);
    setPromptWriter(sid(), first.id, false);
    await changePlanChoice(sid(), first.id, 'image', { modelRef: Z, aspect: '1:1', count: 1, needsImage: false });
    expect(refs(plans().at(-1)!)).toEqual([Z]);

    replies = [proposal([undefined])];
    await sendAgentMessage('Ahora otra imagen del faro');
    expect(refs(plans().at(-1)!)).toEqual([Z]);

    replies = [proposal([C], true), confirmModels([C]), proposal([C], true)];
    await sendAgentMessage('Cambia a Seedream 5.0 Pro');
    expect(refs(plans().at(-1)!)).toEqual([C]);

    const priorPlans = plans().length;
    const priorSettings = settings().length;
    const compared = [Z, Z, A, A, C, C, T, T];
    replies = [proposal(compared, true), confirmModels([Z, A, C, T]), proposal(compared, true)];
    await sendAgentMessage('Compara FLUX, Grok Imagine, Seedream y Nano Banana Pro; haz dos imágenes con cada modelo');
    const comparison = plans().at(-1)!;
    expect(plans()).toHaveLength(priorPlans + 1);
    expect(settings()).toHaveLength(priorSettings + 1);
    expect(settings().at(-1)?.status).toBe('confirmed');
    expect(refs(comparison)).toEqual([Z, Z, A, A, C, C, T, T]);

    replies = [proposal([undefined]), proposal([undefined])];
    await sendAgentMessage('Otra imagen sin cambiar el modelo');
    expect(refs(plans().at(-1)!)).toEqual([C]);

    newSession();
    replies = [proposal([undefined])];
    await sendAgentMessage('Una imagen nueva de un faro');
    expect(refs(plans().at(-1)!)).toEqual([Y]);
  });
});

it('keeps Seedream and FLUX.3 separate despite the user writing flux 2 fhas', async () => {
  useStore.setState((s) => ({ catalog: { ...s.catalog,
    models: { ...s.catalog.models, [Z]: { ...s.catalog.models[Z], name: 'FLUX.3 Image Klein', acceptsImage: true } },
    schemas: { ...s.catalog.schemas, [Z]: { ...s.catalog.schemas[Z], slots: { prompt: 'prompt', images: { key: 'images', min: 0, max: 1, multiple: true, format: 'url' as const } } } },
  } }));
  replies = [
    { name: 'confirm_settings', args: { parts: [
      { kind: 'image', model: C, user_requested: true },
      { kind: 'image', model: Z, user_requested: true, refs: 1 },
    ] } },
    { name: 'propose_plan', args: { title: 'Seedream and FLUX', continuity: [{ source: 's1', preserve: 'lighthouse identity', steps: ['s2'] }], steps: [
      { id: 's1', kind: 'image', model: C, user_requested: true, prompt: 'a lighthouse', count: 1 },
      { id: 's2', kind: 'image', model: Z, user_requested: true, prompt: 'a lighthouse', refs: ['s1'], count: 1 },
    ] } },
  ];
  await sendAgentMessage('Una imagen con Seedream 5 Pro y otra con flux 2 fhas usando la primera como referencia');
  const plan = plans().at(-1)!;
  expect(plan?.status).toBe('awaiting');
  expect(refs(plan)).toEqual([C, Z]);
  expect((plan.plan.steps[1] as ImageStep).refs).toHaveLength(1);
  expect(session().agent.settings?.image?.modelRef).toBe(Y);
  expect(useStore.getState().composer.image.modelRef).toBe(Y);
});
