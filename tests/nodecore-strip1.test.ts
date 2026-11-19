import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Generation, Graph } from '../src/engine/types';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener() {} }, document: { addEventListener() {}, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async (id: string) => id }));
// The simulated provider: no network, no spend. Every call is observable.
const execute = vi.hoisted(() => vi.fn());
vi.mock('../src/engine/executor', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/engine/executor')>()), executeSteps: execute }));

import { useStore } from '../src/store/store';
import { nodeRequest, stable } from '../src/engine/flow/freshness';
import { previewRun, patchNodeData, deleteNodes } from '../src/engine/flow/actions';
import { prepareAction, recordOf, resetActions, runAction } from '../src/engine/nodecore/action';
import { inspectNode } from '../src/engine/nodecore/inspect';
import { applyEdit } from '../src/engine/nodecore/edit';
import { ownerRev } from '../src/engine/nodecore/revision';

const settings = { count: 1, advanced: {} };
const graph = (): Graph => ({
  nodes: [
    { id: 'text', position: { x: 0, y: 0 }, data: { kind: 'text', title: 'Prompt', text: 'a red fox' } },
    { id: 'gen', position: { x: 300, y: 0 }, data: { kind: 'image', title: 'Image', prompt: '', modelRef: 'local::image', settings: { ...settings }, outputIndex: 0, generationId: 'g1' } },
  ],
  edges: [{ id: 'e1', source: 'text', target: 'gen', sourceHandle: 'out', targetHandle: 'prompt' }],
});
const HOME = useStore.getState().activeSessionId;
let A: string, B: string;
const g = (sid: string) => useStore.getState().sessions[sid].graph;
/** The provider finished: a result exists and its request signature is the current one. */
function finishedResult() {
  const st = useStore.getState();
  const gen = g(A).nodes.find((n) => n.id === 'gen')!;
  const done = { id: 'g1', status: 'done', assetIds: ['a1'], inputs: { refs: [] }, prompt: 'a red fox', settings, modelRef: 'local::image', sessionId: A } as unknown as Generation;
  done.nodeRequest = stable(nodeRequest(g(A), gen, { g1: done }, st.library));
  useStore.setState({ generations: { g1: done }, assets: { a1: { id: 'a1', kind: 'image' } as never } });
}
beforeEach(() => {
  execute.mockReset(); resetActions();
  const st = useStore.getState();
  A = HOME; B = 'session-b';
  useStore.setState({ activeSessionId: A, sessions: { ...st.sessions, [A]: { ...st.sessions[A], graph: graph() }, [B]: { ...st.sessions[A], id: B, graph: { nodes: [], edges: [] } } }, generations: {} });
  finishedResult();
});

describe('strip 1: text → generation in Omni (ADR 0031 acceptance)', () => {
  it('an edit updates the preview', async () => {
    expect(previewRun(A, ['gen']).steps.find((s) => s.id === 'text')).toMatchObject({ text: 'a red fox' });
    patchNodeData(A, 'text', { text: 'a blue fox' });
    expect(previewRun(A, ['gen']).steps.find((s) => s.id === 'text')).toMatchObject({ text: 'a blue fox' });
    expect(inspectNode(A, 'gen')?.inputs[0]).toMatchObject({ port: 'prompt', status: 'ok', value: 'a blue fox' });
  });

  it('an edit makes the old result and the old approval stale without generating', async () => {
    expect(inspectNode(A, 'gen')).toMatchObject({ fresh: true });
    const prepared = await prepareAction(A, ['gen'], false);
    if (!prepared.ok) throw new Error(prepared.errors.join());
    patchNodeData(A, 'text', { text: 'a blue fox' });
    const now = inspectNode(A, 'gen')!;
    expect(now.fresh).toBe(false);
    expect(now.staleReason).toContain('changed');
    const record = await runAction(prepared.snapshot);
    expect(record.status).toBe('stale');
    expect(execute).not.toHaveBeenCalled();
    expect(Object.keys(useStore.getState().generations)).toEqual(['g1']); // nothing new was created
  });

  it('an approved run stays tied to its session when the view changes', async () => {
    patchNodeData(A, 'text', { text: 'a green fox' });
    const prepared = await prepareAction(A, ['gen']);
    if (!prepared.ok) throw new Error(prepared.errors.join());
    execute.mockImplementation(async (_steps, ctx) => { ctx.onState('gen', 'running', { generationId: 'g2' }); return { outputs: new Map(), failed: [], skipped: [], waiting: [] }; });
    useStore.setState({ activeSessionId: B }); // the user moved elsewhere
    const record = await runAction(prepared.snapshot, 'run-1');
    expect(execute.mock.calls[0][1]).toMatchObject({ sessionId: A, origin: 'node' });
    expect(record).toMatchObject({ session: A, status: 'done', sends: 1 });
    expect(g(B).nodes).toEqual([]);
  });

  it('a retry with the same run id does not send again', async () => {
    patchNodeData(A, 'text', { text: 'a green fox' });
    const prepared = await prepareAction(A, ['gen']);
    if (!prepared.ok) throw new Error(prepared.errors.join());
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    execute.mockImplementation(async (_s, ctx) => { ctx.onState('gen', 'running', { generationId: 'g2' }); await gate; return { outputs: new Map(), failed: [], skipped: [], waiting: [] }; });
    const first = runAction(prepared.snapshot, 'run-1');
    const second = runAction(prepared.snapshot, 'run-1'); // retried while it runs (a double click, a reconnect)
    release();
    expect(await second).toBe(await first);
    expect(await runAction(prepared.snapshot, 'run-1')).toMatchObject({ status: 'done', sends: 1 }); // and after it finished
    expect(execute).toHaveBeenCalledTimes(1);
    expect(recordOf('run-1')?.sends).toBe(1);
  });

  it('a failed run is kept as it is: the same id never resends, a new approval and id do', async () => {
    patchNodeData(A, 'text', { text: 'a green fox' });
    const prepared = await prepareAction(A, ['gen']);
    if (!prepared.ok) throw new Error(prepared.errors.join());
    execute.mockImplementationOnce(async (_s, ctx) => { ctx.onState('gen', 'running', { generationId: 'g2' }); return { outputs: new Map(), failed: [{ stepId: 'gen', error: 'provider down' }], skipped: [], waiting: [] }; });
    expect(await runAction(prepared.snapshot, 'run-1')).toMatchObject({ status: 'failed', error: 'provider down', sends: 1 });
    expect(await runAction(prepared.snapshot, 'run-1')).toMatchObject({ status: 'failed', sends: 1 });
    expect(execute).toHaveBeenCalledTimes(1);
    const again = await prepareAction(A, ['gen']);
    if (!again.ok) throw new Error(again.errors.join());
    expect(await runAction(again.snapshot, 'run-1')).toMatchObject({ status: 'stale', error: expect.stringContaining('another approval') });
    execute.mockImplementationOnce(async (_s, ctx) => { ctx.onState('gen', 'running', { generationId: 'g3' }); return { outputs: new Map(), failed: [], skipped: [], waiting: [] }; });
    expect(await runAction(again.snapshot, 'run-2')).toMatchObject({ status: 'done', sends: 1 });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('deleting the source leaves an invalid cable; deleting the destination refuses the approved action', async () => {
    patchNodeData(A, 'text', { text: 'x' });
    const prepared = await prepareAction(A, ['gen']);
    if (!prepared.ok) throw new Error(prepared.errors.join());
    deleteNodes(A, ['gen']);
    expect(await runAction(prepared.snapshot)).toMatchObject({ status: 'stale', error: expect.stringContaining('destination node gen was deleted') });
    expect(execute).not.toHaveBeenCalled();
  });

  it('the source deleted leaves the cable visible to the inspector as invalid', () => {
    deleteNodes(A, ['text']);
    expect(inspectNode(A, 'gen')?.inputs).toEqual([expect.objectContaining({ port: 'prompt', status: 'invalid', broken: true })]);
    expect(g(A).edges).toEqual([]);
    expect(g(A).broken).toHaveLength(1);
  });

  it('an edit made on a stale base is refused and kept as a draft', () => {
    const rev = ownerRev(g(A), 'text');
    patchNodeData(A, 'text', { text: 'someone else' });
    const done = applyEdit({ session: A, expect: { text: rev }, op: { op: 'set', node: 'text', patch: { text: 'mine' } } });
    expect(done.ok).toBe(false);
    expect(!done.ok && done.draft.op).toMatchObject({ patch: { text: 'mine' } });
  });
});
