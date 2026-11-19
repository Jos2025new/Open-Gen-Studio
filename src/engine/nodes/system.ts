import { uid } from '../../lib/id';
import { firstAgentId } from '../agent/threads';
import { threadOf } from '../agent/lanes';
import { reconcileDeletionNotices, toast, useStore } from '../../store/store';
import { laneState, patchLane } from '../agent/lanes';
import { applyEdit, editCompound } from '../nodecore/edit';
import { isOmniSpace } from './omniSpaces';
import type {
  Graph,
  GraphEdge,
  GraphGroup,
  GraphNode,
  LinkKind,
  MediaKind,
  ModelAttachMode,
  RefNodeData,
  SystemNodeType,
} from '../types';
import {
  allNodePorts,
  modelLabelForRef,
  portTypeCompatible,
  resolveSystemConnection,
  resolveSystemNodeLive,
  SYSTEM_NODE_TYPES,
  systemNodePorts,
  type LiveSystemSummary,
} from './spec';

export {
  allNodePorts,
  modelLabelForRef,
  portTypeCompatible,
  resolveSystemConnection,
  resolveSystemNodeLive,
  SYSTEM_NODE_TYPES,
  systemNodePorts,
  type LiveSystemSummary,
};

/* Tidy layout, left of the user's own nodes: models | chat and agent | docs and Spaces. The pitch leaves room for port labels. */
export const COL = 600;
export const ROW = 340;
export const sysOrigin = (graph: Graph): number => {
  const own = graph.nodes.filter((n) => n.data.kind !== 'ref');
  const sys = graph.nodes.filter((n) => n.data.kind === 'ref');
  if (sys.length) return Math.min(...sys.map((n) => n.position.x));
  return own.length ? Math.min(...own.map((n) => n.position.x)) - 3 * COL - 200 : -(2 * COL + 260) / 2;
};

