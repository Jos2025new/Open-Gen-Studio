import { uid } from '../../lib/id';
import { recordJourneyEvent } from '../../lib/journeyTrace';
import { setGraph, toast, useStore } from '../../store/store';
import { nodePorts, resolveWiring, sameSourcePort, withEdge } from '../flow/graph';
import { graphEditProblem } from '../flow/locks';
import { applyModelLinkToAgent } from '../nodes/system';
import type { Asset, Graph, GraphEdge, GraphNode, GraphNodeData, LinkKind } from '../types';
import { findCycle } from './deps';
import { stampNew } from './migrate';
import { descriptorOf } from './registry';
import { ownerRev } from './revision';

/*
 * The single editing layer (ADR 0031 point 5). UI, agent and commands change topology and parameters through here.
 * Each operation may carry the owner revisions it was drawn from (`expect`): when one moved, the edit is refused with
 * a conflict and the request comes back as `draft`, so the caller keeps what the user wanted. On a single-cable input
 * the replaced cable is part of the operation (`replaces`). Connecting never starts a provider call, a send or a spend;
 * the only follow-up is the declared parameter copy of a model link into its agent (no network, no cost).
 */
export type EditOp =
  | {
    op: 'connect'; source: string; target: string; targetHandle: string | null; sourceHandle?: string | null; kind?: LinkKind; both?: boolean;
    /** An edge id, `null` for none, or omitted for an internal edit of the current input. */
    replaces?: string | null;
  }
  | { op: 'disconnect'; edges: string[] }
  | { op: 'set'; node: string; patch: Partial<GraphNodeData>; strict?: boolean; }
  | { op: 'delete'; nodes: string[] }
  /**
   * A composed change (paste, restore, system parts, a model swap): the caller builds the next graph and the layer checks
   * what no composed change may do. No cable between two surviving nodes disappears unless it is named in `dropped`, a
   * data cycle is refused, and so are cables or tombstones pointing nowhere. Parameters and topology still pass the lock.
   */
  | { op: 'compound'; label: string; /** Parts the system keeps in step on its own (no undo step). */ silent?: true; change: (g: Graph) => Graph | { graph: Graph; dropped: string[] } }
  /** Undo or redo: the graph the history holds, put back as it was. The history itself decides which one. */
  | { op: 'travel'; graph: Graph; /** A rollback: the history is not touched. */ silent?: true }
  /** Position, size, groups and view only: nodes keep their data and the cables are untouched, or the change is refused. */
  | { op: 'present'; change: (g: Graph) => Graph; silent?: true }
  /** A new node, optionally wired in the same step: a rejected wire leaves no orphan node and Undo removes both. */
  | { op: 'add'; node: GraphNode; connect?: { source: string; targetHandle: string; sourceHandle?: string | null } };

/** `require`: the caller must say which revision it read (commands and the agent); the interface passes none and edits what it shows. */
export interface EditRequest { session: string; op: EditOp; expect?: Record<string, string>; require?: true }

export type EditResult =
  | { ok: true; edgeId?: string; rev: Record<string, string> }
  | { ok: false; error: string; notified?: boolean; conflict?: { node: string; expected: string; actual: string }; draft: EditRequest };

/** The nodes whose revision the edit depends on. */
const touched = (op: EditOp): string[] => op.op === 'compound' || op.op === 'present' || op.op === 'travel' ? [] : op.op === 'connect' ? [op.source, op.target] : op.op === 'disconnect' ? [] : op.op === 'set' ? [op.node] : op.op === 'add' ? (op.connect ? [op.connect.source] : []) : op.nodes;
const owners = (op: EditOp): string[] => op.op === 'compound' || op.op === 'present' || op.op === 'travel' ? [] : op.op === 'connect' ? [op.target] : op.op === 'set' ? [op.node] : op.op === 'delete' ? op.nodes : op.op === 'add' && op.connect ? [op.connect.source] : [];
const refuse = (req: EditRequest, error: string, conflict?: { node: string; expected: string; actual: string }, notified?: true): EditResult => ({ ok: false, error, ...(notified ? { notified } : {}), ...(conflict ? { conflict } : {}), draft: req });

/** The owner revisions of the nodes an edit touches, to hand back to the caller for its next precondition. */
export const revisionsOf = (graph: Graph, ids: string[]): Record<string, string> => Object.fromEntries(ids.map((id) => [id, ownerRev(graph, id)]));

