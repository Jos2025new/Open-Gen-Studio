import { useStore } from '../../store/store';
import { z } from 'zod';
import { edgeRef, graphOf, hasTarget, nodeCommand, nodeRef } from '../flow/commandKit';
import { executionOrder } from '../flow/graph';
import { LINK_KINDS, MODEL_ATTACH_MODES, type BaseSystemNodeType } from '../graphTypes';
import type { RefNodeData } from '../types';
import { ensureOmniNodes, setChatUndocked, setSpaceView } from './omni';
import {
  addSystemNode,
  attachModelToNode,
  detachModelFromNode,
  ensureSystemNodes,
  linkSystemNodes,
  setLinkBoth,
  resolveSystemNodeLive,
  SYSTEM_NODE_TYPES,
  unlinkSystemNodes,
} from './system';

const none = z.object({}).strict();
const SYSTEM_ADD_TYPES = ['chat', 'agent', 'provider', 'model', 'session', 'space', 'designer.doc', 'library', 'toolset'] as const satisfies readonly BaseSystemNodeType[];
const sysType = z.enum(SYSTEM_ADD_TYPES);
const linkKind = z.enum(LINK_KINDS);
const attachMode = z.enum(MODEL_ATTACH_MODES);
const mediaKind = z.enum(['llm', 'image', 'video', 'audio', 'model3d']);
const point = z.object({ x: z.number(), y: z.number() }).strict();

function throwIf(error: string | null): void {
  if (error) throw new Error(error);
}