function buildInitialSystemGraph(sessionId: string, graph: Graph): { nodes: GraphNode[]; edges: GraphEdge[]; addedIds: string[] } {
  const st = useStore.getState();
  const session = st.sessions[sessionId];
  if (!session) return { nodes: graph.nodes, edges: graph.edges, addedIds: [] };

  const hasAnyRefNode = graph.nodes.some((n) => n.data.kind === 'ref');
  const ox = sysOrigin(graph);
  const at = (col: number, row: number) => ({ x: ox + col * COL, y: row * ROW });
  const nodes = [...graph.nodes];
  const edges = [...graph.edges];
  const addedIds: string[] = [];

  const ensureNode = (id: string, position: { x: number; y: number }, data: RefNodeData) => {
    if (nodes.some((n) => n.id === id)) return;
    nodes.push({ id, position, data });
    addedIds.push(id);
  };

  const ensureEdge = (edge: GraphEdge) => {
    if (edges.some((e) => e.id === edge.id || (e.source === edge.source && e.target === edge.target && (e.kind ?? 'data') === (edge.kind ?? 'data')))) return;
    edges.push(edge);
  };

  if (!hasAnyRefNode) {
    const firstAgent = threadOf(session, firstAgentId(session.graph)); // its choices seed the default model nodes
    const llmRef = st.settings.agent.provider === 'offline' ? 'offline' : st.settings.agent.model || 'offline';
    const imgRef = firstAgent?.settings?.image?.modelRef ?? st.composer.image.modelRef;

    ensureNode('sys_chat', at(1, 0), {
      kind: 'ref',
      type: 'chat',
      ref: sessionId,
      title: 'Chat',
    });
    // Place Agent well below the full Chat card (feed + composer ~560px) so they never overlap.
    ensureNode('sys_agent', { x: ox + COL, y: 620 }, {
      kind: 'ref',
      type: 'agent',
      ref: sessionId,
      title: 'Agent',
    });
    ensureNode('sys_model_llm', at(0, 0), {
      kind: 'ref',
      type: 'model',
      ref: llmRef,
      title: modelLabelForRef(llmRef),
      mediaKind: 'llm',
      attachMode: 'docked',
      dockedTo: 'sys_agent',
    });
    ensureNode('sys_model_image', at(0, 1), {
      kind: 'ref',
      type: 'model',
      ref: imgRef,
      title: modelLabelForRef(imgRef),
      mediaKind: 'image',
      attachMode: 'wired',
    });

    if (firstAgent?.settings?.video?.modelRef) {
      const vidRef = firstAgent.settings.video.modelRef;
      ensureNode('sys_model_video', at(0, 2), {
        kind: 'ref',
        type: 'model',
        ref: vidRef,
        title: modelLabelForRef(vidRef),
        mediaKind: 'video',
        attachMode: 'wired',
      });
      ensureEdge({
        id: 'sys_edge_vid_agent',
        source: 'sys_model_video',
        target: 'sys_agent',
        sourceHandle: 'model',
        targetHandle: 'model',
        kind: 'control',
      });
    }

    if (session.docs.length > 0) {
      session.docs.forEach((doc, idx) => {
        ensureNode(`sys_doc_${doc.id}`, at(2, idx), {
          kind: 'ref',
          type: 'designer.doc',
          ref: doc.id,
          title: doc.name || 'Designer Doc',
        });
      });
    } else {
      ensureNode('sys_doc_active', at(2, 0), {
        kind: 'ref',
        type: 'designer.doc',
        ref: session.activeDocId ?? 'active',
        title: 'Designer Doc',
      });
    }

    ensureNode('sys_space_create', at(2, Math.max(session.docs.length, 1)), {
      kind: 'ref',
      type: 'space',
      ref: 'create',
      title: 'Create Space',
    });
    ensureNode('sys_space_tools', at(2, Math.max(session.docs.length, 1) + 1), {
      kind: 'ref',
      type: 'space',
      ref: 'tools',
      title: 'Tools Space',
    });

    const firstDocNode = nodes.find((n) => n.data.kind === 'ref' && n.data.type === 'designer.doc');
    ensureEdge({
      id: 'sys_edge_chat_agent',
      source: 'sys_chat',
      target: 'sys_agent',
      sourceHandle: 'agent',
      targetHandle: 'chat',
      kind: 'control',
      both: true,
    });
    ensureEdge({
      id: 'sys_edge_llm_agent',
      source: 'sys_model_llm',
      target: 'sys_agent',
      sourceHandle: 'model',
      targetHandle: 'model',
      kind: 'control',
    });
    ensureEdge({
      id: 'sys_edge_img_agent',
      source: 'sys_model_image',
      target: 'sys_agent',
      sourceHandle: 'model',
      targetHandle: 'model',
      kind: 'control',
    });
    if (firstDocNode) {
      ensureEdge({
        id: 'sys_edge_agent_doc',
        source: 'sys_agent',
        target: firstDocNode.id,
        sourceHandle: 'target',
        targetHandle: 'ref',
        kind: 'ref',
        both: true,
      });
    }
    ensureEdge({
      id: 'sys_edge_agent_space',
      source: 'sys_agent',
      target: 'sys_space_create',
      sourceHandle: 'target',
      targetHandle: 'ref',
      kind: 'ref',
    });
  } else {
    session.docs.forEach((doc, idx) => {
      const alreadyRepresented = nodes.some(
        (n) => n.data.kind === 'ref' && n.data.type === 'designer.doc' && (n.data.ref === doc.id || n.data.ref === 'active'),
      );
      if (!alreadyRepresented) {
        ensureNode(`sys_doc_${doc.id}`, at(2, nodes.filter((n) => n.data.kind === 'ref').length + idx), {
          kind: 'ref',
          type: 'designer.doc',
          ref: doc.id,
          title: doc.name || 'Designer Doc',
        });
      }
    });
  }

  return { nodes, edges, addedIds };
}

/**
 * Ensure the session's system parts (chat, agent, attached models, Designer docs, Spaces) are materialized as reference
 * nodes on the Nodes canvas. When `recordHistory` is false (default on initial canvas mount), it does not push an undo entry.
 */
export function ensureSystemNodes(sessionId: string, opts: { recordHistory?: boolean } = {}): string[] {
  const st = useStore.getState();
  const session = st.sessions[sessionId];
  if (!session) return [];
  const { nodes, edges, addedIds } = buildInitialSystemGraph(sessionId, session.graph);
  if (!addedIds.length) {
    reconcileDeletionNotices(sessionId);
    return [];
  }
  const nextGraph: Graph = { ...session.graph, nodes, edges };
  editCompound(sessionId, 'system-nodes', () => nextGraph, opts.recordHistory ? {} : { silent: true });
  reconcileDeletionNotices(sessionId);
  return addedIds;
}

