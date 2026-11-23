import { parseRef } from '../planRef';
import { mentionSubjects } from '../params';
import { derivedRefErrors } from '../schemaGuard';
import { ensureSchema, isConnected, PICKABLE_VIDEO_OPS, isVideoUpscaler, opModelFor } from '../catalog';
import { nodePreviewInputProblem, nodePreviewRefs } from '../planSteps/graph';
import { isStepKind } from '../planSteps/inspect';
import { nodeRequest, stable } from './freshness';
import { dynamicSendFingerprint, resolveSendPlan, sendFingerprint, stepSendSpec } from '../sendInputs';
import { rememberNodeRequest, requestContext } from './result';
import { lockedNodes, lockNodes, lockAssets, writingNodes } from './locks';
import { localTimeZone } from '../feedMeta';
import { placeFor } from '../place';
import { uid } from '../../lib/id';
import { cleanFileName } from '../../lib/media';
import { executeSteps, estimateSteps } from '../executor';
import { defaultOpParams, OPS } from '../ops';
import type { Estimate, GenNodeData, GraphNode, GraphNodeData, LinkKind, OpId, SystemNodeType } from '../types';
import { appendFeed, updateFeedItem, toast, useStore } from '../../store/store';
import { autoLayout, connectionError, graphToSteps, inferReplaces, inputPorts, NODE_WIDTH, runsGeneration, nodeOutputAsset } from './graph';
import { budgetProblemForSteps, consumeOnce, passActiveFor, type BudgetPass } from '../budget';
import { deleteAssets } from '../actions';
import { closeTicket, stepCapsFromMap, storeTickets, ticketPassFromEstimate } from '../money/storeBridge';
import { createTicket, isFreePrice, priceFromEstimate } from '../money/ticket';
import { findCycle } from '../nodecore/deps';
import { applyEdit, editCompound, editError, editPresentation } from '../nodecore/edit';
import { coreSignature, runProblems } from '../nodecore/guard';
import { ignoredRunCable, resolveInputs, storeEnv } from '../nodecore/resolver';
import { descriptorOf } from '../nodecore/registry';

const get = useStore.getState;

/**
 * An asset dropped on the canvas. A generated 3D model comes back as its 3D node (result, model and settings) with
 * the images it was made from connected; anything else is an Asset node.
 */
export function addAssetAsNode(sessionId: string, assetId: string, position: { x: number; y: number }): string {
  const st = get(), asset = st.assets[assetId];
  const g = asset?.generationId ? st.generations[asset.generationId] : undefined;
  if (asset?.kind !== 'model3d' || !g || g.status !== 'done' || g.kind !== 'model3d') return addNode(sessionId, { kind: 'asset', title: 'Asset', assetId }, position);
  const id = addNode(sessionId, { kind: 'model3d', title: '3D model', prompt: g.prompt, modelRef: g.modelRef, settings: structuredClone(g.settings), outputIndex: Math.max(0, g.assetIds.indexOf(assetId)), generationId: g.id }, position);
  g.inputs.refs.filter(r => st.assets[r]).forEach((r, i) => {
    const src = addNode(sessionId, { kind: 'asset', title: 'Asset', assetId: r }, { x: position.x - NODE_WIDTH - 100, y: position.y + i * 360 });
    tryConnect(sessionId, { source: src, target: id, targetHandle: 'ref' });
  });
  return id;
}

export function newNodeData(kind: GraphNodeData['kind'], opts: { op?: OpId; assetId?: string; type?: SystemNodeType; ref?: string } = {}): GraphNodeData {
  const defaults = descriptorOf(kind)?.defaults;
  if (!defaults) throw new Error(`Node type "${kind}" declares no defaults.`);
  return defaults(opts, get());
}

export function addNode(sessionId: string, data: GraphNodeData, position: { x: number; y: number }): string {
  const id = uid('nd');
  const done = applyEdit({ session: sessionId, op: { op: 'add', node: { id, position, data } } });
  // A refused add says why instead of leaving the user clicking an entry that does nothing; no node, no id.
  if (!done.ok) { if (!done.notified) toast(`Could not add the node: ${done.error}`, 'error'); return ''; }
  return id;
}

