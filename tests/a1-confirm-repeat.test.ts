import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * A1: after the first confirmation (Auto), a confirm_settings call that repeats the confirmed model line is answered by
 * the app itself and puts no card. A real change of model or provider, or a user asking for one, still gets the card.
 */
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { sendAgentMessage } from '../src/engine/agent/runtime';
import { useStore } from '../src/store/store';
import type { ModelSchema, ModelSummary, SettingsFeedItem } from '../src/engine/types';

const ATLAS = 'atlas::google/nano-banana-2/text-to-image';
const NANO = 'nanogpt::nano-banana-2';
const LITE = 'atlas::google/nano-banana-2-lite/text-to-image';
const NAME: Record<string, string> = { [ATLAS]: 'Nano Banana 2', [NANO]: 'Nano Banana 2', [LITE]: 'Nano Banana 2 Lite' };
const before = useStore.getState();
const sid = () => before.activeSessionId;
const st = () => useStore.getState().sessions[sid()];
afterEach(() => { vi.unstubAllGlobals(); useStore.setState(before); });

let seen: string[] = [];
let script: Array<{ name: string; args: unknown }> = [];
const sse = (call: { name: string; args: unknown }) => new Response(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: `c${Math.random()}`, function: { name: call.name, arguments: JSON.stringify(call.args) } }] }, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });

function setup(style: 'auto' | 'guided' = 'auto') {
  const refs = [ATLAS, NANO, LITE];
  const models = Object.fromEntries(refs.map((ref) => [ref, { ref, id: ref.split('::')[1], provider: ref.split('::')[0], kind: 'image', name: NAME[ref], acceptsText: true, acceptsImage: ref === NANO, tags: [], price: { skus: [{ unit: 'image', usd: 0.067 }] } } as unknown as ModelSummary]));
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
    composer: { ...s.composer, agentStyle: style, attachments: [], image: { ...s.composer.image, modelRef: ATLAS } },
    catalog: { ...s.catalog, models: { ...s.catalog.models, ...models }, schemas: { ...s.catalog.schemas, ...schemas } },
    sessions: { ...s.sessions, [sid()]: { ...s.sessions[sid()], feed: [], agent: { history: [], questionRound: 0, notes: [], busy: false, settings: { image: { modelRef: ATLAS, resolution: '1K', needsImage: false, count: 1, aspect: '3:4' } } } } },
  });
}
const cards = () => st().feed.filter((f) => f.type === 'settings') as SettingsFeedItem[];
const ask = (part: Record<string, unknown>) => ({ name: 'confirm_settings', args: { parts: [{ kind: 'image', ...part }] } });
const plan = { name: 'propose_plan', args: { title: 'P', steps: [{ id: 's1', kind: 'image', title: 'I', prompt: 'p', count: 1 }] } };

describe('A1: confirm_settings repeated after the first confirmation', () => {
  beforeEach(() => { script = []; seen = []; setup(); });

  it('same model line, Auto: no new card, the tool is answered and the agent goes on to the plan', async () => {
    script = [ask({ model: ATLAS }), plan];
    await sendAgentMessage('Haz a la presentadora más blanca');
    expect(cards()).toHaveLength(0);
    expect(seen.join('\n')).toContain('Nano Banana 2');
    expect(seen.join('\n')).toContain('propose_plan');
    expect(st().feed.some((f) => f.type === 'plan')).toBe(true);
  });

  it('only the aspect or the count differs: still no card', async () => {
    script = [ask({ model: ATLAS, aspect: '16:9', count: 3 }), plan];
    await sendAgentMessage('Haz a la presentadora más blanca');
    expect(cards()).toHaveLength(0);
  });

  it('a different model line still gets the card', async () => {
    script = [ask({ model: LITE })];
    await sendAgentMessage('Haz a la presentadora más blanca');
    expect(cards()).toHaveLength(1);
  });

  it('the user asks to change the model: the card appears', async () => {
    script = [ask({ model: ATLAS })];
    await sendAgentMessage('Cambia el modelo y haz a la presentadora más blanca');
    expect(cards()).toHaveLength(1);
  });

  it('the user asks for another resolution: the card appears', async () => {
    script = [ask({ model: ATLAS })];
    await sendAgentMessage('Hazlo en resolución 2K');
    expect(cards()).toHaveLength(1);
  });

  it('Guided keeps asking every request', async () => {
    setup('guided');
    script = [ask({ model: ATLAS })];
    await sendAgentMessage('Haz a la presentadora más blanca');
    expect(cards()).toHaveLength(1);
  });

  it('a model the user picked in the composer is never reported as the confirmed one', async () => {
    useStore.setState((s) => ({ composer: { ...s.composer, image: { ...s.composer.image, modelRef: LITE }, userPicked: { ...(s.composer.userPicked ?? {}), image: true } } }));
    script = [ask({ model: ATLAS })];
    await sendAgentMessage('Haz a la presentadora más blanca');
    expect(cards()).toHaveLength(1);
  });
});
