import { OPS } from '../../ops';
import { defineNode } from '../descriptor';
import { evaluateNode } from '../evaluate';

export default defineNode({
  kind: 'tool',
  version: 1,
  params: ['title', 'op', 'params', 'outputIndex'],
  inputs: (data) => (data.kind === 'tool' ? [{ id: 'input', type: OPS[data.op].input, label: 'Input', multi: false }] : []),
  output: (data) => (data.kind === 'tool' ? OPS[data.op].output : null),
  required: ['input'],
  affects: { input: true },
  evaluate: evaluateNode,
  actions: ['run-tool'],
});