export const commands = [
  nodeCommand({
    id: 'nodes.system.ensure',
    title: 'Ensure system nodes on canvas',
    description: 'Materializes the session\'s system nodes (chat, agent, attached models, Designer docs, Spaces) and their initial links if not yet on the canvas.',
    args: z.object({ record_history: z.boolean().optional() }).strict(),
    effect: 'write',
    undo: false,
    run: (on, args) => {
      const added = ensureSystemNodes(on.session, { recordHistory: args.record_history ?? false });
      const graph = graphOf(on);
      return {
        added,
        nodes: graph.nodes.filter((n) => n.data.kind === 'ref').map((n) => ({ id: n.id, ...(n.data as RefNodeData) })),
        edges: graph.edges,
      };
    },
  }),
  nodeCommand({
    id: 'nodes.system.ensure_omni',
    title: 'Open the omnicanvas nodes',
    description: 'Puts on the canvas what the omnicanvas shows: the chat, agent, models and Designer docs, one Studio, one Nodes and one Designer node, and the assets made since the last time. Nothing is copied; no undo step. Safe to repeat.',
    args: none,
    effect: 'write',
    undo: false,
    run: (on) => ({ added: ensureOmniNodes(on.session) }),
  }),
  nodeCommand({
    id: 'nodes.system.set_view',
    title: 'Set how a Space or chat node looks',
    description: 'A Studio, Nodes or Designer node is a thumbnail (view: thumb) or a node with ports and parameters (view: node). The chat node shows its agent and model connections (undocked: true) or looks like Studio\'s chat (undocked: false). A preference of the view: no undo step.',
    args: z.object({ node: nodeRef, view: z.enum(['thumb', 'node']).optional(), undocked: z.boolean().optional() }).strict(),
    effect: 'write',
    undo: false,
    available: (ctx, args) => hasTarget(ctx, args),
    run: (on, args) => {
      if (args.view === undefined && args.undocked === undefined) throw new Error('Give a view or undocked.');
      if (args.view !== undefined) throwIf(setSpaceView(on.session, args.node, args.view));
      if (args.undocked !== undefined) throwIf(setChatUndocked(on.session, args.node, args.undocked));
      return { node: args.node, view: args.view, undocked: args.undocked };
    },
  }),
  nodeCommand({
    id: 'nodes.system.list',
    title: 'List system nodes and links',
    description: 'Read only: returns the session\'s system reference nodes (chat, agent, models, Designer docs, Spaces, library, tools), their live store summary, and all typed links.',
    args: none,
    effect: 'read',
    undo: false,
    run: (on) => {
      const graph = graphOf(on);
      return {
        materialized: graph.nodes.some((n) => n.data.kind === 'ref'),
        types: Object.keys(SYSTEM_NODE_TYPES),
        nodes: graph.nodes
          .filter((n) => n.data.kind === 'ref')
          .map((n) => ({
            id: n.id,
            position: n.position,
            data: n.data as RefNodeData,
            live: resolveSystemNodeLive(on.session, n),
          })),
        edges: graph.edges.map((e) => ({
          ...e,
          kind: e.kind ?? 'data',
          both: Boolean(e.both),
        })),
      };
    },
  }),
  nodeCommand({
    id: 'nodes.system.add',
    title: 'Add system reference node',
    description: 'Adds a system reference node (chat, agent, provider, model, session, space, designer.doc, library, toolset) pointing to live store data without copying.',
    args: z
      .object({
        id: nodeRef.optional(),
        type: sysType,
        ref: z.string().min(1).max(200).optional(),
        title: z.string().min(1).max(200).optional(),
        position: point.optional(),
        attach_mode: attachMode.optional(),
        docked_to: nodeRef.optional(),
        media_kind: mediaKind.optional(),
      })
      .strict(),
    effect: 'write',
    run: (on, args) => {
      const node = addSystemNode(on.session, {
        id: args.id,
        type: args.type,
        ref: args.ref,
        title: args.title,
        position: args.position,
        attachMode: args.attach_mode,
        dockedTo: args.docked_to,
        mediaKind: args.media_kind,
      });
      return { node };
    },
  }),
  nodeCommand({
    id: 'nodes.system.link',
    title: 'Link nodes with class',
    description: 'Links two nodes through compatible ports of the given class (data, ref, control). Omitted handles are inferred from those ports. The optional both flag is allowed on ref and control. One undo step.',
    args: z
      .object({
        source: nodeRef,
        target: nodeRef,
        kind: linkKind,
        both: z.boolean().optional(),
        source_handle: z.string().min(1).max(80).optional(),
        target_handle: z.string().min(1).max(80).optional(),
        replaces: z.string().min(1).max(80).nullable().optional(),
      })
      .strict(),
    effect: 'write',
    run: (on, args) => {
      const res = linkSystemNodes(on.session, {
        replaces: args.replaces ?? null,
        source: args.source,
        target: args.target,
        kind: args.kind,
        both: args.both,
        sourceHandle: args.source_handle,
        targetHandle: args.target_handle,
      });
      throwIf(res.error);
      return { edge: res.edgeId! };
    },
  }),
  nodeCommand({
    id: 'nodes.system.unlink',
    title: 'Unlink nodes',
    description: 'Removes a link by edge id or by source, target, and optional link class (data, ref, control). One undo step.',
    args: z
      .object({
        edge: edgeRef.optional(),
        source: nodeRef.optional(),
        target: nodeRef.optional(),
        kind: linkKind.optional(),
      })
      .strict(),
    effect: 'write',
    available: (ctx, args) => hasTarget(ctx, args),
    run: (on, args) => {
      const res = unlinkSystemNodes(on.session, {
        edgeId: args.edge,
        source: args.source,
        target: args.target,
        kind: args.kind,
      });
      throwIf(res.error);
      return { edges: res.removed };
    },
  }),
  nodeCommand({
    id: 'nodes.system.set_link',
    title: 'Set a link bidirectional',
    description: 'Makes a ref or control link bidirectional (both: true) or one-way (both: false). Data links cannot be both. One undo step.',
    args: z.object({ edge: edgeRef, both: z.boolean() }).strict(),
    effect: 'write',
    available: (ctx, args) => hasTarget(ctx, args),
    run: (on, args) => {
      throwIf(setLinkBoth(on.session, args.edge, args.both));
      return { edge: args.edge, both: args.both };
    },
  }),
  nodeCommand({
    id: 'nodes.system.attach_model',
    title: 'Attach model to node',
    description: 'Attaches a model node to an agent, chat, or creative node in wired, docked, grouped, or merged mode. One undo step.',
    args: z
      .object({
        target: nodeRef.optional(),
        model_node: nodeRef.optional(),
        model_ref: z.string().min(1).max(200).optional(),
        mode: attachMode,
        media_kind: mediaKind.optional(),
      })
      .strict(),
    effect: 'write',
    available: (ctx, args) => hasTarget(ctx, { target: args?.target, node: args?.model_node }),
    run: (on, args) => {
      const res = attachModelToNode(on.session, {
        targetNodeId: args.target,
        modelNodeId: args.model_node,
        modelRef: args.model_ref,
        mode: args.mode,
        mediaKind: args.media_kind,
      });
      throwIf(res.error);
      return {
        modelNode: res.modelNodeId!,
        edge: res.edgeId!,
        ...(res.groupId ? { group: res.groupId } : {}),
        mode: args.mode,
      };
    },
  }),
  nodeCommand({
    id: 'nodes.system.detach_model',
    title: 'Detach model from node',
    description: 'Detaches a model from an agent or host node. One undo step.',
    args: z
      .object({
        target: nodeRef.optional(),
        model_node: nodeRef.optional(),
        model_ref: z.string().min(1).max(200).optional(),
      })
      .strict(),
    effect: 'write',
    available: (ctx, args) => hasTarget(ctx, { target: args?.target, node: args?.model_node }),
    run: (on, args) => {
      const res = detachModelFromNode(on.session, {
        targetNodeId: args.target,
        modelNodeId: args.model_node,
        modelRef: args.model_ref,
      });
      throwIf(res.error);
      return { detached: true };
    },
  }),
  nodeCommand({
    id: 'nodes.system.execution_order',
    title: 'Execution order from data links',
    description: 'Computes the topological execution order of runnable nodes from compatible data links and subject bindings.',
    args: z.object({ targets: z.array(nodeRef).max(40).optional() }).strict(),
    effect: 'read',
    undo: false,
    run: (on, args) => ({
      order: executionOrder(graphOf(on), args.targets, useStore.getState().assets),
    }),
  }),
];

export const SYSTEM_NODE_ACTIONS: Record<string, string> = {
  ensureSystemNodes: 'nodes.system.ensure',
  addSystemNode: 'nodes.system.add',
  attachModelToNode: 'nodes.system.attach_model',
  detachModelFromNode: 'nodes.system.detach_model',
  linkSystemNodes: 'nodes.system.link',
  unlinkSystemNodes: 'nodes.system.unlink',
};
