import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async () => undefined }));
import { nodeIsCurrent, nodeRequest, stable } from '../src/engine/flow/freshness';
import { promptNodeText, promptsWiredToAgent, resolveSystemNodeLive } from '../src/engine/nodes/spec';
import { addSystemNode, ensureSystemNodes, linkSystemNodes } from '../src/engine/nodes/system';
import { createSession, useStore } from '../src/store/store';
import type { Asset, Generation, Graph, GraphNode } from '../src/engine/types';

let sid = '';
beforeEach(() => { const s = createSession('Adversarial references'); sid = s.id; useStore.setState(st => ({ activeSessionId: sid, sessions: { ...st.sessions, [sid]: s }, assets: {} })); ensureSystemNodes(sid); });
const graph = () => useStore.getState().sessions[sid].graph;

describe('adversarial reference contracts', () => {
  it('does not turn a renamed/missing catalog model into the current composer model', () => {
    const n: GraphNode = { id: 'missing-model', position: { x: 0, y: 0 }, data: { kind: 'ref', type: 'model', ref: 'gone::renamed-model', title: 'Old model' } };
    useStore.setState(st => ({ composer: { ...st.composer, image: { ...st.composer.image, modelRef: 'active::model' } } }));
    expect(resolveSystemNodeLive(sid, n)).toMatchObject({ invalid: expect.any(String) });
  });
  it('marks a linked asset revision change stale, including a content-only revision change', () => {
    const tool = { id: 'tool', position: { x: 0, y: 0 }, data: { kind: 'tool', title: 'Tool', op: 'relight', params: {}, generationId: 'g', outputIndex: 0 } } as unknown as GraphNode;
    const src = { id: 'asset-node', position: { x: 0, y: 0 }, data: { kind: 'asset', title: 'Asset', assetId: 'asset' } } as unknown as GraphNode;
    const g = { nodes: [tool, src], edges: [{ id: 'r', source: src.id, target: tool.id, kind: 'ref' }], groups: [] } as unknown as Graph;
    const a = { id: 'asset', kind: 'image', mime: 'image/png', width: 1, height: 1, createdAt: 1, revisions: [{ assetId: 'asset' }], revisionIndex: 0 } as unknown as Asset;
    const gen = { id: 'g', status: 'done', assetIds: ['out'], prompt: 'p', settings: { count: 1 }, inputs: { refs: [] } } as unknown as Generation;
    const saved = { ...gen, nodeRequest: stable(nodeRequest(g, tool, { g: gen }, [], { assets: { asset: a } })) } as Generation;
    expect(nodeIsCurrent(g, tool, { g: saved }, [], { assets: { asset: a } })).toBe(true);
    const edited = { ...a, revisions: [{ assetId: 'asset' }, { assetId: 'asset', changedAt: 2 }], revisionIndex: 1 } as unknown as Asset;
    expect(nodeIsCurrent(g, tool, { g: saved }, [], { assets: { asset: edited } })).toBe(false);
  });
  it('a deleted prompt edge cannot continue contributing stale text', () => {
    const prompt = addSystemNode(sid, { type: 'prompt', ref: 'note' });
    useStore.setState(st => ({
      sessions: { ...st.sessions, [sid]: {
        ...st.sessions[sid],
        graph: { ...st.sessions[sid].graph, nodes: st.sessions[sid].graph.nodes.map(n => n.id === prompt && n.data.kind === 'ref' ? { ...n, data: { ...n.data, promptText: 'stale secret' } } : n) },
      } },
    }));
    expect(linkSystemNodes(sid, { source: prompt, target: 'sys_agent', kind: 'data' }).error).toBeNull();
    useStore.setState(st => ({
      sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], graph: { ...st.sessions[sid].graph, nodes: st.sessions[sid].graph.nodes.filter(n => n.id !== prompt) } } },
    }));
    expect(promptsWiredToAgent(sid, 'sys_agent')).toEqual([]);
    expect(graph().nodes.some(n => promptNodeText(n) === 'stale secret')).toBe(false);
  });
});
