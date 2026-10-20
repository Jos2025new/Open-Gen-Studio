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

import { cancelPlan, confirmSettings, sendAgentMessage } from '../src/engine/agent/runtime';
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
let script: Array<{ name: string; args: unknown }> = [];
const sse = (call: { name: string; args: unknown }) => new Response(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: `c${Math.random()}`, function: { name: call.name, arguments: JSON.stringify(call.args) } }] }, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });

function setup(style: 'auto' | 'direct' = 'auto') {
  const models = Object.fromEntries([FLUX, GROK, OTHER].map((ref) => [ref, { ref, id: ref.split('::')[1], provider: 'atlas', kind: 'image', name: NAME[ref], acceptsText: true, acceptsImage: false, tags: [] } as ModelSummary]));
  const schemas = Object.fromEntries([FLUX, GROK, OTHER].map((ref) => [ref, { ref, source: 'catalog', params: [], slots: { prompt: 'prompt' } } as ModelSchema]));
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (!body.messages) return new Response(JSON.stringify({ data: [] }));
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

/** Request 1 names Grok and the user clicks Switch; returns once Grok is the switched part (FLUX stays confirmed). */
async function switchToGrok() {
  script = [ask];
  await sendAgentMessage('Prueba ahora con grok image imagine');
  const c = card()!;
  script = [steps(GROK)];
  await confirmSettings(sid(), c.id, [c.sections[0].recommended]);
  expect(st().agent.switchedTo?.image?.modelRef).toBe(GROK);
  newRequest();
}
/** The plan of the previous request is closed, so the next message is a new request (not a comment on that plan). */
function newRequest() { for (const f of st().feed) if (f.type === 'plan' && f.status === 'awaiting') cancelPlan(sid(), f.id); }
const cards = () => st().feed.filter((f) => f.type === 'settings') as SettingsFeedItem[];
const followUp = () => cards().at(-1)!;

describe('the next request after a switch asks which model to continue with (Auto)', () => {
  beforeEach(() => { script = []; seen = []; });

  it('trigger: no model named now -> the plan is refused with the exact fix, then confirm_settings makes the follow-up card', async () => {
    setup();
    await switchToGrok();
    script = [steps(undefined), ask];
    await sendAgentMessage('Hazme otra imagen de una taza');
    expect(seen.join('\n')).toContain(`call confirm_settings for image with model ${GROK} first (the app asks: continue with Grok Imagine Image or go back to FLUX 3 Image Klein)`);
    const c = followUp();
    expect(c).toMatchObject({ status: 'pending', followUp: true });
    expect(c.switchFrom?.modelRef).toBe(FLUX);
    expect(c.sections[0].recommended.modelRef).toBe(GROK);
    expect(c.sections[0].alternatives).not.toContain(GROK);
    expect(c.sections[0].alternatives).not.toContain(FLUX);
    expect(st().agent.settings?.image?.modelRef).toBe(FLUX);
  });

  it('Continue: the switched model becomes the confirmed one, the question is cleared and not asked again', async () => {
    setup();
    await switchToGrok();
    script = [steps(undefined), ask];
    await sendAgentMessage('Hazme otra imagen de una taza');
    const c = followUp();
    script = [steps(undefined)];
    await confirmSettings(sid(), c.id, [c.sections[0].recommended]);
    expect(st().agent.settings?.image?.modelRef).toBe(GROK);
    expect(st().agent.switchedTo?.image).toBeUndefined();
    expect(refs()).toEqual([GROK]);
    newRequest();
    const n = cards().length;
    script = [steps(undefined)];
    await sendAgentMessage('Y otra de una lámpara');
    expect(cards()).toHaveLength(n);
    expect(refs()).toEqual([GROK]);
  });

  it('Back: the confirmed model stays, the switched part is dropped, cleared', async () => {
    setup();
    await switchToGrok();
    script = [steps(undefined), ask];
    await sendAgentMessage('Hazme otra imagen de una taza');
    const c = followUp();
    script = [steps(undefined)];
    await confirmSettings(sid(), c.id, [{ ...c.switchFrom!, needsImage: false }]);
    expect(st().agent.settings?.image?.modelRef).toBe(FLUX);
    expect(st().agent.settingsParts?.map((p) => p.modelRef)).toEqual([FLUX]);
    expect(st().agent.switchedTo?.image).toBeUndefined();
    expect(refs()).toEqual([FLUX]);
  });

  it('another model from the list becomes the confirmed one', async () => {
    setup();
    await switchToGrok();
    script = [steps(undefined), ask];
    await sendAgentMessage('Hazme otra imagen de una taza');
    const c = followUp();
    script = [steps(undefined)];
    await confirmSettings(sid(), c.id, [{ modelRef: OTHER, needsImage: false, count: 2 }]);
    expect(st().agent.settings?.image?.modelRef).toBe(OTHER);
    expect(st().agent.switchedTo?.image).toBeUndefined();
  });

  it('no card without a switch, and none when the current request names a model (the switch card applies instead)', async () => {
    setup();
    script = [steps(undefined)];
    await sendAgentMessage('Una imagen de una taza');
    expect(cards()).toHaveLength(0);
    expect(refs()).toEqual([FLUX]);
    newRequest();
    await switchToGrok();
    script = [steps(GROK), ask];
    await sendAgentMessage('Ahora con grok image imagine otra vez');
    expect(followUp().followUp).toBeUndefined();
    expect(followUp().switchFrom?.modelRef).toBe(FLUX);
  });

  it('Direct never asks', async () => {
    setup('direct');
    useStore.setState({ sessions: { ...useStore.getState().sessions, [sid()]: { ...st(), agent: { ...st().agent, switchedTo: { image: { modelRef: GROK, needsImage: false } } } } } });
    script = [steps(undefined)];
    await sendAgentMessage('Hazme otra imagen de una taza');
    expect(cards()).toHaveLength(0);
    expect(plan()).toBeTruthy();
  });
});
