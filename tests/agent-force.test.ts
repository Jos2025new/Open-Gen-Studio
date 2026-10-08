import { describe, expect, it, vi } from 'vitest';

/*
 * The three agent modes. Auto (default) and guided keep their behavior; direct asks nothing, shows no settings card and
 * uses the composer's models. Stubbed fetch, nothing reaches a provider.
 */
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));


import { gateOps, steerNote } from '../src/engine/agent/force';
import { offlinePlan } from '../src/engine/agent/offline';
import { sendAgentMessage } from '../src/engine/agent/runtime';
import { useStore } from '../src/store/store';

/*
 * The keyword gate (agent/force.ts). An operation fires when it is named (a deterministic score of associated words,
 * Spanish and English, in request order), its input is attached and its required parameters can be read from the text.
 * A fired operation reaches the agent as the signal to follow its route; nothing else changes (no tool_choice sent to the
 * provider). A request that fires nothing follows the general workflow untouched. Stubbed fetch and store.
 */
const before = useStore.getState();
function withAssets(list: Array<{ id: string; kind: string; width?: number; height?: number; duration?: number; generationId?: string }>, generations: Record<string, unknown> = {}) {
  useStore.setState({
    assets: { ...before.assets, ...Object.fromEntries(list.map((a) => [a.id, { name: a.id, createdAt: 0, width: 0, height: 0, ...a }])) } as never,
    generations: { ...before.generations, ...generations } as never,
  });
}
const inputs = (ids: string[]) => ids.flatMap((id) => (useStore.getState().assets[id] ? [useStore.getState().assets[id]] : []));
const gate = (text: string, ids: string[], direct = false) => gateOps(text, inputs(ids), direct).map((g) => ({ seq: g.seq, fired: g.fired, params: g.params, note: g.note }));
const fired = (text: string, ids: string[], direct = false) => gateOps(text, inputs(ids), direct).filter((g) => g.fired).map((g) => g.op);

describe('your example: named in order, fired only with its input', () => {
  const text = 'Quiero una hoja de referencias para este personaje y una voz para ver como se escucha, despues haremos unos videos con ella, pero primero quiero que me muestres como se veria';
  it('n1_reference-sheet fires on the image; n2_create-voice is named and asks for its sample', () => {
    withAssets([{ id: 'img1', kind: 'image', width: 1024, height: 1024 }]);
    const g = gate(text, ['img1']);
    expect(g.map((x) => x.seq)).toEqual(['n1_reference-sheet', 'n2_create-voice']);
    expect(g[0]).toMatchObject({ fired: true, params: { subject: 'character' } });
    expect(g[1]).toMatchObject({ fired: false, note: expect.stringContaining('audio sample') });
  });
  it('with a 10 s sample both fire; with a 40 s one the voice does not', () => {
    withAssets([{ id: 'img1', kind: 'image', width: 1024, height: 1024 }, { id: 'aud1', kind: 'audio', duration: 10 }, { id: 'aud2', kind: 'audio', duration: 40 }]);
    expect(fired(text, ['img1', 'aud1'])).toEqual(['reference_sheet', 'create_voice']);
    expect(fired(text, ['img1', 'aud2'])).toEqual(['reference_sheet']);
  });
});

