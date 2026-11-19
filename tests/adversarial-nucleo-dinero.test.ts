import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Graph } from '../src/engine/types';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener() {} }, document: { addEventListener() {}, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async (id: string) => id }));
const execute = vi.hoisted(() => vi.fn());
vi.mock('../src/engine/executor', async (original) => ({ ...(await original<typeof import('../src/engine/executor')>()), executeSteps: execute }));

import { run } from '../src/engine/commands';
import { useStore } from '../src/store/store';
import { patchNodeData, prepareNodeRun, tryConnect } from '../src/engine/flow/actions';
import { recordOf, resetActions, runApproved } from '../src/engine/nodecore/action';
import { inspectNode } from '../src/engine/nodecore/inspect';
import { sourceValue, storeEnv } from '../src/engine/nodecore/resolver';

const HOME = useStore.getState().activeSessionId;
const text = (value: string) => ({ id: 'text', position: { x: 0, y: 0 }, data: { kind: 'text' as const, title: 'Text', text: value } });
const generator = (id: string) => ({ id, position: { x: 0, y: 0 }, data: { kind: 'image' as const, title: id, prompt: 'local fallback prompt', modelRef: 'local::image', settings: { count: 1, advanced: {} }, outputIndex: 0 } });
const graph = (): Graph => ({ nodes: [text('red'), generator('gen')], edges: [{ id: 'edge', source: 'text', target: 'gen', sourceHandle: 'out', targetHandle: 'prompt' }] });
const current = () => useStore.getState().sessions[HOME].graph;
const setGraph = (g: Graph) => useStore.setState((s) => ({ sessions: { ...s.sessions, [HOME]: { ...s.sessions[HOME], graph: g } } }));
const completed = () => ({ outputs: new Map(), failed: [], skipped: [], waiting: [] });

beforeEach(() => {
  execute.mockReset();
  resetActions();
  vi.stubGlobal('fetch', () => { throw new Error('Unexpected network request'); });
  const st = useStore.getState();
  useStore.setState({ activeSessionId: HOME, generations: {}, sessions: { ...st.sessions, [HOME]: { ...st.sessions[HOME], graph: graph(), feed: [], agent: { history: [], questionRound: 0, notes: [], busy: false }, agentLane: undefined, agentLanes: undefined } } });
});

describe('money boundaries through the reviewed Run path', () => {
  it('connecting a prompt updates the graph but never sends work', () => {
    setGraph({ nodes: [text('red'), generator('gen')], edges: [] });
    expect(tryConnect(HOME, { source: 'text', target: 'gen', targetHandle: 'prompt' })).toBe(true);
    expect(current().edges).toHaveLength(1);
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects a reviewed preview after the prompt changes without sending', async () => {
    const preview = await prepareNodeRun(HOME, ['gen']);
    patchNodeData(HOME, 'text', { text: 'blue' });
    expect(await runApproved(HOME, ['gen'], true, preview, 'changed')).toMatchObject({ status: 'stale' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('excludes an invalid pinned prompt from both inspection and the executed plan', async () => {
    const pin = sourceValue(current().nodes[0], {}, storeEnv()).revision!;
    setGraph({ nodes: [text('blue'), generator('gen')], edges: [{ ...current().edges[0], pin }] });
    expect(inspectNode(HOME, 'gen')?.inputs[0]).toMatchObject({ status: 'invalid', pinMoved: true });
    const preview = await prepareNodeRun(HOME, ['gen']);
    expect(preview.errors).toEqual([]);
    expect(preview.steps.some((step) => step.id === 'text')).toBe(false);
    execute.mockImplementation(async () => completed());
    expect(await runApproved(HOME, ['gen'], true, preview, 'pinned')).toMatchObject({ status: 'done' });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0].some((step: { id: string }) => step.id === 'text')).toBe(false);
    expect(execute.mock.calls[0][0]).toContainEqual(expect.objectContaining({ id: 'gen', prompt: 'local fallback prompt' }));
  });

  it('joins an in-flight confirmation and keeps its reviewed session after navigation', async () => {
    const preview = await prepareNodeRun(HOME, ['gen']);
    let complete!: (result: ReturnType<typeof completed>) => void;
    execute.mockImplementationOnce(async (_steps, context) => {
      context.onState('gen', 'running', { generationId: 'in-flight' });
      return new Promise((resolve) => { complete = resolve; });
    });
    const first = runApproved(HOME, ['gen'], true, preview, 'in-flight');
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    useStore.setState((st) => ({
      activeSessionId: 'other-session',
      sessions: { ...st.sessions, 'other-session': { ...st.sessions[HOME], id: 'other-session', graph: graph() } },
    }));
    const second = runApproved(HOME, ['gen'], true, preview, 'in-flight');
    complete(completed());
    for (const record of await Promise.all([first, second])) {
      expect(record).toMatchObject({ status: 'done', session: HOME, targets: ['gen'], sends: 1 });
    }
    expect(execute).toHaveBeenCalledExactlyOnceWith(preview.steps, expect.objectContaining({ sessionId: HOME }));
  });

  it('reconciles a lost provider response under the same confirmation id', async () => {
    const preview = await prepareNodeRun(HOME, ['gen']);
    execute.mockImplementationOnce(async (_steps, context) => {
      context.onState('gen', 'running', { generationId: 'accepted-remotely' });
      throw new Error('response lost after acceptance');
    });
    expect(await runApproved(HOME, ['gen'], true, preview, 'uncertain')).toMatchObject({ status: 'failed', sends: 1 });
    patchNodeData(HOME, 'text', { text: 'different request' });
    expect(await runApproved(HOME, ['gen'], true, preview, 'uncertain')).toMatchObject({ status: 'failed', sends: 1 });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(recordOf('uncertain')?.session).toBe(HOME);
  });

  it('rejects reuse of a confirmation id for a different destination', async () => {
    setGraph({ ...graph(), nodes: [...graph().nodes, generator('other')] });
    const preview = await prepareNodeRun(HOME, ['gen']);
    execute.mockImplementation(async () => completed());
    await runApproved(HOME, ['gen'], true, preview, 'same-id');
    expect(await runApproved(HOME, ['other'], true, preview, 'same-id')).toMatchObject({ status: 'stale' });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('requires a fresh prepared approval before retrying an uncertain send with a new command run id', async () => {
    const on = { session: HOME };
    const options = { caller: 'cli' as const, approver: () => true };
    const prepared = await run({ cmd: 'nodes.action.prepare', args: { targets: ['gen'] }, on }, options);
    expect(prepared.ok).toBe(true);
    const { approval } = prepared.results[0] as { approval: string };
    execute.mockImplementationOnce(async (_steps, context) => {
      context.onState('gen', 'running', { generationId: 'accepted-once' });
      throw new Error('response lost after acceptance');
    }).mockResolvedValue(completed());
    const launch = (runId: string) => run({ cmd: 'nodes.action.run', args: { approval, runId }, on }, options);
    expect(await launch('command-first')).toMatchObject({ ok: false, error: { message: 'response lost after acceptance' } });
    expect.soft((await launch('command-retry')).ok).toBe(false);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
