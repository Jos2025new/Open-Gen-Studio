import { uid } from '../../lib/id';
import { recordJourneyEvent } from '../../lib/journeyTrace';
import { setGraph, toast, useStore } from '../../store/store';
import { connect, connectionError, inputPorts, nodePorts } from '../flow/graph';
import { graphEditProblem } from '../flow/locks';
import { applyModelLinkToAgent } from '../nodes/system';
import type { Graph, GraphEdge, GraphNode, GraphNodeData, LinkKind, PortSpec } from '../types';
import { findCycle } from './deps';
import { descriptorOf } from './registry';
import { ownerRev } from './revision';

/*
 * The single editing layer (ADR 0031 point 5). UI, agent and commands change topology and parameters through here.
 * Each operation may carry the owner revisions it was drawn from (`expect`): when one moved, the edit is refused with
 * a conflict and the request comes back as `draft`, so the caller keeps what the user wanted. On a single-cable input
 * the replaced cable is part of the operation (`replaces`). Connecting never starts a provider call, a send or a spend;
 * the only follow-up is the declared parameter copy of a model link into its agent (no network, no cost).
 */
export interface ResolvedPorts { srcPort: PortSpec; tgtPort: PortSpec; kind: LinkKind }

export type EditOp =
  | {
    op: 'connect'; source: string; target: string; targetHandle: string | null; sourceHandle?: string | null; kind?: LinkKind; both?: boolean;
    /** The cable expected on a single-cable input: an edge id, `null` for none, `'any'` to replace whatever is there. */
    replaces?: string | null | 'any';
    /** The caller already resolved and validated the ports (the system link command); skips the UI validation. */
    ports?: ResolvedPorts;
  }
  | { op: 'disconnect'; edges: string[] }
  | { op: 'set'; node: string; patch: Partial<GraphNodeData>; strict?: boolean }
  | { op: 'delete'; nodes: string[] }
  /** A new node, optionally wired in the same step: a rejected wire leaves no orphan node and Undo removes both. */
  | { op: 'add'; node: GraphNode; connect?: { source: string; targetHandle: string; sourceHandle?: string | null } };

/** `require`: the caller must say which revision it read (commands and the agent); the interface passes none and edits what it shows. */
export interface EditRequest { session: string; op: EditOp; expect?: Record<string, string>; require?: true }

export type EditResult =
  | { ok: true; edgeId?: string; rev: Record<string, string> }
  | { ok: false; error: string; conflict?: { node: string; expected: string; actual: string }; draft: EditRequest };

/** The nodes whose revision the edit depends on. */
const touched = (op: EditOp): string[] => op.op === 'connect' ? [op.source, op.target] : op.op === 'disconnect' ? [] : op.op === 'set' ? [op.node] : op.op === 'add' ? (op.connect ? [op.connect.source] : []) : op.nodes;
const owners = (op: EditOp): string[] => op.op === 'connect' ? [op.target] : op.op === 'set' ? [op.node] : op.op === 'delete' ? op.nodes : op.op === 'add' && op.connect ? [op.connect.source] : [];
const refuse = (req: EditRequest, error: string, conflict?: { node: string; expected: string; actual: string }): EditResult => ({ ok: false, error, ...(conflict ? { conflict } : {}), draft: req });

/** The owner revisions of the nodes an edit touches, to hand back to the caller for its next precondition. */
export const revisionsOf = (graph: Graph, ids: string[]): Record<string, string> => Object.fromEntries(ids.map((id) => [id, ownerRev(graph, id)]));

function sameKind(e: GraphEdge, kind: LinkKind) { return (e.kind ?? 'data') === kind; }

