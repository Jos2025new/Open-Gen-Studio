import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * ADR 0025 D: one "ask to change" question for another model OR another provider of the same model. The agent only
 * declares the model (and the provider it was asked for); the app decides the kind of change, resolves the name
 * without false positives and never swaps either one silently.
 */
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { confirmSettings, sendAgentMessage } from '../src/engine/agent/runtime';
import { searchIndex } from '../src/engine/agent/modelIndex';
import { changeNamed, modelChange, providersIn, resolveNamedModel } from '../src/engine/modelNamed';
import { useStore } from '../src/store/store';
import type { ImageStep, ModelSchema, ModelSummary, PlanFeedItem, SettingsFeedItem } from '../src/engine/types';

const ATLAS = 'atlas::google/nano-banana-2/text-to-image';
const NANO = 'nanogpt::nano-banana-2';
const LITE = 'atlas::google/nano-banana-2-lite/text-to-image';
const PRO = 'atlas::google/nano-banana-pro/text-to-image';
const NAME: Record<string, string> = { [ATLAS]: 'Nano Banana 2', [NANO]: 'Nano Banana 2', [LITE]: 'Nano Banana 2 Lite', [PRO]: 'Nano Banana Pro' };
const before = useStore.getState();
const sid = () => before.activeSessionId;
const st = () => useStore.getState().sessions[sid()];
afterEach(() => { vi.unstubAllGlobals(); useStore.setState(before); });

let seen: string[] = [];
let script: Array<{ name: string; args: unknown }> = [];
const sse = (call: { name: string; args: unknown }) => new Response(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: `c${Math.random()}`, function: { name: call.name, arguments: JSON.stringify(call.args) } }] }, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });

function setup() {
  const refs = [ATLAS, NANO, LITE, PRO];
  const models = Object.fromEntries(refs.map((ref) => [ref, { ref, id: ref.split('::')[1], provider: ref.split('::')[0], kind: 'image', name: NAME[ref], acceptsText: true, acceptsImage: ref === NANO, tags: [], price: { skus: [{ unit: 'image', usd: ref === PRO ? 0.13 : 0.067 }] } } as unknown as ModelSummary]));
  const schemas = Object.fromEntries(refs.map((ref) => [ref, { ref, source: 'catalog', params: [], slots: { prompt: 'prompt' } } as ModelSchema]));
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
    composer: { ...s.composer, agentStyle: 'auto', attachments: [], image: { ...s.composer.image, modelRef: ATLAS } },
    catalog: { ...s.catalog, models: { ...s.catalog.models, ...models }, schemas: { ...s.catalog.schemas, ...schemas } },
    sessions: { ...s.sessions, [sid()]: { ...s.sessions[sid()], feed: [], agent: { history: [], questionRound: 0, notes: [], busy: false, settings: { image: { modelRef: ATLAS, needsImage: false, count: 1, aspect: '1:1' } } } } },
  });
}
const card = () => st().feed.find((f) => f.type === 'settings') as SettingsFeedItem | undefined;
const plan = () => st().feed.filter((f) => f.type === 'plan').at(-1) as PlanFeedItem | undefined;
const ask = (part: Record<string, unknown>) => ({ name: 'confirm_settings', args: { parts: [{ kind: 'image', ...part }] } });
const steps = (...m: Array<string | undefined>) => ({ name: 'propose_plan', args: { title: 'P', steps: m.map((model, i) => ({ id: `s${i + 1}`, kind: 'image', title: `I${i}`, prompt: `p${i}`, count: 1, ...(model ? { model } : {}) })) } });
const refs = () => plan()!.plan.steps.map((x) => (x as ImageStep).modelRef);

describe('the same model at another provider is a change the user confirms', () => {
  beforeEach(() => { script = []; seen = []; setup(); });

  it('the plan that writes the other provider\'s model is refused, never swapped for the confirmed Atlas one', async () => {
    script = [steps(NANO)];
    await sendAgentMessage('Cambia a nanogpt como proveedor');
    expect(plan()).toBeUndefined();
    expect(seen.join('\n')).toContain(`call confirm_settings for image with model ${NANO} first.`);
  });

  it('confirm_settings with the model and the provider makes the Keep / Change card', async () => {
    script = [ask({ model: 'nano-banana-2', provider: 'nanogpt' })];
    await sendAgentMessage('Cambia a nanogpt como proveedor');
    const c = card()!;
    expect(c).toMatchObject({ status: 'pending' });
    expect(c.switchFrom?.modelRef).toBe(ATLAS);
    expect(c.sections[0].recommended.modelRef).toBe(NANO);
    expect(modelChange(useStore.getState().catalog.models[NANO], useStore.getState().catalog.models[ATLAS])).toBe('provider');
  });

  it('a provider alone means the confirmed model at that provider', async () => {
    script = [ask({ provider: 'NanoGPT' })];
    await sendAgentMessage('Cambia a nanogpt como proveedor');
    expect(card()?.sections[0].recommended.modelRef).toBe(NANO);
    expect(card()?.switchFrom?.modelRef).toBe(ATLAS);
  });

  it('Change adds the other provider as a part; steps that write it keep it, the rest keep the confirmed one', async () => {
    script = [ask({ model: 'nano-banana-2', provider: 'nanogpt' })];
    await sendAgentMessage('Cambia a nanogpt como proveedor');
    const c = card()!;
    script = [steps(NANO, undefined)];
    await confirmSettings(sid(), c.id, [c.sections[0].recommended]);
    expect(st().agent.settings?.image?.modelRef).toBe(ATLAS);
    expect(st().agent.settingsParts?.map((p) => p.modelRef)).toEqual([NANO, ATLAS]);
    expect(refs()).toEqual([NANO, ATLAS]);
    // The agent is told which is which even though both are called Nano Banana 2.
    expect(JSON.stringify(st().agent.history)).toContain(`steps whose \\"model\\" is ${NANO} use it`);
  });

  it('a provider the user never named is not a change: the app\'s own default stays an ordinary confirmation', async () => {
    script = [ask({ model: NANO })];
    await sendAgentMessage('Otra imagen con nano banana 2');
    expect(card()?.switchFrom).toBeUndefined();
    script = [steps(NANO)];
    useStore.setState((s) => ({ sessions: { ...s.sessions, [sid()]: { ...st(), feed: [] } } }));
    await sendAgentMessage('Otra imagen con nano banana 2');
    expect(plan()).toBeDefined();
  });
});

