import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener() {} }, document: { addEventListener() {}, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async () => undefined }));
import { newNodeData } from '../src/engine/flow/actions';
import { OPS } from '../src/engine/ops';
import { SYSTEM_NODE_TYPES } from '../src/engine/nodes/system';
import type { OpId, SystemNodeType } from '../src/engine/types';

/* Golden equivalence: the data `newNodeData` creates for every kind, op and system type, recorded before each descriptor owned its defaults. */
const GOLDEN = 'tests/fixtures/descriptor-defaults.golden.json';
const make = () => ({
  text: newNodeData('text'),
  image: newNodeData('image'),
  video: newNodeData('video'),
  audio: newNodeData('audio'),
  model3d: newNodeData('model3d'),
  asset: newNodeData('asset'),
  assetWith: newNodeData('asset', { assetId: 'a9' }),
  ...Object.fromEntries((Object.keys(OPS) as OpId[]).map((op) => [`tool:${op}`, newNodeData('tool', { op })])),
  tool: newNodeData('tool'),
  ref: newNodeData('ref'),
  refGiven: newNodeData('ref', { type: 'chat', ref: 'given' }),
  ...Object.fromEntries((Object.keys(SYSTEM_NODE_TYPES) as SystemNodeType[]).map((type) => [`ref:${type}`, newNodeData('ref', { type })])),
});

describe('defaults owned by the descriptors equal the former newNodeData switch', () => {
  it('every kind, op and system type creates the same data', () => {
    const now = JSON.parse(JSON.stringify(make()).replace(/ses_[a-z0-9]+/g, 'SES')); // the session id is random per run
    if (!existsSync(GOLDEN)) writeFileSync(GOLDEN, JSON.stringify(now, null, 1) + '\n');
    expect(now).toEqual(JSON.parse(readFileSync(GOLDEN, 'utf8')));
  });
});
