import { z } from 'zod';
import { defineCommand } from '../commands/types';
import { useStore } from '../../store/store';
import { cleanFileName } from '../../lib/media';
import { OP_IDS } from '../ops';
import { BASE_NODE_KINDS, BASE_SYSTEM_NODE_TYPES, LINK_KINDS, MODEL_ATTACH_MODES } from '../graphTypes';
import { MEDIA_KINDS, type GenSettings, type GraphEdge, type GraphNode, type GraphNodeData, type OpId } from '../types';
import { budgetProblem } from '../actions';
import * as A from './actions';
import { applyEdit } from '../nodecore/edit';
import { prepareAction, runAction } from '../nodecore/action';
import { ownerRev } from '../nodecore/revision';
import { edgeRef, findNode, graphOf, hasTarget, nodeCommand, nodeOf, nodeRef } from './commandKit';

/* The node graph's actions as commands (ADR 0030). Each wraps the action the interface already calls. */

const none = z.object({}).strict();
const kind = z.enum(BASE_NODE_KINDS);
const sysType = z.enum(BASE_SYSTEM_NODE_TYPES);
const linkKind = z.enum(LINK_KINDS);
const attachMode = z.enum(MODEL_ATTACH_MODES);
const op = z.enum(OP_IDS as [OpId, ...OpId[]]);
const title = z.string().min(1).max(200);
const asset = z.string().min(1).max(160);
const point = z.object({ x: z.number(), y: z.number() }).strict();
const json = z.record(z.string(), z.unknown());
const ids = z.array(nodeRef).min(1).max(40);

const textNode = z.object({ kind: z.literal('text'), title, text: z.string() }).strict();
const genNode = z
  .object({
    kind: z.enum(MEDIA_KINDS),
    title,
    prompt: z.string(),
    modelRef: z.string().min(1),
    settings: json,
    generationId: z.string().optional(),
    outputIndex: z.number().int().min(0),
    sketchAssetId: z.string().optional(),
    textOutput: z.boolean().optional(),
    subjects: z.array(z.unknown()).optional(),
  })
  .strict();
const toolNode = z
  .object({ kind: z.literal('tool'), title, op, params: json, generationId: z.string().optional(), outputIndex: z.number().int().min(0), sketchAssetId: z.string().optional() })
  .strict();
const assetNode = z.object({ kind: z.literal('asset'), title, assetId: z.string().nullable(), sketchAssetId: z.string().optional() }).strict();
const refNode = z
  .object({
    kind: z.literal('ref'),
    type: sysType,
    ref: z.string().min(1),
    title,
    attachMode: attachMode.optional(),
    dockedTo: z.string().optional(),
    mergedModels: z.array(z.string()).optional(),
    mediaKind: z.enum(['llm', 'image', 'video', 'audio', 'model3d']).optional(),
    llm: z.object({ provider: z.string(), model: z.string() }).strict().optional(),
    recipient: z.string().optional(),
    promptText: z.string().optional(),
    view: z.enum(['thumb', 'node']).optional(),
    undocked: z.boolean().optional(),
  })
  .strict();
/** A node's data as the actions take it. The graph stores plain JSON; settings and params keep their own shape. */
const nodeData = z.discriminatedUnion('kind', [textNode, genNode, toolNode, assetNode, refNode]);

const nodePatch = z
  .object({
    type: sysType.optional(),
    ref: z.string().optional(),
    attachMode: attachMode.optional(),
    dockedTo: z.string().optional(),
    mergedModels: z.array(z.string()).optional(),
    mediaKind: z.enum(['llm', 'image', 'video', 'audio', 'model3d']).optional(),
    llm: z.object({ provider: z.string(), model: z.string() }).strict().optional(),
    recipient: z.string().optional(),
    promptText: z.string().optional(),
    view: z.enum(['thumb', 'node']).optional(),
    undocked: z.boolean().optional(),
    title: title.optional(),
    text: z.string().optional(),
    prompt: z.string().optional(),
    modelRef: z.string().min(1).optional(),
    settings: json.optional(),
    generationId: z.string().optional(),
    outputIndex: z.number().int().min(0).optional(),
    sketchAssetId: z.string().optional(),
    textOutput: z.boolean().optional(),
    subjects: z.array(z.unknown()).optional(),
    op: op.optional(),
    params: json.optional(),
    assetId: z.string().nullable().optional(),
  })
  .strict();

