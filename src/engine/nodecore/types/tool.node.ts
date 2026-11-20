import { defaultOpParams } from '../../ops';
import { OPS } from '../../ops';
import type { OpStep } from '../../types';
import { defineNode } from '../descriptor';
import { deliverGenerated } from '../deliver';

export default defineNode({
  kind: 'tool',
  version: 1,
  params: ['title', 'op', 'params', 'outputIndex'],
  inputs: (data) => (data.kind === 'tool' ? [{ id: 'input', type: OPS[data.op].input, label: 'Input', multi: false }] : []),
  output: (data) => (data.kind === 'tool' ? OPS[data.op].output : null),
  required: ['input'],
  affects: { input: true },
  evaluate: deliverGenerated,
  plan(d, ctx) {
    if (d.kind !== 'tool') throw new Error('plan: wrong kind');
    const input = ctx.inEdges.find((e) => e.targetHandle === 'input');
    const ref = input ? ctx.refFor(input) : null;
    if (!ref) ctx.errors.push(`"${d.title}" needs an ${OPS[d.op].input} input.`);
    return { id: ctx.id, kind: 'op', title: d.title, op: d.op, input: ref ?? '', params: d.params } satisfies OpStep;
  },
  defaults: (opts) => {
    const op = opts.op ?? 'relight';
    return { kind: 'tool', title: OPS[op].label, op, params: defaultOpParams(OPS[op]), outputIndex: 0 };
  },
});
