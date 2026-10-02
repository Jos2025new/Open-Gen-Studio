import { videoOpSettings } from '../jobs';
import { parseRef } from '../plan';
import { mentionSubjects } from '../params';
import { ensureSchema, isConnected, PICKABLE_VIDEO_OPS, isVideoUpscaler, opModelFor, opModelForAsset, opFollowsSource, opModelFromRef } from '../catalog';
import { isAutoOption, matchInputOption, nearestAspect, paramByRole, routeVideoInputs, videoInputProblem } from '../params';
import { nodeRequest, stable } from './freshness';
import { graphEditProblem, lockedNodes, lockNodes, lockAssets, writingNodes } from './locks';
import { uid } from '../../lib/id';
import { executeSteps, estimateSteps } from '../executor';
import { defaultOpParams, OPS } from '../ops';
import type { Estimate, GenNodeData, GraphNode, GraphNodeData, MediaKind, OpId } from '../types';
import { appendFeed, updateFeedItem, patchGeneration, setGraph, toast, useStore } from '../../store/store';
import { autoLayout, connect, connectionError, estimatedHeight, graphToSteps, inputPorts, NODE_WIDTH, outputPort, portFits, runsGeneration, nodeOutputAsset } from './graph';
import { budgetProblem, deleteAssets } from '../actions';

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

export function newNodeData(kind: GraphNodeData['kind'], opts: { op?: OpId; assetId?: string } = {}): GraphNodeData {
  const st = get();
  switch (kind) {
    case 'text':
      return { kind: 'text', title: 'Prompt', text: '' };
    case 'image':
    case 'video':
    case 'audio':
    case 'model3d': {
      const c = st.composer[kind as MediaKind];
      const title = kind === 'image' ? 'Image' : kind === 'video' ? 'Video' : kind === 'audio' ? 'Audio' : '3D model';
      const textOutput = kind === 'audio' && st.catalog.models[c.modelRef]?.textOutput;
      return { kind, title, prompt: '', modelRef: c.modelRef, settings: { ...c.settings, seed: undefined }, outputIndex: 0, ...(textOutput ? { textOutput: true } : {}) };
    }
    case 'tool': {
      const op = opts.op ?? 'relight';
      return { kind: 'tool', title: OPS[op].label, op, params: defaultOpParams(OPS[op]), outputIndex: 0 };
    }
    case 'asset':
      return { kind: 'asset', title: 'Asset', assetId: opts.assetId ?? null };
  }
}

export function addNode(sessionId: string, data: GraphNodeData, position: { x: number; y: number }): string {
  const id = uid('nd');
  setGraph(sessionId, (g) => ({ ...g, nodes: [...g.nodes, { id, position, data }] }));
  return id;
}

function editGraph(sessionId: string, change: (g: import('../types').Graph) => import('../types').Graph): string | null {
  const graph = get().sessions[sessionId]?.graph;
  if (!graph) return 'No such session.';
  const next = change(graph);
  const error = graphEditProblem(sessionId, graph, next);
  if (error) { toast(error, 'error'); return error; }
  setGraph(sessionId, () => next);
  return null;
}

export function patchNodeData(sessionId: string, nodeId: string, patch: Partial<GraphNodeData>): string | null {
  if (!get().sessions[sessionId]?.graph.nodes.some(n => n.id === nodeId)) return `No such node: ${nodeId}.`;
  return editGraph(sessionId, g => ({ ...g, nodes: g.nodes.map(n => n.id === nodeId ? { ...n, data: { ...n.data, ...patch } as GraphNodeData } : n) }));
}

