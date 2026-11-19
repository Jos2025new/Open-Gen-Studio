import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The Designer through the command registry (ADR 0030, step 2): its actions as commands with the target in `on`, one
 * undo step per sequence, and the agent's find_commands / run_commands. Stubbed fetch; vector and text layers only
 * (no canvas in node).
 */
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));
import { readFileSync } from 'node:fs';
import { sendAgentMessage } from '../src/engine/agent/runtime';
import { findCommandsTool, runCommandsTool } from '../src/engine/agent/commandCalls';
import { COMMAND_TOOLS } from '../src/engine/agent/commandTools';
import { CAPABILITIES, TOOLS } from '../src/engine/agent/tools';
import { z } from 'zod';
import { allCommands, argsSchema, collected, command, defineCommand, findCommands, invoke, run, signature } from '../src/engine/commands';
import { register } from '../src/engine/commands/registry';
import * as actions from '../src/engine/design/actions';
import { DESIGNER_ACTIONS } from '../src/engine/design/commands';
import { FX_DO } from '../src/engine/design/fx.commands';
import { createDoc } from '../src/engine/design/doc';
import { historyDepth } from '../src/engine/design/history';
import { useStore } from '../src/store/store';
import type { DesignDoc, VectorLayer } from '../src/engine/types';

import { mainThread } from './helpers/threads';
const sid = useStore.getState().activeSessionId;
const rect = { type: 'rect', x: 10, y: 10, w: 100, h: 60, fill: '#ff0000' };
let doc: DesignDoc;
const now = (id = doc.id) => actions.getDoc(sid, id)!;
const on = () => ({ session: sid, doc: doc.id });

beforeEach(() => {
  useStore.setState((st) => ({ sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], docs: [], activeDocId: null } } }));
  doc = createDoc('Page', 800, 600);
  actions.addDoc(sid, doc);
});

