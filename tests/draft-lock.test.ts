import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Borrador primero on the settings card: plan -> ONE card -> generate. A draft locks the resolution at the app's value;
 * neither the agent's plan nor a forged confirmation can change it; the padlock lifts it and the agent is told as a fact.
 */
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));
vi.mock('../src/engine/jobs', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/engine/jobs')>();
  return { ...real, createGeneration: () => { throw new Error('not executed in this test'); } };
});

import { confirmSettings, selectSettings, sendAgentMessage } from '../src/engine/agent/runtime';
import { selectDraft, unlockDraft } from '../src/engine/agent/draftActions';
import { useStore } from '../src/store/store';
import type { ModelSchema, PlanFeedItem, SettingsFeedItem } from '../src/engine/types';

type Call = { name: string; args: unknown };
const sse = (call: Call) => new Response(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: `c${Math.random()}`, function: { name: call.name, arguments: JSON.stringify(call.args) } }] }, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
let replies: Call[] = [];
const sent: Array<{ messages: Array<{ role: string; content: unknown }> }> = [];
const REF = 'local::studio-video';

beforeEach(() => {
  sent.length = 0;
  vi.stubGlobal('fetch', async (_u: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (!body.messages) return new Response(JSON.stringify({ data: [] }));
    sent.push(body);
    return sse(replies.shift() ?? { name: 'none', args: {} });
  });
  const st = useStore.getState();
  const id = st.activeSessionId;
  const base = st.catalog.schemas[REF] ?? ({ slots: {}, params: [] } as unknown as ModelSchema);
  const schema = { ...base, ref: REF, params: [{ key: 'resolution', label: 'Resolution', role: 'resolution', type: 'enum', options: ['480p', '720p', '1080p'], default: '720p' }] } as unknown as ModelSchema;
  useStore.setState({
    settings: { ...st.settings, keys: { ...st.settings.keys, nanogpt: 'k' }, agent: { ...st.settings.agent, provider: 'nanogpt', model: 'm' } },
    composer: { ...st.composer, agentStyle: 'auto', attachments: [] },
    catalog: { ...st.catalog, schemas: { ...st.catalog.schemas, [REF]: schema } },
    sessions: { ...st.sessions, [id]: { ...st.sessions[id], feed: [], subjects: [], agent: { history: [], questionRound: 0, notes: [], busy: false } } },
  });
});
afterEach(() => vi.unstubAllGlobals());

const sid = () => useStore.getState().activeSessionId;
const feed = () => useStore.getState().sessions[sid()].feed;
const card = () => feed().find((f): f is SettingsFeedItem => f.type === 'settings')!;
const plan = { name: 'propose_plan', args: { title: 'Clip', steps: [{ id: 's1', kind: 'video', title: 'Clip', model: REF, prompt: 'a cat', resolution: '1080p' }] } };

async function openCard() {
  replies = [{ name: 'confirm_settings', args: { parts: [{ kind: 'video', model: REF }] } }];
  await sendAgentMessage('un video de un gato');
}

describe('borrador en la tarjeta de ajustes', () => {
  it('orden: una sola tarjeta (ajustes con la elección) y luego el plan; sin tarjeta aparte', async () => {
    await openCard();
    expect(feed().map((f) => f.type).filter((t) => t !== 'activity')).toEqual(['user', 'settings']);
    expect(card().draft).toMatchObject({ kind: 'draft', locked: true });
    expect(card().sections[0].chosen?.resolution).toBe('480p');
    replies = [plan];
    await confirmSettings(sid(), card().id, card().sections.map((x) => x.chosen ?? x.recommended));
    await vi.waitFor(() => expect(feed().some((f) => f.type === 'plan')).toBe(true));
    expect(feed().map((f) => f.type).filter((t) => t !== 'activity')).toEqual(['user', 'settings', 'plan']);
  });

  it('bloqueado: ni una confirmación forzada ni el plan del agente cambian la resolución', async () => {
    await openCard();
    replies = [plan];
    await confirmSettings(sid(), card().id, [{ ...card().sections[0].recommended, resolution: '1080p' }]);
    expect(useStore.getState().sessions[sid()].agent.settings?.video?.resolution).toBe('480p');
    await vi.waitFor(() => expect(feed().some((f) => f.type === 'plan')).toBe(true));
    const step = (feed().find((f): f is PlanFeedItem => f.type === 'plan')!).plan.steps[0] as { settings: { resolution?: string } };
    expect(step.settings.resolution).toBe('480p');
    expect(String(sent.at(-1)!.messages.at(-1)!.content)).toMatch(/Borrador[\s\S]*480p[\s\S]*locked/);
  });

  it('Alta calidad deja la resolución libre; volver a Borrador la bloquea otra vez', async () => {
    await openCard();
    selectDraft(sid(), card().id, 'hq');
    expect(card().draft?.locked).toBe(false);
    expect(card().sections[0].chosen?.resolution).toBe('720p');
    selectDraft(sid(), card().id, 'draft');
    expect(card().sections[0].chosen?.resolution).toBe('480p');
  });

  it('el candado: el usuario desbloquea, elige 720p y el agente recibe el hecho', async () => {
    await openCard();
    unlockDraft(sid(), card().id);
    expect(card().draft).toMatchObject({ locked: false, unlocked: true });
    selectSettings(sid(), card().id, 0, { ...card().sections[0].recommended, resolution: '720p' });
    replies = [plan];
    await confirmSettings(sid(), card().id, card().sections.map((x) => x.chosen!));
    expect(useStore.getState().sessions[sid()].agent.settings?.video?.resolution).toBe('720p');
    expect(String(sent.at(-1)!.messages.at(-1)!.content)).toMatch(/El usuario desbloqueó la resolución de borrador y eligió 720p[\s\S]*no la cuestiones/);
  });
});
