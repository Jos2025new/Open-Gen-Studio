import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Asset, Graph, GraphNode } from '../src/engine/types';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener() {} }, document: { addEventListener() {}, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));

import { deleteNodes, previewRun, restoreNodeDeletion, setNodeModel, setNodeOp, tryConnect } from '../src/engine/flow/actions';
import { graphToSteps } from '../src/engine/flow/graph';
import { runProblems } from '../src/engine/nodecore/guard';
import { resolveInputs, sourceValue, storeEnv } from '../src/engine/nodecore/resolver';
import { useStore } from '../src/store/store';

const sessionId = useStore.getState().activeSessionId;
const settings = { count: 1, advanced: {} };
const position = { x: 0, y: 0 };
const prompt = (text = 'A'): GraphNode => ({ id: 'text', position, data: { kind: 'text', title: 'Text', text } });
const image = (value = ''): GraphNode => ({ id: 'image', position, data: { kind: 'image', title: 'Image', modelRef: 'local::image', prompt: value, outputIndex: 0, settings } });
const tool: GraphNode = { id: 'tool', position, data: { kind: 'tool', title: 'Split', op: 'grid_split', params: {}, outputIndex: 0 } };
const asset: GraphNode = { id: 'asset', position, data: { kind: 'asset', title: 'Asset', assetId: 'picture' } };
const cable = (source: string, target: string, targetHandle: string, pin?: string) => ({ id: 'cable', source, target, sourceHandle: 'out', targetHandle, ...(pin ? { pin } : {}) });
const assets = { picture: { id: 'picture', kind: 'image' } as Asset };
const current = () => useStore.getState().sessions[sessionId].graph;
const load = (graph: Graph) => useStore.setState(s => ({ assets, sessions: { ...s.sessions, [sessionId]: { ...s.sessions[sessionId], graph, feed: [] } } }));

beforeEach(() => load({ nodes: [], edges: [] }));