/** A system change names the cables it removes (`dropped`): the layer checks the rest of the graph kept every cable. */
function commitSystemGraph(sessionId: string, update: (g: Graph) => { graph: Graph; dropped: string[] }): string | null {
  return editCompound(sessionId, 'system-link', update);
}

export function addSystemNode(
  sessionId: string,
  spec: {
    id?: string;
    type: SystemNodeType;
    ref?: string;
    title?: string;
    position?: { x: number; y: number };
    attachMode?: ModelAttachMode;
    dockedTo?: string;
    mediaKind?: MediaKind | 'llm';
  },
): string {
  const st = useStore.getState();
  const session = st.sessions[sessionId];
  // One Studio, one Nodes and one Designer node per session: asking again gives the one that is there.
  const only = spec.type === 'space' && spec.ref && isOmniSpace(spec.ref) ? session?.graph.nodes.find((n) => n.data.kind === 'ref' && n.data.type === 'space' && n.data.ref === spec.ref) : undefined;
  if (only) return only.id;
  const defaultRef =
    spec.ref ??
    (spec.type === 'chat' || spec.type === 'agent' || spec.type === 'session'
      ? sessionId
      : spec.type === 'model'
        ? st.composer.image.modelRef
        : spec.type === 'provider'
          ? 'openrouter'
          : spec.type === 'designer.doc'
            ? session?.activeDocId ?? session?.docs[0]?.id ?? 'active'
            : spec.type === 'space'
              ? 'create'
              : spec.type);
  const title =
    spec.title ??
    (spec.type === 'model'
      ? modelLabelForRef(defaultRef)
      : spec.type === 'designer.doc'
        ? session?.docs.find((d) => d.id === defaultRef)?.name ?? SYSTEM_NODE_TYPES[spec.type].title
        : SYSTEM_NODE_TYPES[spec.type].title);
  const id = spec.id ?? uid(`sys_${spec.type.replace('.', '_')}`);
  const count = session?.graph.nodes.length ?? 0;
  const position = spec.position ?? { x: sysOrigin(session?.graph ?? { nodes: [], edges: [] }) + 3 * COL, y: ROW * (count % 6) };
  const data: RefNodeData = {
    kind: 'ref',
    type: spec.type,
    ref: defaultRef,
    title,
    ...(spec.attachMode ? { attachMode: spec.attachMode } : {}),
    ...(spec.dockedTo ? { dockedTo: spec.dockedTo } : {}),
    ...(spec.mediaKind ? { mediaKind: spec.mediaKind } : {}),
  };
  // A node of the same id is replaced by the new one; its cables stay.
  editCompound(sessionId, 'system-node', (g) => ({ ...g, nodes: [...g.nodes.filter((n) => n.id !== id), { id, position, data }] }));
  return id;
}

/**
 * Control link model → agent has a real effect: the agent's image/video model for this session becomes the model node's.
 * (The LLM model is the user's global setting and is not changed by a link.) Returns whether the agent config changed.
 */
export function applyModelLinkToAgent(sessionId: string, modelNodeId: string, agentNodeId: string): boolean {
  const session = useStore.getState().sessions[sessionId];
  const model = session?.graph.nodes.find((n) => n.id === modelNodeId)?.data;
  const agent = session?.graph.nodes.find((n) => n.id === agentNodeId)?.data;
  if (!session || model?.kind !== 'ref' || model.type !== 'model' || agent?.kind !== 'ref' || agent.type !== 'agent') return false;
  const kind = model.mediaKind;
  if ((kind !== 'image' && kind !== 'video') || !model.ref) return false;
  const current = laneState(sessionId, agentNodeId)?.settings?.[kind];
  if (current?.modelRef === model.ref) return false;
  patchLane(agent.ref in useStore.getState().sessions ? agent.ref : sessionId, agentNodeId, (a) => ({ settings: { ...a.settings, [kind]: { needsImage: false, ...a.settings?.[kind], modelRef: model.ref } } }));
  return true;
}

/** Gives one agent node its own LLM (null = follow the default in settings.agent again). */
export function setAgentLlm(sessionId: string, nodeId: string, llm: { provider: string; model: string } | null): string | null {
  const node = useStore.getState().sessions[sessionId]?.graph.nodes.find((n) => n.id === nodeId);
  if (node?.data.kind !== 'ref' || node.data.type !== 'agent') return `No such agent node: ${nodeId}.`;
  const done = applyEdit({ session: sessionId, op: { op: 'set', node: nodeId, patch: { llm: llm ?? undefined }, strict: true } });
  return done.ok ? null : done.error;
}