export function deleteNodes(sessionId: string, ids: string[]): string | null {
  const graph = get().sessions[sessionId]?.graph;
  if (!graph) return 'No such session.';
  const missing = ids.find(id => !graph?.nodes.some(n => n.id === id));
  if (missing) return `No such node: ${missing}.`;
  const drop = new Set(ids);
  const deleted = { nodes: structuredClone(graph.nodes.filter(n => drop.has(n.id))), edges: structuredClone(graph.edges.filter(e => drop.has(e.source) || drop.has(e.target))) };
  const error = editGraph(sessionId, g => ({ ...g, nodes: g.nodes.filter(n => !drop.has(n.id)), edges: g.edges.filter(e => !drop.has(e.source) && !drop.has(e.target)) }));
  if (!error && deleted.nodes.length) appendFeed(sessionId, { id: uid('fd'), createdAt: Date.now(), workspace: 'node', type: 'notice', level: 'info', text: `Deleted nodes: ${deleted.nodes.map(n => n.data.title).join(', ')}. Results remain in the gallery.`, undoNodes: deleted });
  return error;
}

/** Add a node to the right of `fromId`, wired to its first input that accepts the source's output. */
export function addConnected(sessionId: string, fromId: string, data: GraphNodeData): string | null {
  const st = get();
  const graph = st.sessions[sessionId].graph;
  const from = graph.nodes.find((n) => n.id === fromId);
  if (!from) return null;
  const type = outputPort(from.data, st.assets);
  const port = inputPorts(data).find((p) => p.type === type) ?? inputPorts(data).find((p) => portFits(type, p.type));
  // A node made from an image keeps that image's shape, not the composer's format.
  const src = st.assets[nodeOutputAsset(from, st.generations) ?? ''];
  const view = src?.kind === 'model3d' ? st.assets[src.viewImageId ?? ''] : src;
  if ((data.kind === 'image' || data.kind === 'video') && view?.kind === 'image' && view.width && view.height) {
    const options = paramByRole(st.catalog.schemas[data.modelRef], 'aspect')?.options ?? [];
    const aspect = matchInputOption(options) ?? nearestAspect(options.filter((o) => !isAutoOption(o)), `${view.width}:${view.height}`);
    if (aspect) data = { ...data, settings: { ...data.settings, aspect } };
  }
  // Stack below the nodes this one already feeds, so new cards never land on top of them.
  const children = graph.edges.filter((e) => e.source === fromId).map((e) => graph.nodes.find((n) => n.id === e.target)).filter((n): n is GraphNode => Boolean(n));
  const y = children.length ? Math.max(...children.map((n) => n.position.y + estimatedHeight(n.data))) + 60 : from.position.y;
  const id = addNode(sessionId, data, { x: from.position.x + NODE_WIDTH + 100, y });
  if (port) tryConnect(sessionId, { source: fromId, target: id, targetHandle: port.id });
  return id;
}

/**
 * Change a generation node's model. Audio nodes follow the model's output (lyrics models answer with text), and
 * connections the new output or inputs no longer fit are dropped.
 */
export function setNodeModel(sessionId: string, nodeId: string, patch: Pick<GenNodeData, 'modelRef' | 'settings'>): string | null {
  const node = get().sessions[sessionId]?.graph.nodes.find(n => n.id === nodeId);
  if (!node || !('modelRef' in node.data)) return `No generation node: ${nodeId}.`;
  const model = get().catalog.models[patch.modelRef];
  if (!model && !patch.modelRef.startsWith('local::')) return `Unknown model: ${patch.modelRef}.`;
  if (model && model.kind !== node.data.kind) return `${model.name} produces ${model.kind}, not ${node.data.kind}.`;
  const textOutput = node.data.kind === 'audio' && model?.textOutput ? true : undefined;
  return editGraph(sessionId, g => {
    const nodes = g.nodes.map(n => n.id === nodeId ? { ...n, data: { ...n.data, ...patch, textOutput } as GraphNodeData } : n);
    const out = outputPort(nodes.find(n => n.id === nodeId)!.data, get().assets);
    const edges = g.edges.filter(e => {
      if (e.source !== nodeId) return true;
      const tgt = nodes.find(n => n.id === e.target);
      return tgt && portFits(out, inputPorts(tgt.data).find(p => p.id === e.targetHandle)?.type);
    });
    return { ...g, nodes, edges };
  });
}

