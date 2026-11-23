import { z } from 'zod';
import { budgetProblem } from '../actions';
import { nodeCommand, nodeRef } from '../flow/commandKit';
import { LINK_KINDS } from '../graphTypes';
import { UNKNOWN } from '../pricing';
import { applyEdit } from './edit';
import { prepareAction, runAction, snapshotById } from './action';
import { inspectNode } from './inspect';

/* The node core as commands (ADR 0030/0031): the agent and the interface reach the same edit layer and actions. */

const ids = z.array(nodeRef).min(1).max(40);
const linkKind = z.enum(LINK_KINDS);
/** Required: an edit that does not say which revision it read is refused (the layer's `require`). */
const expect = z.record(z.string(), z.string());

export const commands = [
  nodeCommand({
    id: 'nodes.edit.connect',
    title: 'Connect with precondition',
    description: 'Connects two nodes through the single editing layer. `replaces` names the cable expected on a single-cable input (an edge id, null for none; an absent cable is a conflict); `expect` (required) maps the target node id to the revision you read. Never starts a generation. Returns {edge, rev} or throws the conflict.',
    args: z.object({ source: nodeRef, target: nodeRef, targetHandle: z.string().nullable(), sourceHandle: z.string().nullable().optional(), kind: linkKind.optional(), both: z.boolean().optional(), replaces: z.union([z.string(), z.null()]).optional(), expect }).strict(),
    effect: 'write',
    run: (on, args) => {
      const { expect: want, ...c } = args;
      const done = applyEdit({ session: on.session, require: true, expect: want, op: { op: 'connect', ...c, replaces: c.replaces ?? null } });
      if (!done.ok) throw new Error(done.error);
      return { edge: done.edgeId ?? null, rev: done.rev };
    },
  }),
  nodeCommand({
    id: 'nodes.edit.set',
    title: 'Edit a node parameter',
    description: 'Writes parameters of one node through the single editing layer; only keys the node type owns. `expect` (required) carries the node revision you read: a stale or missing one is refused. Returns {rev}.',
    args: z.object({ node: nodeRef, patch: z.record(z.string(), z.unknown()), expect }).strict(),
    effect: 'write',
    run: (on, args) => {
      const done = applyEdit({ session: on.session, require: true, expect: args.expect, op: { op: 'set', node: args.node, patch: args.patch as never, strict: true } });
      if (!done.ok) throw new Error(done.error);
      return { rev: done.rev };
    },
  }),
  nodeCommand({
    id: 'nodes.node.inspect',
    title: 'Inspect a node',
    description: 'The node as the resolver sees it: resolved inputs with their revisions and validity, signature, whether its result is current and why not, consumers and last run. Returns {inspection}.',
    args: z.object({ node: nodeRef }).strict(),
    effect: 'read',
    undo: false,
    run: (on, args) => {
      const inspection = inspectNode(on.session, args.node);
      if (!inspection) throw new Error(`No such node: ${args.node}.`);
      return { inspection: JSON.parse(JSON.stringify(inspection)) as Record<string, unknown> };
    },
  }),
  nodeCommand({
    id: 'nodes.action.prepare',
    title: 'Prepare an action',
    description: 'Freezes what a run of these nodes would do (destination, reviewed preview, input revisions) and returns {approval, estimate, count}. Nothing is spent. Pass the approval to nodes.action.run.',
    args: z.object({ targets: ids, force: z.boolean().optional() }).strict(),
    effect: 'read',
    undo: false,
    run: async (on, args) => {
      const prepared = await prepareAction(on.session, args.targets, args.force ?? true);
      if (!prepared.ok) throw new Error(prepared.errors[0]);
      return { approval: prepared.snapshot.id, estimate: prepared.snapshot.preview.estimate.usd, count: prepared.snapshot.preview.count };
    },
  }),
  nodeCommand({
    id: 'nodes.action.run',
    title: 'Run an approved action',
    description: 'Runs a prepared snapshot under a run id. One approval pays for one send: the same run id again returns the running or finished run (failed included) and never sends twice; another id with a used approval is refused. After a failure, or after a reload (approvals are not kept), prepare and approve again. Spends money.',
    args: z.object({ approval: z.string().min(1).max(80), runId: z.string().min(1).max(80).optional() }).strict(),
    effect: 'spend',
    estimate: (_on, args) => snapshotById(args.approval)?.preview.estimate ?? UNKNOWN,
    run: async (on, args, ctx) => {
      const snapshot = snapshotById(args.approval);
      if (!snapshot || snapshot.session !== on.session) throw new Error('This approval is unknown or belongs to another session; prepare the action again.');
      const problem = budgetProblem(snapshot.preview.estimate, on.session, ctx.budgetPass);
      if (problem) throw new Error(problem);
      const record = await runAction(snapshot, args.runId, undefined, ctx.budgetPass);
      if (record.status === 'stale' || (record.status === 'failed' && !record.result)) throw new Error(record.error ?? 'The action did not run.');
      return { runId: record.runId, status: record.status, sends: record.sends, failed: record.result?.failed ?? [], error: record.error ?? null };
    },
  }),
];