export function patchNodeData(sessionId: string, nodeId: string, patch: Partial<GraphNodeData>): string | null {
  return editError(applyEdit({ session: sessionId, op: { op: 'set', node: nodeId, patch } }));
}

export function deleteNodes(sessionId: string, ids: string[]): string | null {
  const graph = get().sessions[sessionId]?.graph;
  if (!graph) return 'No such session.';
  const missing = ids.find(id => !graph?.nodes.some(n => n.id === id));
  if (missing) return `No such node: ${missing}.`;
  const drop = new Set(ids);
  const deleted = { nodes: structuredClone(graph.nodes.filter(n => drop.has(n.id))), edges: structuredClone(graph.edges.filter(e => drop.has(e.source) || drop.has(e.target))) };
  const error = editError(applyEdit({ session: sessionId, op: { op: 'delete', nodes: ids } }));
  const restorable = deleted.nodes.filter(n => n.data.kind !== 'ref' || (n.data.type === 'prompt' && n.data.ref !== 'composer'));
  if (!error && restorable.length) {
    const ids = new Set(restorable.map(n => n.id));
    const undoNodes = { nodes: restorable, edges: deleted.edges.filter(e => ids.has(e.source) || ids.has(e.target)) };
    const results = restorable.some(n => n.data.kind !== 'ref') ? ' Results remain in the gallery.' : '';
    appendFeed(sessionId, { id: uid('fd'), createdAt: Date.now(), workspace: 'node', type: 'notice', level: 'info', text: `Deleted nodes: ${restorable.map(n => n.data.title).join(', ')}.${results}`, undoNodes, meta: { timeZone: localTimeZone(), space: placeFor(get().ui, 'node') } });
  }
  return error;
}

export { addConnected } from './addConnected';

/** Change the model and preserve its cables. */
export function setNodeModel(sessionId: string, nodeId: string, patch: Pick<GenNodeData, 'modelRef' | 'settings'>): string | null {
  const node = get().sessions[sessionId]?.graph.nodes.find(n => n.id === nodeId);
  if (!node || !('modelRef' in node.data)) return `No generation node: ${nodeId}.`;
  const model = get().catalog.models[patch.modelRef];
  if (!model && !patch.modelRef.startsWith('local::')) return `Unknown model: ${patch.modelRef}.`;
  if (model && model.kind !== node.data.kind) return `${model.name} produces ${model.kind}, not ${node.data.kind}.`;
  const textOutput = node.data.kind === 'audio' && model?.textOutput ? true : undefined;
  return editCompound(sessionId, 'set-model', g => ({
    ...g,
    nodes: g.nodes.map(n => n.id === nodeId ? { ...n, data: { ...n.data, ...patch, textOutput } as GraphNodeData } : n),
  }));
}

/** Set (or clear, with `undefined`) a node's painted-over copy. The copy it replaces is deleted. */
export function setSketch(sessionId: string, nodeId: string, assetId: string | undefined): void {
  const node = get().sessions[sessionId].graph.nodes.find((n) => n.id === nodeId);
  if (!node || node.data.kind === 'text' || node.data.kind === 'ref') return;
  const prev = node.data.sketchAssetId;
  if (patchNodeData(sessionId, nodeId, { sketchAssetId: assetId })) return;
  if (prev && prev !== assetId) deleteAssets([prev]);
}