/** Set (or clear, with `undefined`) a node's painted-over copy. The copy it replaces is deleted. */
export function setSketch(sessionId: string, nodeId: string, assetId: string | undefined): void {
  const node = get().sessions[sessionId].graph.nodes.find((n) => n.id === nodeId);
  if (!node || node.data.kind === 'text') return;
  const prev = node.data.sketchAssetId;
  if (patchNodeData(sessionId, nodeId, { sketchAssetId: assetId })) return;
  if (prev && prev !== assetId) deleteAssets([prev]);
}

/** Copy a node (without its results) slightly offset. */
/**
 * A copy of the node: its parameters and prompt, marked "(copy)", with no result of its own (the original's
 * generation, running or finished, stays with the original) and the same connections: every input, and every
 * output whose target port takes several inputs (a single-input port keeps its original source).
 */
export function duplicateNode(sessionId: string, node: GraphNode): string {
  const data = structuredClone(node.data) as GraphNodeData;
  if (runsGeneration(data)) {
    delete (data as GenNodeData).generationId;
    delete (data as GenNodeData).sketchAssetId;
    (data as GenNodeData).outputIndex = 0;
  }
  data.title = / \(copy\)$/.test(data.title) ? data.title : `${data.title} (copy)`;
  const id = uid('nd');
  const st = get();
  const graph = st.sessions[sessionId]?.graph;
  if (!graph) return id;
  let next: import('../types').Graph = { ...graph, nodes: [...graph.nodes, { id, position: { x: node.position.x + 40, y: node.position.y + 60 }, data }] };
  for (const e of graph.edges.filter((x) => x.target === node.id)) {
    const c = { source: e.source, target: id, targetHandle: e.targetHandle };
    if (!connectionError(next, st.assets, c)) next = connect(next, c);
  }
  for (const e of graph.edges.filter((x) => x.source === node.id)) {
    const target = next.nodes.find((n) => n.id === e.target);
    const port = target ? inputPorts(target.data).find((p) => p.id === e.targetHandle) : undefined;
    const c = { source: id, target: e.target, targetHandle: e.targetHandle };
    if (port?.multi && !connectionError(next, st.assets, c)) next = connect(next, c);
  }
  setGraph(sessionId, () => next);
  return id;
}

export function connectNodes(sessionId: string, c: { source: string; target: string; targetHandle: string | null }): string | null {
  const st = get();
  const graph = st.sessions[sessionId]?.graph;
  if (!graph) return 'No such session.';
  const err = connectionError(graph, st.assets, c);
  if (err) { toast(err, 'error'); return err; }
  return editGraph(sessionId, g => connect(g, { ...c, targetHandle: c.targetHandle! }));
}
export function tryConnect(sessionId: string, c: { source: string; target: string; targetHandle: string | null }): boolean {
  return connectNodes(sessionId, c) === null;
}
export function disconnectEdges(sessionId: string, ids: string[]): string | null {
  const graph = get().sessions[sessionId]?.graph;
  const missing = ids.find(id => !graph?.edges.some(e => e.id === id));
  if (missing) return `No such connection: ${missing}.`;
  return editGraph(sessionId, g => ({ ...g, edges: g.edges.filter(e => !ids.includes(e.id)) }));
}

export function setNodeOp(sessionId: string, nodeId: string, op: OpId): string | null {
  const node = get().sessions[sessionId]?.graph.nodes.find(n => n.id === nodeId);
  if (node?.data.kind !== 'tool') return `No tool node: ${nodeId}.`;
  return editGraph(sessionId, g => {
    const nodes = g.nodes.map(n => n.id === nodeId ? { ...n, data: { ...n.data, op, params: defaultOpParams(OPS[op]), title: OPS[op].label, generationId: undefined } as GraphNodeData } : n);
    const edges = g.edges.filter(e => {
      if (e.source !== nodeId && e.target !== nodeId) return true;
      const src = nodes.find(n => n.id === e.source), tgt = nodes.find(n => n.id === e.target);
      return src && tgt && portFits(outputPort(src.data, get().assets), inputPorts(tgt.data).find(p => p.id === e.targetHandle)?.type);
    });
    return { ...g, nodes, edges };
  });
}