/** The edge a connect would add, or the reason it cannot. Pure on the graph. */
function planConnect(graph: Graph, op: Extract<EditOp, { op: 'connect' }>, assets: Record<string, Asset>): { next: Graph; edgeId: string } | { error: string; conflict?: { node: string; expected: string; actual: string } } {
  const { source, target } = op;
  const src = graph.nodes.find((n) => n.id === source)!;
  const tgt = graph.nodes.find((n) => n.id === target)!;
  const wiring = resolveWiring(src, tgt, assets, op);
  if ('error' in wiring) return wiring;
  const { id: targetHandle, kind, multi } = wiring.port;
  const edge = { id: uid('edge'), ...wiring.edge };
  const onPort = graph.edges.filter((e) => e.target === target && e.targetHandle === targetHandle && (e.kind ?? 'data') === kind);
  const occupant = multi === false ? onPort.find((e) => !sameSourcePort(e, edge)) : undefined;
  const pinned = onPort.find((e) => e.pin && sameSourcePort(e, edge));
  const replaces = op.replaces === undefined ? (occupant ?? pinned)?.id ?? null : op.replaces;
  const refused = replaceConflict(occupant, replaces, target, targetHandle, graph)
    ?? (pinned ? replaceConflict(pinned, replaces, target, targetHandle, graph) : null);
  if (refused) return refused;
  const next = { ...graph, edges: withEdge(graph.edges, edge, multi === false) };
  return finishConnect(next, edge.id, source, target, kind, assets);
}

function replaceConflict(occupant: GraphEdge | undefined, replaces: string | null | undefined, target: string, port: string, graph: Graph) {
  // The cable that was expected is gone: that is a conflict too, not permission to wire over whatever is there now.
  // With no other cable on this input, the named one must still be on this very input (the same wiring again), never one of another node.
  if (!occupant) return typeof replaces === 'string' && !graph.edges.some((e) => e.id === replaces && e.target === target && e.targetHandle === port) ? { error: `The cable ${replaces} you meant to replace on "${port}" is no longer there.`, conflict: { node: target, expected: replaces, actual: 'none' } } : null;
  if (replaces === occupant.id) return null;
  return { error: `The input "${port}" already has a cable (${occupant.id}); name it as the one to replace.`, conflict: { node: target, expected: replaces ?? 'none', actual: occupant.id } };
}

function finishConnect(next: Graph, edgeId: string, source: string, target: string, kind: LinkKind, assets: Record<string, import('../types').Asset>) {
  if (kind === 'data') {
    const loop = findCycle(next, assets);
    if (loop) return { error: `That connection would create a loop (${loop.join(' → ')}).` };
  }
  return { next, edgeId, source, target };
}

/** Why a composed change is refused, or null. */
function compoundProblem(before: Graph, after: Graph, dropped: string[], assets: Record<string, import('../types').Asset>): string | null {
  const alive = new Set(after.nodes.map((n) => n.id));
  const rewired = after.edges.find((e) => { const was = before.edges.find((x) => x.id === e.id); return was && !dropped.includes(e.id) && (was.source !== e.source || was.target !== e.target || was.sourceHandle !== e.sourceHandle || was.targetHandle !== e.targetHandle || was.outputIndex !== e.outputIndex || was.pin !== e.pin || was.kind !== e.kind); });
  if (rewired) return `That change would silently rewire the cable ${rewired.id}; name it in the dropped list and add a new one.`;
  const lost = before.edges.find((e) => alive.has(e.source) && alive.has(e.target) && !after.edges.some((x) => x.id === e.id) && !dropped.includes(e.id));
  if (lost) return `That change would silently remove the cable ${lost.id} (${lost.source} → ${lost.target}).`;
  const dangling = after.edges.find((e) => !alive.has(e.source) || !alive.has(e.target));
  if (dangling) return `The cable ${dangling.id} would point to a node that is not there.`;
  const dup = after.nodes.find((n, i) => after.nodes.findIndex((m) => m.id === n.id) !== i);
  if (dup) return `Node ${dup.id} would exist twice.`;
  // A tombstone the change invents must be a real loss: the consumer is there, the source is gone, and the cable is not live too.
  // Old ones that went stale (consumer gone, source back) are pruned after, never refused.
  const fresh = (after.broken ?? []).filter((b) => !before.broken?.some((o) => o.edge.id === b.edge.id));
  const fake = fresh.find((b) => !alive.has(b.edge.target) || alive.has(b.edge.source) || after.edges.some((e) => e.id === b.edge.id));
  if (fake) return `The invalid cable ${fake.edge.id} would not be a real loss (its consumer must be there, its source gone).`;
  const twice = after.broken?.find((b, i) => after.broken!.findIndex((c) => c.edge.id === b.edge.id) !== i);
  if (twice) return `The invalid cable ${twice.edge.id} would be listed twice.`;
  const loop = findCycle(after, assets);
  return loop ? `That would create a loop (${loop.join(' → ')}).` : null;
}

/** Invalid cables last until their consumer goes, their source comes back, or they are removed: the same rule whichever way the graph is written. */
function pruneBroken(g: Graph): Graph {
  if (!g.broken) return g;
  const live = g.broken.filter((b) => g.nodes.some((n) => n.id === b.edge.target) && !g.nodes.some((n) => n.id === b.edge.source));
  return live.length === g.broken.length ? g : { ...g, broken: live.length ? live : undefined };
}

