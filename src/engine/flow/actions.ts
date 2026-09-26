import { uid } from '../../lib/id';
import { executeSteps, estimateSteps } from '../executor';
import { defaultOpParams, OPS } from '../ops';
import type { Estimate, GenNodeData, GraphNode, GraphNodeData, MediaKind, OpId } from '../types';
import { setGraph, toast, useStore } from '../../store/store';
import { autoLayout, connect, connectionError, estimatedHeight, graphToSteps, inputPorts, NODE_WIDTH, outputPort, runsGeneration } from './graph';
import { budgetProblem, deleteAssets } from '../actions';

const get = useStore.getState;

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

export function patchNodeData(sessionId: string, nodeId: string, patch: Partial<GraphNodeData>): void {
  setGraph(sessionId, (g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...patch } as GraphNodeData } : n)) }));
}

export function deleteNodes(sessionId: string, ids: string[]): void {
  const drop = new Set(ids);
  setGraph(sessionId, (g) => ({ ...g, nodes: g.nodes.filter((n) => !drop.has(n.id)), edges: g.edges.filter((e) => !drop.has(e.source) && !drop.has(e.target)) }));
}

/** Add a node to the right of `fromId`, wired to its first input that accepts the source's output. */
export function addConnected(sessionId: string, fromId: string, data: GraphNodeData): string | null {
  const st = get();
  const graph = st.sessions[sessionId].graph;
  const from = graph.nodes.find((n) => n.id === fromId);
  if (!from) return null;
  const type = outputPort(from.data, st.assets);
  const port = inputPorts(data).find((p) => p.type === type);
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
export function setNodeModel(sessionId: string, nodeId: string, patch: Pick<GenNodeData, 'modelRef' | 'settings'>): void {
  const node = get().sessions[sessionId].graph.nodes.find((n) => n.id === nodeId);
  if (!node || (node.data.kind !== 'image' && node.data.kind !== 'video' && node.data.kind !== 'audio' && node.data.kind !== 'model3d')) return;
  const textOutput = node.data.kind === 'audio' && get().catalog.models[patch.modelRef]?.textOutput ? true : undefined;
  patchNodeData(sessionId, nodeId, { ...patch, textOutput });
  if (Boolean(textOutput) === Boolean(node.data.textOutput)) return;
  setGraph(sessionId, (g) => {
    const out = outputPort(g.nodes.find((n) => n.id === nodeId)!.data, get().assets);
    const edges = g.edges.filter((e) => {
      if (e.source !== nodeId) return true;
      const tgt = g.nodes.find((n) => n.id === e.target);
      return inputPorts(tgt?.data ?? node.data).find((p) => p.id === e.targetHandle)?.type === out;
    });
    return { ...g, edges };
  });
}

/** Set (or clear, with `undefined`) a node's painted-over copy. The copy it replaces is deleted. */
export function setSketch(sessionId: string, nodeId: string, assetId: string | undefined): void {
  const node = get().sessions[sessionId].graph.nodes.find((n) => n.id === nodeId);
  if (!node || node.data.kind === 'text') return;
  const prev = node.data.sketchAssetId;
  patchNodeData(sessionId, nodeId, { sketchAssetId: assetId });
  if (prev && prev !== assetId) deleteAssets([prev]);
}

/** Copy a node (without its results) slightly offset. */
export function duplicateNode(sessionId: string, node: GraphNode): string {
  const data = { ...node.data } as GraphNodeData;
  if (runsGeneration(data)) delete (data as GenNodeData).generationId;
  return addNode(sessionId, data, { x: node.position.x + 40, y: node.position.y + 40 });
}

export function tryConnect(sessionId: string, c: { source: string; target: string; targetHandle: string | null }): boolean {
  const st = get();
  const graph = st.sessions[sessionId].graph;
  const err = connectionError(graph, st.assets, c);
  if (err) {
    toast(err, 'error');
    return false;
  }
  setGraph(sessionId, (g) => connect(g, { source: c.source, target: c.target, targetHandle: c.targetHandle! }));
  return true;
}

export function layoutAll(sessionId: string): void {
  const graph = get().sessions[sessionId].graph;
  const pos = autoLayout(graph.nodes, graph.edges, { x: 0, y: 0 });
  setGraph(sessionId, (g) => ({ ...g, nodes: g.nodes.map((n) => ({ ...n, position: pos.get(n.id) ?? n.position })) }));
}

export function runnableIds(nodes: GraphNode[]): string[] {
  return nodes.filter((n) => runsGeneration(n.data)).map((n) => n.id);
}

export interface NodeRunPreview {
  estimate: Estimate;
  count: number;
  errors: string[];
}

/** What running these nodes would do and cost (upstream nodes without output are included). */
export function previewRun(sessionId: string, targets: string[]): NodeRunPreview {
  const st = get();
  const run = graphToSteps(st.sessions[sessionId].graph, targets, st.generations);
  const runnable = run.steps.filter((s) => s.kind !== 'text');
  const { total } = estimateSteps(runnable);
  return { estimate: total, count: runnable.length, errors: run.errors };
}

/** Run nodes (after the user confirmed the cost). */
export async function runNodes(sessionId: string, targets: string[]): Promise<void> {
  const st = get();
  const run = graphToSteps(st.sessions[sessionId].graph, targets, st.generations);
  if (run.errors.length) {
    toast(run.errors[0], 'error');
    return;
  }
  const { total } = estimateSteps(run.steps);
  const problem = budgetProblem(total);
  if (problem) {
    toast(problem, 'error');
    return;
  }
  const result = await executeSteps(run.steps, {
    sessionId,
    workspace: 'node',
    origin: 'node',
    onState: (stepId, _state, info) => {
      if (!info?.generationId) return;
      // A new result makes an earlier sketch of the old one meaningless.
      const node = get().sessions[sessionId].graph.nodes.find((n) => n.id === stepId);
      if (node && node.data.kind !== 'text' && node.data.sketchAssetId) setSketch(sessionId, stepId, undefined);
      setGraph(sessionId, (g) => ({
        ...g,
        nodes: g.nodes.map((n) =>
          n.id === stepId && runsGeneration(n.data) ? { ...n, data: { ...n.data, generationId: info.generationId } } : n,
        ),
      }));
    },
  });
  if (result.failed.length) {
    const first = result.failed[0];
    if (first.error !== 'Canceled') toast(`${result.failed.length} node(s) failed: ${first.error}`, 'error');
  }
}