describe('each operation, by its parameters', () => {
  it('angle: a view angle, a different one, or several (Auto asks how many; Direct makes 3)', () => {
    withAssets([{ id: 'img1', kind: 'image', width: 1024, height: 1024 }]);
    for (const t of ['quiero un ángulo diferente', 'dame un ángulo de vista diferente', 'give me a different angle', 'una vista lateral de este personaje']) expect(fired(t, ['img1'])).toEqual(['angle']);
    expect(gate('dame múltiples ángulos', ['img1'])[0]).toMatchObject({ fired: false, note: expect.stringContaining('how many') });
    expect(fired('dame múltiples ángulos', ['img1'], true)).toEqual(['angle']);
  });
  it('reference_sheet: characters, people and objects; a place alone does not fit', () => {
    withAssets([{ id: 'img1', kind: 'image', width: 1024, height: 1024 }]);
    expect(fired('hazme una hoja de personaje de la chica que está en la playa', ['img1'])).toEqual(['reference_sheet']);
    expect(gate('hazme una hoja de referencia de la ciudad', ['img1'])[0]).toMatchObject({ fired: false, note: expect.stringContaining('does not fit') });
  });
  it('reframe: a named format fires; "Instagram" alone is asked in Auto and 9:16 in Direct', () => {
    withAssets([{ id: 'img1', kind: 'image', width: 1024, height: 1024 }]);
    expect(gate('pásala a 9:16', ['img1'])[0]).toMatchObject({ fired: true, params: { aspect: '9:16' } });
    expect(gate('cambia la imagen en formato para instagram', ['img1'])[0]).toMatchObject({ fired: false });
    expect(gate('cambia la imagen en formato para instagram', ['img1'], true)[0]).toMatchObject({ fired: true, params: { aspect: '9:16' } });
  });
  it('upscale: 4K from the source size; a new 4K image is not an upscale', () => {
    withAssets([{ id: 'img1', kind: 'image', width: 1024, height: 1024 }]);
    expect(gate('súbela a 4K', ['img1'])[0]).toMatchObject({ fired: true, params: { factor: '4' } });
    expect(fired('make it 4k', ['img1'])).toEqual(['upscale']);
    expect(fired('genera un paisaje en 4K de montañas', ['img1'])).toEqual([]);
  });
  it('relight: only a light that fits a preset; a scene described with light is not a relight', () => {
    withAssets([{ id: 'img1', kind: 'image', width: 1024, height: 1024 }]);
    expect(gate('cambia la luz a atardecer', ['img1'])[0]).toMatchObject({ fired: true, params: { preset: 'golden-hour' } });
    expect(gate('cambia la iluminación', ['img1'])[0]).toMatchObject({ fired: false });
    expect(fired('Usa esta foto como referencia: una chica en un café con iluminación cálida', ['img1'])).toEqual([]);
  });
  it('extract_frame: the first, the last or a second; grid_split: a named grid or the contact sheet that made it', () => {
    withAssets([{ id: 'vid1', kind: 'video' }, { id: 'img1', kind: 'image', width: 1536, height: 1024, generationId: 'g1' }], { g1: { id: 'g1', op: { id: 'contact_sheet', params: { angles: '6' } } } });
    expect(gate('dame el último frame', ['vid1'])[0]).toMatchObject({ fired: true, params: { which: 'last' } });
    expect(gate('saca el fotograma del segundo 3', ['vid1'])[0]).toMatchObject({ fired: true, params: { which: 'time', seconds: '3' } });
    expect(gate('divide la cuadrícula', ['img1'])[0]).toMatchObject({ fired: true, params: { grid: '2x3' } });
  });
  it('join_clips needs two clips; video_upscale wins over upscale for a video', () => {
    withAssets([{ id: 'v1', kind: 'video' }, { id: 'v2', kind: 'video' }]);
    expect(fired('une los clips', ['v1'])).toEqual([]);
    expect(fired('join these clips', ['v1', 'v2'])).toEqual(['join_clips']);
    expect(fired('sube la resolución del video', ['v1'])).toEqual(['video_upscale']);
  });
  it('edit is the catch-all: it fires only when no specific operation covers the image', () => {
    withAssets([{ id: 'img1', kind: 'image', width: 1024, height: 1024 }]);
    expect(fired('cambia el fondo por uno de estudio', ['img1'])).toEqual(['edit']);
    expect(fired('quita el fondo y agrega una sombra', ['img1'])).toEqual(['remove_bg']);
  });
  it('nothing attached: named, not fired', () => {
    expect(fired('quita el fondo', [])).toEqual([]);
  });
});

