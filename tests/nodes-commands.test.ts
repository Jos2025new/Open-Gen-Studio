import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The node graph through the command registry (ADR 0030, step 5): its actions as commands with the target in `on`, one
 * undo step per sequence, and a failing sequence that puts the graph back. No node is run and no provider is called.
 */
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));
import { readFileSync } from 'node:fs';
import { allCommands, argsSchema, collected, command, invoke, run } from '../src/engine/commands';
import { NODES_ACTIONS } from '../src/engine/flow/commands';
import { graphHistory, travelGraph } from '../src/engine/flow/history';
import { createSession, setGraph, useStore } from '../src/store/store';
import type { Graph } from '../src/engine/types';

let sid = '';
const on = () => ({ session: sid });
const graph = () => useStore.getState().sessions[sid].graph;
const text = (): Record<string, unknown> => ({ kind: 'text', title: 'Prompt', text: '' });

beforeEach(() => {
  const session = createSession('Nodes commands');
  sid = session.id;
  useStore.setState((st) => ({ sessions: { ...st.sessions, [sid]: session } }));
});

/** The node core's own commands (nodecore/commands.ts): not wrappers of an action in actions.ts. */
const NODE_CORE = new Set(['nodes.action.prepare', 'nodes.action.run', 'nodes.edit.connect', 'nodes.edit.set', 'nodes.node.inspect']);

describe('the node actions as commands', () => {
  it('every exported action is a command or says why it is not', () => {
    const source = readFileSync('src/engine/flow/actions.ts', 'utf8');
    const declared = [...source.matchAll(/^export (?:async )?function (\w+)/gm)].map((m) => m[1]);
    const reexported = [...source.matchAll(/^export \{ (\w+) \} from '\.\/addConnected'/gm)].map((m) => m[1]);
    expect(Object.keys(NODES_ACTIONS).sort()).toEqual([...declared, ...reexported].sort());
    const ids = new Set(Object.values(NODES_ACTIONS).filter((to) => !to.startsWith('- ')));
    for (const id of ids) expect(command(id), id).toBeDefined();
    const nodes = allCommands().filter((c) => c.id.startsWith('nodes.') && !c.id.startsWith('nodes.system.') && !NODE_CORE.has(c.id)).map((c) => c.id);
    expect(['nodes.action.prepare', 'nodes.action.run', 'nodes.edit.connect', 'nodes.edit.set', 'nodes.node.inspect'].every((id) => command(id))).toBe(true);
    expect(nodes.sort()).toEqual([...ids].sort());
    expect(nodes).toHaveLength(21);
  });

  it('are found by the automatic index, each with a strict schema and a session target', () => {
    expect(collected.loaded.map((l) => l.file)).toEqual(expect.arrayContaining(['/src/engine/flow/commands.ts']));
    for (const spec of allCommands().filter((c) => c.id.startsWith('nodes.') && !c.id.startsWith('nodes.system.'))) {
      expect(argsSchema(spec), spec.id).toMatchObject({ type: 'object', additionalProperties: false });
      if (spec.id !== 'nodes.node.new_data') expect(spec.needs, spec.id).toContain('session');
    }
    expect(command('nodes.run.start')!.effect).toBe('spend');
    expect(command('nodes.edge.connect')!.effect).toBe('write');
  });

  it('list what still cannot be undone or reads the composer as debt', () => {
    expect(allCommands().filter((c) => c.debt && c.id.startsWith('nodes.')).map((c) => c.id).sort()).toEqual([
      'nodes.node.add_connected',
      'nodes.node.new_data',
      'nodes.node.rename',
      'nodes.node.set_sketch',
    ]);
  });
});