describe('canvas notices', () => {
  it('retains the operation cable and revives the same edge when the port fits again', () => {
    const edge = cable('asset', 'tool', 'input');
    load({ nodes: [asset, tool], edges: [edge] });
    expect(setNodeOp(sessionId, 'tool', 'video_upscale')).toBeNull();
    expect(current().edges).toEqual([edge]);
    expect(resolveInputs(current(), current().nodes[1], storeEnv())[0]).toMatchObject({ status: 'invalid', reason: 'Input expects video, got image.', value: null });
    expect(previewRun(sessionId, ['tool']).inputIds).toEqual(['tool']);
    expect(graphToSteps(current(), ['tool'], {}, { assets }).steps[0]).toMatchObject({ input: '' });
    expect(setNodeOp(sessionId, 'tool', 'grid_split')).toBeNull();
    expect(current().edges).toEqual([edge]);
    expect(graphToSteps(current(), ['tool'], {}, { assets }).steps[0]).toMatchObject({ input: 'asset:picture' });
  });

  it('retains an audio model cable when its output changes and runs the target using its local prompt', () => {
    const audio: GraphNode = { id: 'audio', position, data: { kind: 'audio', title: 'Audio', textOutput: true, modelRef: 'local::lyrics', prompt: 'lyrics', outputIndex: 0, settings } };
    const edge = cable('audio', 'image', 'prompt');
    load({ nodes: [audio, image('fallback')], edges: [edge] });
    expect(setNodeModel(sessionId, 'audio', { modelRef: 'local::audio', settings })).toBeNull();
    expect(current().edges).toEqual([edge]);
    expect(resolveInputs(current(), current().nodes[1], storeEnv())[0]).toMatchObject({ status: 'invalid', reason: 'Prompt expects text, got audio.' });
    expect(graphToSteps(current(), ['image'], {}, { assets })).toMatchObject({ runIds: ['image'], errors: [], steps: [{ prompt: 'fallback', promptFrom: undefined }] });
  });

  it('marks just the missing prompt after voluntary deletion and keeps the Undo entry', async () => {
    const { graphNotices } = await import('../src/engine/flow/notices');
    load({ nodes: [prompt(), image()], edges: [cable('text', 'image', 'prompt')] });
    expect(graphNotices(current(), storeEnv())).toEqual([]);
    expect(deleteNodes(sessionId, ['text'])).toBeNull();
    expect(current().edges).toEqual([]);
    expect(graphNotices(current(), storeEnv())).toEqual([expect.objectContaining({ nodeId: 'image', port: 'prompt', message: 'Missing prompt' })]);
    const notice = useStore.getState().sessions[sessionId].feed.find(f => f.type === 'notice' && f.undoNodes);
    expect(notice).toMatchObject({ undoNodes: { edges: [expect.objectContaining({ id: 'cable' })] } });
    expect(restoreNodeDeletion(sessionId, notice!.id)).toBeNull();
    expect(current().edges.map(e => e.id)).toEqual(['cable']);
    expect(graphNotices(current(), storeEnv())).toEqual([]);
    load({ nodes: [prompt('  '), image()], edges: [cable('text', 'image', 'prompt')] });
    expect(graphNotices(current(), storeEnv())).toEqual([expect.objectContaining({ message: 'Missing prompt' })]);
    expect(graphToSteps(current(), ['image'], {}, { assets }).errors).toEqual(['"Image" needs a prompt.']);
    load({ nodes: [image('local prompt')], edges: [] });
    expect(graphNotices(current(), storeEnv())).toEqual([]);
    load({ nodes: [image(), asset], edges: [cable('asset', 'image', 'ref')] });
    expect(graphNotices(current(), storeEnv())).toEqual([]);
  });

  it('still offers Undo when the deleted source is a prompt reference', async () => {
    const { graphNotices } = await import('../src/engine/flow/notices');
    const ref: GraphNode = { id: 'ref', position, data: { kind: 'ref', type: 'prompt', ref: 'custom', title: 'Prompt', promptText: 'Prompt text' } };
    load({ nodes: [ref, image()], edges: [cable('ref', 'image', 'prompt')] });
    expect(deleteNodes(sessionId, ['ref'])).toBeNull();
    const notice = useStore.getState().sessions[sessionId].feed.find(f => f.type === 'notice' && f.undoNodes);
    expect(notice).toBeDefined();
    expect(graphNotices(current(), storeEnv())).toEqual([expect.objectContaining({ kind: 'port', port: 'prompt' })]);
    expect(restoreNodeDeletion(sessionId, notice!.id)).toBeNull();
    expect(graphNotices(current(), storeEnv())).toEqual([]);
  });

  it('clears the required tool port after another source is wired in', async () => {
    const { graphNotices } = await import('../src/engine/flow/notices');
    const newAsset = { ...asset, id: 'replacement' };
    load({ nodes: [asset, newAsset, tool], edges: [cable('asset', 'tool', 'input')] });
    expect(deleteNodes(sessionId, ['asset'])).toBeNull();
    expect(graphNotices(current(), storeEnv())).toEqual([expect.objectContaining({ kind: 'port', port: 'input' })]);
    expect(tryConnect(sessionId, { source: 'replacement', target: 'tool', targetHandle: 'input' })).toBe(true);
    expect(graphNotices(current(), storeEnv())).toEqual([]);
    expect(runProblems(current(), ['tool'], storeEnv())).toEqual([]);
  });

  it('counts the graph notices represented by a closed container', async () => {
    const { graphNotices, countNotices } = await import('../src/engine/flow/notices');
    const notices = graphNotices({ nodes: [image(), tool, prompt()], edges: [] }, storeEnv());
    expect(notices.map(n => n.nodeId)).toEqual(['image', 'tool']);
    expect(countNotices(notices, ['image', 'text'])).toBe(1);
    expect(countNotices(notices, ['text'])).toBe(0);
  });

  it('marks a moved pin and explicitly adopts the displayed new revision', async () => {
    const { graphNotices, adoptCableRevision } = await import('../src/engine/flow/notices');
    const env = storeEnv();
    const pin = sourceValue(prompt(), {}, env).revision!;
    const changed = prompt('B');
    const next = sourceValue(changed, {}, env).revision!;
    load({ nodes: [changed, image('local')], edges: [cable('text', 'image', 'prompt', pin)] });
    expect(graphNotices(current(), env)).toEqual([expect.objectContaining({ edgeId: 'cable', kind: 'pin', pin, next })]);
    expect(adoptCableRevision(sessionId, 'cable', pin, 'obsolete')).toBe(false);
    expect(current().edges[0].pin).toBe(pin);
    expect(adoptCableRevision(sessionId, 'cable', pin, next)).toBe(true);
    expect(current().edges[0].pin).toBe(next);
    expect(graphToSteps(current(), ['image'], {}, { assets }).steps[0]).toMatchObject({ text: 'B' });
    expect(graphNotices(current(), env)).toEqual([]);
  });
});

