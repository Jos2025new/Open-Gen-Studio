import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * DELICATE (docs/features/agente.md, "Cambio de modelo"). A model the user names in the current request replaces the
 * confirmed one only through a one-question card; the steps that write it keep it, the others keep the confirmed model.
 */
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { confirmSettings, sendAgentMessage } from '../src/engine/agent/runtime';
import { useStore } from '../src/store/store';
import type { ImageStep, ModelSchema, ModelSummary, PlanFeedItem, SettingsFeedItem } from '../src/engine/types';

const FLUX = 'atlas::bfl/flux-3-klein/text-to-image';
const GROK = 'atlas::xai/grok-imagine-image/text-to-image';
const OTHER = 'atlas::google/nano-banana-2/text-to-image';
const NAME: Record<string, string> = { [FLUX]: 'FLUX 3 Image Klein', [GROK]: 'Grok Imagine Image', [OTHER]: 'Nano Banana 2' };
const before = useStore.getState();
const sid = () => before.activeSessionId;
const st = () => useStore.getState().sessions[sid()];
afterEach(() => { vi.unstubAllGlobals(); useStore.setState(before); });

let seen: string[] = [];
void seen;
let script: Array<{ name: string; args: unknown }> = [];
const sse = (call: { name: string; args: unknown }) => new Response(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: `c${Math.random()}`, function: { name: call.name, arguments: JSON.stringify(call.args) } }] }, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });

/** Guided clears the confirmed settings on every fresh request and refuses a plan before its question round: restore both once the agent is called. */
let primed = false;
function prime() {
  if (primed || useStore.getState().composer.agentStyle !== 'guided') return;
  primed = true;
  useStore.setState((s) => ({ sessions: { ...s.sessions, [sid()]: { ...s.sessions[sid()], agent: { ...s.sessions[sid()].agent, questionRound: 1, settings: { image: { modelRef: FLUX, needsImage: false, count: 2, aspect: '1:1' } } } } } }));
}

function setup(style: 'guided' | 'direct' = 'guided') {
  primed = false;
  const models = Object.fromEntries([FLUX, GROK, OTHER].map((ref) => [ref, { ref, id: ref.split('::')[1], provider: 'atlas', kind: 'image', name: NAME[ref], acceptsText: true, acceptsImage: false, tags: [], price: { skus: [{ unit: 'image', usd: 0.01 }] } } as unknown as ModelSummary]));
  const schemas = Object.fromEntries([FLUX, GROK, OTHER].map((ref) => [ref, { ref, source: 'catalog', params: [], slots: { prompt: 'prompt' } } as ModelSchema]));
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (!body.messages) return new Response(JSON.stringify({ data: [] }));
    prime();
    seen = body.messages.filter((m: { role: string }) => m.role === 'tool').map((m: { content: unknown }) => String(m.content));
    const next = script.shift();
    return next ? sse(next) : new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  });
  const s = useStore.getState();
  useStore.setState({
    settings: { ...s.settings, keys: { ...s.settings.keys, nanogpt: 'k', atlas: 'k' }, agent: { ...s.settings.agent, provider: 'nanogpt', model: 'm' } },
    composer: { ...s.composer, agentStyle: style, attachments: [], image: { ...s.composer.image, modelRef: FLUX } },
    catalog: { ...s.catalog, models: { ...s.catalog.models, ...models }, schemas: { ...s.catalog.schemas, ...schemas } },
    sessions: { ...s.sessions, [sid()]: { ...s.sessions[sid()], feed: [], agent: { history: [], questionRound: 0, notes: [], busy: false, settings: { image: { modelRef: FLUX, needsImage: false, count: 2, aspect: '1:1' } } } } },
  });
}
const card = () => st().feed.find((f) => f.type === 'settings') as SettingsFeedItem | undefined;
const plan = () => st().feed.filter((f) => f.type === 'plan').at(-1) as PlanFeedItem | undefined;
const ask = { name: 'confirm_settings', args: { parts: [{ kind: 'image', model: GROK }] } };
const steps = (...m: Array<string | undefined>) => ({ name: 'propose_plan', args: { title: 'P', steps: m.map((model, i) => ({ id: `s${i + 1}`, kind: 'image', title: `I${i}`, prompt: `p${i}`, count: 1, ...(model ? { model } : {}) })) } });
const refs = () => plan()!.plan.steps.map((x) => (x as ImageStep).modelRef);