const storedNode = z.object({ id: z.string().min(1), position: point, data: nodeData, planId: z.string().optional() }).strict();
const storedEdge = z
  .object({
    id: z.string().min(1),
    source: z.string().min(1),
    target: z.string().min(1),
    targetHandle: z.string(),
    sourceHandle: z.string(),
    outputIndex: z.number().int().optional(),
    kind: linkKind.optional(),
    both: z.boolean().optional(),
    pin: z.string().optional(),
  })
  .strict();

function throwIf(error: string | null): void {
  if (error) throw new Error(error);
}

function edgeAfter(on: { session: string }, before: Set<string>): string | null {
  return graphOf(on).edges.find((e) => !before.has(e.id))?.id ?? null;
}

/** A command that makes or changes a node hands back its revision: the next edit names it (`expect`), nobody edits blind. */
function revOf<T extends string | null | undefined>(on: { session?: string }, node: T): { node: T; rev: string | null } {
  const graph = useStore.getState().sessions[on.session ?? '']?.graph;
  return { node, rev: node && graph ? ownerRev(graph, node) : null };
}

export const commands = [
  /* --- Nodes --------------------------------------------------------------------------------------------------- */
  defineCommand({
    id: 'nodes.node.new_data',
    title: 'Default node data',
    description: 'The data a new node starts with for this kind (tool: op; asset: assetId; ref: type, ref). Feed it to nodes.node.add.',
    args: z.object({ kind, op: op.optional(), assetId: asset.optional(), type: sysType.optional(), ref: z.string().optional() }).strict(),
    effect: 'read',
    debt: 'Reads the composer\'s current model and settings for the defaults.',
    run: (_ctx, args) => A.newNodeData(args.kind, { op: args.op, assetId: args.assetId, type: args.type, ref: args.ref }) as GraphNodeData,
  }),
  nodeCommand({
    id: 'nodes.node.add',
    title: 'Add node',
    description: 'Adds a node with this data at this position. Returns {node}.',
    args: z.object({ data: nodeData, position: point }).strict(),
    effect: 'write',
    run: (on, args) => revOf(on, A.addNode(on.session, args.data as GraphNodeData, args.position)),
  }),
  nodeCommand({
    id: 'nodes.node.add_asset',
    title: 'Add asset as node',
    description: 'An Asset node for this gallery asset (a finished 3D model comes back as its 3D node, with the images it was made from). Returns {node}.',
    args: z.object({ asset, position: point }).strict(),
    effect: 'write',
    available: (ctx, args) => (args?.asset && !useStore.getState().assets[args.asset] ? `No asset "${args.asset}".` : hasTarget(ctx)),
    run: (on, args) => revOf(on, A.addAssetAsNode(on.session, args.asset, args.position)),
  }),
  nodeCommand({
    id: 'nodes.node.add_connected',
    title: 'Add connected node',
    description: 'Adds a node wired to the source\'s first input that accepts its output (or at `at`). Returns {node}.',
    args: z.object({ source: nodeRef, data: nodeData, at: point.optional(), source_handle: z.string().min(1).max(80).nullable().optional() }).strict(),
    effect: 'write',
    debt: 'When the connection is rejected the action returns null after a notice; the command says only that no input fit.',
    run: (on, args) => {
      const node = A.addConnected(on.session, args.source, args.data as GraphNodeData, args.at, args.source_handle ?? null);
      if (!node) throw new Error('The node could not be connected: no input port fits its output there.');
      return revOf(on, node);
    },
  }),
  nodeCommand({
    id: 'nodes.node.edit',
    title: 'Change node',
    description: 'Merges these fields into a node\'s data (title, prompt, text, modelRef, settings, params, op, assetId…; never its kind). `expect` is the node revision you read (nodes.node.inspect, or the rev a command returned); a stale or missing one is refused. Returns {node, rev}.',
    args: z.object({ node: nodeRef, patch: nodePatch, expect: z.string().min(1).max(80) }).strict(),
    effect: 'write',
    run: (on, args) => {
      nodeOf(on, args.node);
      const done = applyEdit({ session: on.session!, require: true, expect: { [args.node]: args.expect }, op: { op: 'set', node: args.node, patch: args.patch as Partial<GraphNodeData>, strict: true } });
      if (!done.ok) throw new Error(done.error);
      return revOf(on, args.node);
    },
  }),
  nodeCommand({
    id: 'nodes.node.rename',
    title: 'Rename node',
    description: 'Renames a node (the extension is kept off). Its result takes the same name.',
    args: z.object({ node: nodeRef, name: z.string().min(1).max(200) }).strict(),
    effect: 'write',
    debt: 'Also renames the node\'s result asset; undo brings the node title back, not the asset name.',
    run: (on, args) => {
      const name = cleanFileName(args.name);
      if (!name) throw new Error('The name is empty after removing invalid characters.');
      A.renameNode(on.session, args.node, args.name);
      return { node: args.node, title: name };
    },
  }),
  nodeCommand({
    id: 'nodes.node.delete',
    title: 'Delete nodes',
    description: 'Deletes these nodes and their connections (undo brings them back). Returns {nodes}.',
    args: z.object({ nodes: ids }).strict(),
    effect: 'write',
    run: (on, args) => {
      throwIf(A.deleteNodes(on.session, args.nodes));
      return { nodes: args.nodes };
    },
  }),
  nodeCommand({
    id: 'nodes.node.delete_with_undo',
    title: 'Delete nodes with a recovery snapshot',
    description: 'Deletes these nodes and also leaves a notice in the conversation to restore them selectively. Returns {nodes, deleted}.',
    args: z.object({ nodes: ids }).strict(),
    effect: 'write',
    run: (on, args) => {
      const out = A.deleteNodesWithUndo(on.session, args.nodes);
      throwIf(out.error);
      return { nodes: args.nodes, deleted: out.deleted };
    },
  }),
  nodeCommand({
    id: 'nodes.node.duplicate',
    title: 'Duplicate node',
    description: 'A copy with the same parameters and connections, offset; it gets no result of its own. Returns {node}.',
    args: z.object({ node: nodeRef }).strict(),
    effect: 'write',
    run: (on, args) => revOf(on, A.duplicateNode(on.session, nodeOf(on, args.node))),
  }),
  nodeCommand({
    id: 'nodes.node.set_model',
    title: 'Change node model',
    description: 'A generation node takes this model and settings; connections the new output or inputs no longer fit are dropped.',
    args: z.object({ node: nodeRef, model: z.string().min(1).max(200), settings: json }).strict(),
    effect: 'write',
    run: (on, args) => {
      throwIf(A.setNodeModel(on.session, args.node, { modelRef: args.model, settings: args.settings as unknown as GenSettings }));
      return { node: args.node };
    },
  }),
  nodeCommand({
    id: 'nodes.node.set_op',
    title: 'Change tool node operation',
    description: 'A tool node takes this operation and its defaults; connections that no longer fit are dropped.',
    args: z.object({ node: nodeRef, op }).strict(),
    effect: 'write',
    run: (on, args) => {
      throwIf(A.setNodeOp(on.session, args.node, args.op));
      return { node: args.node };
    },
  }),
  nodeCommand({
    id: 'nodes.node.set_sketch',
    title: 'Set painted-over copy',
    description: 'A node result takes this image as its painted-over copy; null clears it. The copy it replaces is deleted.',
    args: z.object({ node: nodeRef, asset: asset.nullable() }).strict(),
    effect: 'write',
    debt: 'The replaced copy is deleted from the gallery; undo does not bring the asset back.',
    available: (ctx, args) => {
      const target = hasTarget(ctx, args);
      if (target !== true || !args?.node) return target;
      const k = findNode(ctx.on, args.node)?.data.kind;
      return k !== 'text' && k !== 'ref' ? true : 'A text node has no result to paint over.';
    },
    run: (on, args) => {
      A.setSketch(on.session, args.node, args.asset ?? undefined);
      return { node: args.node };
    },
  }),
  nodeCommand({
    id: 'nodes.node.restore',
    title: 'Restore deleted nodes',
    description: 'Puts back nodes and the connections that still fit, leaving later nodes and edits intact. Returns {nodes, skipped}.',
    args: z.object({ deleted: z.object({ nodes: z.array(storedNode).min(1).max(40), edges: z.array(storedEdge).max(200) }).strict() }).strict(),
    effect: 'write',
    run: (on, args) => {
      const out = A.restoreNodes(on.session, args.deleted as { nodes: GraphNode[]; edges: GraphEdge[] });
      throwIf(out.error);
      return { nodes: args.deleted.nodes.map((n) => n.id), skipped: out.skipped };
    },
  }),
  nodeCommand({
    id: 'nodes.node.restore_deletion',
    title: 'Restore a deletion from the conversation',
    description: 'Restores the nodes of a deletion notice, all or only the named ones. Returns {item}.',
    args: z.object({ item: z.string().min(1).max(80), nodes: z.array(nodeRef).min(1).max(40).optional() }).strict(),
    effect: 'write',
    run: (on, args) => {
      throwIf(A.restoreNodeDeletion(on.session, args.item, args.nodes));
      return { item: args.item };
    },
  }),
  nodeCommand({
    id: 'nodes.node.restore_generation',
    title: 'Reuse a saved generation',
    description: 'A node takes the controls (model, settings, prompt or operation) of a finished generation, without running it. Returns {node}.',
    args: z.object({ node: nodeRef, generation: z.string().min(1).max(80) }).strict(),
    effect: 'write',
    run: (on, args) => {
      throwIf(A.restoreNodeGeneration(on.session, args.node, args.generation));
      return { node: args.node };
    },
  }),

  /* --- Connections --------------------------------------------------------------------------------------------- */
  nodeCommand({
    id: 'nodes.edge.connect',
    title: 'Connect nodes',
    description: 'Connects a source to a target input port (target_handle) with optional link class (data, ref, control) and bidirectional flag (both); an occupied single-input port is refused unless `replaces` names the cable to replace. Returns {edge}.',
    args: z
      .object({
        source: nodeRef,
        target: nodeRef,
        target_handle: z.string().min(1).max(80).nullable(),
        source_handle: z.string().min(1).max(80).nullable().optional(),
        kind: linkKind.optional(),
        both: z.boolean().optional(),
        replaces: z.string().min(1).max(80).nullable().optional(),
      })
      .strict(),
    effect: 'write',
    run: (on, args) => {
      const before = new Set(graphOf(on).edges.map((e) => e.id));
      throwIf(
        A.connectNodes(on.session, {
          source: args.source,
          target: args.target,
          targetHandle: args.target_handle,
          sourceHandle: args.source_handle ?? null,
          kind: args.kind,
          both: args.both,
          // Not seeing the port, a command must name the cable it replaces; an occupied port without it is refused.
          replaces: args.replaces ?? null,
        }),
      );
      return { edge: edgeAfter(on, before) };
    },
  }),
  nodeCommand({
    id: 'nodes.edge.disconnect',
    title: 'Disconnect',
    description: 'Removes these connections (undo brings them back). Returns {edges}.',
    args: z.object({ edges: z.array(edgeRef).min(1).max(40) }).strict(),
    effect: 'write',
    run: (on, args) => {
      throwIf(A.disconnectEdges(on.session, args.edges));
      return { edges: args.edges };
    },
  }),

  /* --- Layout and runs ----------------------------------------------------------------------------------------- */
  nodeCommand({
    id: 'nodes.layout.auto',
    title: 'Lay out the graph',
    description: 'Puts every node in automatic layout order. Returns {nodes}.',
    args: none,
    effect: 'write',
    run: (on) => {
      A.layoutAll(on.session);
      return { nodes: graphOf(on).nodes.length };
    },
  }),
  nodeCommand({
    id: 'nodes.run.list',
    title: 'List runnable nodes',
    description: 'The nodes of the session that can run a generation. Returns {nodes}.',
    args: none,
    effect: 'read',
    run: (on) => ({ nodes: A.runnableIds(graphOf(on).nodes) }),
  }),
  nodeCommand({
    id: 'nodes.run.preview',
    title: 'Preview a run',
    description: 'What running these nodes would do: cost estimate, inputs, steps, runnable ids and every problem. Nothing is run.',
    args: z.object({ targets: ids, force: z.boolean().optional() }).strict(),
    effect: 'read',
    run: (on, args) => A.previewRun(on.session, args.targets, args.force ?? true),
  }),
  nodeCommand({
    id: 'nodes.run.start',
    title: 'Run nodes',
    description: 'Runs these nodes and their missing ancestors, after checking the preview and the spending limit. Spends money and cannot be undone.',
    args: z.object({ targets: ids, force: z.boolean().optional() }).strict(),
    effect: 'spend',
    estimate: (on, args) => A.previewRun(on.session, args.targets, args.force ?? true).estimate,
    run: async (on, args) => {
      // The same registry as nodes.action.*: one approval, one send, and the inspector can tell which run made which result.
      const prepared = await prepareAction(on.session, args.targets, args.force ?? true);
      if (!prepared.ok) throw new Error(prepared.errors[0]);
      const problem = budgetProblem(prepared.snapshot.preview.estimate, on.session);
      if (problem) throw new Error(problem);
      const started = (await runAction(prepared.snapshot)).result;
      if (!started) throw new Error('The graph changed after it was reviewed; review it again.');
      return { outputs: Object.fromEntries(started.outputs), failed: started.failed, skipped: started.skipped, waiting: started.waiting, ...(started.stopped ? { stopped: true } : {}) };
    },
  }),
];