describe('the Designer actions as commands', () => {
  it('every exported action is a command or says why it is not', () => {
    const exported = [...readFileSync('src/engine/design/actions.ts', 'utf8').matchAll(/^export (?:async )?function (\w+)/gm)].map((m) => m[1]);
    expect(Object.keys(DESIGNER_ACTIONS).sort()).toEqual(exported.sort());
    const ids = new Set(Object.values(DESIGNER_ACTIONS).filter((to) => !to.startsWith('- ')));
    for (const id of ids) expect(command(id), id).toBeDefined();
    const designer = allCommands().filter((c) => c.id.startsWith('designer.')).map((c) => c.id);
    expect(designer.sort()).toEqual([...ids, ...Object.values(FX_DO)].sort());
    expect(designer).toHaveLength(37);
  });

  it('are found by the automatic index, each with a target, a schema and a one-line signature', () => {
    expect(collected.loaded.map((l) => l.file)).toEqual(expect.arrayContaining(['/src/engine/design/commands.ts', '/src/engine/design/layer.commands.ts']));
    expect(collected.skipped).toEqual([]);
    for (const spec of allCommands().filter((c) => c.id.startsWith('designer.'))) {
      expect(spec.needs, spec.id).toContain('session');
      expect(argsSchema(spec), spec.id).toMatchObject({ type: 'object', additionalProperties: false });
    }
    expect(signature(command('designer.layer.set')!)).toMatch(/^\{layer: string, name\?: string, visible\?: boolean, locked\?: boolean, opacity\?: number 0\.\.1, blend\?: "normal"\|/);
    expect(signature(command('designer.layer.move')!)).toBe('{layer: string, dir: 1|-1}');
  });

  it('list what still reads something active as debt', () => {
    expect(allCommands().filter((c) => c.debt && c.id.startsWith('designer.')).map((c) => c.id).sort()).toEqual(['designer.doc.ensure', 'designer.doc.from_asset', 'designer.fx.add', 'designer.layer.add', 'designer.layer.ensure_paint', 'designer.layer.place_asset']);
  });

  it('typed code calls them with invoke, synchronously, as one undo step', () => {
    const made = invoke(command('designer.layer.add_shapes')!, { shapes: [rect] }, on()) as { layer: string };
    expect(now().layers.map((l) => l.id)).toEqual([made.layer]);
    expect(historyDepth(doc.id).undo).toBe(1);
    invoke(command('designer.doc.undo')!, {}, on());
    expect(now().layers).toEqual([]);
    expect(() => invoke(command('designer.doc.undo')!, {}, on())).toThrow('Nothing to undo.');
  });
});

describe('a sequence on the Designer', () => {
  it('chains commands with $n and is one undo step in the document', async () => {
    const result = await run({
      on: on(),
      seq: [
        { cmd: 'designer.layer.add_shapes', args: { shapes: [rect], name: 'Box' } },
        { cmd: 'designer.layer.set', args: { layer: '$1.layer', opacity: 0.5, blend: 'multiply' } },
        { cmd: 'designer.layer.duplicate', args: { layer: '$1.layer' } },
        { cmd: 'designer.layer.add_text', args: { text: 'Hola', x: 40, y: 300, width: 0, style: { fontSize: 48 } } },
        { cmd: 'designer.doc.read' },
      ],
    }, { caller: 'agent' });
    expect(result.ok).toBe(true);
    const [box, , copy, text, read] = result.results as [{ layer: string }, null, { layer: string }, { layer: string }, { layers: { id: string; type: string; opacity: number }[] }];
    expect(read.layers.map((l) => [l.id, l.type, l.opacity])).toEqual([[box.layer, 'vector', 0.5], [copy.layer, 'vector', 0.5], [text.layer, 'text', 1]]);
    expect((now().layers[0] as VectorLayer).blend).toBe('multiply');
    expect(historyDepth(doc.id).undo).toBe(1);
    actions.undoDoc(sid, doc.id);
    expect(now().layers).toEqual([]);
  });

  it('leaves the document and its undo as they were when a step fails', async () => {
    invoke(command('designer.layer.add_shapes')!, { shapes: [rect] }, on());
    const before = now();
    const result = await run({ on: on(), seq: [{ cmd: 'designer.layer.add_text', args: { text: 'Hola', x: 0, y: 0, width: 0 } }, { cmd: 'designer.layer.set', args: { layer: 'nope', opacity: 0.2 } }] }, { caller: 'agent' });
    expect(result).toMatchObject({ ok: false, error: { code: 'unavailable', message: 'No layer "nope" in this document.', step: 2 }, rolledBack: true });
    expect(now().layers).toEqual(before.layers);
    expect(historyDepth(doc.id).undo).toBe(1);
  });

  it('keeps the user\'s edit when a step fails after the sequence waited', async () => {
    // Stands for any step that waits (placing an image decodes it first).
    register(defineCommand({ id: 'test.wait', title: 'Wait', args: z.object({}).strict(), effect: 'write', needs: ['session', 'doc'], history: (target) => `designer:${target.doc}`, run: () => new Promise<void>((resolve) => setTimeout(resolve, 15)) }));
    const pending = run({ on: on(), seq: [{ cmd: 'designer.layer.add_shapes', args: { shapes: [rect], name: 'Agent' } }, { cmd: 'test.wait' }, { cmd: 'designer.layer.set', args: { layer: 'nope', opacity: 0.2 } }] }, { caller: 'agent' });
    await new Promise((resolve) => setTimeout(resolve, 2));
    actions.addTextLayer(sid, doc.id, 'Mine', { x: 0, y: 0, width: 0 }, {}, 'User');
    const result = await pending;
    expect(result).toMatchObject({ ok: false, error: { step: 3 }, rolledBack: false, kept: [`designer:${doc.id}`] });
    expect(now().layers.map((l) => l.name)).toEqual(['Agent', 'User']);
    // One undo step holds both: the user's change fell inside the agent's sequence.
    expect(historyDepth(doc.id).undo).toBe(1);
  });

  it('acts on the document named in on, not on the one on screen', async () => {
    const second = createDoc('Other', 400, 400);
    actions.addDoc(sid, second);
    expect(actions.activeDoc(sid)?.id).toBe(second.id);
    const result = await run({ cmd: 'designer.layer.add_shapes', args: { shapes: [rect] }, on: on() }, { caller: 'agent' });
    expect(result.ok).toBe(true);
    expect(now().layers).toHaveLength(1);
    expect(now(second.id).layers).toHaveLength(0);
    expect(actions.activeDoc(sid)?.id).toBe(second.id);
    expect(await run({ cmd: 'designer.doc.read', on: { session: sid, doc: 'gone' } }, { caller: 'agent' })).toMatchObject({ ok: false, error: { code: 'unavailable', message: 'That document is not in this session.' } });
  });

  it('asks before deleting a document, and refuses when nobody can ask', async () => {
    expect(await run({ cmd: 'designer.doc.delete', on: on() }, { caller: 'agent' })).toMatchObject({ ok: false, error: { code: 'denied' } });
    expect(now()).toBeDefined();
  });
});

/** One request end to end; `reply` are the agent's tool calls, in order. Returns what the model was sent each round. */
async function request(text: string, reply: Array<{ name: string; args: unknown }>) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (!body.messages) return new Response(JSON.stringify({ data: [] }));
    calls.push(JSON.stringify(body.messages));
    const call = reply.shift();
    const delta = call ? { tool_calls: [{ index: 0, id: `c${calls.length}`, function: { name: call.name, arguments: JSON.stringify(call.args) } }] } : { content: 'Listo.' };
    return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: call ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  });
  const st = useStore.getState();
  useStore.setState({
    ui: { ...st.ui, workspace: 'designer' },
    settings: { ...st.settings, keys: { ...st.settings.keys, nanogpt: 'k' }, agent: { ...st.settings.agent, provider: 'nanogpt', model: 'm' } },
    composer: { ...st.composer, agentStyle: 'auto', attachments: [] },
    sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], feed: [], subjects: [], agents: mainThread({ history: [], questionRound: 0, notes: [], busy: false }) } },
  });
  await sendAgentMessage(text);
  vi.unstubAllGlobals();
  return calls;
}

