import { inputPorts, outputPort } from '../../flow/graph';
import { defineNode } from '../descriptor';
import { evaluateNode } from '../evaluate';

export default defineNode({
  kind: 'text',
  version: 1,
  params: ['title', 'text'],
  inputs: inputPorts,
  output: outputPort,
  required: [],
  affects: {},
  evaluate: evaluateNode,
  actions: [],
});
