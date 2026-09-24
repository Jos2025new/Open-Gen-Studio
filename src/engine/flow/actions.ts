import { uid } from '../../lib/id';
import { executeSteps, estimateSteps } from '../executor';
import { defaultOpParams, OPS } from '../ops';
import type { Estimate, GenNodeData, GraphNode, GraphNodeData, MediaKind, OpId } from '../types';
import { setGraph, toast, useStore } from '../../store/store';
import { autoLayout, connect, connectionError, graphToSteps, inputPorts, NODE_WIDTH, outputPort } from './graph';
import { budgetProblem } from '../actions';

const get = useStore.getState;

export function newNodeData(kind: GraphNodeData['kind'], opts: { op?: OpId; assetId?: string } = {}): GraphNodeData {
  const st = get();
  switch (kind) {
    case 'text':
      return { kind: 'text', title: 'Prompt', text: '' };
    case 'image':
    case 'video': {
      const c = st.composer[kind as MediaKind];
      return { kind, title: kind === 'image' ? 'Image' : 'Video', prompt: '', modelRef: c.modelRef, settings: { ...c.settings, seed: undefined }, outputIndex: 0 };
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
  const siblings = graph.edges.filter((e) => e.source === fromId).length;
  const id = addNode(sessionId, data, { x: from.position.x + NODE_WIDTH + 100, y: from.position.y + siblings * 80 });
  if (port) tryConnect(sessionId, { source: fromId, target: id, targetHandle: port.id });
  return id;
}

/** Copy a node (without its results) slightly offset. */
export function duplicateNode(sessionId: string, node: GraphNode): string {
  const data = { ...node.data } as GraphNodeData;
  if (data.kind === 'image' || data.kind === 'video' || data.kind === 'tool') delete (data as GenNodeData).generationId;
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
  return nodes.filter((n) => n.data.kind === 'image' || n.data.kind === 'video' || n.data.kind === 'tool').map((n) => n.id);
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
      setGraph(sessionId, (g) => ({
        ...g,
        nodes: g.nodes.map((n) =>
          n.id === stepId && (n.data.kind === 'image' || n.data.kind === 'video' || n.data.kind === 'tool') ? { ...n, data: { ...n.data, generationId: info.generationId } } : n,
        ),
      }));
    },
  });
  if (result.failed.length) {
    const first = result.failed[0];
    if (first.error !== 'Canceled') toast(`${result.failed.length} node(s) failed: ${first.error}`, 'error');
  }
}
