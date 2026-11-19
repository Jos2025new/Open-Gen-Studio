import { inputPorts, outputPort } from '../../flow/graph';
import { defineNode } from '../descriptor';
import { evaluateNode } from '../evaluate';

export default defineNode({
  kind: 'tool',
  version: 1,
  params: ['title', 'op', 'params', 'outputIndex'],
  inputs: inputPorts,
  output: outputPort,
  required: ['input'],
  affects: { input: true },
  evaluate: evaluateNode,
  actions: ['run-tool'],
});