describe('a sequence on the node graph', () => {
  it('adds a node, edits it and connects it with $n: one undo step, and undo brings the graph back', async () => {
    const before = structuredClone(graph());
    const result = await run({
      on: on(),
      seq: [
        { cmd: 'nodes.node.new_data', args: { kind: 'text' } },
        { cmd: 'nodes.node.add', args: { data: '$1', position: { x: 0, y: 0 } } },
        { cmd: 'nodes.node.edit', args: { node: '$2.node', expect: '$2.rev', patch: { title: 'Prompt', text: 'Hola' } } },
        { cmd: 'nodes.node.new_data', args: { kind: 'image' } },
        { cmd: 'nodes.node.add', args: { data: '$4', position: { x: 400, y: 0 } } },
        { cmd: 'nodes.edge.connect', args: { source: '$2.node', target: '$5.node', target_handle: 'prompt' } },
      ],
    }, { caller: 'agent' });

    expect(result.ok).toBe(true);
    const [data, made, edited, , target, edge] = result.results as [{ kind: string }, { node: string }, { node: string }, unknown, { node: string }, { edge: string }];
    expect(data.kind).toBe('text');
    expect(edited.node).toBe(made.node);
    expect(graph().nodes.map((n) => n.id)).toEqual([made.node, target.node]);
    expect(graph().nodes[0].data).toMatchObject({ kind: 'text', title: 'Prompt', text: 'Hola' });
    expect(graph().edges.map((e) => e.id)).toEqual([edge.edge]);
    expect(graph().edges[0]).toMatchObject({ source: made.node, target: target.node, targetHandle: 'prompt' });
    expect(graphHistory(sid, 'undo')).toHaveLength(1);

    expect(travelGraph(sid, graph(), 'undo', 1, (next) => { setGraph(sid, () => next); return true; })).toBe(true);
    expect(graph().nodes).toEqual(before.nodes);
    expect(graph().edges).toEqual(before.edges);
  });

  it('leaves the graph and its undo as they were when a step fails', async () => {
    invoke(command('nodes.node.add')!, { data: text(), position: { x: 0, y: 0 } }, on());
    const before = structuredClone(graph()) as Graph;
    const steps = graphHistory(sid, 'undo').length;
    expect(steps).toBe(1);

    const result = await run({
      on: on(),
      seq: [
        { cmd: 'nodes.node.add', args: { data: text(), position: { x: 200, y: 0 } } },
        { cmd: 'nodes.node.edit', args: { node: 'nope', expect: 'x', patch: { title: 'Gone' } } },
      ],
    }, { caller: 'agent' });

    expect(result).toMatchObject({ ok: false, error: { code: 'unavailable', message: 'No such node: nope.', step: 2 }, rolledBack: true });
    expect(graph().nodes).toEqual(before.nodes);
    expect(graph().edges).toEqual(before.edges);
    expect(graphHistory(sid, 'undo')).toHaveLength(steps);
  });

  it('refuses a spend command at the boundary when nobody can approve, and calls no provider', async () => {
    const fetch = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    const result = await run({ cmd: 'nodes.run.start', args: { targets: ['nope'] }, on: on() }, { caller: 'agent' });
    expect(result).toMatchObject({ ok: false, error: { code: 'denied' } });
    expect(fetch).not.toHaveBeenCalled();
    expect(graph().nodes).toEqual([]);
    expect(graphHistory(sid, 'undo')).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it('reports the action\'s reason when a command cannot run', async () => {
    expect(await run({ cmd: 'nodes.node.edit', args: { node: 'nope', expect: 'x', patch: { title: 'x' } }, on: on() }, { caller: 'agent' })).toMatchObject({ ok: false, error: { code: 'unavailable', message: 'No such node: nope.' } });
    const made = invoke(command('nodes.node.add')!, { data: text(), position: { x: 0, y: 0 } }, on()) as { node: string };
    expect(await run({ cmd: 'nodes.edge.connect', args: { source: made.node, target: 'nope', target_handle: 'prompt' }, on: on() }, { caller: 'agent' })).toMatchObject({ ok: false, error: { code: 'unavailable', message: 'No such node: nope.' } });
    expect(graph().edges).toEqual([]);
  });
});
