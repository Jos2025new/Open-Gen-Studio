import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Generation, Graph } from '../src/engine/types';

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
  ...(await original<typeof import('../src/engine/executor')>()),
  executeSteps: execute,
}));

import { command, invoke, run } from '../src/engine/commands';
import { finish } from '../src/engine/jobState';
import { patchNodeData, prepareNodeRun } from '../src/engine/flow/actions';
import { resetActions, runApproved } from '../src/engine/nodecore/action';
import { sourceValue, storeEnv } from '../src/engine/nodecore/resolver';
import { createSession, useStore } from '../src/store/store';

const settings = { count: 1, advanced: {} };
const pos = { x: 0, y: 0 };
const textNode = (id: string, text: string) => ({ id, position: pos, data: { kind: 'text' as const, title: id, text } });
const imageNode = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  position: pos,
  data: { kind: 'image' as const, title: id, prompt: 'local prompt', modelRef: 'local::image', settings, outputIndex: 0, ...extra },
});
const completed = () => ({ outputs: new Map(), failed: [], skipped: [], waiting: [] });

function deliverNodeResult(ctx: Parameters<typeof execute>[1], stepId: string, result: Generation) {
  useStore.setState((st) => ({
    generations: { ...st.generations, [result.id]: {
      ...result, origin: 'node', stepId, status: 'running', assetIds: [], createdAt: Date.now(),
      modelRef: 'local::image', estimate: { usd: 0, approximate: false },
    } },
  }));
  ctx.onState(stepId, 'running', { generationId: result.id });
  finish(result.id, result.assetIds, 0);
  ctx.onState(stepId, 'done');
}

let sid: string;
const install = (g: Graph, extra: Record<string, unknown> = {}) => {
  const s = { ...createSession('Money adversarial neon'), graph: g };
  sid = s.id;
  useStore.setState({
    activeSessionId: sid,
    sessions: { [sid]: s },
    generations: {},
    assets: {},
    spentUsd: 0,
    ...extra,
  });
};
const inspect = (node: string) => invoke(command('nodes.node.inspect')!, { node }, { session: sid }).inspection;

beforeEach(() => {
  execute.mockReset();
  resetActions();
  vi.stubGlobal('fetch', () => { throw new Error('Unexpected network request'); });
});

