import { expect, it, vi } from 'vitest';
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async () => undefined }));
import { NO_RESULT, nodeOutputAsset } from '../src/engine/flow/graph';
import type { GraphNode } from '../src/engine/types';

it('a deleted-output link does not show the source node sketch', () => {
  const node = { id: 'n', position: { x: 0, y: 0 }, data: { kind: 'image', sketchAssetId: 'sketch' } } as GraphNode;
  expect(nodeOutputAsset(node, {}, NO_RESULT)).toBeNull();
  expect(nodeOutputAsset(node, {})).toBe('sketch');
});
