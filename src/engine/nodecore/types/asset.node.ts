import { defineNode } from '../descriptor';
import { deliverAsset } from '../deliver';

export default defineNode({
  kind: 'asset',
  version: 1,
  params: ['title', 'assetId'],
  inputs: () => [],
  output: (data, assets) => (data.kind === 'asset' && data.assetId ? assets[data.assetId]?.kind ?? null : null),
  required: [],
  affects: {},
  evaluate: (n, _e, env) => deliverAsset(n, env),
  actions: [],
});