describe('the agent: find_commands and run_commands', () => {
  it('are tools the agent is told it has, and the only two the registry adds', () => {
    expect(TOOLS.map((t) => t.function.name)).toEqual(expect.arrayContaining(['find_commands', 'run_commands']));
    expect(CAPABILITIES).toContain('- find_commands: Lists what the app can do as commands in every area.');
    expect(CAPABILITIES).toContain('- run_commands: Runs commands of any area in order, as the user\'s own actions.');
  });

  it('find_commands answers one line per command, with why one cannot run now', () => {
    const all = findCommandsTool(sid, { area: 'designer' });
    const lines = all.text.split('\n');
    expect(lines[0]).toBe(`Commands run as the user's own actions in this session. Document on screen: ${doc.id} "Page", 800x600.`);
    expect(lines).toHaveLength(38);
    expect(lines).toContain('designer.layer.move {layer: string, dir: 1|-1} — One place up (1) or down (-1) in the stack.');
    expect(lines.find((l) => l.startsWith('designer.doc.undo'))).toBe('designer.doc.undo {} — Takes back the last change of the document. [not now: Nothing to undo.]');
    expect(findCommandsTool(sid, { text: 'opacity' }).text.split('\n')).toHaveLength(2);
    expect(findCommandsTool(sid, { text: 'zzz' })).toEqual({ text: 'No command matches. Areas: designer, nodes, studio, library, skills, models, sessions.', done: false });
    expect(findCommandsTool(sid, { area: 3 }).text).toMatch(/^Invalid find_commands input: area/);
  });

  it('chains three Designer commands in one call: one undo step, and the next round sees the result', async () => {
    const calls = await request('Pon un rectángulo rojo al 40 % y duplícalo', [{
      name: 'run_commands',
      args: { seq: [
        { cmd: 'designer.layer.add_shapes', args: { shapes: [rect], name: 'Rojo' } },
        { cmd: 'designer.layer.set', args: { layer: '$1.layer', opacity: 0.4 } },
        { cmd: 'designer.layer.duplicate', args: { layer: '$1.layer' } },
      ] },
    }]);
    expect(calls).toHaveLength(2);
    expect(now().layers.map((l) => [l.name, l.opacity])).toEqual([['Rojo', 0.4], [expect.stringContaining('Rojo'), 0.4]]);
    expect(historyDepth(doc.id).undo).toBe(1);
    expect(calls[1]).toContain('Done, 3 steps. Results: [{\\"layer\\":');
    expect(calls[1]).toContain('One Ctrl+Z per document undoes it all.');
    actions.undoDoc(sid, doc.id);
    expect(now().layers).toEqual([]);
  });

  it('tells the agent which step failed and that nothing was kept', async () => {
    const answer = await runCommandsTool(sid, { seq: [{ cmd: 'designer.layer.add_text', args: { text: 'Hola', x: 0, y: 0, width: 0 } }, { cmd: 'designer.layer.merge_down', args: { layer: '$1.layer' } }] });
    expect(answer).toEqual({ text: 'Step 2 failed (failed): There is no layer under it, or one of the two is locked. Steps 1 to 1 ran and were taken back: the documents are as before.', done: false });
    expect(now().layers).toEqual([]);
    expect((await runCommandsTool(sid, { seq: [{ cmd: 'designer.layer.nothing' }] })).text).toBe('Step 1 failed (unknown): No command "designer.layer.nothing". Nothing ran.');
    expect((await runCommandsTool(sid, { seq: [{ cmd: 'designer.doc.read', on: { session: 'other' } }] })).text).toMatch(/^Invalid run_commands input: seq\.0\.on/);
    useStore.setState((st) => ({ sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], docs: [], activeDocId: null } } }));
    expect((await runCommandsTool(sid, { seq: [{ cmd: 'designer.layer.add_text', args: { text: 'Hola', x: 0, y: 0, width: 0 } }] })).text).toBe(
      'Step 1 failed (target): designer.layer.add_text needs on.doc (target a new doc from an earlier step with "on": "$1.doc", or pass an id from designer.doc.list). Nothing ran.',
    );
  });

  it('finishes the Cartel poster evidence request in 2 model calls (down from 5), with or without explicit on: "$1.doc"', async () => {
    useStore.setState((st) => ({ sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], docs: [], activeDocId: null } } }));
    const cartelSteps = [
      { cmd: 'designer.doc.new', args: { width: 1080, height: 1350, name: 'Cartel' } },
      { cmd: 'designer.layer.add_text', args: { text: 'Gran apertura', x: 80, y: 120, width: 920, style: { fontFamily: 'Display', fontSize: 120, fontWeight: 700, color: '#111111', align: 'center' } } },
      { cmd: 'designer.layer.set', args: { layer: '$2.layer', name: 'Titular' } },
      { cmd: 'designer.layer.add_shapes', args: { shapes: [{ type: 'rect', x: 80, y: 600, w: 500, h: 300, fill: '#E63946', stroke: null }], name: 'Rectángulo' } },
      { cmd: 'designer.layer.add_shapes', args: { shapes: [{ type: 'ellipse', x: 640, y: 600, w: 300, h: 300, fill: '#1D3557', stroke: null }], name: 'Círculo' } },
      { cmd: 'designer.fx.add', args: { group: 'filter', scope: 'below', ops: [{ kind: 'blur' }], name: 'Desenfoque' } },
    ];
    const calls = await request(
      'Crea un documento de 1080×1350 llamado Cartel, añade un título que diga "Gran apertura", un rectángulo, un círculo y una capa de efecto de desenfoque. Después renombra la capa del título a "Titular".',
      [{ name: 'run_commands', args: { seq: cartelSteps } }],
    );
    // Call 1 (find_commands) and Calls 2-3 (failed target + split doc.new) disappear: 1 run_commands + 1 reply = 2 calls.
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('designer.doc.new {width: int 1..16384, height: int 1..16384, name?: string}');
    expect(calls[0]).toContain('designer.fx.add');
    expect(calls[0]).toContain('blur) or effect (glow, shadow, flare)');
    expect(calls[1]).toContain('Done, 6 steps.');
    const created = actions.activeDoc(sid)!;
    expect([created.name, created.width, created.height]).toEqual(['Cartel', 1080, 1350]);
    expect(created.layers.map((l) => [l.name, l.type])).toEqual([
      ['Titular', 'text'],
      ['Rectángulo', 'vector'],
      ['Círculo', 'vector'],
      ['Desenfoque', 'fx'],
    ]);
    expect(historyDepth(created.id).undo).toBe(1);

    // Also accepts explicit "on": "$1.doc" (string shorthand) and "on": { doc: "$1.doc" }.
    for (const on of ['$1.doc', { doc: '$1.doc' }] as const) {
      useStore.setState((st) => ({ sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], docs: [], activeDocId: null } } }));
      const ans = await runCommandsTool(sid, { seq: [cartelSteps[0], ...cartelSteps.slice(1).map((s) => ({ ...s, on }))] });
      expect(ans.done).toBe(true);
      expect(actions.activeDoc(sid)?.layers.map((l) => l.name)).toEqual(['Titular', 'Rectángulo', 'Círculo', 'Desenfoque']);
    }
  });

  it('measures what the registry costs', async () => {
    const select = command('designer.layer.select')!;
    const set = command('designer.layer.set')!;
    const layer = (invoke(command('designer.layer.add_shapes')!, { shapes: [rect] }, on()) as { layer: string }).layer;
    const n = 2000;
    /** Best of five rounds, in ms per call: the store's own work in each call is far larger than what is measured. */
    const best = (work: (i: number) => void) => Math.min(...[0, 1, 2, 3, 4].map(() => {
      const t0 = performance.now();
      for (let i = 0; i < n; i++) work(i);
      return (performance.now() - t0) / n;
    }));
    const direct = best(() => actions.setActiveLayer(sid, doc.id, null));
    const through = best(() => invoke(select, { layer: null }, on()));
    const directUndo = best((i) => actions.patchLayer(sid, doc.id, layer, { opacity: (i % 10) / 10 }));
    const throughUndo = best((i) => invoke(set, { layer, opacity: (i % 10) / 10 }, on()));
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) await run({ cmd: 'designer.layer.select', args: { layer: null }, on: on() }, { caller: 'agent' });
    const boundary = (performance.now() - t0) / 200;

    const twoTools = JSON.stringify(COMMAND_TOOLS).length;
    const oneEach = JSON.stringify(allCommands().map((c) => ({ type: 'function', function: { name: c.id, description: c.description ?? c.title, parameters: argsSchema(c) } }))).length;
    const listing = findCommandsTool(sid, { area: 'designer' }).text.length;
    if (process.env.COMMANDS_BENCH) {
      console.log(`designer.layer.select: action ${(direct * 1000).toFixed(1)} µs, invoke ${(through * 1000).toFixed(1)} µs, run ${(boundary * 1000).toFixed(1)} µs`);
      console.log(`designer.layer.set (with undo): action ${(directUndo * 1000).toFixed(1)} µs, invoke ${(throughUndo * 1000).toFixed(1)} µs`);
      console.log(`tools sent every turn: 2 tools ${twoTools} chars; one tool per command ${oneEach} chars; find_commands listing ${listing} chars; commands ${findCommands({ area: 'designer' }).length}`);
    }
    expect(through - direct).toBeLessThan(0.05);
    expect(throughUndo - directUndo).toBeLessThan(0.05);
    expect(twoTools * 4).toBeLessThan(oneEach);
  });
});