function planDelete(graph: Graph, ids: string[]): Graph {
  const drop = new Set(ids);
  // Any link (data, ref or control) that lost its source stays as an invalid cable on the node that kept it. A cable whose owner is
  // deleted goes with it (the owner's cables are its own), and tombstones of a deleted owner are pruned.
  const kept = (graph.broken ?? []).filter((b) => !drop.has(b.edge.target));
  const lost = graph.edges.filter((e) => drop.has(e.source) && !drop.has(e.target));
  const broken = [...kept, ...lost.map((edge) => ({ edge, missing: 'source' as const, reason: 'deleted' as const, at: Date.now() }))];
  // Deleted nodes leave their group; a detached output set keeps its restore snapshot.
  const groups = graph.groups?.map((gr) => ({ ...gr, nodeIds: gr.nodeIds.filter((id) => !drop.has(id)) })).filter((gr) => gr.nodeIds.length > 1 || (gr.nodeIds.length > 0 && 'detachedOutputs' in gr));
  return { ...graph, nodes: graph.nodes.filter((n) => !drop.has(n.id)), edges: graph.edges.filter((e) => !drop.has(e.source) && !drop.has(e.target)), ...(graph.groups ? { groups } : {}), ...(broken.length ? { broken } : {}) };
}

/** Things that must stop when their node goes (an agent's turn): registered by their owner, called once the edit is written. */
const removalHooks: Array<(session: string, removed: GraphNode[]) => void> = [];
export const onNodesRemoved = (hook: (session: string, removed: GraphNode[]) => void): void => { removalHooks.push(hook); };

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
      // Changing a port's type can reactivate a cable kept on the graph.
      if ('subjects' in op.patch || 'textOutput' in op.patch || 'op' in op.patch || 'type' in op.patch || 'ref' in op.patch) {
        const loop = findCycle(next, st.assets);
        if (loop) return refuse(req, `That would create a loop (${loop.join(' → ')}).`);
      }
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
    case 'compound': {
      const made = op.change(graph);
      const { graph: after, dropped } = 'graph' in made ? made : { graph: made as Graph, dropped: [] as string[] };
      const problem = compoundProblem(graph, after, dropped, st.assets);
      if (problem) return refuse(req, problem);
      next = after;
      break;
    }
    case 'travel': next = op.graph; break;
    case 'present': {
      const after = op.change(graph);
      const same = after.edges === graph.edges && after.broken === graph.broken && after.nodes.length === graph.nodes.length
        && after.nodes.every((n, i) => n.id === graph.nodes[i].id && n.data === graph.nodes[i].data);
      if (!same) return refuse(req, 'A layout change cannot touch node data or cables.');
      next = after;
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
  next = pruneBroken(stampNew(graph, next));
  const locked = graphEditProblem(req.session, graph, next);
  if (locked) { toast(locked, 'error'); return refuse(req, locked, undefined, true); }
  if ((op.op === 'compound' || op.op === 'present' || op.op === 'travel') && op.silent) {
    // The system keeps its own parts in step without an undo step (the same graph rules held above).
    useStore.setState((s0) => s0.sessions[req.session] ? { sessions: { ...s0.sessions, [req.session]: { ...s0.sessions[req.session], graph: next } } } : s0);
  } else setGraph(req.session, () => next);
  const gone = graph.nodes.filter((n) => !next.nodes.some((m) => m.id === n.id));
  if (gone.length) removalHooks.forEach((hook) => hook(req.session, gone));
  // The kind is the one the edge really got (a dragged Model→Agent cable is inferred as control, like the command).
  const made = edgeId ? next.edges.find((e) => e.id === edgeId) : undefined;
  if (made && (made.kind ?? 'data') === 'control') applyModelLinkToAgent(req.session, made.source, made.target);
  recordJourneyEvent({ journeyId: req.session, journey: 'node-core', event: `edit.${op.op}`, reason: 'edit through the single editing layer', sessionId: req.session, after: { op, edgeId } });
  return { ok: true, ...(edgeId ? { edgeId } : {}), rev: revisionsOf(next, touched(op)) };
}

/** A composed change through the layer (see the `compound` operation). Returns the reason it was refused, or null. */
export function editCompound(session: string, label: string, change: (g: Graph) => Graph | { graph: Graph; dropped: string[] }, opts: { silent?: true } = {}): string | null {
  const done = applyEdit({ session, op: { op: 'compound', label, change, ...opts } });
  if (!done.ok) toast(done.error, 'error');
  return done.ok ? null : done.error;
}

/** A presentation change (positions, groups, view) through the layer. */
export function editPresentation(session: string, change: (g: Graph) => Graph, opts: { silent?: true } = {}): string | null {
  const done = applyEdit({ session, op: { op: 'present', change, ...opts } });
  return done.ok ? null : done.error;
}