export function layoutAll(sessionId: string): void {
  const graph = get().sessions[sessionId].graph;
  const pos = autoLayout(graph.nodes, graph.edges, { x: 0, y: 0 });
  setGraph(sessionId, (g) => ({ ...g, nodes: g.nodes.map((n) => ({ ...n, position: pos.get(n.id) ?? n.position })) }));
}

export function runnableIds(nodes: GraphNode[]): string[] {
  return nodes.filter((n) => runsGeneration(n.data)).map((n) => n.id);
}

function requestContext(sessionId: string) {
  const st = get(), graph = st.sessions[sessionId].graph;
  return { schemas: st.catalog.schemas, operation: (n: GraphNode) => {
    if (n.data.kind !== 'tool') return undefined;
    const engine = OPS[n.data.op].engine;
    if (['local', 'voice'].includes(engine)) return undefined;
    const sourceNode = graph.nodes.find(src => src.id === graph.edges.find(e => e.target === n.id && e.targetHandle === 'input')?.source);
    const source = sourceNode ? nodeOutputAsset(sourceNode, st.generations) : null;
    const sourceRef = sourceNode && 'modelRef' in sourceNode.data ? sourceNode.data.modelRef : undefined;
    const fromModel = opFollowsSource(engine) ? opModelFromRef(sourceRef, engine === 'edit' ? 'image' : 'video') : null;
    const chosen = PICKABLE_VIDEO_OPS.includes(engine) && typeof n.data.params._modelRef === 'string' ? n.data.params._modelRef : undefined;
    const choice = chosen ? { ref: chosen, viaEdit: false } : source && st.assets[source] ? opModelForAsset(engine, source) : fromModel ? { ref: fromModel, viaEdit: false } : opModelFor(engine);
    return { ...choice, ...(engine === 'video' ? { settings: st.composer.video.settings } : ['video_edit', 'video_upscale', 'video_extend'].includes(engine) ? { settings: videoOpSettings(engine as 'video_edit' | 'video_upscale' | 'video_extend', st.catalog.schemas[choice.ref], n.data.params) } : {}) };
  } };
}

export interface NodeRunPreview {
  estimate: Estimate;
  count: number;
  errors: string[];
  runIds: string[];
  steps: import('../types').PlanStep[];
  signature: string;
  inputIds: string[];
}

