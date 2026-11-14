import { z } from 'zod';
import type { FxCommand } from '../fx/fxCommands';
import { docCommand, layerRef, type DocTarget } from './commandKit';
import { runFx } from './fx';

export const FX_DO: Record<FxCommand['do'], string> = {
  add: 'designer.fx.add',
  set: 'designer.fx.set',
  add_op: 'designer.fx.add_op',
  set_op: 'designer.fx.set_op',
  move_op: 'designer.fx.move_op',
  remove_op: 'designer.fx.remove_op',
  delete: 'designer.fx.delete',
};

const params = z.record(z.string(), z.unknown());
const scope = z.enum(['below', 'layer']);
const op = z.object({
  kind: z.string(),
  params: params.optional(),
  enabled: z.boolean().optional(),
}).strict();

function apply(on: DocTarget, cmd: FxCommand) {
  const run = runFx(on.session, on.doc, [cmd]);
  if (!run) throw new Error('That document is not in this session.');
  if (run.error) throw new Error(run.error);
  return run;
}

export const commands = [
  docCommand({
    id: 'designer.fx.add',
    title: 'Add FX layer',
    description: 'Add a filter or effect layer and return its id.',
    args: z.object({
      group: z.enum(['filter', 'effect']),
      scope: scope.optional(),
      ops: z.array(op).optional(),
      name: z.string().optional(),
      above: z.string().optional(),
      simple: z.boolean().optional(),
    }).strict(),
    effect: 'write',
    debt: 'Without above, the layer is placed above the document’s active layer.',
    run: (on, args) => { const run = apply(on, { do: 'add', ...args }); return { results: run.results, layer: run.added[0] }; },
  }),
  docCommand({
    id: 'designer.fx.set',
    title: 'Change FX layer',
    description: 'Change the properties of an FX layer.',
    args: z.object({
      layer: layerRef,
      name: z.string().optional(),
      scope: scope.optional(),
      opacity: z.number().optional(),
      blend: z.string().optional(),
      visible: z.boolean().optional(),
      simple: z.boolean().optional(),
    }).strict(),
    effect: 'write',
    run: (on, args) => ({ results: apply(on, { do: 'set', ...args }).results }),
  }),
  docCommand({
    id: 'designer.fx.add_op',
    title: 'Add FX operation',
    description: 'Add a filter or effect operation to an FX layer.',
    args: z.object({
      layer: layerRef,
      kind: z.string(),
      params: params.optional(),
      index: z.number().optional(),
    }).strict(),
    effect: 'write',
    run: (on, args) => ({ results: apply(on, { do: 'add_op', ...args }).results }),
  }),
  docCommand({
    id: 'designer.fx.set_op',
    title: 'Change FX operation',
    description: 'Change the parameters or enabled state of an FX operation.',
    args: z.object({
      layer: layerRef,
      op: z.string(),
      params: params.optional(),
      enabled: z.boolean().optional(),
    }).strict(),
    effect: 'write',
    run: (on, args) => ({ results: apply(on, { do: 'set_op', ...args }).results }),
  }),
  docCommand({
    id: 'designer.fx.move_op',
    title: 'Move FX operation',
    description: 'Move an FX operation to a position in its layer.',
    args: z.object({
      layer: layerRef,
      op: z.string(),
      to: z.number(),
    }).strict(),
    effect: 'write',
    run: (on, args) => ({ results: apply(on, { do: 'move_op', ...args }).results }),
  }),
  docCommand({
    id: 'designer.fx.remove_op',
    title: 'Remove FX operation',
    description: 'Remove an operation from an FX layer.',
    args: z.object({
      layer: layerRef,
      op: z.string(),
    }).strict(),
    effect: 'write',
    run: (on, args) => ({ results: apply(on, { do: 'remove_op', ...args }).results }),
  }),
  docCommand({
    id: 'designer.fx.delete',
    title: 'Delete FX layer',
    description: 'Delete an FX layer; undo brings it back.',
    args: z.object({
      layer: layerRef,
    }).strict(),
    effect: 'write',
    run: (on, args) => ({ results: apply(on, { do: 'delete', ...args }).results }),
  }),
];