/** The edge a connect would add, or the reason it cannot. Pure on the graph. */
function planConnect(graph: Graph, op: Extract<EditOp, { op: 'connect' }>, assets: Record<string, import('../types').Asset>): { next: Graph; edgeId: string } | { error: string; conflict?: { node: string; expected: string; actual: string } } {
  const { source, target } = op;
  let next: Graph;
  let kind: LinkKind = op.kind ?? 'data';
  let targetHandle = op.targetHandle ?? op.kind ?? 'in';
  let multi: boolean;
  if (op.ports) {
    const { srcPort, tgtPort } = op.ports;
    kind = op.ports.kind;
    targetHandle = tgtPort.id;
    // The descriptor's cardinality wins over a caller's generic port table: one source of truth for «single cable».
    const own = kind === 'data' ? inputPorts(graph.nodes.find((n) => n.id === target)!.data).find((p) => p.id === targetHandle) : undefined;
    multi = own ? own.multi : tgtPort.multi !== false;
    const edge: GraphEdge = { id: uid('edge'), source, target, sourceHandle: srcPort.id, targetHandle, kind, ...(op.both && kind !== 'data' ? { both: true } : {}) };
    const dup = (e: GraphEdge) => e.source === source && e.target === target && e.targetHandle === targetHandle && sameKind(e, kind);
    const occupant = multi ? undefined : graph.edges.find((e) => e.target === target && e.targetHandle === targetHandle && sameKind(e, kind) && !dup(e));
    const refused = replaceConflict(occupant, op.replaces, target, targetHandle, graph);
    if (refused) return refused;
    next = { ...graph, edges: [...graph.edges.filter((e) => !dup(e) && (multi || !(e.target === target && e.targetHandle === targetHandle && sameKind(e, kind)))), edge] };
    return finishConnect(graph, next, edge.id, source, target, kind);
  }
  const problem = connectionError(graph, assets, { source, target, targetHandle: op.targetHandle, sourceHandle: op.sourceHandle, kind: op.kind, both: op.both });
  if (problem) return { error: problem };
  const tgt = graph.nodes.find((n) => n.id === target)!;
  const legacyPort = inputPorts(tgt.data).find((p) => p.id === targetHandle);
  const before = new Set(graph.edges.map((e) => e.id));
  next = connect(graph, { source, target, targetHandle, sourceHandle: op.sourceHandle, kind: op.kind, both: op.both });
  // Whatever the old edge on a single-cable input was, `replaces` must name it.
  const replacedEdge = graph.edges.find((e) => !next.edges.some((n) => n.id === e.id) && e.target === target && e.targetHandle === targetHandle);
  const isSingle = legacyPort ? !legacyPort.multi : replacedEdge !== undefined;
  const sameSource = replacedEdge?.source === source && op.replaces == null; // wiring the same cable again is not a replacement
  const refused = isSingle && !sameSource ? replaceConflict(replacedEdge, op.replaces, target, targetHandle, graph) : null;
  if (refused) return refused;
  const added = next.edges.find((e) => !before.has(e.id));
  return finishConnect(graph, next, added?.id ?? '', source, target, kind);
}

function replaceConflict(occupant: GraphEdge | undefined, replaces: string | null | undefined, target: string, port: string, graph: Graph) {
  if (replaces === 'any') return null;
  // The cable that was expected is gone: that is a conflict too, not permission to wire over whatever is there now.
  // With no other cable on this input, the named one must still be on this very input (the same wiring again), never one of another node.
  if (!occupant) return typeof replaces === 'string' && !graph.edges.some((e) => e.id === replaces && e.target === target && e.targetHandle === port) ? { error: `The cable ${replaces} you meant to replace on "${port}" is no longer there.`, conflict: { node: target, expected: replaces, actual: 'none' } } : null;
  if (replaces === occupant.id) return null;
  return { error: `The input "${port}" already has a cable (${occupant.id}); name it as the one to replace.`, conflict: { node: target, expected: replaces ?? 'none', actual: occupant.id } };
}

function finishConnect(_before: Graph, next: Graph, edgeId: string, source: string, target: string, kind: LinkKind) {
  if (kind === 'data') {
    const loop = findCycle(next);
    if (loop) return { error: `That connection would create a loop (${loop.join(' → ')}).` };
  }
  return { next, edgeId, source, target };
}

function planDelete(graph: Graph, ids: string[]): Graph {
  const drop = new Set(ids);
  // Any link (data, ref or control) that lost its source stays as an invalid cable on the node that kept it. A cable whose owner is
  // deleted goes with it (the owner's cables are its own), and tombstones of a deleted owner are pruned.
  const kept = (graph.broken ?? []).filter((b) => !drop.has(b.edge.target));
  const lost = graph.edges.filter((e) => drop.has(e.source) && !drop.has(e.target));
  const broken = [...kept, ...lost.map((edge) => ({ edge, missing: 'source' as const, at: Date.now() }))];
  // Deleted nodes leave their group; a detached output set keeps its restore snapshot.
  const groups = graph.groups?.map((gr) => ({ ...gr, nodeIds: gr.nodeIds.filter((id) => !drop.has(id)) })).filter((gr) => gr.nodeIds.length > 1 || (gr.nodeIds.length > 0 && 'detachedOutputs' in gr));
  return { ...graph, nodes: graph.nodes.filter((n) => !drop.has(n.id)), edges: graph.edges.filter((e) => !drop.has(e.source) && !drop.has(e.target)), ...(graph.groups ? { groups } : {}), ...(broken.length ? { broken } : {}) };
}

/** Run one edit. Same commit rules as the old `editGraph`: the lock check, the toast, one `setGraph`. */
/** The error of a refused edit, or null when it applied: the shape the flow actions return. */
export const editError = (r: EditResult): string | null => (r.ok ? null : r.error);

