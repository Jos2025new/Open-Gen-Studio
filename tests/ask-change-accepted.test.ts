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

import { sendAgentMessage } from '../src/engine/agent/runtime';
import { isAcceptance } from '../src/engine/modelNamed';
import { useStore } from '../src/store/store';
import type { ModelSchema, ModelSummary, SettingsFeedItem } from '../src/engine/types';

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
void seen;
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
const ask = (part: Record<string, unknown>) => ({ name: 'confirm_settings', args: { parts: [{ kind: 'image', ...part }] } });
/** The agent offered a change in plain text in an earlier turn. */
const offered = (text: string) => useStore.setState((s) => ({ sessions: { ...s.sessions, [sid()]: { ...st(), agent: { ...st().agent, history: [{ role: 'user', content: '<user_message canvas="chat">\nUna imagen de un faro\n</user_message>' }, { role: 'assistant', content: text }] } } } }));

describe('ADR 0025 D: a change the agent offered in text and the user accepted', () => {
  beforeEach(() => { script = []; seen = []; setup(); });

  it('(a) the agent offered NanoGPT and the user says "sí, cámbialo": the provider-change card', async () => {
    offered('Nano Banana 2 is also on NanoGPT for $0.067 per image. Quieres cambiar?');
    script = [ask({ provider: 'nanogpt' })];
    await sendAgentMessage('sí, cámbialo');
    expect(card()?.switchFrom?.modelRef).toBe(ATLAS);
    expect(card()?.sections[0].recommended.modelRef).toBe(NANO);
  });

  it('(b) "no, sigue así" accepts nothing: no change card', async () => {
    offered('Nano Banana 2 is also on NanoGPT for $0.067 per image. Quieres cambiar?');
    script = [ask({ provider: 'nanogpt' })];
    await sendAgentMessage('no, sigue así');
    expect(card()?.switchFrom).toBeUndefined();
  });

  it('(c) "sí" after a reply that named no provider: no change card', async () => {
    offered('Puedo hacerlo mas barato si quieres.');
    script = [ask({ provider: 'nanogpt' })];
    await sendAgentMessage('sí');
    expect(card()?.switchFrom).toBeUndefined();
  });

  it('(d) a model the agent offered and the user accepts ("dale"): the model-change card', async () => {
    offered('Nano Banana 2 Lite is cheaper here. Quieres que lo use?');
    script = [ask({ model: 'nano banana 2 lite' })];
    await sendAgentMessage('dale');
    expect(card()?.switchFrom?.modelRef).toBe(ATLAS);
    expect(card()?.sections[0].recommended.modelRef).toBe(LITE);
  });

  it('(e) the user naming the provider directly still works', async () => {
    script = [ask({ provider: 'nanogpt' })];
    await sendAgentMessage('Cambia a nanogpt como proveedor');
    expect(card()?.switchFrom?.modelRef).toBe(ATLAS);
  });

  it('an acceptance is short, starts accepting and has no refusal', () => {
    for (const ok of ['sí', 'Si, cámbialo', 'dale', 'vale', 'ok', 'yes', 'sure', 'go ahead', 'do it', 'hazlo']) expect(isAcceptance(ok), ok).toBe(true);
    for (const no of ['no', 'no, sigue así', 'sí pero no', "don't", 'una taza roja', 'sí, pero antes dime cuánto cuesta cada una de las otras', '']) expect(isAcceptance(no), no).toBe(false);
  });
});
