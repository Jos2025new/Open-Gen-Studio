import { defineNode } from '../descriptor';
import { evaluateNode } from '../evaluate';

export default defineNode({
  kind: 'asset',
  version: 1,
  params: ['title', 'assetId'],
  inputs: () => [],
  output: (data, assets) => (data.kind === 'asset' && data.assetId ? assets[data.assetId]?.kind ?? null : null),
  required: [],
  affects: {},
  evaluate: evaluateNode,
  actions: [],
});
