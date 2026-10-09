import { describe, expect, it, vi } from 'vitest';

/*
 * The agent and FX (ADR 0011): in the Designer it changes FX layers directly with designer_fx (the panel's commands,
 * one undo step); elsewhere "blanco y negro" on an attached image fires the free fx operation. Stubbed fetch.
 */
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));
import { readFileSync } from 'node:fs';
import { gateOps } from '../src/engine/agent/force';
import { sendAgentMessage } from '../src/engine/agent/runtime';
import { CAPABILITIES, TOOLS } from '../src/engine/agent/tools';
import { addDoc, activeDoc } from '../src/engine/design/actions';
import { createDoc, newVectorLayer } from '../src/engine/design/doc';
import { historyDepth } from '../src/engine/design/history';
import { fxOpFromParams } from '../src/engine/fx/op';
import { useStore } from '../src/store/store';
import type { Workspace } from '../src/engine/types';
import type { FxLayer } from '../src/engine/fx/types';

const image = { id: 'img1', kind: 'image', name: 'img1', createdAt: 0, width: 800, height: 600 };
useStore.setState({ assets: { ...useStore.getState().assets, img1: image } as never });
const fired = (text: string) => gateOps(text, [image as never], false).filter((g) => g.fired).map((g) => [g.op, g.params]);

describe('the fx operation (assets and nodes)', () => {
  it('fires on an attached image with the filter or effect the request names', () => {
    expect(fired('Pon esta foto en blanco y negro')).toEqual([['fx', { effect: 'grayscale' }]]);
    expect(fired('desenfoca el fondo de la imagen')).toEqual([['fx', { effect: 'blur' }]]);
    expect(fired('add a lens flare')).toEqual([['fx', { effect: 'flare' }]]);
    expect(gateOps('aplica un filtro', [image as never], false).find((g) => g.op === 'fx')).toMatchObject({ fired: false, note: expect.stringMatching(/which filter or effect/) });
    // A new image that only uses the photo as a reference is not a filter on it.
    expect(fired('genera una imagen nueva con un halo de luz usando esta foto como referencia')).toEqual([]);
  });
  it('reads its main value as amount and any other value by name, clamped by the registry', () => {
    expect(fxOpFromParams({ effect: 'glow', amount: '1.4', radius: '30' }).params).toEqual({ strength: 1.4, radius: 30 });
    expect(fxOpFromParams({ effect: 'blur', amount: '' }).params).toEqual({ radius: 4 });
    expect(fxOpFromParams({ effect: 'nope', amount: '9' })).toMatchObject({ kind: 'brightness', params: { amount: 3 } });
  });
});

/** One request end to end; `reply` are the agent's tool calls, in order. */
async function request(workspace: Workspace, text: string, attachments: string[], reply: Array<{ name: string; args: unknown }>) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (!body.messages) return new Response(JSON.stringify({ data: [] }));
    calls.push(JSON.stringify(body.messages));
    const call = reply.shift();
    const delta = call ? { tool_calls: [{ index: 0, id: `c${calls.length}`, function: { name: call.name, arguments: JSON.stringify(call.args) } }] } : { content: 'Listo.' };
    return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: call ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  });
  const st = useStore.getState(), sid = st.activeSessionId;
  useStore.setState({
    ui: { ...st.ui, workspace },
    settings: { ...st.settings, keys: { ...st.settings.keys, nanogpt: 'k' }, agent: { ...st.settings.agent, provider: 'nanogpt', model: 'm' } },
    composer: { ...st.composer, agentStyle: 'auto', attachments },
    sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], feed: [], subjects: [], agent: { history: [], questionRound: 0, notes: [], busy: false } } },
  });
  await sendAgentMessage(text);
  vi.unstubAllGlobals();
  return calls;
}

describe('in the Designer: designer_fx', () => {
  it('is a tool the agent is told it has', () => {
    expect(TOOLS.map((t) => t.function.name)).toContain('designer_fx');
    expect(CAPABILITIES).toContain('- designer_fx: Designer only: add or change non-destructive filter and effect layers (FX).');
    expect(readFileSync('src/engine/skills/app/designer.md', 'utf8')).toContain('En el Designer no uses la operación fx');
  });
  it('runs the commands as the panel does, one undo step, and the next request sees the FX layer with its ops', async () => {
    const sid = useStore.getState().activeSessionId;
    const doc = { ...createDoc('poster', 400, 300), layers: [{ ...newVectorLayer('Photo'), id: 'photo' }], activeLayerId: 'photo' };
    addDoc(sid, doc);
    const calls = await request('designer', 'Desenfoca la foto y ponle un glow', [], [{ name: 'designer_fx', args: { commands: [
      { do: 'add', group: 'filter', scope: 'layer', above: 'photo', simple: true, ops: [{ kind: 'blur', params: { radius: 5 } }] },
      { do: 'add', group: 'effect', scope: 'layer', above: 'last', simple: true, ops: [{ kind: 'glow' }] },
    ] } }]);
    const layers = activeDoc(sid)!.layers;
    expect(layers.map((l) => [l.type, l.name])).toEqual([['vector', 'Photo'], ['fx', 'Blur'], ['fx', 'Glow']]);
    expect(historyDepth(doc.id).undo).toBe(1);
    expect(calls[1]).toContain('Added filter layer');
    expect(calls[1]).toContain('applies to \\"Photo\\"');
    expect(useStore.getState().sessions[sid].feed.some((f) => JSON.stringify(f).includes('Changed filters and effects'))).toBe(true);
    const next = await request('designer', 'súbele el radio', [], []);
    const blur = layers[1] as FxLayer;
    expect(next[0]).toContain(`${blur.id} fx \\"Blur\\" [filter, scope layer: ${blur.ops[0].id} blur {\\"radius\\":5}]`);
  });
  it('an error changes nothing and tells the agent why', async () => {
    const sid = useStore.getState().activeSessionId;
    const before = activeDoc(sid)!.layers.length;
    const calls = await request('designer', 'pon sepia', [], [{ name: 'designer_fx', args: { commands: [{ do: 'add_op', layer: 'photo', kind: 'sepia' }] } }]);
    expect(activeDoc(sid)!.layers).toHaveLength(before);
    expect(calls[1]).toContain('is a vector layer, not an FX layer');
  });
  it('the keyword route to the fx operation is not sent in the Designer (FX layers instead), but is in Chat', async () => {
    const designer = await request('designer', 'Pon esta foto en blanco y negro', ['img1'], []);
    expect(designer[0]).not.toContain('This request fires');
    const chat = await request('chat', 'Pon esta foto en blanco y negro', ['img1'], []);
    expect(chat[0]).toContain('fx on asset:img1 {effect: grayscale}');
  });
  it('designer_fx outside the Designer is refused', async () => {
    const calls = await request('chat', 'hola', [], [{ name: 'designer_fx', args: { commands: [{ do: 'add', group: 'filter' }] } }]);
    expect(calls[1]).toContain('designer_fx works only in the Designer.');
  });
});