export function previewRun(sessionId: string, targets: string[], force = true): NodeRunPreview {
  const st = get();
  const graph = st.sessions[sessionId].graph;
  const context = requestContext(sessionId);
  const run = graphToSteps(graph, targets, st.generations, { force, library: st.library, assets: st.assets, ...context });
  const inputs = new Set(run.runIds);
  const visit = (id: string) => {
    const n = graph.nodes.find(n => n.id === id);
    const subjects = n && 'subjects' in n.data ? (n.data.subjects ?? []).filter(s => !s.from.startsWith('asset:')).map(s => s.from.split('#')[0]) : [];
    for (const source of [...graph.edges.filter(e => e.target === id).map(e => e.source), ...subjects]) if (!inputs.has(source)) { inputs.add(source); visit(source); }
  };
  run.runIds.forEach(visit);
  const errors = [...run.errors];
  for (const id of inputs) {
    const n = graph.nodes.find(n => n.id === id);
    if (!n) { errors.push(`Missing input node: ${id}.`); continue; }
    // A node this run writes must be free; an input only needs not to be generating (other runs may read it too).
    const busyGen = runsGeneration(n.data) && n.data.generationId && ['queued', 'running'].includes(st.generations[n.data.generationId]?.status);
    if ((run.runIds.includes(id) ? lockedNodes(sessionId) : writingNodes(sessionId)).has(id) || busyGen) errors.push(`“${n.data.title}” is already running.`);
    if (n.data.kind === 'tool' && n.data.op === 'video_upscale') {
      const ref = typeof n.data.params._modelRef === 'string' ? n.data.params._modelRef : opModelFor('video_upscale').ref;
      if (!st.catalog.models[ref] || !isVideoUpscaler(st.catalog.models[ref]) || !isConnected(st.catalog.models[ref].provider)) errors.push(`“${n.data.title}”: choose an available dedicated video upscaler.`);
      if (st.catalog.schemas[ref]?.source === 'derived') errors.push(`“${n.data.title}”: the provider parameter schema is unavailable.`);
    }
    if (n.data.kind === 'asset' && (!n.data.assetId || !st.assets[n.data.sketchAssetId ?? n.data.assetId])) errors.push(`“${n.data.title}” needs an available asset.`);
    if (n.data.kind !== 'text' && n.data.sketchAssetId && !st.assets[n.data.sketchAssetId]) errors.push(`“${n.data.title}”: the Sketch asset is missing.`);
  }
  for (const step of run.steps) {
    for (const ref of step.kind === 'op' ? [step.input, ...Object.values(step.params).filter((v): v is string => typeof v === 'string' && v.startsWith('asset:'))] : step.kind === 'video' ? [step.firstFrame, step.lastFrame, ...(step.refs ?? [])].filter((r): r is string => Boolean(r)) : 'refs' in step ? step.refs ?? [] : []) {
      if (ref.startsWith('asset:') && !st.assets[ref.slice(6)]) errors.push(`${step.title}: an input asset was deleted.`);
    }
    if (!('modelRef' in step)) continue;
    const schema = st.catalog.schemas[step.modelRef];
    if (!schema) continue;
    const node = graph.nodes.find(n => n.id === step.id)!;
    const request = nodeRequest(graph, node, st.generations, st.library, context);
    const subjects = 'subjects' in request ? request.subjects ?? [] : [];
    if (subjects.some(s => !step.nodeSubjects?.some(b => b.name === s.name && !b.from.startsWith('asset:')) && (!s.frontal || !st.assets[s.frontal]))) errors.push(`${step.title}: a mentioned subject needs an available image.`);
    if (step.kind === 'image' && step.refs.length + subjects.length < (schema.slots.images?.min ?? 0) + (schema.slots.source ? 1 : 0)) errors.push(`${step.title}: the model needs an input image.`);
    if (step.kind === 'video') {
      const refs = step.refs ?? [];
      const kind = (ref: string) => ref.startsWith('asset:') ? st.assets[ref.slice(6)]?.kind : graph.nodes.find(n => n.id === ref.split('#')[0])?.data.kind;
      const images = refs.filter(r => kind(r) === 'image');
      const videos = refs.filter(r => kind(r) === 'video');
      const audios = refs.filter(r => kind(r) === 'audio');
      const routed = routeVideoInputs(schema.slots, images, videos, step.firstFrame);
      const problem = videoInputProblem(schema.slots, { firstFrame: Boolean(routed.firstFrame), images: routed.images.length + subjects.length, videos: routed.videos.length, audios: audios.length });
      if (problem) errors.push(`${step.title}: ${problem}`);
    }
    if (step.kind === 'audio' && step.lyricsFrom && !schema.params.some(p => /lyrics/i.test(p.key))) errors.push(`${step.title}: the model takes no lyrics.`);
  }
  const { total } = estimateSteps(run.steps);
  const requests = [...inputs].map(id => {
    const n = graph.nodes.find(n => n.id === id)!;
    return [id, 'outputIndex' in n.data ? n.data.outputIndex : undefined, n.data.kind === 'text' ? n.data.text : n.data.kind === 'asset' ? n.data.sketchAssetId ?? n.data.assetId : nodeRequest(graph, n, st.generations, st.library, context)];
  });
  return { estimate: total, count: run.runIds.length, errors, runIds: run.runIds, steps: run.steps, inputIds: [...inputs], signature: stable({ requests, steps: run.steps.map(({ title: _title, ...s }) => s), total }) };
}