it('ignores incompatible backlinks for connecting, cycle guards, consumers and execution order', async () => {
  const { connectionError, executionOrder } = await import('../src/engine/flow/graph');
  const { consumersOf, findCycle } = await import('../src/engine/nodecore/deps');
  const other = { ...image('other'), id: 'other' };
  const back = cable('other', 'image', 'prompt');
  const forward = { ...cable('image', 'other', 'ref'), id: 'forward' };
  const graph = { nodes: [image('local'), other], edges: [back] };
  const cyclicOnPaper = { ...graph, edges: [back, forward] };
  expect.soft(connectionError(graph, assets, forward)).toBeNull();
  expect.soft(executionOrder(graph, ['image'])).toEqual(['image']);
  expect.soft(findCycle(cyclicOnPaper)).toBeNull();
  expect.soft(consumersOf(cyclicOnPaper, ['other'])).toEqual([]);
  expect.soft(runProblems(cyclicOnPaper, ['image'], storeEnv())).toEqual([]);
  expect.soft(executionOrder(cyclicOnPaper, ['other'])).toEqual(['image', 'other']);
  load(graph);
  expect(tryConnect(sessionId, forward)).toBe(true);
  expect(connectionError(current(), assets, { ...back, targetHandle: 'ref' })).toMatch(/loop/);
  expect(findCycle({ ...cyclicOnPaper, edges: [{ ...back, targetHandle: 'ref' }, forward] })).not.toBeNull();
});

const inventories: Record<string, Asset>[] = [{}, { another: assets.picture }];
it.each(inventories)('marks a deleted asset with an explicit inventory %j', async inventory => {
  const { graphNotices } = await import('../src/engine/flow/notices');
  const graph = { nodes: [asset, tool], edges: [cable('asset', 'tool', 'input')] };
  expect(graphNotices(graph, { ...storeEnv(), assets: inventory })).toEqual([
    expect.objectContaining({ kind: 'cable', edgeId: 'cable', message: 'The source has no output yet.' }),
  ]);
});

it.each(['incompatible', 'expired pin'])('excludes an %s source from operation model selection', async reason => {
  const catalog = await import('../src/engine/catalog');
  const modelForAsset = vi.spyOn(catalog, 'opModelForAsset');
  try {
    const src = { ...asset, data: { ...asset.data, assetId: 'picture' } } as GraphNode;
    const edit: GraphNode = { ...tool, data: { kind: 'tool', title: 'Variations', op: 'variations', params: {}, outputIndex: 0 } };
    const graph = { nodes: [src, edit], edges: [cable('asset', 'tool', 'input', reason === 'expired pin' ? 'old' : undefined)] };
    load(graph);
    if (reason === 'incompatible') useStore.setState({ assets: { picture: { ...assets.picture, kind: 'video' } } });
    expect(previewRun(sessionId, ['tool']).steps).toMatchObject([{ input: '' }]);
    expect(modelForAsset).not.toHaveBeenCalled();
    load({ ...graph, edges: [cable('asset', 'tool', 'input')] });
    expect(previewRun(sessionId, ['tool']).steps).toMatchObject([{ input: 'asset:picture' }]);
    expect(modelForAsset).toHaveBeenCalledWith('edit', 'picture');
  } finally {
    modelForAsset.mockRestore();
  }
});