/** A copy without a result of its own, with the same cables (every input; outputs only into multi-input ports). */
export function duplicateNode(sessionId: string, node: GraphNode): string {
  const data = structuredClone(node.data) as GraphNodeData;
  if (runsGeneration(data)) {
    delete (data as GenNodeData).generationId;
    delete (data as GenNodeData).sketchAssetId;
    (data as GenNodeData).outputIndex = 0;
  }
  const id = uid('nd');
  const st = get();
  const graph = st.sessions[sessionId]?.graph;
  if (!graph) return id;
  // "Image (copy 1)", "Image (copy 2)"…: the next free number for that name.
  const base = data.title.replace(/ \(copy(?: \d+)?\)$/, '');
  const taken = graph.nodes.map((n) => new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(copy(?: (\\d+))?\\)$`).exec(n.data.title)).filter(Boolean).map((m) => Number(m![1] ?? 1));
  data.title = `${base} (copy ${Math.max(0, ...taken) + 1})`;
  let next: import('../types').Graph = { ...graph, nodes: [...graph.nodes, { id, position: { x: node.position.x + 40, y: node.position.y + 60 }, data }] };
  for (const e of graph.edges.filter((x) => x.target === node.id)) {
    const c = { source: e.source, target: id, targetHandle: e.targetHandle, sourceHandle: e.sourceHandle, kind: e.kind, both: e.both };
    if (!connectionError(next, st.assets, c)) next = { ...next, edges: [...next.edges, { ...e, id: uid('edge'), target: id }] };
  }
  for (const e of graph.edges.filter((x) => x.source === node.id)) {
    const target = next.nodes.find((n) => n.id === e.target);
    const port = target ? inputPorts(target.data).find((p) => p.id === e.targetHandle) : undefined;
    const c = { source: id, target: e.target, targetHandle: e.targetHandle, kind: e.kind, both: e.both };
    if (port?.multi && (e.kind ?? 'data') === 'data' && !connectionError(next, st.assets, c)) next = { ...next, edges: [...next.edges, { ...e, id: uid('edge'), source: id }] };
  }
  editCompound(sessionId, 'duplicate', () => next);
  return id;
}

/** Rename a node; its result takes the same name (used for downloads). The extension never changes: it is the file's. */
export function renameNode(sessionId: string, nodeId: string, typed: string): void {
  const name = cleanFileName(typed);
  const st = get();
  const node = st.sessions[sessionId]?.graph.nodes.find((n) => n.id === nodeId);
  if (!node || !name) return;
  patchNodeData(sessionId, nodeId, { title: name });
  const asset = nodeOutputAsset(node, st.generations);
  if (asset && st.assets[asset]) useStore.setState((s0) => ({ assets: { ...s0.assets, [asset]: { ...s0.assets[asset], name } } }));
}

export function connectNodes(
  sessionId: string,
  c: { source: string; target: string; targetHandle: string | null; sourceHandle?: string | null; kind?: LinkKind; both?: boolean; replaces?: string | null },
): string | null {
  let replaces = c.replaces;
  if (replaces === undefined) {
    // Canvas gestures see the current input. Commands and agent tools pass null when they name no cable.
    const { sessions, assets } = get();
    replaces = inferReplaces(sessions[sessionId]?.graph, assets, c);
  }
  const done = applyEdit({ session: sessionId, op: { op: 'connect', ...c, replaces: replaces ?? null } });
  if (c.replaces === undefined && !done.ok && done.conflict) toast(done.error, 'error');
  return editError(done);
}
export function tryConnect(
  sessionId: string,
  c: { source: string; target: string; targetHandle: string | null; sourceHandle?: string | null; kind?: LinkKind; both?: boolean },
): boolean {
  return connectNodes(sessionId, c) === null;
}
export function disconnectEdges(sessionId: string, ids: string[]): string | null {
  const graph = get().sessions[sessionId]?.graph;
  if (!graph) return 'No such session.';
  return editError(applyEdit({ session: sessionId, op: { op: 'disconnect', edges: ids } }));
}

export function setNodeOp(sessionId: string, nodeId: string, op: OpId): string | null {
  const node = get().sessions[sessionId]?.graph.nodes.find(n => n.id === nodeId);
  if (node?.data.kind !== 'tool') return `No tool node: ${nodeId}.`;
  return editCompound(sessionId, 'set-op', g => ({
    ...g,
    nodes: g.nodes.map(n => n.id === nodeId ? { ...n, data: { ...n.data, op, params: defaultOpParams(OPS[op]), title: OPS[op].label, generationId: undefined } as GraphNodeData } : n),
  }));
}

export function layoutAll(sessionId: string): void {
  const graph = get().sessions[sessionId].graph;
  const pos = autoLayout(graph.nodes, graph.edges, { x: 0, y: 0 });
  editPresentation(sessionId, (g) => ({ ...g, nodes: g.nodes.map((n) => ({ ...n, position: pos.get(n.id) ?? n.position })) }));
}

export function runnableIds(nodes: GraphNode[]): string[] {
  return nodes.filter((n) => runsGeneration(n.data)).map((n) => n.id);
}

/** The model and settings each tool node runs with: what the confirmation prices and what the send uses. */
function nodeOperationsOf(context: ReturnType<typeof requestContext>, graph: import('../types').Graph, ids: string[]) {
  return Object.fromEntries(ids.map(id => [id, context.operation(graph.nodes.find(n => n.id === id)!)]));
}

export interface NodeRunPreview {
  estimate: Estimate;
  perStep?: Record<string, Estimate>;
  count: number;
  errors: string[];
  runIds: string[];
  steps: import('../types').PlanStep[];
  signature: string;
  inputIds: string[];
  sendAssets?: string[];
  stepFingerprints?: Record<string, string>;
}

export function previewRun(sessionId: string, targets: string[], force = true, frozenRunIds?: readonly string[]): NodeRunPreview {
  const st = get();
  const graph = st.sessions[sessionId].graph;
  const context = requestContext(sessionId);
  const run = graphToSteps(graph, targets, st.generations, { force, library: st.library, ...context, ...(frozenRunIds ? { frozenRunIds } : {}) });
  const env = storeEnv();
  const inputs = new Set(run.runIds);
  const visit = (id: string) => {
    const n = graph.nodes.find(n => n.id === id);
    const subjects = n && 'subjects' in n.data ? (n.data.subjects ?? []).filter(s => !s.from.startsWith('asset:')).map(s => s.from.split('#')[0]) : [];
    const linked = n ? resolveInputs(graph, n, env).flatMap(i => (!i.from || i.broken || ignoredRunCable(i) ? [] : [i.from])) : [];
    for (const source of [...linked, ...subjects]) if (!inputs.has(source)) { inputs.add(source); visit(source); }
  };
  run.runIds.forEach(visit);
  const errors = [...run.errors, ...runProblems(graph, run.runIds, env)];
  for (const id of inputs) {
    const n = graph.nodes.find(n => n.id === id);
    if (!n) { errors.push(`Missing input node: ${id}.`); continue; }
    // The plan checks persisted attempts for writes. In-memory write locks also protect live inputs.
    const busy = `“${n.data.title}” is already running.`;
    if ((run.runIds.includes(id) ? lockedNodes(sessionId) : writingNodes(sessionId)).has(id) && !errors.includes(busy)) errors.push(busy);
    // A required field left empty stops the run before any provider is called (every operation, from its field list).
    if (n.data.kind === 'tool' && run.runIds.includes(id)) for (const f of OPS[n.data.op].fields ?? []) {
      const v = n.data.params[f.key];
      if (f.required && (v == null || (typeof v === 'string' && !v.trim()))) errors.push(`“${n.data.title}”: “${f.label}” is required.`);
    }
    if (n.data.kind === 'tool' && n.data.op === 'video_upscale') {
      const ref = typeof n.data.params._modelRef === 'string' ? n.data.params._modelRef : opModelFor('video_upscale').ref;
      if (!st.catalog.models[ref] || !isVideoUpscaler(st.catalog.models[ref]) || !isConnected(st.catalog.models[ref].provider)) errors.push(`“${n.data.title}”: choose an available dedicated video upscaler.`);
      errors.push(...derivedRefErrors([ref]));
    }
    if (n.data.kind === 'asset' && (!n.data.assetId || !st.assets[n.data.sketchAssetId ?? n.data.assetId])) errors.push(`“${n.data.title}” needs an available asset.`);
    if ('sketchAssetId' in n.data && n.data.sketchAssetId && !st.assets[n.data.sketchAssetId]) errors.push(`“${n.data.title}”: the Sketch asset is missing.`);
  }
  for (const step of run.steps) {
    for (const ref of nodePreviewRefs(step)) {
      if (ref.startsWith('asset:') && !st.assets[ref.slice(6)]) errors.push(`${step.title}: an input asset was deleted.`);
    }
    if (!('modelRef' in step)) continue;
    const schema = st.catalog.schemas[step.modelRef];
    if (!schema) continue;
    const node = graph.nodes.find(n => n.id === step.id)!;
    const request = nodeRequest(graph, node, st.generations, st.library, context);
    const subjects = 'subjects' in request ? request.subjects ?? [] : [];
    if (subjects.some(s => !step.nodeSubjects?.some(b => b.name === s.name && !b.from.startsWith('asset:')) && (!s.frontal || !st.assets[s.frontal]))) errors.push(`${step.title}: a mentioned subject needs an available image.`);
    const problem = nodePreviewInputProblem(step, schema, subjects.length, (ref) =>
      ref.startsWith('asset:') ? st.assets[ref.slice(6)]?.kind : graph.nodes.find(n => n.id === ref.split('#')[0])?.data.kind);
    if (problem) errors.push(`${step.title}: ${problem}`);
  }
  errors.push(...derivedRefErrors(run.steps.flatMap(s => 'modelRef' in s ? [s.modelRef] : isStepKind(s, 'op') && typeof s.params._modelRef === 'string' ? [s.params._modelRef] : [])));
  const nodeOperations = nodeOperationsOf(context, graph, run.runIds);
  const { total, perStep } = estimateSteps(run.steps, nodeOperations);
  const sendFingerprints: Record<string, string> = {}, stepFingerprints: Record<string, string> = {}, sendAssets = new Set<string>();
  for (const step of run.steps) {
    const { spec, dynamic } = stepSendSpec(step, run.steps, nodeOperations, st);
    if (!spec) { sendFingerprints[step.id] = stable(step.kind === 'text' ? { kind: 'text', text: step.text } : step); continue; }
    const plan = resolveSendPlan(spec, st);
    sendFingerprints[step.id] = sendFingerprint(plan, st);
    stepFingerprints[step.id] = dynamic ? dynamicSendFingerprint(plan, st) : sendFingerprint(plan, st, { ignoreSeed: true });
    plan.assetIds.forEach((id) => sendAssets.add(id));
  }
  const requests = [...inputs].map(id => {
    const n = graph.nodes.find(n => n.id === id);
    if (!n) return [id, 'missing']; // already reported as an error above
    return [id, 'outputIndex' in n.data ? n.data.outputIndex : undefined, n.data.kind === 'text' ? n.data.text : n.data.kind === 'asset' ? n.data.sketchAssetId ?? n.data.assetId : nodeRequest(graph, n, st.generations, st.library, context)];
  });
  return { estimate: total, perStep, count: run.runIds.length, errors, runIds: run.runIds, steps: run.steps, inputIds: [...inputs], sendAssets: [...sendAssets].sort(), stepFingerprints, signature: stable({ requests, send: sendFingerprints, steps: run.steps.map(({ title: _title, ...s }) => s), total, core: coreSignature(graph, [...inputs]) }) };
}

export async function prepareNodeRun(sessionId: string, targets: string[], force = true, frozenRunIds?: readonly string[]): Promise<NodeRunPreview> {
  // Older materialized plans kept their identity sources only on the plan card.
  const session = get().sessions[sessionId];
  for (const n of session.graph.nodes) {
    if (!('prompt' in n.data) || n.data.subjects !== undefined || !n.planId) continue;
    const item = session.feed.find(f => f.type === 'plan' && f.plan.id === n.planId);
    if (item?.type !== 'plan') continue;
    const prompt = n.data.prompt;
    const subjects = (item.plan.subjects ?? []).filter(s => mentionSubjects(prompt, [{ id: s.name, name: s.name }]).ids.length).map(s => {
      const p = parseRef(s.from);
      return { ...s, from: p?.type === 'step' ? `${n.planId}_${p.id}${p.index ? `#${p.index + 1}` : ''}` : s.from };
    });
    if (subjects.length) patchNodeData(sessionId, n.id, { subjects });
  }
  const preview = previewRun(sessionId, targets, force, frozenRunIds);
  if (preview.errors.length) return preview;
  const refs = preview.steps.flatMap(s => 'modelRef' in s ? [s.modelRef] : isStepKind(s, 'op') ? [PICKABLE_VIDEO_OPS.includes(OPS[s.op].engine) && typeof s.params._modelRef === 'string' ? s.params._modelRef : opModelFor(OPS[s.op].engine).ref] : []);
  await Promise.all([...new Set(refs)].filter(Boolean).map(ref => ensureSchema(ref)));
  // Freeze the resolved runIds from the reviewed preview so loading schemas never expands hidden ancestors.
  return previewRun(sessionId, targets, force, frozenRunIds ?? preview.runIds);
}

/** Revalidate the reviewed version before taking the lock or spending. */
export async function runNodes(sessionId: string, targets: string[], approved?: NodeRunPreview, force = true,
  onState?: import('../executor').ExecContext['onState'], budgetPass?: BudgetPass, commandTicketId?: string): Promise<import('../executor').ExecResult | null> {
  const preview = await prepareNodeRun(sessionId, targets, force, approved?.runIds.length ? approved.runIds : undefined);
  if (approved && preview.signature !== approved.signature) return null;
  if (preview.errors.length) { toast(preview.errors[0], 'error'); return null; }
  const passPrefix = budgetPass?.kind === 'ticket' && budgetPass.stepKey ? `${budgetPass.stepKey}:` : '';
  const problem = budgetProblemForSteps(preview.estimate, preview.perStep, sessionId, budgetPass, passPrefix);
  if (problem) { toast(problem, 'error'); return null; }
  if (!preview.count) return { outputs: new Map(), failed: [], skipped: [], waiting: [] };
  const hadPass = passActiveFor(budgetPass, sessionId, preview.estimate);
  consumeOnce(budgetPass, preview.estimate);
  const price = priceFromEstimate(preview.estimate);
  const commandTicket = commandTicketId ? storeTickets.get(commandTicketId) : undefined;
  const approvalTicketId = isFreePrice(price) ? undefined : commandTicket?.id ?? `nr:${uid('run')}`;
  if (approvalTicketId) {
    storeTickets.put(commandTicket ? {
      ...commandTicket,
      scope: { ...commandTicket.scope, nodeIds: [...new Set([...commandTicket.scope.nodeIds ?? [], ...preview.runIds])] },
    } : createTicket({
      id: approvalTicketId, sessionId, kind: 'node_run',
      scope: { nodeIds: preview.runIds, steps: preview.steps, signature: preview.signature },
      price, pass: hadPass ? ticketPassFromEstimate(preview.estimate, stepCapsFromMap(preview.perStep, 'node:')) : undefined,
    }));
  }
  const release = lockNodes(sessionId, preview.runIds, preview.inputIds);
  // The run works on the graph as it was when it started: edits made meanwhile apply to the next run.
  const startGraph = get().sessions[sessionId].graph;
  const library = structuredClone(get().library);
  const context = requestContext(sessionId);
  const nodeOperations = nodeOperationsOf(context, startGraph, preview.runIds);
  const releaseAssets = lockAssets(preview.sendAssets ?? []);
  try {
    const result = await executeSteps(preview.steps, {
      sessionId, workspace: 'node', origin: 'node', approvalTicketId, nodeLock: release, nodeLibrary: library, nodeOperations,
      stepFingerprints: preview.stepFingerprints,
      ...(passPrefix ? { passStepPrefix: passPrefix } : {}),
      onState: (stepId, state, info) => {
        if (info?.generationId) rememberNodeRequest(info.generationId, startGraph, library, context);
        onState?.(stepId, state, info);
      },
    });
    if (result.failed.length) toast(`${result.failed.length} node(s) failed: ${result.failed[0].error}`, 'error');
    return result;
  } finally {
    if (approvalTicketId && !commandTicket) closeTicket(approvalTicketId);
    releaseAssets();
    release();
  }
}

export interface DeletedNodes { nodes: GraphNode[]; edges: import('../types').GraphEdge[] }
export function deleteNodesWithUndo(sessionId: string, ids: string[]): { error: string | null; deleted?: DeletedNodes } {
  const graph = get().sessions[sessionId]?.graph;
  if (!graph) return { error: 'No such session.' };
  const deleted = { nodes: structuredClone(graph.nodes.filter(n => ids.includes(n.id))), edges: structuredClone(graph.edges.filter(e => ids.includes(e.source) || ids.includes(e.target))) };
  const error = deleteNodes(sessionId, ids);
  return error ? { error } : { error: null, deleted };
}

/** Restore only the deletion, leaving later nodes, edits and occupied ports intact. */
export function restoreNodes(sessionId: string, deleted: DeletedNodes): { error: string | null; skipped: string[] } {
  const graph = get().sessions[sessionId]?.graph;
  if (!graph) return { error: 'No such session.', skipped: [] };
  if (deleted.nodes.some(n => graph.nodes.some(live => live.id === n.id))) return { error: 'A deleted node ID is already in use.', skipped: [] };
  let next = { ...graph, nodes: [...graph.nodes, ...structuredClone(deleted.nodes)] };
  const skipped: string[] = [];
  for (const edge of deleted.edges) {
    if (next.edges.some(e => e.id === edge.id)) continue;
    const target = next.nodes.find(n => n.id === edge.target);
    const port = target && inputPorts(target.data).find(p => p.id === edge.targetHandle);
    const occupied = port && !port.multi && next.edges.some(e => e.target === edge.target && e.targetHandle === edge.targetHandle);
    const problem = connectionError(next, get().assets, edge);
    if (occupied || problem) { skipped.push(`${edge.id}: ${occupied ? 'port changed since deletion' : problem}`); continue; }
    const candidate = { ...next, edges: [...next.edges, { ...edge }] };
    // Subjects can close a loop the cable-to-cable check does not see.
    if (findCycle(candidate, get().assets)) { skipped.push(`${edge.id}: would create a loop`); continue; }
    next = candidate;
  }
  return { error: editCompound(sessionId, 'restore', () => next), skipped };
}

/** Both chat Undo and requested agent recovery restore the same deletion snapshot. */
export function restoreNodeDeletion(sessionId: string, itemId: string, nodeIds?: string[]): string | null {
  const item = get().sessions[sessionId]?.feed.find(f => f.id === itemId);
  if (item?.type !== 'notice' || !item.undoNodes || item.undone) return 'This deletion is no longer available to undo.';
  const snapshot = item.undoNodes;
  if (nodeIds?.some(id => !snapshot.nodes.some(n => n.id === id))) return 'A requested node is not part of this deletion.';
  const nodes = nodeIds ? snapshot.nodes.filter(n => nodeIds.includes(n.id)) : snapshot.nodes;
  if (!nodes.length) return 'No deleted nodes selected.';
  const ids = new Set(nodes.map(n => n.id));
  const restored = restoreNodes(sessionId, { nodes, edges: snapshot.edges.filter(e => ids.has(e.source) || ids.has(e.target)) });
  if (restored.error) return restored.error;
  const remaining = snapshot.nodes.filter(n => !ids.has(n.id));
  updateFeedItem(sessionId, itemId, { undone: !remaining.length, undoNodes: { nodes: remaining, edges: snapshot.edges.filter(e => remaining.some(n => n.id === e.source || n.id === e.target)) }, text: `Restored: ${nodes.map(n => n.data.title).join(', ')}.${restored.skipped.length ? ` Connections not restored: ${restored.skipped.join('; ')}` : ''}${remaining.length ? ' Undo is available for the remaining deleted nodes.' : ''}` });
  return null;
}

/** Reuse a saved attempt's controls without executing or selecting its output. */
export function restoreNodeGeneration(sessionId: string, nodeId: string, generationId: string): string | null {
  const st = get(), node = st.sessions[sessionId]?.graph.nodes.find(n => n.id === nodeId), g = st.generations[generationId];
  if (!node || !g || g.sessionId !== sessionId || (g.stepId !== nodeId && (!('generationId' in node.data) || node.data.generationId !== g.id))) return 'This generation does not belong to this node.';
  if (node.data.kind === 'tool') {
    if (!g.op) return 'This generation has no operation parameters.';
    if (node.data.op !== g.op.id) {
      const error = setNodeOp(sessionId, nodeId, g.op.id);
      if (error) return error;
    }
    return patchNodeData(sessionId, nodeId, { params: structuredClone(g.op.params), generationId: node.data.generationId });
  }
  if (!('modelRef' in node.data)) return 'This node has no generation controls.';
  let prompt = g.prompt;
  if (g.nodeRequest) {
    const request = JSON.parse(g.nodeRequest) as { prompt?: string; incoming?: { port: string; value: unknown }[] };
    if (typeof request.prompt === 'string') {
      prompt = request.prompt;
      const input = request.incoming?.find(e => e.port === 'prompt')?.value;
      if (typeof input === 'string' && input.trim()) {
        const prefix = input.trim();
        prompt = prompt === prefix ? '' : prompt.startsWith(`${prefix}\n`) ? prompt.slice(prefix.length + 1) : prompt;
      }
    }
  }
  const error = setNodeModel(sessionId, nodeId, { modelRef: g.modelRef, settings: structuredClone(g.settings) });
  return error ?? patchNodeData(sessionId, nodeId, { prompt });
}