export function attachModelToNode(
  sessionId: string,
  opts: {
    targetNodeId?: string;
    modelNodeId?: string;
    modelRef?: string;
    mode: ModelAttachMode;
    mediaKind?: MediaKind | 'llm';
  },
): { error: string | null; modelNodeId?: string; edgeId?: string; groupId?: string } {
  ensureSystemNodes(sessionId);
  const st = useStore.getState();
  const session = st.sessions[sessionId];
  if (!session) return { error: 'No such session.' };
  const graph = session.graph;
  const hostId = opts.targetNodeId ?? graph.nodes.find((n) => n.data.kind === 'ref' && n.data.type === 'agent')?.id ?? 'sys_agent';
  const host = graph.nodes.find((n) => n.id === hostId);
  if (!host) return { error: `No such target node: ${hostId}.` };

  const existingModelNode = opts.modelNodeId
    ? graph.nodes.find((n) => n.id === opts.modelNodeId)
    : opts.modelRef
      ? graph.nodes.find((n) => n.data.kind === 'ref' && n.data.type === 'model' && n.data.ref === opts.modelRef)
      : undefined;

  const modelRef =
    opts.modelRef ??
    (existingModelNode?.data.kind === 'ref' ? existingModelNode.data.ref : undefined) ??
    st.composer.image.modelRef;
  const mediaKind =
    opts.mediaKind ??
    (existingModelNode?.data.kind === 'ref' ? existingModelNode.data.mediaKind : undefined) ??
    st.catalog.models[modelRef]?.kind ??
    'image';
  const modelNodeId = existingModelNode?.id ?? uid('sys_model');
  const existingEdge = graph.edges.find(
    (e) =>
      (e.kind ?? 'data') === 'control' &&
      ((e.source === modelNodeId && e.target === hostId) || (e.source === hostId && e.target === modelNodeId)),
  );
  const edgeId = existingEdge?.id ?? uid('edge');
  const groupId = `grp_sys_${hostId}`;

  const error = commitSystemGraph(sessionId, (g) => {
    const modelData: RefNodeData = {
      kind: 'ref',
      type: 'model',
      ref: modelRef,
      title: existingModelNode?.data.title ?? modelLabelForRef(modelRef),
      mediaKind,
      attachMode: opts.mode,
      ...(opts.mode === 'docked' || opts.mode === 'merged' ? { dockedTo: hostId } : {}),
    };
    const modelPos = existingModelNode?.position ?? { x: host.position.x - COL, y: host.position.y + ROW * g.nodes.filter((n) => n.data.kind === 'ref' && n.data.type === 'model').length };
    const hasModelNode = g.nodes.some((n) => n.id === modelNodeId);
    const nodes = (hasModelNode ? g.nodes : [...g.nodes, { id: modelNodeId, position: modelPos, data: modelData }]).map((n) => {
      if (n.id === modelNodeId) return { ...n, data: modelData };
      if (n.id === hostId && n.data.kind === 'ref') {
        const merged = new Set(n.data.mergedModels ?? []);
        if (opts.mode === 'merged') merged.add(modelRef);
        else merged.delete(modelRef);
        return { ...n, data: { ...n.data, mergedModels: [...merged] } };
      }
      return n;
    });

    const edges = [
      ...g.edges.filter((e) => e.id !== edgeId && !(e.source === modelNodeId && e.target === hostId && (e.kind ?? 'data') === 'control')),
      {
        id: edgeId,
        source: modelNodeId,
        target: hostId,
        sourceHandle: 'model',
        targetHandle: 'model',
        kind: 'control' as const,
      },
    ];

    let groups: GraphGroup[] = [...(g.groups ?? [])];
    if (opts.mode === 'grouped') {
      const existingGrp = groups.find((gr) => gr.id === groupId);
      const memberIds = [...new Set([...(existingGrp?.nodeIds ?? [hostId]), hostId, modelNodeId])];
      groups = [
        ...groups.filter((gr) => gr.id !== groupId),
        { id: groupId, title: `${host.data.title} + Models`, nodeIds: memberIds },
      ];
    } else {
      groups = groups
        .map((gr) => (gr.id === groupId ? { ...gr, nodeIds: gr.nodeIds.filter((id) => id !== modelNodeId) } : gr))
        .filter((gr) => gr.nodeIds.length > 1);
    }

    // The cable this attach replaces: any other control cable from this model to this host.
    const dropped = g.edges.filter((e) => e.id !== edgeId && e.source === modelNodeId && e.target === hostId && (e.kind ?? 'data') === 'control').map((e) => e.id);
    return { graph: { ...g, nodes, edges, ...(groups.length ? { groups } : { groups: undefined }) }, dropped };
  });

  if (!error) applyModelLinkToAgent(sessionId, modelNodeId, hostId);
  return { error, modelNodeId, edgeId, ...(opts.mode === 'grouped' ? { groupId } : {}) };
}

