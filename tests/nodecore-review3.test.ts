import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Graph } from '../src/engine/types';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener() {} }, document: { addEventListener() {}, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async (id: string) => id }));
const execute = vi.hoisted(() => vi.fn());
vi.mock('../src/engine/executor', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/engine/executor')>()), executeSteps: execute }));

import { useStore } from '../src/store/store';
import { applyEdit } from '../src/engine/nodecore/edit';
import { ownerRev } from '../src/engine/nodecore/revision';
import { consumersOf } from '../src/engine/nodecore/deps';
import { descriptorOf } from '../src/engine/nodecore/registry';
import { prepareAction, resetActions, runAction } from '../src/engine/nodecore/action';
import { inspectNode } from '../src/engine/nodecore/inspect';
import { deleteNodes, patchNodeData, tryConnect } from '../src/engine/flow/actions';
import { addConnected } from '../src/engine/flow/addConnected';
import { setAgentLlm } from '../src/engine/nodes/system';
import { clearJourneyTrace, lastJourneyTrace } from '../src/lib/journeyTrace';
import { commands } from '../src/engine/nodecore/commands';
import { check } from '../scripts/check-node-descriptors.mjs';

const settings = { count: 1, advanced: {} };
const HOME = useStore.getState().activeSessionId;
const text = (id: string, t: string) => ({ id, position: { x: 0, y: 0 }, data: { kind: 'text' as const, title: id, text: t } });
const img = (id: string, extra = {}) => ({ id, position: { x: 0, y: 0 }, data: { kind: 'image' as const, title: id, prompt: 'x', modelRef: 'local::image', settings, outputIndex: 0, ...extra } });
const edge = (id: string, source: string, target: string, port: string) => ({ id, source, target, sourceHandle: 'out', targetHandle: port });
const S = () => useStore.getState().sessions[HOME];
const setGraph = (graph: Graph) => useStore.setState((st) => ({ activeSessionId: HOME, generations: {}, sessions: { ...st.sessions, [HOME]: { ...st.sessions[HOME], graph } } }));
beforeEach(() => { execute.mockReset(); resetActions(); clearJourneyTrace(); });

describe('review finding 7: preconditions and one edit path', () => {
  it('a command edit that does not name the revision it read is refused', () => {
    setGraph({ nodes: [text('t', 'a'), img('i')], edges: [] });
    const blind = applyEdit({ session: HOME, require: true, op: { op: 'set', node: 't', patch: { text: 'b' } } });
    expect(blind).toMatchObject({ ok: false, error: expect.stringContaining('revision') });
    expect(applyEdit({ session: HOME, require: true, expect: { t: ownerRev(S().graph, 't') }, op: { op: 'set', node: 't', patch: { text: 'b' } } }).ok).toBe(true);
    const spec = commands.find((c) => c.id === 'nodes.edit.set')!;
    expect(JSON.stringify(spec.args)).toBeDefined();
  });
  it('replacing a cable that is no longer there is a conflict, not permission', () => {
    setGraph({ nodes: [text('t1', 'a'), text('t2', 'b'), img('i')], edges: [edge('e1', 't1', 'i', 'prompt')] });
    const x = 'e1';
    applyEdit({ session: HOME, op: { op: 'disconnect', edges: [x] } });
    const done = applyEdit({ session: HOME, op: { op: 'connect', source: 't2', target: 'i', targetHandle: 'prompt', replaces: x } });
    expect(done).toMatchObject({ ok: false, conflict: { expected: x, actual: 'none' } });
    expect(S().graph.edges).toEqual([]);
  });
  it('the revision changes when a cable of the node goes invalid', () => {
    setGraph({ nodes: [text('t', 'a'), img('i')], edges: [edge('e1', 't', 'i', 'prompt')] });
    const before = ownerRev(S().graph, 'i');
    deleteNodes(HOME, ['t']);
    expect(ownerRev(S().graph, 'i')).not.toBe(before);
  });
  it('a loop made through subjects is rejected when editing', () => {
    setGraph({ nodes: [img('a'), img('b', { subjects: [] })], edges: [] });
    patchNodeData(HOME, 'b', { subjects: [{ name: 'X', from: 'a' }] } as never);
    const done = applyEdit({ session: HOME, op: { op: 'set', node: 'a', patch: { subjects: [{ name: 'Y', from: 'b' }] } as never } });
    expect(done).toMatchObject({ ok: false, error: expect.stringContaining('loop') });
    expect((S().graph.nodes[0].data as { subjects?: unknown }).subjects).toBeUndefined();
  });
  it('the agent LLM selector and the add-connected picker go through the layer', () => {
    setGraph({ nodes: [text('t', 'a'), { id: 'ag', position: { x: 0, y: 0 }, data: { kind: 'ref', type: 'agent', ref: HOME, title: 'Agent' } }, img('i')], edges: [] });
    expect(setAgentLlm(HOME, 'ag', { provider: 'openrouter', model: 'm' })).toBeNull();
    const id = addConnected(HOME, 't', { kind: 'image', title: 'New', prompt: '', modelRef: 'local::image', settings, outputIndex: 0 });
    expect(id).toBeTruthy();
    expect(S().graph.edges.some((e) => e.target === id && e.source === 't')).toBe(true);
    expect(lastJourneyTrace().map((e) => e.event)).toEqual(expect.arrayContaining(['edit.set', 'edit.add']));
  });
  it('dragging a Model onto an Agent applies the same copy as the command', () => {
    setGraph({ nodes: [{ id: 'm', position: { x: 0, y: 0 }, data: { kind: 'ref', type: 'model', ref: 'local::image', title: 'Model', mediaKind: 'image' } }, { id: 'ag', position: { x: 0, y: 0 }, data: { kind: 'ref', type: 'agent', ref: HOME, title: 'Agent' } }], edges: [] });
    tryConnect(HOME, { source: 'm', target: 'ag', targetHandle: 'model' }); // no kind: inferred, as the UI drag does
    expect(S().graph.edges[0].kind).toBe('control');
    expect(S().agent.settings?.image?.modelRef).toBe('local::image');
  });
});

describe('review finding 8: affects, inspector and the descriptor check', () => {
  it('a port declared as not affecting the output does not invalidate its consumer', () => {
    const gr: Graph = { nodes: [text('t', 'a'), img('i')], edges: [edge('e1', 't', 'i', 'prompt')] };
    expect(consumersOf(gr, ['t'])).toEqual(['i']);
    const d = descriptorOf('image')!;
    const saved = d.affects;
    (d as { affects: Record<string, boolean> }).affects = { ...saved, prompt: false };
    try { expect(consumersOf(gr, ['t'])).toEqual([]); } finally { (d as { affects: unknown }).affects = saved; }
  });
  it('the inspector shows the latest run of this node in this session', async () => {
    setGraph({ nodes: [text('t', 'red'), img('gen', { generationId: 'g1' })], edges: [edge('e1', 't', 'gen', 'prompt')] });
    useStore.setState({ generations: { g1: { id: 'g1', status: 'done', assetIds: ['a'], inputs: { refs: [] }, prompt: 'x', settings } as never } });
    const run = async (id: string) => { const p = await prepareAction(HOME, ['gen']); if (!p.ok) throw new Error(p.errors.join()); execute.mockImplementationOnce(async (_s, ctx) => { ctx.onState('gen', 'running', { generationId: `n${id}` }); return { outputs: new Map(), failed: [], skipped: [], waiting: [] }; }); await runAction(p.snapshot, id); };
    await run('run-1'); await run('run-2');
    // The result on the node is the one run-2 made: the inspector names the run by the generation, never by the node.
    useStore.setState((st) => ({ generations: { ...st.generations, 'nrun-2': { id: 'nrun-2', status: 'done', assetIds: ['a'], inputs: { refs: [] }, prompt: 'x', settings } as never } }));
    patchNodeData(HOME, 'gen', { generationId: 'nrun-2' } as never);
    expect(inspectNode(HOME, 'gen')!.lastRun).toMatchObject({ runId: 'run-2' });
  });
  it('the check asks for migrations once a type moves past version 1', () => {
    const root = mkdtempSync(join(tmpdir(), 'nd-'));
    mkdirSync(join(root, 'src/engine/nodecore/types'), { recursive: true });
    writeFileSync(join(root, 'src/engine/graphTypes.ts'), "export type NodeKind = 'text';\n");
    const file = (v: string, extra = '') => `export default defineNode({\n  kind: 'text',\n  version: ${v},\n  params: [], inputs, output, required: [], affects: {}, evaluate, actions: [],${extra}\n});\n`;
    writeFileSync(join(root, 'src/engine/nodecore/types/text.node.ts'), file('2'));
    expect(check(root).errors).toEqual([expect.stringMatching(/text\.node\.ts:\d+: version 2 needs `migrate`/)]);
    writeFileSync(join(root, 'src/engine/nodecore/types/text.node.ts'), file('2', ' migrate: { 1: (d) => d },'));
    expect(check(root).errors).toEqual([]);
    writeFileSync(join(root, 'src/engine/nodecore/types/text.node.ts'), file('1'));
    expect(check(root).errors).toEqual([]);
  });
});
