import { defineNode } from '../descriptor';
import { evaluateNode } from '../evaluate';

export default defineNode({
  kind: 'text',
  version: 1,
  params: ['title', 'text'],
  inputs: () => [],
  output: () => 'text',
  required: [],
  affects: {},
  evaluate: evaluateNode,
  actions: [],
});