describe('money, approvals and inspector attribution (neon adversarial)', () => {
  it('blocks double spend when the same prepared approval is passed to nodes.action.run a second time after succeeding', async () => {
    install({
      nodes: [textNode('t', 'red'), imageNode('gen')],
      edges: [{ id: 'e1', source: 't', target: 'gen', sourceHandle: 'out', targetHandle: 'prompt' }],
    });
    const opts = { caller: 'cli' as const, approver: () => true };
    const prep = await run({ cmd: 'nodes.action.prepare', args: { targets: ['gen'] }, on: { session: sid } }, opts);
    expect(prep.ok).toBe(true);
    const { approval } = prep.results[0] as { approval: string };

    let genSeq = 0;
    execute.mockImplementation(async (_steps, ctx) => {
      const gid = `g-${++genSeq}`;
      useStore.setState((st) => ({
        generations: { ...st.generations, [gid]: { id: gid, sessionId: sid, kind: 'image', status: 'done', assetIds: [`a-${genSeq}`], settings, inputs: { refs: [] } } as unknown as Generation },
      }));
      ctx.onState('gen', 'running', { generationId: gid });
      ctx.onState('gen', 'done');
      return completed();
    });

    const first = await run({ cmd: 'nodes.action.run', args: { approval }, on: { session: sid } }, opts);
    expect(first.ok).toBe(true);
    const second = await run({ cmd: 'nodes.action.run', args: { approval }, on: { session: sid } }, opts);
    expect(second.ok).toBe(false);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('allows a fresh UI confirmation to retry a node after an earlier failed run without mutating parameters', async () => {
    install({
      nodes: [textNode('t', 'red'), imageNode('gen')],
      edges: [{ id: 'e1', source: 't', target: 'gen', sourceHandle: 'out', targetHandle: 'prompt' }],
    });
    execute.mockImplementationOnce(async (_steps, ctx) => {
      ctx.onState('gen', 'running', { generationId: 'g-lost' });
      throw new Error('provider 500');
    }).mockImplementationOnce(async (_steps, ctx) => {
      ctx.onState('gen', 'running', { generationId: 'g-ok' });
      ctx.onState('gen', 'done');
      return completed();
    });

    const firstPreview = await prepareNodeRun(sid, ['gen']);
    const failed = await runApproved(sid, ['gen'], true, firstPreview, 'ui-confirm-1');
    expect(failed).toMatchObject({ status: 'failed', sends: 1 });

    // The user opens Run again in the UI (fresh preview + fresh confirmId) and explicitly confirms a retry.
    const secondPreview = await prepareNodeRun(sid, ['gen']);
    const retried = await runApproved(sid, ['gen'], true, secondPreview, 'ui-confirm-2');
    expect(retried).toMatchObject({ status: 'done', sends: 1 });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('does not re-run a stale upstream node when the downstream link is pinned to its finished revision', async () => {
    const doneGen = {
      id: 'gA1', sessionId: sid, kind: 'image', status: 'done', prompt: 'red', modelRef: 'local::image',
      assetIds: ['assetA1'], settings, inputs: { refs: [] },
    } as unknown as Generation;
    install({
      nodes: [imageNode('imgA', { prompt: 'red', generationId: 'gA1' }), imageNode('imgB', { prompt: 'variation' })],
      edges: [{ id: 'e1', source: 'imgA', target: 'imgB', sourceHandle: 'out', targetHandle: 'ref' }],
    }, {
      generations: { gA1: doneGen },
      assets: { assetA1: { id: 'assetA1', kind: 'image', name: 'A1' } },
    });
    const pin = sourceValue(useStore.getState().sessions[sid].graph.nodes[0], {}, storeEnv()).revision!;
    expect(pin).toBe('gA1:assetA1');
    useStore.setState((st) => ({
      sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], graph: { ...st.sessions[sid].graph, edges: [{ ...st.sessions[sid].graph.edges[0], pin }] } } },
    }));

    // User edits imgA prompt without regenerating imgA: imgA is stale, but still holds gA1:assetA1.
    expect(patchNodeData(sid, 'imgA', { prompt: 'blue' })).toBeNull();
    const preview = await prepareNodeRun(sid, ['imgB'], true);
    expect(preview.errors).toEqual([]);
    expect(preview.runIds).toEqual(['imgB']);
    expect(preview.steps).toEqual([expect.objectContaining({ id: 'imgB', refs: ['asset:assetA1'] })]);
  });

  it('does not attribute a generation produced by nodes.run.start to an older action runId in the inspector', async () => {
    install({
      nodes: [imageNode('gen')],
      edges: [],
    });
    const opts = { caller: 'cli' as const, approver: () => true };

    const g1 = { id: 'g-first', sessionId: sid, kind: 'image', status: 'done', assetIds: ['a1'], settings, inputs: { refs: [] } } as unknown as Generation;
    execute.mockImplementationOnce(async (_steps, ctx) => {
      deliverNodeResult(ctx, 'gen', g1);
      return completed();
    });
    const prep = await run({ cmd: 'nodes.action.prepare', args: { targets: ['gen'] }, on: { session: sid } }, opts);
    const { approval } = prep.results[0] as { approval: string };
    expect((await run({ cmd: 'nodes.action.run', args: { approval, runId: 'run-old' }, on: { session: sid } }, opts)).ok).toBe(true);

    const g2 = { id: 'g-second', sessionId: sid, kind: 'image', status: 'done', assetIds: ['a2'], settings, inputs: { refs: [] } } as unknown as Generation;
    execute.mockImplementationOnce(async (_steps, ctx) => {
      deliverNodeResult(ctx, 'gen', g2);
      return completed();
    });
    expect((await run({ cmd: 'nodes.run.start', args: { targets: ['gen'] }, on: { session: sid } }, opts)).ok).toBe(true);

    const lastRun = inspect('gen').lastRun;
    expect(lastRun?.generationId).toBe('g-second');
    expect(lastRun?.runId).not.toBe('run-old');
  });

  it('attributes an upstream node generation produced during a downstream run to that downstream runId', async () => {
    install({
      nodes: [imageNode('imgA', { prompt: 'v1' }), imageNode('imgB', { prompt: 'use A' })],
      edges: [{ id: 'e1', source: 'imgA', target: 'imgB', sourceHandle: 'out', targetHandle: 'ref' }],
    });
    const opts = { caller: 'cli' as const, approver: () => true };

    const gA1 = { id: 'gA1', sessionId: sid, kind: 'image', status: 'done', prompt: 'v1', modelRef: 'local::image', assetIds: ['a1'], settings, inputs: { refs: [] } } as unknown as Generation;
    execute.mockImplementationOnce(async (_steps, ctx) => {
      useStore.setState((st) => ({ assets: { ...st.assets, a1: { id: 'a1', kind: 'image', name: 'a1' } as never } }));
      deliverNodeResult(ctx, 'imgA', gA1);
      return completed();
    });
    const p1 = await run({ cmd: 'nodes.action.prepare', args: { targets: ['imgA'] }, on: { session: sid } }, opts);
    await run({ cmd: 'nodes.action.run', args: { approval: (p1.results[0] as { approval: string }).approval, runId: 'run-A1' }, on: { session: sid } }, opts);

    // Edit imgA so running imgB must regenerate imgA upstream.
    expect(patchNodeData(sid, 'imgA', { prompt: 'v2' })).toBeNull();
    const gA2 = { id: 'gA2', sessionId: sid, kind: 'image', status: 'done', prompt: 'v2', modelRef: 'local::image', assetIds: ['a2'], settings, inputs: { refs: [] } } as unknown as Generation;
    const gB2 = { id: 'gB2', sessionId: sid, kind: 'image', status: 'done', prompt: 'use A', modelRef: 'local::image', assetIds: ['b2'], settings, inputs: { refs: ['a2'] } } as unknown as Generation;
    execute.mockImplementationOnce(async (_steps, ctx) => {
      useStore.setState((st) => ({
        assets: { ...st.assets, a2: { id: 'a2', kind: 'image', name: 'a2' } as never, b2: { id: 'b2', kind: 'image', name: 'b2' } as never },
      }));
      deliverNodeResult(ctx, 'imgA', gA2);
      deliverNodeResult(ctx, 'imgB', gB2);
      return completed();
    });
    const p2 = await run({ cmd: 'nodes.action.prepare', args: { targets: ['imgB'] }, on: { session: sid } }, opts);
    expect(p2.ok).toBe(true);
    await run({ cmd: 'nodes.action.run', args: { approval: (p2.results[0] as { approval: string }).approval, runId: 'run-B2' }, on: { session: sid } }, opts);

    expect(inspect('imgA').lastRun).toMatchObject({ generationId: 'gA2', runId: 'run-B2' });
  });

  it('does not attribute a pre-existing saved generation to a later failed run', async () => {
    const saved = { id: 'g-saved', sessionId: sid, kind: 'image', status: 'done', prompt: 'local prompt', modelRef: 'local::image', assetIds: ['a0'], settings, inputs: { refs: [] } } as unknown as Generation;
    install({ nodes: [imageNode('gen', { generationId: 'g-saved' })], edges: [] }, { generations: { 'g-saved': saved } });

    execute.mockImplementationOnce(async (_steps, ctx) => {
      ctx.onState('gen', 'running', { generationId: 'g-failed' });
      throw new Error('provider failed');
    });
    const preview = await prepareNodeRun(sid, ['gen']);
    expect(await runApproved(sid, ['gen'], true, preview, 'run-failed')).toMatchObject({ status: 'failed', sends: 1 });

    const lastRun = inspect('gen').lastRun;
    expect(lastRun?.generationId).toBe('g-saved');
    expect(lastRun?.runId).toBeUndefined();
  });

  it('enforces a lowered spending limit between nodes.action.prepare and nodes.action.run before sending', async () => {
    const price = { skus: [{ unit: 'output' as const, usd: 1.5 }] };
    const model = { ref: 'fal::paid-img', provider: 'fal', id: 'paid-img', name: 'Paid', kind: 'image', acceptsText: true, price };
    const schema = { ref: 'fal::paid-img', params: [], slots: { prompt: 'prompt' }, price, source: 'provider' };
    install({
      nodes: [imageNode('gen', { modelRef: 'fal::paid-img' })],
      edges: [],
    }, {
      catalog: {
        ...useStore.getState().catalog,
        models: { ...useStore.getState().catalog.models, 'fal::paid-img': model as never },
        schemas: { ...useStore.getState().catalog.schemas, 'fal::paid-img': schema as never },
      },
      settings: { ...useStore.getState().settings, keys: { ...useStore.getState().settings.keys, fal: 'sk-fal' }, budgetOn: true, budgetUsd: 5, budgetNoAsk: false, budgetAccepted: undefined },
    });
    const opts = { caller: 'cli' as const, approver: () => true };
    const prep = await run({ cmd: 'nodes.action.prepare', args: { targets: ['gen'] }, on: { session: sid } }, opts);
    expect(prep.ok).toBe(true);
    const { approval, estimate } = prep.results[0] as { approval: string; estimate: number };
    expect(estimate).toBe(1.5);

    useStore.setState((st) => ({ settings: { ...st.settings, budgetUsd: 0.5 } }));
    const blocked = await run({ cmd: 'nodes.action.run', args: { approval, runId: 'over-budget' }, on: { session: sid } }, opts);
    expect(blocked.ok).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects running an approval prepared for session A against session B', async () => {
    install({ nodes: [imageNode('gen')], edges: [] });
    const other = { ...createSession('Other session'), graph: { nodes: [imageNode('gen')], edges: [] } };
    useStore.setState((st) => ({ sessions: { ...st.sessions, [other.id]: other } }));
    const opts = { caller: 'cli' as const, approver: () => true };
    const prep = await run({ cmd: 'nodes.action.prepare', args: { targets: ['gen'] }, on: { session: sid } }, opts);
    expect(prep.ok).toBe(true);
    const { approval } = prep.results[0] as { approval: string };

    const cross = await run({ cmd: 'nodes.action.run', args: { approval, runId: 'cross-session' }, on: { session: other.id } }, opts);
    expect(cross.ok).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });
});