export function detachModelFromNode(
  sessionId: string,
  opts: { targetNodeId?: string; modelNodeId?: string; modelRef?: string },
): { error: string | null } {
  ensureSystemNodes(sessionId);
  const st = useStore.getState();
  const session = st.sessions[sessionId];
  if (!session) return { error: 'No such session.' };
  const graph = session.graph;
  const hostId = opts.targetNodeId ?? graph.nodes.find((n) => n.data.kind === 'ref' && n.data.type === 'agent')?.id ?? 'sys_agent';
  const modelNode = opts.modelNodeId
    ? graph.nodes.find((n) => n.id === opts.modelNodeId)
    : opts.modelRef
      ? graph.nodes.find((n) => n.data.kind === 'ref' && n.data.type === 'model' && n.data.ref === opts.modelRef)
      : undefined;
  const modelRef = opts.modelRef ?? (modelNode?.data.kind === 'ref' ? modelNode.data.ref : undefined);

  if (!modelNode && !modelRef) return { error: 'No such attached model.' };

  const error = commitSystemGraph(sessionId, (g) => {
    const nodes = g.nodes.map((n) => {
      if (modelNode && n.id === modelNode.id && n.data.kind === 'ref') {
        const nextData: RefNodeData = { ...n.data, attachMode: 'wired' };
        delete nextData.dockedTo;
        return { ...n, data: nextData };
      }
      if (n.id === hostId && n.data.kind === 'ref' && modelRef && n.data.mergedModels?.includes(modelRef)) {
        return { ...n, data: { ...n.data, mergedModels: n.data.mergedModels.filter((m) => m !== modelRef) } };
      }
      return n;
    });
    const gone = (e: GraphEdge) => Boolean(modelNode) && (e.kind ?? 'data') === 'control' && ((e.source === modelNode!.id && e.target === hostId) || (e.source === hostId && e.target === modelNode!.id));
    const edges = g.edges.filter((e) => !gone(e));
    const groups = (g.groups ?? [])
      .map((gr) => (modelNode ? { ...gr, nodeIds: gr.nodeIds.filter((id) => id !== modelNode.id) } : gr))
      .filter((gr) => gr.nodeIds.length > 1);
    return { graph: { ...g, nodes, edges, ...(groups.length ? { groups } : { groups: undefined }) }, dropped: g.edges.filter(gone).map((e) => e.id) };
  });

  return { error };
}

