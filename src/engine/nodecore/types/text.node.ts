import { defineNode } from '../descriptor';
import { delivered } from '../deliver';

export default defineNode({
  kind: 'text',
  version: 1,
  params: ['title', 'text'],
  inputs: () => [],
  output: () => 'text',
  required: [],
  affects: {},
  evaluate: (n) => delivered(n.data.kind === 'text' ? n.data.text : null),
  actions: [],
});
