import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Generation, Graph, GraphNode } from '../src/engine/types';

vi.hoisted(() => Object.assign(globalThis, {
  window: { setTimeout, clearTimeout, addEventListener() {} },
  document: { addEventListener() {}, visibilityState: 'visible' },
}));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async (id: string) => id,
}));
const execute = vi.hoisted(() => vi.fn<typeof import('../src/engine/executor').executeSteps>());
vi.mock('../src/engine/executor', async (original) => ({
  ...(await original<typeof import('../src/engine/executor')>()), executeSteps: execute,
}));

import { command, invoke, run } from '../src/engine/commands';
import { patchNodeData, prepareNodeRun, tryConnect } from '../src/engine/flow/actions';
import { copyNodes, pasteNodes } from '../src/engine/flow/arrange';
import { resetActions, runApproved } from '../src/engine/nodecore/action';
import { createSession, useStore } from '../src/store/store';

const position = { x: 0, y: 0 };
const settings = { count: 1, advanced: {} };
const text = (id: string): GraphNode => ({ id, position, data: { kind: 'text', title: id, text: 'red' } });
const image = (id: string): GraphNode => ({ id, position, data: { kind: 'image', title: id, prompt: 'local prompt', modelRef: 'local::image', settings, outputIndex: 0 } });
let session: string;
const graph = () => useStore.getState().sessions[session].graph;
const arrange = (initial: Graph) => {
  const entry = { ...createSession('Node edit adversarial'), graph: initial };
  session = entry.id;
  useStore.setState({ activeSessionId: session, sessions: { [session]: entry }, generations: {} });
};
const call = (cmd: string, args: unknown) => run({ cmd, args, on: { session } }, { caller: 'agent' });
const inspect = (node: string) => invoke(command('nodes.node.inspect')!, { node }, { session }).inspection;
const fetchSpy = vi.fn(async () => { throw new Error('Unexpected network request'); });

beforeEach(() => {
  execute.mockReset();
  resetActions();
  vi.stubGlobal('fetch', fetchSpy);
});

describe('public graph editing and inspector boundaries', () => {
  it('rejects a delayed legacy command that submits settings without the revision it read', async () => {
    arrange({ nodes: [image('gen')], edges: [] });
    const before = inspect('gen').revision;
    expect(patchNodeData(session, 'gen', { settings: { ...settings, count: 3 } })).toBeNull();
    expect(inspect('gen').revision).not.toBe(before);
    const stale = await call('nodes.node.edit', { node: 'gen', patch: { settings: { ...settings, count: 1, aspect: '16:9' } } });
    expect.soft(stale.ok).toBe(false);
    expect(graph().nodes[0].data).toMatchObject({ settings: { count: 3 } });
  });

  it('rejects a replacement precondition naming a live cable on another node', async () => {
    arrange({ nodes: [text('source'), text('other'), image('destination'), image('unrelated')], edges: [] });
    expect(tryConnect(session, { source: 'other', target: 'unrelated', targetHandle: 'prompt' })).toBe(true);
    const [elsewhere] = graph().edges;
    const result = await call('nodes.edit.connect', {
      source: 'source', target: 'destination', targetHandle: 'prompt', replaces: elsewhere.id,
      expect: { destination: inspect('destination').revision },
    });
    expect.soft(result.ok).toBe(false);
    expect(graph().edges).toEqual([elsewhere]);
  });

  it('refuses an evaluable cycle that combines a data cable and a subject binding', async () => {
    arrange({ nodes: [image('source'), image('consumer')], edges: [] });
    expect(tryConnect(session, { source: 'source', target: 'consumer', targetHandle: 'ref' })).toBe(true);
    const graphBefore = structuredClone(graph());
    const result = await call('nodes.edit.set', {
      node: 'source', patch: { subjects: [{ name: 'Product', from: 'consumer#1' }] },
      expect: { source: inspect('source').revision },
    });
    expect(result).toMatchObject({ ok: false, error: { message: expect.stringContaining('loop') } });
    expect(graph()).toEqual(graphBefore);
  });

  it('does not restore a cable that would close a cycle through a subject after another edit', async () => {
    arrange({ nodes: [image('alpha'), image('bravo'), image('charlie')], edges: [] });
    expect(patchNodeData(session, 'alpha', { subjects: [{ name: 'Product', from: 'charlie' }] })).toBeNull();
    expect(tryConnect(session, { source: 'alpha', target: 'bravo', targetHandle: 'ref' })).toBe(true);
    const removed = await call('nodes.node.delete_with_undo', { nodes: ['alpha'] });
    expect(removed.ok).toBe(true);
    const { deleted } = removed.results[0] as { deleted: unknown };
    expect(tryConnect(session, { source: 'bravo', target: 'charlie', targetHandle: 'ref' })).toBe(true);
    await call('nodes.node.restore', { deleted });
    expect(graph().edges.map(({ source, target }) => [source, target])).toEqual([['bravo', 'charlie']]);
  });

  it('preserves a pinned incoming reference when pasting its consumer', () => {
    arrange({ nodes: [text('source'), image('gen')], edges: [{ id: 'pinned', source: 'source', sourceHandle: 'out', target: 'gen', targetHandle: 'prompt', pin: 'stale-revision' }] });
    expect(inspect('gen').inputs).toEqual([expect.objectContaining({ status: 'invalid', pinMoved: true })]);
    expect(copyNodes(session, ['gen'])).toBe(1);
    const [pasted] = pasteNodes(session);
    expect(pasted).toBeTruthy();
    expect(inspect(pasted).inputs).toEqual([expect.objectContaining({ status: 'invalid', pinMoved: true })]);
  });

  it('keeps the last result attached to its producing run after a newer approval goes stale', async () => {
    arrange({ nodes: [image('gen')], edges: [] });
    const generation = { id: 'result', sessionId: session, kind: 'image', status: 'done', assetIds: ['simulated-image'], settings, inputs: { refs: [] } } as unknown as Generation;
    execute.mockImplementationOnce(async (_steps, context) => {
      useStore.setState({ generations: { [generation.id]: generation } });
      context.onState('gen', 'running', { generationId: generation.id });
      context.onState('gen', 'done');
      return { outputs: new Map(), failed: [], skipped: [], waiting: [] };
    });
    const first = await prepareNodeRun(session, ['gen']);
    expect(await runApproved(session, ['gen'], true, first, 'produced')).toMatchObject({ status: 'done', sends: 1 });
    expect(inspect('gen').lastRun).toMatchObject({ generationId: 'result', runId: 'produced', sends: 1 });
    const second = await prepareNodeRun(session, ['gen']);
    expect(patchNodeData(session, 'gen', { prompt: 'changed after preview' })).toBeNull();
    expect(await runApproved(session, ['gen'], true, second, 'never-sent')).toMatchObject({ status: 'stale', sends: 0 });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(inspect('gen').lastRun).toMatchObject({ generationId: 'result', runId: 'produced', sends: 1 });
  });
});
