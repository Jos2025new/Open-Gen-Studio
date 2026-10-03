import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Asset, Generation, GraphNode, Session } from '../src/engine/types';

vi.hoisted(() => {
  Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } });
});
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async (id: string) => id,
}));

import { canvasIndex } from '../src/engine/canvas';
import { nodeWorkNotInChat, nodesToChat } from '../src/engine/flow/fromNodes';
import { createSession, useStore } from '../src/store/store';

const generation = (id: string, sessionId: string, assetIds: string[]): Generation => ({
  id,
  sessionId,
  kind: 'image',
  prompt: `prompt ${id}`,
  modelRef: 'local::studio-image',
  modelName: 'Studio Image',
  provider: 'local',
  settings: { count: assetIds.length, advanced: {} },
  inputs: { refs: [] },
  origin: 'node',
  status: 'done',
  assetIds,
  estimate: { usd: 0 },
  createdAt: 1,
} as unknown as Generation);

const asset = (id: string, generationId: string): Asset => ({
  id,
  sessionId: 's',
  kind: 'image',
  name: id,
  mime: 'image/png',
  width: 512,
  height: 512,
  generationId,
  origin: 'generated',
  stored: true,
  favorite: false,
  createdAt: 1,
} as Asset);

const resultNode = (id: string, generationId: string, outputIndex: number): GraphNode => ({
  id,
  position: { x: 0, y: 0 },
  data: { kind: 'image', title: `Node ${id}`, prompt: id, modelRef: 'local::studio-image', settings: { count: 3, advanced: {} }, generationId, outputIndex },
});

beforeEach(() => {
  const session: Session = { ...createSession('Nodes to Chat'), id: 's' };
  session.graph = {
    nodes: [
      resultNode('image-node', 'g1', 2),
      { id: 'manual-text', position: { x: 0, y: 0 }, data: { kind: 'text', title: 'Notes', text: 'not a result' } },
      { id: 'reference', position: { x: 0, y: 0 }, data: { kind: 'asset', title: 'Reference', assetId: 'upload' } },
      resultNode('missing-output', 'g2', 0),
    ],
    edges: [],
  };
  const g1 = generation('g1', 's', ['a1', 'a2', 'a3']);
  const g2 = generation('g2', 's', ['missing']);
  useStore.setState({
    sessions: { s: session },
    activeSessionId: 's',
    generations: { g1, g2 },
    assets: { a1: asset('a1', 'g1'), a2: asset('a2', 'g1'), a3: asset('a3', 'g1') },
  });
});

describe('node results → chat', () => {
  it('lists only current node results backed by a real selected asset', () => {
    expect(nodeWorkNotInChat('s')).toEqual([
      { nodeId: 'image-node', generationId: 'g1', outputIndex: 2, assetId: 'a3', label: 'Node image-node' },
    ]);
  });

  it('adds one marked feed reference, preserves the selected result and is idempotent', () => {
    const beforeGenerations = useStore.getState().generations;
    const beforeAssets = useStore.getState().assets;

    expect(nodesToChat('s', ['image-node']).added).toHaveLength(1);
    const item = useStore.getState().sessions.s.feed[0];
    expect(item).toMatchObject({ workspace: 'chat', type: 'generation', generationId: 'g1', mirroredFrom: 'node', outputIndex: 2 });
    expect(useStore.getState().generations).toBe(beforeGenerations);
    expect(useStore.getState().assets).toBe(beforeAssets);
    expect(nodeWorkNotInChat('s')).toEqual([]);
    expect(nodesToChat('s', ['image-node']).added).toEqual([]);
    expect(useStore.getState().sessions.s.feed).toHaveLength(1);
  });

  it('does not let the mirrored Chat card change the generation canvas', () => {
    nodesToChat('s');
    const st = useStore.getState();
    expect(canvasIndex(st.sessions.s, st.generations).generation(st.generations.g1)).toBe('node');
  });
});
