import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Graph } from '../src/engine/types';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener() {} }, document: { addEventListener() {}, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async (id: string) => id }));
const execute = vi.hoisted(() => vi.fn());
vi.mock('../src/engine/executor', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/engine/executor')>()), executeSteps: execute }));

import { useStore } from '../src/store/store';
import { deleteNodes, patchNodeData, prepareNodeRun, previewRun } from '../src/engine/flow/actions';
import { graphToSteps } from '../src/engine/flow/graph';
import { runApproved, resetActions } from '../src/engine/nodecore/action';
import { inspectNode } from '../src/engine/nodecore/inspect';
import { runProblems } from '../src/engine/nodecore/guard';
import { sourceValue, storeEnv } from '../src/engine/nodecore/resolver';

const settings = { count: 1, advanced: {} };
const HOME = useStore.getState().activeSessionId;
const text = (id: string, t: string) => ({ id, position: { x: 0, y: 0 }, data: { kind: 'text' as const, title: id, text: t } });
const asset = (id: string, a: string) => ({ id, position: { x: 0, y: 0 }, data: { kind: 'asset' as const, title: id, assetId: a } });
const gen = { id: 'gen', position: { x: 0, y: 0 }, data: { kind: 'image' as const, title: 'Image', prompt: 'x', modelRef: 'local::image', settings, outputIndex: 0 } };
const edge = (id: string, source: string, target: string, port: string, extra = {}) => ({ id, source, target, sourceHandle: 'out', targetHandle: port, ...extra });
const g = () => useStore.getState().sessions[HOME].graph;
const setGraph = (graph: Graph) => useStore.setState((st) => ({ activeSessionId: HOME, generations: {}, sessions: { ...st.sessions, [HOME]: { ...st.sessions[HOME], graph } } }));
beforeEach(() => { execute.mockReset(); resetActions(); });

describe('review finding 1: broken cables keep their own identity', () => {
  it('a multi-cable port keeps the invalid cable while another survives', () => {
    setGraph({ nodes: [asset('a1', 'p1'), asset('a2', 'p2'), gen], edges: [edge('e1', 'a1', 'gen', 'ref'), edge('e2', 'a2', 'gen', 'ref')] });
    deleteNodes(HOME, ['a1']);
    patchNodeData(HOME, 'gen', { prompt: 'edit after' }); // any later edit goes through setGraph again
    const inputs = inspectNode(HOME, 'gen')!.inputs;
    expect(inputs.filter((i) => i.status === 'invalid')).toEqual([expect.objectContaining({ edgeId: 'e1', broken: true })]);
    expect(inputs.find((i) => i.edgeId === 'e2')).toBeDefined();
  });
  it('ref and control links are marked too', () => {
    setGraph({ nodes: [text('t', 'x'), gen], edges: [edge('r1', 't', 'gen', 'sys_ref', { kind: 'ref' }), edge('c1', 't', 'gen', 'control', { kind: 'control' })] });
    deleteNodes(HOME, ['t']);
    expect(g().broken?.map((b) => [b.edge.id, b.edge.kind]).sort()).toEqual([['c1', 'control'], ['r1', 'ref']]);
    expect(inspectNode(HOME, 'gen')!.inputs.map((i) => i.kind).sort()).toEqual(['control', 'ref']);
  });
});

describe('review finding 2: the plan comes from the resolver and respects pins', () => {
  it('a pinned cable whose source moved is neither planned nor run for', () => {
    setGraph({ nodes: [text('t', 'red'), gen], edges: [edge('e1', 't', 'gen', 'prompt')] });
    const pin = sourceValue(g().nodes[0], {}, storeEnv()).revision!;
    setGraph({ nodes: [text('t', 'blue'), gen], edges: [edge('e1', 't', 'gen', 'prompt', { pin })] });
    expect(inspectNode(HOME, 'gen')!.inputs[0]).toMatchObject({ status: 'invalid', pinMoved: true });
    const plan = graphToSteps(g(), ['gen'], {}, {});
    expect(plan.steps.find((s) => s.id === 't')).toBeUndefined();
    expect(JSON.stringify(plan.steps)).not.toContain('blue');
    // pinned to the current revision it is used
    patchNodeData(HOME, 't', { text: 'red' });
    expect(graphToSteps(g(), ['gen'], {}, {}).steps.find((s) => s.id === 't')).toMatchObject({ text: 'red' });
  });
  it('an invalid pin on a required input blocks the run', () => {
    const tool = { id: 'op', position: { x: 0, y: 0 }, data: { kind: 'tool' as const, title: 'Split', op: 'grid_split' as const, params: { grid: 2 }, outputIndex: 0 } };
    setGraph({ nodes: [asset('a1', 'p1'), tool], edges: [edge('e1', 'a1', 'op', 'input', { pin: 'stale-revision' })] });
    expect(runProblems(g(), ['op'], storeEnv())[0]).toContain('input cable is invalid');
  });
  it('a revised asset changes the approval and the freshness signature', async () => {
    setGraph({ nodes: [asset('a1', 'p1'), gen], edges: [edge('e1', 'a1', 'gen', 'ref')] });
    const asset1 = { id: 'p1', kind: 'image' } as never;
    useStore.setState({ assets: { p1: asset1 } });
    const before = previewRun(HOME, ['gen']).signature;
    useStore.setState({ assets: { p1: { id: 'p1', kind: 'image', revisions: [{ assetId: 'old' }, { assetId: 'p1' }], revisionIndex: 1 } as never } });
    expect(previewRun(HOME, ['gen']).signature).not.toBe(before);
  });
});

describe('review finding 3: the interface Run goes through the action registry', () => {
  it('a confirmation id runs once, even if the provider answer is lost', async () => {
    setGraph({ nodes: [text('t', 'red'), gen], edges: [edge('e1', 't', 'gen', 'prompt')] });
    const preview = await prepareNodeRun(HOME, ['gen']);
    execute.mockImplementation(async (_s, ctx) => { ctx.onState('gen', 'running', { generationId: 'g9' }); throw new Error('connection lost'); });
    const first = await runApproved(HOME, ['gen'], true, preview, 'confirm-1');
    expect(first).toMatchObject({ status: 'failed', sends: 1 });
    patchNodeData(HOME, 'gen', { modelRef: 'local::other' }); // the user changes the model, then presses Run again
    const retry = await runApproved(HOME, ['gen'], true, preview, 'confirm-1');
    expect(retry).toMatchObject({ status: 'failed', sends: 1 });
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it('the approval of a stale preview does not run', async () => {
    setGraph({ nodes: [text('t', 'red'), gen], edges: [edge('e1', 't', 'gen', 'prompt')] });
    const preview = await prepareNodeRun(HOME, ['gen']);
    patchNodeData(HOME, 't', { text: 'blue' });
    expect((await runApproved(HOME, ['gen'], true, preview, 'confirm-2')).status).toBe('stale');
    expect(execute).not.toHaveBeenCalled();
  });
});