export function applyEdit(req: EditRequest): EditResult {
  const st = useStore.getState();
  const graph = st.sessions[req.session]?.graph;
  if (!graph) return refuse(req, 'No such session.');
  if (req.require) {
    const missingRev = owners(req.op).find((id) => !req.expect || !(id in req.expect));
    if (missingRev) return refuse(req, `Say which revision of "${missingRev}" you read (expect): this edit does not run blind.`);
  }
  for (const [node, expected] of Object.entries(req.expect ?? {})) {
    const actual = ownerRev(graph, node);
    if (actual !== expected) return refuse(req, `"${node}" changed since you read it; your edit was kept as a draft.`, { node, expected, actual });
  }
  const op = req.op;
  let next: Graph;
  let edgeId: string | undefined;
  switch (op.op) {
    case 'connect': {
      const missing = [op.source, op.target].find((id) => !graph.nodes.some((n) => n.id === id));
      if (missing) return refuse(req, missing === op.source && !graph.nodes.some((n) => n.id === op.target) ? 'Unknown node.' : `No such node: ${missing}.`);
      if (op.source === op.target) return refuse(req, 'A node cannot connect to itself.');
      const planned = planConnect(graph, op, st.assets);
      if ('error' in planned) { if (!planned.conflict) toast(planned.error, 'error'); return refuse(req, planned.error, planned.conflict); }
      next = planned.next; edgeId = planned.edgeId;
      break;
    }
    case 'disconnect': {
      const missing = op.edges.find((id) => !graph.edges.some((e) => e.id === id) && !graph.broken?.some((b) => b.edge.id === id));
      if (missing) return refuse(req, `No such connection: ${missing}.`);
      const broken = (graph.broken ?? []).filter((b) => !op.edges.includes(b.edge.id));
      next = { ...graph, edges: graph.edges.filter((e) => !op.edges.includes(e.id)), ...(graph.broken ? { broken: broken.length ? broken : undefined } : {}) };
      break;
    }
    case 'set': {
      const node = graph.nodes.find((n) => n.id === op.node);
      if (!node) return refuse(req, `No such node: ${op.node}.`);
      if (op.strict) {
        const owned = descriptorOf(node.data.kind)?.params ?? [];
        const stray = Object.keys(op.patch).find((k) => !owned.includes(k) && k !== 'generationId' && k !== 'sketchAssetId');
        if (stray) return refuse(req, `"${stray}" is not a parameter of a ${node.data.kind} node.`);
      }
      next = { ...graph, nodes: graph.nodes.map((n) => n.id === op.node ? { ...n, data: { ...n.data, ...op.patch } as GraphNodeData } : n) };
      if ('subjects' in op.patch) { const loop = findCycle(next); if (loop) return refuse(req, `That would create a loop (${loop.join(' → ')}).`); }
      break;
    }
    case 'add': {
      if (graph.nodes.some((n) => n.id === op.node.id)) return refuse(req, `Node ${op.node.id} already exists.`);
      const withNode = { ...graph, nodes: [...graph.nodes, op.node] };
      if (!op.connect) { next = withNode; break; }
      if (!graph.nodes.some((n) => n.id === op.connect!.source)) return refuse(req, `No such node: ${op.connect.source}.`);
      const planned = planConnect(withNode, { op: 'connect', source: op.connect.source, target: op.node.id, targetHandle: op.connect.targetHandle, sourceHandle: op.connect.sourceHandle, replaces: null }, st.assets);
      if ('error' in planned) return refuse(req, planned.error, planned.conflict);
      next = planned.next; edgeId = planned.edgeId;
      break;
    }
    case 'delete': {
      const missing = op.nodes.find((id) => !graph.nodes.some((n) => n.id === id));
      if (missing) return refuse(req, `No such node: ${missing}.`);
      next = planDelete(graph, op.nodes);
      break;
    }
  }
  if (op.op === 'connect' && next.broken?.length) {
    // A new cable on a port takes the place of the invalid one that was left there.
    // Only a single-cable port is repaired by wiring it again; on a multi-cable port the invalid cable stays until removed.
    const added = next.edges.find((e) => e.id === edgeId);
    const tgt = added && next.nodes.find((n) => n.id === added.target);
    const single = tgt && nodePorts(tgt.data, st.assets).find((p) => p.id === added!.targetHandle && p.direction === 'in')?.multi === false;
    const left = next.broken.filter((b) => !(single && added && b.edge.target === added.target && b.edge.targetHandle === added.targetHandle && (b.edge.kind ?? 'data') === (added.kind ?? 'data')));
    next = { ...next, broken: left.length ? left : undefined };
  }
  const locked = graphEditProblem(req.session, graph, next);
  if (locked) { toast(locked, 'error'); return refuse(req, locked); }
  setGraph(req.session, () => next);
  // The kind is the one the edge really got (a dragged Model→Agent cable is inferred as control, like the command).
  const made = edgeId ? next.edges.find((e) => e.id === edgeId) : undefined;
  if (made && (made.kind ?? 'data') === 'control') applyModelLinkToAgent(req.session, made.source, made.target);
  recordJourneyEvent({ journeyId: req.session, journey: 'node-core', event: `edit.${op.op}`, reason: 'edit through the single editing layer', sessionId: req.session, after: { op, edgeId } });
  return { ok: true, ...(edgeId ? { edgeId } : {}), rev: revisionsOf(next, touched(op)) };
}