describe('model switch: refusal, card, confirmation', () => {
  beforeEach(() => { script = []; });

  it('the plan is refused with the exact fix when the user named another model', async () => {
    setup();
    script = [steps(GROK)];
    const tools: string[] = [];
    vi.stubGlobal('fetch', async (_u: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (!body.messages) return new Response(JSON.stringify({ data: [] }));
      prime();
      tools.push(...body.messages.filter((m: { role: string }) => m.role === 'tool').map((m: { content: unknown }) => String(m.content)));
      const next = script.shift();
      return next ? sse(next) : new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
    });
    await sendAgentMessage('Prueba ahora con grok image imagine');
    expect(plan()).toBeUndefined();
    expect(tools.join('\n')).toContain(`The user named Grok Imagine Image (${GROK}); call confirm_settings for image with model ${GROK} first.`);
  });

  it('confirm_settings becomes the compact switch card; Switch adds Grok as a part and keeps FLUX as the confirmed model', async () => {
    setup();
    script = [ask];
    await sendAgentMessage('Prueba ahora con grok image imagine');
    const c = card()!;
    expect(c.status).toBe('pending');
    expect(c.switchFrom?.modelRef).toBe(FLUX);
    expect(c.sections).toHaveLength(1);
    expect(c.sections[0].recommended).toMatchObject({ modelRef: GROK, count: 2 });
    script = [steps(GROK, undefined)];
    await confirmSettings(sid(), c.id, [c.sections[0].recommended]);
    expect(st().agent.settings?.image?.modelRef).toBe(FLUX);
    expect(st().agent.settingsParts?.map((p) => p.modelRef)).toEqual([GROK, FLUX]);
    expect(refs()).toEqual([GROK, FLUX]);
  });

  it('named in general: every step that writes Grok keeps it', async () => {
    setup();
    script = [ask];
    await sendAgentMessage('Prueba ahora con grok image imagine');
    const c = card()!;
    script = [steps(GROK, GROK, GROK)];
    await confirmSettings(sid(), c.id, [c.sections[0].recommended]);
    expect(refs()).toEqual([GROK, GROK, GROK]);
  });

  it('Keep answers with the confirmed model: an ordinary confirmation, no extra part', async () => {
    setup();
    script = [ask];
    await sendAgentMessage('Prueba ahora con grok image imagine');
    const c = card()!;
    script = [steps(FLUX)];
    await confirmSettings(sid(), c.id, [{ ...c.switchFrom!, needsImage: false }]);
    expect(st().agent.settingsParts?.map((p) => p.modelRef)).toEqual([FLUX]);
    expect(refs()).toEqual([FLUX]);
  });

  it('no model named: the plan with Grok gets the confirmed model and no card is made', async () => {
    setup();
    script = [steps(GROK)];
    await sendAgentMessage('Una imagen de una taza');
    expect(card()).toBeUndefined();
    expect(refs()).toEqual([FLUX]);
  });

  it('repeat case: Grok named three requests ago, current request names none: FLUX, no card', async () => {
    setup();
    script = [{ name: 'propose_plan', args: { title: 'old', steps: [] } }];
    useStore.setState({ sessions: { ...useStore.getState().sessions, [sid()]: { ...st(), feed: [{ id: 'u0', createdAt: 0, workspace: 'chat', type: 'user', text: 'prueba con grok image imagine', attachments: [] } as never] } } });
    script = [steps(GROK)];
    await sendAgentMessage('Hazme otra con la misma luz');
    expect(card()).toBeUndefined();
    expect(refs()).toEqual([FLUX]);
  });
});

const cards = () => st().feed.filter((f) => f.type === 'settings') as SettingsFeedItem[];

describe('Direct never asks about a switch', () => {
  it('Direct never asks', async () => {
    setup('direct');
    useStore.setState({ sessions: { ...useStore.getState().sessions, [sid()]: { ...st(), agent: { ...st().agent, switchedTo: { image: { modelRef: GROK, needsImage: false } } } } } });
    script = [steps(undefined)];
    await sendAgentMessage('Hazme otra imagen de una taza');
    expect(cards()).toHaveLength(0);
    expect(plan()).toBeTruthy();
  });
});