export async function prepareNodeRun(sessionId: string, targets: string[], force = true): Promise<NodeRunPreview> {
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
  const preview = previewRun(sessionId, targets, force);
  const refs = preview.steps.flatMap(s => 'modelRef' in s ? [s.modelRef] : s.kind === 'op' ? [PICKABLE_VIDEO_OPS.includes(OPS[s.op].engine) && typeof s.params._modelRef === 'string' ? s.params._modelRef : opModelFor(OPS[s.op].engine).ref] : []);
  await Promise.all([...new Set(refs)].filter(Boolean).map(ref => ensureSchema(ref)));
  return previewRun(sessionId, targets, force);
}

/** Revalidate the reviewed version before taking the lock or spending. */
export async function runNodes(sessionId: string, targets: string[], approved?: NodeRunPreview, force = true,
  onState?: import('../executor').ExecContext['onState']): Promise<import('../executor').ExecResult | null> {
  const preview = await prepareNodeRun(sessionId, targets, force);
  if (approved && preview.signature !== approved.signature) return null;
  if (preview.errors.length) { toast(preview.errors[0], 'error'); return null; }
  const problem = budgetProblem(preview.estimate);
  if (problem) { toast(problem, 'error'); return null; }
  if (!preview.count) return { outputs: new Map(), failed: [], skipped: [] };
  const release = lockNodes(sessionId, preview.runIds, preview.inputIds);
  const assetIds = preview.inputIds.flatMap(id => {
    const st = get(), n = st.sessions[sessionId].graph.nodes.find(n => n.id === id)!;
    const asset = nodeOutputAsset(n, st.generations);
    const req = nodeRequest(st.sessions[sessionId].graph, n, st.generations, st.library, requestContext(sessionId));
    const subjects = 'subjects' in req ? req.subjects ?? [] : [];
    return [...(asset ? [asset] : []), ...subjects.flatMap(s => [s.frontal, s.video, ...s.refs].filter((id): id is string => Boolean(id))), ...(n.data.kind === 'tool' && typeof n.data.params.mask === 'string' ? [n.data.params.mask] : [])];
  });
  const releaseAssets = lockAssets(assetIds);
  const pending = new Map<string, string>();
  const library = structuredClone(get().library);
  const context = requestContext(sessionId);
  const nodeOperations = Object.fromEntries(preview.runIds.map(id => [id, context.operation(get().sessions[sessionId].graph.nodes.find(n => n.id === id)!)]));
  try {
    const result = await executeSteps(preview.steps, {
      sessionId, workspace: 'node', origin: 'node', nodeLibrary: library, nodeOperations,
      onState: (stepId, state, info) => {
        if (info?.generationId) pending.set(stepId, info.generationId);
        const generationId = pending.get(stepId);
        if (state === 'done' && generationId) {
          const st = get(), graph = st.sessions[sessionId].graph;
          const node = graph.nodes.find(n => n.id === stepId)!;
          const completed = { ...node, data: { ...node.data, generationId } } as GraphNode;
          const snapshot = { ...graph, nodes: graph.nodes.map(n => n.id === stepId ? completed : n) };
          patchGeneration(generationId, { nodeRequest: stable(nodeRequest(snapshot, completed, st.generations, library, { ...context, schemas: st.catalog.schemas })) });
          setGraph(sessionId, g => ({ ...g, nodes: g.nodes.map(n => n.id === stepId ? completed : n) }));
        }
        onState?.(stepId, state, info);
      },
    });
    if (result.failed.length) toast(`${result.failed.length} node(s) failed: ${result.failed[0].error}`, 'error');
    return result;
  } finally { releaseAssets(); release(); }
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
    next = { ...next, edges: [...next.edges, { ...edge }] };
  }
  return { error: editGraph(sessionId, () => next), skipped };
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