/**
 * Every exported action of `actions.ts`: the command that runs it, or (after "-") why it is not one. A test keeps
 * this list complete, so a new action cannot be added without deciding.
 */
export const NODES_ACTIONS: Record<string, string> = {
  addAssetAsNode: 'nodes.node.add_asset',
  newNodeData: 'nodes.node.new_data',
  addNode: 'nodes.node.add',
  patchNodeData: 'nodes.node.edit',
  deleteNodes: 'nodes.node.delete',
  setNodeModel: 'nodes.node.set_model',
  setSketch: 'nodes.node.set_sketch',
  duplicateNode: 'nodes.node.duplicate',
  renameNode: 'nodes.node.rename',
  connectNodes: 'nodes.edge.connect',
  tryConnect: '- returns true/false and tells the person with a notice; nodes.edge.connect throws the reason',
  disconnectEdges: 'nodes.edge.disconnect',
  setNodeOp: 'nodes.node.set_op',
  layoutAll: 'nodes.layout.auto',
  runnableIds: 'nodes.run.list',
  previewRun: 'nodes.run.preview',
  prepareNodeRun: '- prepares the preview and fetches provider schemas; nodes.run.preview and nodes.run.start cover it',
  runNodes: 'nodes.run.start',
  deleteNodesWithUndo: 'nodes.node.delete_with_undo',
  restoreNodes: 'nodes.node.restore',
  restoreNodeDeletion: 'nodes.node.restore_deletion',
  restoreNodeGeneration: 'nodes.node.restore_generation',
  addConnected: 'nodes.node.add_connected',
};