export function linkSystemNodes(
  sessionId: string,
  opts: {
    source: string;
    target: string;
    kind: LinkKind;
    both?: boolean;
    sourceHandle?: string;
    targetHandle?: string;
    /** A caller that cannot see the port (commands, the agent) names the cable it replaces; the interface leaves it out and replaces what it shows. */
    replaces?: string | null;
  },
): { error: string | null; edgeId?: string } {
  ensureSystemNodes(sessionId);
  const st = useStore.getState();
  const graph = st.sessions[sessionId]?.graph;
  if (!graph) return { error: 'No such session.' };
  if (opts.both && opts.kind === 'data') {
    const msg = 'Data links cannot be bidirectional (both is only allowed on ref and control links).';
    toast(msg, 'error');
    return { error: msg };
  }
  const src = graph.nodes.find((n) => n.id === opts.source);
  const tgt = graph.nodes.find((n) => n.id === opts.target);
  if (!src || !tgt) return { error: 'Unknown node.' };
  if (opts.source === opts.target) return { error: 'A node cannot connect to itself.' };

  const srcPorts =
    src.data.kind === 'ref'
      ? systemNodePorts(src.data)
      : [
          { id: 'out', direction: 'out' as const, kind: 'data' as const, type: 'any' },
          { id: 'out_ref', direction: 'out' as const, kind: 'ref' as const, type: 'any' },
          { id: 'out_control', direction: 'out' as const, kind: 'control' as const, type: 'control' },
        ];
  const tgtPorts =
    tgt.data.kind === 'ref'
      ? systemNodePorts(tgt.data)
      : [
          { id: opts.targetHandle ?? 'in', direction: 'in' as const, kind: 'data' as const, type: 'any', multi: true },
          { id: 'sys_ref', direction: 'in' as const, kind: 'ref' as const, type: 'any', multi: true },
          { id: 'model', direction: 'in' as const, kind: 'control' as const, type: 'model', multi: false },
          { id: 'control', direction: 'in' as const, kind: 'control' as const, type: 'control', multi: true },
        ];

  const resolved = resolveSystemConnection(srcPorts, tgtPorts, {
    sourceHandle: opts.sourceHandle,
    targetHandle: opts.targetHandle,
    kind: opts.kind,
  });
  if (resolved.classMismatch) return { error: resolved.classMismatch };
  if (!resolved.tgtPort) return { error: 'This node has no such input.' };
  if (!resolved.srcPort) return { error: 'The source has no output yet.' };
  if (!portTypeCompatible(opts.kind, resolved.srcPort.type, resolved.tgtPort.type)) {
    return { error: `${resolved.tgtPort.label ?? resolved.tgtPort.id} expects ${resolved.tgtPort.type}, got ${resolved.srcPort.type}.` };
  }
  // One commit path (ADR 0031 point 5): replacement, loop check, locks, trace and the model→agent copy live in the layer.
  const occupied = graph.edges.find((e) => e.target === opts.target && e.targetHandle === resolved.tgtPort!.id && (e.kind ?? 'data') === opts.kind && e.source !== opts.source);
  const done = applyEdit({ session: sessionId, op: { op: 'connect', source: opts.source, target: opts.target, targetHandle: resolved.tgtPort.id, kind: opts.kind, both: opts.both, replaces: opts.replaces !== undefined ? opts.replaces : occupied?.id ?? null, ports: { srcPort: resolved.srcPort, tgtPort: resolved.tgtPort, kind: opts.kind } } });
  const error = done.ok ? null : done.error;
  const edgeId = done.ok ? done.edgeId : undefined;
  return { error, ...(error ? {} : { edgeId }) };
}

export function unlinkSystemNodes(
  sessionId: string,
  opts: { edgeId?: string; source?: string; target?: string; kind?: LinkKind },
): { error: string | null; removed: string[] } {
  ensureSystemNodes(sessionId);
  const st = useStore.getState();
  const graph = st.sessions[sessionId]?.graph;
  if (!graph) return { error: 'No such session.', removed: [] };

  const toRemove = graph.edges
    .filter((e) => {
      if (opts.edgeId) return e.id === opts.edgeId;
      if (opts.source && opts.target) {
        const pairMatch =
          (e.source === opts.source && e.target === opts.target) ||
          (Boolean(e.both) && e.source === opts.target && e.target === opts.source);
        return pairMatch && (!opts.kind || (e.kind ?? 'data') === opts.kind);
      }
      return false;
    })
    .map((e) => e.id);
  // An invalid cable left by a deleted node is a connection too: it is removed the same way.
  if (opts.edgeId && !toRemove.length && graph.broken?.some((b) => b.edge.id === opts.edgeId)) toRemove.push(opts.edgeId);

  if (!toRemove.length) return { error: 'No matching connection found.', removed: [] };
  const done = applyEdit({ session: sessionId, op: { op: 'disconnect', edges: toRemove } });
  const error = done.ok ? null : done.error;
  return { error, removed: error ? [] : toRemove };
}

/** Make a ref or control link bidirectional, or one-way again. One undo step; data links cannot be both. */
export function setLinkBoth(sessionId: string, edgeId: string, both: boolean): string | null {
  const graph = useStore.getState().sessions[sessionId]?.graph;
  const edge = graph?.edges.find((e) => e.id === edgeId);
  if (!graph || !edge) return `No such edge: ${edgeId}.`;
  if (both && (edge.kind ?? 'data') === 'data') return 'Data links cannot be bidirectional (both is only allowed on ref and control links).';
  return commitSystemGraph(sessionId, (g) => ({
    graph: {
      ...g,
      edges: g.edges.map((e) => {
        if (e.id !== edgeId) return e;
        const { both: _old, ...rest } = e;
        return both ? { ...rest, both: true } : rest;
      }),
    },
    dropped: [],
  }));
}