describe('what the agent reads', () => {
  it('only the fired operations, in order; a named one that does not fire adds nothing', () => {
    withAssets([{ id: 'img1', kind: 'image', width: 1024, height: 1024 }]);
    const note = steerNote(gateOps('quita el fondo y crea una voz para ella', inputs(['img1']), false));
    expect(note).toContain('This request fires, in order: n1_remove-bg remove_bg on asset:img1');
    expect(note).not.toContain('create_voice');
    expect(steerNote(gateOps('crea una voz para ella', [], false))).toBe('');
    expect(steerNote([])).toBe('');
  });
});

/** A request end to end; returns each model call's tool_choice and messages. */
async function request(text: string, attachments: string[]) {
  const calls: Array<{ toolChoice: unknown; messages: string }> = [];
  const plans = [{ title: 'Fondo', steps: [{ id: 's1', kind: 'op', op: 'remove_bg', input: 'asset:img1' }] }];
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (!body.messages) return new Response(JSON.stringify({ data: [] }));
    calls.push({ toolChoice: body.tool_choice, messages: JSON.stringify(body.messages) });
    const plan = plans.shift();
    const delta = plan ? { tool_calls: [{ index: 0, id: `c${calls.length}`, function: { name: 'propose_plan', arguments: JSON.stringify(plan) } }] } : { content: 'Listo.' };
    return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: plan ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  });
  const st = useStore.getState();
  const sid = st.activeSessionId;
  useStore.setState({
    settings: { ...st.settings, keys: { ...st.settings.keys, nanogpt: 'k' }, agent: { ...st.settings.agent, provider: 'nanogpt', model: 'm' } },
    composer: { ...st.composer, agentStyle: 'auto', attachments },
    sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], feed: [], subjects: [], agent: { history: [], questionRound: 0, notes: [], busy: false } } },
  });
  await sendAgentMessage(text);
  vi.unstubAllGlobals();
  return calls;
}

describe('in a request, end to end (scenarios 1 to 3)', () => {
  it('3: a mapped request carries the signal; the provider gets nothing of ours (tool_choice stays auto)', async () => {
    withAssets([{ id: 'img1', kind: 'image', width: 1024, height: 1024 }]);
    const calls = await request('Quítale el fondo a esta foto', ['img1']);
    expect(calls[0].messages).toContain('n1_remove-bg remove_bg on asset:img1');
    // The route opens the request, before the user's words and the context, and rules out loading a guide first.
    expect(calls[0].messages.indexOf('This request fires')).toBeLessThan(calls[0].messages.lastIndexOf('<user_message'));
    expect(calls[0].messages).toContain('do not call read_guide for them');
    expect(calls.every((c) => c.toolChoice === 'auto')).toBe(true);
  });
  it('2: a specific request that does not fit the map (no input) follows the general workflow, no signal', async () => {
    const calls = await request('Quítale el fondo', []);
    expect(calls[0].toolChoice).toBe('auto');
    expect(calls[0].messages).not.toContain('This request fires');
  });
  it('1: no keyword, general workflow, no signal', async () => {
    const calls = await request('Una bicicleta roja en la playa', []);
    expect(calls[0].toolChoice).toBe('auto');
    expect(calls[0].messages).not.toContain('This request fires');
  });
});

describe('the local planner uses the same gate', () => {
  it('a light that fits a preset is a relight; a scene with light is not', () => {
    const base = { answers: {}, round: 0, maxRounds: 1, style: 'auto' as const, workspace: 'chat' as const, attachments: [{ id: 'img1', kind: 'image' as const }] };
    const opOf = (request: string) => {
      const a = offlinePlan({ ...base, request });
      return a.kind === 'plan' ? (a.plan.steps?.[0] as { kind?: string; op?: string }) : undefined;
    };
    expect(opOf('cambia la luz a atardecer')).toMatchObject({ kind: 'op', op: 'relight' });
    expect(opOf('una chica en un café con luz suave')?.op).toBeUndefined();
  });
});