describe('a model written with a typo resolves; one that does not exist goes back to the agent', () => {
  beforeEach(() => { script = []; seen = []; setup(); });

  it('"NANO BANAN 2 LITE" is Nano Banana 2 Lite and asks to change the model', async () => {
    script = [ask({ model: 'NANO BANAN 2 LITE' })];
    await sendAgentMessage('Usa NANO BANAN 2 LITE');
    expect(card()?.sections[0].recommended.modelRef).toBe(LITE);
    expect(card()?.switchFrom?.modelRef).toBe(ATLAS);
  });

  it('the validator uses the same resolution: the misspelt name of the step is still refused until confirmed', async () => {
    script = [steps('NANO BANAN 2 LITE')];
    await sendAgentMessage('Usa NANO BANAN 2 LITE');
    expect(plan()).toBeUndefined();
    expect(seen.join('\n')).toContain(`The user named Nano Banana 2 Lite (${LITE}); call confirm_settings for image with model ${LITE} first.`);
  });

  it('a model that does not exist is returned with the reason and the closest one', async () => {
    script = [ask({ model: 'Zorblax Quantum 9000' })];
    await sendAgentMessage('Usa Zorblax Quantum 9000');
    expect(card()).toBeUndefined();
    expect(seen.join('\n')).toMatch(/Unknown model "Zorblax Quantum 9000"/);
  });

  it('a model that is not at the declared provider says so and names the closest', async () => {
    script = [ask({ model: 'nano banana 2 lite', provider: 'nanogpt' })];
    await sendAgentMessage('Usa nano banana 2 lite en nanogpt');
    expect(card()).toBeUndefined();
    expect(seen.join('\n')).toMatch(/Unknown model "nano banana 2 lite" at NanoGPT\. The closest is Nano Banana 2 Lite \(atlas::google\/nano-banana-2-lite\/text-to-image\)/);
  });
});

describe('name resolution without false positives', () => {
  beforeEach(() => setup());

  it('an exact ref wins; the same line is looked for at the wanted provider only', () => {
    expect(resolveNamedModel(NANO, 'image', false)).toEqual({ ref: NANO });
    expect(resolveNamedModel(ATLAS, 'image', false, 'NanoGPT')).toEqual({ ref: NANO });
    expect(resolveNamedModel('Nano Banana 2', 'image', false, 'atlas')).toEqual({ ref: ATLAS });
  });

  it('a clear winner resolves: the exact words beat the longer family member', () => {
    expect(resolveNamedModel('nano banana 2', 'image', false, 'atlas')).toEqual({ ref: ATLAS });
    expect(resolveNamedModel('nano banana pro', 'image', false)).toEqual({ ref: PRO });
  });

  it('an unknown provider is an error, not a guess', () => {
    expect(resolveNamedModel('nano banana 2', 'image', false, 'midjourney')).toMatchObject({ error: expect.stringContaining('Unknown provider') });
  });

  it('searchIndex tolerates a missing or wrong letter in words of 5+ letters, never in numbers or short words', () => {
    const all = Object.values(useStore.getState().catalog.models);
    expect(searchIndex(all, 'nano banan 2 lite', { kind: 'image' })[0].ref).toBe(LITE);
    expect(searchIndex(all, 'nano bananna pro', { kind: 'image' })[0].ref).toBe(PRO);
    expect(searchIndex(all, 'zorblax', { kind: 'image' })).toEqual([]);
    expect(searchIndex(all, 'nano banana 3', { kind: 'image', strict: true })).toEqual([]);
    expect(searchIndex(all, 'nano banana pr', { kind: 'image', strict: true })).toEqual([]);
    expect(searchIndex(all, 'nano banan 2', { kind: 'image', strict: true }).map((m) => m.ref)).toContain(ATLAS);
  });

  it('the providers a text names, and what counts as a change', () => {
    expect(providersIn('Cambia a nanogpt como proveedor')).toEqual(['nanogpt']);
    expect(providersIn('hazlo en Atlas Cloud, no en fal')).toEqual(['fal', 'atlas']);
    expect(providersIn('Una imagen fallida de un faro')).toEqual([]);
    const m = useStore.getState().catalog.models;
    expect(changeNamed(m[NANO], m[ATLAS], 'Cambia a nanogpt como proveedor')).toBe('provider');
    expect(changeNamed(m[NANO], m[ATLAS], 'Otra imagen con nano banana 2')).toBeUndefined();
    expect(changeNamed(m[LITE], m[ATLAS], 'Usa nano banana 2 lite')).toBe('model');
    expect(changeNamed(m[LITE], m[ATLAS], 'Una taza')).toBeUndefined();
  });
});
